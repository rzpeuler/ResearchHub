import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readThemeScopeLedgerV04 } from '../../knowledge/governance/theme-scope-ledger-v04.ts'
import { getRaw, verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import type { KnowledgeEntityV04, KnowledgeSourceV04 } from '../../knowledge/schema/domain-v04.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'
import { THEME_FRAMEWORK_BOUNDS, type ThemeFrameworkInput } from '../../skills/theme-framework/contracts.ts'
import {
  runThemeFrameworkConstruction,
  reviewThemeFrameworkConstruction,
} from '../../workflows/theme-framework-construction/workflow.ts'
import type {
  ThemeFrameworkAcquisitionPort,
  ThemeFrameworkConstructionResult,
  ThemeFrameworkDurableEvidenceBinding,
  ThemeFrameworkKnowledgeSnapshot,
  ThemeFrameworkReviewCandidate,
  ThemeFrameworkReviewResult,
  ThemeFrameworkAtomicCommitPort,
} from '../../workflows/theme-framework-construction/contracts.ts'
import { THEME_FRAMEWORK_CONSTRUCTION_LIMITS } from '../../workflows/theme-framework-construction/contracts.ts'
import { ThemeFrameworkAcceptanceV04 } from '../../knowledge/production/theme-framework-acceptance-v04.ts'
import { ApplicationServiceError } from './contracts.ts'
import { WorkflowService, type WorkflowOutcome } from './workflow-service.ts'
import { sampleThemeFrameworkRawEvidence, THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS, themeFrameworkRawEvidenceId, type ThemeFrameworkRawEvidenceExcerpt } from './theme-framework-raw-evidence.ts'

export const THEME_FRAMEWORK_REVIEW_STORE_LIMITS = {
  maxSnapshotBytes: 1_000_000,
  maxRunIdLength: 128,
  directory: 'logs/theme-framework/reviews',
} as const

type SafeEvidenceView = { readonly evidenceId: string; readonly summary: string; readonly sourceRef: `source:${string}` }
type PersistedCandidate = {
  readonly candidate: ThemeFrameworkReviewCandidate
  readonly evidence: readonly SafeEvidenceView[]
  readonly refresh?: {
    readonly refreshedFromRunId: string
    readonly sourceBasedOnRevision: number
    readonly targetRevision: number
    readonly validationSummary: { readonly writerReceipts: number; readonly sourceIds: readonly string[]; readonly evidenceBindings: number }
    readonly refreshedAt: string
  }
}
type CachedRawEvidence = { readonly bodyAvailable: boolean; readonly excerpts: readonly ThemeFrameworkRawEvidenceExcerpt[] }
type ExistingRawEvidenceProjection = {
  readonly titleEvidence: ThemeFrameworkInput['evidence'][number]
  readonly titleBinding: ThemeFrameworkDurableEvidenceBinding
  readonly titleView: SafeEvidenceView
  readonly excerpts: readonly ThemeFrameworkRawEvidenceExcerpt[]
  readonly sourceTitle: string
  readonly publishedAt?: string
  readonly sourceRef: `source:${string}`
  readonly rawRef: `raw-sha256-${string}`
}
type EventType = 'started' | 'candidate' | 'accept-intent' | 'committed' | 'rejected' | 'stale' | 'blocked' | 'failed' | 'cancelled'
type Envelope<T> = { readonly version: 1; readonly type: EventType; readonly runId: string; readonly payload: T; readonly checksum: string }

export type ThemeFrameworkReviewCandidateStatus = 'running' | 'awaiting_review' | 'rejected' | 'committed' | 'stale' | 'blocked' | 'failed' | 'cancelled'
export interface ThemeFrameworkReviewCandidateView {
  readonly status: ThemeFrameworkReviewCandidateStatus
  readonly workflowRunId: string
  readonly candidate?: {
    readonly knowledgeBaseId: string
    readonly basedOnRevision: number
    readonly theme: ThemeFrameworkReviewCandidate['theme']
    readonly framework: ThemeFrameworkReviewCandidate['framework']
    readonly acquisitionStatus: ThemeFrameworkReviewCandidate['acquisitionStatus']
    readonly diagnostics: readonly string[]
    readonly evidence: readonly SafeEvidenceView[]
    readonly refresh?: NonNullable<PersistedCandidate['refresh']>
  }
  readonly receipt?: { readonly themeRef: string; readonly committedRevision: number; readonly decisionCount: number }
}

export interface ThemeFrameworkReviewSummary {
  readonly runId: string
  readonly themeName: string
  readonly basedOnRevision: number
  readonly status: 'awaiting_review' | 'stale' | 'committed'
}

export interface ThemeFrameworkReviewList {
  readonly items: readonly ThemeFrameworkReviewSummary[]
  readonly total: number
  readonly truncated: boolean
}

export interface ThemeFrameworkActionResult {
  readonly status: ThemeFrameworkReviewResult['status']
  readonly workflowRunId: string
  readonly themeRef?: string
  readonly committedRevision?: number
  readonly decisionCount?: number
  readonly diagnostics?: readonly string[]
}

export interface ThemeFrameworkRefreshResult {
  readonly status: 'awaiting_review' | 'already_refreshed' | 'conflict' | 'blocked'
  readonly workflowRunId: string
  readonly refreshedFromRunId: string
  readonly basedOnRevision?: number
  readonly diagnostics?: readonly string[]
}

export interface ThemeFrameworkStartInput {
  readonly workflowRunId: string
  readonly name: string
  readonly definition?: string
}

export interface ThemeFrameworkStartCompletion {
  readonly status: ThemeFrameworkConstructionResult['status']
  readonly workflowRunId: string
  readonly diagnostics?: readonly string[]
}

export interface ThemeFrameworkAcquisitionServicePort extends ThemeFrameworkAcquisitionPort {}
export type ThemeFrameworkConstructionRunner = typeof runThemeFrameworkConstruction
export type ThemeFrameworkReviewRunner = typeof reviewThemeFrameworkConstruction

export interface ThemeFrameworkServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly workflowService: WorkflowService
  readonly reasoningExecutor: ReasoningExecutor
  readonly acquisition?: ThemeFrameworkAcquisitionServicePort
  readonly registry?: KnowledgeBaseRegistry
  readonly commitPort?: ThemeFrameworkAtomicCommitPort
  readonly clock?: () => string
  readonly constructionRunner?: ThemeFrameworkConstructionRunner
  readonly reviewRunner?: ThemeFrameworkReviewRunner
  readonly documentInputResolver?: Pick<DocumentInputResolver, 'resolve'>
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_VERIFIED_RAW_BYTES = 8_000_000
const MAX_EXISTING_KB_SOURCE_RAW_PAIRS = THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxSources
const MAX_EXISTING_KB_EVIDENCE = 48
const MAX_RAW_EVIDENCE_CACHE_ENTRIES = THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxSources
const MAX_CANDIDATE_BINDINGS = THEME_FRAMEWORK_BOUNDS.maxEvidence
const MAX_REVIEW_DIRECTORY_ENTRIES = 256
const MAX_REVIEW_LIST_ITEMS = 100
const TYPES: readonly EventType[] = ['started', 'candidate', 'accept-intent', 'committed', 'rejected', 'stale', 'blocked', 'failed', 'cancelled']
const safeEvidenceLocator = 'retained source document'
const MAX_WRITER_LOG_BYTES = 2_000_000
const MAX_WRITER_LOG_FILES = 4096

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function validRunId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxRunIdLength && SAFE_RUN_ID.test(value) && !value.includes('..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function inside(root: string, path: string): boolean {
  const normalizedRoot = canonicalPath(root)
  const normalizedTarget = canonicalPath(path)
  const rel = relative(normalizedRoot, normalizedTarget)
  return rel !== '' && !isAbsolute(rel) && !rel.split(/[\\/]/u).includes('..')
}

function canonicalPath(value: string): string {
  const absolute = resolve(value).replace(/^\\\\\?\\/u, '')
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right)
}

function safeErrorCode(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  const lower = message.toLocaleLowerCase()
  if (/revision|stale|conflict/u.test(lower)) return 'knowledge_revision_conflict'
  if (/evidence|source|raw|rights|integrity/u.test(lower)) return 'evidence_verification_failed'
  if (/path|symlink|directory|snapshot|checksum|sidecar|file/u.test(lower)) return 'review_snapshot_unavailable'
  return 'theme_framework_operation_failed'
}

function safeDiagnostics(result: ThemeFrameworkReviewResult): readonly string[] | undefined {
  if (result.status === 'blocked' || result.status === 'conflict' || result.status === 'failed') {
    return [`theme_framework_review_${result.status}`]
  }
  return undefined
}

