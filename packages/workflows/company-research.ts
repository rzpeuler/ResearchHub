import { CompanyResearchWorkflow } from '../skills/company-research/index.ts'
import type { ResearchWorkflowExecutor } from '../dsh/research-manager/index.ts'

/** Thin adapter from the approved Company Research Workflow to the Skill implementation. */
export class CompanyResearchWorkflowExecutor implements ResearchWorkflowExecutor {
  constructor(private readonly workflow: CompanyResearchWorkflow) {}

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
