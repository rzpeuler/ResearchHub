import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PluginConfigurationError,
  type DataPlugin,
  type MarketPluginConfig,
  type PluginResult,
} from '../index.ts'
import {
  createMarketPluginComposition,
  MarketPluginCompositionError,
} from './index.ts'

const BASE_CONFIG: MarketPluginConfig = {
  tushareToken: 'fixture-token',
  tushareEndpoint: 'https://tushare.example.test/api',
  akshareEndpoint: 'https://akshare.example.test/bridge',
  primaryPlugin: 'tushare-market',
  fallbackPlugin: 'akshare-market',
  mode: 'real',
}

function config(overrides: Partial<MarketPluginConfig> = {}): MarketPluginConfig {
  return { ...BASE_CONFIG, ...overrides }
}

function marketResult(plugin: string, source = plugin): PluginResult<{
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}> {
  return {
    data: { symbol: '600519', price: 1680.5, change: 0.75, volume: 123456.7, source },
    metadata: {
      plugin,
      source,
      timestamp: '2026-08-23T09:00:00.000Z',
      quality: 'high',
      confidence: 0.9,
    },
  }
}

function fixturePlugin(
  name: 'tushare-market' | 'akshare-market',
  calls: string[],
  outcome: PluginResult<{
    symbol: string
    price: number
    change: number
    volume: number
    source: string
  }> | Error,
): DataPlugin<{ symbol: string }, {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}> {
  return {
    name,
    async fetch(request) {
      calls.push(`${name}:${request.symbol}`)
      if (outcome instanceof Error) {
        throw outcome
      }
      return outcome
    },
    validate() {},
  }
}

test('Market composition routes a successful primary plugin without invoking fallback', async () => {
  const calls: string[] = []
  const composition = createMarketPluginComposition(config(), {
    adapters: {
      'tushare-market': fixturePlugin('tushare-market', calls, marketResult('tushare-market', 'tushare')),
      'akshare-market': fixturePlugin('akshare-market', calls, marketResult('akshare-market', 'akshare-bridge')),
    },
  })

  const result = await composition.registry.get(composition.market).fetch({ symbol: '600519' })

  assert.deepEqual(calls, ['tushare-market:600519'])
  assert.equal(result.metadata.plugin, 'tushare-market')
  assert.equal(result.data.source, 'tushare')
})

test('Market composition uses fallback only after primary failure', async () => {
  const calls: string[] = []
  const composition = createMarketPluginComposition(config(), {
    adapters: {
      'tushare-market': fixturePlugin('tushare-market', calls, new Error('Tushare unavailable')),
      'akshare-market': fixturePlugin('akshare-market', calls, marketResult('akshare-market', 'akshare-bridge')),
    },
  })

  const result = await composition.registry.get(composition.market).fetch({ symbol: '600519' })

  assert.deepEqual(calls, ['tushare-market:600519', 'akshare-market:600519'])
  assert.equal(result.metadata.plugin, 'akshare-market')
  assert.equal(result.data.source, 'akshare-bridge')
})

test('Market composition reports both plugin names and causes when both plugins fail', async () => {
  const composition = createMarketPluginComposition(config(), {
    adapters: {
      'tushare-market': fixturePlugin('tushare-market', [], new Error('Tushare timeout')),
      'akshare-market': fixturePlugin('akshare-market', [], new Error('AkShare bridge refused request')),
    },
  })

  await assert.rejects(
    composition.registry.get(composition.market).fetch({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof MarketPluginCompositionError)
      assert.match(error.message, /tushare-market: Tushare timeout/)
      assert.match(error.message, /akshare-market: AkShare bridge refused request/)
      assert.ok(error.cause instanceof AggregateError)
      return true
    },
  )
})

test('Market composition registers configured real adapters under their stable names', async () => {
  const composition = createMarketPluginComposition(config(), {
    tushareTransport: {
      async request() {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            fields: ['ts_code', 'close', 'pct_chg', 'vol', 'trade_date'],
            items: [['600519.SH', 1680.5, 0.75, 123456.7, '20260821']],
          },
        }))
      },
    },
    akshareTransport: {
      async request() {
        return new Response(JSON.stringify({
          code: '600519',
          close: 1680.5,
          pct_chg: 0.75,
          volume: 123456.7,
        }))
      },
    },
  })

  assert.deepEqual(composition.registry.list(), [
    'tushare-market',
    'akshare-market',
    'market-plugin-composition',
  ])
  assert.equal(composition.registry.get('tushare-market').name, 'tushare-market')
  assert.equal(composition.registry.get('akshare-market').name, 'akshare-market')
  assert.equal(composition.primary.name, 'tushare-market')
  assert.equal(composition.fallback?.name, 'akshare-market')
})

test('Market composition validates selected real-plugin configuration and never selects Mock', () => {
  assert.throws(
    () => createMarketPluginComposition(config({ tushareToken: undefined })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /TUSHARE_TOKEN/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({ akshareEndpoint: undefined })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /AKSHARE_ENDPOINT/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({
      mode: 'fixture',
      primaryPlugin: 'mock-market-plugin',
      fallbackPlugin: undefined,
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /requires MARKET_PLUGIN_MODE=real/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({
      primaryPlugin: 'mock-market-plugin',
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /cannot select mock-market-plugin/.test(error.message),
  )
})

test('Market composition rejects directly supplied bogus plugin names', () => {
  assert.throws(
    () => createMarketPluginComposition(config({
      primaryPlugin: 'not-a-market-plugin' as unknown as MarketPluginConfig['primaryPlugin'],
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /MARKET_PRIMARY_PLUGIN must be one of: tushare-market, akshare-market/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({
      fallbackPlugin: 'not-a-market-plugin' as unknown as MarketPluginConfig['fallbackPlugin'],
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /MARKET_FALLBACK_PLUGIN must be one of: tushare-market, akshare-market/.test(error.message),
  )
})

test('Market composition rejects directly supplied invalid endpoints', () => {
  assert.throws(
    () => createMarketPluginComposition(config({
      tushareEndpoint: 'file:///tmp/tushare',
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /TUSHARE_ENDPOINT must be a valid HTTP\(S\) URL/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({
      akshareEndpoint: 'not-an-endpoint',
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /AKSHARE_ENDPOINT must be a valid HTTP\(S\) URL/.test(error.message),
  )
})

test('Market composition rejects directly supplied endpoint userinfo', () => {
  assert.throws(
    () => createMarketPluginComposition(config({
      tushareEndpoint: 'https://user:password@tushare.example.test/api',
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /TUSHARE_ENDPOINT must not include username\/password userinfo/.test(error.message),
  )
  assert.throws(
    () => createMarketPluginComposition(config({
      akshareEndpoint: 'https://user@akshare.example.test/bridge',
    })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /AKSHARE_ENDPOINT must not include username\/password userinfo/.test(error.message),
  )
})

test('Market composition rejects the same plugin as primary and fallback', () => {
  assert.throws(
    () => createMarketPluginComposition(config({ fallbackPlugin: 'tushare-market' })),
    (error: unknown) => error instanceof PluginConfigurationError
      && /must differ/.test(error.message),
  )
})