function eligibleSource(source: KnowledgeSourceV04, evaluatedAt: number): boolean {
  const rights = source.rights
  const usage = source.usagePolicy
  const lifecycle = source.lifecycle
  if (!lifecycle) return false
  const validFrom = lifecycle.validFrom == null ? undefined : Date.parse(lifecycle.validFrom)
  const validUntil = lifecycle.validUntil == null ? undefined : Date.parse(lifecycle.validUntil)
  const expiry = rights.expiresAt == null ? undefined : Date.parse(rights.expiresAt)
  return lifecycle.status === 'active'
    && (validFrom === undefined || (Number.isFinite(validFrom) && validFrom <= evaluatedAt))
    && (validUntil === undefined || (Number.isFinite(validUntil) && validUntil > evaluatedAt))
    && (rights.accessScope === 'public' || rights.accessScope === 'authenticated')
    && rights.retentionAllowed === true
    && rights.aiProcessingAllowed === true
    && rights.derivativeKnowledgeAllowed === true
    && (expiry === undefined || (Number.isFinite(expiry) && expiry > evaluatedAt))
    && usage.mode === 'personal_noncommercial_research'
    && usage.retainRaw === true
    && usage.allowAiProcessing === true
    && usage.allowDerivedKnowledge === true
}

function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && TYPES.includes(value as EventType)
}

function envelope<T>(type: EventType, runId: string, payload: T): Envelope<T> {
  const body = { version: 1 as const, type, runId, payload }
  return { ...body, checksum: sha256(body) }
}

function validEnvelope(value: unknown, expectedType: EventType, runId: string): value is Envelope<unknown> {
  if (!isRecord(value) || value.version !== 1 || value.type !== expectedType || value.runId !== runId || typeof value.checksum !== 'string' || !Object.hasOwn(value, 'payload')) return false
  const body = { version: 1 as const, type: expectedType, runId, payload: value.payload }
  return sha256(body) === value.checksum
}

function diagnosticProjection(values: readonly string[]): readonly string[] {
  return values.slice(0, 16).map((value) => {
    const key = value.split(':', 1)[0] ?? ''
    if (/^[a-z][a-z0-9_-]{1,80}$/u.test(key)) return key
    return 'construction_diagnostic_redacted'
  })
}

