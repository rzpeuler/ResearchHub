import { type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MarketPlugin, marketSnapshotDefinition } from './plugin.ts'

const parameters = marketSnapshotDefinition.inputSchema
const outputSchema = marketSnapshotDefinition.outputSchema

/** Register the Market Plugin at the Harness Agent-facing Tool boundary. */
export function registerMarketPluginTool(ctx: Context, plugin: MarketPlugin): () => void {
  return ctx.tools.register(defineTool({
    name: marketSnapshotDefinition.name,
    description: marketSnapshotDefinition.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return plugin.get_market_snapshot(args)
    },
  }))
}
