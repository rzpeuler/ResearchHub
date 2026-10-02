import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, readdir, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lookupAffectedThemeScopeSlicesV04 } from '../../knowledge/governance/theme-scope-reverse-index-v04.ts'
import type { ThemeScopeImpactCandidate, ThemeScopeImpactCheckResult } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { runThemeScopeImpactCheck } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { ApplicationServiceError } from './contracts.ts'

export const THEME_SCOPE_IMPACT_INBOX_LIMITS = {
  directory: 'logs/theme-scope-impact/proposals',
  maxRecordBytes: 1_000_000,
  maxChangedRefs: 256,
  maxCandidates: 100,
  maxListedRecords: 500,
  maxListLimit: 100,
} as const

/** Minimal canonical write receipt accepted by the post-write impact adapter. */
export interface ThemeScopeImpactWriteReceipt {
  readonly knowledgeBaseRoot: string
  readonly knowledgeBaseId: string
  readonly writerRunId: string
  readonly changeSetId: string
  readonly status: 'committed' | 'already_committed' | 'no_changes'
  readonly baseRevision: number
  readonly committedRevision: number
  readonly createdRefs: readonly string[]
  readonly updatedRefs: readonly string[]
}

export interface ThemeScopeImpactProposalView {
  readonly proposalId: string
  readonly themeRef: string
  readonly candidate: ThemeScopeImpactCandidate['candidate']
  readonly candidateFingerprint: string
  readonly changeKind: ThemeScopeImpactCandidate['changeKind']
  readonly priorDecision?: ThemeScopeImpactCandidate['priorDecision']
  readonly rationale: string
  readonly evidenceRefs: readonly string[]
  readonly changedRefs: readonly string[]
  readonly basedOnRevision: number
  readonly status: 'pending' | 'rejected'
}

export interface ThemeScopeImpactInboxRecordView {
  readonly receiptKey: string
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly committedRevision: number
  readonly status: 'ready' | 'no_changes' | 'stale'
  readonly proposals: readonly ThemeScopeImpactProposalView[]
  readonly diagnostics: readonly string[]
}

interface PersistedProposal extends Omit<ThemeScopeImpactProposalView, 'status'> { readonly status: 'pending' | 'rejected' }
interface PersistedRecord extends Omit<ThemeScopeImpactInboxRecordView, 'proposals'> { readonly proposals: readonly PersistedProposal[]; readonly receiptDigest: string }
interface Envelope { readonly version: 1; readonly record: PersistedRecord; readonly checksum: string }
interface RejectionEnvelope { readonly version: 1; readonly receiptKey: string; readonly proposalId: string; readonly knowledgeBaseId: string; readonly committedRevision: number; readonly status: 'rejected'; readonly checksum: string }

export interface ThemeScopeImpactServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly registry?: KnowledgeBaseRegistry
  readonly lookupAffectedThemes?: (handle: KnowledgeBaseHandle, changedRefs: readonly string[], changedFingerprints: readonly string[], revision: number) => ReturnType<typeof lookupAffectedThemeScopeSlicesV04>
  readonly impactRunner?: typeof runThemeScopeImpactCheck
}