function safeDisplayText(value: string): string {
  return value
    .replace(/raw-sha256-[a-f0-9]{64}/giu, '[Raw reference redacted]')
    .replace(/\b[A-Za-z]:\\[^\r\n"'<>|?*]+/gu, '[local path redacted]')
    .replace(/(?<!:)\/(?:home|Users|tmp|var|private|mnt|Volumes)\/[^\s"'<>]+/gu, '[local path redacted]')
}

function safeProjection<T>(value: T): T {
  if (typeof value === 'string') return safeDisplayText(value) as T
  if (Array.isArray(value)) return value.map((item) => safeProjection(item)) as T
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeProjection(item)])) as T
  return value
}

function emptySnapshotError(): never {
  throw new ApplicationServiceError('failed', 'The active Schema 0.4 Knowledge Base snapshot could not be verified')
}

export class ThemeFrameworkService {
  private readonly registry: KnowledgeBaseRegistry
  private readonly commitPort: ThemeFrameworkAtomicCommitPort
  private readonly clock: () => string
  private readonly root: string
  private readonly documentInputResolver: Pick<DocumentInputResolver, 'resolve'>
  private readonly rawEvidenceCache = new Map<string, CachedRawEvidence>()
  private readonly locks = new Map<string, Promise<void>>()

  constructor(private readonly options: ThemeFrameworkServiceOptions) {
    if (!options || typeof options.mountedKnowledgeBaseRoot !== 'string' || options.mountedKnowledgeBaseRoot.trim() === '') throw new ApplicationServiceError('invalid_input', 'mountedKnowledgeBaseRoot is required')
    this.root = resolve(options.mountedKnowledgeBaseRoot)
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.commitPort = options.commitPort ?? new ThemeFrameworkAcceptanceV04({ registry: this.registry, clock: options.clock })
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.documentInputResolver = options.documentInputResolver ?? new DocumentInputResolver()
  }

  start(input: ThemeFrameworkStartInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ThemeFrameworkStartCompletion> } {
    if (!input || !validRunId(input.workflowRunId)) throw new ApplicationServiceError('invalid_input', 'workflowRunId must be a safe deterministic identifier')
    if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > THEME_FRAMEWORK_BOUNDS.maxThemeName) throw new ApplicationServiceError('invalid_input', 'name must be non-empty and within the Theme Framework limit')
    if (input.definition !== undefined && (typeof input.definition !== 'string' || input.definition.trim() === '' || input.definition.length > THEME_FRAMEWORK_BOUNDS.maxDefinition)) throw new ApplicationServiceError('invalid_input', 'definition must be non-empty and within the Theme Framework limit')
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'theme_framework_construction', objective: `Construct Theme Framework ${input.name.trim().slice(0, 120)}` })
    const abort = () => { try { this.options.workflowService.cancelWorkflow(input.workflowRunId) } catch { /* terminal or missing run */ } }
    callerSignal?.addEventListener('abort', abort, { once: true })
    const running = this.options.workflowService.start(input.workflowRunId, async (signal): Promise<WorkflowOutcome & { readonly construction: ThemeFrameworkConstructionResult }> => {
      let startedWritten = false
      try {
        await this.writeEvent(input.workflowRunId, 'started', { startedAt: this.clock() })
        startedWritten = true
        if (signal.aborted || callerSignal?.aborted) {
          await this.writeEvent(input.workflowRunId, 'cancelled', { code: 'workflow_cancelled' }).catch(() => undefined)
          return { status: 'cancelled', summary: 'Theme Framework construction cancelled', construction: { status: 'cancelled', diagnostics: ['workflow_cancelled'] } }
        }
        const combined = combineSignals(signal, callerSignal)
        let construction: ThemeFrameworkConstructionResult
        try {
          construction = await (this.options.constructionRunner ?? runThemeFrameworkConstruction)({
            workflowRunId: input.workflowRunId,
            themeName: input.name,
            ...(input.definition === undefined ? {} : { definition: input.definition }),
            ...(combined.signal === undefined ? {} : { signal: combined.signal }),
          }, {
            readKnowledgeSnapshot: (themeName) => this.readKnowledgeSnapshot(themeName),
            ...(this.options.acquisition ? { acquisition: this.options.acquisition } : {}),
            reasoningExecutor: this.options.reasoningExecutor,
            now: this.clock,
          })
        } finally { combined.dispose() }
        if (signal.aborted || callerSignal?.aborted) {
          await this.writeEvent(input.workflowRunId, 'cancelled', { code: 'workflow_cancelled' }).catch(() => undefined)
          return { status: 'cancelled', summary: 'Theme Framework construction cancelled', construction: { status: 'cancelled', diagnostics: ['workflow_cancelled'] } }
        }
        if (construction.status === 'awaiting_review') {
          const persisted = await this.verifyCandidateForPersistence(input.workflowRunId, construction.candidate)
          await this.writeEvent(input.workflowRunId, 'candidate', persisted)
          return { status: 'completed_with_review', summary: 'Theme Framework candidate is ready for explicit review', reviewCount: persisted.candidate.framework.industryCandidates.length + persisted.candidate.framework.relationCandidates.length, construction: { status: 'awaiting_review', candidate: persisted.candidate } }
        }
        const outcomeStatus = construction.status === 'blocked' ? 'blocked' : construction.status === 'cancelled' ? 'cancelled' : 'failed'
        const safeResult = { status: construction.status, diagnostics: diagnosticProjection(construction.diagnostics) } as ThemeFrameworkConstructionResult
        const eventType = outcomeStatus === 'blocked' ? 'blocked' : outcomeStatus === 'cancelled' ? 'cancelled' : 'failed'
        await this.writeEvent(input.workflowRunId, eventType, { diagnostics: diagnosticProjection(construction.diagnostics) }).catch(() => undefined)
        return { status: outcomeStatus, summary: `Theme Framework construction ${construction.status}`, ...(outcomeStatus === 'failed' ? { errorSummary: 'Theme Framework construction did not produce a review candidate' } : {}), construction: safeResult }
      } catch (error) {
        if (startedWritten) await this.writeEvent(input.workflowRunId, 'failed', { code: safeErrorCode(error) }).catch(() => undefined)
        return { status: 'failed', summary: 'Theme Framework construction failed', errorSummary: safeErrorCode(error), construction: { status: 'failed', diagnostics: [safeErrorCode(error)] } }
      }
    }).then(({ construction }): ThemeFrameworkStartCompletion => ({
      status: construction.status,
      workflowRunId: input.workflowRunId,
      ...(construction.status === 'blocked' || construction.status === 'failed' || construction.status === 'cancelled' ? { diagnostics: diagnosticProjection(construction.diagnostics) } : {}),
    })).finally(() => callerSignal?.removeEventListener('abort', abort))
    if (callerSignal?.aborted) abort()
    running.catch(() => undefined)
    return { runId: input.workflowRunId, completion: running }
  }

  async getReviewCandidate(workflowRunId: string): Promise<ThemeFrameworkReviewCandidateView> {
    this.requireRunId(workflowRunId)
    const terminal = await this.readTerminal(workflowRunId)
    if (terminal?.type === 'committed') {
      const stored = await this.readEvent<PersistedCandidate>(workflowRunId, 'candidate')
      const receipt = terminal.payload as { themeRef?: unknown; committedRevision?: unknown; decisionCount?: unknown }
      return { status: 'committed', workflowRunId, ...(stored ? { candidate: this.projectCandidate(stored.payload) } : {}), receipt: this.projectReceipt(receipt) }
    }
    if (terminal?.type === 'rejected' || terminal?.type === 'stale' || terminal?.type === 'blocked' || terminal?.type === 'failed' || terminal?.type === 'cancelled') {
      const stored = await this.readEvent<PersistedCandidate>(workflowRunId, 'candidate')
      return { status: terminal.type, workflowRunId, ...(stored ? { candidate: this.projectCandidate(stored.payload) } : {}) }
    }
    const saved = await this.readEvent<PersistedCandidate>(workflowRunId, 'candidate')
    if (!saved) {
      const workflow = this.options.workflowService.getWorkflowStatus(workflowRunId)
      if (!workflow) {
        const started = await this.readEvent(workflowRunId, 'started')
        if (!started) throw new ApplicationServiceError('not_found', 'Theme Framework run was not found')
      }
      if (workflow && workflow.status === 'failed') return { status: 'failed', workflowRunId }
      if (workflow && workflow.status === 'blocked') return { status: 'blocked', workflowRunId }
      if (workflow && workflow.status === 'cancelled') return { status: 'cancelled', workflowRunId }
      return { status: 'running', workflowRunId }
    }
    const candidate = saved.payload.candidate
    try {
      const current = await this.readKnowledgeSnapshot(candidate.theme.name)
      if (current.knowledgeBaseId !== candidate.knowledgeBaseId || current.revision !== candidate.basedOnRevision || !(await this.candidateBindingsStillValid(saved.payload, current))) {
        await this.writeEvent(workflowRunId, 'stale', { reason: 'knowledge_snapshot_changed' }).catch(() => undefined)
        return { status: 'stale', workflowRunId, candidate: this.projectCandidate(saved.payload) }
      }
    } catch {
      return { status: 'stale', workflowRunId, candidate: this.projectCandidate(saved.payload) }
    }
    return { status: 'awaiting_review', workflowRunId, candidate: this.projectCandidate(saved.payload) }
  }

  async listReviews(limit = 50): Promise<ThemeFrameworkReviewList> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REVIEW_LIST_ITEMS) throw new ApplicationServiceError('invalid_input', 'limit must be an integer from 1 to 100')
    const { directory } = await this.ensureReviewDirectory()
    const names: string[] = []
    const handle = await opendir(directory)
    let truncated = false
    let entriesRead = 0
    try {
      for await (const entry of handle) {
        if (entriesRead >= MAX_REVIEW_DIRECTORY_ENTRIES) { truncated = true; break }
        entriesRead += 1
        if (entry.isFile() && entry.name.endsWith('.candidate.json')) names.push(entry.name)
      }
    } catch (error) {
      throw new ApplicationServiceError('failed', 'Theme Framework review summaries are unavailable', { cause: error })
    }
    const summaries: ThemeFrameworkReviewSummary[] = []
    for (const filename of names) {
      const runId = filename.slice(0, -'.candidate.json'.length)
      if (!validRunId(runId)) continue
      const candidate = await this.readEvent<PersistedCandidate>(runId, 'candidate')
      if (!candidate) continue
      const terminal = await this.readTerminal(runId)
      const status = terminal?.type === 'committed' || terminal?.type === 'stale'
        ? terminal.type
        : terminal ? undefined : 'awaiting_review'
      if (!status) continue
      summaries.push({ runId, themeName: candidate.payload.candidate.theme.name, basedOnRevision: candidate.payload.candidate.basedOnRevision, status })
    }
    summaries.sort((left, right) => right.runId.localeCompare(left.runId))
    truncated ||= summaries.length > limit
    return { items: summaries.slice(0, limit), total: summaries.length, truncated }
  }

  async accept(input: { readonly workflowRunId: string; readonly decisions?: Readonly<Record<string, 'include' | 'exclude' | 'pending'>> }): Promise<ThemeFrameworkActionResult> {
    if (!input || !validRunId(input.workflowRunId)) throw new ApplicationServiceError('invalid_input', 'workflowRunId is invalid')
    const decisions = this.validateDecisions(input.decisions)
    return this.serialize(input.workflowRunId, async () => {
      const committed = await this.readEvent<{ themeRef: string; committedRevision: number; decisionCount: number }>(input.workflowRunId, 'committed')
      if (committed) {
        const priorIntent = await this.readEvent<{ digest: string; decisions: Readonly<Record<string, string>> }>(input.workflowRunId, 'accept-intent')
        if (priorIntent && priorIntent.payload.digest === sha256(decisions)) return { status: 'already_committed', workflowRunId: input.workflowRunId, themeRef: committed.payload.themeRef, committedRevision: committed.payload.committedRevision, decisionCount: committed.payload.decisionCount }
        return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['theme_framework_run_already_committed'] }
      }
      if (await this.readTerminal(input.workflowRunId)) return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['theme_framework_run_is_terminal'] }
      const candidateEvent = await this.readEvent<PersistedCandidate>(input.workflowRunId, 'candidate')
      if (!candidateEvent) throw new ApplicationServiceError('conflict', 'No persisted review candidate is available')
      const persisted = candidateEvent.payload
      const digest = sha256(decisions)
      let intent = await this.readEvent<{ digest: string; decisions: Readonly<Record<string, string>> }>(input.workflowRunId, 'accept-intent')
      if (intent && intent.payload.digest !== digest) return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['theme_framework_acceptance_intent_differs'] }

      let current: ThemeFrameworkKnowledgeSnapshot
      try { current = await this.readKnowledgeSnapshot(persisted.candidate.theme.name) }
      catch { return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['knowledge_snapshot_unavailable'] } }
      if (current.knowledgeBaseId !== persisted.candidate.knowledgeBaseId) {
        await this.writeEvent(input.workflowRunId, 'stale', { reason: 'knowledge_base_identity_changed' })
        return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['knowledge_base_identity_changed'] }
      }
      if (!(await this.candidateBindingsStillValid(persisted, current))) {
        await this.writeEvent(input.workflowRunId, 'stale', { reason: 'evidence_binding_changed' })
        return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['candidate_evidence_binding_changed'] }
      }
      if (!intent && current.revision !== persisted.candidate.basedOnRevision) {
        await this.writeEvent(input.workflowRunId, 'stale', { reason: 'knowledge_revision_changed' })
        return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['knowledge_revision_changed'] }
      }
      if (!intent) {
        try {
          await this.writeEvent(input.workflowRunId, 'accept-intent', { digest, decisions })
          intent = await this.readEvent(input.workflowRunId, 'accept-intent') as typeof intent
        } catch {
          return { status: 'conflict', workflowRunId: input.workflowRunId, diagnostics: ['theme_framework_acceptance_intent_unavailable'] }
        }
      }
      if (!intent) return { status: 'failed', workflowRunId: input.workflowRunId, diagnostics: ['theme_framework_acceptance_intent_unavailable'] }
      const review = await (this.options.reviewRunner ?? reviewThemeFrameworkConstruction)({ candidate: persisted.candidate, disposition: 'accept', decisions }, this.commitPort)
      if (review.status === 'blocked') {
        await this.removeEvent(input.workflowRunId, 'accept-intent').catch(() => undefined)
        return this.projectAction(review)
      }
      if (review.status === 'conflict') {
        await this.writeEvent(input.workflowRunId, 'stale', { reason: 'commit_conflict' })
        return this.projectAction(review)
      }
      if (review.status === 'committed' || review.status === 'already_committed') {
        const receipt = { themeRef: review.themeRef, committedRevision: review.committedRevision, decisionCount: review.decisions.length }
        try { await this.writeEvent(input.workflowRunId, 'committed', receipt) }
        catch {
          const existing = await this.readEvent<typeof receipt>(input.workflowRunId, 'committed')
          if (!existing) return { status: 'failed', workflowRunId: input.workflowRunId, diagnostics: ['commit_receipt_persistence_failed'] }
        }
        return this.projectAction(review)
      }
      return this.projectAction(review)
    })
  }

  async reject(workflowRunId: string): Promise<ThemeFrameworkActionResult> {
    this.requireRunId(workflowRunId)
    return this.serialize(workflowRunId, async () => {
      if (await this.readTerminal(workflowRunId)) return { status: 'conflict', workflowRunId, diagnostics: ['theme_framework_run_is_terminal'] }
      const candidate = await this.readEvent<PersistedCandidate>(workflowRunId, 'candidate')
      if (!candidate) return { status: 'conflict', workflowRunId, diagnostics: ['no_persisted_review_candidate'] }
      try {
        const current = await this.readKnowledgeSnapshot(candidate.payload.candidate.theme.name)
        if (current.knowledgeBaseId !== candidate.payload.candidate.knowledgeBaseId || current.revision !== candidate.payload.candidate.basedOnRevision || !(await this.candidateBindingsStillValid(candidate.payload, current))) {
          await this.writeEvent(workflowRunId, 'stale', { reason: 'knowledge_snapshot_changed' })
          return { status: 'conflict', workflowRunId, diagnostics: ['candidate_is_stale'] }
        }
      } catch { return { status: 'conflict', workflowRunId, diagnostics: ['knowledge_snapshot_unavailable'] } }
      try { await this.writeEvent(workflowRunId, 'rejected', { rejectedAt: this.clock() }) }
      catch { return { status: 'conflict', workflowRunId, diagnostics: ['theme_framework_review_state_unavailable'] } }
      return { status: 'rejected', workflowRunId }
    })
  }

  /** Rebase a persisted, still-unaccepted proposal across Source/Raw-only Writer revisions. */
  async refresh(workflowRunId: string): Promise<ThemeFrameworkRefreshResult> {
    this.requireRunId(workflowRunId)
    return this.serialize(workflowRunId, async () => {
      const sourceRunId = workflowRunId
      const blocked = (diagnostic: string, refreshedRunId = ''): ThemeFrameworkRefreshResult => ({
        status: 'blocked', workflowRunId: refreshedRunId || sourceRunId, refreshedFromRunId: sourceRunId, diagnostics: [diagnostic],
      })
      let sourceEvent: Envelope<PersistedCandidate> | undefined
      let sourceTerminal: Envelope<unknown> | undefined
      try {
        sourceEvent = await this.readEvent<PersistedCandidate>(sourceRunId, 'candidate')
        sourceTerminal = await this.readTerminal(sourceRunId)
      } catch { return blocked('source_review_unavailable') }
      if (!sourceEvent) return blocked('source_candidate_unavailable')
      if (sourceTerminal && sourceTerminal.type !== 'stale') return blocked('source_review_terminal')
      try { if (await this.readEvent(sourceRunId, 'accept-intent')) return blocked('source_acceptance_intent_exists') }
      catch { return blocked('source_acceptance_intent_unavailable') }

      const rawOriginal: unknown = sourceEvent.payload
      if (!isRecord(rawOriginal)) return blocked('source_candidate_invalid')
      const rawCandidate = rawOriginal.candidate
      if (!isRecord(rawCandidate) || rawCandidate.workflowRunId !== sourceRunId
        || !Number.isSafeInteger(rawCandidate.basedOnRevision) || (rawCandidate.basedOnRevision as number) < 0
        || typeof rawCandidate.knowledgeBaseId !== 'string' || !isRecord(rawCandidate.theme)
        || typeof rawCandidate.theme.name !== 'string' || !Array.isArray(rawCandidate.durableEvidenceBindings)
        || !Array.isArray(rawOriginal.evidence)) return blocked('source_candidate_invalid')
      const original = rawOriginal as unknown as PersistedCandidate
      const sourceCandidate = original.candidate

      let current: ThemeFrameworkKnowledgeSnapshot
      let handle: KnowledgeBaseHandle
      try {
        current = await this.readKnowledgeSnapshot(sourceCandidate.theme.name)
        handle = await this.registry.refresh(this.root)
      } catch { return blocked('active_writable_knowledge_base_unavailable') }
      if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active' || !handle.writable
        || current.knowledgeBaseId !== sourceCandidate.knowledgeBaseId || handle.knowledgeBaseId !== current.knowledgeBaseId) return blocked('knowledge_base_identity_or_write_state_changed')
      if (current.existingThemeRef) return blocked('same_name_theme_exists')
      const sourceRevision = sourceCandidate.basedOnRevision as number
      if (handle.revision <= sourceRevision || current.revision !== handle.revision) return blocked('knowledge_revision_not_refreshable')
      const newRunId = `tf-refresh-${sha256({ sourceRunId, knowledgeBaseId: handle.knowledgeBaseId, targetRevision: handle.revision }).slice(0, 40)}`

      const existingRefresh = await this.readEvent<PersistedCandidate>(newRunId, 'candidate').catch(() => undefined)
      let writerSources: readonly string[]
      try { writerSources = await this.verifySourceOnlyRevisionChain(handle, sourceRevision) }
      catch { return blocked('source_only_writer_revision_chain_unproven', newRunId) }
      if (!(await this.candidateAndLocatorsStillValid(original, current))) return blocked('source_candidate_evidence_no_longer_valid', newRunId)
      if (existingRefresh) {
        if (this.isExactRefreshReplay(existingRefresh.payload, original, sourceRunId, newRunId, sourceRevision, handle.revision, writerSources)) {
          return { status: 'already_refreshed', workflowRunId: newRunId, refreshedFromRunId: sourceRunId, basedOnRevision: handle.revision }
        }
        return { status: 'conflict', workflowRunId: newRunId, refreshedFromRunId: sourceRunId, diagnostics: ['refresh_run_id_content_conflict'] }
      }

      // Recheck all gate conditions immediately before the single candidate-event commit.
      const latest = await this.registry.refresh(this.root).catch(() => undefined)
      const latestTerminal = await this.readTerminal(sourceRunId).catch(() => undefined)
      const latestIntent = await this.readEvent(sourceRunId, 'accept-intent').catch(() => undefined)
      if (!latest || latest.knowledgeBaseId !== handle.knowledgeBaseId || latest.revision !== handle.revision
        || latest.schemaVersion !== '0.4' || latest.status !== 'active' || !latest.writable
        || latestTerminal && latestTerminal.type !== 'stale' || latestIntent) return blocked('refresh_precommit_state_changed', newRunId)
      const refreshedAt = this.clock()
      const refreshedCandidate: ThemeFrameworkReviewCandidate = {
        ...sourceCandidate,
        workflowRunId: newRunId,
        basedOnRevision: handle.revision,
      }
      const refreshed: PersistedCandidate = {
        candidate: refreshedCandidate,
        evidence: original.evidence,
        refresh: {
          refreshedFromRunId: sourceRunId,
          sourceBasedOnRevision: sourceRevision,
          targetRevision: handle.revision,
          validationSummary: { writerReceipts: handle.revision - sourceRevision, sourceIds: writerSources, evidenceBindings: sourceCandidate.durableEvidenceBindings.length },
          refreshedAt,
        },
      }
      try {
        await this.writeEvent(newRunId, 'candidate', refreshed)
        const postWriteHandle = await this.registry.refresh(this.root).catch(() => undefined)
        if (!postWriteHandle || postWriteHandle.knowledgeBaseId !== handle.knowledgeBaseId || postWriteHandle.revision !== handle.revision
          || postWriteHandle.schemaVersion !== '0.4' || postWriteHandle.storageFormatVersion !== '1' || postWriteHandle.status !== 'active' || !postWriteHandle.writable) {
          try { await this.writeEvent(newRunId, 'stale', { reason: 'knowledge_snapshot_changed_during_refresh_persistence' }) }
          catch { /* Candidate revision checks in getReviewCandidate and accept remain the fail-closed fallback. */ }
          return blocked('knowledge_changed_during_refresh_persistence', newRunId)
        }
        return { status: 'awaiting_review', workflowRunId: newRunId, refreshedFromRunId: sourceRunId, basedOnRevision: handle.revision }
      } catch {
        const replay = await this.readEvent<PersistedCandidate>(newRunId, 'candidate').catch(() => undefined)
        if (replay && this.isExactRefreshReplay(replay.payload, original, sourceRunId, newRunId, sourceRevision, handle.revision, writerSources)) {
          const postWriteHandle = await this.registry.refresh(this.root).catch(() => undefined)
          if (!postWriteHandle || postWriteHandle.knowledgeBaseId !== handle.knowledgeBaseId || postWriteHandle.revision !== handle.revision
            || postWriteHandle.schemaVersion !== '0.4' || postWriteHandle.storageFormatVersion !== '1' || postWriteHandle.status !== 'active' || !postWriteHandle.writable) {
            try { await this.writeEvent(newRunId, 'stale', { reason: 'knowledge_snapshot_changed_during_refresh_persistence' }) }
            catch { /* Candidate revision checks in getReviewCandidate and accept remain the fail-closed fallback. */ }
            return blocked('knowledge_changed_during_refresh_persistence', newRunId)
          }
          return { status: 'already_refreshed', workflowRunId: newRunId, refreshedFromRunId: sourceRunId, basedOnRevision: handle.revision }
        }
        return { status: 'conflict', workflowRunId: newRunId, refreshedFromRunId: sourceRunId, diagnostics: ['refresh_candidate_persistence_conflict'] }
      }
    })
  }

  private async resolveRawEvidence(rawRef: string, sourceRef: string, originalPath: string): Promise<CachedRawEvidence> {
    const cached = this.rawEvidenceCache.get(rawRef)
    if (cached) {
      this.rawEvidenceCache.delete(rawRef)
      this.rawEvidenceCache.set(rawRef, cached)
      return cached
    }

    let value: CachedRawEvidence = { bodyAvailable: false, excerpts: [] }
    try {
      const resolved = await this.documentInputResolver.resolve({
        type: 'file',
        reference: originalPath,
        documentId: `theme-framework-${rawRef.slice(-20)}`,
      })
      const excerpts = sampleThemeFrameworkRawEvidence({ document: resolved.document, sourceRef, rawRef })
      if (excerpts.length > 0) value = { bodyAvailable: true, excerpts }
    } catch {
      // Parser/path diagnostics can contain local filesystem details and must
      // not enter the model context. Cache only the bounded unavailable marker.
    }

    this.rawEvidenceCache.set(rawRef, value)
    while (this.rawEvidenceCache.size > MAX_RAW_EVIDENCE_CACHE_ENTRIES) {
      const oldest = this.rawEvidenceCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.rawEvidenceCache.delete(oldest)
    }
    return value
  }

  private cachedRawExcerpt(rawRef: string, locator: string | undefined): ThemeFrameworkRawEvidenceExcerpt | undefined {
    return this.rawEvidenceCache.get(rawRef)?.excerpts.find((excerpt) => excerpt.blockId === locator)
  }

  private async readKnowledgeSnapshot(themeName: string): Promise<ThemeFrameworkKnowledgeSnapshot> {
    let handle: KnowledgeBaseHandle
    try { handle = await this.registry.refresh(this.root) }
    catch { return emptySnapshotError() }
    if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active' || !handle.writable) return emptySnapshotError()
    const assets = await readCanonicalV04Assets(handle.rootRef)
    const ledger = await readThemeScopeLedgerV04(handle)
    if (ledger.status !== 'available' || ledger.knowledgeBaseId !== handle.knowledgeBaseId || ledger.knowledgeBaseRevision !== handle.revision) return emptySnapshotError()
    const finalHandle = await this.registry.refresh(this.root)
    if (finalHandle.knowledgeBaseId !== handle.knowledgeBaseId || finalHandle.revision !== handle.revision) throw new ApplicationServiceError('conflict', 'Knowledge Base changed while the review snapshot was read')

    const objects = assets.objects.map((item) => item.value)
    const industries = objects.filter((value): value is KnowledgeEntityV04 => value.id.startsWith('entity:') && (value as KnowledgeEntityV04).type === 'industry' && (value as KnowledgeEntityV04).lifecycle.status === 'active')
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .slice(0, THEME_FRAMEWORK_BOUNDS.maxIndustries)
      .map((value) => ({ ref: value.id, name: value.name, ...(typeof value.description === 'string' && value.description.trim() ? { description: value.description.slice(0, 1200) } : {}) }))
    const existingTheme = objects.find((value) => value.id.startsWith('entity:') && (value as KnowledgeEntityV04).type === 'investment_theme' && normalized((value as KnowledgeEntityV04).name) === normalized(themeName)) as KnowledgeEntityV04 | undefined

    const evaluatedAt = Date.parse(this.clock())
    const evidence: ThemeFrameworkInput['evidence'][number][] = []
    const bindings: ThemeFrameworkDurableEvidenceBinding[] = []
    const evidenceViews: SafeEvidenceView[] = []
    const existingEvidenceRecords: ExistingRawEvidenceProjection[] = []
    let unavailableBodyCount = 0
    const sourceObjects = objects.filter((value): value is KnowledgeSourceV04 => value.id.startsWith('source:')).sort((left, right) => left.id.localeCompare(right.id))
    sourceLoop: for (const source of sourceObjects) {
      if (!Number.isFinite(evaluatedAt) || !eligibleSource(source, evaluatedAt)) continue
      for (const rawRef of [...new Set(source.rawRefs ?? [])].sort()) {
        if (existingEvidenceRecords.length >= MAX_EXISTING_KB_SOURCE_RAW_PAIRS) break sourceLoop
        let raw: Awaited<ReturnType<typeof getRaw>>
        let verified: Awaited<ReturnType<typeof verifyRaw>>
        try {
          raw = await getRaw(handle, rawRef)
          if (raw.manifest.rawRef !== rawRef || raw.manifest.sizeBytes > MAX_VERIFIED_RAW_BYTES) continue
          verified = await verifyRaw(handle, rawRef)
          if (!verified.valid || verified.rawRef !== rawRef || verified.sizeBytes !== raw.manifest.sizeBytes || verified.contentHash !== raw.manifest.contentHash) continue
        } catch {
          continue
        }
        const evidenceId = `E${sha256([source.id, rawRef]).slice(0, 40)}`
        const sourceRef = source.id as `source:${string}`
        const rawEvidence = await this.resolveRawEvidence(rawRef, sourceRef, verified.originalPath)
        const summary = safeDisplayText([source.title.trim(), source.publisher?.trim()].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' — ')).slice(0, 500) || 'Retained source document'
        if (!rawEvidence.bodyAvailable) unavailableBodyCount += 1
        const titleSummary = rawEvidence.bodyAvailable ? summary : `${summary} — retained body unavailable`.slice(0, 500)
        existingEvidenceRecords.push({
          titleEvidence: { evidenceId, origin: 'existing_kb', description: titleSummary, sourceRef, ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}) },
          titleBinding: { evidenceId, sourceRef, rawRef: rawRef as `raw-sha256-${string}`, locator: safeEvidenceLocator },
          titleView: { evidenceId, summary: titleSummary, sourceRef },
          excerpts: rawEvidence.excerpts,
          sourceTitle: summary,
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          sourceRef,
          rawRef: rawRef as `raw-sha256-${string}`,
        })
      }
    }
    for (const record of existingEvidenceRecords) {
      evidence.push(record.titleEvidence)
      bindings.push(record.titleBinding)
      evidenceViews.push(record.titleView)
    }
    let remainingExcerptSlots = Math.max(0, MAX_EXISTING_KB_EVIDENCE - evidence.length)
    for (let excerptIndex = 0; excerptIndex < THEME_FRAMEWORK_RAW_EVIDENCE_LIMITS.maxExcerptsPerRaw && remainingExcerptSlots > 0; excerptIndex += 1) {
      for (const record of existingEvidenceRecords) {
        const excerpt = record.excerpts[excerptIndex]
        if (!excerpt || remainingExcerptSlots <= 0) continue
        const locatorDescription = safeDisplayText(`${record.sourceTitle} — retained body excerpt (block=${excerpt.blockId}; page=${excerpt.page ?? 'unknown'}; section=${excerpt.sectionTitle ?? 'unlabeled'})`).slice(0, 500)
        const summary = safeDisplayText(`${locatorDescription}: ${excerpt.excerpt}`).slice(0, 500)
        const evidenceId = themeFrameworkRawEvidenceId(record.sourceRef, record.rawRef, excerpt.blockId)
        evidence.push({ evidenceId, origin: 'existing_kb', description: locatorDescription, sourceRef: record.sourceRef, ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}), excerpt: excerpt.excerpt })
        bindings.push({ evidenceId, sourceRef: record.sourceRef, rawRef: record.rawRef, locator: excerpt.blockId })
        evidenceViews.push({ evidenceId, summary, sourceRef: record.sourceRef })
        remainingExcerptSlots -= 1
      }
    }
    const ledgerSummary = `${ledger.decisionCount} prior A4 scope decisions across ${ledger.themes.length} Themes.`
    const bodyEvidenceSummary = unavailableBodyCount > 0 ? ` Body excerpts unavailable for ${unavailableBodyCount} retained Source/Raw pair(s); title metadata only.` : ' Body excerpts available for eligible retained Source/Raw pairs.'
    const summary = `Active Knowledge Base revision ${handle.revision}. Existing active Industries: ${industries.map((item) => item.name).join(', ') || 'none'}. ${ledgerSummary}${bodyEvidenceSummary}`.slice(0, THEME_FRAMEWORK_BOUNDS.maxSummary)
    const priorDecisions: ThemeFrameworkKnowledgeSnapshot['priorDecisions'] = []
    return {
      knowledgeBaseId: handle.knowledgeBaseId,
      revision: handle.revision,
      summary,
      industries,
      evidence,
      durableEvidenceBindings: bindings,
      priorDecisions,
      ...(existingTheme ? { existingThemeRef: existingTheme.id } : {}),
    }
  }

  private async verifyCandidateForPersistence(workflowRunId: string, candidate: ThemeFrameworkReviewCandidate): Promise<PersistedCandidate> {
    if (candidate.workflowRunId !== workflowRunId || !validRunId(candidate.workflowRunId)) throw new ApplicationServiceError('conflict', 'Construction runner returned a candidate for another Workflow run')
    const snapshot = await this.readKnowledgeSnapshot(candidate.theme.name)
    if (snapshot.knowledgeBaseId !== candidate.knowledgeBaseId || snapshot.revision !== candidate.basedOnRevision) throw new ApplicationServiceError('conflict', 'Knowledge Base changed before candidate persistence')
    const verified = await this.verifyCandidateBindings(candidate, snapshot)
    const sanitizedCandidate: ThemeFrameworkReviewCandidate = { ...candidate, durableEvidenceBindings: verified.bindings }
    const evidence = verified.evidence
    const persisted = { candidate: sanitizedCandidate, evidence }
    if (Buffer.byteLength(JSON.stringify(persisted), 'utf8') > THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxSnapshotBytes) throw new ApplicationServiceError('failed', 'Theme Framework review snapshot exceeds the size limit')
    return persisted
  }

  private async candidateBindingsStillValid(persisted: PersistedCandidate, snapshot: ThemeFrameworkKnowledgeSnapshot): Promise<boolean> {
    try {
      const verified = await this.verifyCandidateBindings(persisted.candidate, snapshot)
      return verified.bindings.length === persisted.candidate.durableEvidenceBindings.length
        && verified.bindings.every((binding, index) => binding.evidenceId === persisted.candidate.durableEvidenceBindings[index]?.evidenceId
          && binding.sourceRef === persisted.candidate.durableEvidenceBindings[index]?.sourceRef
          && binding.rawRef === persisted.candidate.durableEvidenceBindings[index]?.rawRef
          && binding.locator === persisted.candidate.durableEvidenceBindings[index]?.locator)
    } catch { return false }
  }

  private isExactRefreshReplay(existing: PersistedCandidate, original: PersistedCandidate, sourceRunId: string, expectedRunId: string, sourceRevision: number, targetRevision: number, sourceIds: readonly string[]): boolean {
    if (!isRecord(existing) || !isRecord(existing.candidate) || !Array.isArray(existing.evidence) || !isRecord(original) || !isRecord(original.candidate)) return false
    const meta = existing.refresh
    if (!meta || meta.refreshedFromRunId !== sourceRunId || meta.sourceBasedOnRevision !== sourceRevision || meta.targetRevision !== targetRevision
      || !Number.isFinite(Date.parse(meta.refreshedAt)) || !Array.isArray(meta.validationSummary?.sourceIds)) return false
    if (existing.candidate.workflowRunId !== expectedRunId) return false
    const expectedCandidate = { ...original.candidate, workflowRunId: expectedRunId, basedOnRevision: targetRevision }
    return existing.candidate.workflowRunId === expectedRunId
      && sha256(existing.candidate) === sha256(expectedCandidate)
      && sha256(existing.evidence) === sha256(original.evidence)
      && meta.validationSummary.writerReceipts === targetRevision - sourceRevision
      && sha256(meta.validationSummary.sourceIds) === sha256(sourceIds)
      && Number.isSafeInteger(meta.validationSummary.evidenceBindings)
      && Array.isArray(original.candidate.durableEvidenceBindings)
      && meta.validationSummary.evidenceBindings === original.candidate.durableEvidenceBindings.length
  }

  private async candidateAndLocatorsStillValid(persisted: PersistedCandidate, snapshot: ThemeFrameworkKnowledgeSnapshot): Promise<boolean> {
    try {
      const bindings = persisted.candidate.durableEvidenceBindings
      if (!Array.isArray(bindings) || !Array.isArray(persisted.evidence)) return false
      const boundById = new Map(bindings.map((binding) => [binding.evidenceId, binding]))
      if (boundById.size !== bindings.length || persisted.evidence.length !== bindings.length) return false
      for (const view of persisted.evidence) {
        const binding = boundById.get(view.evidenceId)
        if (!binding || binding.sourceRef !== view.sourceRef) return false
      }
      const framework = persisted.candidate.framework
      if (!framework || !Array.isArray(framework.industryCandidates) || !Array.isArray(framework.relationCandidates)
        || !isRecord(framework.proposedDefinition)) return false
      const refs: string[] = [
        ...(Array.isArray(framework.proposedDefinition.evidenceRefs) ? framework.proposedDefinition.evidenceRefs : []),
        ...framework.industryCandidates.flatMap((item) => Array.isArray(item.evidenceRefs) ? item.evidenceRefs : []),
        ...framework.relationCandidates.flatMap((item) => Array.isArray(item.evidenceRefs) ? item.evidenceRefs : []),
      ]
      if (refs.some((ref) => typeof ref !== 'string' || !boundById.has(ref))) return false
      const currentBindings = await this.verifyCandidateBindings(persisted.candidate, snapshot)
      if (currentBindings.bindings.length !== bindings.length || currentBindings.bindings.some((binding, index) => {
        const previous = bindings[index]
        return binding.evidenceId !== previous?.evidenceId || binding.sourceRef !== previous?.sourceRef || binding.rawRef !== previous?.rawRef || binding.locator !== (previous?.locator ?? safeEvidenceLocator)
      })) return false
      const handle = await this.registry.refresh(this.root)
      for (const binding of bindings) {
        const locator = binding.locator?.trim()
        if (!binding.evidenceId.startsWith('raw-evidence-')) continue
        if (!locator || locator === safeEvidenceLocator || themeFrameworkRawEvidenceId(binding.sourceRef, binding.rawRef, locator) !== binding.evidenceId) return false
        const raw = await getRaw(handle, binding.rawRef)
        const verified = await verifyRaw(handle, binding.rawRef)
        if (verified.rawRef !== binding.rawRef || verified.contentHash !== raw.manifest.contentHash) return false
        const parsed = await this.resolveRawEvidence(binding.rawRef, binding.sourceRef, verified.originalPath)
        if (!parsed.bodyAvailable || !parsed.excerpts.some((excerpt) => excerpt.blockId === locator)) return false
      }
      const latest = await this.registry.refresh(this.root)
      return latest.knowledgeBaseId === snapshot.knowledgeBaseId && latest.revision === snapshot.revision
    } catch { return false }
  }

  /** Prove exactly one completed raw Source Gateway Writer receipt for every revision in the gap. */
  private async verifySourceOnlyRevisionChain(handle: KnowledgeBaseHandle, sourceRevision: number): Promise<readonly string[]> {
    const rootReal = await realpath(handle.rootRef)
    const logsPath = join(handle.rootRef, 'logs')
    const logsStat = await lstat(logsPath).catch(() => undefined)
    if (!logsStat || logsStat.isSymbolicLink() || !logsStat.isDirectory() || !inside(rootReal, await realpath(logsPath))) throw new Error('Writer log root is unavailable or unsafe')
    const directory = join(logsPath, 'research')
    const directoryStat = await lstat(directory).catch(() => undefined)
    if (!directoryStat || directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || !inside(rootReal, await realpath(directory))) throw new Error('Writer log directory is unavailable or unsafe')
    const logNames: string[] = []
    const dir = await opendir(directory)
    for await (const entry of dir) {
      if (logNames.length >= MAX_WRITER_LOG_FILES) throw new Error('Writer log directory exceeds bounded scan limit')
      if (entry.name.endsWith('.yaml')) {
        if (!entry.isFile()) throw new Error('Writer log entry is not a regular file')
        logNames.push(entry.name)
      }
    }
    const byRevision = new Map<number, { readonly workflowRunId: string; readonly createdIds: readonly string[] }[]>()
    for (const name of logNames) {
      const path = join(directory, name)
      const before = await lstat(path)
      if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_WRITER_LOG_BYTES || !inside(rootReal, await realpath(path))) throw new Error('Writer log file is unsafe or oversized')
      const file = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      let parsed: unknown
      try {
        const opened = await file.stat()
        if (!opened.isFile() || !sameFile(before, opened) || opened.size > MAX_WRITER_LOG_BYTES) throw new Error('Writer log changed while opening')
        const chunks: Buffer[] = []
        let total = 0
        const chunk = Buffer.allocUnsafe(16 * 1024)
        while (true) {
          const remaining = MAX_WRITER_LOG_BYTES + 1 - total
          if (remaining <= 0) throw new Error('Writer log exceeds bounded read limit')
          const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, remaining), null)
          if (bytesRead === 0) break
          chunks.push(Buffer.from(chunk.subarray(0, bytesRead)))
          total += bytesRead
        }
        const bytes = Buffer.concat(chunks)
        const finished = await file.stat()
        const after = await lstat(path)
        if (!sameFile(opened, finished) || finished.size !== bytes.byteLength || !sameFile(finished, after) || after.isSymbolicLink() || !inside(rootReal, await realpath(path))) throw new Error('Writer log changed while reading')
        parsed = parseYaml(new TextDecoder('utf-8', { fatal: true }).decode(bytes), path)
      } finally { await file.close() }
      if (!isRecord(parsed)) throw new Error('Writer log is malformed')
      const committedRevision = parsed.committedRevision
      if (!Number.isSafeInteger(committedRevision) || (committedRevision as number) < 1) throw new Error('Writer log revision is malformed')
      if ((committedRevision as number) <= sourceRevision) continue
      if ((committedRevision as number) > handle.revision) throw new Error('Writer log is newer than the active Knowledge Base revision')
      if (parsed.knowledgeBaseId !== handle.knowledgeBaseId || parsed.schemaVersionAtExecution !== '0.4'
        || typeof parsed.workflowRunId !== 'string' || !validRunId(parsed.workflowRunId) || name !== `${parsed.workflowRunId}.yaml`
        || typeof parsed.changeSetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(parsed.changeSetId)
        || typeof parsed.changeSetHash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(parsed.changeSetHash)
        || !isRecord(parsed.changes) || !Array.isArray(parsed.changes.createdIds)
        || parsed.changes.createdIds.some((id) => typeof id !== 'string' || !id.startsWith('source:'))
        || !Array.isArray(parsed.changes.updatedIds)) throw new Error('Writer receipt fields are malformed or inconsistent')
      if (parsed.writeStatus === 'no_changes') {
        if (parsed.status !== 'completed' || parsed.changes.createdIds.length !== 0 || parsed.changes.updatedIds.length !== 0) throw new Error('No-change Writer record conflicts with its change inventory')
        continue
      }
      if ((committedRevision as number) <= sourceRevision || (committedRevision as number) > handle.revision) continue
      if (parsed.status !== 'completed' || parsed.writeStatus !== 'committed'
        || !isRecord(parsed.ingestionContext) || parsed.ingestionContext.workflowRunId !== parsed.workflowRunId || parsed.ingestionContext.producerType !== 'raw_document_source_gateway'
        || typeof parsed.themeScopeReverseIndexChecksum !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(parsed.themeScopeReverseIndexChecksum)
        || parsed.changes.createdIds.length === 0 || parsed.changes.updatedIds.length !== 0) throw new Error('Writer receipt is not a verified Source-only Gateway commit')
      const receipts = byRevision.get(committedRevision as number) ?? []
      receipts.push({ workflowRunId: parsed.workflowRunId, createdIds: parsed.changes.createdIds as string[] })
      byRevision.set(committedRevision as number, receipts)
    }
    const sourcesAdded: string[] = []
    const createdAcrossChain = new Set<string>()
    const assets = await readCanonicalV04Assets(handle.rootRef)
    const sourceAssets = new Map<string, KnowledgeSourceV04>(assets.objects.filter((item) => item.kind === 'source').map((item) => [item.value.id, item.value as KnowledgeSourceV04]))
    for (let revision = sourceRevision + 1; revision <= handle.revision; revision += 1) {
      const matches = byRevision.get(revision) ?? []
      if (matches.length !== 1) throw new Error(`Revision ${revision} does not have exactly one Writer receipt`)
      for (const sourceId of matches[0]!.createdIds) {
        if (createdAcrossChain.has(sourceId)) throw new Error('Source creation is duplicated across Writer receipts')
        createdAcrossChain.add(sourceId)
        const source = sourceAssets.get(sourceId)
        if (!source || !Array.isArray(source.rawRefs) || source.rawRefs.length === 0) throw new Error('Created Source or its Raw binding is missing')
        for (const rawRef of source.rawRefs) {
          const raw = await getRaw(handle, rawRef)
          const verified = await verifyRaw(handle, rawRef)
          if (raw.manifest.rawRef !== rawRef || verified.rawRef !== rawRef || verified.contentHash !== raw.manifest.contentHash) throw new Error('Created Source Raw failed integrity verification')
        }
        sourcesAdded.push(sourceId)
      }
    }
    const final = await this.registry.refresh(this.root)
    if (final.knowledgeBaseId !== handle.knowledgeBaseId || final.revision !== handle.revision) throw new Error('Knowledge Base changed while verifying revision chain')
    return sourcesAdded.sort()
  }

  /** Verify candidate bindings directly against canonical Source/Raw, independent of the bounded prompt-evidence projection. */
  private async verifyCandidateBindings(candidate: ThemeFrameworkReviewCandidate, snapshot: ThemeFrameworkKnowledgeSnapshot): Promise<{ readonly bindings: readonly ThemeFrameworkDurableEvidenceBinding[]; readonly evidence: readonly SafeEvidenceView[] }> {
    if (!Array.isArray(candidate.durableEvidenceBindings) || candidate.durableEvidenceBindings.length > MAX_CANDIDATE_BINDINGS) throw new ApplicationServiceError('conflict', 'Candidate evidence binding count is invalid')
    const handle = await this.registry.refresh(this.root)
    if (handle.knowledgeBaseId !== snapshot.knowledgeBaseId || handle.revision !== snapshot.revision || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') throw new ApplicationServiceError('conflict', 'Knowledge Base changed during evidence binding verification')
    const assets = await readCanonicalV04Assets(handle.rootRef)
    const sources = new Map(assets.objects.filter((item) => item.kind === 'source').map((item) => [item.value.id, item.value as KnowledgeSourceV04]))
    const result: ThemeFrameworkDurableEvidenceBinding[] = []
    const views: SafeEvidenceView[] = []
    const evidenceIds = new Set<string>()
    const evaluatedAt = Date.parse(this.clock())
    for (const binding of candidate.durableEvidenceBindings) {
      if (!binding || typeof binding.evidenceId !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,79}$/u.test(binding.evidenceId) || evidenceIds.has(binding.evidenceId)
        || typeof binding.sourceRef !== 'string' || !/^source:[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/u.test(binding.sourceRef)
        || typeof binding.rawRef !== 'string' || !/^raw-sha256-[a-f0-9]{64}$/u.test(binding.rawRef)) throw new ApplicationServiceError('conflict', 'Candidate evidence binding identity is invalid')
      const source = sources.get(binding.sourceRef)
      const locator = binding.locator?.trim()
      if (!source || !eligibleSource(source, evaluatedAt) || !(source.rawRefs ?? []).includes(binding.rawRef as `raw-sha256-${string}`)
        || (locator !== undefined && (locator.length === 0 || locator.length > 2048 || /[\u0000-\u001f\u007f]/u.test(locator)))) throw new ApplicationServiceError('conflict', 'Candidate Source/Raw binding is no longer eligible')
      const rawRecord = await getRaw(handle, binding.rawRef)
      if (rawRecord.manifest.sizeBytes > MAX_VERIFIED_RAW_BYTES) throw new ApplicationServiceError('conflict', 'Candidate Raw object exceeds the verification size limit')
      const raw = await verifyRaw(handle, binding.rawRef)
      if (raw.manifest.rawRef !== binding.rawRef) throw new ApplicationServiceError('conflict', 'Candidate Raw identity did not verify')
      const sourceSummary = safeDisplayText([source.title.trim(), source.publisher?.trim()].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' — ')).slice(0, 500)
      if (!sourceSummary) throw new ApplicationServiceError('conflict', 'Candidate Source summary is unavailable')
      const excerpt = this.cachedRawExcerpt(binding.rawRef, locator)
      const summary = excerpt
        ? safeDisplayText(`${sourceSummary} — body excerpt (block=${excerpt.blockId}; page=${excerpt.page ?? 'unknown'}; section=${excerpt.sectionTitle ?? 'unlabeled'}): ${excerpt.excerpt}`).slice(0, 500)
        : sourceSummary
      const verifiedBinding = { ...binding, locator: locator ?? safeEvidenceLocator }
      result.push(verifiedBinding)
      views.push({ evidenceId: binding.evidenceId, summary, sourceRef: binding.sourceRef })
      evidenceIds.add(binding.evidenceId)
    }
    const final = await this.registry.refresh(this.root)
    if (final.knowledgeBaseId !== snapshot.knowledgeBaseId || final.revision !== snapshot.revision) throw new ApplicationServiceError('conflict', 'Knowledge Base changed during evidence binding verification')
    return { bindings: result, evidence: views }
  }

  private projectCandidate(value: PersistedCandidate): NonNullable<ThemeFrameworkReviewCandidateView['candidate']> {
    const { candidate, evidence } = value
    return {
      knowledgeBaseId: candidate.knowledgeBaseId,
      basedOnRevision: candidate.basedOnRevision,
      theme: safeProjection(candidate.theme),
      framework: safeProjection(candidate.framework),
      acquisitionStatus: candidate.acquisitionStatus,
      diagnostics: diagnosticProjection(candidate.diagnostics),
      evidence,
      ...(value.refresh ? { refresh: value.refresh } : {}),
    }
  }

  private projectReceipt(value: { themeRef?: unknown; committedRevision?: unknown; decisionCount?: unknown }): NonNullable<ThemeFrameworkReviewCandidateView['receipt']> {
    if (typeof value.themeRef !== 'string' || !Number.isSafeInteger(value.committedRevision) || !Number.isSafeInteger(value.decisionCount)) throw new ApplicationServiceError('conflict', 'Persisted Theme Framework receipt is invalid')
    return { themeRef: value.themeRef, committedRevision: value.committedRevision as number, decisionCount: value.decisionCount as number }
  }

  private projectAction(result: ThemeFrameworkReviewResult): ThemeFrameworkActionResult {
    if (result.status === 'committed' || result.status === 'already_committed') return { status: result.status, workflowRunId: result.workflowRunId, themeRef: result.themeRef, committedRevision: result.committedRevision, decisionCount: result.decisions.length }
    if (result.status === 'rejected') return { status: 'rejected', workflowRunId: result.workflowRunId }
    return { status: result.status, workflowRunId: result.workflowRunId, diagnostics: safeDiagnostics(result) }
  }

  private validateDecisions(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, 'include' | 'exclude' | 'pending'>> {
    if (value === undefined) return {}
    if (!isRecord(value) || Object.keys(value).length > 160) throw new ApplicationServiceError('invalid_input', 'decisions must be a bounded candidate-decision map')
    const result: Record<string, 'include' | 'exclude' | 'pending'> = {}
    for (const [candidateId, decision] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/u.test(candidateId) || (decision !== 'include' && decision !== 'exclude' && decision !== 'pending')) throw new ApplicationServiceError('invalid_input', 'decisions contain an invalid candidate ID or review value')
      result[candidateId] = decision
    }
    return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
  }

  private requireRunId(value: string): void {
    if (!validRunId(value)) throw new ApplicationServiceError('invalid_input', 'workflowRunId is invalid')
  }

  private eventPath(runId: string, type: EventType, base = this.root): string {
    this.requireRunId(runId)
    if (!isEventType(type)) throw new ApplicationServiceError('invalid_input', 'Review event type is invalid')
    return join(base, THEME_FRAMEWORK_REVIEW_STORE_LIMITS.directory, `${runId}.${type}.json`)
  }

  private async ensureReviewDirectory(): Promise<{ readonly directory: string; readonly rootReal: string }> {
    const rootStat = await lstat(this.root).catch(() => undefined)
    if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new ApplicationServiceError('failed', 'Mounted Knowledge Base root is unsafe')
    const rootReal = await realpath(this.root)
    let current = rootReal
    for (const part of ['logs', 'theme-framework', 'reviews']) {
      current = join(current, part)
      try { await mkdir(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ApplicationServiceError('failed', 'Theme Framework review directory is unavailable', { cause: error }) }
      const stat = await lstat(current).catch(() => undefined)
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new ApplicationServiceError('failed', 'Theme Framework review directory is unsafe')
      const actual = await realpath(current)
      if (!inside(rootReal, actual)) throw new ApplicationServiceError('failed', 'Theme Framework review directory escapes the Knowledge Base root')
    }
    return { directory: current, rootReal }
  }

  private async writeEvent<T>(runId: string, type: EventType, payload: T): Promise<void> {
    const { directory, rootReal } = await this.ensureReviewDirectory()
    const target = this.eventPath(runId, type, rootReal)
    if (!inside(rootReal, target)) throw new ApplicationServiceError('failed', 'Theme Framework review snapshot path is unsafe')
    const bytes = Buffer.from(JSON.stringify(envelope(type, runId, payload)), 'utf8')
    if (bytes.byteLength > THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxSnapshotBytes) throw new ApplicationServiceError('failed', 'Theme Framework review snapshot exceeds the size limit')
    const existing = await lstat(target).catch(() => undefined)
    if (existing) throw new ApplicationServiceError('conflict', 'Theme Framework review event already exists')
    const temporary = join(directory, `.${runId}.${type}.${randomUUID()}.tmp`)
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      file = await open(temporary, 'wx', 0o600)
      await file.writeFile(bytes)
      await file.sync()
      await file.close()
      file = undefined
      const tempStat = await lstat(temporary)
      if (!tempStat.isFile() || tempStat.isSymbolicLink() || tempStat.size !== bytes.byteLength || !samePath(await realpath(temporary), temporary)) throw new ApplicationServiceError('failed', 'Temporary review snapshot is unsafe')
      const latest = await this.ensureReviewDirectory()
      if (latest.directory !== directory || latest.rootReal !== rootReal) throw new ApplicationServiceError('failed', 'Review directory changed during snapshot write')
      await link(temporary, target)
      await unlink(temporary)
      const finalStat = await lstat(target)
      if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.size !== bytes.byteLength || !samePath(await realpath(target), target)) throw new ApplicationServiceError('failed', 'Written review snapshot is unsafe')
    } catch (error) {
      await file?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      if (error instanceof ApplicationServiceError) throw error
      throw new ApplicationServiceError('failed', 'Theme Framework review snapshot could not be persisted', { cause: error })
    }
  }

  private async readEvent<T = unknown>(runId: string, type: EventType): Promise<Envelope<T> | undefined> {
    const { rootReal } = await this.ensureReviewDirectory()
    const path = this.eventPath(runId, type, rootReal)
    if (!inside(rootReal, path)) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot path is unsafe')
    const before = await lstat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined
      throw error
    })
    if (!before) return undefined
    if (before.isSymbolicLink() || !before.isFile() || before.size > THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxSnapshotBytes) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot is unsafe or oversized')
    const file = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch((error: unknown) => { throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot could not be opened safely', { cause: error }) })
    try {
      const opened = await file.stat()
      if (!opened.isFile() || !sameFile(before, opened) || opened.size > THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxSnapshotBytes) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot changed while opening')
      const chunks: Buffer[] = []
      const chunk = Buffer.allocUnsafe(16 * 1024)
      let total = 0
      while (true) {
        const remaining = THEME_FRAMEWORK_REVIEW_STORE_LIMITS.maxSnapshotBytes + 1 - total
        if (remaining <= 0) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot exceeds the size limit')
        const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, remaining), null)
        if (bytesRead === 0) break
        chunks.push(Buffer.from(chunk.subarray(0, bytesRead)))
        total += bytesRead
      }
      const finished = await file.stat()
      const after = await lstat(path)
      if (!sameFile(opened, finished) || finished.size !== total || !sameFile(finished, after) || after.isSymbolicLink() || !after.isFile() || !samePath(await realpath(path), path)) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot changed while reading')
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!validEnvelope(parsed, type, runId)) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot checksum is invalid')
      return parsed as Envelope<T>
    } catch (error) {
      if (error instanceof ApplicationServiceError) throw error
      throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot is malformed', { cause: error })
    } finally { await file.close() }
  }

  private async readTerminal(runId: string): Promise<Envelope<unknown> | undefined> {
    for (const type of ['committed', 'rejected', 'stale', 'blocked', 'failed', 'cancelled'] as const) {
      const event = await this.readEvent(runId, type)
      if (event) return event
    }
    return undefined
  }

  private async removeEvent(runId: string, type: EventType): Promise<void> {
    const { rootReal } = await this.ensureReviewDirectory()
    const path = this.eventPath(runId, type, rootReal)
    if (!inside(rootReal, path)) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot path is unsafe')
    const stat = await lstat(path).catch((error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error))
    if (!stat) return
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ApplicationServiceError('conflict', 'Theme Framework review snapshot is unsafe')
    await unlink(path)
  }

  private async serialize<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const queued = previous.then(() => current)
    this.locks.set(runId, queued)
    await previous
    try { return await operation() }
    finally { release(); if (this.locks.get(runId) === queued) this.locks.delete(runId) }
  }
}

function sameFile(left: { dev: number | bigint; ino: number | bigint; size: number | bigint; mtimeMs: number; ctimeMs: number }, right: { dev: number | bigint; ino: number | bigint; size: number | bigint; mtimeMs: number; ctimeMs: number }): boolean {
  return left.dev === right.dev && (left.ino === 0 || left.ino === 0n || right.ino === 0 || right.ino === 0n
    ? left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    : left.ino === right.ino)
}

function combineSignals(...signals: (AbortSignal | undefined)[]): { readonly signal?: AbortSignal; dispose(): void } {
  const defined = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (defined.length === 0) return { dispose: () => undefined }
  if (defined.length === 1) return { signal: defined[0], dispose: () => undefined }
  const controller = new AbortController()
  const abort = () => controller.abort()
  const attached: AbortSignal[] = []
  for (const signal of defined) {
    if (signal.aborted) controller.abort()
    else { signal.addEventListener('abort', abort, { once: true }); attached.push(signal) }
  }
  return { signal: controller.signal, dispose: () => { for (const signal of attached) signal.removeEventListener('abort', abort) } }
}
