import { createHash } from 'node:crypto'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeCurationError, type ClaimCandidate, type EntityCandidate, type ExtractKnowledgeInput, type ExtractKnowledgeOutput, type KnowledgeContext, type NormalizedResearchDocument, type ReconciliationCandidate, type ReconciliationDecision, type ReconciliationGroup, type RelationCandidate, type ReportUnderstanding, type ExtractionBatch, type JsonRecord } from '../../../packages/skills/knowledge-curation/index.ts'
import { KnowledgeValidationSkill, createKnowledgeStagedStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import { KnowledgeBaseLoader, KnowledgeIngestionLogStore, archiveRaw, deriveRawIdentity, hashKnowledgeObject, KnowledgeIndexV03 } from '../../../packages/shared/knowledge-base/index.ts'
import { KnowledgeWriter } from '../../../packages/shared/knowledge-base/write/index.ts'
import type { KnowledgeClaimV03, KnowledgeEntityV03, KnowledgeRelationV03, KnowledgeSourceV03 } from '../../../packages/schemas/knowledge/v03/domain.ts'
import type { KnowledgeChangeSetV03 } from '../../../packages/schemas/knowledge/v03/mutation.ts'
import { DefaultResearchReportInputResolver } from './input-resolver.ts'
import { KnowledgeIngestionWorkflowError } from './errors.ts'
import { createKnowledgeScopeContext } from './scope-context.ts'
import type { ExtractionSummary, IngestionTrace, KnowledgeBaseTarget, ModelCallRecord, ModelCallValidationFailure, ReconciliationSummary, ResearchReportKnowledgeIngestionInput, ResearchReportKnowledgeIngestionResult, ResearchReportKnowledgeIngestionWorkflowOptions, ResearchReportInputResolver, ResolutionSummary, ReviewItem, SectionBatchSummary, SourceProposal, ThemeHandling } from './types.ts'

export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_ID = 'research-report-knowledge-ingestion'
export const RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION = '0.3'

type Candidate = EntityCandidate | RelationCandidate | ClaimCandidate
type Resolution = IngestionTrace['resolution'][number]
type PlannedResult = { changeSet: KnowledgeChangeSetV03; source: SourceProposal | null; plannedChanges: ResearchReportKnowledgeIngestionResult['plannedChanges']; safeCandidates: Candidate[] }

const EXTRACTION_RETRYABLE_CODES = new Set(['invalid_model_output', 'invalid_reference', 'invalid_semantics', 'invalid_confidence', 'ungrounded_candidate'] as const)
const VALIDATION_FEEDBACK_MESSAGE_LIMIT = 240

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function clone<T>(value: T): T { return structuredClone(value) }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function boundedValidationMessage(value: string): string { return value.trim().slice(0, VALIDATION_FEEDBACK_MESSAGE_LIMIT) }
function isRetryableExtractionValidationError(error: unknown): error is KnowledgeCurationError & { code: ModelCallValidationFailure['code'] } { return error instanceof KnowledgeCurationError && EXTRACTION_RETRYABLE_CODES.has(error.code as ModelCallValidationFailure['code']) }
function validationFailure(attempt: 1 | 2, error: KnowledgeCurationError & { code: ModelCallValidationFailure['code'] }): ModelCallValidationFailure { return { attempt, code: error.code, message: error.message.trim().slice(0, VALIDATION_FEEDBACK_MESSAGE_LIMIT) } }
function extractionWorkflowError(error: unknown): KnowledgeIngestionWorkflowError { return new KnowledgeIngestionWorkflowError(error instanceof KnowledgeCurationError ? error.code : 'curation_failed', error instanceof Error ? error.message : String(error), 'extraction') }
function actualModelCallCount(calls: ModelCallRecord[]): number { return calls.reduce((total, call) => total + 1 + call.retryCount, 0) }
function slug(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item' }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child)).digest('hex') }
function v03EntityId(candidate: EntityCandidate): string { return `entity:${slug(candidate.entityType)}-${slug(candidate.name)}-${digest({ type: candidate.entityType, name: candidate.name.toLocaleLowerCase(), aliases: candidate.aliases.map((item) => item.toLocaleLowerCase()).sort() }).slice(0, 8)}` }
function v03ObjectId(namespace: 'relation' | 'claim', value: unknown): string { return `${namespace}:${digest(value).slice(0, 24)}` }
function safeChangeSetId(identity: string): string { return `changeset-${digest(identity).slice(0, 24)}` }
function validInput(input: ResearchReportKnowledgeIngestionInput): void { if (!record(input) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || input.workflowRunId.includes('..')) throw new KnowledgeIngestionWorkflowError('invalid_input', 'workflowRunId must be path-safe', 'input_validation'); if (typeof input.knowledgeBaseId !== 'string' || input.knowledgeBaseId.trim() === '') throw new KnowledgeIngestionWorkflowError('invalid_input', 'knowledgeBaseId must be non-empty', 'input_validation'); if (!record(input.report) || !record(input.report.inputRef) || !record(input.report.suppliedMetadata)) throw new KnowledgeIngestionWorkflowError('invalid_input', 'report input and supplied metadata are required', 'input_validation'); const ref = input.report.inputRef; if (!['text', 'file', 'document_reference'].includes(String(ref.type)) || (ref.type === 'text' ? typeof ref.text !== 'string' : typeof ref.reference !== 'string' || ref.reference.trim() === '')) throw new KnowledgeIngestionWorkflowError('invalid_input', 'report input reference is invalid', 'input_validation'); if (!record(input.options) || !['commit', 'dry_run'].includes(input.options.mode) || typeof input.options.reprocess !== 'boolean') throw new KnowledgeIngestionWorkflowError('invalid_input', 'workflow options are invalid', 'input_validation') }
function emptyChanges(): ResearchReportKnowledgeIngestionResult['plannedChanges'] { return { sourceCreate: [], sourceMerge: [], knowledgeCreate: [], knowledgeUpdate: [], knowledgeSupersede: [], knowledgeSourceMerge: [] } }
function emptyCommitted(): ResearchReportKnowledgeIngestionResult['committedChanges'] { return { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 } }
function emptyThemeHandling(): ThemeHandling { return { dispositions: { resolved_existing: 0, resolved_multiple: 0, provisional_unresolved: 0, proposed_new: 0, ambiguous: 0 }, reviewItems: [] } }
function emptyBatches(): SectionBatchSummary { return { sectionCount: 0, batchCount: 0, chunkCount: 0, chunkIds: [], batches: [] } }
function emptyExtraction(): ExtractionSummary { return { entities: 0, relations: 0, claims: 0, batchesAttempted: 0, batchesSucceeded: 0, batchesFailed: 0 } }
function emptyResolution(): ResolutionSummary { return { existing_ref: 0, new_object_key: 0, ambiguous: 0, invalid: 0 } }
function emptyReconciliation(): ReconciliationSummary { return { groups: 0, candidates: 0, decisions: {}, classifications: {} } }
function blocked(input: ResearchReportKnowledgeIngestionInput, revision: number, rawRef: string, identity: string, calls: ModelCallRecord[], stage: string, error: unknown): ResearchReportKnowledgeIngestionResult { const item = error instanceof KnowledgeIngestionWorkflowError || error instanceof KnowledgeCurationError ? { code: error.code, message: error.message } : { code: 'workflow_error', message: error instanceof Error ? error.message : String(error) }; return { workflowRunId: input.workflowRunId, ingestionIdentity: identity, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: 'blocked', baseRevision: revision, finalRevision: revision, raw: { rawRef, persisted: false, created: false, reused: false }, source: null, reportUnderstanding: null, themeHandling: emptyThemeHandling(), batches: emptyBatches(), extraction: emptyExtraction(), consolidation: { before: 0, after: 0, duplicatesMerged: 0 }, referenceResolution: emptyResolution(), reconciliation: emptyReconciliation(), schemaGaps: [], reviewItems: [], plannedChanges: emptyChanges(), committedChanges: emptyCommitted(), validation: null, modelCalls: calls, failureStage: stage, errors: [item] } }
type SourceMetadata = { title?: string | null; publisher?: string | null; institution?: string | null; author?: string | null; publishedAt?: string | null; sourceUrl?: string | null }
type SourceAssessmentIdentity = Pick<ReportUnderstanding['sourceAssessment'], 'publisher' | 'institution' | 'author' | 'publishedAt'> | null
type SourceIdentity = { key: string; strongKey: string | null }
function normalizedText(value: string | null | undefined): string { return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '' }
function normalizedUrl(value: string | null | undefined): string { const raw = typeof value === 'string' ? value.trim() : ''; if (!raw) return ''; try { const url = new URL(raw); url.protocol = url.protocol.toLocaleLowerCase(); url.hostname = url.hostname.toLocaleLowerCase(); return url.toString() } catch { return raw } }
function deriveSourceIdentity(metadata: SourceMetadata, assessment: SourceAssessmentIdentity, rawRef: string): SourceIdentity {
  const fields = {
    url: normalizedUrl(metadata.sourceUrl),
    publishedAt: normalizedText(assessment?.publishedAt ?? metadata.publishedAt),
    title: normalizedText(metadata.title),
    publisher: normalizedText(assessment?.publisher ?? metadata.publisher),
    institution: normalizedText(assessment?.institution ?? metadata.institution),
    author: normalizedText(assessment?.author ?? metadata.author),
  }
  const strongKey = fields.url ? JSON.stringify(['url', fields.url]) : fields.title && fields.publishedAt ? JSON.stringify(['metadata', fields]) : null
  return { strongKey, key: strongKey ?? JSON.stringify(['sparse', fields, normalizedText(rawRef)]) }
}
function sourceFrom(assessment: ReportUnderstanding['sourceAssessment'], input: ResearchReportKnowledgeIngestionInput, rawRef: string, sourceId: string): KnowledgeSourceV03 { return { id: sourceId as KnowledgeSourceV03['id'], title: input.report.suppliedMetadata.title ?? 'Untitled research report', publisher: assessment.publisher ?? input.report.suppliedMetadata.publisher, institution: assessment.institution ?? input.report.suppliedMetadata.institution, author: assessment.author ?? input.report.suppliedMetadata.author, publishedAt: assessment.publishedAt ?? input.report.suppliedMetadata.publishedAt, url: input.report.suppliedMetadata.sourceUrl, sourceType: assessment.sourceType, sourceReliability: assessment.sourceReliability, rawRefs: [rawRef] as NonNullable<KnowledgeSourceV03['rawRefs']> } }
function sectionAndBatches(document: NormalizedResearchDocument, maxChars = 6000): { sections: NonNullable<NormalizedResearchDocument['sections']>; batches: ExtractionBatch[]; summary: SectionBatchSummary } {
  type Chunk = NormalizedResearchDocument['chunks'][number]
  type Section = NonNullable<NormalizedResearchDocument['sections']>[number]
  const groups = new Map<string, Chunk[]>()
  for (const chunk of document.chunks) {
    const key = text(chunk.section) || '(untitled)'
    groups.set(key, [...(groups.get(key) ?? []), chunk])
  }
  const sections: Section[] = [...groups.entries()].map(([title, chunks], index) => ({
    sectionId: `section-${String(index + 1).padStart(4, '0')}`,
    title: title === '(untitled)' ? null : title,
    chunkIds: chunks.map((chunk) => chunk.chunkId),
  }))
  const batches: ExtractionBatch[] = []
  let current: ExtractionBatch = { batchId: 'batch-0001', sections: [], chunks: [] }
  const flush = (): void => {
    if (current.chunks.length) batches.push(current)
    current = { batchId: `batch-${String(batches.length + 2).padStart(4, '0')}`, sections: [], chunks: [] }
  }
  const size = (chunks: Chunk[]): number => chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  for (const section of sections) {
    const sectionChunks = section.chunkIds.map((id) => document.chunks.find((chunk) => chunk.chunkId === id)!).filter(Boolean)
    if (current.chunks.length && size(current.chunks) + size(sectionChunks) > maxChars) flush()
    if (size(sectionChunks) <= maxChars) {
      current.sections.push({ ...section })
      current.chunks.push(...sectionChunks)
      continue
    }
    for (const chunk of sectionChunks) {
      if (current.chunks.length && size(current.chunks) + chunk.text.length > maxChars) flush()
      let batchSection = current.sections.find((item) => item.sectionId === section.sectionId)
      if (!batchSection) {
        batchSection = { sectionId: section.sectionId, title: section.title, chunkIds: [] }
        current.sections.push(batchSection)
      }
      batchSection.chunkIds.push(chunk.chunkId)
      current.chunks.push(chunk)
    }
  }
  flush()
  const summary: SectionBatchSummary = {
    sectionCount: sections.length,
    batchCount: batches.length,
    chunkCount: document.chunks.length,
    chunkIds: document.chunks.map((chunk) => chunk.chunkId),
    batches: batches.map((batch) => ({
      batchId: batch.batchId,
      sectionIds: batch.sections.map((section) => section.sectionId),
      chunkIds: batch.chunks.map((chunk) => chunk.chunkId),
      characterCount: size(batch.chunks),
    })),
  }
  return { sections, batches, summary }
}
function themeHandling(understanding: ReportUnderstanding): ThemeHandling { const result = emptyThemeHandling(); for (const item of understanding.themeHypotheses) { result.dispositions[item.disposition] += 1; if (item.disposition === 'proposed_new' || item.disposition === 'ambiguous') result.reviewItems.push({ category: item.disposition === 'proposed_new' ? 'theme_creation' : 'theme_ambiguity', mention: item.mention, reason: item.reason }) } return result }
function candidatesOf(extraction: ExtractKnowledgeOutput): Candidate[] { return [...extraction.entities, ...extraction.relations, ...extraction.claims] }
function candidateKey(candidate: Candidate): string { if ('entityType' in candidate) return JSON.stringify(['entity', candidate.entityType, candidate.name.toLocaleLowerCase().trim(), [...candidate.aliases].map((item) => item.toLocaleLowerCase().trim()).sort(), candidate.semanticFields]); if ('relationType' in candidate) return JSON.stringify(['relation', candidate.relationType, candidate.sourceMention.text.toLocaleLowerCase().trim(), candidate.targetMention.text.toLocaleLowerCase().trim(), candidate.attributes]); return JSON.stringify(['claim', candidate.claimType, candidate.statement.toLocaleLowerCase().trim(), candidate.subjectMentions.map((item) => item.text.toLocaleLowerCase().trim()), candidate.temporal, candidate.structuredValue]) }
function consolidate(values: Candidate[]): { values: Candidate[]; summary: { before: number; after: number; duplicatesMerged: number } } { const result: Candidate[] = []; const seen = new Map<string, Candidate>(); for (const candidate of values) { const key = candidateKey(candidate); const previous = seen.get(key); if (!previous) { seen.set(key, clone(candidate)); result.push(clone(candidate)); continue } previous.evidenceChunkRefs = [...new Set([...previous.evidenceChunkRefs, ...candidate.evidenceChunkRefs])].sort(); const target = result.find((item) => item.candidateId === previous.candidateId); if (target) target.evidenceChunkRefs = previous.evidenceChunkRefs } return { values: result, summary: { before: values.length, after: result.length, duplicatesMerged: values.length - result.length } } }
function entityMatch(context: KnowledgeContext, mention: string, type?: string | null): string[] { const needle = mention.trim().toLocaleLowerCase(); return context.entities.filter((entity) => (!type || entity.type === type) && [entity.id, entity.name, ...(entity.aliases ?? [])].some((value) => value.toLocaleLowerCase() === needle)).map((entity) => entity.id) }
function resolutionFor(candidate: Candidate, context: KnowledgeContext, entityTemp: Map<string, string>): Resolution {
  if ('entityType' in candidate) {
    const suggested = candidate.suggestedExistingRef
    if (suggested && context.entities.some((entity) => entity.id === suggested)) return { candidateId: candidate.candidateId, kind: 'entity', outcome: 'existing_ref', refs: [suggested], candidate }
    const matches = entityMatch(context, candidate.name, candidate.entityType)
    if (matches.length > 1) return { candidateId: candidate.candidateId, kind: 'entity', outcome: 'ambiguous', refs: [], candidate }
    if (matches.length === 1) return { candidateId: candidate.candidateId, kind: 'entity', outcome: 'existing_ref', refs: matches, candidate }
    const key = `new-entity-${candidate.candidateId}`
    entityTemp.set(candidate.candidateId, key)
    for (const name of [candidate.name, ...candidate.aliases]) entityTemp.set(name.trim().toLocaleLowerCase(), key)
    return { candidateId: candidate.candidateId, kind: 'entity', outcome: 'new_object_key', refs: [key], objectKey: key, candidate }
  }
  const resolveMention = (value: { text: string; existingRef?: string | null; entityType?: string | null }): string[] => {
    if (value.existingRef && context.existingRefs.includes(value.existingRef)) return [value.existingRef]
    const matches = entityMatch(context, value.text, value.entityType)
    if (matches.length === 1) return matches
    const temporary = entityTemp.get(value.text.trim().toLocaleLowerCase())
    return temporary ? [temporary] : matches
  }
  if ('relationType' in candidate) {
    const source = resolveMention(candidate.sourceMention)
    const target = resolveMention(candidate.targetMention)
    if (source.length !== 1 || target.length !== 1) return { candidateId: candidate.candidateId, kind: 'relation', outcome: source.length > 1 || target.length > 1 ? 'ambiguous' : 'invalid', refs: [], candidate }
    const existing = context.relations.filter((item) => item.type === candidate.relationType && item.sourceRef === source[0] && item.targetRef === target[0])
    return { candidateId: candidate.candidateId, kind: 'relation', outcome: existing.length ? 'existing_ref' : 'new_object_key', refs: [source[0], target[0], ...(existing.length ? [existing[0]!.id] : [])], objectKey: existing.length ? undefined : `new-relation-${candidate.candidateId}`, candidate }
  }
  const refs = candidate.subjectMentions.flatMap((item) => resolveMention(item))
  if (refs.length !== candidate.subjectMentions.length || new Set(refs).size !== refs.length) return { candidateId: candidate.candidateId, kind: 'claim', outcome: refs.length > candidate.subjectMentions.length ? 'ambiguous' : 'invalid', refs: [], candidate }
  const existing = context.claims?.filter((item) => item.claimType === candidate.claimType && item.statement === candidate.statement && item.subjectRefs.every((ref) => refs.includes(ref))) ?? []
  return { candidateId: candidate.candidateId, kind: 'claim', outcome: existing.length ? 'existing_ref' : 'new_object_key', refs: [...refs, ...(existing.length ? [existing[0]!.id] : [])], objectKey: existing.length ? undefined : `new-claim-${candidate.candidateId}`, candidate }
}
function preciseGroups(values: Candidate[], resolutions: Resolution[], context: KnowledgeContext): ReconciliationGroup[] {
  const eligible = values.filter((candidate) => {
    const resolution = resolutions.find((item) => item.candidateId === candidate.candidateId)
    return resolution?.outcome === 'existing_ref' || resolution?.outcome === 'new_object_key'
  })
  const groups: ReconciliationGroup[] = []
  for (let offset = 0; offset < eligible.length; offset += 8) {
    const slice = eligible.slice(offset, offset + 8)
    const candidates: ReconciliationCandidate[] = slice.map((candidate) => {
      const resolution = resolutions.find((item) => item.candidateId === candidate.candidateId)!
      return {
        candidateId: candidate.candidateId,
        kind: 'entityType' in candidate ? 'entity' : 'relationType' in candidate ? 'relation' : 'claim',
        semantic: clone(candidate) as unknown as JsonRecord,
        existingRefs: resolution.refs.filter((ref) => context.existingRefs.includes(ref)),
      }
    })
    const refs = new Set(candidates.flatMap((candidate) => candidate.existingRefs))
    const existingKnowledge = [...context.entities, ...context.relations, ...(context.claims ?? []), ...(context.sources ?? [])]
      .filter((item) => refs.has(item.id))
      .map((item) => clone(item) as unknown as JsonRecord)
    groups.push({ groupId: `reconciliation-${String(groups.length + 1).padStart(4, '0')}`, candidateIds: candidates.map((candidate) => candidate.candidateId), candidates, existingKnowledge })
  }
  return groups
}
function plannedStatus(trace: IngestionTrace): 'completed' | 'completed_with_review' { return trace.reviewItems.length || trace.schemaGaps.gaps.length ? 'completed_with_review' : 'completed' }

function reviewClosure(candidates: Candidate[], reviewItems: ReviewItem[]): ReviewItem[] {
  const entityByMention = new Map<string, string>()
  for (const candidate of candidates) if ('entityType' in candidate) for (const name of [candidate.name, ...candidate.aliases]) entityByMention.set(name.trim().toLocaleLowerCase(), candidate.candidateId)
  for (const candidate of candidates) if ('entityType' in candidate && candidate.semanticFields.schemaGap === true && !reviewItems.some((item) => item.candidateId === candidate.candidateId)) reviewItems.push({ candidateId: candidate.candidateId, category: 'schema_gap', reason: 'Candidate signalled material content requiring Schema Gap review', dependencyIds: [] })
  const dependencies = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    const refs = candidate.candidateId
    const required = new Set<string>()
    const mentions = 'relationType' in candidate ? [candidate.sourceMention, candidate.targetMention, ...candidate.contextMentions] : 'claimType' in candidate ? candidate.subjectMentions : []
    for (const mention of mentions) { const dependency = entityByMention.get(mention.text.trim().toLocaleLowerCase()); if (dependency && dependency !== refs) required.add(dependency) }
    dependencies.set(refs, required)
  }
  const reviewIds = new Set(reviewItems.map((item) => item.candidateId).filter((id): id is string => Boolean(id)))
  const queue = [...reviewIds]
  while (queue.length) {
    const root = queue.shift()!
    for (const [candidateId, required] of dependencies) if (required.has(root) && !reviewIds.has(candidateId)) { reviewIds.add(candidateId); queue.push(candidateId); reviewItems.push({ candidateId, category: 'dependency_review', reason: `Depends on candidate ${root} requiring review`, dependencyIds: [root] }) }
  }
  return reviewItems
}

function planChanges(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, trace: IngestionTrace, identity: string, modelCallCount: number): PlannedResult {
  const reviewIds = new Set(trace.reviewItems.map((item) => item.candidateId).filter((id): id is string => Boolean(id)))
  const decisionById = new Map(trace.reconciliation.decisions.map((item) => [item.candidateId, item]))
  const safe = trace.candidates.filter((candidate) => !reviewIds.has(candidate.candidateId) && !['user_review', 'duplicate', 'reject'].includes(decisionById.get(candidate.candidateId)?.decision ?? 'create'))
  const sourceIdentity = deriveSourceIdentity(input.report.suppliedMetadata, trace.reportUnderstanding.sourceAssessment, trace.document.rawRef)
  const allocatedSourceId = `source:doc-${digest(sourceIdentity.key).slice(0, 16)}`
  const sourceMatch = [...target.index.sources.values()].find((item) => {
    const existingIdentity = deriveSourceIdentity({ title: item.title === 'Untitled research report' ? null : item.title, publisher: item.publisher, institution: item.institution, author: item.author, publishedAt: item.publishedAt, sourceUrl: item.url }, null, item.rawRefs?.[0] ?? '')
    return sourceIdentity.strongKey !== null && sourceIdentity.strongKey === existingIdentity.strongKey || sourceIdentity.strongKey === null && sourceIdentity.key === existingIdentity.key
  })
  const existingSource = sourceMatch ?? target.index.sources.get(allocatedSourceId)
  const sourceId = existingSource?.id ?? allocatedSourceId
  const source = safe.length
    ? { sourceId, source: sourceFrom(trace.reportUnderstanding.sourceAssessment, input, trace.document.rawRef, sourceId), resolution: existingSource ? 'source_merge' as const : 'source_create' as const }
    : null
  const sourceOperations: KnowledgeChangeSetV03['sourceOperations'] = []
  const rawRef = trace.document.rawRef as `raw-sha256-${string}`
  if (source?.resolution === 'source_create') sourceOperations.push({ operationId: 'source-create', type: 'source_create', source: source.source })
  if (source?.resolution === 'source_merge' && existingSource && !(existingSource.rawRefs ?? []).includes(rawRef)) {
    sourceOperations.push({ operationId: 'source-merge', type: 'source_merge', sourceId: source.sourceId, expectedBeforeHash: hashKnowledgeObject(existingSource), addRawRefs: [rawRef] })
  }

  const resolutionById = new Map(trace.resolution.map((item) => [item.candidateId, item]))
  const entityRefs = new Map<string, string>()
  for (const candidate of safe) {
    if (!('entityType' in candidate)) continue
    const resolution = resolutionById.get(candidate.candidateId)
    if (resolution?.outcome === 'existing_ref') entityRefs.set(candidate.candidateId, resolution.refs[0]!)
    else entityRefs.set(candidate.candidateId, v03EntityId(candidate))
  }
  const mentionRefs = new Map<string, string>()
  for (const entity of target.index.entities.values()) {
    for (const name of [entity.name, ...(entity.aliases ?? [])]) mentionRefs.set(name.trim().toLocaleLowerCase(), entity.id)
  }
  for (const candidate of safe) {
    if (!('entityType' in candidate)) continue
    const ref = entityRefs.get(candidate.candidateId)!
    for (const name of [candidate.name, ...candidate.aliases]) mentionRefs.set(name.trim().toLocaleLowerCase(), ref)
  }

  const existingObject = (resolution: Resolution): KnowledgeEntityV03 | KnowledgeRelationV03 | KnowledgeClaimV03 | undefined => {
    if (resolution.kind === 'entity') return target.index.entities.get(resolution.refs[0]!)
    if (resolution.kind === 'relation') return target.index.relations.get(resolution.refs[resolution.refs.length - 1]!)
    return target.index.claims.get(resolution.refs[resolution.refs.length - 1]!)
  }
  const knowledgeOperations: KnowledgeChangeSetV03['knowledgeOperations'] = []
  for (const candidate of safe) {
    const resolution = resolutionById.get(candidate.candidateId)
    if (!resolution) continue
    const decision = decisionById.get(candidate.candidateId)
    if (decision && ['duplicate', 'reject', 'user_review'].includes(decision.decision)) continue
    const existing = existingObject(resolution)
    const existingId = existing?.id
    let id: string = existingId ?? ''
    if (!id || decision?.decision === 'keep_both' || decision?.decision === 'create') {
      id = 'entityType' in candidate ? entityRefs.get(candidate.candidateId)! : v03ObjectId('relationType' in candidate ? 'relation' : 'claim', candidate)
    }
    const refs = new Map<string, string>(mentionRefs)
    for (const [candidateId, canonical] of entityRefs) {
      refs.set(candidateId, canonical)
      refs.set(`new-entity-${candidateId}`, canonical)
    }
    const canonical = canonicalFrom(candidate, refs, sourceId, trace.document.rawRef, id)
    const operationId = `candidate-${candidate.candidateId}`
    if (decision?.decision === 'merge_source' && existing && source) {
      knowledgeOperations.push({ operationId, type: 'merge_source', knowledgeId: existing.id, expectedBeforeHash: hashKnowledgeObject(existing), addSourceRefs: [sourceId] })
    } else if (decision?.decision === 'update_state' && existing) {
      knowledgeOperations.push({ operationId, type: 'update', knowledgeId: existing.id, expectedBeforeHash: hashKnowledgeObject(existing), object: { ...canonical, id: existing.id } as never })
    } else if (decision?.decision === 'supersede' && existing && 'claimType' in canonical) {
      knowledgeOperations.push({ operationId, type: 'supersede', knowledgeId: existing.id, expectedBeforeHash: hashKnowledgeObject(existing), replacement: { ...canonical, id } as never })
    } else if (!existing || decision?.decision === 'keep_both' || decision?.decision === 'create') {
      knowledgeOperations.push({ operationId, type: 'create', object: canonical as never })
    }
  }
  const changeSet: KnowledgeChangeSetV03 = {
    changeSetId: safeChangeSetId(identity),
    workflowRunId: input.workflowRunId,
    knowledgeBaseId: input.knowledgeBaseId,
    schemaVersion: '0.3',
    storageFormatVersion: '1',
    expectedBaseRevision: target.handle.revision,
    requiresRawProvenance: true,
    sourceOperations,
    knowledgeOperations,
    ingestionContext: { workflowVersion: RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION, ingestionIdentity: identity, stages: 18, modelCalls: modelCallCount },
  }
  return { changeSet, source, plannedChanges: operationSummary(changeSet), safeCandidates: safe }
}
function operationSummary(changeSet: KnowledgeChangeSetV03): ResearchReportKnowledgeIngestionResult['plannedChanges'] { const result = emptyChanges(); for (const op of changeSet.sourceOperations) op.type === 'source_create' ? result.sourceCreate.push(op.source.id) : result.sourceMerge.push(op.sourceId); for (const op of changeSet.knowledgeOperations) op.type === 'create' ? result.knowledgeCreate.push(op.object.id) : op.type === 'update' ? result.knowledgeUpdate.push(op.knowledgeId) : op.type === 'supersede' ? result.knowledgeSupersede.push(op.knowledgeId) : result.knowledgeSourceMerge.push(op.knowledgeId); return result }
function canonicalFrom(candidate: Candidate, refs: Map<string, string>, sourceId: string, rawRef: string, id: string): KnowledgeEntityV03 | KnowledgeRelationV03 | KnowledgeClaimV03 {
  if ('entityType' in candidate) {
    const { schemaGap: _schemaGap, ...canonicalFields } = candidate.semanticFields
    return {
      ...canonicalFields,
      id: id as KnowledgeEntityV03['id'],
      type: candidate.entityType,
      name: candidate.name,
      aliases: candidate.aliases,
      ...(candidate.description ? { description: candidate.description } : {}),
      lifecycle: { status: 'active' },
    } as unknown as KnowledgeEntityV03
  }
  if ('relationType' in candidate) {
    const source = candidate.sourceMention.existingRef ?? refs.get(candidate.sourceMention.text) ?? ''
    const target = candidate.targetMention.existingRef ?? refs.get(candidate.targetMention.text) ?? ''
    return {
      id: id as KnowledgeRelationV03['id'],
      type: candidate.relationType,
      sourceRef: source as KnowledgeRelationV03['sourceRef'],
      targetRef: target as KnowledgeRelationV03['targetRef'],
      ...(Object.keys(candidate.attributes).length ? { attributes: candidate.attributes } : {}),
      sourceRefs: [`${sourceId}` as `source:${string}`],
      lifecycle: { status: 'active' },
    } as unknown as KnowledgeRelationV03
  }
  const subjectRefs = candidate.subjectMentions.map((mention) => mention.existingRef ?? refs.get(mention.text)).filter((ref): ref is string => Boolean(ref))
  return {
    id: id as KnowledgeClaimV03['id'],
    claimType: candidate.claimType,
    statement: candidate.statement,
    subjectRefs: subjectRefs as KnowledgeClaimV03['subjectRefs'],
    ...(candidate.temporal ? { temporal: candidate.temporal as unknown as KnowledgeClaimV03['temporal'] } : {}),
    ...(candidate.structuredValue ? { structuredValue: candidate.structuredValue as unknown as KnowledgeClaimV03['structuredValue'] } : {}),
    sourceRefs: [`${sourceId}` as `source:${string}`],
    provenance: [{ sourceRef: `${sourceId}` as `source:${string}`, rawRef: `${rawRef}` as `raw-sha256-${string}`, locator: null, chunkRef: candidate.evidenceChunkRefs[0] ?? null }],
    confidence: candidate.semanticConfidence,
    lifecycle: { status: 'active' },
  } as unknown as KnowledgeClaimV03
}

export class ResearchReportKnowledgeIngestionWorkflow {
  private readonly inputResolver: ResearchReportInputResolver
  private readonly validation: NonNullable<ResearchReportKnowledgeIngestionWorkflowOptions['validation']>
  private readonly writer: NonNullable<ResearchReportKnowledgeIngestionWorkflowOptions['writer']>
  private readonly clock: () => string
  private readonly logs = new KnowledgeIngestionLogStore()
  constructor(private readonly options: ResearchReportKnowledgeIngestionWorkflowOptions) { this.inputResolver = options.inputResolver ?? new DefaultResearchReportInputResolver(); this.clock = options.clock ?? (() => new Date().toISOString()); this.validation = options.validation ?? new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader() }); this.writer = options.writer ?? new KnowledgeWriter({ loader: new KnowledgeBaseLoader(), stagedStateValidator: createKnowledgeStagedStateValidator(this.validation as KnowledgeValidationSkill) }) }

  async execute(input: ResearchReportKnowledgeIngestionInput): Promise<ResearchReportKnowledgeIngestionResult> {
    const calls: ModelCallRecord[] = []; let target: KnowledgeBaseTarget | undefined; let rawRef = ''; let identity = ''; let raw = { persisted: false, created: false, reused: false }
    try {
      validInput(input); target = await this.options.targetResolver.resolve(input.knowledgeBaseId); if (target.handle.knowledgeBaseId !== input.knowledgeBaseId || target.handle.schemaVersion !== '0.3' || target.handle.storageFormatVersion !== '1') throw new KnowledgeIngestionWorkflowError('unsupported_schema', 'Workflow requires Schema 0.3 / Storage 1 native runtime', 'intake_target_resolution'); if (!(target.index instanceof KnowledgeIndexV03)) throw new KnowledgeIngestionWorkflowError('unsupported_schema', 'Workflow target must use native KnowledgeIndexV03', 'intake_target_resolution'); if (input.options.mode === 'commit' && (target.handle.status !== 'active' || !target.handle.writable)) throw new KnowledgeIngestionWorkflowError('target_not_writable', 'Commit requires an active writable Knowledge Base', 'intake_target_resolution')
      const resolved = await this.inputResolver.resolve(input.report.inputRef); rawRef = deriveRawIdentity(resolved.rawBytes).rawRef; if (input.options.mode === 'commit') { const archived = await archiveRaw(target.handle, { bytes: resolved.rawBytes, originalFilename: resolved.originalFilename, mediaType: resolved.mediaType, suppliedMetadata: input.report.suppliedMetadata }, { clock: this.clock }); raw = { persisted: true, created: !archived.reused, reused: Boolean(archived.reused) } }
      identity = `sha256:${digest(`${input.knowledgeBaseId}|${rawRef}|${RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION}`)}`; if (input.options.mode === 'commit' && !input.options.reprocess) { const previous = await this.logs.findSuccessfulByIdentity(target.handle, identity); if (previous) return this.replayedResult(input, target.handle.revision, identity, rawRef, raw, previous) }
      const document: NormalizedResearchDocument = { rawRef, suppliedMetadata: clone(input.report.suppliedMetadata), normalizedText: resolved.normalizedText, chunks: resolved.chunks }; const trace = await this.curate(input, target, document, calls); const planned = planChanges(input, target, trace, identity, actualModelCallCount(calls)); const validation = await this.validation.validateChangeSet(target.handle, planned.changeSet, input.options.mode === 'dry_run' ? { mode: 'dry_run', virtualRawRefs: [rawRef] } : { mode: 'commit' }); const base = this.result(input, target.handle.revision, identity, raw, trace, planned, validation.report, calls)
      if (validation.report.status === 'failed') { base.status = 'blocked'; base.failureStage = 'validation'; base.errors = validation.report.errors.map((item) => ({ code: item.code, message: item.message })); if (raw.persisted) await this.attachBlockedLog(base, input, target, identity, 'validation'); return base }
      if (input.options.mode === 'dry_run') return base; if (!validation.validatedChangeSet) throw new KnowledgeIngestionWorkflowError('validation_required', 'Commit requires a validated Schema 0.3 receipt', 'validation'); const write = await this.writer.write(target.handle, validation.validatedChangeSet); if (write.status === 'rejected' || write.status === 'failed') { base.status = 'blocked'; base.failureStage = 'writer'; base.errors = [{ code: write.error?.code ?? 'writer_failed', message: write.error?.message ?? `Writer returned ${write.status}` }]; if (raw.persisted) await this.attachBlockedLog(base, input, target, identity, 'writer'); return base } base.finalRevision = write.committedRevision; base.committedChanges = { sourceCreated: write.operations.sourceCreated.length, sourceMerged: write.operations.sourceMerged.length, knowledgeCreated: write.operations.knowledgeCreated.length, knowledgeUpdated: write.operations.knowledgeUpdated.length, knowledgeSuperseded: write.operations.knowledgeSuperseded.length, knowledgeSourceMerged: write.operations.knowledgeSourceMerged.length }; base.status = plannedStatus(trace); await this.logs.writeBlocked(target.handle, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, status: base.status, ingestionIdentity: identity, rawRef: base.raw.rawRef, ingestionContext: { workflowVersion: RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_VERSION, ingestionIdentity: identity, modelCalls: calls, plannedChanges: base.plannedChanges, committedChanges: base.committedChanges }, schemaGaps: base.schemaGaps, reviewItems: base.reviewItems }); return base
    } catch (error) { const result = blocked(input, target?.handle.revision ?? 0, rawRef, identity, calls, error instanceof KnowledgeIngestionWorkflowError ? error.stage ?? 'workflow' : 'workflow', error); result.raw = { rawRef, ...raw }; if (target && raw.persisted) await this.attachBlockedLog(result, input, target, identity, result.failureStage ?? 'workflow'); return result }
  }

  private beginCall(calls: ModelCallRecord[], operation: ModelCallRecord['operation'], groupId: string | undefined): ModelCallRecord { const item: ModelCallRecord = { operation, ...(groupId ? { groupId } : {}), attempted: true, succeeded: false, retryCount: 0 }; calls.push(item); return item }
  private async call<T>(calls: ModelCallRecord[], operation: ModelCallRecord['operation'], groupId: string | undefined, invoke: () => Promise<T>): Promise<T> { const item = this.beginCall(calls, operation, groupId); try { const result = await invoke(); item.succeeded = true; return result } catch (error) { if (error instanceof KnowledgeCurationError) throw error; throw new KnowledgeIngestionWorkflowError('curation_failed', error instanceof Error ? error.message : String(error), 'curation') } }
  private async extractBatch(input: ExtractKnowledgeInput, calls: ModelCallRecord[]): Promise<ExtractKnowledgeOutput> {
    const item = this.beginCall(calls, 'extractKnowledge', input.batch.batchId)
    try {
      const result = await this.options.curation.extractKnowledge(input)
      item.succeeded = true
      return result
    } catch (error) {
      if (!(error instanceof KnowledgeCurationError) || !isRetryableExtractionValidationError(error)) throw extractionWorkflowError(error)
      item.retryCount = 1
      item.validationFailures = [validationFailure(1, error)]
      try {
        const result = await this.options.curation.extractKnowledge(input, { validationFeedback: { attempt: 2, code: error.code, message: boundedValidationMessage(error.message) } })
        item.succeeded = true
        return result
      } catch (retryError) {
        if (retryError instanceof KnowledgeCurationError && isRetryableExtractionValidationError(retryError)) item.validationFailures.push(validationFailure(2, retryError))
        throw extractionWorkflowError(retryError)
      }
    }
  }
  private async curate(input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, document: NormalizedResearchDocument, calls: ModelCallRecord[]): Promise<IngestionTrace> { const access = new KnowledgeAccessSkill({ handle: target.handle, index: target.index }); const broadEntities = ['investment_theme', 'industry', 'company', 'product', 'technology'].flatMap((type) => access.searchEntities('', type)); const knowledgeContext = createKnowledgeScopeContext(target.handle, target.index); knowledgeContext.entities = broadEntities; const reportUnderstanding = await this.call(calls, 'understandReport', undefined, () => this.options.curation.understandReport({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, themeContext: knowledgeContext })); const theme = themeHandling(reportUnderstanding); const formed = sectionAndBatches(document); document.sections = formed.sections; const extracted: ExtractKnowledgeOutput = { entities: [], relations: [], claims: [] }; const extractionSummary = emptyExtraction(); for (const batch of formed.batches) { extractionSummary.batchesAttempted += 1; try { const result = await this.extractBatch({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, batch, reportUnderstanding, knowledgeContext }, calls); extracted.entities.push(...result.entities); extracted.relations.push(...result.relations); extracted.claims.push(...result.claims); extractionSummary.batchesSucceeded += 1 } catch (error) { extractionSummary.batchesFailed += 1; throw error } } extractionSummary.entities = extracted.entities.length; extractionSummary.relations = extracted.relations.length; extractionSummary.claims = extracted.claims.length; const consolidated = consolidate(candidatesOf(extracted)); const entityTemp = new Map<string, string>(); const resolutions = consolidated.values.map((candidate) => resolutionFor(candidate, knowledgeContext, entityTemp)); const preciseEntities = resolutions.filter((item) => item.outcome === 'existing_ref').flatMap((item) => item.refs).filter((ref) => target.index.entities.has(ref)); const preciseRelations = preciseEntities.flatMap((ref) => access.getRelations(ref)); const preciseClaims = preciseEntities.flatMap((ref) => access.getClaims(ref)); const preciseContext: KnowledgeContext = { ...knowledgeContext, relations: [...new Map([...knowledgeContext.relations, ...preciseRelations].map((item) => [item.id, item])).values()], claims: [...new Map([...(knowledgeContext.claims ?? []), ...preciseClaims].map((item) => [item.id, item])).values()] }; const precise = preciseGroups(consolidated.values, resolutions, preciseContext); const reconciliation = { decisions: [] as ReconciliationDecision[] }; for (const group of precise) { const result = await this.call(calls, 'reconcileKnowledge', group.groupId, () => this.options.curation.reconcileKnowledge({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, groups: [group], sourceAssessment: reportUnderstanding.sourceAssessment })); reconciliation.decisions.push(...result.decisions) } const gapCandidates = consolidated.values.filter((candidate) => 'entityType' in candidate && record(candidate.semanticFields) && candidate.semanticFields.schemaGap === true).map((candidate) => ({ candidateId: candidate.candidateId, kind: 'entity', semantic: candidate })); const schemaGaps = gapCandidates.length ? await this.call(calls, 'analyzeSchemaGaps', undefined, () => this.options.curation.analyzeSchemaGaps({ workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document, candidates: gapCandidates, knowledgeContext })) : { gaps: [] }; const reviewItems: ReviewItem[] = theme.reviewItems.map((item) => ({ category: item.category, reason: item.reason, dependencyIds: [] })); const reviewIds = new Set(resolutions.filter((item) => item.outcome === 'ambiguous' || item.outcome === 'invalid').map((item) => item.candidateId)); for (const resolution of resolutions.filter((item) => reviewIds.has(item.candidateId))) reviewItems.push({ candidateId: resolution.candidateId, category: resolution.outcome === 'ambiguous' ? 'reference_ambiguity' : 'invalid_reference', reason: `${resolution.outcome} reference resolution`, dependencyIds: [] }); for (const decision of reconciliation.decisions.filter((item) => item.requiresUserReview || item.decision === 'user_review')) reviewItems.push({ candidateId: decision.candidateId, category: decision.classification, reason: decision.reason, dependencyIds: [] }); return { document, knowledgeContext, themeHandling: theme, batches: formed.summary, extraction: extracted, candidates: consolidated.values, consolidation: consolidated.summary, resolution: resolutions, preciseGroups: precise, reconciliation, schemaGaps, reviewItems: reviewClosure(consolidated.values, reviewItems), reportUnderstanding }
  }


  private result(input: ResearchReportKnowledgeIngestionInput, revision: number, identity: string, raw: { persisted: boolean; created: boolean; reused: boolean }, trace: IngestionTrace, planned: PlannedResult, validation: ResearchReportKnowledgeIngestionResult['validation'], calls: ModelCallRecord[]): ResearchReportKnowledgeIngestionResult { const ref = emptyResolution(); for (const item of trace.resolution) ref[item.outcome] += 1; const reconciliation = emptyReconciliation(); reconciliation.groups = trace.preciseGroups.length; reconciliation.candidates = trace.reconciliation.decisions.length; for (const item of trace.reconciliation.decisions) { reconciliation.decisions[item.decision] = (reconciliation.decisions[item.decision] ?? 0) + 1; reconciliation.classifications[item.classification] = (reconciliation.classifications[item.classification] ?? 0) + 1 } return { workflowRunId: input.workflowRunId, ingestionIdentity: identity, knowledgeBaseId: input.knowledgeBaseId, mode: input.options.mode, status: plannedStatus(trace), baseRevision: revision, finalRevision: revision, raw: { rawRef: trace.document.rawRef, ...raw }, source: planned.source, reportUnderstanding: trace.reportUnderstanding, themeHandling: trace.themeHandling, batches: trace.batches, extraction: { ...emptyExtraction(), entities: trace.extraction.entities.length, relations: trace.extraction.relations.length, claims: trace.extraction.claims.length, batchesAttempted: trace.batches.batchCount, batchesSucceeded: trace.batches.batchCount, batchesFailed: 0 }, consolidation: trace.consolidation, referenceResolution: ref, reconciliation, schemaGaps: trace.schemaGaps.gaps, reviewItems: trace.reviewItems, plannedChanges: planned.plannedChanges, committedChanges: emptyCommitted(), validation, modelCalls: calls, errors: [] } }
  private replayedResult(input: ResearchReportKnowledgeIngestionInput, revision: number, identity: string, rawRef: string, raw: { persisted: boolean; created: boolean; reused: boolean }, previous: Record<string, unknown>): ResearchReportKnowledgeIngestionResult { const result = blocked(input, revision, rawRef, identity, [], '', new Error('replay')); result.status = previous.status === 'completed_with_review' ? 'completed_with_review' : 'completed'; result.failureStage = undefined; result.errors = []; result.raw = { rawRef, ...raw }; return result }
  private async attachBlockedLog(result: ResearchReportKnowledgeIngestionResult, input: ResearchReportKnowledgeIngestionInput, target: KnowledgeBaseTarget, identity: string, stage: string): Promise<void> { if (!result.raw.persisted) return; try { result.ingestionIdentity = identity; await this.logs.writeBlocked(target.handle, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, status: 'blocked', ingestionIdentity: identity, rawRef: result.raw.rawRef, failureStage: stage, errors: result.errors, modelCalls: result.modelCalls, reviewItems: result.reviewItems, schemaGaps: result.schemaGaps }) } catch (error) { result.errors.push({ code: 'ingestion_log_failed', message: error instanceof Error ? error.message : String(error) }) } }
}
