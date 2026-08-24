import assert from 'node:assert/strict'
import test from 'node:test'
import { CninfoAnnouncementSourceAdapter } from '../../packages/plugins/adapters/announcement/index.ts'
import {
  NewsAcquisitionLayer,
  OfficialAnnouncementFetcher,
  OfficialAnnouncementSearchProvider,
} from '../../packages/plugins/news/index.ts'

const enabled = process.env.RUN_REAL_OFFICIAL_NEWS === '1'

test('real CNINFO Official Announcement Provider feeds News Acquisition and Evidence', { skip: !enabled }, async () => {
  const symbol = process.env.OFFICIAL_NEWS_SYMBOL ?? '600519'
  const provider = new OfficialAnnouncementSearchProvider({
    sourceAdapter: new CninfoAnnouncementSourceAdapter({
      endpoint: process.env.CNINFO_ANNOUNCEMENT_ENDPOINT,
    }),
  })
  const layer = new NewsAcquisitionLayer({
    searchProvider: provider,
    fetcher: new OfficialAnnouncementFetcher(),
  })

  const result = await layer.acquire({ query: `${symbol} official announcement`, entity: symbol, limit: 3 }, {
    createdAt: new Date().toISOString(),
    sessionId: 'real-official-news-provider',
    entity: symbol,
    provider: provider.name,
    reliability: 'high',
  })

  assert.ok(result.searchResults.length > 0, 'CNINFO returned no announcements')
  assert.ok(result.evidence.length > 0, 'CNINFO announcements produced no Evidence')
  const resultItem = result.searchResults[0]
  assert.ok(resultItem?.title, 'announcement title is missing')
  assert.ok(resultItem?.source, 'announcement source is missing')
  assert.ok(resultItem?.url, 'announcement URL is missing')
  assert.ok(resultItem?.publishedAt, 'announcement publication time is missing')
  assert.ok(result.articles[0]?.content, 'announcement content is missing')
  console.log(JSON.stringify({
    provider: provider.name,
    symbol,
    searchResults: result.searchResults.length,
    evidence: result.evidence.length,
    errors: result.errors,
  }))
})
