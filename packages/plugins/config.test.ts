import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TUSHARE_ENDPOINT,
  PluginConfigurationError,
  readMarketPluginConfig,
} from './config.ts'

test('market plugin configuration uses explicit real-mode defaults', () => {
  const config = readMarketPluginConfig({})

  assert.equal(config.mode, 'real')
  assert.equal(config.primaryPlugin, 'tushare-market')
  assert.equal(config.fallbackPlugin, undefined)
  assert.equal(config.tushareEndpoint, DEFAULT_TUSHARE_ENDPOINT)
  assert.equal(config.akshareEndpoint, undefined)
  assert.equal(config.tushareToken, undefined)
})

test('market plugin configuration reads credentials and endpoints without logging them', () => {
  const config = readMarketPluginConfig({
    TUSHARE_TOKEN: 'secret-token',
    TUSHARE_ENDPOINT: 'https://tushare.example.test/api',
    AKSHARE_ENDPOINT: 'http://akshare.example.test/bridge',
    MARKET_PRIMARY_PLUGIN: 'tushare-market',
    MARKET_FALLBACK_PLUGIN: 'akshare-market',
    MARKET_PLUGIN_MODE: 'real',
  })

  assert.equal(config.tushareToken, 'secret-token')
  assert.equal(config.tushareEndpoint, 'https://tushare.example.test/api')
  assert.equal(config.akshareEndpoint, 'http://akshare.example.test/bridge')
  assert.equal(config.primaryPlugin, 'tushare-market')
  assert.equal(config.fallbackPlugin, 'akshare-market')
})

test('fixture mode is explicit and may select the mock plugin', () => {
  const config = readMarketPluginConfig({ MARKET_PLUGIN_MODE: 'fixture' })

  assert.equal(config.mode, 'fixture')
  assert.equal(config.primaryPlugin, 'mock-market-plugin')
})

test('real mode rejects mock plugin selection instead of silently using fixtures', () => {
  assert.throws(
    () => readMarketPluginConfig({
      MARKET_PLUGIN_MODE: 'real',
      MARKET_PRIMARY_PLUGIN: 'mock-market-plugin',
    }),
    (error: unknown) => error instanceof PluginConfigurationError
      && /cannot select mock-market-plugin/.test(error.message),
  )
})

test('market plugin configuration rejects invalid modes, plugins, and endpoints', () => {
  assert.throws(
    () => readMarketPluginConfig({ MARKET_PLUGIN_MODE: 'mock' }),
    /MARKET_PLUGIN_MODE must be one of/,
  )
  assert.throws(
    () => readMarketPluginConfig({ MARKET_PRIMARY_PLUGIN: 'unknown-plugin' }),
    /MARKET_PRIMARY_PLUGIN must be one of/,
  )
  assert.throws(
    () => readMarketPluginConfig({ TUSHARE_ENDPOINT: 'file:///tmp/plugin' }),
    /TUSHARE_ENDPOINT must be a valid HTTP\(S\) URL/,
  )
})

test('market plugin configuration rejects endpoint username/password userinfo without echoing it', () => {
  for (const endpoint of [
    'https://user:password@tushare.example.test/api',
    'https://encoded-user%40example.test:encoded-password@akshare.example.test/bridge',
  ]) {
    assert.throws(
      () => readMarketPluginConfig({ TUSHARE_ENDPOINT: endpoint }),
      (error: unknown) => {
        assert(error instanceof PluginConfigurationError)
        assert.match(error.message, /must not include username\/password credentials/)
        assert.doesNotMatch(error.message, /user:password|encoded-user|encoded-password/i)
        return true
      },
    )
  }

  assert.throws(
    () => readMarketPluginConfig({ AKSHARE_ENDPOINT: 'http://user:password@akshare.example.test/bridge' }),
    (error: unknown) => {
      assert(error instanceof PluginConfigurationError)
      assert.doesNotMatch(error.message, /user:password/i)
      return true
    },
  )
})
