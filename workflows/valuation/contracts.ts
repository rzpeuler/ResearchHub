import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { OfficialDisclosureClient } from '../../plugins/research-acquisition/official.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { ValuationDataPayload } from '../../plugins/research-acquisition/valuation-data.ts'
import type { ValuationComputation, ValuationAssumptionPlan, ValuationMethod, ValuationReasoningTelemetry, ValuationSynthesisOutput } from '../../skills/valuation/index.ts'
import type { AutomaticEquityCompsResult, CompsValuationInput, CompsValuationResult } from '../../skills/comps_valuation/index.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'
import type { ValuationBasisEvidence, ValuationEvidencePitStatus } from './basis-evidence.ts'

export interface ValuationWorkflowInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly securityIdentity?: VerifiedSecurityIdentity
  readonly asOf?: string
  readonly methods?: readonly ValuationMethod[]
  readonly targetFiscalYear?: number
  readonly reportRoot: string
  readonly akshare?: AkshareDataClient
  readonly officialDisclosure?: OfficialDisclosureClient
  readonly dataResolver?: DataResolver<ValuationDataPayload>
  readonly dataResolverFactory?: (context: { readonly company: ResearchCompanyIdentity; readonly valuationDate: string; readonly asOf?: string; readonly now: () => string; readonly signal?: AbortSignal }) => DataResolver<ValuationDataPayload>
  readonly reasoningExecutor?: ReasoningExecutor
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly writeKnowledge?: boolean
  readonly useStructuredKnowledge?: boolean
  readonly comps?: CompsValuationInput
}

export interface ValuationProviderOutcome {
  readonly providerAttempted: boolean
  readonly transportSucceeded: boolean
  readonly marketTransportSucceeded: boolean
  readonly financialTransportSucceeded: boolean
  readonly officialPublicationVerified: boolean
  readonly companyBasicRowCount: number
  readonly financialRowCount: number
  readonly marketRowCount: number
  readonly marketPriceFound: boolean
  readonly fiscalYearBasisFound: boolean
  readonly peEligible: boolean
  readonly pbEligible: boolean
  readonly evEbitdaEligible: boolean
  readonly usableForValuation: boolean
  readonly basisPitStatus?: ValuationEvidencePitStatus
}

export interface ValuationWorkflowResult {
  readonly workflowRunId: string
  readonly status: 'completed' | 'blocked' | 'cancelled' | 'failed'
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly report?: { readonly reportId: string; readonly outputPath: string }
  readonly proposalIds: readonly string[]
  readonly committedIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly claimIds: readonly string[]
  readonly errors: readonly string[]
  readonly blockedReason?: 'COMPANY_COVERAGE_NOT_FOUND' | 'COMPANY_COVERAGE_AMBIGUOUS' | 'VALUATION_MARKET_PRICE_UNAVAILABLE' | 'VALUATION_ASOF_IN_FUTURE' | 'VALUATION_TARGET_FISCAL_YEAR_INVALID'
  readonly diagnostics: readonly string[]
  readonly providerOutcome: ValuationProviderOutcome
  readonly basis?: ValuationComputation['basis']
  readonly basisEvidence?: ValuationBasisEvidence
  readonly plan?: ValuationAssumptionPlan
  readonly computation?: ValuationComputation
  readonly synthesis?: ValuationSynthesisOutput
  readonly telemetry: ValuationTelemetrySnapshot
  readonly compsResult?: CompsValuationResult
  readonly automaticCompsResult?: AutomaticEquityCompsResult
  readonly qualityGate?: ResearchQualityGateResult
  readonly crosscheck?: ValuationCrosscheck
}

export type ValuationCrosscheckMethod = 'scenario_base' | 'comps_valuation'

export interface ValuationMethodResult {
  readonly method: ValuationCrosscheckMethod
  readonly sourceMethod?: ValuationMethod
  readonly value?: number
  readonly unit: 'CNY/share'
  readonly valuationDate: string
  readonly period: string
  readonly currency: string
  readonly basis: 'equity_per_share' | 'enterprise_value'
  readonly scenario?: 'base'
  readonly sourceRefs: readonly string[]
  readonly diagnostics: readonly string[]
}

export interface ValuationBasisCompatibility {
  readonly comparisonRef: string
  readonly leftMethod: ValuationCrosscheckMethod
  readonly rightMethod: ValuationCrosscheckMethod
  readonly compatible: boolean
  readonly left: Readonly<Record<'valuationDate' | 'period' | 'unit' | 'currency' | 'basis', string>>
  readonly right: Readonly<Record<'valuationDate' | 'period' | 'unit' | 'currency' | 'basis', string>>
  readonly diagnostics: readonly string[]
}

export interface ValuationCrosscheckConflict {
  readonly code: 'BASIS_INCOMPATIBLE' | 'VALUATION_METHOD_DISAGREEMENT'
  readonly methods: readonly ValuationCrosscheckMethod[]
  readonly message: string
  readonly absoluteSpread?: number
  readonly relativeSpread?: number
  readonly diagnostics: readonly string[]
}

export interface ValuationCrosscheck {
  readonly availableMethods: readonly ValuationCrosscheckMethod[]
  readonly unavailableMethods: readonly ValuationCrosscheckMethod[]
  readonly methodResults: readonly ValuationMethodResult[]
  readonly basisCompatibility: readonly ValuationBasisCompatibility[]
  readonly selectedPrimary?: ValuationMethod
  readonly conflicts: readonly ValuationCrosscheckConflict[]
  readonly automaticAveraging: false
}

export interface ValuationTelemetrySnapshot {
  readonly companyCoverageResolved: boolean
  readonly marketDataUsable: boolean
  readonly financialBasisUsable: boolean
  readonly pointInTimeVerified: boolean
  readonly eligibleMethods: readonly ValuationMethod[]
  readonly primaryMethod?: ValuationMethod
  readonly assumptionDesign: ValuationReasoningTelemetry
  readonly computation: { readonly scenarioCount: number; readonly calculatedScenarioCount: number; readonly sensitivityCellCount: number; readonly deterministicRecomputeStatus: 'matched' | 'unavailable' | 'mismatch' }
  readonly synthesis: ValuationReasoningTelemetry
  readonly modelDerivedInterpretiveSectionCount: number
  readonly proposalCandidateCount: number
  readonly acceptedProposalCount: number
  readonly canonicalSourceCount: number
  readonly canonicalClaimCount: number
}
