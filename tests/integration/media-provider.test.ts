import assert from 'node:assert/strict'
import test from 'node:test'
import { MarketCapability } from '../../packages/capabilities/market/provider.ts'
import { NewsCapability } from '../../packages/capabilities/news/provider.ts'
import { MockMarketProvider } from '../../packages/providers/adapters/mock-market-provider.ts'
import { MEDIA_PROVIDER_FIXTURE_RECORDS } from '../../packages/providers/adapters/media/index.ts'
import { FixtureProfessionalMediaSourceAdapter, registerMediaProvider } from '../../packages/providers/adapters/media/index.ts'
import { ProviderRegistry } from '../../packages/providers/registry/index.ts'
import { EventAnalysisWorkflow } from '../../packages/skills/event-analysis/workflow.ts'

test('Event Analysis consumes Media Provider output and creates research artifacts', async () => {
  const registry = new ProviderRegistry()
  const market = registry.register(new MockMarketProvider())
  const media = registerMediaProvider(registry, {
    sourceAdapter: new FixtureProfessionalMediaSourceAdapter({ records: MEDIA_PROVIDER_FIXTURE_RECORDS }),
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
  })

  const workflow = new EventAnalysisWorkflow({
    marketCapability: new MarketCapability(registry, market),
    newsCapability: new NewsCapability(registry, media.news),
    artifactIdFactory: (type, ordinal) => `${type}-${ordinal}`,
  })

  const result = await workflow.run({
    symbol: '600519',
    sessionId: 'media-provider-session',
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
