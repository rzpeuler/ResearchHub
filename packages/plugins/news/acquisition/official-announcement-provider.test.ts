import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCninfoAnnouncementFixture, CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE } from '../../adapters/announcement/index.ts'
import { OfficialAnnouncementFetcher } from './fetcher/providers/official-announcement-fetcher.ts'
import { NewsAcquisitionLayer } from './layer.ts'
import { OfficialAnnouncementSearchProvider } from './search/providers/official-announcement-search-provider.ts'

test('OfficialAnnouncementSearchProvider projects CNINFO records into SearchResult', async () => {
  let request = { symbol: '', limit: 0 }
  const provider = new OfficialAnnouncementSearchProvider({
    sourceAdapter: {
      name: 'fixture-cninfo',
      async fetch(value) {
        request = value
        return parseCninfoAnnouncementFixture(CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE)
      },
    },
  })

  const results = await provider.search({ query: '分析 600519 公告', limit: 5 })

  assert.deepEqual(request, { symbol: '600519', limit: 5 })
  assert.equal(results.length, 1)
  assert.equal(results[0]?.source, 'cninfo')
  assert.equal(results[0]?.url, 'https://static.cninfo.com.cn/finalpage/2026-08-21/1234567890.PDF')
  assert.equal(results[0]?.metadata?.official, true)
})

test('official announcement records flow through acquisition into serializable Evidence', async () => {
  const searchProvider = new OfficialAnnouncementSearchProvider({
    sourceAdapter: {
      name: 'fixture-cninfo',
      async fetch() {
        return parseCninfoAnnouncementFixture(CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE)
      },
    },
  })
  const layer = new NewsAcquisitionLayer({
    searchProvider,
    fetcher: new OfficialAnnouncementFetcher({ clock: () => new Date('2026-08-24T00:00:00.000Z') }),
  })

  const result = await layer.acquire({ query: '600519 official announcement', limit: 5 }, {
    createdAt: '2026-08-24T00:00:00.000Z',
    sessionId: 'official-news-test',
    entity: '600519',
    reliability: 'high',
  })

  assert.equal(result.errors.length, 0)
  assert.equal(result.evidence.length, 1)
  assert.match(result.evidence[0]?.content ?? '', /公司/)
  const acquisition = result.evidence[0]?.metadata.acquisition as { provider?: unknown; entity?: unknown }
  assert.equal(acquisition.provider, 'cninfo-official-search')
  assert.equal(acquisition.entity, '600519')
  assert.doesNotThrow(() => JSON.stringify(result.evidence[0]))
})

test('official announcement search requires an A-share symbol', async () => {
  const provider = new OfficialAnnouncementSearchProvider({
    sourceAdapter: { name: 'fixture', async fetch() { return [] } },
  })
  await assert.rejects(provider.search({ query: '贵州茅台公告', limit: 1 }), /six-digit A-share symbol/)
})
