import { ProviderValidationError, type DataProvider, type FinancialDataMetadata } from '../../core/index.ts'
import { AnnouncementProviderError } from './errors.ts'
import { normalizePublishedAt } from './source-adapter.ts'
import {
  ANNOUNCEMENT_SOURCE_TYPE,
  type AnnouncementProviderData,
  type AnnouncementProviderRequest,
  type OfficialAnnouncementSourceAdapter,
  type RawAnnouncementRecord,
} from './types.ts'

export interface AnnouncementProviderOptions {
  readonly sourceAdapter: OfficialAnnouncementSourceAdapter
  readonly issuerToSymbol?: Readonly<Record<string, string>>
  readonly clock?: () => Date
  readonly sourceName?: string
}

/** Canonical Information Layer Provider for official company announcements. */
export class AnnouncementProvider implements DataProvider<AnnouncementProviderRequest, AnnouncementProviderData> {
  readonly name = 'announcement-provider'

  private readonly sourceAdapter: OfficialAnnouncementSourceAdapter
  private readonly issuerToSymbol: Readonly<Record<string, string>>
  private readonly clock: () => Date
  private readonly sourceName: string

  constructor(options: AnnouncementProviderOptions) {
    this.sourceAdapter = options.sourceAdapter
    this.issuerToSymbol = options.issuerToSymbol ?? {}
    this.clock = options.clock ?? (() => new Date())
    this.sourceName = options.sourceName ?? 'cninfo'
  }

  async fetch(request: AnnouncementProviderRequest) {
    const normalized = normalizeAnnouncementRequest(request)
    const rawRecords = await this.sourceAdapter.fetch({ symbol: normalized.symbol, limit: normalized.limit })
    const items = rawRecords.map((record) => normalizeAnnouncementRecord(
      record,
      normalized.symbol,
      this.issuerToSymbol,
    ))
    const timestamp = this.clock()
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
      throw new AnnouncementProviderError('announcement provider clock returned an invalid date')
    }

    const metadata: FinancialDataMetadata = {
      provider: this.name,
      source: this.sourceName,
      timestamp: timestamp.toISOString(),
      quality: 'high',
      confidence: items.length === 0 ? 0.8 : averageConfidence(items),
    }

    return {
      data: { symbol: normalized.symbol, items },
      metadata,
    }
  }

  validate(value: unknown): asserts value is AnnouncementProviderData {
    validateAnnouncementProviderData(value)
  }
}

export function normalizeAnnouncementRequest(value: AnnouncementProviderRequest): {
  symbol: string
  limit: number
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderValidationError('expected an Announcement provider request')
  }

  const symbol = value.symbol
  if (typeof symbol !== 'string' || !/^\d{6}$/.test(symbol.trim())) {
    throw new ProviderValidationError('expected a six-digit A-share symbol', '$.symbol')
  }

  const limit = value.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ProviderValidationError('expected an integer between 1 and 100', '$.limit')
  }

  return { symbol: symbol.trim(), limit }
}

function normalizeAnnouncementRecord(
  record: RawAnnouncementRecord,
  requestedSymbol: string,
  issuerToSymbol: Readonly<Record<string, string>>,
) {
  const mappedSymbols = mapSymbols(record, requestedSymbol, issuerToSymbol)
  const confidence = record.confidence ?? 0.95
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AnnouncementProviderError('announcement confidence must be between 0 and 1')
  }

  return {
    title: requireText(record.title, 'title'),
    content: requireText(record.content, 'content'),
    publishedAt: normalizePublishedAt(record.publishedAt),
    source: requireText(record.source, 'source'),
    sourceType: ANNOUNCEMENT_SOURCE_TYPE,
    symbols: mappedSymbols,
    confidence,
  }
}

function mapSymbols(
  record: RawAnnouncementRecord,
  requestedSymbol: string,
  issuerToSymbol: Readonly<Record<string, string>>,
): string[] {
  const sourceSymbol = record.securityCode === undefined
    ? undefined
    : normalizeAshareSymbol(record.securityCode)
  const mappedSymbol = sourceSymbol ?? (record.issuerName === undefined
    ? undefined
    : normalizeAshareSymbol(issuerToSymbol[record.issuerName]))

  if (mappedSymbol === undefined) {
    throw new AnnouncementProviderError('announcement record cannot be mapped to a stock symbol')
  }
  if (mappedSymbol !== requestedSymbol) {
    throw new AnnouncementProviderError('announcement source symbol does not match the request')
  }
  return [mappedSymbol]
}

function normalizeAshareSymbol(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const normalized = value.trim().toUpperCase().replace(/^(?:SH|SZ|BJ)[.:]?/, '').replace(/\.(?:SH|SZ|BJ)$/, '')
  return /^\d{6}$/.test(normalized) ? normalized : undefined
}

function averageConfidence(items: AnnouncementProviderData['items']): number {
  return Number((items.reduce((total, item) => total + item.confidence, 0) / items.length).toFixed(4))
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AnnouncementProviderError(`announcement ${field} must not be empty`)
  }
  return value.trim()
}

export function validateAnnouncementProviderData(value: unknown): asserts value is AnnouncementProviderData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderValidationError('expected Announcement provider data to be an object')
  }

  const data = value as Record<string, unknown>
  assertAllowedFields(data, new Set(['symbol', 'items']))
  if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol)) {
    throw new ProviderValidationError('expected a six-digit A-share symbol', '$.symbol')
  }
  if (!Array.isArray(data.items)) {
    throw new ProviderValidationError('expected an array', '$.items')
  }

  data.items.forEach((item, index) => validateNewsItem(item, index))
}

function validateNewsItem(value: unknown, index: number): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderValidationError('expected an object', `$.items[${index}]`)
  }

  const item = value as Record<string, unknown>
  assertAllowedFields(item, new Set(['title', 'content', 'publishedAt', 'source', 'sourceType', 'symbols', 'confidence']))
  assertNonEmptyString(item.title, `$.items[${index}].title`)
  assertNonEmptyString(item.content, `$.items[${index}].content`)
  assertNonEmptyString(item.publishedAt, `$.items[${index}].publishedAt`)
  if (Number.isNaN(Date.parse(item.publishedAt))) {
    throw new ProviderValidationError('expected an ISO timestamp', `$.items[${index}].publishedAt`)
  }
  assertNonEmptyString(item.source, `$.items[${index}].source`)
  if (item.sourceType !== ANNOUNCEMENT_SOURCE_TYPE) {
    throw new ProviderValidationError('expected official source type', `$.items[${index}].sourceType`)
  }
  if (!Array.isArray(item.symbols) || item.symbols.length === 0 || !item.symbols.every(symbol => typeof symbol === 'string' && /^\d{6}$/.test(symbol))) {
    throw new ProviderValidationError('expected non-empty six-digit symbol array', `$.items[${index}].symbols`)
  }
  assertConfidence(item.confidence, `$.items[${index}].confidence`)
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new ProviderValidationError(`unknown field: ${key}`, `$.${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderValidationError('expected a non-empty string', path)
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProviderValidationError('expected a number between 0 and 1', path)
  }
}
