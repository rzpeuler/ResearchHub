import type { Evidence, Prediction, Thesis } from '../../artifacts/index.ts'
import type { CompanyResearchInput, CompanyResearchResult } from '../../skills/company-research/types.ts'
import type { EarningsReviewInput, EarningsReviewResult } from '../../skills/earnings-review/types.ts'
import type { EquityResearchInput, EquityResearchResult } from '../../skills/equity-research/types.ts'
import type { IndustryResearchInput, IndustryResearchResult } from '../../skills/industry-research/types.ts'
import type { ValuationInput, ValuationResult } from '../../skills/valuation/types.ts'
import type { ResearchReport, ResearchSection } from '../../skills/shared/research-report.ts'

export type EquityResearchStepId =
  | 'company-understanding'
  | 'industry-analysis'
  | 'financial-analysis'
  | 'earnings-review'
  | 'valuation-analysis'
  | 'investment-thesis-generation'

export type EquityResearchStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface EquityResearchWorkflowInput {
  symbol: string
  companyName: string
  industry: string
  geography: string
  question: string
  asOf: string
  sessionId: string
  createdAt: string
  evaluationPeriod: Prediction['evaluationPeriod']
  earningsPeriod: string
  valuation: Omit<ValuationInput, 'symbol' | 'companyName' | 'asOf'>
}

export interface EquityResearchStepState {
  id: EquityResearchStepId
  status: EquityResearchStepStatus
  error?: string
}

export type EquityResearchStageOutput =
  | CompanyResearchResult
  | IndustryResearchResult
  | EquityResearchResult
  | EarningsReviewResult
  | ValuationResult

export interface EquityResearchStepOutputMap {
  'company-understanding': CompanyResearchResult
  'industry-analysis': IndustryResearchResult
  'financial-analysis': EquityResearchResult
  'earnings-review': EarningsReviewResult
  'valuation-analysis': ValuationResult
}

export interface EquityResearchStepContext {
  request: Readonly<EquityResearchWorkflowInput>
  outputs: Readonly<Partial<EquityResearchStepOutputMap>>
  states: readonly EquityResearchStepState[]
}

export interface EquityResearchSkillAdapters {
  companyResearch(input: CompanyResearchInput, context: EquityResearchStepContext): Promise<CompanyResearchResult>
  industryResearch(input: IndustryResearchInput, context: EquityResearchStepContext): Promise<IndustryResearchResult>
  equityResearch(input: EquityResearchInput, context: EquityResearchStepContext): Promise<EquityResearchResult>
  earningsReview(input: EarningsReviewInput, context: EquityResearchStepContext): Promise<EarningsReviewResult>
  valuation(input: ValuationInput, context: EquityResearchStepContext): Promise<ValuationResult>
}

export interface EquityResearchArtifactBundle {
  evidence: Evidence[]
  thesis: Thesis
  prediction: Prediction
  report: EquityResearchReport
}

export interface EquityResearchReportSection extends ResearchSection {
  stepId: EquityResearchStepId
  skillId: string
}

export interface EquityResearchReport extends ResearchReport {
  workflowId: 'equity-research'
  question: string
  symbol: string
  thesisId: string
  predictionId: string
  sections: EquityResearchReportSection[]
}

export interface EquityResearchWorkflowResult {
  status: 'success'
  workflowId: 'equity-research'
  symbol: string
  stepStates: EquityResearchStepState[]
  stageOutputs: EquityResearchStepOutputMap
  artifacts: EquityResearchArtifactBundle
}

export type EquityResearchArtifactIdFactory = (
  type: 'evidence' | 'thesis' | 'prediction',
  ordinal: number,
) => string
