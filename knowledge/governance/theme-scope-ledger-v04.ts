import { constants, type BigIntStats } from 'node:fs'
import { lstat, opendir, open, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { knowledgeBaseMutationLockPath } from '../storage/mutation-lock.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { parseYaml } from '../storage/yaml.ts'
import {
  THEME_SCOPE_V04_LIMITS,
  validateThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionV04,
  type ThemeScopeValidationIssueV04,
} from './theme-scope-v04.ts'

export const THEME_SCOPE_LEDGER_V04_LIMITS = {
  maxDirectoryEntries: 4096,
  maxWriterLogs: 2048,
  maxLogBytes: 2_000_000,
  maxTotalLogBytes: 16_000_000,
  maxHistoryDecisions: THEME_SCOPE_V04_LIMITS.maxHistoryDecisions,
} as const

export type ThemeScopeLedgerErrorCodeV04 =
  | 'KNOWLEDGE_BASE_INVALID'
  | 'KNOWLEDGE_BASE_NOT_ACTIVE_V04'
  | 'KNOWLEDGE_BASE_IDENTITY_MISMATCH'
  | 'KNOWLEDGE_BASE_REVISION_ROLLBACK'
  | 'KNOWLEDGE_BASE_WRITE_IN_PROGRESS'
  | 'KNOWLEDGE_BASE_RECOVERY_PENDING'
  | 'KNOWLEDGE_BASE_CHANGED_DURING_READ'
  | 'LOG_PATH_UNSAFE'
  | 'LOG_SCAN_LIMIT'
  | 'LOG_SIZE_LIMIT'
  | 'LOG_CHANGED_DURING_READ'
  | 'LOG_UNREADABLE'
  | 'LOG_MALFORMED'
  | 'LOG_IDENTITY_MISMATCH'
  | 'LOG_UNCOMMITTED'
  | 'LOG_REVISION_INVALID'
  | 'LOG_REVISION_FUTURE'
  | 'LOG_REVISION_INCONSISTENT'
  | 'SCOPE_BATCH_INVALID'
  | 'SCOPE_HISTORY_LIMIT'
  | 'SCOPE_REVISION_AMBIGUOUS'
  | 'SCOPE_DECISION_DUPLICATE'

export interface ThemeScopeLedgerErrorV04 {
  readonly code: ThemeScopeLedgerErrorCodeV04
  readonly message: string
  readonly logPath?: string
  readonly issues?: readonly ThemeScopeValidationIssueV04[]
}

export interface ThemeScopeLedgerReadHooksV04 {
  /** Internal deterministic race seam for verifying descriptor-based bounded reads. */
  readonly afterLogOpen?: (relativeLogPath: string) => void | Promise<void>
}

export interface ThemeScopeLedgerEntryV04 {
  readonly workflowRunId: string
  readonly committedRevision: number
  readonly decision: ThemeScopeDecisionV04
}

export interface ThemeScopeLedgerThemeV04 {
  readonly themeRef: string
  /** Append-only history ordered by committedRevision, then decision ID. */
  readonly history: readonly ThemeScopeLedgerEntryV04[]
  /** Current decision for each semantic candidate fingerprint. */
  readonly currentByCandidateFingerprint: Readonly<Record<string, ThemeScopeLedgerEntryV04>>
}

export type ThemeScopeLedgerReadResultV04 =
  | {
    readonly status: 'available'
    readonly knowledgeBaseId: string
    readonly knowledgeBaseRevision: number
    readonly themes: readonly ThemeScopeLedgerThemeV04[]
    readonly scopeBatchCount: number
    readonly decisionCount: number
  }
  | {
    readonly status: 'failed'
    readonly knowledgeBaseId?: string
    readonly knowledgeBaseRevision?: number
    readonly error: ThemeScopeLedgerErrorV04
  }

interface ScopeLog {
  readonly workflowRunId: string
  readonly committedRevision: number
  readonly batch: unknown
  readonly path: string
}

type Dict = Record<string, unknown>

class LedgerFailure extends Error {
  constructor(
    readonly code: ThemeScopeLedgerErrorCodeV04,
    message: string,
    readonly logPath?: string,
    readonly issues?: readonly ThemeScopeValidationIssueV04[],
  ) {
    super(message)
    this.name = 'ThemeScopeLedgerFailure'
  }
}

function isRecord(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
}

function relativeWithin(rootReal: string, pathReal: string): boolean {
  const pathFromRoot = relative(rootReal, pathReal)
  return pathFromRoot !== ''
    && !isAbsolute(pathFromRoot)
    && !pathFromRoot.split(/[\\/]/).includes('..')
}

function failed(
  error: unknown,
  knowledgeBaseId?: string,
  knowledgeBaseRevision?: number,
): ThemeScopeLedgerReadResultV04 {
  if (error instanceof LedgerFailure) {
    return {
      status: 'failed',
      ...(knowledgeBaseId === undefined ? {} : { knowledgeBaseId }),
      ...(knowledgeBaseRevision === undefined ? {} : { knowledgeBaseRevision }),
      error: {
        code: error.code,
        message: error.message,
        ...(error.logPath === undefined ? {} : { logPath: error.logPath }),
        ...(error.issues === undefined ? {} : { issues: error.issues }),
      },
    }
  }
  return {
    status: 'failed',
    ...(knowledgeBaseId === undefined ? {} : { knowledgeBaseId }),
    ...(knowledgeBaseRevision === undefined ? {} : { knowledgeBaseRevision }),
    error: {
      code: 'KNOWLEDGE_BASE_INVALID',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

async function lstatOptional(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined
    throw error
  }
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && (left.ino === 0n || right.ino === 0n
    ? left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
    : left.ino === right.ino)
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

async function readBoundedFileHandle(file: FileHandle, relativeLogPath: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  const chunk = Buffer.allocUnsafe(64 * 1024)
  let totalBytes = 0
  while (true) {
    const remainingWithOverflowByte = THEME_SCOPE_LEDGER_V04_LIMITS.maxLogBytes + 1 - totalBytes
    if (remainingWithOverflowByte <= 0) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Writer log grew beyond the per-log byte limit while being read.', relativeLogPath)
    }
    const length = Math.min(chunk.length, remainingWithOverflowByte)
    let bytesRead: number
    try {
      ({ bytesRead } = await file.read(chunk, 0, length, null))
    } catch (error) {
      throw new LedgerFailure('LOG_UNREADABLE', 'Unable to read a bounded research Writer log: ' + (error instanceof Error ? error.message : String(error)), relativeLogPath)
    }
    if (bytesRead === 0) break
    totalBytes += bytesRead
    if (totalBytes > THEME_SCOPE_LEDGER_V04_LIMITS.maxLogBytes) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Writer log grew beyond the per-log byte limit while being read.', relativeLogPath)
    }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)))
  }
  return Buffer.concat(chunks, totalBytes)
}

