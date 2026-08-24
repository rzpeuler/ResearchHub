import type { ResearchWorkflowExecutionContext, ResearchWorkflowExecutor } from '../execution.ts'
import type { EquityResearchWorkflowInput } from './types.ts'
import { EquityResearchWorkflow } from './workflow.ts'

export type EquityResearchWorkflowInputFactory = (context: ResearchWorkflowExecutionContext) => EquityResearchWorkflowInput

export class EquityResearchWorkflowExecutor implements ResearchWorkflowExecutor {
  constructor(
    private readonly workflow: EquityResearchWorkflow,
    private readonly inputFactory: EquityResearchWorkflowInputFactory,
  ) {}

  async execute(context: ResearchWorkflowExecutionContext) {
    const result = await this.workflow.run(this.inputFactory(context))
    return result.artifacts
  }
}
