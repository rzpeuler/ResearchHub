import { CapabilityExecutionError, defineCapability, type CapabilityInput, type CapabilityOutput, type CapabilityProvider } from '../core/index.ts'

const marketSnapshotInputSchema = {
  symbol: { type: 'string', required: true, description: 'Stock symbol.' },
} as const

const marketSnapshotOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    symbol: { type: 'string', required: true },
    price: { type: 'number', required: true },
    change: { type: 'number', required: true },
    volume: { type: 'number', required: true },
    source: { type: 'string', required: true },
  },
} as const

export const marketSnapshotDefinition = defineCapability({
  name: 'get_market_snapshot',
  description: 'Return a structured market snapshot for a stock symbol.',
  inputSchema: marketSnapshotInputSchema,
  outputSchema: marketSnapshotOutputSchema,
})

export type MarketSnapshotInput = CapabilityInput<typeof marketSnapshotDefinition>
export type MarketSnapshot = CapabilityOutput<typeof marketSnapshotDefinition>

export function normalizeMarketSnapshotInput(input: MarketSnapshotInput): MarketSnapshotInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('get_market_snapshot input must be an object')
  }

  if (typeof input.symbol !== 'string') {
    throw new TypeError('get_market_snapshot symbol must be a string')
  }

  const symbol = input.symbol.trim().toUpperCase()
  if (symbol.length === 0) {
    throw new Error('get_market_snapshot symbol must not be empty')
  }

  return { symbol }
}

export class MarketCapability {
  readonly definition = marketSnapshotDefinition

  constructor(private readonly provider: CapabilityProvider<MarketSnapshotInput, MarketSnapshot>) {}

  async get_market_snapshot(input: MarketSnapshotInput): Promise<MarketSnapshot> {
    const normalizedInput = normalizeMarketSnapshotInput(input)
    try {
      return await this.provider.execute(normalizedInput)
    } catch (cause) {
      throw new CapabilityExecutionError({
        capabilityName: this.definition.name,
        providerName: this.provider.name,
        input: normalizedInput,
        cause,
      })
    }
  }
}
