import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PluginRegistry } from '../../registry/index.ts'
import { NewsPlugin } from '../../news/plugin.ts'
import { GdeltNewsPlugin, GdeltNewsPluginError, buildGdeltQuery, normalizeGdeltTimestamp } from './gdelt-news-plugin.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

test('GDELT adapter builds a bounded entity query and normalizes ArticleList records', async () => {
  let requestedUrl = ''
  const plugin = new GdeltNewsPlugin({
    clock,
    timespan: '7d',
    limit: 5,
    transport: {
      async request(input) {
        requestedUrl = String(input)
        return response({ articles: [{ url: 'https://news.example.test/moutai', title: 'Kweichow Moutai operating update', seendate: '20260823T120000Z', domain: 'news.example.test' }] })
      },
    },
  })

  const result = await plugin.fetch({ symbol: '600519' })

  const url = new URL(requestedUrl)
  assert.equal(url.searchParams.get('query'), '"Kweichow Moutai"')
  assert.equal(url.searchParams.get('mode'), 'artlist')
  assert.equal(url.searchParams.get('format'), 'json')
  assert.equal(url.searchParams.get('maxrecords'), '5')
  assert.equal(result.data.symbol, '600519')
  assert.equal(result.data.items[0]?.headline, 'Kweichow Moutai operating update')
  assert.equal(result.data.items[0]?.content, 'Kweichow Moutai operating update')
  assert.equal(result.data.items[0]?.source, 'news.example.test')
  assert.equal(result.data.items[0]?.timestamp, '2026-08-23T12:00:00.000Z')
  assert.equal(result.metadata.plugin, 'gdelt-news')
  assert.equal(result.metadata.source, 'gdelt-doc')
  assert.equal(result.metadata.quality, 'medium')
  assert.doesNotThrow(() => plugin.validate(result.data))
})

test('GDELT adapter can be registered behind the unchanged NewsPlugin interface', async () => {
  const registry = new PluginRegistry()
  const handle = registry.register(new GdeltNewsPlugin({
    clock,
    transport: { async request() { return response({ articles: [] }) } },
  }))
  const news = new NewsPlugin(registry, handle)

  const result = await news.search_company_news({ symbol: '600519' })

  assert.equal(result.symbol, '600519')
  assert.deepEqual(result.items, [])
  assert.equal(result.source, 'gdelt-doc')
  assert.equal(result.quality, 'low')
})

test('GDELT adapter rejects malformed payloads and non-success responses', async () => {
  const malformed = new GdeltNewsPlugin({ transport: { async request() { return response({ results: [] }) } } })
  await assert.rejects(() => malformed.fetch({ symbol: '600519' }), (error: unknown) => {
    assert.ok(error instanceof GdeltNewsPluginError)
    assert.match(error.message, /missing articles/)
    return true
  })

  const failed = new GdeltNewsPlugin({ transport: { async request() { return response({}, 503) } } })
  await assert.rejects(() => failed.fetch({ symbol: '600519' }), /HTTP 503/)
})

test('GDELT adapter normalizes timestamps and rejects invalid endpoint configuration', () => {
  assert.equal(normalizeGdeltTimestamp('20260824T010203Z'), '2026-08-24T01:02:03.000Z')
  assert.throws(() => normalizeGdeltTimestamp('not-a-date'), /invalid gdelt publication time/)
  assert.throws(() => new GdeltNewsPlugin({ endpoint: 'https://user:pass@example.test/doc' }), /must not include credentials/)
  assert.equal(buildGdeltQuery('000001', { '000001': 'Example Holdings' }), '"Example Holdings"')
})

test('GDELT adapter preserves cancellation failures without exposing a raw endpoint', async () => {
  const plugin = new GdeltNewsPlugin({
    endpoint: 'https://api.example.test/private/doc',
    transport: {
      async request(_input, init) {
        assert.ok(init?.signal)
        throw new Error('fetch failed for https://api.example.test/private/doc')
      },
    },
  })
  await assert.rejects(() => plugin.fetch({ symbol: '600519' }), (error: unknown) => {
    assert.ok(error instanceof GdeltNewsPluginError)
    assert.match(error.message, /request failed/)
    assert.doesNotMatch(error.message, /api\.example\.test/)
    return true
  })
})
