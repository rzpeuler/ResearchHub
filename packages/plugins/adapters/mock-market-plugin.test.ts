import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PluginExecutionError } from '../core/index.ts'
import { MarketPlugin, type MarketPluginData, type MarketSnapshotInput } from '../market/plugin.ts'
import { MockMarketPlugin } from './mock-market-plugin.ts'
import { PluginRegistry, createMockPluginComposition, type DataPlugin } from '../../plugins/index.ts'

const marketMetadata = {
  plugin: 'fixture-market-plugin',
  source: 'fixture',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'high' as const,
  confidence: 0.9,
}

test('MockMarketPlugin returns deterministic DataPlugin results with metadata', async () => {
  const plugin = new MockMarketPlugin()

  const first = await plugin.fetch({ symbol: '600519' })
  const second = await plugin.fetch({ symbol: '600519' })

  assert.deepEqual(first, {
    data: {
      symbol: '600519',
      price: 1680,
      change: 12.5,
      volume: 100000,
      source: 'mock',
    },
    metadata: {
      plugin: 'mock-market-plugin',
      source: 'mock',
      timestamp: '2026-08-23T09:00:00.000Z',
      quality: 'low',
      confidence: 0.95,
    },
  })
  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
  assert.doesNotThrow(() => plugin.validate(first.data))
})

test('MarketPlugin normalizes input and projects only the pre-RH-ENG-005 output fields', async () => {
  const composition = createMockPluginComposition()
  const operation = new MarketPlugin(composition.registry, composition.market)

  const result = await operation.get_market_snapshot({ symbol: ' 600519 ' })

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

test('MarketPlugin routes through the registered handle rather than a concrete Plugin', async () => {
  let calls = 0
  const plugin: DataPlugin<MarketSnapshotInput, MarketPluginData> = {
    name: 'routed-market-plugin',
    async fetch(request) {
      calls += 1
      return {
        data: { symbol: request.symbol, price: 1, change: 2, volume: 3, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate(value: unknown): asserts value is MarketPluginData {
      if (value === null || typeof value !== 'object') throw new TypeError('invalid market data')
    },
  }
  const registry = new PluginRegistry()
  const handle = registry.register(plugin)
  const operation = new MarketPlugin(registry, handle)

  const result = await operation.get_market_snapshot({ symbol: '600519' })

  assert.equal(calls, 1)
  assert.equal('plugin' in result, false)
  assert.equal(result.source, 'fixture')
  assert.equal(result.timestamp, marketMetadata.timestamp)
})

test('MarketPlugin rejects invalid input without calling its registered Plugin', async () => {
  let calls = 0
  const plugin: DataPlugin<MarketSnapshotInput, MarketPluginData> = {
    name: 'spy-plugin',
    async fetch() {
      calls += 1
      return {
        data: { symbol: '600519', price: 1680, change: 12.5, volume: 100000, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new MarketPlugin(registry, registry.register(plugin))

  await assert.rejects(
    operation.get_market_snapshot({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(calls, 0)
})

test('MarketPlugin adds registry Plugin context to Plugin failures', async () => {
  const composition = createMockPluginComposition()
  const operation = new MarketPlugin(composition.registry, composition.market)

  await assert.rejects(
    operation.get_market_snapshot({ symbol: '999999' }),
    (error: unknown) => {
      assert.ok(error instanceof PluginExecutionError)
      assert.equal(error.operationName, 'get_market_snapshot')
      assert.equal(error.pluginName, 'mock-market-plugin')
      assert.deepEqual(error.input, { symbol: '999999' })
      assert.match(String((error.cause as Error).message), /mock market data is unavailable/)
      return true
    },
  )
})

test('MarketPlugin rejects malformed registered Plugin data', async () => {
  const plugin: DataPlugin<MarketSnapshotInput, MarketPluginData> = {
    name: 'malformed-market-plugin',
    async fetch() {
      return {
        data: { symbol: '000001', price: 1, change: 0, volume: 1, source: 'fixture' },
        metadata: marketMetadata,
      }
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new MarketPlugin(registry, registry.register(plugin))

  await assert.rejects(
    operation.get_market_snapshot({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof PluginExecutionError)
      assert.match(String((error.cause as Error).message), /symbol must match the request/)
      return true
    },
  )
})
