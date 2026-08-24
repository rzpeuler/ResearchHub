import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deserializeEvidence, serializeEvidence } from '../../../artifacts/index.ts'
import { NewsEvidenceBuilder } from './evidence/evidence-builder.ts'
import { NativeWebFetcher } from './fetcher/providers/native-web-fetcher.ts'
import { HtmlArticleNormalizer } from './normalization/article-normalizer.ts'
import { GdeltSearchProvider } from './search/providers/gdelt-search-provider.ts'

function response(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

test('HtmlArticleNormalizer removes executable markup and preserves trace metadata', () => {
  const normalizer = new HtmlArticleNormalizer()
  const article = normalizer.normalize({
    url: 'https://news.example.test/article',
    html: '<html><head><title>  Company Update </title><script>alert(1)</script></head><body><article>Revenue rose &amp; margins held.</article></body></html>',
    fetchedAt: '2026-08-24T00:00:00.000Z',
    status: 200,
    contentType: 'text/html',
  }, {
    title: 'Company Update',
    url: 'https://news.example.test/article',
    source: 'news.example.test',
    publishedAt: '2026-08-23T12:00:00.000Z',
  })

  assert.equal(article.title, 'Company Update')
  assert.equal(article.content, 'Revenue rose & margins held.')
  assert.equal(article.source, 'news.example.test')
  assert.equal(article.publishedAt, '2026-08-23T12:00:00.000Z')
  assert.equal(article.metadata.url, 'https://news.example.test/article')
})

test('NativeWebFetcher enforces HTML fetching through the injected transport', async () => {
  let requestedUrl = ''
  const fetcher = new NativeWebFetcher({
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    transport: {
      async request(input, init) {
        requestedUrl = String(input)
        assert.equal(init?.method, 'GET')
        return response('<html>body</html>')
      },
    },
  })

  const document = await fetcher.fetch({ url: 'https://news.example.test/article' })
  assert.equal(requestedUrl, 'https://news.example.test/article')
  assert.equal(document.html, '<html>body</html>')
  assert.equal(document.fetchedAt, '2026-08-24T00:00:00.000Z')
})

test('GdeltSearchProvider maps ArticleList payloads into SearchResult records', async () => {
  let requestedUrl = ''
  const provider = new GdeltSearchProvider({
    timespan: '7d',
    timeoutMs: 5_000,
    transport: {
      async request(input) {
        requestedUrl = String(input)
        return new Response(JSON.stringify({ articles: [{
          url: 'https://news.example.test/moutai',
          title: 'Kweichow Moutai operating update',
          seendate: '20260823T120000Z',
          domain: 'news.example.test',
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    },
  })

  const results = await provider.search({ query: 'earnings', entity: 'Kweichow Moutai', limit: 5 })
  const url = new URL(requestedUrl)
  assert.equal(url.searchParams.get('query'), '"Kweichow Moutai" earnings')
  assert.equal(results[0]?.title, 'Kweichow Moutai operating update')
  assert.equal(results[0]?.publishedAt, '2026-08-23T12:00:00.000Z')
})

test('NewsEvidenceBuilder creates a serializable Evidence Artifact with acquisition metadata', () => {
  const article = new HtmlArticleNormalizer().normalize({
    url: 'https://news.example.test/article',
    html: '<title>Company Update</title><article>Revenue rose.</article>',
    fetchedAt: '2026-08-24T00:00:00.000Z',
    status: 200,
  })
  const evidence = new NewsEvidenceBuilder().build(article, {
    id: 'news-evidence-001',
    createdAt: '2026-08-24T00:00:00.000Z',
    sessionId: 'news-acquisition-test',
    entity: '600519',
    provider: 'mock-search',
    reliability: 'medium',
  })

  assert.equal(evidence.source, 'news.example.test')
  const acquisition = evidence.metadata.acquisition as { entity?: unknown; reliability?: unknown }
  assert.equal(acquisition.entity, '600519')
  assert.equal(acquisition.reliability, 'medium')
  assert.deepEqual(deserializeEvidence(serializeEvidence(evidence)), evidence)
})
