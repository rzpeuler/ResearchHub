import { ProviderValidationError, type DataProvider, type FinancialDataMetadata } from '../core/index.ts'

export interface MockMarketRequest {
  symbol: string
}

export interface MockMarketData {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}

const MOCK_MARKET_DATA: Readonly<Record<string, MockMarketData>> = {
  '600519': {
    symbol: '600519',
    price: 1680.0,
    change: 12.5,
    volume: 100000,
    source: 'mock',
  },
  '000001': {
    symbol: '000001',
    price: 12.34,
    change: -0.12,
    volume: 250000,
    source: 'mock',
  },
}

const MOCK_MARKET_METADATA: FinancialDataMetadata = {
  source: 'mock',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'low',
  confidence: 0.95,
}

/** Deterministic market DataProvider used by capability and integration tests. */
export class MockMarketProvider implements DataProvider<MockMarketRequest, MockMarketData> {
  readonly name = 'mock-market-provider'

  async fetch(request: MockMarketRequest) {
    const snapshot = MOCK_MARKET_DATA[request.symbol]
    if (snapshot === undefined) {
      throw new Error(`mock market data is unavailable for symbol: ${request.symbol}`)
    }

    return {
      data: { ...snapshot },
      metadata: { ...MOCK_MARKET_METADATA },
    }
  }

  validate(value: unknown): asserts value is MockMarketData {
    assertObject(value, 'market data')
    assertAllowedFields(value, new Set(['symbol', 'price', 'change', 'volume', 'source']))
    assertNonEmptyString(value.symbol, '$.symbol')
    assertFiniteNumber(value.price, '$.price')
    assertFiniteNumber(value.change, '$.change')
    assertFiniteNumber(value.volume, '$.volume')
    assertNonEmptyString(value.source, '$.source')
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderValidationError(`expected ${label} to be an object`)
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new ProviderValidationError(`unknown field: ${key}`, `$.${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderValidationError('expected a non-empty string', path)
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProviderValidationError('expected a finite number', path)
  }
}
