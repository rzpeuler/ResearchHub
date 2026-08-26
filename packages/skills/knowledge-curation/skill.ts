import { KnowledgeCurationError } from './errors.ts'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from './model.ts'
import { ADMISSION_PROMPT } from './prompts/admission.ts'
import { CONFLICT_PROMPT } from './prompts/conflict.ts'
import { EXTRACTION_PROMPT } from './prompts/extraction.ts'
import { MAPPING_PROMPT } from './prompts/mapping.ts'
import { RELEVANCE_PROMPT } from './prompts/relevance.ts'
import { SCHEMA_GAP_PROMPT } from './prompts/schema-gap.ts'
import { SOURCE_ASSESSMENT_PROMPT } from './prompts/source-assessment.ts'
import { validateAdmission, validateCandidates, validateConflict, validateMappings, validateRelevance, validateSchemaGaps, validateSourceAssessment } from './validation.ts'
import type { AdmissionInput, ConflictDecision, ConflictInput, ContentRelevanceDecision, ExtractionInput, KnowledgeAdmissionDecision, KnowledgeCandidate, KnowledgeMappingResult, MappingInput, NormalizedResearchDocument, RelevanceInput, SchemaGapInput, SchemaGapProposal, SourceAssessment, SourceAssessmentInput } from './types.ts'

export interface KnowledgeCurationSkillOptions {
  model: KnowledgeCurationModel
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new KnowledgeCurationError('invalid_reference', `${label} must be a non-empty string`)
  return value
}

function assertDocumentScope(document: NormalizedResearchDocument, knowledgeBaseId: string): void {
  nonEmpty(document.rawRef, 'document.rawRef')
  nonEmpty(knowledgeBaseId, 'knowledgeBaseId')
  if (!Array.isArray(document.chunks)) throw new KnowledgeCurationError('invalid_reference', 'document.chunks must be an array')
}

function assertSourceBinding(sourceAssessment: SourceAssessment, document: NormalizedResearchDocument, knowledgeBaseId: string): void {
  assertDocumentScope(document, knowledgeBaseId)
  if (sourceAssessment.rawRef !== document.rawRef) throw new KnowledgeCurationError('invalid_reference', 'Source Assessment rawRef does not match the trusted document')
}

function assertCandidateBinding(candidate: KnowledgeCandidate, knowledgeBaseId: string): void {
  if (candidate.knowledgeBaseId !== knowledgeBaseId) throw new KnowledgeCurationError('invalid_reference', 'Candidate knowledgeBaseId does not match the trusted scope')
  if (candidate.workflowRunId.trim() === '' || candidate.candidateId.trim() === '') throw new KnowledgeCurationError('invalid_reference', 'Candidate workflowRunId and candidateId are required')
}

export class KnowledgeCurationSkill {
  constructor(private readonly options: KnowledgeCurationSkillOptions) {
    if (!options?.model || typeof options.model.invoke !== 'function') throw new KnowledgeCurationError('model_error', 'KnowledgeCurationSkill requires an injected KnowledgeCurationModel')
  }

  private async invoke(operation: KnowledgeCurationModelRequest['operation'], instruction: string, input: unknown, expectedOutputContract: string): Promise<unknown> {
    try {
      return await this.options.model.invoke({ operation, instruction, input, expectedOutputContract })
    } catch (error) {
      if (error instanceof KnowledgeCurationError) throw error
      throw new KnowledgeCurationError('model_error', error instanceof Error ? error.message : String(error), error)
    }
  }

