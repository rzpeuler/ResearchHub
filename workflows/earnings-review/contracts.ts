import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchCompanyIdentity, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { EastmoneyEstimateSourceRequest, EastmoneyReportAcquisitionResult } from '../../plugins/research-acquisition/expectations/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { EarningsPeriod, EarningsReviewReasoningTelemetry, EarningsReviewSection, EarningsImpactAssessment } from '../../skills/earnings-review/index.ts'
import type { EarningsFinancialQualitySummary } from '../../skills/earnings-review/financial-quality/contracts.ts'
import type { ExternalIdentifierV04 } from '../../knowledge/schema/domain-v04.ts'
import type { ConsensusSnapshot, EstimatePoint, GuidanceRange, SegmentKpiDeltaInput } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EarningsExpectationAnalysis } from './expectations-contracts.ts'
import type { EarningsValuationImpactAnalysis, ThesisFilterReasoning } from './valuation-impact-thesis-filter-contracts.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'
import type { EarningsExpectationsAcquisitionSource } from './expectations-acquisition.ts'
import type { ManagementCommunicationAcquisitionSources } from '../management-communication-acquisition/contracts.ts'
import type { ManagementCommunicationResearchInput, ManagementCommunicationResearchResult } from './management-communication.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { EarningsDataPayload } from '../../plugins/research-acquisition/earnings-data.ts'
import type { ManagementCommunicationDataCompositionOptions, ManagementCommunicationDataPayload } from '../../plugins/research-acquisition/management-communication-data.ts'

export interface EstimateRevisionLink { readonly oldEstimateId: string; readonly newEstimateId: string }

/** Explicit, caller-owned report-only expectations input. It is intentionally not a public App or Plugin contract. */
export interface EarningsReviewExpectationsBundle {
  readonly sources: readonly NormalizedResearchSource[]
  readonly estimates?: readonly EstimatePoint[]
  readonly consensusSnapshots?: readonly ConsensusSnapshot[]
  readonly priorEstimateInstitutionKeys?: readonly string[]
  readonly estimateRevisionLinks?: readonly EstimateRevisionLink[]
  readonly guidances?: readonly GuidanceRange[]
  readonly currentGuidanceIds?: readonly string[]
  readonly segmentKpiComparisons?: readonly SegmentKpiDeltaInput[]
  readonly resultPublishedAt?: string
}

export interface EarningsEastmoneyExpectationSource {
  acquire(request: EastmoneyEstimateSourceRequest): Promise<EastmoneyReportAcquisitionResult>
}

export interface EarningsReviewWorkflowInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly securityIdentity?: VerifiedSecurityIdentity
  readonly fiscalYear: number
  readonly period: EarningsPeriod
  readonly asOf?: string
  readonly reportRoot: string
  readonly acquisitionPlugins: readonly ResearchAcquisitionPlugin[]
  readonly akshare?: AkshareDataClient
  readonly dataResolver?: DataResolver<EarningsDataPayload>
  readonly dataResolverFactory?: (context: { readonly company: ResearchCompanyIdentity; readonly fiscalYear: number; readonly period: EarningsPeriod; readonly asOf: string; readonly now: () => string; readonly signal?: AbortSignal }) => DataResolver<EarningsDataPayload>
  readonly reasoningExecutor?: ReasoningExecutor
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly maxSources?: number
  readonly writeKnowledge?: boolean
  readonly useStructuredKnowledge?: boolean
  readonly externalIdentifiers?: readonly ExternalIdentifierV04[]
  readonly expectations?: EarningsReviewExpectationsBundle
  readonly eastmoneyExpectationSource?: EarningsEastmoneyExpectationSource
  /** AKShare-backed THS -> EastMoney expectations acquisition. Caller-owned expectations still take precedence. */
  readonly earningsExpectationsSource?: EarningsExpectationsAcquisitionSource
  /** Existing D2-001 source seam; the normal application runtime supplies it. */
  readonly managementCommunicationSources?: ManagementCommunicationAcquisitionSources
  readonly managementCommunicationDataResolverFactory?: (options: ManagementCommunicationDataCompositionOptions) => DataResolver<ManagementCommunicationDataPayload>
  readonly managementCommunication?: ManagementCommunicationResearchInput
  readonly managementCommunicationLookbackDays?: number
}

