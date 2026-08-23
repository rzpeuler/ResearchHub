import { EventAnalysisWorkflow } from '../skills/event-analysis/index.ts'
import type { ResearchWorkflowExecutor } from '../dsh/research-manager/index.ts'

/** Thin adapter from the approved Workflow definition to the existing Event Analysis Skill implementation. */
export class EventAnalysisWorkflowExecutor implements ResearchWorkflowExecutor {
  constructor(private readonly workflow: EventAnalysisWorkflow) {}

  async execute(context: Parameters<ResearchWorkflowExecutor['execute']>[0]) {
    const result = await this.workflow.run({
      symbol: context.request.symbol,
      sessionId: context.request.sessionId,
      createdAt: context.request.createdAt,
      evaluationPeriod: context.request.evaluationPeriod,
    })
    return result.artifacts
  }
}
