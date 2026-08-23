import { type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MarketCapability, marketSnapshotDefinition } from './provider.ts'

const parameters = marketSnapshotDefinition.inputSchema
const outputSchema = marketSnapshotDefinition.outputSchema

/** Register the Market Capability at the Harness Agent-facing Tool boundary. */
export function registerMarketCapabilityTool(ctx: Context, capability: MarketCapability): () => void {
  return ctx.tools.register(defineTool({
    name: marketSnapshotDefinition.name,
    description: marketSnapshotDefinition.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return capability.get_market_snapshot(args)
    },
  }))
}