export interface EarningsReviewTelemetry {
  readonly reasoning: EarningsReviewReasoningTelemetry
  readonly assessmentCount: number
  readonly validAssessmentCount: number
  readonly durableAssessmentCount: number
  readonly proposalCandidateCount: number
  readonly acceptedProposalCount: number
  readonly canonicalSourceCount: number
  readonly canonicalClaimCount: number
  readonly officialEvidenceStatus: 'available' | 'unavailable' | 'future_filtered'
  readonly structuredFinancialEvidenceStatus: 'available' | 'unavailable'
  readonly consensusStatus: 'available' | 'unavailable'
  readonly expectationStatus: 'not_provided' | 'available' | 'partial' | 'unavailable'
  readonly expectationInputMode: 'none' | 'caller' | 'automatic'
  readonly expectationAcquisitionStatus: 'not_attempted' | 'available' | 'partial' | 'unavailable' | 'failed'
  readonly expectationEstimateCount: number
  readonly expectationInstitutionCount: number
  readonly expectationConsensusSnapshotCount: number
  readonly expectationRevisionLinkCount: number
  readonly expectationDiagnosticCount: number
  readonly actualConsensusComparisonCount: number
  readonly actualPriorEstimateComparisonCount: number
  readonly estimateRevisionCount: number
  readonly guidanceRevisionCount: number
  readonly guidanceConsensusComparisonCount: number
  readonly segmentKpiComparisonCount: number
  readonly managementCommunicationStatus: 'not_attempted' | 'available' | 'partial' | 'unavailable' | 'failed'
  readonly managementCommunicationAcquisitionAttempted: boolean
  readonly managementCommentaryDeltaCount: number
  readonly managementQaClusterCount: number
  readonly managementExecutionAssessmentCount: number
  readonly valuationImpactCount: number
  readonly valuationRefreshRequired: boolean
  readonly thesisImpactCount: number
  readonly unmatchedExpectationFindingCount: number
  readonly thesisContextStatus: 'available' | 'unavailable' | 'truncated'
  readonly thesisContextThesisCount: number
  readonly thesisDependencyCount: number
  readonly thesisFilterFindingCount: number
  readonly thesisCriticalFindingCount: number
  readonly thesisRelevantFindingCount: number
  readonly thesisIrrelevantFindingCount: number
  readonly thesisUncertainFindingCount: number
  readonly thesisFilter: ThesisFilterReasoning
}

export interface EarningsReviewWorkflowResult {
  readonly workflowRunId: string
  readonly status: 'completed' | 'blocked' | 'cancelled' | 'failed'
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly report?: { readonly reportId: string; readonly outputPath: string }
  readonly proposalIds: readonly string[]
  readonly committedIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly claimIds: readonly string[]
  readonly eventIds?: readonly string[]
  readonly observationIds?: readonly string[]
  readonly thesisIds?: readonly string[]
  readonly reasoningEdgeIds?: readonly string[]
  readonly errors: readonly string[]
  readonly selectionDiagnostics: readonly string[]
  readonly acquisitionDiagnostics: readonly { readonly provider: string; readonly candidateId?: string; readonly kind?: string; readonly status: string; readonly reason: string }[]
  readonly blockedReason?: 'COMPANY_COVERAGE_NOT_FOUND' | 'COMPANY_COVERAGE_AMBIGUOUS' | 'EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE'
  readonly sections?: readonly EarningsReviewSection[]
  readonly assessments?: readonly EarningsImpactAssessment[]
  readonly telemetry: EarningsReviewTelemetry
  readonly providerOutcomes: readonly ResearchProviderOutcome[]
  readonly financialQuality?: EarningsFinancialQualitySummary
  readonly expectationAnalysis?: EarningsExpectationAnalysis
  readonly managementCommunication?: ManagementCommunicationResearchResult
  readonly valuationImpactAnalysis?: EarningsValuationImpactAnalysis
  readonly qualityGate?: ResearchQualityGateResult
}
