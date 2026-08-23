import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CapabilityExecutionError, type CapabilityProvider } from '../core/index.ts'
import { MarketCapability, type MarketSnapshot, type MarketSnapshotInput } from '../market/provider.ts'
import { MockMarketProvider } from './mock-market-provider.ts'

test('MockMarketProvider returns deterministic mock data', async () => {
  const provider = new MockMarketProvider()

  const first = await provider.execute({ symbol: '600519' })
  const second = await provider.execute({ symbol: '600519' })

  assert.deepEqual(first, {
    symbol: '600519',
    price: 1680,
    change: 12.5,
    volume: 100000,
    source: 'mock',
  })
  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
})

test('MarketCapability normalizes input before crossing the Provider boundary', async () => {
  const provider = new MockMarketProvider()
  const capability = new MarketCapability(provider)

  const result = await capability.get_market_snapshot({ symbol: ' 600519 ' })

  assert.equal(result.symbol, '600519')
  await assert.rejects(
    provider.execute({ symbol: ' 600519 ' }),
    /mock market data is unavailable/,
  )
})

test('MarketCapability rejects invalid input without calling its Provider', async () => {
  class SpyProvider implements CapabilityProvider<MarketSnapshotInput, MarketSnapshot> {
    readonly name = 'spy-provider'
    calls = 0

    async execute(_input: MarketSnapshotInput): Promise<MarketSnapshot> {
      this.calls += 1
      return {
        symbol: '600519',
        price: 1680,
        change: 12.5,
        volume: 100000,
        source: 'spy',
      }
    }
  }

  const provider = new SpyProvider()
  const capability = new MarketCapability(provider)

  await assert.rejects(
    capability.get_market_snapshot({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(provider.calls, 0)
})

test('MarketCapability adds provider context to provider failures', async () => {
  const capability = new MarketCapability(new MockMarketProvider())

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
