import type { EntityType, IntelligenceType, ModuleType, RelationType, SourceReliability, SourceType } from '../../../packages/schemas/knowledge/index.ts'

export type CurationOperation =
  | 'assess_source'
  | 'filter_relevance'
  | 'extract_candidates'
  | 'assess_admission'
  | 'map_candidates'
  | 'analyze_conflicts'
  | 'detect_schema_gaps'

export interface ResearchDocumentMetadata {
  title: string | null
  publisher: string | null
  institution: string | null
  author: string | null
  publishedAt: string | null
  sourceUrl: string | null
}

export interface ResearchDocumentChunk {
  chunkId: string
  text: string
  page?: string | number | null
  section?: string | null
  locator?: string | null
}

export interface NormalizedResearchDocument {
  rawRef: string
  suppliedMetadata: ResearchDocumentMetadata
  normalizedText: string
  chunks: ResearchDocumentChunk[]
}

export interface KnowledgeScopeContext {
  knowledgeBaseId: string
  schemaVersion: string
  taxonomySummary: string[]
  supportedEntityTypes: EntityType[]
  supportedIntelligenceTypes: IntelligenceType[]
  supportedRelationTypes: RelationType[]
  supportedModuleTypes: ModuleType[]
  domainHints?: string[]
}

export interface SourceAssessmentInput {
  workflowRunId: string
  knowledgeBaseId: string
  document: NormalizedResearchDocument
}

export interface SourceAssessment {
  sourceAssessmentId: string
  rawRef: string
  sourceType: SourceType
  publisher: string | null
  institution: string | null
  author: string | null
  publishedAt: string | null
  primaryOrSecondary: 'primary' | 'secondary' | 'unknown'
  sourceReliability: SourceReliability
  sourceIdentityConfidence: number
  reasoning: string[]
}

export interface RelevanceInput {
  document: NormalizedResearchDocument
  context: KnowledgeScopeContext
  sourceAssessment: SourceAssessment
}

export type ContentRelevanceDecisionValue = 'relevant' | 'contextual' | 'irrelevant'
export type ContentRelevanceReason =
  | 'research_relevant'
  | 'useful_context'
  | 'legal_disclaimer'
  | 'template_content'
  | 'unrelated_content'
  | 'duplicate_content'
  | 'navigation_content'
  | 'other'

export interface ContentRelevanceDecision {
  chunkId: string
  decision: ContentRelevanceDecisionValue
  reason: ContentRelevanceReason
  reasoning?: string[]
}

export interface CandidateClaim {
  normalizedStatement: string
  originalStatement: string
}

export interface CandidateTemporalContext {
  asOf: string | null
  periodStart: string | null
  periodEnd: string | null
  forecastHorizon: string | null
}

export interface CandidateProvenance {
  rawRef: string
  sourceRef: string | null
  page: string | number | null
  section: string | null
  locator: string | null
  chunkId: string
}

export interface CandidateConfidenceFactors {
  sourceReliability: SourceReliability
  directness: number
  corroboration: number
  freshness: number
  conflictStatus: number
}

export interface CandidateConfidence {
  score: number
  factors: CandidateConfidenceFactors
  reasoning: string[]
}

export interface EntityResolutionSuggestion {
  mention: string
  suggestedEntityRef: string | null
  confidence: number
}

export type CurationCandidateType = 'entity' | 'relation' | 'intelligence' | 'module_content'

export interface KnowledgeCandidate {
  candidateId: string
  workflowRunId: string
  knowledgeBaseId: string
  candidateType: CurationCandidateType
  intelligenceType: IntelligenceType | null
  subjectRefs: string[]
  claim: CandidateClaim
  temporal: CandidateTemporalContext
  provenance: CandidateProvenance
  sourceAssessmentRef: string
  confidence: CandidateConfidence
  entityResolution: EntityResolutionSuggestion | null
  proposedKnowledge: { object: Record<string, unknown> | null }
  mappingStatus: 'mapped' | 'partially_mapped' | 'unmapped'
  admission: 'admit' | 'reject' | 'pending'
  notes: string[]
}

