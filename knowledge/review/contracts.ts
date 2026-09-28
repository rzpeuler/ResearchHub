import type { KnowledgeClaimV03, KnowledgeEntityV03, KnowledgeRelationV03 } from '../schema/domain.ts'
import type { ClaimTypeV04, ThesisStatusV04 } from '../schema/domain-v04.ts'
import type { ClaimCandidate, EntityCandidate, RelationCandidate } from '../../skills/knowledge-curation/contracts.ts'
import type { KillCriterionAssessment, RefreshEvidenceRelation, ThesisRefreshTransition } from '../../skills/thesis_refresh/contracts.ts'

export type ReviewCaseStatus = 'open'
export type ReviewCaseProducerType = string
export type ReviewCaseActionability = 'knowledge_decision' | 'research_followup' | 'schema_design'
export type ReviewCaseCategory = 'invalid_reference' | 'invalid_semantics' | 'relation_cardinality' | 'schema_gap' | 'theme_creation' | 'theme_ambiguity' | 'reconciliation_review' | 'other'
export type ReviewCaseOrigin = 'extraction_rejection' | 'consolidation' | 'consolidation_mirror' | 'knowledge_resolution' | 'semantic_case' | 'planner' | 'dependency_isolation'
export type ReviewProposalKind = 'entity' | 'relation' | 'claim'

export interface RawDocumentBlockEvidenceBinding {
  readonly kind: 'raw_document_block'
  readonly rawRef: string
  readonly documentId: string
  readonly blockId: string
}
export interface CanonicalResearchEvidenceBinding {
  readonly kind: 'canonical_research_evidence'
  readonly sourceRef: string
  readonly rawRef: string
  readonly evidenceRef?: string
  readonly locator?: string
}
export type ReviewEvidenceBinding = RawDocumentBlockEvidenceBinding | CanonicalResearchEvidenceBinding

export type ReviewClaimType = ClaimCandidate['claimType'] | Extract<ClaimTypeV04, 'assumption' | 'catalyst'>
export type ReviewClaimCandidate = Omit<ClaimCandidate, 'claimType'> & { readonly claimType: ReviewClaimType }
export type ReviewSemanticPayload = EntityCandidate | RelationCandidate | ReviewClaimCandidate
export interface ReviewSemanticProposal {
  readonly proposalId: string
  readonly proposalKind: ReviewProposalKind
  readonly semanticType: EntityCandidate['entityType'] | RelationCandidate['relationType'] | ReviewClaimType
  readonly semanticPayload: ReviewSemanticPayload
  readonly evidenceBindings: readonly ReviewEvidenceBinding[]
  readonly dependencyRefs: readonly string[]
}

export interface ExistingEntityProjection {
  readonly kind: 'entity'
  readonly type: KnowledgeEntityV03['type']
  readonly name: string
  readonly aliases: readonly string[]
  readonly description?: string | null
  readonly ticker?: string | null
  readonly exchange?: string | null
  readonly legalName?: string | null
  readonly definition?: string | null
  readonly inclusionCriteria?: readonly string[]
  readonly exclusionCriteria?: readonly string[]
}
export interface ExistingRelationProjection {
  readonly kind: 'relation'
  readonly type: KnowledgeRelationV03['type']
  readonly sourceRef: string
  readonly targetRef: string
  readonly attributes?: Readonly<Record<string, unknown>> | null
}
export interface ExistingClaimProjection {
  readonly kind: 'claim'
  readonly claimType: KnowledgeClaimV03['claimType']
  readonly statement: string
  readonly subjectRefs: readonly string[]
  readonly temporal?: KnowledgeClaimV03['temporal'] | null
  readonly structuredValue?: Readonly<Record<string, unknown>> | null
}
export type ExistingKnowledgeProjectionPayload = ExistingEntityProjection | ExistingRelationProjection | ExistingClaimProjection
export interface ExistingKnowledgeProjection {
  readonly canonicalRef: string
  readonly kind: ReviewProposalKind
  readonly semanticType: string
  readonly payload: ExistingKnowledgeProjectionPayload
}