const SAFE_REF = /^(entity|relation|claim|observation|event|source|module|thesis|reasoning-edge|theme-group):[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SAFE_KEY = /^[a-f0-9]{64}$/u
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MAX_WRITER_LOG_BYTES = 2_000_000

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex') }
function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}
function safeReceipt(value: unknown): ThemeScopeImpactWriteReceipt {
  if (!isRecord(value) || typeof value.knowledgeBaseRoot !== 'string' || value.knowledgeBaseRoot.trim() === ''
    || typeof value.knowledgeBaseId !== 'string' || value.knowledgeBaseId.trim() === ''
    || typeof value.writerRunId !== 'string' || !SAFE_RUN_ID.test(value.writerRunId) || value.writerRunId.includes('..')
    || typeof value.changeSetId !== 'string' || !SAFE_RUN_ID.test(value.changeSetId) || value.changeSetId.includes('..')
    || !['committed', 'already_committed', 'no_changes'].includes(String(value.status))
    || !Number.isSafeInteger(value.baseRevision) || !Number.isSafeInteger(value.committedRevision)
    || !Array.isArray(value.createdRefs) || !Array.isArray(value.updatedRefs)) {
    throw new ApplicationServiceError('invalid_input', 'A complete successful canonical write receipt is required for Theme scope impact checking.')
  }
  const receipt = value as unknown as ThemeScopeImpactWriteReceipt
  const refs = [...receipt.createdRefs, ...receipt.updatedRefs]
  if (refs.length > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxChangedRefs || refs.some((ref) => typeof ref !== 'string' || !SAFE_REF.test(ref)) || new Set(refs).size !== refs.length) {
    throw new ApplicationServiceError('invalid_input', 'Canonical write receipt refs are invalid, duplicated, or exceed the bounded impact-check limit.')
  }
  const contiguous = receipt.status === 'no_changes'
    ? refs.length === 0 && receipt.committedRevision === receipt.baseRevision
    : receipt.committedRevision === receipt.baseRevision + 1
  if (!Number.isSafeInteger(receipt.baseRevision) || !Number.isSafeInteger(receipt.committedRevision) || receipt.baseRevision < 0 || !contiguous) {
    throw new ApplicationServiceError('invalid_input', 'Canonical write receipt status and revision transition are inconsistent.')
  }
  return { ...receipt, createdRefs: [...receipt.createdRefs], updatedRefs: [...receipt.updatedRefs] }
}
function checksumValid(value: unknown, receiptKey: string): value is Envelope {
  if (!isRecord(value) || value.version !== 1 || typeof value.checksum !== 'string' || !isRecord(value.record) || value.record.receiptKey !== receiptKey) return false
  const { checksum, ...body } = value
  return digest(body) === checksum
}
function safeProposal(candidate: ThemeScopeImpactCandidate): PersistedProposal {
  return {
    proposalId: candidate.proposalId,
    themeRef: candidate.themeRef,
    candidate: candidate.candidate,
    candidateFingerprint: candidate.candidateFingerprint,
    changeKind: candidate.changeKind,
    ...(candidate.priorDecision === undefined ? {} : { priorDecision: candidate.priorDecision }),
    rationale: candidate.rationale,
    evidenceRefs: [...candidate.evidenceRefs],
    changedRefs: [...candidate.changedRefs],
    basedOnRevision: candidate.basedOnRevision,
    status: 'pending',
  }
}
function publicView(record: PersistedRecord): ThemeScopeImpactInboxRecordView {
  const { receiptDigest: _receiptDigest, ...view } = record
  return view
}
function writerReceiptDigest(receipt: ThemeScopeImpactWriteReceipt): string {
  return digest({ knowledgeBaseId: receipt.knowledgeBaseId, writerRunId: receipt.writerRunId, changeSetId: receipt.changeSetId, baseRevision: receipt.baseRevision, committedRevision: receipt.committedRevision, createdRefs: receipt.createdRefs, updatedRefs: receipt.updatedRefs })
}

/** Durable, read-only post-write proposal inbox. Canonical acceptance is deliberately delegated to the A4 governance seam. */
export class ThemeScopeImpactService {
  private readonly registry: KnowledgeBaseRegistry
  private readonly lookup: NonNullable<ThemeScopeImpactServiceOptions['lookupAffectedThemes']>
  private readonly runner: typeof runThemeScopeImpactCheck

