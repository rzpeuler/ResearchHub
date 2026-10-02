import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { CompanyResearchResult } from '../../skills/company-research/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchCompanyIdentity, ResearchSignalStore, ResearchAcquisitionDiagnostic, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import type { CompanyIndustryExposureInput, IndustryExposureBridgeResult } from './industry-exposure-bridge.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'

export interface CompanyDeepResearchInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly acquisitionPlugins: readonly ResearchAcquisitionPlugin[]
  readonly akshare?: AkshareDataClient
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
