import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CapabilityExecutionError } from '../core/index.ts'
import { NewsCapability, type NewsProviderData, type NewsSearchInput } from '../news/provider.ts'
import { MockNewsProvider } from './mock-news-provider.ts'
import { ProviderRegistry, createMockProviderComposition, type DataProvider } from '../../providers/index.ts'

const newsMetadata = {
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

test('MockNewsProvider returns deterministic independent DataProvider results', async () => {
  const provider = new MockNewsProvider()

  const first = await provider.fetch({ symbol: '600519' })
  const second = await provider.fetch({ symbol: '600519' })

  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second.data.items, first.data.items)
  assert.equal(first.data.items.length, 2)
  assert.equal(first.data.items[0]?.source, 'mock-news-provider')
  assert.doesNotThrow(() => provider.validate(first.data))

  const firstItem = first.data.items[0]
  assert.ok(firstItem)
  firstItem.headline = 'mutated test result'
  const subsequent = await provider.fetch({ symbol: '600519' })
  assert.equal(subsequent.data.items[0]?.headline, 'Mock company reports stable quarterly operations')
})

test('NewsCapability normalizes input and projects Provider metadata without Registry details', async () => {
  const composition = createMockProviderComposition()
  const capability = new NewsCapability(composition.registry, composition.news)

  const result = await capability.search_company_news({ symbol: ' 600519 ' })

  assert.equal(result.symbol, '600519')
  assert.equal(result.items[0]?.symbol, '600519')
  assert.equal(result.source, 'mock-news-provider')
  assert.equal(result.timestamp, '2026-08-23T09:00:00.000Z')
  assert.equal(result.quality, 'low')
  assert.equal(result.confidence, 0.95)
  assert.equal('registry' in result, false)
})

test('NewsCapability routes through a typed registered handle', async () => {
  let calls = 0
  const provider: DataProvider<NewsSearchInput, NewsProviderData> = {
    name: 'routed-news-provider',
    async fetch() {
      calls += 1
      return { data: { ...newsData, items: newsData.items.map((item) => ({ ...item })) }, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new NewsCapability(registry, registry.register(provider))

  const result = await capability.search_company_news({ symbol: '600519' })

  assert.equal(calls, 1)
  assert.equal(result.source, 'fixture-news')
  assert.equal(result.items[0]?.headline, 'Company update')
})

test('NewsCapability receives isolated nested Provider results from the Registry', async () => {
  const providerResult = {
    data: newsData,
    metadata: newsMetadata,
  }
  const provider: DataProvider<NewsSearchInput, NewsProviderData> = {
    name: 'shared-result-news-provider',
    async fetch() {
      return providerResult
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new NewsCapability(registry, registry.register(provider))

  const first = await capability.search_company_news({ symbol: '600519' })
  first.items[0]!.headline = 'mutated capability result'

  assert.equal(providerResult.data.items[0]?.headline, 'Company update')

  const second = await capability.search_company_news({ symbol: '600519' })
  assert.equal(second.items[0]?.headline, 'Company update')
  assert.notStrictEqual(second.items, first.items)
  assert.notStrictEqual(second.items[0], first.items[0])
})

test('NewsCapability rejects invalid input without calling its registered Provider', async () => {
  let calls = 0
  const provider: DataProvider<NewsSearchInput, NewsProviderData> = {
    name: 'spy-news-provider',
    async fetch() {
      calls += 1
      return { data: newsData, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new NewsCapability(registry, registry.register(provider))

  await assert.rejects(
    capability.search_company_news({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(calls, 0)
})

test('NewsCapability rejects malformed registered Provider output', async () => {
  const provider: DataProvider<NewsSearchInput, NewsProviderData> = {
    name: 'malformed-news-provider',
    async fetch() {
      return { data: { symbol: '000001', items: [] }, metadata: newsMetadata }
    },
    validate() {},
  }
  const registry = new ProviderRegistry()
  const capability = new NewsCapability(registry, registry.register(provider))

  await assert.rejects(
    capability.search_company_news({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError)
      assert.match(String((error.cause as Error).message), /symbol must match the request/)
      return true
    },
  )
})

test('NewsCapability wraps Provider failures with capability context', async () => {
  const composition = createMockProviderComposition()
  const capability = new NewsCapability(composition.registry, composition.news)

  await assert.rejects(
    capability.search_company_news({ symbol: '999999' }),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError)
      assert.equal(error.capabilityName, 'search_company_news')
      assert.equal(error.providerName, 'mock-news-provider')
      assert.deepEqual(error.input, { symbol: '999999' })
      assert.match(String((error.cause as Error).message), /mock news data is unavailable/)
      return true
    },
  )
})