export interface ExtractionInput {
  workflowRunId: string
  knowledgeBaseId: string
  document: NormalizedResearchDocument
  sourceAssessment: SourceAssessment
  relevantChunks: ResearchDocumentChunk[]
  context?: KnowledgeScopeContext
}

export type AdmissionReason =
  | 'relevant_and_material'
  | 'irrelevant'
  | 'trivial_commonplace'
  | 'low_information_value'
  | 'insufficient_specificity'
  | 'unsupported_generic_claim'
  | 'transient_noise'
  | 'duplicate_background'
  | 'malformed_claim'

export interface KnowledgeAdmissionDecision {
  candidateId: string
  decision: 'admit' | 'reject'
  reason: AdmissionReason
  reasoning: string[]
  dimensions: {
    relevance: string
    specificity: string
    informationGain: string
    evidenceDensity: string
    temporalScopePrecision: string
    researchUtility: string
  }
}

export interface AdmissionInput {
  candidate: KnowledgeCandidate
  sourceAssessment: SourceAssessment
  context: KnowledgeScopeContext
}

export interface MappingInput {
  candidates?: KnowledgeCandidate[]
  candidate?: KnowledgeCandidate
  context: KnowledgeScopeContext
}

export interface KnowledgeMappingResult extends KnowledgeCandidate {
  mappingStatus: 'mapped' | 'partially_mapped' | 'unmapped'
  proposedKnowledge: { object: Record<string, unknown> | null }
  unmappedFields?: string[]
}

export interface ExistingKnowledgeMatch {
  knowledgeId: string
  kind: 'entity' | 'relation' | 'intelligence' | 'module'
  type: string
  object: Record<string, unknown>
  semanticHash: string
}

export interface ExistingKnowledgeContext {
  knowledgeBaseId: string
  candidateId: string
  matchedKnowledge: ExistingKnowledgeMatch[]
  comparisonHints?: {
    sameEntity?: boolean
    sameMetric?: boolean
    samePeriod?: boolean
    sameUnit?: boolean
    sameRegion?: boolean
    sameDefinition?: boolean
    sameMethodology?: boolean
  }
}

export type ConflictType =
  | 'none'
  | 'duplicate'
  | 'temporal_update'
  | 'correction'
  | 'definition_difference'
  | 'fact_conflict'
  | 'forecast_divergence'
  | 'viewpoint_divergence'
  | 'relation_conflict'

export type ConflictResolution = 'create' | 'update' | 'supersede' | 'merge_source' | 'keep_both' | 'reject' | 'user_review'

export interface ConflictDecision {
  decisionId: string
  knowledgeBaseId: string
  candidateId: string
  existingKnowledgeRefs: string[]
  conflictType: ConflictType
  resolution: ConflictResolution
  comparison: {
    sameEntity: boolean
    sameMetric: boolean
    samePeriod: boolean
    sameUnit: boolean
    sameRegion: boolean
    sameDefinition: boolean
    sameMethodology: boolean
  }
  reason: string
  decisionConfidence: number
  requiresUserReview: boolean
}

export interface ConflictInput {
  candidate: KnowledgeCandidate
  existing: ExistingKnowledgeContext
  sourceAssessment: SourceAssessment
}

export type SchemaGapType = 'vocabulary_gap' | 'schema_gap' | 'validation_gap' | 'access_gap' | 'projection_gap'
export type SchemaGapGenerality = 'local' | 'cross_industry' | 'universal'
export type SchemaGapFrequency = 'first_seen' | 'repeated'
export type SchemaGapAction = 'no_action' | 'data_convention_review' | 'validation_review' | 'access_interface_review' | 'projection_review' | 'architecture_review'

export interface SchemaGapProposal {
  gapId: string
  workflowRunId: string
  knowledgeBaseId: string
  candidateRefs: string[]
  gapType: SchemaGapType
  observedInformation: { description: string; examples: string[] }
  currentLimitation: { description: string }
  suggestedDirection: { description: string }
  affectedKnowledgeTypes: string[]
  affectedIndustries: string[]
  generality: SchemaGapGenerality
  frequency: SchemaGapFrequency
  recommendedAction: SchemaGapAction
}

export interface SchemaGapInput {
  workflowRunId: string
  knowledgeBaseId: string
  candidates: KnowledgeCandidate[]
  context: KnowledgeScopeContext
}
