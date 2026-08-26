import type { NormalizedResearchDocument, ResearchDocumentChunk, SourceAssessment, SourceAssessmentInput, ContentRelevanceDecision, RelevanceInput, KnowledgeCandidate, ExtractionInput, KnowledgeAdmissionDecision, AdmissionInput, KnowledgeMappingResult, ConflictDecision, ConflictInput, SchemaGapInput, SchemaGapProposal, ExistingKnowledgeContext, SchemaGapType, SchemaGapGenerality, SchemaGapFrequency, SchemaGapAction } from './types.ts'
import { KnowledgeCurationError } from './errors.ts'
import { SOURCE_RELIABILITIES, SOURCE_TYPES } from '../../../packages/schemas/knowledge/index.ts'

const PRIMARY_SECONDARY = ['primary', 'secondary', 'unknown'] as const
const RELEVANCE_DECISIONS = ['relevant', 'contextual', 'irrelevant'] as const
const RELEVANCE_REASONS = ['research_relevant', 'useful_context', 'legal_disclaimer', 'template_content', 'unrelated_content', 'duplicate_content', 'navigation_content', 'other'] as const
const ADMISSION_REASONS = ['relevant_and_material', 'irrelevant', 'trivial_commonplace', 'low_information_value', 'insufficient_specificity', 'unsupported_generic_claim', 'transient_noise', 'duplicate_background', 'malformed_claim'] as const
const CANDIDATE_TYPES = ['entity', 'relation', 'intelligence', 'module_content'] as const
const INTELLIGENCE_TYPES = ['fact', 'forecast', 'viewpoint', 'trend', 'risk'] as const
const MAPPING_STATUSES = ['mapped', 'partially_mapped', 'unmapped'] as const
const CONFLICT_TYPES = ['none', 'duplicate', 'temporal_update', 'correction', 'definition_difference', 'fact_conflict', 'forecast_divergence', 'viewpoint_divergence', 'relation_conflict'] as const
const CONFLICT_RESOLUTIONS = ['create', 'update', 'supersede', 'merge_source', 'keep_both', 'reject', 'user_review'] as const
const SCHEMA_GAP_TYPES = ['vocabulary_gap', 'schema_gap', 'validation_gap', 'access_gap', 'projection_gap'] as const
const SCHEMA_GAP_GENERALITIES = ['local', 'cross_industry', 'universal'] as const
const SCHEMA_GAP_FREQUENCIES = ['first_seen', 'repeated'] as const
const SCHEMA_GAP_ACTIONS = ['no_action', 'data_convention_review', 'validation_review', 'access_interface_review', 'projection_review', 'architecture_review'] as const

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new KnowledgeCurationError('invalid_model_output', `${label} must be an object`)
  return value as RecordValue
}

function string(value: unknown, label: string, nonEmpty = true): string {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) throw new KnowledgeCurationError('invalid_model_output', `${label} must be a non-empty string`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  return string(value, label)
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw new KnowledgeCurationError('invalid_model_output', `${label} must be an array of non-empty strings`)
  return [...value]
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new KnowledgeCurationError('invalid_model_output', `${label} must be boolean`)
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new KnowledgeCurationError('invalid_model_output', `${label} has unsupported value`)
  return value as T
}

function confidence(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new KnowledgeCurationError('invalid_confidence', `${label} must be a finite number between 0 and 1`)
  return value
}

function safeIntermediateId(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new KnowledgeCurationError('invalid_reference', `${label} must be a non-empty string`)
  const safe = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.\.+/g, '_')
  if (!/^[A-Za-z0-9]/.test(safe)) throw new KnowledgeCurationError('invalid_reference', `${label} cannot produce a safe intermediate ID`)
  return safe
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function modelOrSuppliedMetadata(value: unknown, document: NormalizedResearchDocument, field: keyof NormalizedResearchDocument['suppliedMetadata']): string | null {
  return value === undefined ? document.suppliedMetadata[field] : nullableString(value, field)
}