async function readValidatedWriterLog(
  path: string,
  relativeLogPath: string,
  rootReal: string,
  pathRealBeforeOpen: string,
  pathStatBeforeOpen: BigIntStats,
  hooks: ThemeScopeLedgerReadHooksV04,
): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  let file: FileHandle
  try {
    file = await open(path, constants.O_RDONLY | noFollow)
  } catch (error) {
    throw new LedgerFailure('LOG_PATH_UNSAFE', 'Unable to open validated Writer log without following a replaced path: ' + (error instanceof Error ? error.message : String(error)), relativeLogPath)
  }
  try {
    const openedStat = await file.stat({ bigint: true })
    if (!openedStat.isFile() || !sameFileIdentity(pathStatBeforeOpen, openedStat)) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Writer log identity changed between path validation and open.', relativeLogPath)
    }
    if (Number(openedStat.size) > THEME_SCOPE_LEDGER_V04_LIMITS.maxLogBytes) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Writer log grew beyond the per-log byte limit before it was read.', relativeLogPath)
    }
    if (!sameFileSnapshot(pathStatBeforeOpen, openedStat)) {
      throw new LedgerFailure('LOG_CHANGED_DURING_READ', 'Writer log size or timestamps changed between path validation and open.', relativeLogPath)
    }
    const openedPathStat = await lstatOptional(path)
    const openedPathReal = await realpath(path)
    if (
      !openedPathStat
      || openedPathStat.isSymbolicLink()
      || !openedPathStat.isFile()
      || !sameFileIdentity(openedStat, openedPathStat)
      || openedPathReal !== pathRealBeforeOpen
      || !relativeWithin(rootReal, openedPathReal)
    ) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Writer log path changed while the validated file handle was being opened.', relativeLogPath)
    }
    if (!sameFileSnapshot(openedStat, openedPathStat)) {
      throw new LedgerFailure('LOG_CHANGED_DURING_READ', 'Writer log size or timestamps changed while its file handle was being opened.', relativeLogPath)
    }
    await hooks.afterLogOpen?.(relativeLogPath)
    const bytes = await readBoundedFileHandle(file, relativeLogPath)
    const finishedStat = await file.stat({ bigint: true })
    const finishedPathStat = await lstatOptional(path)
    let finishedPathReal: string | undefined
    try { finishedPathReal = await realpath(path) } catch { finishedPathReal = undefined }
    if (
      !sameFileSnapshot(openedStat, finishedStat)
      || Number(finishedStat.size) !== bytes.byteLength
      || !finishedPathStat
      || finishedPathStat.isSymbolicLink()
      || !finishedPathStat.isFile()
      || !sameFileSnapshot(finishedStat, finishedPathStat)
      || finishedPathReal !== pathRealBeforeOpen
    ) {
      throw new LedgerFailure('LOG_CHANGED_DURING_READ', 'Writer log identity or contents changed while its bounded file handle was being read.', relativeLogPath)
    }
    return bytes
  } catch (error) {
    if (error instanceof LedgerFailure) throw error
    throw new LedgerFailure('LOG_UNREADABLE', 'Unable to verify or read a bounded research Writer log: ' + (error instanceof Error ? error.message : String(error)), relativeLogPath)
  } finally {
    await file.close().catch(() => undefined)
  }
}

