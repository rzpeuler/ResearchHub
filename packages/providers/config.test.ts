import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TUSHARE_ENDPOINT,
  ProviderConfigurationError,
  readMarketProviderConfig,
} from './config.ts'

test('market provider configuration uses explicit real-mode defaults', () => {
  const config = readMarketProviderConfig({})

  assert.equal(config.mode, 'real')
  assert.equal(config.primaryProvider, 'tushare-market')
  assert.equal(config.fallbackProvider, undefined)
  assert.equal(config.tushareEndpoint, DEFAULT_TUSHARE_ENDPOINT)
  assert.equal(config.akshareEndpoint, undefined)
  assert.equal(config.tushareToken, undefined)
})

test('market provider configuration reads credentials and endpoints without logging them', () => {
  const config = readMarketProviderConfig({
    TUSHARE_TOKEN: 'secret-token',
    TUSHARE_ENDPOINT: 'https://tushare.example.test/api',
    AKSHARE_ENDPOINT: 'http://akshare.example.test/bridge',
    MARKET_PRIMARY_PROVIDER: 'tushare-market',
    MARKET_FALLBACK_PROVIDER: 'akshare-market',
    MARKET_PROVIDER_MODE: 'real',
  })

  assert.equal(config.tushareToken, 'secret-token')
  assert.equal(config.tushareEndpoint, 'https://tushare.example.test/api')
  assert.equal(config.akshareEndpoint, 'http://akshare.example.test/bridge')
  assert.equal(config.primaryProvider, 'tushare-market')
  assert.equal(config.fallbackProvider, 'akshare-market')
})

test('fixture mode is explicit and may select the mock provider', () => {
  const config = readMarketProviderConfig({ MARKET_PROVIDER_MODE: 'fixture' })

  assert.equal(config.mode, 'fixture')
  assert.equal(config.primaryProvider, 'mock-market-provider')
})

test('real mode rejects mock provider selection instead of silently using fixtures', () => {
  assert.throws(
    () => readMarketProviderConfig({
      MARKET_PROVIDER_MODE: 'real',
      MARKET_PRIMARY_PROVIDER: 'mock-market-provider',
    }),
    (error: unknown) => error instanceof ProviderConfigurationError
      && /cannot select mock-market-provider/.test(error.message),
  )
})

test('market provider configuration rejects invalid modes, providers, and endpoints', () => {
  assert.throws(
    () => readMarketProviderConfig({ MARKET_PROVIDER_MODE: 'mock' }),
    /MARKET_PROVIDER_MODE must be one of/,
  )
  assert.throws(
    () => readMarketProviderConfig({ MARKET_PRIMARY_PROVIDER: 'unknown-provider' }),
    /MARKET_PRIMARY_PROVIDER must be one of/,
  )
  assert.throws(
    () => readMarketProviderConfig({ TUSHARE_ENDPOINT: 'file:///tmp/provider' }),
    /TUSHARE_ENDPOINT must be a valid HTTP\(S\) URL/,
  )
})

test('market provider configuration rejects endpoint username/password userinfo without echoing it', () => {
  for (const endpoint of [
    'https://user:password@tushare.example.test/api',
    'https://encoded-user%40example.test:encoded-password@akshare.example.test/bridge',
  ]) {
    assert.throws(
      () => readMarketProviderConfig({ TUSHARE_ENDPOINT: endpoint }),
      (error: unknown) => {
        assert(error instanceof ProviderConfigurationError)
        assert.match(error.message, /must not include username\/password credentials/)
        assert.doesNotMatch(error.message, /user:password|encoded-user|encoded-password/i)
        return true
      },
    )
  }

  assert.throws(
    () => readMarketProviderConfig({ AKSHARE_ENDPOINT: 'http://user:password@akshare.example.test/bridge' }),
    (error: unknown) => {
      assert(error instanceof ProviderConfigurationError)
      assert.doesNotMatch(error.message, /user:password/i)
      return true
    },
  )
})
