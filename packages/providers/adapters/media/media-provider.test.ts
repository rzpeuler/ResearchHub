import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NewsCapability } from '../../../capabilities/news/provider.ts'
import { ProviderRegistry } from '../../registry/index.ts'
import { MEDIA_SOURCE_TIERS } from '../information/index.ts'
import { MediaProvider, validateMediaProviderData } from './media-provider.ts'
import { FixtureProfessionalMediaSourceAdapter } from './source-adapter.ts'
import { MEDIA_PROVIDER_FIXTURE_RECORDS } from './fixtures.ts'
import { MediaProviderError } from './errors.ts'
import { registerMediaProvider } from './news-capability-adapter.ts'
import type { RawMediaRecord } from './types.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

test('MediaProvider normalizes professional-media NewsItems and source metadata', async () => {
  const provider = new MediaProvider({
    sourceAdapter: new FixtureProfessionalMediaSourceAdapter({ records: MEDIA_PROVIDER_FIXTURE_RECORDS }),
    clock,
  })

  const result = await provider.fetch({ symbol: '600519', limit: 5 })
  const item = result.data.items[0]

  assert.equal(item?.sourceType, 'media')
  assert.equal(item?.symbols[0], '600519')
  assert.deepEqual(item?.metadata, {
    publisher: 'Professional Finance Desk',
    tier: 'tier-1',
    confidence: 0.9,
  })
  assert.deepEqual(result.metadata, {
    provider: 'media-provider',
    source: 'professional-media',
    timestamp: '2026-08-24T00:00:00.000Z',
    quality: 'medium',
    confidence: 0.9,
  })
  assert.doesNotThrow(() => provider.validate(result.data))
})

test('MediaProvider maps issuer-only records and preserves bounded source requests', async () => {
  let receivedLimit = 0
  const record: RawMediaRecord = {
    title: 'Issuer-only media record',
    content: 'Deterministic content.',
    publishedAt: '2026-08-23T00:00:00.000Z',
    source: 'fixture-media',
    publisher: 'Industry Desk',
    tier: 'tier-2',
    confidence: 0.7,
    issuerName: '贵州茅台',
  }
  const provider = new MediaProvider({
    sourceAdapter: {
      name: 'issuer-only-source',
      async fetch(request) {
        receivedLimit = request.limit
        return [record]
      },
    },
    issuerToSymbol: { 贵州茅台: '600519' },
    clock,
  })

  const result = await provider.fetch({ symbol: '600519', limit: 3 })

  assert.equal(receivedLimit, 3)
  assert.deepEqual(result.data.items[0]?.symbols, ['600519'])
  assert.equal(result.data.items[0]?.metadata.tier, 'tier-2')
})

test('MediaProvider rejects invalid tier, mismatched symbols, and source failures', async () => {
  const invalidTier = new MediaProvider({
    sourceAdapter: {
      name: 'invalid-tier-source',
      async fetch() {
        return [{
          ...MEDIA_PROVIDER_FIXTURE_RECORDS['600519']![0]!,
          tier: 'tier-4' as never,
        }]
      },
    },
    clock,
  })
  await assert.rejects(invalidTier.fetch({ symbol: '600519' }), /tier-1, tier-2, or tier-3/)

  const mismatch = new MediaProvider({
    sourceAdapter: {
      name: 'mismatch-source',
      async fetch() {
        return [{ ...MEDIA_PROVIDER_FIXTURE_RECORDS['600519']![0]!, securityCode: '000001.SZ' }]
      },
    },
    clock,
  })
  await assert.rejects(mismatch.fetch({ symbol: '600519' }), /does not match the request/)

  const failure = new MediaProvider({
    sourceAdapter: new FixtureProfessionalMediaSourceAdapter({ failure: new Error('media source unavailable') }),
    clock,
  })
  await assert.rejects(failure.fetch({ symbol: '600519' }), MediaProviderError)
})

test('media-provider registers through Registry and remains callable by unchanged NewsCapability', async () => {
  const registry = new ProviderRegistry()
  const composition = registerMediaProvider(registry, {
    sourceAdapter: new FixtureProfessionalMediaSourceAdapter({ records: MEDIA_PROVIDER_FIXTURE_RECORDS }),
    clock,
  })
  const capability = new NewsCapability(registry, composition.news)

  assert.deepEqual(registry.list(), ['media-provider'])
  const result = await capability.search_company_news({ symbol: '600519' })

  assert.equal(result.items[0]?.headline, '专业媒体：白酒行业经营预期保持稳定')
  assert.equal(result.items[0]?.timestamp, '2026-08-23T02:00:00.000Z')
  assert.equal(result.source, 'professional-media')
  assert.equal(result.quality, 'medium')
})

test('MediaProvider validation enforces media source type and tier enum', () => {
  assert.deepEqual(MEDIA_SOURCE_TIERS, ['tier-1', 'tier-2', 'tier-3'])
  assert.throws(
    () => validateMediaProviderData({
      symbol: '600519',
      items: [{
        title: 'Invalid',
        content: 'Invalid',
        publishedAt: '2026-08-23T00:00:00.000Z',
        source: 'fixture',
        sourceType: 'official',
        symbols: ['600519'],
        confidence: 0.5,
        metadata: { publisher: 'Desk', tier: 'tier-1', confidence: 0.5 },
      }],
    }),
    /media source type/,
  )
})