async function assertNoRecoveryOrWriter(root: string): Promise<void> {
  const recoveryMarker = root + '.recovery.json'
  const marker = await lstatOptional(recoveryMarker)
  if (marker) {
    throw new LedgerFailure(
      'KNOWLEDGE_BASE_RECOVERY_PENDING',
      'Knowledge Base root transaction recovery is pending; the read-only ledger will not inspect a potentially partial root.',
    )
  }
  const lockPath = knowledgeBaseMutationLockPath(root)
  const lock = await lstatOptional(lockPath)
  if (lock) {
    throw new LedgerFailure(
      'KNOWLEDGE_BASE_WRITE_IN_PROGRESS',
      'A Knowledge Base Writer transaction is active; retry the read-only ledger after it completes.',
    )
  }
}

async function assertRegularContainedPath(
  path: string,
  rootReal: string,
  label: string,
  errorCode: ThemeScopeLedgerErrorCodeV04,
): Promise<void> {
  const stat = await lstatOptional(path)
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new LedgerFailure(errorCode, label + ' is missing, is not a regular file, or is a symlink.')
  }
  const pathReal = await realpath(path)
  if (!relativeWithin(rootReal, pathReal)) {
    throw new LedgerFailure(errorCode, label + ' resolves outside the mounted Knowledge Base.')
  }
}

