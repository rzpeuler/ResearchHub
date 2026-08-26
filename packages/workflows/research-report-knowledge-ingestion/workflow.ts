import { createHash } from 'node:crypto'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import type { ConflictDecision, KnowledgeCandidate, KnowledgeMappingResult, NormalizedResearchDocument, SourceAssessment } from '../../../packages/skills/knowledge-curation/index.ts'
import { KnowledgeValidationSkill, createKnowledgeStagedStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import type { ValidationReport, ChangeSetValidationResult } from '../../../packages/skills/knowledge-validation/types.ts'
import { KnowledgeBaseLoader, KnowledgeError, KnowledgeIngestionLogStore, allocateEntityId, allocateKnowledgeId, allocateSourceId, archiveRaw, deriveRawIdentity, hashKnowledgeObject } from '../../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/index.ts'
import { KnowledgeWriter } from '../../../packages/shared/knowledge-base/write/index.ts'
import type { KnowledgeChangeSet, KnowledgeSource, KnowledgeWritableObject, ValidatedKnowledgeChangeSet, KnowledgeWriteResult } from '../../../packages/schemas/knowledge/index.ts'
import { DefaultResearchReportInputResolver } from './input-resolver.ts'
import { KnowledgeIngestionWorkflowError } from './errors.ts'
import { createKnowledgeScopeContext } from './scope-context.ts'
import type { IngestionAuditContext, IngestionTrace, KnowledgeBaseTarget, ResolvedCandidatePlan, ResearchReportKnowledgeIngestionInput, ResearchReportKnowledgeIngestionResult, ResearchReportKnowledgeIngestionWorkflowOptions, ResearchReportInputResolver } from './types.ts'

export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_ID = 'research-report-knowledge-ingestion'
export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION = '0.1'

interface ReferenceResolution { id?: string; ambiguous?: boolean }
interface ResolvedDraft { object: Record<string, unknown>; resolvedRefs: string[] }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function clone<T>(value: T): T { return structuredClone(value) }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function sameName(left: string, right: string): boolean { return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase() }
function sourceSummary(assessment: SourceAssessment | null): Record<string, unknown> { return assessment ? { sourceType: assessment.sourceType, publisher: assessment.publisher, institution: assessment.institution, publishedAt: assessment.publishedAt, sourceReliability: assessment.sourceReliability } : {} }

function stripModelIdentity(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' || key === 'knowledgeId' || key === 'sourceRefs' || key === 'rawRefs') continue
    result[key] = isRecord(child) ? stripModelIdentity(child) : Array.isArray(child) ? child.map((item) => isRecord(item) ? stripModelIdentity(item) : item) : child
  }
  return result
}

function validateInput(input: ResearchReportKnowledgeIngestionInput): void {
  if (!isRecord(input)) throw new KnowledgeIngestionWorkflowError('invalid_input', 'Workflow input must be an object', 'input_validation')
  if (typeof input.workflowRunId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || input.workflowRunId.includes('..')) throw new KnowledgeIngestionWorkflowError('invalid_input', 'workflowRunId must be path-safe', 'input_validation')
  if (typeof input.knowledgeBaseId !== 'string' || input.knowledgeBaseId.trim() === '') throw new KnowledgeIngestionWorkflowError('invalid_input', 'knowledgeBaseId must be non-empty', 'input_validation')
  if (!isRecord(input.report) || !isRecord(input.report.inputRef) || !isRecord(input.report.suppliedMetadata)) throw new KnowledgeIngestionWorkflowError('invalid_input', 'report.inputRef and report.suppliedMetadata are required', 'input_validation')
  const ref = input.report.inputRef as Record<string, unknown>
  if (!['text', 'file', 'document_reference'].includes(String(ref.type))) throw new KnowledgeIngestionWorkflowError('invalid_input', 'inputRef.type is unsupported', 'input_validation')
  if (ref.type === 'text' ? typeof ref.text !== 'string' : typeof ref.reference !== 'string' || String(ref.reference).trim() === '') throw new KnowledgeIngestionWorkflowError('invalid_input', 'inputRef payload is invalid', 'input_validation')
  const metadata = input.report.suppliedMetadata as Record<string, unknown>
  for (const field of ['title', 'publisher', 'institution', 'author', 'publishedAt', 'sourceUrl']) if (metadata[field] !== null && typeof metadata[field] !== 'string') throw new KnowledgeIngestionWorkflowError('invalid_input', `suppliedMetadata.${field} must be string or null`, 'input_validation')
  if (!isRecord(input.options) || !['commit', 'dry_run'].includes(String(input.options.mode)) || typeof input.options.reprocess !== 'boolean') throw new KnowledgeIngestionWorkflowError('invalid_input', 'options.mode and options.reprocess are invalid', 'input_validation')
}