function checkInputScope(workflowRunId: string | null, knowledgeBaseId: string, document: NormalizedResearchDocument): void {
  if (workflowRunId !== null) string(workflowRunId, 'workflowRunId')
  string(knowledgeBaseId, 'knowledgeBaseId')
  string(document.rawRef, 'document.rawRef')
  if (!Array.isArray(document.chunks) || document.chunks.length === 0) throw new KnowledgeCurationError('invalid_reference', 'document.chunks must be non-empty')
  const ids = new Set<string>()
  for (const chunk of document.chunks) {
    string(chunk.chunkId, 'chunk.chunkId')
    string(chunk.text, 'chunk.text', false)
    if (ids.has(chunk.chunkId)) throw new KnowledgeCurationError('invalid_reference', `Duplicate chunkId: ${chunk.chunkId}`)
    ids.add(chunk.chunkId)
  }
}

export function validateSourceAssessment(raw: unknown, input: SourceAssessmentInput): SourceAssessment {
  checkInputScope(input.workflowRunId, input.knowledgeBaseId, input.document)
  const value = object(raw, 'source assessment')
  const sourceType = enumValue(value.sourceType, SOURCE_TYPES, 'sourceType')
  const reliability = enumValue(value.sourceReliability, SOURCE_RELIABILITIES, 'sourceReliability')
  const primaryOrSecondary = enumValue(value.primaryOrSecondary, PRIMARY_SECONDARY, 'primaryOrSecondary')
  return {
    sourceAssessmentId: `source-assessment-${safeIntermediateId(input.workflowRunId, 'workflowRunId')}`,
    rawRef: input.document.rawRef,
    sourceType,
    publisher: modelOrSuppliedMetadata(value.publisher, input.document, 'publisher'),
    institution: modelOrSuppliedMetadata(value.institution, input.document, 'institution'),
    author: modelOrSuppliedMetadata(value.author, input.document, 'author'),
    publishedAt: modelOrSuppliedMetadata(value.publishedAt, input.document, 'publishedAt'),
    primaryOrSecondary,
    sourceReliability: reliability,
    sourceIdentityConfidence: confidence(value.sourceIdentityConfidence, 'sourceIdentityConfidence'),
    reasoning: strings(value.reasoning, 'reasoning'),
  }
}

export function validateRelevance(raw: unknown, input: RelevanceInput): ContentRelevanceDecision[] {
  checkInputScope(null, input.context.knowledgeBaseId, input.document)
  const values = Array.isArray(raw) ? raw : object(raw, 'relevance response').decisions
  if (!Array.isArray(values)) throw new KnowledgeCurationError('invalid_model_output', 'relevance response must contain decisions')
  const known = new Set(input.document.chunks.map((chunk) => chunk.chunkId))
  const seen = new Set<string>()
  const decisions = values.map((item, index) => {
    const value = object(item, `relevance decision ${index + 1}`)
    const chunkId = string(value.chunkId, 'chunkId')
    if (!known.has(chunkId)) throw new KnowledgeCurationError('invalid_reference', `Unknown chunkId: ${chunkId}`)
    if (seen.has(chunkId)) throw new KnowledgeCurationError('invalid_reference', `Duplicate relevance decision: ${chunkId}`)
    seen.add(chunkId)
    return { chunkId, decision: enumValue(value.decision, RELEVANCE_DECISIONS, 'decision'), reason: enumValue(value.reason, RELEVANCE_REASONS, 'reason'), reasoning: value.reasoning === undefined ? undefined : strings(value.reasoning, 'reasoning') }
  })
  if (seen.size !== known.size) throw new KnowledgeCurationError('invalid_reference', 'Every input chunk must receive exactly one relevance decision')
  return decisions
}

function chunkFor(candidateChunkId: string, chunks: ResearchDocumentChunk[]): ResearchDocumentChunk {
  const chunk = chunks.find((item) => item.chunkId === candidateChunkId)
  if (!chunk) throw new KnowledgeCurationError('invalid_reference', `Candidate references an unavailable chunk: ${candidateChunkId}`)
  return chunk
}

