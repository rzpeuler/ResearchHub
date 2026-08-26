import { createHash } from 'node:crypto'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import type { ConflictDecision, KnowledgeCandidate, KnowledgeMappingResult, NormalizedResearchDocument, SourceAssessment } from '../../../packages/skills/knowledge-curation/index.ts'
import { KnowledgeValidationSkill, createKnowledgeStagedStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import { KnowledgeBaseLoader, KnowledgeIngestionLogStore, archiveRaw, deriveRawIdentity, hashKnowledgeObject, allocateEntityId, allocateKnowledgeId, allocateSourceId } from '../../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeBaseHandle, KnowledgeIndex } from '../../../packages/shared/knowledge-base/index.ts'
import { KnowledgeWriter } from '../../../packages/shared/knowledge-base/write/index.ts'
import type { KnowledgeChangeSet, KnowledgeSource, KnowledgeWritableObject, ValidatedKnowledgeChangeSet, KnowledgeWriteResult } from '../../../packages/schemas/knowledge/index.ts'
import { DefaultResearchReportInputResolver } from './input-resolver.ts'
import { KnowledgeIngestionWorkflowError } from './errors.ts'
import { createKnowledgeScopeContext } from './scope-context.ts'
import type { IngestionAuditContext, IngestionTrace, KnowledgeBaseTarget, ResearchReportKnowledgeIngestionInput, ResearchReportKnowledgeIngestionResult, ResearchReportKnowledgeIngestionWorkflowOptions, ResearchReportInputResolver } from './types.ts'

export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_ID = 'research-report-knowledge-ingestion'
export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION = '0.1'

interface PlannedState {
  candidate: KnowledgeCandidate
  mapping: KnowledgeMappingResult
  object?: KnowledgeWritableObject
  resolvedRefs: string[]
  existing: Array<{ knowledgeId: string; kind: 'entity' | 'relation' | 'intelligence' | 'module'; type: string; object: Record<string, unknown>; semanticHash: string }>
  conflict?: ConflictDecision
  status: 'eligible' | 'unmapped' | 'user_review' | 'planning_rejected' | 'rejected'
}

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
  if (ref.type === 'text' ? typeof ref.text !== 'string' : typeof ref.reference !== 'string' || String(ref.type) !== 'text' && String(ref.reference).trim() === '') throw new KnowledgeIngestionWorkflowError('invalid_input', 'inputRef payload is invalid', 'input_validation')
  const metadata = input.report.suppliedMetadata as Record<string, unknown>
  for (const field of ['title', 'publisher', 'institution', 'author', 'publishedAt', 'sourceUrl']) if (metadata[field] !== null && typeof metadata[field] !== 'string') throw new KnowledgeIngestionWorkflowError('invalid_input', `suppliedMetadata.${field} must be string or null`, 'input_validation')
  if (!isRecord(input.options) || !['commit', 'dry_run'].includes(String(input.options.mode)) || typeof input.options.reprocess !== 'boolean') throw new KnowledgeIngestionWorkflowError('invalid_input', 'options.mode and options.reprocess are invalid', 'input_validation')
}

function blockedResult(input: ResearchReportKnowledgeIngestionInput, baseRevision: number, rawRef: string, stage: string, error: unknown): ResearchReportKnowledgeIngestionResult {
  const item = error instanceof KnowledgeIngestionWorkflowError ? { code: error.code, message: error.message } : { code: 'workflow_error', message: error instanceof Error ? error.message : String(error) }
  return {
    workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: 'blocked', baseRevision, finalRevision: baseRevision,
    raw: { rawRef, persisted: false, created: false, reused: false }, source: { sourceId: null, assessment: null }, filtering: { total: 0, relevant: 0, contextual: 0, irrelevant: 0 },
    candidates: { extracted: 0, admitted: 0, rejected: 0, mapped: 0, partiallyMapped: 0, unmapped: 0, duplicates: 0, validationRejected: 0 },
    changes: { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 }, userReview: [], schemaGaps: [], validation: null, failureStage: stage, errors: [item],
  }
}