function emptyChanges() { return { sourceCreate: [] as string[], sourceMerge: [] as string[], knowledgeCreate: [] as string[], knowledgeUpdate: [] as string[], knowledgeSupersede: [] as string[], knowledgeSourceMerge: [] as string[] } }
function emptyCounts() { return { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 } }

function blockedResult(input: ResearchReportKnowledgeIngestionInput, revision: number, rawRef: string, stage: string, error: unknown): ResearchReportKnowledgeIngestionResult {
  const item = error instanceof KnowledgeIngestionWorkflowError ? { code: error.code, message: error.message } : { code: 'workflow_error', message: error instanceof Error ? error.message : String(error) }
  return { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: 'blocked', baseRevision: revision, finalRevision: revision, raw: { rawRef, persisted: false, created: false, reused: false }, source: { sourceId: null, assessment: null }, filtering: { total: 0, relevant: 0, contextual: 0, irrelevant: 0 }, candidates: { extracted: 0, admitted: 0, rejected: 0, mapped: 0, partiallyMapped: 0, unmapped: 0, duplicates: 0, validationRejected: 0 }, changes: emptyCounts(), plannedChanges: emptyChanges(), userReview: [], schemaGaps: [], validation: null, failureStage: stage, errors: [item] }
}

export class ResearchReportKnowledgeIngestionWorkflow {
  private readonly inputResolver: ResearchReportInputResolver
  private readonly validation: KnowledgeValidationSkill
  private readonly writer: { write(handle: KnowledgeBaseHandle, receipt: ValidatedKnowledgeChangeSet): Promise<KnowledgeWriteResult> }
  private readonly clock: () => string
  private readonly logs = new KnowledgeIngestionLogStore()

