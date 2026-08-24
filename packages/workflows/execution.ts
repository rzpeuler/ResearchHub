import type { Evidence, Prediction, Thesis } from '../artifacts/index.ts'
import type { WorkflowDefinition } from './types.ts'

/** Runtime-neutral request data supplied to a reusable Workflow asset. */
export interface ResearchWorkflowRequest {
  symbol: string
  question: string
  sessionId: string
  createdAt: string
  evaluationPeriod: Prediction['evaluationPeriod']
}

/** Runtime-neutral execution context shared by Workflow assets and runtimes. */
export interface ResearchWorkflowExecutionContext {
  request: ResearchWorkflowRequest
  workflow: WorkflowDefinition
}

export interface ResearchArtifactBundle {
  evidence: Evidence[]
  thesis: Thesis
  prediction: Prediction
}

export interface ResearchWorkflowExecutor {
  execute(context: ResearchWorkflowExecutionContext): Promise<ResearchArtifactBundle>
}