  constructor(private readonly options: ThemeScopeImpactServiceOptions) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.lookup = options.lookupAffectedThemes ?? lookupAffectedThemeScopeSlicesV04
    this.runner = options.impactRunner ?? runThemeScopeImpactCheck
  }

  async check(receiptInput: unknown): Promise<ThemeScopeImpactInboxRecordView> {
    const receipt = safeReceipt(receiptInput)
    if (resolve(receipt.knowledgeBaseRoot) !== resolve(this.options.mountedKnowledgeBaseRoot)) throw new ApplicationServiceError('conflict', 'Canonical write receipt belongs to a different mounted Knowledge Base.')
    const handle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    if (handle.knowledgeBaseId !== receipt.knowledgeBaseId) throw new ApplicationServiceError('conflict', 'Canonical write receipt belongs to a different Knowledge Base identity.')
    if (handle.schemaVersion !== '0.4') throw new ApplicationServiceError('conflict', 'Theme scope impact inbox requires a mounted Schema 0.4 Knowledge Base.')
    await this.verifyWriterReceipt(receipt)
    const receiptDigest = writerReceiptDigest(receipt)
    const receiptKey = digest({ knowledgeBaseId: receipt.knowledgeBaseId, writerRunId: receipt.writerRunId, changeSetId: receipt.changeSetId })
    const prior = await this.read(receiptKey, true)
    if (prior) {
      if (prior.record.receiptDigest !== receiptDigest) throw new ApplicationServiceError('conflict', 'Existing Theme scope impact record does not match this canonical write receipt.')
      return this.freshView(prior.record)
    }
    if (handle.revision !== receipt.committedRevision) throw new ApplicationServiceError('conflict', 'Canonical Knowledge Base revision has moved since the write receipt; impact proposal was not created.')

    const changedRefs = [...receipt.createdRefs, ...receipt.updatedRefs]
    let result: ThemeScopeImpactCheckResult
    try {
      result = await this.runner({
        handle,
        baseRevision: receipt.baseRevision,
        committedRevision: receipt.committedRevision,
        changedRefs,
        lookupAffectedThemes: (refs, fingerprints, revision) => this.lookup(handle, refs, fingerprints, revision),
      })
    } catch {
      throw new ApplicationServiceError('failed', 'Theme scope impact check failed; no proposal was persisted.')
    }
    if (result.status === 'blocked') throw new ApplicationServiceError('conflict', `Theme scope impact check was blocked (${result.code}); no proposal was persisted.`)
    if (result.status === 'completed' && result.candidates.length > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxCandidates) throw new ApplicationServiceError('failed', 'Theme scope impact check exceeded its bounded proposal limit; no proposal was persisted.')
    const currentHandle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    if (currentHandle.knowledgeBaseId !== receipt.knowledgeBaseId || currentHandle.revision !== receipt.committedRevision) throw new ApplicationServiceError('conflict', 'Canonical Knowledge Base changed during the impact check; no proposal was persisted.')

    const existing = await this.list({ limit: THEME_SCOPE_IMPACT_INBOX_LIMITS.maxListLimit })
    if (existing.truncated) throw new ApplicationServiceError('failed', 'Theme scope impact inbox cannot prove proposal deduplication within its bounded listing capacity.')
    const existingProposalIds = new Set(existing.items.flatMap((item) => item.proposals.map((proposal) => proposal.proposalId)))
    const proposals = result.status === 'completed' ? result.candidates.filter((candidate) => !existingProposalIds.has(candidate.proposalId)).map(safeProposal) : []
    const record: PersistedRecord = {
      receiptKey,
      receiptDigest,
      knowledgeBaseId: receipt.knowledgeBaseId,
      baseRevision: receipt.baseRevision,
      committedRevision: receipt.committedRevision,
      status: result.status === 'no_changes' ? 'no_changes' : 'ready',
      proposals,
      diagnostics: result.status === 'completed' && result.candidates.length > proposals.length ? ['Previously delivered scope proposals were suppressed.'] : [],
    }
    await this.write(record)
    return this.freshView(record)
  }

  async list(input: { readonly limit?: number } = {}): Promise<{ readonly items: readonly ThemeScopeImpactInboxRecordView[]; readonly total: number; readonly truncated: boolean }> {
    const directory = await this.safeDirectory(false)
    if (!directory) return { items: [], total: 0, truncated: false }
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.length > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxListedRecords) throw new ApplicationServiceError('failed', 'Theme scope impact inbox exceeds its bounded listing capacity.')
    const records: PersistedRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !SAFE_KEY.test(entry.name.replace(/\.json$/u, '')) || !entry.name.endsWith('.json')) continue
      const loaded = await this.read(entry.name.slice(0, -5), false)
      if (loaded) records.push(loaded.record)
    }
    records.sort((a, b) => b.committedRevision - a.committedRevision || a.receiptKey.localeCompare(b.receiptKey))
    const limit = Math.max(1, Math.min(THEME_SCOPE_IMPACT_INBOX_LIMITS.maxListLimit, input.limit ?? 50))
    const current = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    const items = records.slice(0, limit).map((record) => this.viewAtRevision(record, current.revision))
    return { items, total: records.length, truncated: records.length > items.length }
  }

  async get(receiptKey: string): Promise<ThemeScopeImpactInboxRecordView> {
    const loaded = await this.read(receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    return this.freshView(loaded.record)
  }

  async reject(receiptKey: string, proposalId: string): Promise<ThemeScopeImpactProposalView> {
    const loaded = await this.read(receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    const currentHandle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    if (currentHandle.knowledgeBaseId !== loaded.record.knowledgeBaseId || currentHandle.revision !== loaded.record.committedRevision) throw new ApplicationServiceError('conflict', 'Theme scope proposal is stale at the current Knowledge Base revision and cannot be rejected.')
    const index = loaded.record.proposals.findIndex((proposal) => proposal.proposalId === proposalId)
    if (index < 0) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal was not found.')
    const current = loaded.record.proposals[index]!
    if (current.status === 'rejected') return current
    await this.writeRejection(loaded.record, current)
    return { ...current, status: 'rejected' }
  }

  private async safeDirectory(create: boolean, suffix: readonly string[] = []): Promise<string | undefined> {
    if (suffix.some((part) => !/^[A-Za-z0-9._-]{1,128}$/u.test(part) || part === '.' || part === '..')) throw new ApplicationServiceError('invalid_input', 'Theme scope impact inbox path component is invalid.')
    return this.safeSubdirectory([...THEME_SCOPE_IMPACT_INBOX_LIMITS.directory.split('/'), ...suffix], create)
  }

  private async safeSubdirectory(parts: readonly string[], create: boolean): Promise<string | undefined> {
    const root = resolve(this.options.mountedKnowledgeBaseRoot)
    const rootStat = await lstat(root).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!rootStat) throw new ApplicationServiceError('no_kb_mounted', 'Mounted Knowledge Base path is unavailable.')
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new ApplicationServiceError('failed', 'Theme scope impact inbox Knowledge Base path is unsafe.')
    const rootReal = await realpath(root)
    let current = root
    for (const part of parts) {
      current = join(current, part)
      const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
      if (!stat) {
        if (!create) return undefined
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
        const createdStat = await lstat(current)
        if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) throw new ApplicationServiceError('failed', 'Theme scope impact inbox directory is unsafe.')
      } else if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationServiceError('failed', 'Theme scope impact inbox directory is unsafe.')
      const currentReal = await realpath(current)
      if (!contained(rootReal, currentReal)) throw new ApplicationServiceError('failed', 'Theme scope impact inbox directory resolves outside the Knowledge Base.')
    }
    return current
  }

  private async read(receiptKey: string, failCorrupt: boolean): Promise<{ readonly record: PersistedRecord } | undefined> {
    if (!SAFE_KEY.test(receiptKey)) {
      if (failCorrupt) throw new ApplicationServiceError('invalid_input', 'Theme scope impact receipt key is invalid.')
      return undefined
    }
    const directory = await this.safeDirectory(false)
    if (!directory) return undefined
    const file = join(directory, `${receiptKey}.json`)
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!stat) return undefined
    try {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxRecordBytes) throw new Error('unsafe record')
      const rootReal = await realpath(resolve(this.options.mountedKnowledgeBaseRoot))
      const fileReal = await realpath(file)
      if (!contained(rootReal, fileReal)) throw new Error('record path escaped root')
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const handle = await open(file, fsConstants.O_RDONLY | noFollow)
      const opened = await handle.stat()
      const text = await handle.readFile('utf8')
      await handle.close()
      if (!opened.isFile() || opened.size > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxRecordBytes || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('record changed during read')
      const parsed: unknown = JSON.parse(text)
      if (!checksumValid(parsed, receiptKey) || !isRecord(parsed.record) || parsed.record.knowledgeBaseId !== (await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)).knowledgeBaseId || !Array.isArray(parsed.record.proposals)
        || !Number.isSafeInteger(parsed.record.baseRevision) || !Number.isSafeInteger(parsed.record.committedRevision)
        || !['ready', 'no_changes'].includes(String(parsed.record.status)) || typeof parsed.record.receiptDigest !== 'string') throw new Error('record checksum or shape invalid')
      const record = parsed.record as unknown as PersistedRecord
      const proposals = await Promise.all(record.proposals.map(async (proposal) => await this.hasRejection(record, proposal) ? { ...proposal, status: 'rejected' as const } : { ...proposal, status: 'pending' as const }))
      return { record: { ...record, proposals } }
    } catch {
      if (failCorrupt) throw new ApplicationServiceError('conflict', 'Theme scope impact inbox record is corrupt or unsafe.')
      throw new ApplicationServiceError('conflict', 'Theme scope impact inbox contains a corrupt or unsafe record.')
    }
  }

  private async write(record: PersistedRecord): Promise<void> {
    const directory = await this.safeDirectory(true)
    if (!directory) throw new ApplicationServiceError('failed', 'Theme scope impact inbox directory could not be created.')
    const body = { version: 1 as const, record }
    const envelope: Envelope = { ...body, checksum: digest(body) }
    const encoded = `${JSON.stringify(envelope)}\n`
    if (Buffer.byteLength(encoded, 'utf8') > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxRecordBytes) throw new ApplicationServiceError('failed', 'Theme scope impact proposal record exceeds its storage limit.')
    const destination = join(directory, `${record.receiptKey}.json`)
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (existing) {
      const loaded = await this.read(record.receiptKey, true)
      if (!loaded) throw new ApplicationServiceError('conflict', 'Existing Theme scope impact record could not be read safely.')
      if (loaded.record.receiptDigest !== record.receiptDigest) throw new ApplicationServiceError('conflict', 'Existing Theme scope impact record belongs to a conflicting Writer receipt.')
      return
    }
    const temporary = join(directory, `.${record.receiptKey}.${randomUUID()}.tmp`)
    const file = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    try { await file.writeFile(encoded, 'utf8'); await file.sync() } finally { await file.close() }
    try {
      await link(temporary, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const loaded = await this.read(record.receiptKey, true)
      if (!loaded || loaded.record.receiptDigest !== record.receiptDigest) throw new ApplicationServiceError('conflict', 'Concurrent Theme scope proposal delivery had a conflicting Writer receipt.')
    } finally { await unlink(temporary).catch(() => undefined) }
  }

  private async verifyWriterReceipt(receipt: ThemeScopeImpactWriteReceipt): Promise<void> {
    const directory = await this.safeSubdirectory(['logs', 'research'], false)
    if (!directory) throw new ApplicationServiceError('conflict', 'Canonical Writer execution log is unavailable; receipt provenance cannot be verified.')
    const file = join(directory, `${receipt.writerRunId}.yaml`)
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WRITER_LOG_BYTES) throw new ApplicationServiceError('conflict', 'Canonical Writer execution log is missing or unsafe; impact proposal was not created.')
    try {
      const rootReal = await realpath(resolve(this.options.mountedKnowledgeBaseRoot))
      const fileReal = await realpath(file)
      if (!contained(rootReal, fileReal)) throw new Error('Writer log path escaped Knowledge Base')
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const handle = await open(file, fsConstants.O_RDONLY | noFollow)
      const opened = await handle.stat()
      const text = await handle.readFile('utf8')
      await handle.close()
      if (!opened.isFile() || opened.size > MAX_WRITER_LOG_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('Writer log changed during read')
      const log: unknown = parseYaml(text, file)
      if (!isRecord(log) || log.workflowRunId !== receipt.writerRunId || log.changeSetId !== receipt.changeSetId || log.knowledgeBaseId !== receipt.knowledgeBaseId || log.status !== 'completed') throw new Error('Writer identity mismatch')
      const expectedWriteStatus = receipt.status === 'no_changes' ? 'no_changes' : 'committed'
      const expectedBaseRevision = expectedWriteStatus === 'no_changes' ? receipt.committedRevision : receipt.committedRevision - 1
      const changes = isRecord(log.changes) ? log.changes : undefined
      if (log.writeStatus !== expectedWriteStatus || log.committedRevision !== receipt.committedRevision || expectedBaseRevision !== receipt.baseRevision
        || !changes || !sameStrings(changes.createdIds, receipt.createdRefs) || !sameStrings(changes.updatedIds, receipt.updatedRefs)) throw new Error('Writer receipt does not match durable Writer log')
    } catch {
      throw new ApplicationServiceError('conflict', 'Canonical Writer execution log does not match the supplied receipt; impact proposal was not created.')
    }
  }

  private async hasRejection(record: PersistedRecord, proposal: PersistedProposal): Promise<boolean> {
    const directory = await this.safeDirectory(false, [`${record.receiptKey}.decisions`])
    if (!directory) return false
    const path = join(directory, `${digest(proposal.proposalId)}.json`)
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!stat) return false
    try {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000) throw new Error('unsafe rejection')
      const rootReal = await realpath(resolve(this.options.mountedKnowledgeBaseRoot))
      if (!contained(rootReal, await realpath(path))) throw new Error('rejection path escaped Knowledge Base')
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const handle = await open(path, fsConstants.O_RDONLY | noFollow)
      const opened = await handle.stat()
      const text = await handle.readFile('utf8')
      await handle.close()
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 16_000) throw new Error('rejection changed during read')
      const parsed: unknown = JSON.parse(text)
      if (!isRecord(parsed) || parsed.version !== 1 || parsed.receiptKey !== record.receiptKey || parsed.proposalId !== proposal.proposalId || parsed.knowledgeBaseId !== record.knowledgeBaseId || parsed.committedRevision !== record.committedRevision || parsed.status !== 'rejected' || typeof parsed.checksum !== 'string') throw new Error('rejection envelope mismatch')
      const { checksum, ...body } = parsed
      if (digest(body) !== checksum) throw new Error('rejection checksum invalid')
      return true
    } catch {
      throw new ApplicationServiceError('conflict', 'Theme scope rejection record is corrupt or unsafe.')
    }
  }

  private async writeRejection(record: PersistedRecord, proposal: PersistedProposal): Promise<void> {
    const directory = await this.safeDirectory(true, [`${record.receiptKey}.decisions`])
    if (!directory) throw new ApplicationServiceError('failed', 'Theme scope rejection directory could not be created.')
    const body = { version: 1 as const, receiptKey: record.receiptKey, proposalId: proposal.proposalId, knowledgeBaseId: record.knowledgeBaseId, committedRevision: record.committedRevision, status: 'rejected' as const }
    const envelope: RejectionEnvelope = { ...body, checksum: digest(body) }
    const temporary = join(directory, `.${digest(proposal.proposalId)}.${randomUUID()}.tmp`)
    const destination = join(directory, `${digest(proposal.proposalId)}.json`)
    const file = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    try { await file.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8'); await file.sync() } finally { await file.close() }
    try { await link(temporary, destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!await this.hasRejection(record, proposal)) throw new ApplicationServiceError('conflict', 'Concurrent Theme scope rejection could not be verified.')
    } finally { await unlink(temporary).catch(() => undefined) }
  }

  private async freshView(record: PersistedRecord): Promise<ThemeScopeImpactInboxRecordView> {
    const current = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    return this.viewAtRevision(record, current.revision)
  }

  private viewAtRevision(record: PersistedRecord, currentRevision: number): ThemeScopeImpactInboxRecordView {
    const view = publicView(record)
    if (currentRevision === record.committedRevision) return view
    return { ...view, status: 'stale', diagnostics: [...view.diagnostics, 'Knowledge Base revision has advanced since this proposal was created.'] }
  }
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index])
}
