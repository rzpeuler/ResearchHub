import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProviderConfigurationError,
  type DataProvider,
  type MarketProviderConfig,
  type ProviderResult,
} from '../index.ts'
import {
  createMarketProviderComposition,
  MarketProviderCompositionError,
} from './index.ts'

const BASE_CONFIG: MarketProviderConfig = {
  tushareToken: 'fixture-token',
  tushareEndpoint: 'https://tushare.example.test/api',
  akshareEndpoint: 'https://akshare.example.test/bridge',
  primaryProvider: 'tushare-market',
  fallbackProvider: 'akshare-market',
  mode: 'real',
}

function config(overrides: Partial<MarketProviderConfig> = {}): MarketProviderConfig {
  return { ...BASE_CONFIG, ...overrides }
}

function marketResult(provider: string, source = provider): ProviderResult<{
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}> {
  return {
    data: { symbol: '600519', price: 1680.5, change: 0.75, volume: 123456.7, source },
    metadata: {
      provider,
      source,
      timestamp: '2026-08-23T09:00:00.000Z',
      quality: 'high',
      confidence: 0.9,
    },
  }
}

function fixtureProvider(
  name: 'tushare-market' | 'akshare-market',
  calls: string[],
  outcome: ProviderResult<{
    symbol: string
    price: number
    change: number
    volume: number
    source: string
  }> | Error,
): DataProvider<{ symbol: string }, {
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

test('Market composition routes a successful primary provider without invoking fallback', async () => {
  const calls: string[] = []
  const composition = createMarketProviderComposition(config(), {
    adapters: {
      'tushare-market': fixtureProvider('tushare-market', calls, marketResult('tushare-market', 'tushare')),
      'akshare-market': fixtureProvider('akshare-market', calls, marketResult('akshare-market', 'akshare-bridge')),
    },
  })

  const result = await composition.registry.get(composition.market).fetch({ symbol: '600519' })

  assert.deepEqual(calls, ['tushare-market:600519'])
  assert.equal(result.metadata.provider, 'tushare-market')
  assert.equal(result.data.source, 'tushare')
})

test('Market composition uses fallback only after primary failure', async () => {
  const calls: string[] = []
  const composition = createMarketProviderComposition(config(), {
    adapters: {
      'tushare-market': fixtureProvider('tushare-market', calls, new Error('Tushare unavailable')),
      'akshare-market': fixtureProvider('akshare-market', calls, marketResult('akshare-market', 'akshare-bridge')),
    },
  })

  const result = await composition.registry.get(composition.market).fetch({ symbol: '600519' })

  assert.deepEqual(calls, ['tushare-market:600519', 'akshare-market:600519'])
  assert.equal(result.metadata.provider, 'akshare-market')
  assert.equal(result.data.source, 'akshare-bridge')
})

test('Market composition reports both provider names and causes when both providers fail', async () => {
  const composition = createMarketProviderComposition(config(), {
    adapters: {
      'tushare-market': fixtureProvider('tushare-market', [], new Error('Tushare timeout')),
      'akshare-market': fixtureProvider('akshare-market', [], new Error('AkShare bridge refused request')),
    },
  })

  await assert.rejects(
    composition.registry.get(composition.market).fetch({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof MarketProviderCompositionError)
      assert.match(error.message, /tushare-market: Tushare timeout/)
      assert.match(error.message, /akshare-market: AkShare bridge refused request/)
      assert.ok(error.cause instanceof AggregateError)
      return true
    },
  )
})

test('Market composition registers configured real adapters under their stable names', async () => {
  const composition = createMarketProviderComposition(config(), {
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
    'market-provider-composition',
  ])
  assert.equal(composition.registry.get('tushare-market').name, 'tushare-market')
  assert.equal(composition.registry.get('akshare-market').name, 'akshare-market')
  assert.equal(composition.primary.name, 'tushare-market')
  assert.equal(composition.fallback?.name, 'akshare-market')
})

test('Market composition validates selected real-provider configuration and never selects Mock', () => {
  assert.throws(
    () => createMarketProviderComposition(config({ tushareToken: undefined })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /TUSHARE_TOKEN/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({ akshareEndpoint: undefined })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /AKSHARE_ENDPOINT/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({
      mode: 'fixture',
      primaryProvider: 'mock-market-provider',
      fallbackProvider: undefined,
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /requires MARKET_PROVIDER_MODE=real/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({
      primaryProvider: 'mock-market-provider',
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /cannot select mock-market-provider/.test(error.message),
  )
})

test('Market composition rejects directly supplied bogus provider names', () => {
  assert.throws(
    () => createMarketProviderComposition(config({
      primaryProvider: 'not-a-market-provider' as unknown as MarketProviderConfig['primaryProvider'],
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /MARKET_PRIMARY_PROVIDER must be one of: tushare-market, akshare-market/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({
      fallbackProvider: 'not-a-market-provider' as unknown as MarketProviderConfig['fallbackProvider'],
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /MARKET_FALLBACK_PROVIDER must be one of: tushare-market, akshare-market/.test(error.message),
  )
})

test('Market composition rejects directly supplied invalid endpoints', () => {
  assert.throws(
    () => createMarketProviderComposition(config({
      tushareEndpoint: 'file:///tmp/tushare',
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /TUSHARE_ENDPOINT must be a valid HTTP\(S\) URL/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({
      akshareEndpoint: 'not-an-endpoint',
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /AKSHARE_ENDPOINT must be a valid HTTP\(S\) URL/.test(error.message),
  )
})

test('Market composition rejects directly supplied endpoint userinfo', () => {
  assert.throws(
    () => createMarketProviderComposition(config({
      tushareEndpoint: 'https://user:password@tushare.example.test/api',
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /TUSHARE_ENDPOINT must not include username\/password userinfo/.test(error.message),
  )
  assert.throws(
    () => createMarketProviderComposition(config({
      akshareEndpoint: 'https://user@akshare.example.test/bridge',
    })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /AKSHARE_ENDPOINT must not include username\/password userinfo/.test(error.message),
  )
})

test('Market composition rejects the same provider as primary and fallback', () => {
  assert.throws(
    () => createMarketProviderComposition(config({ fallbackProvider: 'tushare-market' })),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /must differ/.test(error.message),
  )
})
