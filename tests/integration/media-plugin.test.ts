import assert from 'node:assert/strict'
import test from 'node:test'
import { MarketPlugin } from '../../packages/plugins/market/plugin.ts'
import { NewsPlugin } from '../../packages/plugins/news/plugin.ts'
import { MockMarketPlugin } from '../../packages/plugins/adapters/mock-market-plugin.ts'
import { MEDIA_PLUGIN_FIXTURE_RECORDS } from '../../packages/plugins/adapters/media/index.ts'
import { FixtureProfessionalMediaSourceAdapter, registerMediaPlugin } from '../../packages/plugins/adapters/media/index.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import { EventAnalysisWorkflow } from '../../packages/skills/event-analysis/workflow.ts'

test('Event Analysis consumes Media Plugin output and creates research artifacts', async () => {
  const registry = new PluginRegistry()
  const market = registry.register(new MockMarketPlugin())
  const media = registerMediaPlugin(registry, {
    sourceAdapter: new FixtureProfessionalMediaSourceAdapter({ records: MEDIA_PLUGIN_FIXTURE_RECORDS }),
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
  })

  const workflow = new EventAnalysisWorkflow({
    marketPlugin: new MarketPlugin(registry, market),
    newsPlugin: new NewsPlugin(registry, media.news),
    artifactIdFactory: (type, ordinal) => `${type}-${ordinal}`,
  })

  const result = await workflow.run({
    symbol: '600519',
    sessionId: 'media-plugin-session',
    createdAt: '2026-08-24T00:00:00.000Z',
    evaluationPeriod: {
      start: '2026-08-24T00:00:00.000Z',
      end: '2026-08-31T00:00:00.000Z',
    },
  })

  assert.equal(result.status, 'success')
  assert.equal(result.artifacts.evidence.length, 2)
  assert.match(result.artifacts.evidence[1]?.content ?? '', /专业媒体/)
  assert.equal(result.artifacts.evidence[1]?.source, 'professional-media-fixture')
  assert.equal(result.artifacts.thesis.evidenceIds.length, 2)
  assert.equal(result.artifacts.prediction.thesisId, 'thesis-0')
})