export interface ReviewCaseClassification {
  readonly category: ReviewCaseCategory
  readonly actionability: ReviewCaseActionability
  readonly origin: ReviewCaseOrigin
  readonly stage: string
  readonly rationale: string
}
export interface ReviewCaseResolutionContext {
  readonly existingKnowledgeProjections: readonly ExistingKnowledgeProjection[]
  readonly schemaVersionAtCreation: '0.3' | '0.4'
  readonly knowledgeBaseRevisionAtCreation: number
  readonly context?: Readonly<Record<string, string | number | boolean | null>>
}
export interface ReviewCaseImpact {
  readonly dependentProposalCount: number
  readonly affectedProposalRefs: readonly string[]
}
export interface ThesisReviewScope {
  readonly thesisRef: string
  readonly rootClaimRef: `claim:${string}`
  readonly affectedClaimRefs: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly reviewedEvidence: readonly ThesisReviewedEvidence[]
  readonly candidateTransition: ThesisRefreshTransition
  readonly asOf: string
  readonly proposedThesisStatus?: ThesisStatusV04
  readonly killCriterionAssessments?: readonly KillCriterionAssessment[]
  /** Canonical evaluator bindings that authorize an invalidation proposal. */
  readonly killCriterionBindings?: readonly KillCriterionReviewBindingV1[]
}
export interface KillCriterionReviewBindingV1 {
  readonly conditionId: string
  readonly revision: number
  readonly definitionHash: string
  readonly evaluatedValueIdentity: string
  readonly evidenceRef: string
  readonly value: number
  readonly metricRef: string
  readonly unit: string
  readonly period: string
  readonly sourceRef: string
  readonly rawRef: string
  readonly locator: string
  readonly publishedAt: string
  readonly targetClaimRefs: readonly string[]
  readonly numericValueVersionVerified: true
  readonly asOf: string
}
export interface ThesisReviewedEvidence {
  readonly evidenceRef: string
  readonly relation: RefreshEvidenceRelation
  readonly targetClaimRefs: readonly string[]
}
export interface ReviewCaseAttributeConflict {
  readonly fields: readonly string[]
  readonly left: Readonly<Record<string, unknown>>
  readonly right: Readonly<Record<string, unknown>>
}
export interface ReviewCaseAdvisory {
  readonly recommendation?: string
  readonly support?: Readonly<Record<string, number | readonly string[]>>
  readonly suggestedNextAction?: string
  readonly recommendationReason?: string
  readonly novelty?: string
  readonly attributeConflict?: ReviewCaseAttributeConflict
}
export interface ReviewCaseState { readonly status: ReviewCaseStatus }

export interface ReviewCase {
  readonly version: '0.1'
  readonly reviewCaseId: string
  readonly knowledgeBaseId: string
  readonly producerType: ReviewCaseProducerType
  readonly producerRunId: string
  readonly createdAt: string
  readonly classification: ReviewCaseClassification
  readonly rootProposal: ReviewSemanticProposal
  readonly suspendedProposalBundle: { readonly dependentProposals: readonly ReviewSemanticProposal[] }
  readonly resolutionContext: ReviewCaseResolutionContext
  readonly impact: ReviewCaseImpact
  readonly thesisScope?: ThesisReviewScope
  readonly advisory?: ReviewCaseAdvisory
  readonly state: ReviewCaseState
}
export type ReviewCaseV01 = ReviewCase

export interface ReviewRunManifest {
  readonly version: '0.1'
  readonly knowledgeBaseId: string
  readonly producerType: ReviewCaseProducerType
  readonly producerRunId: string
  readonly reviewCaseCount: number
  readonly caseIds: readonly string[]
  readonly deterministicSetHash: string
  readonly createdAt: string
  readonly schemaVersionAtCreation: '0.3' | '0.4'
  readonly knowledgeBaseRevisionAtCreation: number
}
