import { Service, type Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ResearchManager } from './manager.ts'
import type { ResearchRequest, ResearchExecutionResult } from './types.ts'

export interface ResearchManagerHarnessConfig {
  manager: ResearchManager
  createdAt?: string
}

export class ResearchManagerService extends Service {
  constructor(ctx: Context, readonly manager: ResearchManager) {
    super(ctx, 'researchHubResearchManager')
  }

  createAgent(sessionId: string, provider: string, model: string): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: process.cwd() },
      agentOptions: { provider, model },
    })
  }

  execute(request: ResearchRequest): Promise<ResearchExecutionResult> {
    return this.manager.execute(request)
  }

  sessionEvents(agent: AgentHandle['agent']): readonly SessionEvent[] {
    return agent.session.events
  }
}

export const name = 'researchhub-research-manager'
export const inject = ['agents', 'tools']

export function createResearchManagerTool(
  service: ResearchManagerService,
  clock: () => string = () => new Date().toISOString(),
) {
  return defineTool({
    name: 'run_research_workflow',
    description: 'Run an approved ResearchHub workflow and return its Research Report View.',
    parameters: {
      workflowId: { type: 'string', required: true, description: 'Registered workflow identifier.' },
      symbol: { type: 'string', required: true, description: 'Six-digit A-share symbol.' },
      question: { type: 'string', required: true, description: 'Research question.' },
      evaluationPeriod: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          start: { type: 'string', required: true },
          end: { type: 'string', required: true },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, const: 'completed' },
          workflowId: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          report: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              workflowId: { type: 'string', required: true },
              question: { type: 'string', required: true },
              sessionId: { type: 'string', required: true },
              createdAt: { type: 'string', required: true },
              evidenceIds: { type: 'array', required: true, items: { type: 'string' } },
              thesisIds: { type: 'array', required: true, items: { type: 'string' } },
              predictionIds: { type: 'array', required: true, items: { type: 'string' } },
              metadata: { type: 'object', required: true, additionalProperties: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return executeResearchWorkflowTool(service, args, exec, clock)
    },
  })
}

export async function executeResearchWorkflowTool(
  service: ResearchManagerService,
  args: { workflowId: string; symbol: string; question: string; evaluationPeriod: { start: string; end: string } },
  exec: ToolRunContext,
  clock: () => string,
) {
  const sessionId = exec.agent?.id
  if (sessionId === undefined) throw new Error('run_research_workflow requires an agent execution context')
  const result = await service.execute({
    workflowId: args.workflowId,
    symbol: args.symbol,
    question: args.question,
    sessionId,
    createdAt: clock(),
    evaluationPeriod: args.evaluationPeriod,
  })
  return {
    status: result.status,
    workflowId: result.workflowId,
    sessionId: result.sessionId,
    report: result.report,
  }
}

export async function apply(ctx: Context, config: ResearchManagerHarnessConfig): Promise<void> {
  const service = new ResearchManagerService(ctx, config.manager)
  ctx.tools.register(createResearchManagerTool(service, () => config.createdAt ?? new Date().toISOString()))
}

export default { name, inject, apply }
