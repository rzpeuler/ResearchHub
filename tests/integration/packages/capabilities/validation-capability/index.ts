import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export interface ValidationCapabilityResult {
  status: 'success'
  message: 'ResearchHub capability loaded'
  skill: string
}

export class ValidationCapability extends Service {
  readonly calls: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'researchHubValidationCapability')
  }

  async execute(skillName: string): Promise<ValidationCapabilityResult> {
    const skill = await this.ctx.skills.get(skillName)
    if (skill === undefined) {
      throw new Error(`validation capability requires loaded skill: ${skillName}`)
    }
    this.calls.push(skill.name)
    return {
      status: 'success',
      message: 'ResearchHub capability loaded',
      skill: skill.name,
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    researchHubValidationCapability: ValidationCapability
  }
}

export const name = 'researchhub-validation-capability'
export const inject = ['skills', 'tools']

export function registerValidationCapability(ctx: Context, capability: ValidationCapability): void {
  ctx.tools.register(defineTool({
    name: 'researchhub_validation_capability',
    description: 'Return a deterministic ResearchHub capability validation result.',
    parameters: {
      skillName: { type: 'string', required: true, description: 'The loaded validation skill name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, const: 'success' },
          message: { type: 'string', required: true, const: 'ResearchHub capability loaded' },
          skill: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return capability.execute(args.skillName)
    },
  }))
}

export function apply(ctx: Context): void {
  registerValidationCapability(ctx, new ValidationCapability(ctx))
}
