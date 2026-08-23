import { Service, type Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'

export class ResearchManager extends Service {
  constructor(ctx: Context) {
    super(ctx, 'researchHubResearchManager')
  }

  createValidationAgent(sessionId: string, provider: string, model: string): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: process.cwd() },
      agentOptions: { provider, model },
    })
  }

  sessionEvents(agent: AgentHandle['agent']): readonly SessionEvent[] {
    return agent.session.events
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    researchHubResearchManager: ResearchManager
  }
}

export const name = 'researchhub-research-manager'
export const inject = ['agents']
