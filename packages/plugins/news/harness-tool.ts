import { type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NewsPlugin, newsSearchDefinition } from './plugin.ts'

const parameters = newsSearchDefinition.inputSchema
const outputSchema = newsSearchDefinition.outputSchema

/** Register the News Plugin at the Harness Agent-facing Tool boundary. */
export function registerNewsPluginTool(ctx: Context, plugin: NewsPlugin): () => void {
  return ctx.tools.register(defineTool({
    name: newsSearchDefinition.name,
    description: newsSearchDefinition.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return plugin.search_company_news(args)
    },
  }))
}
