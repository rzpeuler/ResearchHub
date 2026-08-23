import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CapabilityExecutionError, type CapabilityProvider } from '../core/index.ts'
import { NewsCapability, type NewsSearchInput, type NewsSearchResult } from '../news/provider.ts'
import { MockNewsProvider } from './mock-news-provider.ts'

test('NewsCapability normalizes symbol input before crossing the Provider boundary', async () => {
  const provider = new MockNewsProvider()
  const capability = new NewsCapability(provider)

  const result = await capability.search_company_news({ symbol: ' 600519 ' })

  assert.equal(result.symbol, '600519')
  assert.equal(result.items[0]?.symbol, '600519')
  await assert.rejects(
    provider.execute({ symbol: ' 600519 ' }),
    /mock news data is unavailable/,
  )
})

test('NewsCapability rejects invalid input without calling its Provider', async () => {
  class SpyProvider implements CapabilityProvider<NewsSearchInput, NewsSearchResult> {
    readonly name = 'spy-news-provider'
    calls = 0

    async execute(_input: NewsSearchInput): Promise<NewsSearchResult> {
      this.calls += 1
      return { symbol: '600519', items: [] }
    }
  }

  const provider = new SpyProvider()
  const capability = new NewsCapability(provider)

  await assert.rejects(
    capability.search_company_news({ symbol: '   ' }),
    /symbol must not be empty/,
  )
  assert.equal(provider.calls, 0)
})

test('NewsCapability rejects malformed Provider output at the Capability boundary', async () => {
  class MalformedProvider implements CapabilityProvider<NewsSearchInput, NewsSearchResult> {
    readonly name = 'malformed-news-provider'

    async execute(_input: NewsSearchInput): Promise<NewsSearchResult> {
      return { symbol: '000001', items: [] }
    }
  }

  const capability = new NewsCapability(new MalformedProvider())

  await assert.rejects(
    capability.search_company_news({ symbol: '600519' }),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError)
      assert.match(String((error.cause as Error).message), /symbol must match the request/)
      return true
    },
  )
})

test('MockNewsProvider returns deterministic independent results', async () => {
  const provider = new MockNewsProvider()

  const first = await provider.execute({ symbol: '600519' })
  const second = await provider.execute({ symbol: '600519' })

  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second.items, first.items)
  assert.equal(first.items.length, 2)
  assert.equal(first.items[0]?.source, 'mock-news-provider')

  const firstItem = first.items[0]
  assert.ok(firstItem)
  firstItem.headline = 'mutated test result'

  const subsequent = await provider.execute({ symbol: '600519' })
  assert.equal(subsequent.items[0]?.headline, 'Mock company reports stable quarterly operations')
})

test('NewsCapability wraps Provider failures with capability context', async () => {
  const capability = new NewsCapability(new MockNewsProvider())

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
