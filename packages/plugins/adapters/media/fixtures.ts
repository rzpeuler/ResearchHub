import type { RawMediaRecord } from './types.ts'

export const MEDIA_PLUGIN_FIXTURE_RECORDS: Readonly<Record<string, readonly RawMediaRecord[]>> = {
  '600519': [
    {
      title: '专业媒体：白酒行业经营预期保持稳定',
      content: '专业财经媒体 fixture，用于验证市场解释类信息接入。',
      publishedAt: '2026-08-23T02:00:00.000Z',
      source: 'professional-media-fixture',
      publisher: 'Professional Finance Desk',
      tier: 'tier-1',
      confidence: 0.82,
      metadataConfidence: 0.9,
      securityCode: '600519.SH',
    },
  ],
}