async function scanResearchLogs(
  root: string,
  rootReal: string,
  knowledgeBaseId: string,
  hooks: ThemeScopeLedgerReadHooksV04,
): Promise<readonly ScopeLog[]> {
  const logsDirectory = join(root, 'logs')
  const researchDirectory = join(logsDirectory, 'research')
  const logsStat = await lstatOptional(logsDirectory)
  if (!logsStat) return []
  if (logsStat.isSymbolicLink() || !logsStat.isDirectory()) {
    throw new LedgerFailure('LOG_PATH_UNSAFE', 'Knowledge Base logs directory is not a safe directory.')
  }
  const logsReal = await realpath(logsDirectory)
  if (!relativeWithin(rootReal, logsReal)) {
    throw new LedgerFailure('LOG_PATH_UNSAFE', 'Knowledge Base logs directory resolves outside the mounted root.')
  }

  const researchStat = await lstatOptional(researchDirectory)
  if (!researchStat) return []
  if (researchStat.isSymbolicLink() || !researchStat.isDirectory()) {
    throw new LedgerFailure('LOG_PATH_UNSAFE', 'Knowledge Base research log directory is not a safe directory.')
  }
  const researchReal = await realpath(researchDirectory)
  if (!relativeWithin(rootReal, researchReal)) {
    throw new LedgerFailure('LOG_PATH_UNSAFE', 'Knowledge Base research log directory resolves outside the mounted root.')
  }

  const names: string[] = []
  const directory = await opendir(researchDirectory)
  let entryCount = 0
  for await (const entry of directory) {
    entryCount += 1
    if (entryCount > THEME_SCOPE_LEDGER_V04_LIMITS.maxDirectoryEntries) {
      throw new LedgerFailure('LOG_SCAN_LIMIT', 'Research log directory contains too many entries to scan safely.')
    }
    if (entry.isSymbolicLink()) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Research log directory contains a symlink entry.')
    }
    if (entry.name.endsWith('.yaml')) names.push(entry.name)
  }
  names.sort(compare)
  if (names.length > THEME_SCOPE_LEDGER_V04_LIMITS.maxWriterLogs) {
    throw new LedgerFailure('LOG_SCAN_LIMIT', 'Research log directory exceeds the bounded Writer log count.')
  }

  const logs: ScopeLog[] = []
  let totalBytes = 0
  for (const name of names) {
    const workflowRunId = name.slice(0, -'.yaml'.length)
    const relativeLogPath = join('logs', 'research', name)
    const path = join(researchDirectory, name)
    if (!safeRunId(workflowRunId)) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Writer log filename is not a safe workflowRunId.', relativeLogPath)
    }
    const stat = await lstatOptional(path)
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Writer log is missing, is not a regular file, or is a symlink.', relativeLogPath)
    }
    const pathReal = await realpath(path)
    if (!relativeWithin(rootReal, pathReal)) {
      throw new LedgerFailure('LOG_PATH_UNSAFE', 'Writer log resolves outside the mounted Knowledge Base.', relativeLogPath)
    }
    const logBytes = Number(stat.size)
    if (!Number.isSafeInteger(logBytes) || logBytes > THEME_SCOPE_LEDGER_V04_LIMITS.maxLogBytes) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Writer log exceeds the per-log byte limit.', relativeLogPath)
    }
    if (totalBytes + logBytes > THEME_SCOPE_LEDGER_V04_LIMITS.maxTotalLogBytes) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Research Writer logs exceed the total byte limit.')
    }
    const bytes = await readValidatedWriterLog(path, relativeLogPath, rootReal, pathReal, stat, hooks)
    if (totalBytes + bytes.byteLength > THEME_SCOPE_LEDGER_V04_LIMITS.maxTotalLogBytes) {
      throw new LedgerFailure('LOG_SIZE_LIMIT', 'Research Writer logs exceed the total byte limit.')
    }
    totalBytes += bytes.byteLength
    let parsed: unknown
    try {
      parsed = parseYaml(new TextDecoder('utf-8', { fatal: true }).decode(bytes), path)
    } catch (error) {
      throw new LedgerFailure('LOG_MALFORMED', 'Unable to parse a bounded research Writer log: ' + (error instanceof Error ? error.message : String(error)), relativeLogPath)
    }
    if (!isRecord(parsed)) {
      throw new LedgerFailure('LOG_MALFORMED', 'Research Writer log root must be an object.', relativeLogPath)
    }

    const context = parsed.ingestionContext
    if (!isRecord(context) || !Object.hasOwn(context, 'themeScope')) continue
    const scopeValue = context.themeScope
    if (parsed.workflowRunId !== workflowRunId) {
      throw new LedgerFailure('LOG_IDENTITY_MISMATCH', 'Writer log workflowRunId does not match its filename.', relativeLogPath)
    }
    const committedRevision = parsed.committedRevision
    if (!Number.isSafeInteger(committedRevision) || Number(committedRevision) < 0) {
      throw new LedgerFailure('LOG_REVISION_INVALID', 'Writer log committedRevision must be a non-negative safe integer.', relativeLogPath)
    }
    if (parsed.schemaVersionAtExecution !== '0.4') {
      throw new LedgerFailure('LOG_IDENTITY_MISMATCH', 'Scope Writer log must identify Schema 0.4 execution.', relativeLogPath)
    }
    if (parsed.status !== 'completed' || parsed.writeStatus !== 'committed') {
      throw new LedgerFailure('LOG_UNCOMMITTED', 'Theme scope is authoritative only in a completed, committed Writer log.', relativeLogPath)
    }
    if (parsed.knowledgeBaseId !== knowledgeBaseId) {
      throw new LedgerFailure('LOG_IDENTITY_MISMATCH', 'Writer log knowledgeBaseId does not match the mounted Knowledge Base.', relativeLogPath)
    }
    logs.push({
      workflowRunId,
      committedRevision: Number(committedRevision),
      batch: scopeValue,
      path: relativeLogPath,
    })
  }
  return logs
}