function sanitizeDraft(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  const draft = object(value, 'proposedKnowledge.object')
  const sanitized = { ...draft }
  delete sanitized.id
  delete sanitized.knowledgeId
  delete sanitized.sourceRefs
  delete sanitized.rawRefs
  return sanitized
}

export function validateCandidates(raw: unknown, input: ExtractionInput): KnowledgeCandidate[] {
  checkInputScope(input.workflowRunId, input.knowledgeBaseId, input.document)
  if (!Array.isArray(input.relevantChunks) || input.relevantChunks.length === 0) throw new KnowledgeCurationError('invalid_reference', 'relevantChunks must be non-empty')
  const relevantIds = new Set(input.relevantChunks.map((chunk) => chunk.chunkId))
  if ([...relevantIds].some((id) => !input.document.chunks.some((chunk) => chunk.chunkId === id))) throw new KnowledgeCurationError('invalid_reference', 'relevantChunks must belong to document')
  const values = Array.isArray(raw) ? raw : object(raw, 'candidate response').candidates
  if (!Array.isArray(values)) throw new KnowledgeCurationError('invalid_model_output', 'candidate response must contain candidates')
  return values.map((item, index) => {
    const value = object(item, `candidate ${index + 1}`)
    const provenance = object(value.provenance, 'provenance')
    const chunkId = string(provenance.chunkId, 'provenance.chunkId')
    if (!relevantIds.has(chunkId)) throw new KnowledgeCurationError('invalid_reference', `Candidate chunk is not relevant: ${chunkId}`)
    const chunk = chunkFor(chunkId, input.relevantChunks)
    const claim = object(value.claim, 'claim')
    const originalStatement = string(claim.originalStatement, 'claim.originalStatement')
    if (!normalizeWhitespace(chunk.text).includes(normalizeWhitespace(originalStatement))) throw new KnowledgeCurationError('ungrounded_candidate', `Candidate statement is not grounded in chunk ${chunkId}`)
    const temporalValue = value.temporal === undefined ? {} : object(value.temporal, 'temporal')
    const factorsValue = object(object(value.confidence, 'confidence').factors, 'confidence.factors')
    const confidenceValue = object(value.confidence, 'confidence')
    const resolution = value.entityResolution === null || value.entityResolution === undefined ? null : object(value.entityResolution, 'entityResolution')
    const candidateId = `candidate-${safeIntermediateId(input.workflowRunId, 'workflowRunId')}-${String(index + 1).padStart(4, '0')}`
    const candidateConfidence = {
      score: confidence(confidenceValue.score, 'confidence.score'),
      factors: {
        sourceReliability: input.sourceAssessment.sourceReliability,
        directness: confidence(factorsValue.directness, 'confidence.factors.directness'),
        corroboration: confidence(factorsValue.corroboration, 'confidence.factors.corroboration'),
        freshness: confidence(factorsValue.freshness, 'confidence.factors.freshness'),
        conflictStatus: confidence(factorsValue.conflictStatus, 'confidence.factors.conflictStatus'),
      },
      reasoning: strings(confidenceValue.reasoning, 'confidence.reasoning'),
    }
    const modelPage = provenance.page
    const page = typeof modelPage === 'string' || typeof modelPage === 'number' ? modelPage === chunk.page ? modelPage : chunk.page ?? null : chunk.page ?? null
    return {
      candidateId,
      workflowRunId: input.workflowRunId,
      knowledgeBaseId: input.knowledgeBaseId,
      candidateType: enumValue(value.candidateType, CANDIDATE_TYPES, 'candidateType'),
      intelligenceType: value.intelligenceType === null ? null : enumValue(value.intelligenceType, INTELLIGENCE_TYPES, 'intelligenceType'),
      subjectRefs: strings(value.subjectRefs, 'subjectRefs'),
      claim: { normalizedStatement: string(claim.normalizedStatement, 'claim.normalizedStatement'), originalStatement },
      temporal: { asOf: nullableString(temporalValue.asOf, 'temporal.asOf'), periodStart: nullableString(temporalValue.periodStart, 'temporal.periodStart'), periodEnd: nullableString(temporalValue.periodEnd, 'temporal.periodEnd'), forecastHorizon: nullableString(temporalValue.forecastHorizon, 'temporal.forecastHorizon') },
      provenance: { rawRef: input.document.rawRef, sourceRef: null, page, section: chunk.section ?? null, locator: chunk.locator ?? null, chunkId },
      sourceAssessmentRef: input.sourceAssessment.sourceAssessmentId,
      confidence: candidateConfidence,
      entityResolution: resolution === null ? null : { mention: string(resolution.mention, 'entityResolution.mention'), suggestedEntityRef: nullableString(resolution.suggestedEntityRef, 'entityResolution.suggestedEntityRef'), confidence: confidence(resolution.confidence, 'entityResolution.confidence') },
      proposedKnowledge: { object: sanitizeDraft(object(value.proposedKnowledge, 'proposedKnowledge').object) },
      mappingStatus: 'unmapped',
      admission: 'pending',
      notes: value.notes === undefined ? [] : strings(value.notes, 'notes'),
    }
  })
}

