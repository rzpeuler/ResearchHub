import {
  CapabilityExecutionError,
  defineCapability,
  type CapabilityInput,
  type CapabilityOutput,
  type CapabilityProvider,
} from '../core/index.ts'

const newsSearchInputSchema = {
  symbol: { type: 'string', required: true, description: 'Stock symbol.' },
} as const

const newsSearchOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    symbol: { type: 'string', required: true },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string', required: true },
          headline: { type: 'string', required: true },
          content: { type: 'string', required: true },
          source: { type: 'string', required: true },
          timestamp: { type: 'string', required: true },
          confidence: { type: 'number', required: true },
        },
      },
    },
  },
} as const

export const newsSearchDefinition = defineCapability({
  name: 'search_company_news',
  description: 'Return structured company news evidence for a stock symbol.',
  inputSchema: newsSearchInputSchema,
  outputSchema: newsSearchOutputSchema,
})

export type NewsSearchInput = CapabilityInput<typeof newsSearchDefinition>
export type NewsSearchResult = CapabilityOutput<typeof newsSearchDefinition>
export type NewsEvidence = NewsSearchResult['items'][number]

export function normalizeNewsSearchInput(input: NewsSearchInput): NewsSearchInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('search_company_news input must be an object')
  }

  if (typeof input.symbol !== 'string') {
    throw new TypeError('search_company_news symbol must be a string')
  }

  const symbol = input.symbol.trim().toUpperCase()
  if (symbol.length === 0) {
    throw new Error('search_company_news symbol must not be empty')
  }

  return { symbol }
}

export class NewsCapability {
  readonly definition = newsSearchDefinition

  constructor(private readonly provider: CapabilityProvider<NewsSearchInput, NewsSearchResult>) {}

  async search_company_news(input: NewsSearchInput): Promise<NewsSearchResult> {
    const normalizedInput = normalizeNewsSearchInput(input)
    try {
      const result = await this.provider.execute(normalizedInput)
      validateNewsSearchResult(result, normalizedInput.symbol)
      return result
    } catch (cause) {
      throw new CapabilityExecutionError({
        capabilityName: this.definition.name,
        providerName: this.provider.name,
        input: normalizedInput,
        cause,
      })
    }
  }
}

function validateNewsSearchResult(value: unknown, expectedSymbol: string): asserts value is NewsSearchResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('search_company_news Provider result must be an object')
  }

  const result = value as Record<string, unknown>
  if (result.symbol !== expectedSymbol) {
    throw new TypeError('search_company_news Provider result symbol must match the request')
  }
  if (!Array.isArray(result.items)) {
    throw new TypeError('search_company_news Provider result items must be an array')
  }

  for (const [index, item] of result.items.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`search_company_news Provider item ${index} must be an object`)
    }

    const evidence = item as Record<string, unknown>
    assertNonEmptyString(evidence.symbol, `$.items[${index}].symbol`)
    if (evidence.symbol !== expectedSymbol) {
      throw new TypeError(`search_company_news Provider item ${index} symbol must match the request`)
    }
    assertNonEmptyString(evidence.headline, `$.items[${index}].headline`)
    assertNonEmptyString(evidence.content, `$.items[${index}].content`)
    assertNonEmptyString(evidence.source, `$.items[${index}].source`)
    assertTimestamp(evidence.timestamp, `$.items[${index}].timestamp`)
    assertConfidence(evidence.confidence, `$.items[${index}].confidence`)
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path)
  if (!value.includes('T') || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO 8601 timestamp`)
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${path} must be a number between 0 and 1`)
  }
}
