import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lookupAffectedThemeScopeSlicesV04 } from '../../knowledge/governance/theme-scope-reverse-index-v04.ts'
import type { ThemeScopeImpactCandidate, ThemeScopeImpactCheckResult } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { runThemeScopeImpactCheck } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
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
  readonly status: 'ready' | 'no_changes'
  readonly proposals: readonly ThemeScopeImpactProposalView[]
  readonly diagnostics: readonly string[]
}

interface PersistedProposal extends Omit<ThemeScopeImpactProposalView, 'status'> { readonly status: 'pending' | 'rejected' }
interface PersistedRecord extends Omit<ThemeScopeImpactInboxRecordView, 'proposals'> { readonly proposals: readonly PersistedProposal[]; readonly receiptDigest: string }
interface Envelope { readonly version: 1; readonly record: PersistedRecord; readonly checksum: string }

export interface ThemeScopeImpactServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly registry?: KnowledgeBaseRegistry
  readonly lookupAffectedThemes?: (handle: KnowledgeBaseHandle, changedRefs: readonly string[], changedFingerprints: readonly string[], revision: number) => ReturnType<typeof lookupAffectedThemeScopeSlicesV04>
  readonly impactRunner?: typeof runThemeScopeImpactCheck
}

const SAFE_REF = /^(entity|relation|claim|observation|event|source|module|thesis|reasoning-edge|theme-group):[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SAFE_KEY = /^[a-f0-9]{64}$/u

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex') }
function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}
function safeReceipt(value: unknown): ThemeScopeImpactWriteReceipt {
  if (!isRecord(value) || typeof value.knowledgeBaseRoot !== 'string' || value.knowledgeBaseRoot.trim() === ''
    || typeof value.knowledgeBaseId !== 'string' || value.knowledgeBaseId.trim() === ''
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
    : refs.length > 0 && receipt.committedRevision === receipt.baseRevision + 1
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
    if (handle.revision !== receipt.committedRevision) throw new ApplicationServiceError('conflict', 'Canonical Knowledge Base revision has moved since the write receipt; impact proposal was not created.')

    const receiptDigest = digest({ knowledgeBaseId: receipt.knowledgeBaseId, baseRevision: receipt.baseRevision, committedRevision: receipt.committedRevision, status: receipt.status, createdRefs: receipt.createdRefs, updatedRefs: receipt.updatedRefs })
    const receiptKey = receiptDigest
    const prior = await this.read(receiptKey, true)
    if (prior) {
      if (prior.record.receiptDigest !== receiptDigest) throw new ApplicationServiceError('conflict', 'Existing Theme scope impact record does not match this canonical write receipt.')
      return publicView(prior.record)
    }

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

    const record: PersistedRecord = {
      receiptKey,
      receiptDigest,
      knowledgeBaseId: receipt.knowledgeBaseId,
      baseRevision: receipt.baseRevision,
      committedRevision: receipt.committedRevision,
      status: result.status === 'no_changes' ? 'no_changes' : 'ready',
      proposals: result.status === 'completed' ? result.candidates.map(safeProposal) : [],
      diagnostics: result.diagnostics.map(() => 'Scope impact check completed.').slice(0, 10),
    }
    await this.write(record)
    return publicView(record)
  }

  async list(input: { readonly limit?: number } = {}): Promise<{ readonly items: readonly ThemeScopeImpactInboxRecordView[]; readonly total: number; readonly truncated: boolean }> {
    const directory = await this.safeDirectory(false)
    if (!directory) return { items: [], total: 0, truncated: false }
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true }))
    if (entries.length > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxListedRecords) throw new ApplicationServiceError('failed', 'Theme scope impact inbox exceeds its bounded listing capacity.')
    const records: PersistedRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !SAFE_KEY.test(entry.name.replace(/\.json$/u, '')) || !entry.name.endsWith('.json')) continue
      const loaded = await this.read(entry.name.slice(0, -5), false)
      if (loaded) records.push(loaded.record)
    }
    records.sort((a, b) => b.committedRevision - a.committedRevision || a.receiptKey.localeCompare(b.receiptKey))
    const limit = Math.max(1, Math.min(THEME_SCOPE_IMPACT_INBOX_LIMITS.maxListLimit, input.limit ?? 50))
    const items = records.slice(0, limit).map(publicView)
    return { items, total: records.length, truncated: records.length > items.length }
  }

  async get(receiptKey: string): Promise<ThemeScopeImpactInboxRecordView> {
    const loaded = await this.read(receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    return publicView(loaded.record)
  }

  async reject(receiptKey: string, proposalId: string): Promise<ThemeScopeImpactProposalView> {
    const loaded = await this.read(receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    const index = loaded.record.proposals.findIndex((proposal) => proposal.proposalId === proposalId)
    if (index < 0) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal was not found.')
    const current = loaded.record.proposals[index]!
    if (current.status === 'rejected') return current
    const proposals = loaded.record.proposals.map((proposal, position) => position === index ? { ...proposal, status: 'rejected' as const } : proposal)
    const record = { ...loaded.record, proposals }
    await this.write(record)
    return proposals[index]!
  }

  private async safeDirectory(create: boolean): Promise<string | undefined> {
    const root = resolve(this.options.mountedKnowledgeBaseRoot)
    const rootStat = await lstat(root).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!rootStat) throw new ApplicationServiceError('no_kb_mounted', 'Mounted Knowledge Base path is unavailable.')
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new ApplicationServiceError('failed', 'Theme scope impact inbox Knowledge Base path is unsafe.')
    const rootReal = await realpath(root)
    let current = root
    for (const part of THEME_SCOPE_IMPACT_INBOX_LIMITS.directory.split('/')) {
      current = join(current, part)
      const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
      if (!stat) {
        if (!create) return undefined
        await mkdir(current)
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
      return { record: parsed.record as unknown as PersistedRecord }
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
      // Preserve durable human decisions on replay; only a rejection may be appended.
      const proposals = record.proposals.map((proposal) => loaded.record.proposals.find((old) => old.proposalId === proposal.proposalId && old.status === 'rejected') ?? proposal)
      record = { ...record, proposals }
      const nextBody = { version: 1 as const, record }
      const next: Envelope = { ...nextBody, checksum: digest(nextBody) }
      const nextText = `${JSON.stringify(next)}\n`
      if (Buffer.byteLength(nextText, 'utf8') > THEME_SCOPE_IMPACT_INBOX_LIMITS.maxRecordBytes) throw new ApplicationServiceError('failed', 'Theme scope impact proposal record exceeds its storage limit.')
      const temporary = join(directory, `.${record.receiptKey}.${randomUUID()}.tmp`)
      const file = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
      try { await file.writeFile(nextText, 'utf8'); await file.sync() } finally { await file.close() }
      await rename(temporary, destination)
      return
    }
    const temporary = join(directory, `.${record.receiptKey}.${randomUUID()}.tmp`)
    const file = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    try { await file.writeFile(encoded, 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temporary, destination)
  }
}
