import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, readdir, readFile, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lookupAffectedThemeScopeSlicesV04 } from '../../knowledge/governance/theme-scope-reverse-index-v04.ts'
import type { ThemeScopeImpactCandidate, ThemeScopeImpactCheckResult } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { runThemeScopeImpactCheck } from '../../workflows/theme-scope-impact-check/workflow.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { ApplicationServiceError } from './contracts.ts'
import { ThemeScopeImpactAcceptanceV04, type ThemeScopeImpactAcceptanceResultV04 } from '../../knowledge/production/theme-scope-impact-acceptance-v04.ts'
import { readThemeScopeLedgerV04 } from '../../knowledge/governance/theme-scope-ledger-v04.ts'

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
  readonly status: 'pending' | 'rejected' | 'accepted'
  readonly decision?: 'include' | 'exclude' | 'pending' | 'dismiss'
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

interface PersistedProposal extends Omit<ThemeScopeImpactProposalView, 'status'> { readonly status: 'pending' | 'rejected' | 'accepted' }
interface PersistedRecord extends Omit<ThemeScopeImpactInboxRecordView, 'proposals'> { readonly proposals: readonly PersistedProposal[]; readonly receiptDigest: string }
interface Envelope { readonly version: 1; readonly record: PersistedRecord; readonly checksum: string }
interface RejectionEnvelope { readonly version: 1; readonly receiptKey: string; readonly proposalId: string; readonly knowledgeBaseId: string; readonly committedRevision: number; readonly status: 'rejected'; readonly checksum: string }
interface AcceptanceEnvelope { readonly version: 1; readonly receiptKey: string; readonly proposalId: string; readonly knowledgeBaseId: string; readonly candidateFingerprint: string; readonly decision: 'include' | 'exclude' | 'pending'; readonly rationale: string; readonly writerRunId: string; readonly changeSetId: string; readonly decisionId: string; readonly baseRevision: number; readonly committedRevision: number; readonly status: 'accepted'; readonly checksum: string }

