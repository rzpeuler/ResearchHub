import { PluginValidationError, type DataPlugin, type FinancialDataMetadata } from '../../core/index.ts'
import { MediaPluginError } from './errors.ts'
import {
  assertMediaText,
  assertMediaTier,
  normalizeMediaPublishedAt,
  normalizeMediaSymbol,
} from './source-adapter.ts'
import { MEDIA_SOURCE_TIERS, type MediaNewsItem, type MediaSourceMetadata } from '../information/index.ts'
import type {
  MediaPluginData,
  MediaPluginRequest,
  ProfessionalMediaSourceAdapter,
  RawMediaRecord,
} from './types.ts'

export interface MediaPluginOptions {
  readonly sourceAdapter: ProfessionalMediaSourceAdapter
  readonly issuerToSymbol?: Readonly<Record<string, string>>
  readonly clock?: () => Date
  readonly sourceName?: string
}

/** Canonical Information Layer Plugin for professional media evidence. */
export class MediaPlugin implements DataPlugin<MediaPluginRequest, MediaPluginData> {
  readonly name = 'media-plugin'

  private readonly sourceAdapter: ProfessionalMediaSourceAdapter
  private readonly issuerToSymbol: Readonly<Record<string, string>>
  private readonly clock: () => Date
  private readonly sourceName: string

  constructor(options: MediaPluginOptions) {
    this.sourceAdapter = options.sourceAdapter
    this.issuerToSymbol = options.issuerToSymbol ?? {}
    this.clock = options.clock ?? (() => new Date())
    this.sourceName = options.sourceName ?? 'professional-media'
  }

  async fetch(request: MediaPluginRequest) {
    const normalized = normalizeMediaRequest(request)
    let rawRecords: readonly RawMediaRecord[]
    try {
      rawRecords = await this.sourceAdapter.fetch({ symbol: normalized.symbol, limit: normalized.limit })
    } catch (cause) {
      throw new MediaPluginError(`media source adapter failed: ${formatCause(cause)}`, cause)
    }
    const items = rawRecords.map((record) => normalizeMediaRecord(record, normalized.symbol, this.issuerToSymbol))
    const timestamp = this.clock()
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
      throw new MediaPluginError('media plugin clock returned an invalid date')
    }

    const metadata: FinancialDataMetadata = {
      plugin: this.name,
      source: this.sourceName,
      timestamp: timestamp.toISOString(),
      quality: items.length === 0 ? 'low' : 'medium',
      confidence: items.length === 0 ? 0.5 : averageConfidence(items),
    }

    return {
      data: { symbol: normalized.symbol, items },
      metadata,
    }
  }

  validate(value: unknown): asserts value is MediaPluginData {
    validateMediaPluginData(value)
  }
}

export function normalizeMediaRequest(value: MediaPluginRequest): { symbol: string; limit: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected a Media plugin request')
  }

  const symbol = value.symbol
  if (typeof symbol !== 'string' || !/^\d{6}$/.test(symbol.trim())) {
    throw new PluginValidationError('expected a six-digit A-share symbol', '$.symbol')
  }

  const limit = value.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new PluginValidationError('expected an integer between 1 and 100', '$.limit')
  }
  return { symbol: symbol.trim(), limit }
}

function normalizeMediaRecord(
  record: RawMediaRecord,
  requestedSymbol: string,
  issuerToSymbol: Readonly<Record<string, string>>,
): MediaNewsItem {
  const mappedSymbol = record.securityCode === undefined
    ? normalizeMediaSymbol(record.issuerName === undefined ? undefined : issuerToSymbol[record.issuerName])
    : normalizeMediaSymbol(record.securityCode)

  if (mappedSymbol === undefined) {
    throw new MediaPluginError('media record cannot be mapped to a stock symbol')
  }
  if (mappedSymbol !== requestedSymbol) {
    throw new MediaPluginError('media source symbol does not match the request')
  }

  assertMediaText(record.title, 'title')
  assertMediaText(record.content, 'content')
  assertMediaText(record.source, 'source')
  assertMediaText(record.publisher, 'publisher')
  assertMediaTier(record.tier)
  assertConfidence(record.confidence, 'confidence')
  const metadataConfidence = record.metadataConfidence ?? record.confidence
  assertConfidence(metadataConfidence, 'metadataConfidence')

  const metadata: MediaSourceMetadata = {
    publisher: record.publisher.trim(),
    tier: record.tier,
    confidence: metadataConfidence,
  }
  return {
    title: record.title.trim(),
    content: record.content.trim(),
    publishedAt: normalizeMediaPublishedAt(record.publishedAt),
    source: record.source.trim(),
    sourceType: 'media',
    symbols: [mappedSymbol],
    confidence: record.confidence,
    metadata,
  }
}

function averageConfidence(items: MediaNewsItem[]): number {
  return Number((items.reduce((total, item) => total + item.metadata.confidence, 0) / items.length).toFixed(4))
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function validateMediaPluginData(value: unknown): asserts value is MediaPluginData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected Media plugin data to be an object')
  }

  const data = value as Record<string, unknown>
  assertAllowedFields(data, new Set(['symbol', 'items']))
  if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol)) {
    throw new PluginValidationError('expected a six-digit A-share symbol', '$.symbol')
  }
  if (!Array.isArray(data.items)) {
    throw new PluginValidationError('expected an array', '$.items')
  }
  data.items.forEach((item, index) => validateMediaItem(item, index))
}

function validateMediaItem(value: unknown, index: number): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected an object', `$.items[${index}]`)
  }
  const item = value as Record<string, unknown>
  assertAllowedFields(item, new Set(['title', 'content', 'publishedAt', 'source', 'sourceType', 'symbols', 'confidence', 'metadata']))
  assertNonEmptyString(item.title, `$.items[${index}].title`)
  assertNonEmptyString(item.content, `$.items[${index}].content`)
  assertNonEmptyString(item.publishedAt, `$.items[${index}].publishedAt`)
  if (Number.isNaN(Date.parse(item.publishedAt))) {
    throw new PluginValidationError('expected an ISO timestamp', `$.items[${index}].publishedAt`)
  }
  assertNonEmptyString(item.source, `$.items[${index}].source`)
  if (item.sourceType !== 'media') {
    throw new PluginValidationError('expected media source type', `$.items[${index}].sourceType`)
  }
  if (!Array.isArray(item.symbols) || item.symbols.length === 0 || !item.symbols.every(symbol => typeof symbol === 'string' && /^\d{6}$/.test(symbol))) {
    throw new PluginValidationError('expected non-empty six-digit symbol array', `$.items[${index}].symbols`)
  }
  assertConfidence(item.confidence, `$.items[${index}].confidence`)
  if (item.metadata === null || typeof item.metadata !== 'object' || Array.isArray(item.metadata)) {
    throw new PluginValidationError('expected media metadata object', `$.items[${index}].metadata`)
  }
  const metadata = item.metadata as Record<string, unknown>
  assertAllowedFields(metadata, new Set(['publisher', 'tier', 'confidence']))
  assertNonEmptyString(metadata.publisher, `$.items[${index}].metadata.publisher`)
  if (typeof metadata.tier !== 'string' || !(MEDIA_SOURCE_TIERS as readonly string[]).includes(metadata.tier)) {
    throw new PluginValidationError('expected tier-1, tier-2, or tier-3', `$.items[${index}].metadata.tier`)
  }
  assertConfidence(metadata.confidence, `$.items[${index}].metadata.confidence`)
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

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PluginValidationError('expected a number between 0 and 1', path)
  }
}
