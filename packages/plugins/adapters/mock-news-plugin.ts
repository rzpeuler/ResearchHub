import { PluginValidationError, type DataPlugin, type FinancialDataMetadata } from '../core/index.ts'

export interface MockNewsRequest {
  symbol: string
}

export interface MockNewsItem {
  symbol: string
  headline: string
  content: string
  source: string
  timestamp: string
  confidence: number
}

export interface MockNewsData {
  symbol: string
  items: MockNewsItem[]
}

const MOCK_NEWS: Readonly<Record<string, readonly MockNewsItem[]>> = {
  '600519': [
    {
      symbol: '600519',
      headline: 'Mock company reports stable quarterly operations',
      content: 'Deterministic mock evidence for integration validation.',
      source: 'mock-news-plugin',
      timestamp: '2026-08-20T09:00:00.000Z',
      confidence: 0.95,
    },
    {
      symbol: '600519',
      headline: 'Mock company maintains planned production schedule',
      content: 'Deterministic mock evidence for research workflow tests.',
      source: 'mock-news-plugin',
      timestamp: '2026-08-21T09:00:00.000Z',
      confidence: 0.9,
    },
  ],
  '000001': [
    {
      symbol: '000001',
      headline: 'Mock company publishes routine business update',
      content: 'Deterministic mock evidence for plugin boundary tests.',
      source: 'mock-news-plugin',
      timestamp: '2026-08-20T10:00:00.000Z',
      confidence: 0.88,
    },
  ],
}

const MOCK_NEWS_METADATA: FinancialDataMetadata = {
  plugin: 'mock-news-plugin',
  source: 'mock-news-plugin',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'low',
  confidence: 0.95,
}

/** Deterministic news DataPlugin used by plugin and integration tests. */
export class MockNewsPlugin implements DataPlugin<MockNewsRequest, MockNewsData> {
  readonly name = 'mock-news-plugin'

  async fetch(request: MockNewsRequest) {
    const items = MOCK_NEWS[request.symbol]
    if (items === undefined) {
      throw new Error(`mock news data is unavailable for symbol: ${request.symbol}`)
    }

    return {
      data: {
        symbol: request.symbol,
        items: items.map((item) => ({ ...item })),
      },
      metadata: { ...MOCK_NEWS_METADATA },
    }
  }

  validate(value: unknown): asserts value is MockNewsData {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new PluginValidationError('expected news data to be an object')
    }

    const data = value as Record<string, unknown>
    assertAllowedFields(data, new Set(['symbol', 'items']))
    assertNonEmptyString(data.symbol, '$.symbol')
    if (!Array.isArray(data.items)) {
      throw new PluginValidationError('expected an array', '$.items')
    }

    data.items.forEach((item, index) => validateNewsItem(item, index))
  }
}

function validateNewsItem(value: unknown, index: number): asserts value is MockNewsItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected an object', `$.items[${index}]`)
  }

  const item = value as Record<string, unknown>
  assertAllowedFields(item, new Set(['symbol', 'headline', 'content', 'source', 'timestamp', 'confidence']))
  assertNonEmptyString(item.symbol, `$.items[${index}].symbol`)
  assertNonEmptyString(item.headline, `$.items[${index}].headline`)
  assertNonEmptyString(item.content, `$.items[${index}].content`)
  assertNonEmptyString(item.source, `$.items[${index}].source`)
  assertTimestamp(item.timestamp, `$.items[${index}].timestamp`)
  assertConfidence(item.confidence, `$.items[${index}].confidence`)
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new PluginValidationError(`unknown field: ${key}`, `$.${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginValidationError('expected a non-empty string', path)
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path)
  if (!value.includes('T') || Number.isNaN(Date.parse(value))) {
    throw new PluginValidationError('expected an ISO 8601 timestamp', path)
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PluginValidationError('expected a number between 0 and 1', path)
  }
}
