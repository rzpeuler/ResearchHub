import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { CanonicalKnowledgeRefV04, EntityRefV04, EventTypeV04, ObservationTypeV04, ReasoningEdgeTypeV04, RelationRefV04, ThesisStatusV04, ExternalIdentifierV04, KillCriterionV04 } from '../schema/domain-v04.ts'
import type { CompetitionAvailableCellV1, CompetitionCellKnowledgeRefV1, CompetitionColumnV1, CompetitionMarketCapCellV1, CompetitionAnnualRevenueCellV1, CompetitionUnavailableCellV1 } from '../schema/competition-module-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1 } from '../schema/competition-module-v04.ts'

export type SemanticProductionClaimType = 'fact' | 'forecast' | 'viewpoint' | 'trend' | 'risk' | 'assumption' | 'thesis' | 'catalyst'

/** Producer-facing semantic output. IDs in this contract are local proposal keys only. */
export interface SemanticProductionProposal {
  readonly proposalId: string
  readonly kind: 'entity' | 'claim' | 'relation' | 'source' | 'event' | 'observation' | 'thesis' | 'reasoning_edge'
  readonly claimType?: SemanticProductionClaimType
  readonly subjectKey: string
  readonly statement?: string
  readonly entityType?: 'company' | 'industry' | 'product' | 'technology' | 'person' | 'institution' | 'security'
  readonly entityName?: string
  readonly externalIdentifiers?: readonly ExternalIdentifierV04[]
  readonly relationType?: string
  readonly targetKey?: string
  readonly eventType?: EventTypeV04
  readonly participantKeys?: readonly string[]
  readonly observationType?: ObservationTypeV04
  readonly metricRef?: string
  readonly value?: string | number | boolean | null
  readonly unit?: string | null
  readonly period?: string | null
  readonly fiscalPeriod?: string
  readonly estimateValue?: string | number | boolean | null
  readonly currency?: string | null
  readonly institutionKey?: string
  readonly analystKey?: string
  readonly publishedAt?: string
  readonly estimateHorizon?: string | null
  readonly revisionOfProposalId?: string | null
  readonly contributingProposalIds?: readonly string[]
  readonly consensusAsOf?: string
  readonly consensusMean?: number
  readonly consensusMedian?: number | null
  readonly consensusHigh?: number | null
  readonly consensusLow?: number | null
  readonly consensusCount?: number
  readonly consensusDispersion?: number | null
  readonly thesisTitle?: string
  readonly thesisStatus?: ThesisStatusV04
  /** Confirmed criterion revision; accepted only from thesis_criterion_confirmed for one existing Thesis. */
  readonly criterionRevision?: KillCriterionV04
  readonly edgeType?: ReasoningEdgeTypeV04
  readonly sourceProposalId?: string
  /** Producer-owned binding to an existing canonical ReasoningEdge source endpoint. */
  readonly existingSourceRef?: CanonicalKnowledgeRefV04
  /** Producer-owned binding to an existing canonical ReasoningEdge target endpoint. */
  readonly existingTargetRef?: CanonicalKnowledgeRefV04
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly sourceCandidateIds?: readonly string[]
  /** Optional producer-owned binding to an existing canonical Claim. */
  readonly existingKnowledgeRefs?: readonly string[]
  /** Producer-owned bindings to existing canonical Source and Raw evidence. */
  readonly existingEvidenceBindings?: readonly { readonly sourceRef: `source:${string}`; readonly rawRef: `raw-sha256-${string}`; readonly locator?: string }[]
  readonly temporal?: unknown
  readonly structuredValue?: Readonly<Record<string, unknown>> | null
  readonly confidence?: number
  readonly probability?: number
  readonly supportsProposalIds?: readonly string[]
  readonly dependsOnProposalIds?: readonly string[]
  readonly contradictsProposalIds?: readonly string[]
  readonly semanticKey?: string
  /** Explicit generic intent to update one existing canonical Claim in place. */
  readonly resolution?: 'update' | 'supersede' | 'contradict' | 'review'
}

export type ReasoningEdgeProductionProposal = Omit<SemanticProductionProposal, 'kind' | 'subjectKey'> & { readonly kind: 'reasoning_edge'; readonly subjectKey?: string }
export type SemanticProductionInputProposal =
  | ReasoningEdgeProductionProposal
  | (Omit<SemanticProductionProposal, 'kind' | 'subjectKey'> & { readonly kind: Exclude<SemanticProductionProposal['kind'], 'reasoning_edge'>; readonly subjectKey: string })

/** A local selector keeps producer IDs out of canonical Knowledge until Gateway resolution. */
export type CompetitionModuleEntitySelectorV1 =
  | { readonly localKey: string; readonly existingRef?: never }
  | { readonly existingRef: EntityRefV04; readonly localKey?: never }

export type CompetitionModuleRelationSelectorV1 =
  | { readonly proposalId: string; readonly existingRef?: never }
  | { readonly existingRef: RelationRefV04; readonly proposalId?: never }

export type CompetitionModuleKnowledgeSelectorV1 =
  | { readonly proposalId: string; readonly existingRef?: never }
  | { readonly existingRef: CompetitionCellKnowledgeRefV1; readonly proposalId?: never }

