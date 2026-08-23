import type { Evidence, Prediction, Thesis } from '../../artifacts/index.ts'
import type { WorkflowDefinition } from '../../workflows/index.ts'

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

export interface ResearchExecutionContext {
  request: NormalizedResearchRequest
  workflow: WorkflowDefinition
}

export interface ResearchArtifactBundle {
  evidence: Evidence[]
  thesis: Thesis
  prediction: Prediction
}

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

export interface ResearchWorkflowExecutor {
  execute(context: ResearchExecutionContext): Promise<ResearchArtifactBundle>
}

export type ResearchReportIdFactory = (context: ResearchExecutionContext) => string
