import { access, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeCurationSkill } from '../../skills/knowledge-curation/skill.ts'
import { runRawDocumentKnowledgeIngestion } from '../../workflows/raw-document-knowledge-ingestion/workflow.ts'
import type { IngestionWorkflowResult } from '../../workflows/raw-document-knowledge-ingestion/contracts.ts'
import { runRawDocumentKnowledgePreviewV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { RawDocumentCandidateGroupV04, RawDocumentPreviewSnapshotStoreV04, RawDocumentPreviewWorkflowResultV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import { acceptRawDocumentV04Candidates } from '../../workflows/raw-document-knowledge-ingestion/v04-candidate-acceptance.ts'
import type { RawDocumentV04CandidateAcceptanceResult } from '../../workflows/raw-document-knowledge-ingestion/v04-candidate-acceptance.ts'
import { readRawDocumentV04PreviewSnapshot } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import type { RawDocumentV04CandidatePreviewSnapshot } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { DocumentInputRef } from '../../plugins/document/contracts.ts'
import type { DocumentInputResolverV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { RawDocumentRightsV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { ApplicationServiceError, type ApplicationProductionResult, type ApplicationRawDocumentPreviewAcceptanceInput, type ApplicationRawDocumentPreviewV04, type IngestDocumentInput, type RawDocumentPreviewV04Input } from './contracts.ts'
import { WorkflowService, type WorkflowOutcome } from './workflow-service.ts'
import { triggerThemeScopeImpactPostWrite, type ThemeScopeImpactChecker, type ThemeScopeImpactTriggerResult } from '../../workflows/theme-scope-impact-check/post-write.ts'

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_DOCUMENT_TEXT_BYTES = 2_000_000
const V04_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
function inside(root: string, candidate: string): boolean { const rel = relative(resolve(root), resolve(candidate)); return rel === '' || (rel !== '..' && !rel.startsWith(`..${'\\'}`) && !rel.startsWith(`..${'/'}`)) }
function combineSignals(left: AbortSignal | undefined, right: AbortSignal): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController(); const abort = () => controller.abort()
  if (left?.aborted || right.aborted) controller.abort()
  left?.addEventListener('abort', abort, { once: true }); right.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, dispose: () => { left?.removeEventListener('abort', abort); right.removeEventListener('abort', abort) } }
}
function cancellationResult(runId: string): ApplicationProductionResult { return { runId, status: 'cancelled', reviewCount: 0, reviewCaseIds: [], summary: 'Workflow was cancelled before canonical commit' } }

export interface ProductionServiceOptions {
  readonly mountedKnowledgeBaseRoot?: string
  readonly workspaceRoot?: string
  readonly cwd?: string
  readonly reasoningExecutor: ReasoningExecutor
  readonly workflowService: WorkflowService
  readonly workflowRunner?: typeof runRawDocumentKnowledgeIngestion
  readonly rawDocumentPreviewRunner?: typeof runRawDocumentKnowledgePreviewV04
  readonly rawDocumentCandidateAcceptanceRunner?: typeof acceptRawDocumentV04Candidates
  readonly rawDocumentPreviewDocumentResolver?: DocumentInputResolverV04
  readonly rawDocumentPreviewSnapshotStore?: RawDocumentPreviewSnapshotStoreV04
  readonly themeScopeImpactChecker?: ThemeScopeImpactChecker
}

export class ProductionService {
  private readonly registry = new KnowledgeBaseRegistry()
  private readonly rawDocumentPreviewResults = new Map<string, ApplicationRawDocumentPreviewV04>()
  private readonly workspaceRoot: string
  constructor(private readonly options: ProductionServiceOptions) { this.workspaceRoot = resolve(options.workspaceRoot ?? join(options.cwd ?? process.cwd(), 'workspace')) }
  startIngestDocument(input: IngestDocumentInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationProductionResult> } {
    if (!this.options.mountedKnowledgeBaseRoot) throw new ApplicationServiceError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    if (!input || typeof input.workflowRunId !== 'string' || !SAFE_RUN_ID.test(input.workflowRunId)) throw new ApplicationServiceError('invalid_input', 'workflowRunId must be a safe deterministic identifier')
    const hasText = typeof input.text === 'string'
    const hasFile = typeof input.workspaceFile === 'string'
    if (hasText === hasFile) throw new ApplicationServiceError('invalid_input', 'Exactly one of text or workspaceFile is required')
    if (hasText && (input.text!.trim() === '' || Buffer.byteLength(input.text!, 'utf8') > MAX_DOCUMENT_TEXT_BYTES)) throw new ApplicationServiceError('invalid_input', 'text must be non-empty and at most 2 MB')
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'raw_document_knowledge_ingestion', objective: input.originalFilename ?? input.workspaceFile ?? 'ResearchHub document ingestion' })
    const onCallerAbort = () => { try { this.options.workflowService.cancelWorkflow(input.workflowRunId) } catch { /* the run may already be terminal */ } }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    const completion = this.options.workflowService.start(input.workflowRunId, async (activeSignal): Promise<WorkflowOutcome & { readonly workflow: IngestionWorkflowResult }> => {
      const combined = combineSignals(callerSignal, activeSignal)
      try {
        if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled before start')
        const handle = await this.registry.mount(this.options.mountedKnowledgeBaseRoot!)
        const documentInput = hasText
          ? { type: 'text' as const, text: input.text!, originalFilename: input.originalFilename ?? 'researchhub-prompt.txt', mediaType: input.mediaType ?? 'text/plain' }
          : { type: 'file' as const, reference: await this.resolveWorkspaceFile(input.workspaceFile!) }
        const executor: ReasoningExecutor = { capabilities: () => this.options.reasoningExecutor.capabilities(), execute: async (request) => {
          if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled')
          const signalAware = this.options.reasoningExecutor as ReasoningExecutor & { execute(request: Parameters<ReasoningExecutor['execute']>[0], signal?: AbortSignal): ReturnType<ReasoningExecutor['execute']> }
          const response = await signalAware.execute(request, combined.signal)
          if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled')
          return response
        } }
        const workflow = await (this.options.workflowRunner ?? runRawDocumentKnowledgeIngestion)({ handle, documentInput, skill: new KnowledgeCurationSkill({ executor }), workflowRunId: input.workflowRunId, instructions: input.instructions, sourceMetadata: input.sourceMetadata, signal: combined.signal })
        if (workflow.status === 'completed' || workflow.status === 'completed_with_review') {
          assertTerminalReviewCaseInvariant(workflow)
          const reviewCount = workflow.reviewCases?.length ?? 0
          this.options.workflowService.markAuthoritativeTerminal(input.workflowRunId, workflow.status, { summary: summaryFor(workflow), reviewCount, errorSummary: workflow.errors.length > 0 ? workflow.errors.join('; ').slice(0, 500) : undefined })
          return { status: workflow.status, summary: summaryFor(workflow), reviewCount, errorSummary: workflow.errors.length > 0 ? workflow.errors.join('; ').slice(0, 500) : undefined, workflow }
        }
        if (combined.signal.aborted || activeSignal.aborted || callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled')
        return { status: workflow.status, summary: summaryFor(workflow), reviewCount: workflow.reviewCases?.length ?? 0, errorSummary: workflow.errors.length > 0 ? workflow.errors.join('; ').slice(0, 500) : undefined, workflow }
      } finally { combined.dispose() }
    }).then((outcome) => projectResult(input.workflowRunId, outcome.workflow)).catch((error) => error instanceof ApplicationServiceError && error.code === 'cancelled' ? cancellationResult(input.workflowRunId) : Promise.reject(error)).finally(() => callerSignal?.removeEventListener('abort', onCallerAbort))
    if (callerSignal?.aborted) this.options.workflowService.cancelWorkflow(input.workflowRunId)
    // A browser request may intentionally abandon the completion promise. Mark the
    // returned promise as observed while preserving its rejection for callers that
    // do await it; the runtime also attaches its own lifecycle handler.
    completion.catch(() => undefined)
    return { runId: input.workflowRunId, completion }
  }
  async ingestDocument(input: IngestDocumentInput, callerSignal?: AbortSignal): Promise<ApplicationProductionResult> {
    return this.startIngestDocument(input, callerSignal).completion
  }
  startRawDocumentKnowledgePreviewV04(input: RawDocumentPreviewV04Input, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationRawDocumentPreviewV04> } {
    if (!this.options.mountedKnowledgeBaseRoot) throw new ApplicationServiceError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    if (!input || typeof input.workflowRunId !== 'string' || !V04_RUN_ID.test(input.workflowRunId)) throw new ApplicationServiceError('invalid_input', 'workflowRunId must be a safe V0.4 workflow identifier')
    const hasText = typeof input.text === 'string'
    const hasFile = typeof input.workspaceFile === 'string'
    if (hasText === hasFile) throw new ApplicationServiceError('invalid_input', 'Exactly one of text or workspaceFile is required')
    if (hasText && (input.text!.trim() === '' || Buffer.byteLength(input.text!, 'utf8') > MAX_DOCUMENT_TEXT_BYTES)) throw new ApplicationServiceError('invalid_input', 'text must be non-empty and at most 2 MB')
    validateRights(input.rights)
    if (!input.sourceMetadata || typeof input.sourceMetadata !== 'object' || Array.isArray(input.sourceMetadata)) throw new ApplicationServiceError('invalid_input', 'sourceMetadata must be supplied as an object')
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'raw_document_knowledge_preview_v04', objective: input.originalFilename ?? input.workspaceFile ?? 'ResearchHub V0.4 document preview' })
    const onCallerAbort = () => { try { this.options.workflowService.cancelWorkflow(input.workflowRunId) } catch { /* the run may already be terminal */ } }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    const completion = this.options.workflowService.start(input.workflowRunId, async (activeSignal): Promise<WorkflowOutcome & { readonly workflow: RawDocumentPreviewWorkflowResultV04 }> => {
      const combined = combineSignals(callerSignal, activeSignal)
      try {
        if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled before start')
        const handle = await this.registry.mount(this.options.mountedKnowledgeBaseRoot!)
        const documentInput: DocumentInputRef = hasText
          ? { type: 'text', text: input.text!, originalFilename: input.originalFilename ?? 'researchhub-prompt.txt', mediaType: input.mediaType ?? 'text/plain' }
          : { type: 'file', reference: await this.resolveWorkspaceFile(input.workspaceFile!) }
        const executor: ReasoningExecutor = { capabilities: () => this.options.reasoningExecutor.capabilities(), execute: async (request) => {
          if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled')
          const signalAware = this.options.reasoningExecutor as ReasoningExecutor & { execute(request: Parameters<ReasoningExecutor['execute']>[0], signal?: AbortSignal): ReturnType<ReasoningExecutor['execute']> }
          const response = await signalAware.execute(request, combined.signal)
          if (combined.signal.aborted) throw new ApplicationServiceError('cancelled', 'Workflow was cancelled')
          return response
        } }
        const workflow = await (this.options.rawDocumentPreviewRunner ?? runRawDocumentKnowledgePreviewV04)({
          handle,
          documentInput,
          skill: new KnowledgeCurationSkill({ executor }),
          workflowRunId: input.workflowRunId,
          rights: input.rights,
          sourceMetadata: input.sourceMetadata,
          ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
          ...(this.options.rawDocumentPreviewDocumentResolver === undefined ? {} : { documentResolver: this.options.rawDocumentPreviewDocumentResolver }),
          ...(this.options.rawDocumentPreviewSnapshotStore === undefined ? {} : { previewSnapshotStore: this.options.rawDocumentPreviewSnapshotStore }),
          signal: combined.signal,
        })
        const status: WorkflowOutcome['status'] = workflow.status === 'cancelled' ? 'cancelled'
          : workflow.status === 'blocked' || workflow.status === 'incompatible_schema' || workflow.status === 'source_only' ? 'blocked'
            : workflow.status === 'preview_partial' ? 'completed_with_review' : 'completed'
        const summary = previewSummary(workflow)
        if (status !== 'cancelled') this.options.workflowService.markAuthoritativeTerminal(input.workflowRunId, status, { summary, ...(status === 'blocked' ? { errorSummary: summary } : {}) })
        return { status, summary, workflow }
      } catch (error) {
        if (combined.signal.aborted || activeSignal.aborted || callerSignal?.aborted) throw new ApplicationServiceError('cancelled', 'V0.4 raw-document preview was cancelled')
        throw new ApplicationServiceError('failed', 'V0.4 raw-document preview failed during a bounded processing stage')
      } finally { combined.dispose() }
    }).then(async ({ workflow }) => {
      const provisional = projectV04Preview(input.workflowRunId, workflow)
      const verified = workflow.previewSnapshot.committable ? await this.readRawDocumentKnowledgePreviewV04(input.workflowRunId) : undefined
      const result = verified ?? (provisional.committable ? { ...provisional, committable: false, candidateGroups: [], statusNote: 'Durable preview verification was unavailable.' } : provisional)
      this.rawDocumentPreviewResults.set(input.workflowRunId, result)
      return result
    }).catch((error) => {
      if (error instanceof ApplicationServiceError && error.code === 'cancelled') {
        const result = cancelledV04Preview(input.workflowRunId)
        this.rawDocumentPreviewResults.set(input.workflowRunId, result)
        return result
      }
      return Promise.reject(error)
    }).finally(() => callerSignal?.removeEventListener('abort', onCallerAbort))
    if (callerSignal?.aborted) this.options.workflowService.cancelWorkflow(input.workflowRunId)
    completion.catch(() => undefined)
    return { runId: input.workflowRunId, completion }
  }
  async readRawDocumentKnowledgePreviewV04(workflowRunId: string): Promise<ApplicationRawDocumentPreviewV04 | undefined> {
    if (!this.options.mountedKnowledgeBaseRoot) throw new ApplicationServiceError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    if (!V04_RUN_ID.test(workflowRunId)) throw new ApplicationServiceError('invalid_input', 'workflowRunId is invalid')
    const inMemoryResult = this.rawDocumentPreviewResults.get(workflowRunId)
    let handle: KnowledgeBaseHandle
    try { handle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot) }
    catch { return nonCommittablePreview(inMemoryResult, 'The mounted Knowledge Base could not be verified.') }
    if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active' || !handle.writable) return nonCommittablePreview(inMemoryResult, 'The mounted Knowledge Base is not active Schema 0.4 / Storage Format 1.')
    let snapshot: RawDocumentV04CandidatePreviewSnapshot | undefined
    try { snapshot = await readRawDocumentV04PreviewSnapshot(handle, workflowRunId) }
    catch { return nonCommittablePreview(inMemoryResult, 'The durable preview could not be verified against Source and Raw.') }
    if (!snapshot) return nonCommittablePreview(inMemoryResult, 'No verified durable candidate preview exists for this run.')
    const workflow = this.options.workflowService.getWorkflowStatus(workflowRunId)
    const workflowAllowsCommit = workflow === undefined || workflow.status === 'completed' || workflow.status === 'completed_with_review' || workflow.status === 'cancelled'
    const projected = projectV04Snapshot(workflowRunId, snapshot, handle, workflowAllowsCommit)
    return workflow?.status === 'cancelled'
      ? { ...projected, statusNote: 'The Workflow was cancelled; the durable preview persisted later and passed read-back verification.' }
      : projected
  }
  async acceptRawDocumentV04Candidates(input: ApplicationRawDocumentPreviewAcceptanceInput): Promise<RawDocumentV04CandidateAcceptanceResult & { readonly themeScopeImpact: ThemeScopeImpactTriggerResult }> {
    if (!this.options.mountedKnowledgeBaseRoot) throw new ApplicationServiceError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    if (!input || !V04_RUN_ID.test(input.previewWorkflowRunId)) throw new ApplicationServiceError('invalid_input', 'previewWorkflowRunId is invalid')
    if (!Array.isArray(input.acceptedCandidateIds) || input.acceptedCandidateIds.length > 4096 || input.acceptedCandidateIds.some((id) => typeof id !== 'string')) throw new ApplicationServiceError('invalid_input', 'acceptedCandidateIds must be an array of at most 4096 candidate IDs')
    const handle = await this.registry.refresh(this.options.mountedKnowledgeBaseRoot)
    const result = await (this.options.rawDocumentCandidateAcceptanceRunner ?? acceptRawDocumentV04Candidates)({ handle, previewWorkflowRunId: input.previewWorkflowRunId, acceptedCandidateIds: [...input.acceptedCandidateIds] })
    const successfulWrite = result.status === 'committed' || result.status === 'already_committed'
    const hasChanges = result.createdIds.length + result.updatedIds.length > 0
    const themeScopeImpact = successfulWrite && hasChanges && result.producerRunId && result.changeSetId
      ? await triggerThemeScopeImpactPostWrite({ mountedKnowledgeBaseRoot: resolve(this.options.mountedKnowledgeBaseRoot), writerRunId: result.producerRunId, expectedKnowledgeBaseId: result.knowledgeBaseId, expectedCommittedRevision: result.knowledgeBaseRevision, expectedCreatedIds: result.createdIds, expectedUpdatedIds: result.updatedIds, checker: this.options.themeScopeImpactChecker })
      : { status: 'not_triggered' as const, diagnostics: [successfulWrite ? 'Raw candidate acceptance completed without canonical writes.' : 'Raw candidate acceptance did not commit canonical writes.'] }
    return { ...result, themeScopeImpact }
  }
  private async resolveWorkspaceFile(reference: string): Promise<string> {
    if (reference.trim() === '') throw new ApplicationServiceError('invalid_input', 'workspaceFile must be non-empty')
    const lexical = isAbsolute(reference) ? resolve(reference) : resolve(this.workspaceRoot, reference)
    const cwdCandidate = this.options.cwd && !inside(this.workspaceRoot, lexical) ? resolve(this.options.cwd, reference) : lexical
    const candidate = inside(this.workspaceRoot, cwdCandidate) ? cwdCandidate : lexical
    if (!inside(this.workspaceRoot, candidate) || inside(this.options.mountedKnowledgeBaseRoot!, candidate)) throw new ApplicationServiceError('invalid_input', 'workspaceFile must remain inside workspaceRoot and outside the canonical Knowledge Base')
    try { await access(candidate); const [workspaceReal, candidateReal, kbReal] = await Promise.all([realpath(this.workspaceRoot), realpath(candidate), realpath(this.options.mountedKnowledgeBaseRoot!)])
      if (!inside(workspaceReal, candidateReal) || inside(kbReal, candidateReal)) throw new ApplicationServiceError('invalid_input', 'workspaceFile symlink escapes the allowed workspace boundary')
      return candidateReal
    } catch (error) { if (error instanceof ApplicationServiceError) throw error; throw new ApplicationServiceError('invalid_input', 'workspaceFile cannot be read within the allowed workspace', { cause: error }) }
  }
}
function summaryFor(result: IngestionWorkflowResult): string { if (result.status === 'completed_with_review') return 'Document ingestion completed with ReviewCases'; if (result.status === 'blocked') return 'Document ingestion was blocked by deterministic Knowledge governance'; return 'Document ingestion completed' }
function assertTerminalReviewCaseInvariant(result: IngestionWorkflowResult): void {
  const reviewCount = result.reviewCases?.length ?? 0
  const consistent = result.status === 'completed_with_review' ? reviewCount > 0 : reviewCount === 0
  if (!consistent) throw new ApplicationServiceError('failed', 'Workflow success status is inconsistent with durable ReviewCases')
}
function projectResult(runId: string, result: IngestionWorkflowResult): ApplicationProductionResult { const reviewCaseIds = (result.reviewCases ?? []).map((item) => item.reviewCaseId).sort(); return { runId, status: result.status, knowledgeBaseId: result.knowledgeBaseId, ...(result.rawRef === undefined ? {} : { rawRef: result.rawRef }), ...(result.documentId === undefined ? {} : { documentId: result.documentId }), ...(result.changeSetId === undefined ? {} : { changeSetId: result.changeSetId }), ...(result.baseRevision === undefined ? {} : { baseRevision: result.baseRevision }), ...(result.committedRevision === undefined ? {} : { committedRevision: result.committedRevision }), reviewCount: reviewCaseIds.length, reviewCaseIds, summary: summaryFor(result), ...(result.errors.length === 0 ? {} : { errorSummary: result.errors.join('; ').slice(0, 500) }) } }