export function validateAdmission(raw: unknown, input: AdmissionInput): KnowledgeAdmissionDecision {
  const value = object(raw, 'admission response')
  if (value.candidateId !== undefined && value.candidateId !== input.candidate.candidateId) throw new KnowledgeCurationError('invalid_reference', 'Admission candidateId does not match the trusted candidate')
  const dimensions = object(value.dimensions, 'dimensions')
  return {
    candidateId: input.candidate.candidateId,
    decision: enumValue(value.decision, ['admit', 'reject'] as const, 'decision'),
    reason: enumValue(value.reason, ADMISSION_REASONS, 'reason'),
    reasoning: strings(value.reasoning, 'reasoning'),
    dimensions: {
      relevance: string(dimensions.relevance, 'dimensions.relevance'),
      specificity: string(dimensions.specificity, 'dimensions.specificity'),
      informationGain: string(dimensions.informationGain, 'dimensions.informationGain'),
      evidenceDensity: string(dimensions.evidenceDensity, 'dimensions.evidenceDensity'),
      temporalScopePrecision: string(dimensions.temporalScopePrecision, 'dimensions.temporalScopePrecision'),
      researchUtility: string(dimensions.researchUtility, 'dimensions.researchUtility'),
    },
  }
}

const ALLOWED_DRAFT_KEYS: Record<string, string[]> = {
  entity: ['type', 'name', 'description', 'tags', 'taxonomyRefs', 'metadata'],
  relation: ['type', 'source', 'target', 'attributes', 'confidence'],
  intelligence: ['type', 'entityRefs', 'confidence', 'lifecycle', 'statement', 'normalizedStatement', 'originalStatement', 'temporal', 'value', 'metric', 'unit', 'asOf', 'periodStart', 'periodEnd', 'forecastHorizon', 'attribution'],
  module_content: ['type', 'targetEntity', 'schemaId', 'columns', 'rows'],
}