function buildLedger(
  scopeLogs: readonly ScopeLog[],
  knowledgeBaseId: string,
  knowledgeBaseRevision: number,
): ThemeScopeLedgerReadResultV04 {
  const sortedLogs = [...scopeLogs].sort((left, right) =>
    left.committedRevision - right.committedRevision || compare(left.workflowRunId, right.workflowRunId),
  )
  const revisionOwner = new Map<number, ScopeLog>()
  for (const log of sortedLogs) {
    const previous = revisionOwner.get(log.committedRevision)
    if (previous) {
      throw new LedgerFailure(
        'SCOPE_REVISION_AMBIGUOUS',
        'Multiple authoritative Theme scope batches claim the same committedRevision.',
        log.path,
      )
    }
    revisionOwner.set(log.committedRevision, log)
    if (log.committedRevision > knowledgeBaseRevision) {
      throw new LedgerFailure('LOG_REVISION_FUTURE', 'Writer log committedRevision is newer than the current Knowledge Base manifest.', log.path)
    }
    if (!isRecord(log.batch) || !Array.isArray(log.batch.decisions) || !Number.isSafeInteger(log.batch.basedOnRevision)) {
      const validation = validateThemeScopeDecisionBatchV04(log.batch)
      throw new LedgerFailure('SCOPE_BATCH_INVALID', 'Committed Theme scope batch is malformed.', log.path, validation.errors)
    }
    if (Number(log.batch.basedOnRevision) + 1 !== log.committedRevision) {
      throw new LedgerFailure(
        'LOG_REVISION_INCONSISTENT',
        'A committed scope batch must be based on the immediately prior Knowledge Base revision.',
        log.path,
      )
    }
  }

  const decisions: ThemeScopeDecisionV04[] = []
  const entries: ThemeScopeLedgerEntryV04[] = []
  const decisionIds = new Set<string>()
  for (const log of sortedLogs) {
    const batch = log.batch as unknown as ThemeScopeDecisionBatchV04
    if (decisions.length + batch.decisions.length > THEME_SCOPE_LEDGER_V04_LIMITS.maxHistoryDecisions) {
      throw new LedgerFailure('SCOPE_HISTORY_LIMIT', 'Theme scope history exceeds the bounded complete-history limit.', log.path)
    }
    const duplicate = batch.decisions.find((item) => isRecord(item) && typeof item.id === 'string' && decisionIds.has(item.id))
    if (duplicate && isRecord(duplicate)) {
      throw new LedgerFailure('SCOPE_DECISION_DUPLICATE', 'A Theme scope decision ID appears in more than one committed batch.', log.path)
    }
    const validation = validateThemeScopeDecisionBatchV04(batch, { previousDecisions: decisions })
    if (!validation.valid) {
      throw new LedgerFailure('SCOPE_BATCH_INVALID', 'Committed Theme scope batch does not extend the complete prior history.', log.path, validation.errors)
    }
    for (const decision of batch.decisions) {
      decisionIds.add(decision.id)
      decisions.push(decision)
      entries.push({ workflowRunId: log.workflowRunId, committedRevision: log.committedRevision, decision })
    }
  }

  const byTheme = new Map<string, ThemeScopeLedgerEntryV04[]>()
  for (const entry of entries) {
    const themeHistory = byTheme.get(entry.decision.themeRef) ?? []
    themeHistory.push(entry)
    byTheme.set(entry.decision.themeRef, themeHistory)
  }
  const themes = [...byTheme.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([themeRef, unsortedHistory]) => {
      const history = [...unsortedHistory].sort((left, right) =>
        left.committedRevision - right.committedRevision || compare(left.decision.id, right.decision.id),
      )
      const currentByCandidateFingerprint: Record<string, ThemeScopeLedgerEntryV04> = Object.create(null) as Record<string, ThemeScopeLedgerEntryV04>
      for (const entry of history) currentByCandidateFingerprint[entry.decision.candidateFingerprint] = entry
      return { themeRef, history, currentByCandidateFingerprint }
    })
  return {
    status: 'available',
    knowledgeBaseId,
    knowledgeBaseRevision,
    themes,
    scopeBatchCount: scopeLogs.length,
    decisionCount: entries.length,
  }
}