export type CompetitionModuleAvailableCellV1 =
  | (Omit<CompetitionAvailableCellV1, 'knowledgeRefs'> & { readonly knowledgeRefs: readonly CompetitionModuleKnowledgeSelectorV1[] })
  | (Omit<CompetitionMarketCapCellV1, 'knowledgeRefs'> & { readonly knowledgeRefs: readonly CompetitionModuleKnowledgeSelectorV1[] })
  | (Omit<CompetitionAnnualRevenueCellV1, 'knowledgeRefs'> & { readonly knowledgeRefs: readonly CompetitionModuleKnowledgeSelectorV1[] })

export type CompetitionModuleCellProposalV1 = CompetitionModuleAvailableCellV1 | CompetitionUnavailableCellV1

export interface CompetitionModuleRowProposalV1 {
  readonly company: CompetitionModuleEntitySelectorV1
  readonly businessExposure: CompetitionModuleRelationSelectorV1
  readonly cells: Readonly<Record<string, CompetitionModuleCellProposalV1>>
}

/** Producer-facing, closed-shape input for a canonical competition Module. */
export interface CompetitionModuleProductionProposal {
  readonly proposalId: string
  readonly kind: 'module'
  readonly targetIndustry: CompetitionModuleEntitySelectorV1
  readonly schemaId: typeof COMPETITION_MODULE_SCHEMA_ID_V1
  readonly columns: readonly CompetitionColumnV1[]
  readonly rows: readonly CompetitionModuleRowProposalV1[]
  /** Optional direct evidence; canonical sourceRefs are also derived from referenced Knowledge. */
  readonly sourceCandidateIds?: readonly string[]
  readonly existingEvidenceBindings?: readonly { readonly sourceRef: `source:${string}`; readonly rawRef: `raw-sha256-${string}`; readonly locator?: string }[]
}

export type KnowledgeProductionProposal = SemanticProductionInputProposal | CompetitionModuleProductionProposal

export interface SemanticResolutionDecision {
  readonly outcome: 'equivalent' | 'supersedes' | 'contradicts' | 'uncertain'
  readonly reason: string
}

export type SemanticResolver = (input: {
  readonly proposal: SemanticProductionProposal
  readonly existing: readonly Record<string, unknown>[]
  readonly evidence: readonly Record<string, unknown>[]
}) => Promise<SemanticResolutionDecision> | SemanticResolutionDecision

export interface ProductionEntityInput {
  readonly localKey: string
  readonly entityType: 'company' | 'industry' | 'product' | 'technology' | 'person' | 'institution' | 'security'
  readonly name: string
  readonly aliases?: readonly string[]
  readonly semanticFields?: Readonly<Record<string, unknown>>
  readonly externalIdentifiers?: readonly ExternalIdentifierV04[]
  /** Optional producer-supplied canonical root binding; it is always type-checked by the Gateway. */
  readonly existingEntityRef?: string
}

export interface ProductionEvidenceBinding {
  readonly localSourceId: string
  readonly source: NormalizedResearchSource
  readonly originalFilename?: string
  readonly mediaType?: string
  /** Optional exact locator retained with Source/Raw provenance. */
  readonly locator?: string
}

export interface KnowledgeProductionInput {
  readonly handle: KnowledgeBaseHandle
  readonly producerType: string
  readonly producerRunId: string
  readonly schemaProfile: { readonly schemaVersion: '0.4'; readonly storageFormatVersion: '1'; readonly requiresRawProvenance: true }
  readonly entity: ProductionEntityInput
  readonly proposals: readonly KnowledgeProductionProposal[]
  readonly evidenceBindings: readonly ProductionEvidenceBinding[]
  readonly asOf?: string
  readonly now?: () => string
  readonly semanticResolver?: SemanticResolver
  readonly reviewProducerType?: string
  /** Resolve proposals without changing canonical Knowledge when false. */
  readonly writeKnowledge?: boolean
  /** Block the whole run before ReviewCase or Writer side effects if any intent is unresolved. */
  readonly requireAllResolved?: boolean
}

export interface ResolutionIntentSummary {
  readonly intentId: string
  readonly proposalId?: string
  readonly localKey?: string
  readonly disposition: 'bound_existing' | 'created_new' | 'review_required' | 'skipped'
  readonly targetRef?: string
  readonly reason: string
}

export interface KnowledgeProductionOutcome {
  readonly status: 'committed' | 'already_committed' | 'no_changes' | 'blocked' | 'failed'
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly baseRevision: number
  readonly changeSetId?: string
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly sourceRefsByLocalId: Readonly<Record<string, string>>
  readonly claimRefsByProposalId: Readonly<Record<string, string>>
  readonly entityRefsByLocalKey: Readonly<Record<string, string>>
  /** Every terminal Gateway outcome exposes the producer proposal to canonical Relation mapping. */
  readonly relationRefsByProposalId: Readonly<Record<string, string>>
  /** Gateway emits this mapping for every terminal outcome; it is optional on hand-built compatibility outcomes. */
  readonly moduleRefsByProposalId?: Readonly<Record<string, string>>
  readonly eventRefsByProposalId?: Readonly<Record<string, string>>
  readonly observationRefsByProposalId?: Readonly<Record<string, string>>
  readonly thesisRefsByProposalId?: Readonly<Record<string, string>>
  readonly reasoningEdgeRefsByProposalId?: Readonly<Record<string, string>>
  readonly resolutionIntents: readonly ResolutionIntentSummary[]
  readonly errors: readonly string[]
}
