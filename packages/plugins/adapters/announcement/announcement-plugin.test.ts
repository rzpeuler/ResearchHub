import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NewsPlugin } from '../../../plugins/news/plugin.ts'
import { PluginRegistry } from '../../registry/index.ts'
import { AnnouncementPlugin, validateAnnouncementPluginData } from './announcement-plugin.ts'
import {
  CninfoAnnouncementSourceAdapter,
  parseCninfoAnnouncementFixture,
} from './cninfo-source-adapter.ts'
import {
  CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE,
  CNINFO_ISSUER_ONLY_FIXTURE,
  CNINFO_STOCK_DIRECTORY_RESPONSE_FIXTURE,
} from './fixtures.ts'
import { AnnouncementPluginError } from './errors.ts'
import { registerAnnouncementPlugin } from './news-plugin-adapter.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function response(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

test('CNINFO source adapter builds an injectable official-source request and parses fixture payload', async () => {
  let requestBody = ''
  const adapter = new CninfoAnnouncementSourceAdapter({
    endpoint: 'https://cninfo.example.test/announcements',
    transport: {
      async request(_input, init) {
        if (init?.method === 'GET') return response(CNINFO_STOCK_DIRECTORY_RESPONSE_FIXTURE)
        requestBody = String(init?.body)
        return response(CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE)
      },
    },
  })

  const records = await adapter.fetch({
    symbol: '600519',
    limit: 10,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-08-24T00:00:00.000Z',
  })

  assert.match(requestBody, /stock=600519%2Cgssh0600519/)
  assert.match(requestBody, /pageSize=10/)
  assert.match(requestBody, /column=sse/)
  assert.match(requestBody, /seDate=2026-01-01%7E2026-08-24/)
  assert.equal(records[0]?.title, '关于公司经营情况的公告')
  assert.equal(records[0]?.securityCode, '600519.SH')
  assert.equal(records[0]?.sourceUrl, 'https://static.cninfo.com.cn/finalpage/2026-08-21/1234567890.PDF')
})

test('CNINFO source adapter reports HTTP, JSON, and payload errors', async () => {
  const httpFailure = new CninfoAnnouncementSourceAdapter({
    transport: { async request() { return new Response('unavailable', { status: 503 }) } },
  })
  await assert.rejects(httpFailure.fetch({ symbol: '600519', limit: 1 }), AnnouncementPluginError)

  const invalidJson = new CninfoAnnouncementSourceAdapter({
    transport: { async request() { return new Response('not-json', { status: 200 }) } },
  })
  await assert.rejects(invalidJson.fetch({ symbol: '600519', limit: 1 }), AnnouncementPluginError)

  const malformed = new CninfoAnnouncementSourceAdapter({
    transport: {
      async request(_input, init) {
        return init?.method === 'GET'
          ? response(CNINFO_STOCK_DIRECTORY_RESPONSE_FIXTURE)
          : response({ unexpected: [] })
      },
    },
  })
  await assert.rejects(malformed.fetch({ symbol: '600519', limit: 1 }), /missing announcements/)
})

test('CNINFO source adapter accepts epoch timestamps and zero-result responses', async () => {
  let query = false
  const adapter = new CninfoAnnouncementSourceAdapter({
    transport: {
      async request(_input, init) {
        if (init?.method === 'GET') return response(CNINFO_STOCK_DIRECTORY_RESPONSE_FIXTURE)
        query = true
        return response({ announcements: null, totalAnnouncement: 0 })
      },
    },
  })

  assert.deepEqual(await adapter.fetch({ symbol: '600519', limit: 1 }), [])
  assert.equal(query, true)
  const records = parseCninfoAnnouncementFixture([{
    title: 'Epoch announcement',
    content: 'Announcement content',
    publishedAt: 1786723200000,
    source: 'cninfo',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/example.PDF',
  }])
  assert.equal(records[0]?.publishedAt, '2026-08-14T16:00:00.000Z')
})

test('AnnouncementPlugin normalizes official NewsItems and maps issuer-only records', async () => {
  const sourceAdapter = {
    name: 'fixture-official-source',
    async fetch() {
      return parseCninfoAnnouncementFixture(CNINFO_ISSUER_ONLY_FIXTURE)
    },
  }
  const plugin = new AnnouncementPlugin({
    sourceAdapter,
    issuerToSymbol: { 贵州茅台: '600519' },
    clock,
    sourceName: 'cninfo',
  })

  const result = await plugin.fetch({ symbol: '600519', limit: 5 })

  assert.equal(result.data.symbol, '600519')
  assert.deepEqual(result.data.items[0], {
    title: '关于公司治理事项的公告',
    content: '公司发布治理事项公告正文。',
    publishedAt: '2026-08-22T01:30:00.000Z',
    source: 'cninfo',
    sourceType: 'official',
    symbols: ['600519'],
    confidence: 0.95,
  })
  assert.deepEqual(result.metadata, {
    plugin: 'announcement-plugin',
    source: 'cninfo',
    timestamp: '2026-08-24T00:00:00.000Z',
    quality: 'high',
    confidence: 0.95,
  })
  assert.doesNotThrow(() => plugin.validate(result.data))
})

test('AnnouncementPlugin rejects mismatched or unmappable announcement records', async () => {
  const mismatched = new AnnouncementPlugin({
    sourceAdapter: {
      name: 'fixture',
      async fetch() {
        return [{
          title: 'Wrong company',
          content: 'Content',
          publishedAt: '2026-08-22T00:00:00.000Z',
          source: 'cninfo',
          securityCode: '000001.SZ',
        }]
      },
    },
    clock,
  })
  await assert.rejects(mismatched.fetch({ symbol: '600519' }), /does not match the request/)

  const unmappable = new AnnouncementPlugin({
    sourceAdapter: {
      name: 'fixture',
      async fetch() {
        return [{
          title: 'Unknown company',
          content: 'Content',
          publishedAt: '2026-08-22T00:00:00.000Z',
          source: 'cninfo',
          issuerName: 'Unknown',
        }]
      },
    },
    clock,
  })
  await assert.rejects(unmappable.fetch({ symbol: '600519' }), /cannot be mapped/)
})

test('announcement-plugin registers through Registry and remains callable by unchanged NewsPlugin', async () => {
  const registry = new PluginRegistry()
  const composition = registerAnnouncementPlugin(registry, {
    sourceAdapter: {
      name: 'fixture',
      async fetch() {
        return parseCninfoAnnouncementFixture(CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE)
      },
    },
    clock,
  })
  const plugin = new NewsPlugin(registry, composition.news)

  assert.deepEqual(registry.list(), ['announcement-plugin'])
  const result = await plugin.search_company_news({ symbol: '600519' })

  assert.equal(result.items[0]?.headline, '关于公司经营情况的公告')
  assert.equal(result.items[0]?.timestamp, '2026-08-21T01:30:00.000Z')
  assert.equal(result.source, 'cninfo')
  assert.equal(result.quality, 'high')
  assert.equal(composition.plugin.name, 'announcement-plugin')
})

test('Announcement Plugin validation rejects non-official and malformed NewsItems', () => {
  assert.throws(
    () => validateAnnouncementPluginData({
      symbol: '600519',
      items: [{
        title: 'Invalid',
        content: 'Invalid',
        publishedAt: '2026-08-22T00:00:00.000Z',
        source: 'community',
        sourceType: 'community',
        symbols: ['600519'],
        confidence: 0.5,
      }],
    }),
    /official source type/,
  )
})