/** Reads the authoritative Theme scope history from bounded, committed Schema 0.4 Writer logs. */
export async function readThemeScopeLedgerV04(
  handle: KnowledgeBaseHandle,
  hooks: ThemeScopeLedgerReadHooksV04 = {},
): Promise<ThemeScopeLedgerReadResultV04> {
  let knowledgeBaseId: string | undefined
  let knowledgeBaseRevision: number | undefined
  try {
    if (!handle || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') {
      throw new LedgerFailure('KNOWLEDGE_BASE_NOT_ACTIVE_V04', 'Theme scope ledger requires a mounted active Schema 0.4 / Storage 1 Knowledge Base.')
    }
    knowledgeBaseId = handle.knowledgeBaseId
    const root = resolve(handle.rootRef)
    const rootStat = await lstatOptional(root)
    if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new LedgerFailure('KNOWLEDGE_BASE_INVALID', 'Mounted Knowledge Base root is missing, is not a directory, or is a symlink.')
    }
    const rootReal = await realpath(root)
    await assertNoRecoveryOrWriter(root)

    const manifestPath = join(root, 'manifest.yaml')
    await assertRegularContainedPath(manifestPath, rootReal, 'Knowledge Base manifest', 'KNOWLEDGE_BASE_INVALID')
    const manifest = await loadKnowledgeBaseManifest(root)
    knowledgeBaseRevision = manifest.revision
    if (manifest.knowledgeBaseId !== handle.knowledgeBaseId || manifest.schemaVersion !== handle.schemaVersion || manifest.storageFormatVersion !== handle.storageFormatVersion) {
      throw new LedgerFailure('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Mounted handle and current manifest identity disagree.')
    }
    if (manifest.status !== 'active' || manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1') {
      throw new LedgerFailure('KNOWLEDGE_BASE_NOT_ACTIVE_V04', 'Current manifest is not an active Schema 0.4 / Storage 1 Knowledge Base.')
    }
    if (manifest.revision < handle.revision) {
      throw new LedgerFailure('KNOWLEDGE_BASE_REVISION_ROLLBACK', 'Current manifest revision is older than the mounted handle revision.')
    }

    const scopeLogs = await scanResearchLogs(root, rootReal, manifest.knowledgeBaseId, hooks)
    for (const log of scopeLogs) {
      if (log.committedRevision > manifest.revision) {
        throw new LedgerFailure('LOG_REVISION_FUTURE', 'Writer log committedRevision is newer than the current Knowledge Base manifest.', log.path)
      }
    }
    const result = buildLedger(scopeLogs, manifest.knowledgeBaseId, manifest.revision)

    await assertNoRecoveryOrWriter(root)
    const latestRootStat = await lstatOptional(root)
    if (!latestRootStat || latestRootStat.isSymbolicLink() || !latestRootStat.isDirectory() || await realpath(root) !== rootReal) {
      throw new LedgerFailure('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Mounted Knowledge Base root changed while the read-only ledger was scanning Writer logs.')
    }
    await assertRegularContainedPath(manifestPath, rootReal, 'Knowledge Base manifest', 'KNOWLEDGE_BASE_INVALID')
    const latestManifest = await loadKnowledgeBaseManifest(root)
    if (
      latestManifest.revision !== manifest.revision
      || latestManifest.knowledgeBaseId !== manifest.knowledgeBaseId
      || latestManifest.schemaVersion !== '0.4'
      || latestManifest.storageFormatVersion !== '1'
      || latestManifest.status !== 'active'
    ) {
      throw new LedgerFailure('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Knowledge Base changed while the read-only ledger was scanning Writer logs.')
    }
    return result
  } catch (error) {
    return failed(error, knowledgeBaseId, knowledgeBaseRevision)
  }
}
