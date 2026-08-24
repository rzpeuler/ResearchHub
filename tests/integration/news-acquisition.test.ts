import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deserializeEvidence, serializeEvidence } from '../../packages/artifacts/index.ts'
import {
  GdeltSearchProvider,
  HtmlArticleNormalizer,
  MockSearchProvider,
  MockWebFetcher,
  NativeWebFetcher,
  NewsAcquisitionLayer,
} from '../../packages/plugins/news/index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'

test('NEWS-ACQUISITION-001 completes Search -> Fetch -> Normalize -> Evidence without network', async () => {
  const url = 'https://news.example.test/moutai'
  const layer = new NewsAcquisitionLayer({
    searchProvider: new MockSearchProvider([{
      title: 'Kweichow Moutai operating update',
      url,
      snippet: 'Revenue update',
      source: 'news.example.test',
      publishedAt: '2026-08-23T12:00:00.000Z',
    }]),
    fetcher: new MockWebFetcher({
      [url]: {
        url,
        html: '<html><head><title>Ignored candidate title</title><script>remove me</script></head><body><article>Revenue rose and operating margin held.</article></body></html>',
        fetchedAt: createdAt,
        status: 200,
        contentType: 'text/html',
      },
    }),
    normalizer: new HtmlArticleNormalizer(),
    evidenceIdFactory: (index) => `news-acquisition-${index + 1}`,
  })

  const result = await layer.acquire({ query: 'earnings update', entity: '600519', limit: 1 }, {
    createdAt,
    sessionId: 'news-acquisition-integration',
    entity: '600519',
  })

  assert.equal(result.searchResults.length, 1)
  assert.equal(result.documents.length, 1)
  assert.equal(result.articles.length, 1)
  assert.equal(result.evidence.length, 1)
  assert.deepEqual(result.errors, [])
  assert.match(result.evidence[0]?.content ?? '', /Revenue rose/)
  const acquisition = result.evidence[0]?.metadata.acquisition as { entity?: unknown } | undefined
  assert.equal(acquisition?.entity, '600519')
  assert.deepEqual(deserializeEvidence(serializeEvidence(result.evidence[0]!)), result.evidence[0])
})

test('NEWS-ACQUISITION-001 reports candidate fetch failures without fabricating Evidence', async () => {
  const layer = new NewsAcquisitionLayer({
    searchProvider: new MockSearchProvider([{
      title: 'Unavailable article',
      url: 'https://news.example.test/missing',
      source: 'news.example.test',
    }]),
    fetcher: new MockWebFetcher({}),
  })

  const result = await layer.acquire({ query: 'unavailable', entity: '600519', limit: 1 }, {
    createdAt,
    sessionId: 'news-acquisition-error-test',
  })

  assert.equal(result.evidence.length, 0)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0]?.stage, 'fetch')
})

test('NEWS-ACQUISITION-001 real network path is opt-in', {
  skip: process.env.RUN_REAL_NEWS_ACQUISITION === '1' ? false : 'set RUN_REAL_NEWS_ACQUISITION=1 to enable GDELT and web fetch calls',
}, async () => {
  const layer = new NewsAcquisitionLayer({
    searchProvider: new GdeltSearchProvider({ timespan: '7d', timeoutMs: 30_000 }),
    fetcher: new NativeWebFetcher({ timeoutMs: 30_000 }),
  })
  const result = await layer.acquire({ query: 'Kweichow Moutai', entity: '600519', limit: 1 }, {
    createdAt,
    sessionId: 'news-acquisition-real',
    entity: '600519',
  })

  assert.ok(result.searchResults.length > 0)
  assert.ok(result.articles.length > 0)
  assert.ok(result.evidence.length > 0)
  assert.deepEqual(result.errors, [])
})
