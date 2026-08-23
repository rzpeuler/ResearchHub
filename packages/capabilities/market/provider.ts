import { type ProviderRegistry } from '../../providers/registry/index.ts'
import type { ProviderHandle } from '../../providers/core/index.ts'
import { CapabilityExecutionError, defineCapability, type CapabilityInput, type CapabilityOutput } from '../core/index.ts'

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

export const marketSnapshotDefinition = defineCapability({
  name: 'get_market_snapshot',
  description: 'Return a structured market snapshot for a stock symbol.',
  inputSchema: marketSnapshotInputSchema,
  outputSchema: marketSnapshotOutputSchema,
})

export type MarketSnapshotInput = CapabilityInput<typeof marketSnapshotDefinition>
export type MarketSnapshot = CapabilityOutput<typeof marketSnapshotDefinition>

export interface MarketProviderData {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}

export type MarketProviderHandle = ProviderHandle<MarketSnapshotInput, MarketProviderData>

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

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerHandle: MarketProviderHandle,
  ) {}

  async get_market_snapshot(input: MarketSnapshotInput): Promise<MarketSnapshot> {
    const normalizedInput = normalizeMarketSnapshotInput(input)
    try {
      const provider = this.registry.get(this.providerHandle)
      const result = await provider.fetch(normalizedInput)
      validateMarketProviderData(result.data, normalizedInput.symbol)
      return { ...result.data, ...result.metadata }
    } catch (cause) {
      throw new CapabilityExecutionError({
        capabilityName: this.definition.name,
        providerName: this.providerHandle.name,
        input: normalizedInput,
        cause,
      })
    }
  }
}

function validateMarketProviderData(value: unknown, expectedSymbol: string): asserts value is MarketProviderData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('get_market_snapshot Provider result data must be an object')
  }

  const result = value as Record<string, unknown>
  assertAllowedFields(result, new Set(['symbol', 'price', 'change', 'volume', 'source']))
  if (result.symbol !== expectedSymbol) {
    throw new TypeError('get_market_snapshot Provider result symbol must match the request')
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
      throw new TypeError(`get_market_snapshot Provider result contains unknown field: ${key}`)
    }
  }
}