  constructor(private readonly options: ResearchReportKnowledgeIngestionWorkflowOptions) {
    this.inputResolver = options.inputResolver ?? new DefaultResearchReportInputResolver()
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.validation = options.validation ?? new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader() })
    this.writer = options.writer ?? new KnowledgeWriter({ loader: new KnowledgeBaseLoader(), stagedStateValidator: createKnowledgeStagedStateValidator(this.validation) })
  }

  async execute(input: ResearchReportKnowledgeIngestionInput): Promise<ResearchReportKnowledgeIngestionResult> {
    validateInput(input)
    let target: KnowledgeBaseTarget | undefined
    let rawRef = ''
    let ingestionIdentity = ''
    let raw = { persisted: false, created: false, reused: false }
    try {
      try { target = await this.options.targetResolver.resolve(input.knowledgeBaseId) } catch (error) { throw new KnowledgeIngestionWorkflowError('target_resolution_failed', error instanceof Error ? error.message : String(error), 'intake_target_resolution') }
      if (target.handle.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeIngestionWorkflowError('target_mismatch', 'Target resolver returned a different Knowledge Base', 'intake_target_resolution')
      if (target.handle.schemaVersion !== '0.2' || target.handle.storageFormatVersion !== '1') throw new KnowledgeIngestionWorkflowError('unsupported_schema', 'Only Schema 0.2 / Storage 1 is supported by D2', 'intake_target_resolution')
      if (input.options.mode === 'commit' && (target.handle.status !== 'active' || !target.handle.writable)) throw new KnowledgeIngestionWorkflowError('target_not_writable', 'Commit requires an active writable Knowledge Base', 'intake_target_resolution')
      let resolved
      try { resolved = await this.inputResolver.resolve(input.report.inputRef) } catch (error) { if (error instanceof KnowledgeIngestionWorkflowError) throw error; throw new KnowledgeIngestionWorkflowError('document_resolution_failed', error instanceof Error ? error.message : String(error), 'document_resolution') }
      const identity = deriveRawIdentity(resolved.rawBytes)
      rawRef = identity.rawRef
      if (input.options.mode === 'commit') {
        let archived
        try { archived = await archiveRaw(target.handle, { bytes: resolved.rawBytes, originalFilename: resolved.originalFilename, mediaType: resolved.mediaType, suppliedMetadata: { title: input.report.suppliedMetadata.title, institution: input.report.suppliedMetadata.institution, author: input.report.suppliedMetadata.author, publishedAt: input.report.suppliedMetadata.publishedAt, sourceUrl: input.report.suppliedMetadata.sourceUrl } }, { clock: this.clock }) } catch (error) { throw new KnowledgeIngestionWorkflowError('raw_archive_failed', error instanceof Error ? error.message : String(error), 'raw_archive') }
        raw = { persisted: true, created: !archived.reused, reused: Boolean(archived.reused) }
      }
      ingestionIdentity = `sha256:${createHash('sha256').update(`${input.knowledgeBaseId}|${rawRef}|${RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION}|${target.handle.schemaVersion}`).digest('hex')}`
      if (input.options.mode === 'commit' && !input.options.reprocess) {
        const previous = await this.logs.findSuccessfulByIdentity(target.handle, ingestionIdentity)
        if (previous) return { ...blockedResult(input, target.handle.revision, rawRef, '', new Error('unused')), status: previous.status === 'completed_with_review' ? 'completed_with_review' : 'completed', failureStage: undefined, errors: [], raw: { rawRef, ...raw }, ingestionLogRef: typeof previous.ingestionLogRef === 'string' ? previous.ingestionLogRef : undefined }
      }
      const document: NormalizedResearchDocument = { rawRef, suppliedMetadata: clone(input.report.suppliedMetadata), normalizedText: resolved.normalizedText, chunks: resolved.chunks }
      const trace = await this.curate(input, target, document)
      return await this.planAndMaybeWrite(input, target, trace, ingestionIdentity, raw)
    } catch (error) {
      const stage = error instanceof KnowledgeIngestionWorkflowError ? (error.stage ?? (rawRef === '' ? 'document_resolution' : raw.persisted ? 'curation' : 'raw_archive')) : (rawRef === '' ? 'document_resolution' : raw.persisted ? 'curation' : 'raw_archive')
      const result = blockedResult(input, target?.handle.revision ?? 0, rawRef, stage, error)
      result.raw = { rawRef, ...raw }
      if (target && input.options.mode === 'commit' && raw.persisted && rawRef) await this.attachBlockedLog(result, input, target, ingestionIdentity, stage)
      return result
    }
  }

  private async curate(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, document: NormalizedResearchDocument): Promise<IngestionTrace> {
    const context = createKnowledgeScopeContext(target.handle)
    let sourceAssessment: SourceAssessment
    let relevance: IngestionTrace['relevance']
    let candidates: KnowledgeCandidate[]
    try {
      sourceAssessment = await this.options.curation.assessSource({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document })
      relevance = await this.options.curation.filterRelevantContent({ document, context, sourceAssessment })
      const relevantChunks = document.chunks.filter((chunk) => relevance.some((decision) => decision.chunkId === chunk.chunkId && decision.decision === 'relevant'))
      candidates = relevantChunks.length === 0 ? [] : await this.options.curation.extractKnowledgeCandidates({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, sourceAssessment, relevantChunks, context })
    } catch (error) { if (error instanceof KnowledgeIngestionWorkflowError) throw error; throw new KnowledgeIngestionWorkflowError('curation_failed', error instanceof Error ? error.message : String(error), 'curation') }
    const admissions = []
    const admitted: KnowledgeCandidate[] = []
    for (const candidate of candidates) {
      try { const decision = await this.options.curation.assessKnowledgeAdmission({ candidate, sourceAssessment, context }); admissions.push(decision); if (decision.decision === 'admit') admitted.push({ ...candidate, admission: 'admit' }) } catch (error) { throw new KnowledgeIngestionWorkflowError('admission_failed', error instanceof Error ? error.message : String(error), 'curation') }
    }
    let mappings: KnowledgeMappingResult[] = []
    if (admitted.length > 0) try { mappings = await this.options.curation.mapKnowledgeCandidates({ candidates: admitted, context }) } catch (error) { throw new KnowledgeIngestionWorkflowError('mapping_failed', error instanceof Error ? error.message : String(error), 'curation') }
    let schemaGaps: IngestionTrace['schemaGaps'] = []
    if (mappings.length > 0) try { schemaGaps = await this.options.curation.detectSchemaGaps({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, candidates: mappings, context }) } catch (error) { throw new KnowledgeIngestionWorkflowError('schema_gap_detection_failed', error instanceof Error ? error.message : String(error), 'curation') }
    try { const analysis = await this.resolveAndAnalyze(input, target, mappings, sourceAssessment); return { document, context, sourceAssessment, relevance, candidates, admissions, mappings, schemaGaps, conflicts: analysis.conflicts, plans: analysis.plans } } catch (error) { if (error instanceof KnowledgeIngestionWorkflowError) throw error; throw new KnowledgeIngestionWorkflowError('reference_resolution_failed', error instanceof Error ? error.message : String(error), 'reference_resolution') }
  }

  private async resolveAndAnalyze(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, mappings: KnowledgeMappingResult[], sourceAssessment: SourceAssessment): Promise<{ conflicts: ConflictDecision[]; plans: ResolvedCandidatePlan[] }> {
    const access = this.options.accessFactory?.(target) ?? new KnowledgeAccessSkill({ handle: target.handle, index: target.index })
    const candidateIds = new Map<string, string>()
    const entityIssues = new Map<string, 'ambiguous' | 'collision'>()
    for (const mapping of mappings.filter((item) => item.candidateType === 'entity' && item.mappingStatus !== 'unmapped')) {
      const object = mapping.proposedKnowledge.object ?? {}
      const name = text(object.name) || text(mapping.entityResolution?.mention) || mapping.claim.normalizedStatement.slice(0, 80)
      const type = validEntityType(text(object.type)) ? text(object.type) : 'product'
      const suggested = text(mapping.entityResolution?.suggestedEntityRef) || text(object.id)
      const existing = findEntity(access, suggested, name, type)
      if (existing.ambiguous) { entityIssues.set(mapping.candidateId, 'ambiguous'); continue }
      const id = existing.id ?? allocateEntityId(type, name)
      const collision = target.index.entities.get(id)
      if (collision && !sameName(collision.name, name)) { entityIssues.set(mapping.candidateId, 'collision'); continue }
      candidateIds.set(mapping.candidateId, id)
    }
    const plans: ResolvedCandidatePlan[] = []
    const conflicts: ConflictDecision[] = []
    for (const mapping of mappings) {
      if (mapping.mappingStatus === 'unmapped') { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'unmapped', reason: 'Curation mapping was unmapped' }); continue }
      if (entityIssues.get(mapping.candidateId) === 'ambiguous') { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'user_review', reason: 'Multiple exact Entity matches' }); continue }
      if (entityIssues.get(mapping.candidateId) === 'collision') { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'planning_rejected', reason: 'Deterministic Entity ID collision' }); continue }
      const object = mapping.proposedKnowledge.object
      if (!object) { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'unmapped', reason: 'No mapped object was produced' }); continue }
      const resolved = resolveDraft(clone(object), mapping, access, candidateIds)
      if (resolved.ambiguous) { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'user_review', reason: 'Multiple exact Entity matches' }); continue }
      if (!resolved.draft) { plans.push({ candidate: mapping, mapping, resolvedObject: null, resolvedRefs: [], existingKnowledge: [], resolutionStatus: 'unmapped', reason: 'Required reference could not be resolved' }); continue }
      const matches = retrieveExisting(access, mapping, resolved.draft.object)
      const existing = { knowledgeBaseId: input.knowledgeBaseId, candidateId: mapping.candidateId, matchedKnowledge: matches }
      let conflict: ConflictDecision
      try { conflict = await this.options.curation.analyzeKnowledgeConflicts({ candidate: mapping, existing, sourceAssessment }) } catch (error) { throw new KnowledgeIngestionWorkflowError('conflict_analysis_failed', error instanceof Error ? error.message : String(error), 'conflict_resolution') }
      conflicts.push(conflict)
      const resolutionStatus: ResolvedCandidatePlan['resolutionStatus'] = conflict.requiresUserReview || conflict.resolution === 'user_review' ? 'user_review' : conflict.resolution === 'reject' || conflict.conflictType === 'duplicate' ? 'rejected' : 'eligible'
      plans.push({ candidate: mapping, mapping, resolvedObject: resolved.draft.object, resolvedRefs: resolved.draft.resolvedRefs, existingKnowledge: matches, conflict, resolutionStatus })
    }
    return { conflicts, plans }
  }

  private async planAndMaybeWrite(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, trace: IngestionTrace, identity: string, raw: { persisted: boolean; created: boolean; reused: boolean }): Promise<ResearchReportKnowledgeIngestionResult> {
    const sourceId = allocateSourceId({ sourceUrl: input.report.suppliedMetadata.sourceUrl, publishedAt: input.report.suppliedMetadata.publishedAt, title: input.report.suppliedMetadata.title, rawRef: trace.document.rawRef })
    let prepared = await this.validatePlan(input, target, trace, identity, raw, sourceId, trace.plans.filter((plan) => plan.resolutionStatus === 'eligible'), 0)
    let validation = prepared.validation
    let base = makeResult(input, target.handle.revision, trace, trace.plans, raw, validation.report, sourceId, prepared.changeSet)
    if (input.options.mode === 'dry_run') {
      if (validation.report.status === 'failed') { base.status = 'blocked'; base.failureStage = 'validation'; base.errors = validation.report.errors.map((item) => ({ code: item.code, message: item.message })); return base }
      base.status = trace.plans.some((plan) => plan.resolutionStatus === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed'; return base
    }
    if (validation.report.status === 'failed') {
      const candidateOperationIds = new Set(validation.report.errors.map((error) => error.operationId).filter((id): id is string => Boolean(id)))
      const systemic = validation.report.errors.some((error) => !error.operationId || ['STALE_BASE_REVISION', 'CHANGESET_SCHEMA_MISMATCH', 'CHANGESET_BASE_READ_ERROR', 'RAW_REGISTRY_READ_ERROR', 'RAW_REGISTRY_SCHEMA', 'RAW_BUNDLE_INVALID', 'WRITE_NOT_SUPPORTED', 'CHANGESET_OPERATIONS'].includes(error.code))
      if (!systemic && candidateOperationIds.size > 0) {
        const kept = trace.plans.filter((plan, index) => plan.resolutionStatus !== 'eligible' || !candidateOperationIds.has(operationIdForPlan(plan, index)))
        prepared = await this.validatePlan(input, target, trace, identity, raw, sourceId, kept.filter((plan) => plan.resolutionStatus === 'eligible'), candidateOperationIds.size)
        validation = prepared.validation
        const prunedBase = makeResult(input, target.handle.revision, trace, kept, raw, validation.report, sourceId, prepared.changeSet)
        prunedBase.candidates.validationRejected = candidateOperationIds.size
        if (validation.report.status === 'failed') { prunedBase.status = 'blocked'; prunedBase.failureStage = 'validation'; prunedBase.errors = validation.report.errors.map((item) => ({ code: item.code, message: item.message })); await this.attachBlockedLog(prunedBase, input, target, identity, 'validation'); return prunedBase }
        base = prunedBase
      } else { base.status = 'blocked'; base.failureStage = 'validation'; base.errors = validation.report.errors.map((item) => ({ code: item.code, message: item.message })); await this.attachBlockedLog(base, input, target, identity, 'validation'); return base }
    }
    if (!validation.validatedChangeSet) { base.status = 'blocked'; base.failureStage = 'validation'; base.errors = [{ code: 'validation_required', message: 'Commit requires a validated ChangeSet receipt' }]; await this.attachBlockedLog(base, input, target, identity, 'validation'); return base }
    let writeResult: KnowledgeWriteResult
    try { writeResult = await this.writer.write(target.handle, validation.validatedChangeSet) } catch (error) { throw new KnowledgeIngestionWorkflowError('writer_failed', error instanceof Error ? error.message : String(error), 'writer') }
    if (writeResult.status === 'rejected' || writeResult.status === 'failed') { base.status = 'blocked'; base.failureStage = 'writer'; base.errors = [{ code: writeResult.error?.code ?? 'writer_failed', message: writeResult.error?.message ?? `Writer returned ${writeResult.status}` }]; await this.attachBlockedLog(base, input, target, identity, 'writer'); return base }
    base.finalRevision = writeResult.committedRevision; base.changes = { sourceCreated: writeResult.operations.sourceCreated.length, sourceMerged: writeResult.operations.sourceMerged.length, knowledgeCreated: writeResult.operations.knowledgeCreated.length, knowledgeUpdated: writeResult.operations.knowledgeUpdated.length, knowledgeSuperseded: writeResult.operations.knowledgeSuperseded.length, knowledgeSourceMerged: writeResult.operations.knowledgeSourceMerged.length }; base.ingestionLogRef = writeResult.ingestionLogRef; base.status = trace.plans.some((plan) => plan.resolutionStatus === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed'; return base
  }

  private async validatePlan(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, trace: IngestionTrace, identity: string, raw: { persisted: boolean; created: boolean; reused: boolean }, sourceId: string, plans: ResolvedCandidatePlan[], validationRejects: number): Promise<{ validation: ChangeSetValidationResult; changeSet: KnowledgeChangeSet }> {
    const source = buildSource(sourceId, input, trace.sourceAssessment, trace.document.rawRef)
    const sourceOperations: KnowledgeChangeSet['sourceOperations'] = []
    const knowledgeOperations: KnowledgeChangeSet['knowledgeOperations'] = []
    if (plans.length > 0) {
      const existing = target.index.sources.get(sourceId)
      if (!existing) sourceOperations.push({ operationId: 'source-create', type: 'source_create', source })
      else if (!(existing.rawRefs ?? []).includes(trace.document.rawRef)) sourceOperations.push({ operationId: 'source-merge', type: 'source_merge', sourceId, expectedBeforeHash: hashKnowledgeObject(existing), addRawRefs: [trace.document.rawRef], metadataPatch: sourceMetadataPatch(existing, source) })
    }
    for (const [index, plan] of plans.entries()) {
      if (!plan.resolvedObject || !plan.conflict) continue
      const operationId = operationIdForPlan(plan, index)
      const object = withSourceRef(plan.resolvedObject as KnowledgeWritableObject, sourceId)
      const existing = plan.existingKnowledge[0]
      if (plan.conflict.resolution === 'merge_source' && existing) knowledgeOperations.push({ operationId, type: 'merge_source', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, addSourceRefs: [sourceId] })
      else if (plan.conflict.resolution === 'update' && existing) knowledgeOperations.push({ operationId, type: 'update', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, object: { ...object, id: existing.knowledgeId } as KnowledgeWritableObject })
      else if (plan.conflict.resolution === 'supersede' && existing) knowledgeOperations.push({ operationId, type: 'supersede', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, replacement: object })
      else if (plan.conflict.resolution === 'create' || plan.conflict.resolution === 'keep_both' || plan.conflict.conflictType === 'none') knowledgeOperations.push({ operationId, type: 'create', object })
    }
    const changeSet: KnowledgeChangeSet = { changeSetId: changeSetId(identity, input), workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, schemaVersion: target.handle.schemaVersion, expectedBaseRevision: target.handle.revision, requiresRawProvenance: true, sourceOperations, knowledgeOperations, ingestionContext: auditContext(identity, trace, plans, raw, sourceId, validationRejects) }
    return { validation: await this.validation.validateChangeSet(target.handle, changeSet, input.options.mode === 'dry_run' ? { mode: 'dry_run', virtualRawRefs: [trace.document.rawRef] } : { mode: 'commit' }), changeSet }
  }

  private async attachBlockedLog(result: ResearchReportKnowledgeIngestionResult, input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, identity: string, stage: string): Promise<void> {
    if (!result.raw.persisted) return
    try { result.ingestionLogRef = await this.logs.writeBlocked(target.handle, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, status: 'blocked', ingestionIdentity: identity, rawRef: result.raw.rawRef, failureStage: stage, errors: result.errors, filterSummary: result.filtering, candidateSummary: result.candidates, validationRejects: result.candidates.validationRejected, userReview: result.userReview, schemaGaps: result.schemaGaps, workflowStatus: 'blocked' }) } catch (error) { result.errors.push({ code: 'ingestion_log_failed', message: error instanceof Error ? error.message : String(error) }) }
  }
}

