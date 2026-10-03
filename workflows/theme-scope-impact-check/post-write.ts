import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import type { ThemeScopeImpactInboxRecordView, ThemeScopeImpactWriteReceipt } from '../../app/services/theme-scope-impact-service.ts'

const MAX_WRITER_LOG_BYTES = 2_000_000
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SAFE_CHANGE_SET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SAFE_REF = /^(entity|relation|claim|observation|event|source|module|thesis|reasoning-edge|theme-group):[A-Za-z0-9][A-Za-z0-9._-]*$/u
const MAX_CHANGED_REFS = 256

export interface ThemeScopeImpactChecker {
  check(receipt: unknown): Promise<ThemeScopeImpactInboxRecordView>
}

export interface ThemeScopeImpactTriggerResult {
  readonly status: 'not_triggered' | 'ready' | 'no_changes' | 'stale' | 'blocked' | 'failed'
  readonly receiptKey?: string
  readonly proposals?: number
  readonly diagnostics: readonly string[]
}

export interface ThemeScopeImpactPostWriteInput {
  readonly mountedKnowledgeBaseRoot: string
  readonly writerRunId: string
  readonly expectedKnowledgeBaseId: string
  readonly expectedCommittedRevision?: number
  readonly expectedCreatedIds: readonly string[]
  readonly expectedUpdatedIds: readonly string[]
  readonly checker?: ThemeScopeImpactChecker
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

function sameStrings(value: unknown, expected: readonly string[]): value is readonly string[] {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
}

function validRefs(createdIds: readonly string[], updatedIds: readonly string[]): boolean {
  const all = [...createdIds, ...updatedIds]
  return all.length > 0 && all.length <= MAX_CHANGED_REFS
    && all.every((ref) => typeof ref === 'string' && SAFE_REF.test(ref))
    && new Set(all).size === all.length
}

async function readVerifiedWriterReceipt(input: ThemeScopeImpactPostWriteInput): Promise<ThemeScopeImpactWriteReceipt> {
  if (!SAFE_RUN_ID.test(input.writerRunId) || input.writerRunId.includes('..')) throw new Error('Writer run ID is invalid.')
  if (!input.expectedKnowledgeBaseId || !validRefs(input.expectedCreatedIds, input.expectedUpdatedIds)) throw new Error('The completed workflow did not report a bounded canonical change inventory.')

  const root = resolve(input.mountedKnowledgeBaseRoot)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Mounted Knowledge Base path is unsafe.')
  const directory = join(root, 'logs', 'research')
  const file = join(directory, `${input.writerRunId}.yaml`)
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WRITER_LOG_BYTES) throw new Error('The exact bounded Writer log is missing or unsafe.')

  const rootReal = await realpath(root)
  const fileReal = await realpath(file)
  if (!contained(rootReal, fileReal)) throw new Error('Writer log resolves outside the mounted Knowledge Base.')
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const handle = await open(file, fsConstants.O_RDONLY | noFollow)
  let text: string
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_WRITER_LOG_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('Writer log changed during read.')
    text = await handle.readFile('utf8')
  } finally {
    await handle.close()
  }

  const log: unknown = parseYaml(text, file)
  if (!isRecord(log) || log.workflowRunId !== input.writerRunId || log.knowledgeBaseId !== input.expectedKnowledgeBaseId
    || log.status !== 'completed' || log.writeStatus !== 'committed' || typeof log.changeSetId !== 'string'
    || !SAFE_CHANGE_SET_ID.test(log.changeSetId) || log.changeSetId.includes('..') || !Number.isSafeInteger(log.committedRevision)
    || Number(log.committedRevision) < 1 || !isRecord(log.changes)
    || !sameStrings(log.changes.createdIds, input.expectedCreatedIds) || !sameStrings(log.changes.updatedIds, input.expectedUpdatedIds)) {
    throw new Error('The exact Writer log does not match the successful workflow result.')
  }
  const committedRevision = Number(log.committedRevision)
  const baseRevision = committedRevision - 1
  if (input.expectedCommittedRevision !== undefined && committedRevision !== input.expectedCommittedRevision) throw new Error('The Writer log revision differs from the workflow result.')
  return {
    knowledgeBaseRoot: root,
    knowledgeBaseId: input.expectedKnowledgeBaseId,
    writerRunId: input.writerRunId,
    changeSetId: log.changeSetId,
    status: 'committed',
    baseRevision,
    committedRevision,
    createdRefs: [...input.expectedCreatedIds],
    updatedRefs: [...input.expectedUpdatedIds],
  }
}

/** Run the Workflow-owned, read-only scope impact check after an independently successful canonical write. */
export async function triggerThemeScopeImpactPostWrite(input: ThemeScopeImpactPostWriteInput): Promise<ThemeScopeImpactTriggerResult> {
  if (!input.checker) return { status: 'not_triggered', diagnostics: ['Theme scope impact checker is not configured.'] }
  let receipt: ThemeScopeImpactWriteReceipt
  try {
    receipt = await readVerifiedWriterReceipt(input)
  } catch (error) {
    return { status: 'blocked', diagnostics: [error instanceof Error ? error.message : 'Writer receipt verification failed.'] }
  }
  try {
    const view = await input.checker.check(receipt)
    return {
      status: view.status,
      receiptKey: view.receiptKey,
      proposals: view.proposals.length,
      diagnostics: [...view.diagnostics],
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
    const message = error instanceof Error ? error.message : 'Theme scope impact check failed.'
    const status = code === 'failed' ? 'failed' : code === 'conflict' && /revision|stale/iu.test(message) ? 'stale' : code === 'conflict' ? 'blocked' : 'failed'
    return { status, diagnostics: [message.slice(0, 500)] }
  }
}
