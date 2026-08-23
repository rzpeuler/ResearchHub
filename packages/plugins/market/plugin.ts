import { type PluginRegistry } from '../../plugins/registry/index.ts'
import type { PluginHandle } from '../../plugins/core/index.ts'
import { PluginExecutionError, definePlugin, type PluginInput, type PluginOutput } from '../core/index.ts'

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
    timestamp: { type: 'string', required: true },
    quality: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
  },
} as const

export const marketSnapshotDefinition = definePlugin({
  name: 'get_market_snapshot',
  description: 'Return a structured market snapshot for a stock symbol.',
  inputSchema: marketSnapshotInputSchema,
  outputSchema: marketSnapshotOutputSchema,
})

export type MarketSnapshotInput = PluginInput<typeof marketSnapshotDefinition>
export type MarketSnapshot = PluginOutput<typeof marketSnapshotDefinition>

export interface MarketPluginData {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}

export type MarketPluginHandle = PluginHandle<MarketSnapshotInput, MarketPluginData>

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

export class MarketPlugin {
  readonly definition = marketSnapshotDefinition

  constructor(
    private readonly registry: PluginRegistry,
    private readonly pluginHandle: MarketPluginHandle,
  ) {}

  async get_market_snapshot(input: MarketSnapshotInput): Promise<MarketSnapshot> {
    const normalizedInput = normalizeMarketSnapshotInput(input)
    try {
      const plugin = this.registry.get(this.pluginHandle)
      const result = await plugin.fetch(normalizedInput)
      validateMarketPluginData(result.data, normalizedInput.symbol)
      return {
        ...result.data,
        source: result.metadata.source,
        timestamp: result.metadata.timestamp,
        quality: result.metadata.quality,
        confidence: result.metadata.confidence,
      }
    } catch (cause) {
      throw new PluginExecutionError({
        operationName: this.definition.name,
        pluginName: this.pluginHandle.name,
        input: normalizedInput,
        cause,
      })
    }
  }
}

function validateMarketPluginData(value: unknown, expectedSymbol: string): asserts value is MarketPluginData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('get_market_snapshot Plugin result data must be an object')
  }

  const result = value as Record<string, unknown>
  assertAllowedFields(result, new Set(['symbol', 'price', 'change', 'volume', 'source']))
  if (result.symbol !== expectedSymbol) {
    throw new TypeError('get_market_snapshot Plugin result symbol must match the request')
  }
  assertFiniteNumber(result.price, '$.price')
  assertFiniteNumber(result.change, '$.change')
  assertFiniteNumber(result.volume, '$.volume')
  assertNonEmptyString(result.source, '$.source')
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`get_market_snapshot Plugin result contains unknown field: ${key}`)
    }
  }
}