function validEntityType(value: string): boolean { return ['industry', 'segment', 'company', 'product', 'technology'].includes(value) }
function findEntity(access: KnowledgeAccessSkill, suggested: string, name: string, type: string): ReferenceResolution {
  if (suggested) {
    try { return { id: access.getEntity(suggested).id } } catch (error) { if (!(error instanceof KnowledgeError) || error.code !== 'NotFound') throw error }
  }
  const results = (validEntityType(type) ? access.searchEntities(name, type) : ['industry', 'segment', 'company', 'product', 'technology'].flatMap((kind) => access.searchEntities(name, kind))).filter((item) => sameName(item.name, name))
  if (results.length > 1) return { ambiguous: true }
  return { id: results[0]?.id }
}

function resolveDraft(object: Record<string, unknown>, mapping: KnowledgeMappingResult, access: KnowledgeAccessSkill, candidateIds: Map<string, string>): { draft?: ResolvedDraft; ambiguous?: boolean } {
  const result = stripModelIdentity(object)
  const refs: string[] = []
  const resolveRef = (value: unknown, expectedType?: string): ReferenceResolution => {
    if (typeof value !== 'string' || value.trim() === '') return {}
    if (candidateIds.has(value)) return { id: candidateIds.get(value) }
    try { return { id: access.getEntity(value).id } } catch (error) { if (!(error instanceof KnowledgeError) || error.code !== 'NotFound') throw error }
    const kinds = validEntityType(expectedType ?? '') ? [expectedType as string] : ['industry', 'segment', 'company', 'product', 'technology']
    const results = kinds.flatMap((kind) => access.searchEntities(value, kind)).filter((item) => sameName(item.name, value))
    if (results.length > 1) return { ambiguous: true }
    return { id: results[0]?.id }
  }
  if (mapping.candidateType === 'entity') {
    const name = text(result.name) || text(mapping.entityResolution?.mention) || mapping.claim.normalizedStatement.slice(0, 80)
    const type = validEntityType(text(result.type)) ? text(result.type) : 'product'
    const found = candidateIds.get(mapping.candidateId)
    if (!found) return { ambiguous: true }
    result.id = found; result.type = type; result.name = name; return { draft: { object: result, resolvedRefs: [] } }
  }
  if (mapping.candidateType === 'relation') {
    const source = resolveRef(result.source, ''); const target = resolveRef(result.target, '')
    if (source.ambiguous || target.ambiguous) return { ambiguous: true }
    if (!source.id || !target.id) return {}
    result.source = source.id; result.target = target.id; result.id = allocateKnowledgeId('relation', result); refs.push(source.id, target.id); return { draft: { object: result, resolvedRefs: refs } }
  }
  if (mapping.candidateType === 'intelligence') {
    if (!Array.isArray(result.entityRefs)) return {}
    const resolved = result.entityRefs.map((value) => resolveRef(value, ''))
    if (resolved.some((item) => item.ambiguous)) return { ambiguous: true }
    if (resolved.some((item) => !item.id)) return {}
    result.entityRefs = resolved.map((item) => item.id); result.type = validIntelligenceType(text(result.type)) ? text(result.type) : mapping.intelligenceType ?? 'fact'; result.id = allocateKnowledgeId(String(result.type), result); refs.push(...resolved.map((item) => item.id as string)); return { draft: { object: result, resolvedRefs: refs } }
  }
  const target = resolveRef(result.targetEntity, '')
  if (target.ambiguous) return { ambiguous: true }
  if (!target.id) return {}
  result.targetEntity = target.id; result.type = text(result.type) || 'comparison'; result.id = allocateKnowledgeId('module', result); refs.push(target.id); return { draft: { object: result, resolvedRefs: refs } }
}

