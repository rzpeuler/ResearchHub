import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CapabilityExecutionError } from '../core/index.ts'
import { MarketCapability, type MarketProviderData, type MarketSnapshotInput } from '../market/provider.ts'
import { MockMarketProvider } from './mock-market-provider.ts'
import { ProviderRegistry, createMockProviderComposition, type DataProvider } from '../../providers/index.ts'

const marketMetadata = {
  provider: 'fixture-market-provider',
  source: 'fixture',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'high' as const,
  confidence: 0.9,
}

test('MockMarketProvider returns deterministic DataProvider results with metadata', async () => {
  const provider = new MockMarketProvider()

  const first = await provider.fetch({ symbol: '600519' })
  const second = await provider.fetch({ symbol: '600519' })

  assert.deepEqual(first, {
    data: {
      symbol: '600519',
      price: 1680,
      change: 12.5,
      volume: 100000,
      source: 'mock',
    },
    metadata: {
      provider: 'mock-market-provider',
      source: 'mock',
      timestamp: '2026-08-23T09:00:00.000Z',
      quality: 'low',
      confidence: 0.95,
    },
  })
  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
  assert.doesNotThrow(() => provider.validate(first.data))
})

test('MarketCapability normalizes input and projects only the pre-RH-ENG-005 output fields', async () => {
  const composition = createMockProviderComposition()
  const capability = new MarketCapability(composition.registry, composition.market)

  const result = await capability.get_market_snapshot({ symbol: ' 600519 ' })

  assert.deepEqual(result, {
    symbol: '600519',
    price: 1680,
    change: 12.5,
    volume: 100000,
    source: 'mock',
    timestamp: '2026-08-23T09:00:00.000Z',
    quality: 'low',
    confidence: 0.95,
  })
  await assert.rejects(
    composition.registry.get(composition.market).fetch({ symbol: ' 600519 ' }),
    /mock market data is unavailable/,
  )
})

test('MarketCapability routes through the registered handle rather than a concrete Provider', async () => {
  let calls = 0
  const provider: DataProvider<MarketSnapshotInput, MarketProviderData> = {
    name: 'routed-market-provider',
    async fetch(request) {
      calls += 1
      return {
        data: { symbol: request.symbol, price: 1, change: 2, volume: 3, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate(value: unknown): asserts value is MarketProviderData {
      if (value === null || typeof value !== 'object') throw new TypeError('invalid market data')
    },
  }
  const registry = new ProviderRegistry()
  const handle = registry.register(provider)
  const capability = new MarketCapability(registry, handle)

  const result = await capability.get_market_snapshot({ symbol: '600519' })

  assert.equal(calls, 1)
  assert.equal('provider' in result, false)
  assert.equal(result.source, 'fixture')
  assert.equal(result.timestamp, marketMetadata.timestamp)
})

test('MarketCapability rejects invalid input without calling its registered Provider', async () => {
  let calls = 0
  const provider: DataProvider<MarketSnapshotInput, MarketProviderData> = {
    name: 'spy-provider',
    async fetch() {
      calls += 1
      return {
        data: { symbol: '600519', price: 1680, change: 12.5, volume: 100000, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new MarketCapability(registry, registry.register(provider))

  await assert.rejects(
    capability.get_market_snapshot({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(calls, 0)
})

test('MarketCapability adds registry Provider context to Provider failures', async () => {
  const composition = createMockProviderComposition()
  const capability = new MarketCapability(composition.registry, composition.market)

  await assert.rejects(
    capability.get_market_snapshot({ symbol: '999999' }),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError)
      assert.equal(error.capabilityName, 'get_market_snapshot')
      assert.equal(error.providerName, 'mock-market-provider')
      assert.deepEqual(error.input, { symbol: '999999' })
      assert.match(String((error.cause as Error).message), /mock market data is unavailable/)
      return true
    },
  )
})

test('MarketCapability rejects malformed registered Provider data', async () => {
  const provider: DataProvider<MarketSnapshotInput, MarketProviderData> = {
    name: 'malformed-market-provider',
    async fetch() {
      return {
        data: { symbol: '000001', price: 1, change: 0, volume: 1, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new MarketCapability(registry, registry.register(provider))

  await assert.rejects(
    capability.get_market_snapshot({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError)
      assert.match(String((error.cause as Error).message), /symbol must match the request/)
      return true
    },
  )
})
