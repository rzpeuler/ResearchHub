import type { CapabilityProvider } from '../core/index.ts'
import type { NewsEvidence, NewsSearchInput, NewsSearchResult } from '../news/provider.ts'

const MOCK_NEWS: Readonly<Record<string, readonly NewsEvidence[]>> = {
  '600519': [
    {
      symbol: '600519',
      headline: 'Mock company reports stable quarterly operations',
      content: 'Deterministic mock evidence for integration validation.',
      source: 'mock-news-provider',
      timestamp: '2026-08-20T09:00:00.000Z',
      confidence: 0.95,
    },
    {
      symbol: '600519',
      headline: 'Mock company maintains planned production schedule',
      content: 'Deterministic mock evidence for research workflow tests.',
      source: 'mock-news-provider',
      timestamp: '2026-08-21T09:00:00.000Z',
      confidence: 0.9,
    },
  ],
  '000001': [
    {
      symbol: '000001',
      headline: 'Mock company publishes routine business update',
      content: 'Deterministic mock evidence for capability boundary tests.',
      source: 'mock-news-provider',
      timestamp: '2026-08-20T10:00:00.000Z',
      confidence: 0.88,
    },
  ],
}

/** Deterministic in-memory provider used only for capability validation. */
export class MockNewsProvider implements CapabilityProvider<NewsSearchInput, NewsSearchResult> {
  readonly name = 'mock-news-provider'

  async execute(input: NewsSearchInput): Promise<NewsSearchResult> {
    const items = MOCK_NEWS[input.symbol]
    if (items === undefined) {
      throw new Error(`mock news data is unavailable for symbol: ${input.symbol}`)
    }

    return {
      symbol: input.symbol,
      items: items.map((item) => ({ ...item })),
    }
  }
}
