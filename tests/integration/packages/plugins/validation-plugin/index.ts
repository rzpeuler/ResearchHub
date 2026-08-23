import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export interface ValidationPluginResult {
  status: 'success'
  message: 'ResearchHub plugin loaded'
  skill: string
}

export class ValidationPlugin extends Service {
  readonly calls: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'researchHubValidationPlugin')
  }

  async execute(skillName: string): Promise<ValidationPluginResult> {
    const skill = await this.ctx.skills.get(skillName)
    if (skill === undefined) {
      throw new Error(`validation plugin requires loaded skill: ${skillName}`)
    }
    this.calls.push(skill.name)
    return {
      status: 'success',
      message: 'ResearchHub plugin loaded',
      skill: skill.name,
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    researchHubValidationPlugin: ValidationPlugin
  }
}

export const name = 'researchhub-validation-plugin'
export const inject = ['skills', 'tools']

export function registerValidationPlugin(ctx: Context, plugin: ValidationPlugin): void {
  ctx.tools.register(defineTool({
    name: 'researchhub_validation_plugin',
    description: 'Return a deterministic ResearchHub plugin validation result.',
    parameters: {
      skillName: { type: 'string', required: true, description: 'The loaded validation skill name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, const: 'success' },
          message: { type: 'string', required: true, const: 'ResearchHub plugin loaded' },
          skill: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return plugin.execute(args.skillName)
    },
  }))
}

export function apply(ctx: Context): void {
  registerValidationPlugin(ctx, new ValidationPlugin(ctx))
}