function validateRights(value: RawDocumentRightsV04): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApplicationServiceError('invalid_input', 'rights must be supplied explicitly')
  const required = ['accessScope', 'providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed', 'policyBasis']
  if (required.some((field) => !Object.hasOwn(value, field))) throw new ApplicationServiceError('invalid_input', 'rights must explicitly state access scope, terms, retention, AI processing, derived knowledge, redistribution, and policy basis')
}
function previewSummary(result: RawDocumentPreviewWorkflowResultV04): string {
  if (result.previewSnapshot.committable) return result.status === 'preview_partial' ? 'V0.4 candidate preview is durable and partially complete' : 'V0.4 candidate preview is durable and ready for explicit acceptance'
  if (result.status === 'incompatible_schema') return 'V0.4 raw-document preview is incompatible with the mounted Knowledge Base schema'
  if (result.status === 'cancelled') return 'V0.4 raw-document preview was cancelled'
  return 'V0.4 raw-document preview did not produce a committable durable candidate preview'
}
function projectV04Preview(runId: string, result: RawDocumentPreviewWorkflowResultV04): ApplicationRawDocumentPreviewV04 {
  return {
    runId,
    status: result.status,
    knowledgeBaseId: result.knowledgeBaseId,
    ...(result.provenance?.sourceRef === undefined ? {} : { sourceRef: result.provenance.sourceRef }),
    ...(result.provenance?.rawRef === undefined ? {} : { rawRef: result.provenance.rawRef }),
    ...(result.extractionPreview.documentId === undefined ? {} : { documentId: result.extractionPreview.documentId }),
    candidateGroups: result.previewSnapshot.committable ? result.extractionPreview.candidateGroups : [],
    committable: result.previewSnapshot.committable,
  }
}
function projectV04Snapshot(runId: string, snapshot: RawDocumentV04CandidatePreviewSnapshot, handle: KnowledgeBaseHandle, workflowAllowsCommit: boolean): ApplicationRawDocumentPreviewV04 {
  const validSnapshot = snapshot.version === 2 && snapshot.extractionCompleteness !== undefined
  const compatibleHandle = handle.schemaVersion === '0.4' && handle.storageFormatVersion === '1' && handle.status === 'active' && handle.writable && handle.knowledgeBaseId === snapshot.knowledgeBaseId
  const committable = validSnapshot && compatibleHandle && workflowAllowsCommit
  const candidateGroups: RawDocumentCandidateGroupV04[] = committable
    ? snapshot.candidateGroups.map((group) => ({ ...group, provenanceRefs: { sourceRef: snapshot.sourceRef, rawRef: snapshot.rawRef, evidenceBlockRefs: [...group.candidate.evidenceBlockRefs] } }))
    : []
  return { runId, status: committable ? snapshot.extractionCompleteness === 'partial' ? 'preview_partial' : 'preview_ready' : 'stale_revision', knowledgeBaseId: snapshot.knowledgeBaseId, sourceRef: snapshot.sourceRef, rawRef: snapshot.rawRef, documentId: snapshot.documentId, candidateGroups, committable, ...(snapshot.extractionCompleteness === undefined ? {} : { extractionCompleteness: snapshot.extractionCompleteness }), ...(snapshot.incompleteUnits === undefined ? {} : { incompleteUnits: snapshot.incompleteUnits.map((unit) => ({ unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, status: unit.status, errorSummary: safeUnitSummary(unit.status) })) }) }
}
function cancelledV04Preview(runId: string): ApplicationRawDocumentPreviewV04 {
  return { runId, status: 'cancelled', candidateGroups: [], committable: false }
}
function nonCommittablePreview(previous: ApplicationRawDocumentPreviewV04 | undefined, statusNote: string): ApplicationRawDocumentPreviewV04 | undefined {
  if (!previous) return undefined
  const { extractionCompleteness: _completeness, incompleteUnits: _incomplete, ...safePrevious } = previous
  return { ...safePrevious, status: previous.status === 'incompatible_schema' ? 'incompatible_schema' : previous.status === 'cancelled' ? 'cancelled' : 'source_only', committable: false, candidateGroups: [], statusNote }
}
function safeUnitSummary(status: 'failed' | 'cancelled'): string { return status === 'cancelled' ? 'Extraction unit was cancelled.' : 'Extraction unit failed; details are withheld from the preview response.' }
