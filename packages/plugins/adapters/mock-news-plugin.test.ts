import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PluginExecutionError } from '../core/index.ts'
import { NewsPlugin, type NewsPluginData, type NewsSearchInput } from '../news/plugin.ts'
import { MockNewsPlugin } from './mock-news-plugin.ts'
import { PluginRegistry, createMockPluginComposition, type DataPlugin } from '../../plugins/index.ts'

const newsMetadata = {
  plugin: 'fixture-news-plugin',
  source: 'fixture-news',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'high' as const,
  confidence: 0.9,
}

const newsData = {
  symbol: '600519',
  items: [{
    symbol: '600519',
    headline: 'Company update',
    content: 'A deterministic test news item.',
    source: 'fixture-news',
    timestamp: '2026-08-23T08:00:00.000Z',
    confidence: 0.7,
  }],
}

test('MockNewsPlugin returns deterministic independent DataPlugin results', async () => {
  const plugin = new MockNewsPlugin()

  const first = await plugin.fetch({ symbol: '600519' })
  const second = await plugin.fetch({ symbol: '600519' })

  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second.data.items, first.data.items)
  assert.equal(first.data.items.length, 2)
  assert.equal(first.data.items[0]?.source, 'mock-news-plugin')
  assert.doesNotThrow(() => plugin.validate(first.data))

  const firstItem = first.data.items[0]
  assert.ok(firstItem)
  firstItem.headline = 'mutated test result'
  const subsequent = await plugin.fetch({ symbol: '600519' })
  assert.equal(subsequent.data.items[0]?.headline, 'Mock company reports stable quarterly operations')
})

test('NewsPlugin normalizes input and projects Plugin metadata without Registry details', async () => {
  const composition = createMockPluginComposition()
  const operation = new NewsPlugin(composition.registry, composition.news)

  const result = await operation.search_company_news({ symbol: ' 600519 ' })

  assert.equal(result.symbol, '600519')
  assert.equal(result.items[0]?.symbol, '600519')
  assert.equal('plugin' in result, false)
  assert.equal(result.source, 'mock-news-plugin')
  assert.equal(result.timestamp, '2026-08-23T09:00:00.000Z')
  assert.equal(result.quality, 'low')
  assert.equal(result.confidence, 0.95)
  assert.equal('registry' in result, false)
})

test('NewsPlugin routes through a typed registered handle', async () => {
  let calls = 0
  const plugin: DataPlugin<NewsSearchInput, NewsPluginData> = {
    name: 'routed-news-plugin',
    async fetch() {
      calls += 1
      return { data: { ...newsData, items: newsData.items.map((item) => ({ ...item })) }, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new NewsPlugin(registry, registry.register(plugin))

  const result = await operation.search_company_news({ symbol: '600519' })

  assert.equal(calls, 1)
  assert.equal('plugin' in result, false)
  assert.equal(result.source, 'fixture-news')
  assert.equal(result.items[0]?.headline, 'Company update')
})

test('NewsPlugin receives isolated nested Plugin results from the Registry', async () => {
  const pluginResult = {
    data: newsData,
    metadata: newsMetadata,
  }
  const plugin: DataPlugin<NewsSearchInput, NewsPluginData> = {
    name: 'shared-result-news-plugin',
    async fetch() {
      return pluginResult
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new NewsPlugin(registry, registry.register(plugin))

  const first = await operation.search_company_news({ symbol: '600519' })
  first.items[0]!.headline = 'mutated plugin result'

  assert.equal(pluginResult.data.items[0]?.headline, 'Company update')

  const second = await operation.search_company_news({ symbol: '600519' })
  assert.equal(second.items[0]?.headline, 'Company update')
  assert.notStrictEqual(second.items, first.items)
  assert.notStrictEqual(second.items[0], first.items[0])
})

test('NewsPlugin rejects invalid input without calling its registered Plugin', async () => {
  let calls = 0
  const plugin: DataPlugin<NewsSearchInput, NewsPluginData> = {
    name: 'spy-news-plugin',
    async fetch() {
      calls += 1
      return { data: newsData, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new NewsPlugin(registry, registry.register(plugin))

  await assert.rejects(
    operation.search_company_news({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(calls, 0)
})

test('NewsPlugin rejects malformed registered Plugin output', async () => {
  const plugin: DataPlugin<NewsSearchInput, NewsPluginData> = {
    name: 'malformed-news-plugin',
    async fetch() {
      return { data: { symbol: '000001', items: [] }, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new PluginRegistry()
  const operation = new NewsPlugin(registry, registry.register(plugin))

  await assert.rejects(
    operation.search_company_news({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof PluginExecutionError)
      assert.match(String((error.cause as Error).message), /symbol must match the request/)
      return true
    },
  )
})

test('NewsPlugin wraps Plugin failures with plugin context', async () => {
  const composition = createMockPluginComposition()
  const operation = new NewsPlugin(composition.registry, composition.news)

  await assert.rejects(
    operation.search_company_news({ symbol: '999999' }),
    (error: unknown) => {
      assert.ok(error instanceof PluginExecutionError)
      assert.equal(error.operationName, 'search_company_news')
      assert.equal(error.pluginName, 'mock-news-plugin')
      assert.deepEqual(error.input, { symbol: '999999' })
      assert.match(String((error.cause as Error).message), /mock news data is unavailable/)
      return true
    },
  )
})