  async assessSource(input: SourceAssessmentInput): Promise<SourceAssessment> {
    assertDocumentScope(input.document, input.knowledgeBaseId)
    const raw = await this.invoke('assess_source', SOURCE_ASSESSMENT_PROMPT, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document: input.document }, 'SourceAssessment')
    return validateSourceAssessment(raw, input)
  }

  async filterRelevantContent(input: RelevanceInput): Promise<ContentRelevanceDecision[]> {
    assertSourceBinding(input.sourceAssessment, input.document, input.context.knowledgeBaseId)
    const raw = await this.invoke('filter_relevance', RELEVANCE_PROMPT, { document: input.document, context: input.context, sourceAssessment: input.sourceAssessment }, 'ContentRelevanceDecision[]')
    return validateRelevance(raw, input)
  }

  async extractKnowledgeCandidates(input: ExtractionInput): Promise<KnowledgeCandidate[]> {
    assertSourceBinding(input.sourceAssessment, input.document, input.knowledgeBaseId)
    if (input.context && input.context.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeCurationError('invalid_reference', 'KnowledgeScopeContext does not match the trusted scope')
    const raw = await this.invoke('extract_candidates', EXTRACTION_PROMPT, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, document: input.document, sourceAssessment: input.sourceAssessment, relevantChunks: input.relevantChunks, context: input.context }, 'KnowledgeCandidate[]')
    return validateCandidates(raw, input)
  }

  async assessKnowledgeAdmission(input: AdmissionInput): Promise<KnowledgeAdmissionDecision> {
    assertCandidateBinding(input.candidate, input.context.knowledgeBaseId)
    if (input.sourceAssessment.rawRef !== input.candidate.provenance.rawRef) throw new KnowledgeCurationError('invalid_reference', 'Source Assessment rawRef does not match candidate provenance')
    const raw = await this.invoke('assess_admission', ADMISSION_PROMPT, { candidate: input.candidate, sourceAssessment: input.sourceAssessment, context: input.context }, 'KnowledgeAdmissionDecision')
    return validateAdmission(raw, input)
  }

  async mapKnowledgeCandidates(input: MappingInput): Promise<KnowledgeMappingResult[]> {
    const candidates = input.candidates ?? (input.candidate ? [input.candidate] : [])
    if (candidates.length === 0) throw new KnowledgeCurationError('invalid_reference', 'At least one candidate is required for mapping')
    for (const candidate of candidates) {
      assertCandidateBinding(candidate, input.context.knowledgeBaseId)
      if (candidate.admission !== 'admit') throw new KnowledgeCurationError('unsupported_mapping', `Candidate is not admitted: ${candidate.candidateId}`)
    }
    const raw = await this.invoke('map_candidates', MAPPING_PROMPT, { candidates, context: input.context }, 'KnowledgeMappingResult[]')
    return validateMappings(raw, candidates)
  }

  async analyzeKnowledgeConflicts(input: ConflictInput): Promise<ConflictDecision> {
    assertCandidateBinding(input.candidate, input.existing.knowledgeBaseId)
    if (input.existing.candidateId !== input.candidate.candidateId) throw new KnowledgeCurationError('invalid_reference', 'ExistingKnowledgeContext candidateId does not match candidate')
    if (input.sourceAssessment.rawRef !== input.candidate.provenance.rawRef) throw new KnowledgeCurationError('invalid_reference', 'Source Assessment rawRef does not match candidate provenance')
    const raw = await this.invoke('analyze_conflicts', CONFLICT_PROMPT, { candidate: input.candidate, existingKnowledgeContext: input.existing, sourceAssessment: input.sourceAssessment }, 'ConflictDecision')
    return validateConflict(raw, input)
  }

  async detectSchemaGaps(input: SchemaGapInput): Promise<SchemaGapProposal[]> {
    if (input.context.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeCurationError('invalid_reference', 'KnowledgeScopeContext does not match the trusted scope')
    for (const candidate of input.candidates) assertCandidateBinding(candidate, input.knowledgeBaseId)
    const raw = await this.invoke('detect_schema_gaps', SCHEMA_GAP_PROMPT, { workflowRunId: input.workflowRunId, knowledgeBaseId: input.knowledgeBaseId, candidates: input.candidates, context: input.context }, 'SchemaGapProposal[]')
    return validateSchemaGaps(raw, input)
  }
}
