import type { Prediction } from '../../packages/artifacts/index.ts'
import type {
  ResearchArtifactBundle,
  ResearchWorkflowExecutionContext,
} from '../../packages/workflows/execution.ts'

export type {
  ResearchArtifactBundle,
  ResearchWorkflowExecutionContext,
  ResearchWorkflowExecutor,
} from '../../packages/workflows/execution.ts'

export interface ResearchRequest {
  workflowId: string
  symbol: string
  question: string
  sessionId: string
  createdAt: string
  evaluationPeriod?: Prediction['evaluationPeriod']
}

export type NormalizedResearchRequest = Omit<ResearchRequest, 'evaluationPeriod'> & {
  evaluationPeriod: Prediction['evaluationPeriod']
}

export type ResearchExecutionContext = ResearchWorkflowExecutionContext

export interface ResearchReportView {
  id: string
  workflowId: string
  question: string
  sessionId: string
  createdAt: string
  evidenceIds: string[]
  thesisIds: string[]
  predictionIds: string[]
  metadata: Record<string, string>
}

export interface ResearchExecutionResult {
  status: 'completed'
  workflowId: string
  sessionId: string
  artifacts: ResearchArtifactBundle
  report: ResearchReportView
}

export type ResearchReportIdFactory = (context: ResearchExecutionContext) => string