export function validateMappings(raw: unknown, admitted: KnowledgeCandidate[]): KnowledgeMappingResult[] {
  const values = Array.isArray(raw) ? raw : object(raw, 'mapping response').mappings
  if (!Array.isArray(values)) throw new KnowledgeCurationError('invalid_model_output', 'mapping response must contain mappings')
  const byId = new Map(admitted.map((candidate) => [candidate.candidateId, candidate]))
  const seen = new Set<string>()
  const results = values.map((item, index) => {
    const value = object(item, `mapping ${index + 1}`)
    const candidateId = string(value.candidateId ?? admitted[index]?.candidateId, 'candidateId')
    const candidate = byId.get(candidateId)
    if (!candidate) throw new KnowledgeCurationError('invalid_reference', `Mapping references a candidate that was not admitted: ${candidateId}`)
    if (seen.has(candidateId)) throw new KnowledgeCurationError('invalid_reference', `Duplicate mapping for candidate: ${candidateId}`)
    seen.add(candidateId)
    const proposed = object(value.proposedKnowledge, 'proposedKnowledge')
    const objectValue = proposed.object === null || proposed.object === undefined ? null : sanitizeDraft(proposed.object)
    const allowed = new Set(ALLOWED_DRAFT_KEYS[candidate.candidateType === 'module_content' ? 'module_content' : candidate.candidateType])
    const unmappedFields = objectValue === null ? [] : Object.keys(objectValue).filter((key) => !allowed.has(key))
    const safeObject = objectValue === null ? null : Object.fromEntries(Object.entries(objectValue).filter(([key]) => allowed.has(key)))
    const requestedStatus = enumValue(value.mappingStatus, MAPPING_STATUSES, 'mappingStatus')
    const mappingStatus = safeObject === null || requestedStatus === 'unmapped' ? 'unmapped' : unmappedFields.length > 0 || requestedStatus === 'partially_mapped' ? 'partially_mapped' : 'mapped'
    const finalObject = mappingStatus === 'unmapped' ? null : safeObject
    return { ...candidate, proposedKnowledge: { object: finalObject }, mappingStatus, notes: [...candidate.notes, ...(value.notes === undefined ? [] : strings(value.notes, 'mapping.notes'))], ...(unmappedFields.length > 0 ? { unmappedFields } : {}) } as KnowledgeMappingResult
  })
  if (seen.size !== admitted.length) throw new KnowledgeCurationError('invalid_reference', 'Every admitted candidate must receive exactly one mapping result')
  return results
}

function comparison(value: unknown, hints: ExistingKnowledgeContext['comparisonHints']): ConflictDecision['comparison'] {
  const source = value === undefined ? {} : object(value, 'comparison')
  return {
    sameEntity: source.sameEntity === undefined ? hints?.sameEntity ?? false : boolean(source.sameEntity, 'comparison.sameEntity'),
    sameMetric: source.sameMetric === undefined ? hints?.sameMetric ?? false : boolean(source.sameMetric, 'comparison.sameMetric'),
    samePeriod: source.samePeriod === undefined ? hints?.samePeriod ?? false : boolean(source.samePeriod, 'comparison.samePeriod'),
    sameUnit: source.sameUnit === undefined ? hints?.sameUnit ?? false : boolean(source.sameUnit, 'comparison.sameUnit'),
    sameRegion: source.sameRegion === undefined ? hints?.sameRegion ?? false : boolean(source.sameRegion, 'comparison.sameRegion'),
    sameDefinition: source.sameDefinition === undefined ? hints?.sameDefinition ?? false : boolean(source.sameDefinition, 'comparison.sameDefinition'),
    sameMethodology: source.sameMethodology === undefined ? hints?.sameMethodology ?? false : boolean(source.sameMethodology, 'comparison.sameMethodology'),
  }
}