function changeSetId(identity: string, input: ResearchReportKnowledgeIngestionInput): string {
  const suffix = input.options.reprocess ? `${identity}|${input.workflowRunId}` : identity
  return `changeset-${createHash('sha256').update(suffix).digest('hex').slice(0, 24)}`
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
    let rawRecord: { persisted: boolean; created: boolean; reused: boolean } = { persisted: false, created: false, reused: false }
    try {
      try { target = await this.options.targetResolver.resolve(input.knowledgeBaseId) } catch (error) { throw new KnowledgeIngestionWorkflowError('target_resolution_failed', error instanceof Error ? error.message : String(error), 'intake_target_resolution') }
      if (target.handle.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeIngestionWorkflowError('target_mismatch', 'Target resolver returned a different Knowledge Base', 'intake_target_resolution')
      if (input.options.mode === 'commit' && (target.handle.schemaVersion !== '0.2' || target.handle.storageFormatVersion !== '1' || target.handle.status !== 'active' || !target.handle.writable)) throw new KnowledgeIngestionWorkflowError('target_not_writable', 'Commit requires an active writable Schema 0.2 / Storage 1 Knowledge Base', 'intake_target_resolution')
      const resolved = await this.inputResolver.resolve(input.report.inputRef)
      const identity = deriveRawIdentity(resolved.bytes)
      rawRef = identity.rawRef
      if (input.options.mode === 'commit') {
        const archived = await archiveRaw(target.handle, { bytes: resolved.bytes, originalFilename: resolved.originalFilename, mediaType: resolved.mediaType, suppliedMetadata: { title: input.report.suppliedMetadata.title, institution: input.report.suppliedMetadata.institution, author: input.report.suppliedMetadata.author, publishedAt: input.report.suppliedMetadata.publishedAt, sourceUrl: input.report.suppliedMetadata.sourceUrl } }, { clock: this.clock })
        rawRecord = { persisted: true, created: !archived.reused, reused: Boolean(archived.reused) }
      }
      ingestionIdentity = `sha256:${createHash('sha256').update(`${input.knowledgeBaseId}|${rawRef}|${RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION}|${target.handle.schemaVersion}`).digest('hex')}`
      if (input.options.mode === 'commit' && !input.options.reprocess) {
        const previous = await this.logs.findSuccessfulByIdentity(target.handle, ingestionIdentity)
        if (previous) return this.idempotentResult(input, target.handle.revision, rawRef, previous, rawRecord)
      }
      const document: NormalizedResearchDocument = { rawRef, suppliedMetadata: clone(input.report.suppliedMetadata), normalizedText: resolved.normalizedText, chunks: resolved.chunks }
      const trace = await this.curate(input, target, document)
      const result = await this.planAndMaybeWrite(input, target, trace, ingestionIdentity, rawRecord)
      return result
    } catch (error) {
      const stage = error instanceof KnowledgeIngestionWorkflowError ? (error.stage ?? (rawRef === '' ? 'document_resolution' : rawRecord.persisted ? 'curation' : 'raw_archive')) : (rawRef === '' ? 'document_resolution' : rawRecord.persisted ? 'curation' : 'raw_archive')
      const result = blockedResult(input, target?.handle.revision ?? 0, rawRef, stage, error)
      result.raw = { rawRef, ...rawRecord }
      if (target && input.options.mode === 'commit' && rawRecord.persisted && rawRef) {
        await this.attachBlockedLog(result, input, target, ingestionIdentity, stage)
      }
      return result
    }
  }

  private async curate(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, document: NormalizedResearchDocument): Promise<IngestionTrace> {
    const context = createKnowledgeScopeContext(target.handle)
    let sourceAssessment: SourceAssessment
    let relevance: IngestionTrace['relevance']
    let candidates: IngestionTrace['candidates']
    try {
      sourceAssessment = await this.options.curation.assessSource({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document })
      relevance = await this.options.curation.filterRelevantContent({ document, context, sourceAssessment })
      const relevantChunks = document.chunks.filter((chunk) => relevance.some((decision) => decision.chunkId === chunk.chunkId && decision.decision === 'relevant'))
      candidates = await this.options.curation.extractKnowledgeCandidates({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, sourceAssessment, relevantChunks, context })
    } catch (error) { throw new KnowledgeIngestionWorkflowError('curation_failed', error instanceof Error ? error.message : String(error), 'curation') }
    const admissions = []
    const admitted: KnowledgeCandidate[] = []
    for (const candidate of candidates) {
      try {
        const admission = await this.options.curation.assessKnowledgeAdmission({ candidate, sourceAssessment, context })
        admissions.push(admission)
        if (admission.decision === 'admit') admitted.push({ ...candidate, admission: 'admit' })
      } catch (error) { throw new KnowledgeIngestionWorkflowError('admission_failed', error instanceof Error ? error.message : String(error), 'curation') }
    }
    let mappings: KnowledgeMappingResult[] = []
    if (admitted.length > 0) {
      try { mappings = await this.options.curation.mapKnowledgeCandidates({ candidates: admitted, context }) } catch (error) { throw new KnowledgeIngestionWorkflowError('mapping_failed', error instanceof Error ? error.message : String(error), 'curation') }
    }
    let schemaGaps = []
    try { schemaGaps = await this.options.curation.detectSchemaGaps({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, candidates: admitted, context }) } catch (error) { throw new KnowledgeIngestionWorkflowError('schema_gap_detection_failed', error instanceof Error ? error.message : String(error), 'curation') }
    const conflicts: ConflictDecision[] = []
    try { return { document, context, sourceAssessment, relevance, candidates, admissions, mappings, schemaGaps, conflicts: conflicts.concat(await this.resolveAndAnalyze(input, target, mappings, sourceAssessment)) } }
    catch (error) { if (error instanceof KnowledgeIngestionWorkflowError) throw error; throw new KnowledgeIngestionWorkflowError('reference_resolution_failed', error instanceof Error ? error.message : String(error), 'reference_resolution') }
  }

  private async resolveAndAnalyze(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, mappings: KnowledgeMappingResult[], sourceAssessment: SourceAssessment): Promise<ConflictDecision[]> {
    const access = this.options.accessFactory?.(target) ?? new KnowledgeAccessSkill({ handle: target.handle, index: target.index })
    const candidateIds = new Map<string, string>()
    for (const mapping of mappings.filter((item) => item.candidateType === 'entity' && item.mappingStatus !== 'unmapped')) {
      const object = clone(mapping.proposedKnowledge.object ?? {})
      const name = text(object.name) || text(mapping.entityResolution?.mention) || mapping.claim.normalizedStatement.slice(0, 80)
      const type = text(object.type) || 'entity'
      const existing = resolveExistingEntity(access, object.id, name, type)
      candidateIds.set(mapping.candidateId, existing?.id ?? allocateEntityId(type, name))
    }
    for (const mapping of mappings) {
      if (mapping.mappingStatus === 'unmapped') continue
      const object = clone(mapping.proposedKnowledge.object ?? {})
      const resolved = resolveDraft(object, mapping, access, candidateIds)
      if (!resolved) { mapping.mappingStatus = 'unmapped'; mapping.proposedKnowledge = { object: null }; continue }
      mapping.proposedKnowledge = { object: resolved.object }
      mapping.mappingStatus = resolved.partial ? 'partially_mapped' : 'mapped'
    }
    const conflicts: ConflictDecision[] = []
    for (const mapping of mappings) {
      if (mapping.mappingStatus === 'unmapped') continue
      const object = mapping.proposedKnowledge.object
      if (!object) continue
      const matches = retrieveExisting(access, mapping, object)
      const existing = { knowledgeBaseId: input.knowledgeBaseId, candidateId: mapping.candidateId, matchedKnowledge: matches }
      try { conflicts.push(await this.options.curation.analyzeKnowledgeConflicts({ candidate: mapping, existing, sourceAssessment })) } catch (error) { throw new KnowledgeIngestionWorkflowError('conflict_analysis_failed', error instanceof Error ? error.message : String(error), 'conflict_resolution') }
    }
    return conflicts
  }

  private async planAndMaybeWrite(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, trace: IngestionTrace, ingestionIdentity: string, rawRecord: { persisted: boolean; created: boolean; reused: boolean }): Promise<ResearchReportKnowledgeIngestionResult> {
    const sourceId = allocateSourceId({ sourceUrl: input.report.suppliedMetadata.sourceUrl, publishedAt: input.report.suppliedMetadata.publishedAt, title: input.report.suppliedMetadata.title, rawRef: trace.document.rawRef })
    const source = buildSource(sourceId, input, trace.sourceAssessment, trace.document.rawRef)
    const plans = planCandidates(trace.mappings, trace.conflicts, target.index)
    const sourceOperations: KnowledgeChangeSet['sourceOperations'] = []
    const knowledgeOperations: KnowledgeChangeSet['knowledgeOperations'] = []
    const durablePlans = plans.filter((plan) => plan.status === 'eligible')
    const existingSource = target.index.sources.get(sourceId)
    if (durablePlans.length > 0) {
      if (!existingSource) sourceOperations.push({ operationId: 'source-create', type: 'source_create', source })
      else if (!(existingSource.rawRefs ?? []).includes(trace.document.rawRef)) sourceOperations.push({ operationId: 'source-merge', type: 'source_merge', sourceId, expectedBeforeHash: hashKnowledgeObject(existingSource), addRawRefs: [trace.document.rawRef], metadataPatch: sourceMetadataPatch(existingSource, source) })
    }
    for (const [index, plan] of plans.entries()) if (plan.status === 'eligible' && plan.object && plan.conflict) {
      const operationId = `candidate-${index + 1}`
      const object = withSourceRef(plan.object, sourceId)
      const conflict = plan.conflict
      const existing = plan.existing[0]
      if (conflict.resolution === 'merge_source' && existing) knowledgeOperations.push({ operationId, type: 'merge_source', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, addSourceRefs: [sourceId] })
      else if (conflict.resolution === 'update' && existing) knowledgeOperations.push({ operationId, type: 'update', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, object: { ...object, id: existing.knowledgeId } as KnowledgeWritableObject })
      else if (conflict.resolution === 'supersede' && existing) knowledgeOperations.push({ operationId, type: 'supersede', knowledgeId: existing.knowledgeId, expectedBeforeHash: existing.semanticHash, replacement: object })
      else if (conflict.resolution === 'create' || conflict.resolution === 'keep_both' || conflict.conflictType === 'none') knowledgeOperations.push({ operationId, type: 'create', object })
    }
    const changeSet: KnowledgeChangeSet = { changeSetId: changeSetId(ingestionIdentity, input), workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, schemaVersion: target.handle.schemaVersion, expectedBaseRevision: target.handle.revision, requiresRawProvenance: true, sourceOperations, knowledgeOperations, ingestionContext: auditContext(ingestionIdentity, trace, plans, rawRecord, sourceId) }
    let validation = await this.validation.validateChangeSet(target.handle, changeSet)
    const effectiveSourceId = durablePlans.length > 0 ? sourceId : null
    const base = makeResult(input, target.handle.revision, trace, rawRecord, effectiveSourceId, plans, validation.report)
    base.raw.rawRef = trace.document.rawRef
    if (input.options.mode === 'dry_run') { base.status = plans.some((plan) => plan.status === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed'; return base }
    if (validation.report.status === 'failed' || !validation.validatedChangeSet) {
      base.status = 'blocked'; base.failureStage = 'validation'; base.errors = validation.report.errors.map((item) => ({ code: item.code, message: item.message })); base.candidates.validationRejected = knowledgeOperations.length; await this.attachBlockedLog(base, input, target, ingestionIdentity, 'validation'); return base
    }
    let writeResult: KnowledgeWriteResult
    try { writeResult = await this.writer.write(target.handle, validation.validatedChangeSet) } catch (error) { throw new KnowledgeIngestionWorkflowError('writer_failed', error instanceof Error ? error.message : String(error), 'writer') }
    if (writeResult.status === 'rejected' || writeResult.status === 'failed') {
      base.status = 'blocked'; base.failureStage = 'writer'; base.errors = [{ code: writeResult.error?.code ?? 'writer_failed', message: writeResult.error?.message ?? `Writer returned ${writeResult.status}` }]; await this.attachBlockedLog(base, input, target, ingestionIdentity, 'writer'); return base
    }
    base.finalRevision = writeResult.committedRevision
    base.changes = { sourceCreated: writeResult.operations.sourceCreated.length, sourceMerged: writeResult.operations.sourceMerged.length, knowledgeCreated: writeResult.operations.knowledgeCreated.length, knowledgeUpdated: writeResult.operations.knowledgeUpdated.length, knowledgeSuperseded: writeResult.operations.knowledgeSuperseded.length, knowledgeSourceMerged: writeResult.operations.knowledgeSourceMerged.length }
    base.ingestionLogRef = writeResult.ingestionLogRef
    base.status = plans.some((plan) => plan.status === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed'
    return base
  }

  private idempotentResult(input: ResearchReportKnowledgeIngestionInput, revision: number, rawRef: string, previous: Record<string, unknown>, rawRecord: { persisted: boolean; created: boolean; reused: boolean }): ResearchReportKnowledgeIngestionResult {
    return { ...blockedResult(input, revision, rawRef, '', new Error('unused')), status: String(previous.status) === 'completed_with_review' ? 'completed_with_review' : 'completed', failureStage: undefined, errors: [], raw: { rawRef, ...rawRecord }, ingestionLogRef: typeof previous.ingestionLogRef === 'string' ? previous.ingestionLogRef : undefined }
  }

  private async attachBlockedLog(result: ResearchReportKnowledgeIngestionResult, input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, ingestionIdentity: string, failureStage: string): Promise<void> {
    try {
      result.ingestionLogRef = await this.logs.writeBlocked(target.handle, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, status: 'blocked', ingestionIdentity, rawRef: result.raw.rawRef, failureStage, errors: result.errors, filterSummary: result.filtering, candidateSummary: result.candidates })
    } catch (error) { result.errors.push({ code: 'ingestion_log_failed', message: error instanceof Error ? error.message : String(error) }) }
  }
}

function resolveExistingEntity(access: KnowledgeAccessSkill, suggested: unknown, name: string, type: string) {
  if (typeof suggested === 'string' && suggested.trim()) {
    try { return access.getEntity(suggested) } catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Entity not found')) throw error }
  }
  return access.searchEntities(name, type).find((item) => sameName(item.name, name))
}

function resolveDraft(object: Record<string, unknown>, mapping: KnowledgeMappingResult, access: KnowledgeAccessSkill, candidateIds: Map<string, string>): { object: Record<string, unknown>; partial: boolean } | undefined {
  const result = stripModelIdentity(object)
  let partial = false
  const resolveRef = (value: unknown, expectedType?: string): string | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    const candidate = candidateIds.get(value)
    if (candidate) return candidate
    try { return access.getEntity(value).id } catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Entity not found')) throw error }
    const match = access.searchEntities(value, expectedType).find((item) => sameName(item.name, value))
    return match?.id
  }
  if (mapping.candidateType === 'entity') {
    const name = text(result.name) || text(mapping.entityResolution?.mention) || mapping.claim.normalizedStatement.slice(0, 80)
    result.id = candidateIds.get(mapping.candidateId) ?? allocateEntityId(text(result.type) || 'product', name)
    result.type = text(result.type) || 'product'; result.name = name
    return { object: result, partial: false }
  }
  if (mapping.candidateType === 'relation') {
    const source = resolveRef(result.source, 'entity')
    const target = resolveRef(result.target, 'entity')
    if (!source || !target) return undefined
    result.source = source; result.target = target; result.id = allocateKnowledgeId('relation', result); return { object: result, partial }
  }
  if (mapping.candidateType === 'intelligence') {
    const refs = Array.isArray(result.entityRefs) ? result.entityRefs.map((item) => resolveRef(item, 'entity')) : []
    if (refs.some((item) => !item)) return undefined
    result.entityRefs = refs; result.type = text(result.type) || mapping.intelligenceType || 'fact'; result.id = allocateKnowledgeId(String(result.type), result); return { object: result, partial }
  }
  const target = resolveRef(result.targetEntity, 'entity')
  if (!target) { partial = true; return undefined }
  result.targetEntity = target; result.type = text(result.type) || 'comparison'; result.id = allocateKnowledgeId('module', result); return { object: result, partial }
}

function retrieveExisting(access: KnowledgeAccessSkill, mapping: KnowledgeMappingResult, object: Record<string, unknown>) {
  const matches: Array<{ knowledgeId: string; kind: 'entity' | 'relation' | 'intelligence' | 'module'; type: string; object: Record<string, unknown>; semanticHash: string }> = []
  if (mapping.candidateType === 'entity') {
    const found = access.searchEntities(text(object.name), text(object.type)).filter((item) => sameName(item.name, text(object.name)))
    for (const item of found) matches.push({ knowledgeId: item.id, kind: 'entity', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
  } else if (mapping.candidateType === 'relation' && typeof object.source === 'string') {
    for (const item of access.getRelations(object.source)) if (item.target === object.target && item.type === object.type) matches.push({ knowledgeId: item.id, kind: 'relation', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
  } else if (mapping.candidateType === 'intelligence' && Array.isArray(object.entityRefs)) {
    for (const entityRef of object.entityRefs) for (const item of access.getIntelligence(String(entityRef), text(object.type))) matches.push({ knowledgeId: item.id, kind: 'intelligence', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
  } else if (mapping.candidateType === 'module_content') {
    if (typeof object.targetEntity === 'string') for (const item of access.getModules(object.targetEntity)) matches.push({ knowledgeId: item.id, kind: 'module', type: item.type, object: item, semanticHash: hashKnowledgeObject(item) })
  }
  return matches
}

function planCandidates(mappings: KnowledgeMappingResult[], conflicts: ConflictDecision[], index: KnowledgeIndex): PlannedState[] {
  const result: PlannedState[] = []
  for (const mapping of mappings) {
    const conflict = conflicts.find((item) => item.candidateId === mapping.candidateId)
    const object = mapping.proposedKnowledge.object as KnowledgeWritableObject | null
    const existing = conflict?.existingKnowledgeRefs.map((id) => ({ knowledgeId: id, kind: kindForId(index, id), type: '', object: (index.entities.get(id) ?? index.relations.get(id) ?? index.intelligence.get(id) ?? index.modules.get(id) ?? {}) as Record<string, unknown>, semanticHash: hashKnowledgeObject(index.entities.get(id) ?? index.relations.get(id) ?? index.intelligence.get(id) ?? index.modules.get(id) ?? {}) })) ?? []
    let status: PlannedState['status'] = object ? 'eligible' : 'unmapped'
    if (mapping.mappingStatus === 'unmapped') status = 'unmapped'
    if (conflict?.resolution === 'reject' || conflict?.conflictType === 'duplicate') status = 'rejected'
    if (conflict?.resolution === 'user_review' || conflict?.requiresUserReview) status = 'user_review'
    return result.concat({ candidate: mapping, mapping, object: object ?? undefined, resolvedRefs: [], existing, conflict, status })
  }
  return result
}

function kindForId(index: KnowledgeIndex, id: string): 'entity' | 'relation' | 'intelligence' | 'module' {
  if (index.entities.has(id)) return 'entity'; if (index.relations.has(id)) return 'relation'; if (index.intelligence.has(id)) return 'intelligence'; return 'module'
}

function buildSource(id: string, input: ResearchReportKnowledgeIngestionInput, assessment: SourceAssessment, rawRef: string): KnowledgeSource {
  return { id, type: 'research_report', title: input.report.suppliedMetadata.title ?? 'Untitled research report', publisher: assessment.publisher ?? input.report.suppliedMetadata.publisher, institution: assessment.institution ?? input.report.suppliedMetadata.institution, author: assessment.author ?? input.report.suppliedMetadata.author, publishedAt: assessment.publishedAt ?? input.report.suppliedMetadata.publishedAt, url: input.report.suppliedMetadata.sourceUrl, sourceType: assessment.sourceType, sourceReliability: assessment.sourceReliability, rawRefs: [rawRef] }
}

function sourceMetadataPatch(existing: KnowledgeSource, source: KnowledgeSource) {
  const patch: Record<string, unknown> = {}
  for (const key of ['institution', 'author', 'publishedAt', 'url', 'sourceType', 'sourceReliability'] as const) if (source[key] !== undefined && source[key] !== existing[key]) patch[key] = source[key]
  return patch
}

function withSourceRef(object: KnowledgeWritableObject, sourceId: string): KnowledgeWritableObject {
  const result = clone(object) as Record<string, unknown>
  result.sourceRefs = [...new Set([...(Array.isArray(result.sourceRefs) ? result.sourceRefs : []), sourceId])]
  return result as KnowledgeWritableObject
}

function auditContext(identity: string, trace: IngestionTrace, plans: PlannedState[], rawRecord: { persisted: boolean; created: boolean; reused: boolean }, sourceId: string): IngestionAuditContext {
  const relevant = trace.relevance.filter((item) => item.decision === 'relevant').length
  return { workflowVersion: RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION, ingestionIdentity: identity, rawArchive: { rawRefs: [trace.document.rawRef], created: rawRecord.created ? [trace.document.rawRef] : [], reused: rawRecord.reused ? [trace.document.rawRef] : [] }, sourceSummary: { sourceId, ...sourceSummary(trace.sourceAssessment) }, filterSummary: { total: trace.document.chunks.length, relevant, contextual: trace.relevance.filter((item) => item.decision === 'contextual').length, irrelevant: trace.relevance.filter((item) => item.decision === 'irrelevant').length }, candidateSummary: { extracted: trace.candidates.length, admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length, mapped: trace.mappings.filter((item) => item.mappingStatus === 'mapped').length, partiallyMapped: trace.mappings.filter((item) => item.mappingStatus === 'partially_mapped').length, unmapped: plans.filter((item) => item.status === 'unmapped').length }, admissionSummary: { admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length }, duplicateSummary: { duplicates: plans.filter((item) => item.status === 'rejected' && item.conflict?.conflictType === 'duplicate').length }, validationRejects: 0, userReview: plans.filter((item) => item.status === 'user_review').map((item) => ({ candidateId: item.candidate.candidateId, reason: item.conflict?.reason ?? 'reference resolution' })), schemaGaps: trace.schemaGaps.slice(0, 100).map((gap) => ({ gapId: gap.gapId, gapType: gap.gapType, recommendedAction: gap.recommendedAction })), workflowStatus: plans.some((plan) => plan.status === 'user_review') || trace.schemaGaps.length > 0 ? 'completed_with_review' : 'completed' }
}

function makeResult(input: ResearchReportKnowledgeIngestionInput, revision: number, trace: IngestionTrace, rawRecord: { persisted: boolean; created: boolean; reused: boolean }, sourceId: string | null, plans: PlannedState[], validation: ResearchReportKnowledgeIngestionResult['validation']): ResearchReportKnowledgeIngestionResult {
  const counts = { extracted: trace.candidates.length, admitted: trace.admissions.filter((item) => item.decision === 'admit').length, rejected: trace.admissions.filter((item) => item.decision === 'reject').length, mapped: trace.mappings.filter((item) => item.mappingStatus === 'mapped').length, partiallyMapped: trace.mappings.filter((item) => item.mappingStatus === 'partially_mapped').length, unmapped: plans.filter((item) => item.status === 'unmapped').length, duplicates: plans.filter((item) => item.status === 'rejected' && item.conflict?.conflictType === 'duplicate').length, validationRejected: 0 }
  return { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: 'completed', baseRevision: revision, finalRevision: revision, raw: { rawRef: trace.document.rawRef, persisted: rawRecord.persisted, created: rawRecord.created, reused: rawRecord.reused }, source: { sourceId, assessment: sourceSummary(trace.sourceAssessment) }, filtering: { total: trace.document.chunks.length, relevant: trace.relevance.filter((item) => item.decision === 'relevant').length, contextual: trace.relevance.filter((item) => item.decision === 'contextual').length, irrelevant: trace.relevance.filter((item) => item.decision === 'irrelevant').length }, candidates: counts, changes: { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 }, userReview: plans.filter((item) => item.status === 'user_review').map((item) => ({ candidateId: item.candidate.candidateId, reason: item.conflict?.reason ?? 'review required' })), schemaGaps: trace.schemaGaps, validation, errors: [] }
}
