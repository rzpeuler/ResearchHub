import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { CompanyResearchResult } from '../../skills/company-research/contracts.ts'
import type { ResearchCompanyIdentity, ResearchSignalStore, ResearchAcquisitionDiagnostic, ResearchProviderOutcome, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import type { CompanyIndustryExposureInput, IndustryExposureBridgeResult } from './industry-exposure-bridge.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { CompanyResearchDataPayload } from '../../plugins/research-acquisition/company-research-data.ts'
import type { DataRequirement } from '../../data/contracts.ts'

export interface CompanyDeepResearchResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly asOfMode: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly limitPerSource: number
  readonly onCandidatesDiscovered: (event: { readonly provider: 'CNINFO' | 'GDELT'; readonly candidates: readonly ResearchSourceCandidate[]; readonly requirement: DataRequirement }) => Promise<void> | void
}
export type CompanyDeepResearchDataResolverFactory = (options: CompanyDeepResearchResolverOptions) => DataResolver<CompanyResearchDataPayload>

export interface CompanyDeepResearchInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly dataResolverFactory: CompanyDeepResearchDataResolverFactory
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
