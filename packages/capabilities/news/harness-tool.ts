import { type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NewsCapability, newsSearchDefinition } from './provider.ts'

const parameters = newsSearchDefinition.inputSchema
const outputSchema = newsSearchDefinition.outputSchema

/** Register the News Capability at the Harness Agent-facing Tool boundary. */
export function registerNewsCapabilityTool(ctx: Context, capability: NewsCapability): () => void {
  return ctx.tools.register(defineTool({
    name: newsSearchDefinition.name,
    description: newsSearchDefinition.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return capability.search_company_news(args)
    },
  }))
}
