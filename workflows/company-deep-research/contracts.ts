import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { CompanyResearchResult } from '../../skills/company-research/contracts.ts'
import type { ResearchCompanyIdentity, ResearchSignalStore, ResearchAcquisitionDiagnostic, ResearchProviderOutcome, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import type { CompanyIndustryExposureInput, IndustryExposureBridgeResult } from './industry-exposure-bridge.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import type { CompanyResearchDataPayload } from '../../plugins/research-acquisition/company-research-data.ts'
import type { DataRequirement } from '../../data/contracts.ts'
import type { VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
import type { WorkflowAcquisitionActivity, WorkflowObservationReporter } from '../observation-contracts.ts'
import type { ValuationDataPayload } from '../../plugins/research-acquisition/valuation-data.ts'
import type { EarningsDataPayload } from '../../plugins/research-acquisition/earnings-data.ts'
import type { EarningsPeriod } from '../../skills/earnings-review/financials.ts'

export interface CompanyDeepResearchValuationResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly valuationDate: string
  readonly historicalAsOf?: string
  readonly now: () => string
  readonly signal?: AbortSignal
}
export type CompanyDeepResearchValuationResolverFactory = (options: CompanyDeepResearchValuationResolverOptions) => DataResolver<ValuationDataPayload>

export interface CompanyDeepResearchEarningsResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly fiscalYear: number
  readonly period: EarningsPeriod
  readonly asOf: string
  readonly now: () => string
  readonly signal?: AbortSignal
}
export type CompanyDeepResearchEarningsResolverFactory = (options: CompanyDeepResearchEarningsResolverOptions) => DataResolver<EarningsDataPayload>

/** Workflow-local raw resolver outputs used to build report-owned quantitative sections. */
export interface CompanyReadOnlyAcquisition {
  readonly expectationTargetFiscalYear: number
  readonly valuationBasisFiscalYear: number
  readonly valuationRequirements: readonly DataRequirement[]
  readonly valuationItems: readonly ResolvedDataItem<ValuationDataPayload>[]
  readonly earningsExpectationRequirements: readonly DataRequirement[]
  readonly earningsExpectationItems: readonly ResolvedDataItem<EarningsDataPayload>[]
  readonly valuationError?: string
  readonly earningsExpectationError?: string
}


export interface CompanyDeepResearchResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly asOfMode: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly limitPerSource: number
  readonly acquisitionDeadlineAt?: number
  readonly evidenceSearchTerms?: readonly string[]
  readonly onProgress?: (activity: WorkflowAcquisitionActivity) => Promise<void> | void
  readonly onCandidatesDiscovered: (event: { readonly provider: 'CNINFO' | 'GDELT'; readonly candidates: readonly ResearchSourceCandidate[]; readonly requirement: DataRequirement }) => Promise<void> | void
}
export type CompanyDeepResearchDataResolverFactory = (options: CompanyDeepResearchResolverOptions) => DataResolver<CompanyResearchDataPayload>

export interface CompanyDeepResearchInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly securityIdentity?: VerifiedSecurityIdentity
  readonly dataResolverFactory: CompanyDeepResearchDataResolverFactory
  readonly valuationDataResolverFactory?: CompanyDeepResearchValuationResolverFactory
  readonly earningsDataResolverFactory?: CompanyDeepResearchEarningsResolverFactory
  readonly asOf?: string
  readonly reportRoot: string
  readonly signalStore?: ResearchSignalStore
  readonly maxSources?: number
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly reasoningExecutor?: ReasoningExecutor
  readonly writeKnowledge?: boolean
  readonly useStructuredKnowledge?: boolean
  readonly industryExposure?: CompanyIndustryExposureInput
  readonly observations?: WorkflowObservationReporter
}
export interface CompanyDeepResearchResult {
  readonly workflowRunId: string
  readonly status: 'completed' | 'blocked' | 'cancelled' | 'failed'
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision?: number
  readonly report?: { readonly reportId: string; readonly outputPath: string }
  readonly proposalIds: readonly string[]
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly committedIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly claimIds: readonly string[]
  readonly resolutionIntents?: readonly ResolutionIntentSummary[]
  readonly errors: readonly string[]
  readonly research?: CompanyResearchResult
  readonly acquisitionDiagnostics?: readonly ResearchAcquisitionDiagnostic[]
  readonly providerOutcomes?: readonly ResearchProviderOutcome[]
  readonly industryExposure?: IndustryExposureBridgeResult
  readonly qualityGate?: ResearchQualityGateResult
}
