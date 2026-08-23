import assert from 'node:assert/strict'
import test from 'node:test'
import { MockMarketPlugin } from '../../packages/plugins/adapters/mock-market-plugin.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import { MarketPlugin } from '../../packages/plugins/market/plugin.ts'
import { NewsPlugin } from '../../packages/plugins/news/plugin.ts'
import { EventAnalysisWorkflow } from '../../packages/skills/event-analysis/workflow.ts'
import {
  CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE,
  parseCninfoAnnouncementFixture,
  registerAnnouncementPlugin,
} from '../../packages/plugins/adapters/announcement/index.ts'

test('Event Analysis consumes Announcement Plugin output and creates research artifacts', async () => {
  const registry = new PluginRegistry()
  const market = registry.register(new MockMarketPlugin())
  const announcement = registerAnnouncementPlugin(registry, {
    sourceAdapter: {
      name: 'fixture-cninfo-source',
      async fetch() {
        return parseCninfoAnnouncementFixture(CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE)
      },
    },
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
  })

  const workflow = new EventAnalysisWorkflow({
    marketPlugin: new MarketPlugin(registry, market),
    newsPlugin: new NewsPlugin(registry, announcement.news),
    artifactIdFactory: (type, ordinal) => `${type}-${ordinal}`,
  })

  const result = await workflow.run({
    symbol: '600519',
    sessionId: 'announcement-plugin-session',
    createdAt: '2026-08-24T00:00:00.000Z',
    evaluationPeriod: {
      start: '2026-08-24T00:00:00.000Z',
      end: '2026-08-31T00:00:00.000Z',
    },
  })

  assert.equal(result.status, 'success')
  assert.equal(result.artifacts.evidence.length, 2)
  assert.match(result.artifacts.evidence[1]?.content ?? '', /关于公司经营情况的公告/)
  assert.equal(result.artifacts.evidence[1]?.source, 'cninfo')
  assert.equal(result.artifacts.thesis.evidenceIds.length, 2)
  assert.equal(result.artifacts.prediction.thesisId, 'thesis-0')
})