export function validateConflict(raw: unknown, input: ConflictInput): ConflictDecision {
  const value = object(raw, 'conflict response')
  const matched = new Set(input.existing.matchedKnowledge.map((item) => item.knowledgeId))
  const refs = value.existingKnowledgeRefs === undefined ? [] : strings(value.existingKnowledgeRefs, 'existingKnowledgeRefs')
  if (refs.some((ref) => !matched.has(ref))) throw new KnowledgeCurationError('invalid_reference', 'Conflict response references Knowledge outside supplied context')
  const conflictType = enumValue(value.conflictType, CONFLICT_TYPES, 'conflictType')
  let resolution = enumValue(value.resolution, CONFLICT_RESOLUTIONS, 'resolution')
  const comparisonResult = comparison(value.comparison, input.existing.comparisonHints)
  let requiresUserReview = boolean(value.requiresUserReview, 'requiresUserReview')
  if (refs.length === 0) {
    resolution = 'create'
    requiresUserReview = false
  } else if (conflictType === 'duplicate') {
    resolution = 'reject'
    requiresUserReview = false
  } else if (conflictType === 'forecast_divergence' || conflictType === 'viewpoint_divergence') {
    resolution = 'keep_both'
    requiresUserReview = false
  } else if (conflictType === 'correction') {
    const authoritativeCorrection = ['official_disclosure', 'company_official'].includes(input.sourceAssessment.sourceType)
    if (authoritativeCorrection) resolution = 'supersede'
    else {
      resolution = 'user_review'
      requiresUserReview = true
    }
  } else if (conflictType === 'fact_conflict') {
    {
      resolution = 'user_review'
      requiresUserReview = true
    }
  }
  if (requiresUserReview) resolution = 'user_review'
  return {
    decisionId: `conflict-${safeIntermediateId(input.candidate.workflowRunId, 'workflowRunId')}-${safeIntermediateId(input.candidate.candidateId, 'candidateId')}`,
    knowledgeBaseId: input.existing.knowledgeBaseId,
    candidateId: input.candidate.candidateId,
    existingKnowledgeRefs: [...new Set(refs)],
    conflictType,
    resolution,
    comparison: comparisonResult,
    reason: string(value.reason, 'reason'),
    decisionConfidence: confidence(value.decisionConfidence, 'decisionConfidence'),
    requiresUserReview,
  }
}

function gapArray(raw: unknown): unknown[] {
  const values = Array.isArray(raw) ? raw : object(raw, 'schema gap response').gaps
  if (!Array.isArray(values)) throw new KnowledgeCurationError('invalid_model_output', 'schema gap response must contain gaps')
  return values
}

export function validateSchemaGaps(raw: unknown, input: SchemaGapInput): SchemaGapProposal[] {
  const known = new Set(input.candidates.map((candidate) => candidate.candidateId))
  return gapArray(raw).map((item, index) => {
    const value = object(item, `schema gap ${index + 1}`)
    const refs = strings(value.candidateRefs, 'candidateRefs')
    if (refs.some((ref) => !known.has(ref))) throw new KnowledgeCurationError('invalid_reference', 'Schema Gap references an unavailable candidate')
    const observed = object(value.observedInformation, 'observedInformation')
    const limitation = object(value.currentLimitation, 'currentLimitation')
    const direction = object(value.suggestedDirection, 'suggestedDirection')
    return {
      gapId: `schema-gap-${safeIntermediateId(input.workflowRunId, 'workflowRunId')}-${String(index + 1).padStart(4, '0')}`,
      workflowRunId: input.workflowRunId,
      knowledgeBaseId: input.knowledgeBaseId,
      candidateRefs: [...new Set(refs)],
      gapType: enumValue(value.gapType, SCHEMA_GAP_TYPES, 'gapType') as SchemaGapType,
      observedInformation: { description: string(observed.description, 'observedInformation.description'), examples: strings(observed.examples, 'observedInformation.examples') },
      currentLimitation: { description: string(limitation.description, 'currentLimitation.description') },
      suggestedDirection: { description: string(direction.description, 'suggestedDirection.description') },
      affectedKnowledgeTypes: strings(value.affectedKnowledgeTypes, 'affectedKnowledgeTypes'),
      affectedIndustries: strings(value.affectedIndustries, 'affectedIndustries'),
      generality: enumValue(value.generality, SCHEMA_GAP_GENERALITIES, 'generality') as SchemaGapGenerality,
      frequency: enumValue(value.frequency, SCHEMA_GAP_FREQUENCIES, 'frequency') as SchemaGapFrequency,
      recommendedAction: enumValue(value.recommendedAction, SCHEMA_GAP_ACTIONS, 'recommendedAction') as SchemaGapAction,
    }
  })
}