export interface ThemeScopeImpactServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly registry?: KnowledgeBaseRegistry
  readonly lookupAffectedThemes?: (handle: KnowledgeBaseHandle, changedRefs: readonly string[], changedFingerprints: readonly string[], revision: number) => ReturnType<typeof lookupAffectedThemeScopeSlicesV04>
  readonly impactRunner?: typeof runThemeScopeImpactCheck
  readonly acceptance?: ThemeScopeImpactAcceptanceV04
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
  private readonly acceptance: ThemeScopeImpactAcceptanceV04

  constructor(private readonly options: ThemeScopeImpactServiceOptions) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.lookup = options.lookupAffectedThemes ?? lookupAffectedThemeScopeSlicesV04
    this.runner = options.impactRunner ?? runThemeScopeImpactCheck
    this.acceptance = options.acceptance ?? new ThemeScopeImpactAcceptanceV04({ registry: this.registry })
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
    return { ...current, status: 'rejected', decision: 'dismiss' }
  }

  /** Narrow legacy entry point; a multi-proposal inbox must be decided atomically with decideBatch. */
  async decide(input: { readonly receiptKey: string; readonly proposalId: string; readonly decision: 'include' | 'exclude' | 'pending'; readonly rationale?: string; readonly workflowRunId: string }): Promise<ThemeScopeImpactProposalView> {
    const loaded = await this.read(input.receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    const nonDismissed = loaded.record.proposals.filter((proposal) => proposal.status !== 'rejected')
    if (nonDismissed.length !== 1 || nonDismissed[0]!.proposalId !== input.proposalId) throw new ApplicationServiceError('conflict', 'This inbox contains multiple proposals; submit one atomic decideBatch request for the complete record.')
    const record = await this.decideBatch({ receiptKey: input.receiptKey, workflowRunId: input.workflowRunId, decisions: [{ proposalId: input.proposalId, decision: input.decision, ...(input.rationale === undefined ? {} : { rationale: input.rationale }) }] })
    return record.proposals.find((proposal) => proposal.proposalId === input.proposalId)!
  }

  /** Re-reads every proposal from the persisted inbox and commits one all-proposal A4 multi-Theme transaction. */
  async decideBatch(input: { readonly receiptKey: string; readonly decisions: readonly { readonly proposalId: string; readonly decision: 'include' | 'exclude' | 'pending'; readonly rationale?: string }[]; readonly workflowRunId: string }): Promise<ThemeScopeImpactInboxRecordView> {
    const loaded = await this.read(input.receiptKey, true)
    if (!loaded) throw new ApplicationServiceError('not_found', 'Theme scope impact proposal record was not found.')
    const currentHandle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    if (currentHandle.knowledgeBaseId !== loaded.record.knowledgeBaseId) throw new ApplicationServiceError('conflict', 'Theme scope proposal belongs to a different Knowledge Base.')
    const undecided = loaded.record.proposals.filter((proposal) => proposal.status !== 'rejected')
    const submittedIds = input.decisions.map((item) => item.proposalId)
    if (new Set(submittedIds).size !== submittedIds.length || submittedIds.length !== undecided.length || undecided.some((proposal) => !submittedIds.includes(proposal.proposalId))) throw new ApplicationServiceError('conflict', 'Atomic Theme scope decision must contain exactly one explicit decision for every non-dismissed proposal in the persisted inbox.')
    const byProposalId = new Map(input.decisions.map((item) => [item.proposalId, item]))
    const items = []
    for (const proposal of undecided) {
      const submitted = byProposalId.get(proposal.proposalId)!
      const rationale = submitted.rationale?.trim() || proposal.rationale
      const existing = await this.readProposalDecision(loaded.record, proposal)
      if (existing?.status === 'accepted' && (existing.writerRunId !== input.workflowRunId || existing.decision !== submitted.decision || existing.rationale !== rationale)) throw new ApplicationServiceError('conflict', 'This impact proposal already has a different accepted decision.')
      items.push({ proposal, decision: submitted.decision, ...(submitted.rationale === undefined ? {} : { rationale: submitted.rationale }) })
    }
    const result = await this.acceptance.executeBatch({ handle: currentHandle, items, expectedBaseRevision: loaded.record.committedRevision, workflowRunId: input.workflowRunId })
    if (result.status !== 'committed' && result.status !== 'already_committed') throw new ApplicationServiceError(result.status === 'failed' ? 'failed' : 'conflict', result.errors.join('; ') || 'Theme scope decision batch was not committed by Writer.')
    if (!result.changeSetId || result.decisions.length !== items.length) throw new ApplicationServiceError('failed', 'A4 batch acceptance returned without a complete verifiable Writer receipt.')
    for (const item of items) {
      const accepted = result.decisions.find((decision) => decision.proposalId === item.proposal.proposalId)
      if (!accepted) throw new ApplicationServiceError('failed', 'A4 batch acceptance omitted a persisted proposal decision.')
      await this.writeAcceptance(loaded.record, item.proposal, {
        status: result.status, knowledgeBaseId: result.knowledgeBaseId, baseRevision: result.baseRevision, committedRevision: result.committedRevision,
        themeRef: item.proposal.themeRef, proposalId: item.proposal.proposalId, candidateFingerprint: accepted.candidateFingerprint,
        decision: accepted.decision, decisionId: accepted.decisionId as ThemeScopeImpactAcceptanceResultV04['decisionId'], writerRunId: input.workflowRunId, changeSetId: result.changeSetId, errors: [],
      }, item.rationale?.trim() || item.proposal.rationale)
    }
    const refreshed = await this.read(input.receiptKey, true)
    if (!refreshed) throw new ApplicationServiceError('failed', 'The accepted Theme scope impact inbox could not be re-read after Writer commit.')
    return refreshed.record
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
      const proposals = await Promise.all(record.proposals.map(async (proposal) => {
        const decision = await this.readProposalDecision(record, proposal)
        return { ...proposal, status: (decision?.status ?? 'pending') as ThemeScopeImpactProposalView['status'], ...(decision ? { decision: decision.status === 'rejected' ? 'dismiss' as const : decision.decision } : {}) }
      }))
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

  private async readProposalDecision(record: PersistedRecord, proposal: PersistedProposal): Promise<RejectionEnvelope | AcceptanceEnvelope | undefined> {
    const directory = await this.safeDirectory(false, [`${record.receiptKey}.decisions`])
    if (!directory) return undefined
    const path = join(directory, `${digest(proposal.proposalId)}.json`)
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!stat) return undefined
    try {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000) throw new Error('unsafe decision')
      const rootReal = await realpath(resolve(this.options.mountedKnowledgeBaseRoot))
      if (!contained(rootReal, await realpath(path))) throw new Error('decision path escaped Knowledge Base')
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const handle = await open(path, fsConstants.O_RDONLY | noFollow)
      const opened = await handle.stat()
      const text = await handle.readFile('utf8')
      await handle.close()
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 16_000) throw new Error('decision changed during read')
      const parsed: unknown = JSON.parse(text)
      if (!isRecord(parsed) || parsed.version !== 1 || parsed.receiptKey !== record.receiptKey || parsed.proposalId !== proposal.proposalId || parsed.knowledgeBaseId !== record.knowledgeBaseId || typeof parsed.checksum !== 'string' || !['rejected', 'accepted'].includes(String(parsed.status))) throw new Error('decision envelope mismatch')
      const { checksum, ...body } = parsed
      if (digest(body) !== checksum) throw new Error('decision checksum invalid')
      if (parsed.status === 'rejected') {
        if (parsed.committedRevision !== record.committedRevision) throw new Error('dismissal revision mismatch')
        return parsed as unknown as RejectionEnvelope
      }
      const accepted = parsed as unknown as AcceptanceEnvelope
      if (accepted.candidateFingerprint !== proposal.candidateFingerprint || !['include', 'exclude', 'pending'].includes(accepted.decision)
        || typeof accepted.rationale !== 'string' || !SAFE_RUN_ID.test(accepted.writerRunId) || !SAFE_RUN_ID.test(accepted.changeSetId)
        || !/^theme-scope-decision:[a-f0-9]{64}$/u.test(accepted.decisionId)
        || !Number.isSafeInteger(accepted.baseRevision) || !Number.isSafeInteger(accepted.committedRevision)
        || accepted.committedRevision !== accepted.baseRevision + 1) throw new Error('acceptance envelope shape invalid')
      await this.verifyAcceptedDecision(record, proposal, accepted)
      return accepted
    } catch {
      throw new ApplicationServiceError('conflict', 'Theme scope decision record is corrupt, unsafe, or lacks a matching A4 Writer receipt.')
    }
  }

  private async hasRejection(record: PersistedRecord, proposal: PersistedProposal): Promise<boolean> {
    return (await this.readProposalDecision(record, proposal))?.status === 'rejected'
  }

  private async verifyAcceptedDecision(record: PersistedRecord, proposal: PersistedProposal, accepted: AcceptanceEnvelope): Promise<void> {
    const handle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    const ledger = await readThemeScopeLedgerV04(handle)
    if (handle.knowledgeBaseId !== record.knowledgeBaseId || ledger.status !== 'available' || ledger.knowledgeBaseRevision !== handle.revision) throw new Error('A4 ledger unavailable')
    const entry = ledger.themes.find((theme) => theme.themeRef === proposal.themeRef)?.history.find((item) => item.workflowRunId === accepted.writerRunId && item.decision.id === accepted.decisionId)
    if (!entry || entry.committedRevision !== accepted.committedRevision || entry.decision.candidateFingerprint !== proposal.candidateFingerprint
      || entry.decision.decision !== accepted.decision || entry.decision.rationale !== accepted.rationale || entry.decision.review.status !== 'human_confirmed') throw new Error('A4 acceptance ledger binding mismatch')
    const path = join(this.options.mountedKnowledgeBaseRoot, 'logs', 'research', `${accepted.writerRunId}.yaml`)
    const log = parseYaml(await readFile(path, 'utf8'), path)
    if (!isRecord(log) || !isRecord(log.changes) || !Array.isArray(log.changes.createdIds) || !Array.isArray(log.changes.updatedIds)) throw new Error('A4 Writer log shape invalid')
    await this.verifyWriterReceipt({
      knowledgeBaseRoot: this.options.mountedKnowledgeBaseRoot,
      knowledgeBaseId: record.knowledgeBaseId,
      writerRunId: accepted.writerRunId,
      changeSetId: accepted.changeSetId,
      status: 'committed',
      baseRevision: accepted.baseRevision,
      committedRevision: accepted.committedRevision,
      createdRefs: log.changes.createdIds as string[],
      updatedRefs: log.changes.updatedIds as string[],
    })
  }

  private async writeAcceptance(record: PersistedRecord, proposal: PersistedProposal, result: ThemeScopeImpactAcceptanceResultV04, rationale: string): Promise<void> {
    const directory = await this.safeDirectory(true, [`${record.receiptKey}.decisions`])
    if (!directory) throw new ApplicationServiceError('failed', 'Theme scope decision directory could not be created.')
    const body = {
      version: 1 as const,
      receiptKey: record.receiptKey,
      proposalId: proposal.proposalId,
      knowledgeBaseId: record.knowledgeBaseId,
      candidateFingerprint: proposal.candidateFingerprint,
      decision: result.decision!,
      rationale,
      writerRunId: result.writerRunId,
      changeSetId: result.changeSetId!,
      decisionId: result.decisionId!,
      baseRevision: result.baseRevision,
      committedRevision: result.committedRevision,
      status: 'accepted' as const,
    }
    const envelope: AcceptanceEnvelope = { ...body, checksum: digest(body) }
    const temporary = join(directory, `.${digest(proposal.proposalId)}.${randomUUID()}.tmp`)
    const destination = join(directory, `${digest(proposal.proposalId)}.json`)
    const file = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    try { await file.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8'); await file.sync() } finally { await file.close() }
    try { await link(temporary, destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const persisted = await this.readProposalDecision(record, proposal)
      if (!persisted || persisted.status !== 'accepted' || persisted.writerRunId !== result.writerRunId || persisted.decisionId !== result.decisionId) throw new ApplicationServiceError('conflict', 'Concurrent Theme scope acceptance has a different Writer decision.')
    } finally { await unlink(temporary).catch(() => undefined) }
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