function validIntelligenceType(value: string): boolean { return ['fact', 'forecast', 'viewpoint', 'trend', 'risk'].includes(value) }
function retrieveExisting(access: KnowledgeAccessSkill, mapping: KnowledgeMappingResult, object: Record<string, unknown>) {
  const matches: Array<{ knowledgeId: string; kind: 'entity' | 'relation' | 'intelligence' | 'module'; type: string; object: Record<string, unknown>; semanticHash: string }> = []
  try {
    if (mapping.candidateType === 'entity') {
      for (const item of access.searchEntities(text(object.name), text(object.type)).filter((item) => sameName(item.name, text(object.name)))) matches.push({ knowledgeId: item.id, kind: 'entity', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
    } else if (mapping.candidateType === 'relation') {
      if (typeof object.source !== 'string') return matches
      for (const item of access.getRelations(object.source)) if (item.target === object.target && item.type === object.type) matches.push({ knowledgeId: item.id, kind: 'relation', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
    } else if (mapping.candidateType === 'intelligence') {
      if (!Array.isArray(object.entityRefs)) return matches
      for (const ref of object.entityRefs) for (const item of access.getIntelligence(String(ref), text(object.type))) matches.push({ knowledgeId: item.id, kind: 'intelligence', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
    } else if (typeof object.targetEntity === 'string') {
      for (const item of access.getModules(object.targetEntity)) matches.push({ knowledgeId: item.id, kind: 'module', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
    }
  } catch (error) {
    if (!(error instanceof KnowledgeError) || error.code !== 'NotFound') throw error
  }
  return matches
}

function operationIdForPlan(plan: ResolvedCandidatePlan, _index: number): string { return `candidate-${plan.candidate.candidateId.replace(/[^A-Za-z0-9_-]/g, '-')}` }
function buildSource(id: string, input: ResearchReportKnowledgeIngestionInput, assessment: SourceAssessment, rawRef: string): KnowledgeSource { return { id, type: 'research_report', title: input.report.suppliedMetadata.title ?? 'Untitled research report', publisher: assessment.publisher ?? input.report.suppliedMetadata.publisher, institution: assessment.institution ?? input.report.suppliedMetadata.institution, author: assessment.author ?? input.report.suppliedMetadata.author, publishedAt: assessment.publishedAt ?? input.report.suppliedMetadata.publishedAt, url: input.report.suppliedMetadata.sourceUrl, sourceType: assessment.sourceType, sourceReliability: assessment.sourceReliability, rawRefs: [rawRef] } }
function sourceMetadataPatch(existing: KnowledgeSource, source: KnowledgeSource) { const patch: Record<string, unknown> = {}; for (const key of ['institution', 'author', 'publishedAt', 'url', 'sourceType', 'sourceReliability'] as const) if (source[key] !== undefined && source[key] !== existing[key]) patch[key] = source[key]; return patch }
function withSourceRef(object: KnowledgeWritableObject, sourceId: string): KnowledgeWritableObject { const result = clone(object) as Record<string, unknown>; result.sourceRefs = [...new Set([...(Array.isArray(result.sourceRefs) ? result.sourceRefs : []), sourceId])]; return result as KnowledgeWritableObject }
function changeSetId(identity: string, input: ResearchReportKnowledgeIngestionInput): string { const suffix = input.options.reprocess ? `${identity}|${input.workflowRunId}` : identity; return `changeset-${createHash('sha256').update(suffix).digest('hex').slice(0, 24)}` }
function auditContext(identity: string, trace: IngestionTrace, plans: ResolvedCandidatePlan[], raw: { persisted: boolean; created: boolean; reused: boolean }, sourceId: string, validationRejects: number): IngestionAuditContext { const relevant = trace.relevance.filter((item) => item.decision === 'relevant').length; return { workflowVersion: RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION, ingestionIdentity: identity, rawArchive: { rawRefs: [trace.document.rawRef], created: raw.created ? [trace.document.rawRef] : [], reused: raw.reused ? [trace.document.rawRef] : [] }, sourceSummary: { sourceId, ...sourceSummary(trace.sourceAssessment) }, filterSummary: { total: trace.document.chunks.length, relevant, contextual: trace.relevance.filter((item) => item.decision === 'contextual').length, irrelevant: trace.relevance.filter((item) => item.decision === 'irrelevant').length }, candidateSummary: { extracted: trace.candidates.length, admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length, mapped: trace.mappings.filter((item) => item.mappingStatus === 'mapped').length, partiallyMapped: trace.mappings.filter((item) => item.mappingStatus === 'partially_mapped').length, unmapped: plans.filter((item) => item.resolutionStatus === 'unmapped').length }, admissionSummary: { admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length }, duplicateSummary: { duplicates: plans.filter((item) => item.resolutionStatus === 'rejected' && item.conflict?.conflictType === 'duplicate').length }, validationRejects, userReview: plans.filter((item) => item.resolutionStatus === 'user_review').map((item) => ({ candidateId: item.candidate.candidateId, reason: item.reason ?? item.conflict?.reason ?? 'review required' })), schemaGaps: trace.schemaGaps.slice(0, 100).map((gap) => ({ gapId: gap.gapId, gapType: gap.gapType, recommendedAction: gap.recommendedAction })), workflowStatus: plans.some((plan) => plan.resolutionStatus === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed' } }
function makeResult(input: ResearchReportKnowledgeIngestionInput, revision: number, trace: IngestionTrace, plans: ResolvedCandidatePlan[], raw: { persisted: boolean; created: boolean; reused: boolean }, validation: ValidationReport | null, sourceId: string | null, changeSet?: KnowledgeChangeSet): ResearchReportKnowledgeIngestionResult {
  const plannedChanges = emptyChanges()
  for (const operation of changeSet?.sourceOperations ?? []) if (operation.type === 'source_create') plannedChanges.sourceCreate.push(operation.source.id); else plannedChanges.sourceMerge.push(operation.sourceId)
  for (const operation of changeSet?.knowledgeOperations ?? []) if (operation.type === 'create') plannedChanges.knowledgeCreate.push(operation.object.id); else if (operation.type === 'update') plannedChanges.knowledgeUpdate.push(operation.knowledgeId); else if (operation.type === 'supersede') plannedChanges.knowledgeSupersede.push(operation.knowledgeId); else plannedChanges.knowledgeSourceMerge.push(operation.knowledgeId)
  const effectiveSourceId = sourceId && (changeSet?.sourceOperations.length ?? 0) > 0 ? sourceId : null
  return { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: 'completed', baseRevision: revision, finalRevision: revision, raw: { rawRef: trace.document.rawRef, persisted: raw.persisted, created: raw.created, reused: raw.reused }, source: { sourceId: effectiveSourceId, assessment: sourceSummary(trace.sourceAssessment) }, filtering: { total: trace.document.chunks.length, relevant: trace.relevance.filter((item) => item.decision === 'relevant').length, contextual: trace.relevance.filter((item) => item.decision === 'contextual').length, irrelevant: trace.relevance.filter((item) => item.decision === 'irrelevant').length }, candidates: { extracted: trace.candidates.length, admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length, mapped: trace.mappings.filter((item) => item.mappingStatus === 'mapped').length, partiallyMapped: trace.mappings.filter((item) => item.mappingStatus === 'partially_mapped').length, unmapped: plans.filter((item) => item.resolutionStatus === 'unmapped').length, duplicates: plans.filter((item) => item.resolutionStatus === 'rejected' && item.conflict?.conflictType === 'duplicate').length, validationRejected: 0 }, changes: emptyCounts(), plannedChanges, userReview: plans.filter((item) => item.resolutionStatus === 'user_review').map((item) => ({ candidateId: item.candidate.candidateId, reason: item.reason ?? item.conflict?.reason ?? 'review required' })), schemaGaps: trace.schemaGaps, validation, errors: [] }
}
