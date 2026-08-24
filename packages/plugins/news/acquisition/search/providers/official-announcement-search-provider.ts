import { NewsAcquisitionError } from '../../errors.ts'
import {
  normalizeSearchInput,
  normalizeTimestamp,
  type SearchInput,
  type SearchProvider,
  type SearchResult,
  validateUrl,
} from '../interface.ts'
import type { OfficialAnnouncementSourceAdapter, RawAnnouncementRecord } from '../../../../adapters/announcement/index.ts'

export interface OfficialAnnouncementSearchProviderOptions {
  readonly sourceAdapter: OfficialAnnouncementSourceAdapter
}

/** Projects official company announcements into the runtime-neutral SearchProvider contract. */
export class OfficialAnnouncementSearchProvider implements SearchProvider {
  readonly name = 'cninfo-official-search'

  constructor(private readonly options: OfficialAnnouncementSearchProviderOptions) {}

  async search(input: SearchInput): Promise<readonly SearchResult[]> {
    const normalized = normalizeSearchInput(input)
    const symbol = resolveSymbol(normalized)
    const records = await this.options.sourceAdapter.fetch({ symbol, limit: normalized.limit })

    return records
      .filter((record) => isWithinRange(record, normalized.startTime, normalized.endTime))
      .filter((record) => record.sourceUrl !== undefined)
      .slice(0, normalized.limit)
      .map((record) => toSearchResult(record, symbol))
  }
}

function resolveSymbol(input: SearchInput): string {
  const candidate = input.entity ?? input.query
  const symbol = /\b\d{6}\b/.exec(candidate)?.[0]
  if (symbol === undefined) {
    throw new NewsAcquisitionError('search', 'official announcement search requires a six-digit A-share symbol in entity or query')
  }
  return symbol
}

function isWithinRange(record: RawAnnouncementRecord, startTime: string | undefined, endTime: string | undefined): boolean {
  const publishedAt = Date.parse(record.publishedAt)
  if (Number.isNaN(publishedAt)) return false
  if (startTime !== undefined && publishedAt < Date.parse(startTime)) return false
  if (endTime !== undefined && publishedAt > Date.parse(endTime)) return false
  return true
}

function toSearchResult(record: RawAnnouncementRecord, symbol: string): SearchResult {
  const url = validateUrl(record.sourceUrl as string)
  const publishedAt = normalizeTimestamp(record.publishedAt, 'publishedAt')
  return {
    title: record.title,
    url,
    ...(record.content === record.sourceUrl ? {} : { snippet: record.content }),
    source: record.source.trim() || 'cninfo',
    publishedAt,
    metadata: {
      provider: 'cninfo-official-search',
      official: true,
      symbol,
      ...(record.securityCode === undefined ? {} : { securityCode: record.securityCode }),
      ...(record.issuerName === undefined ? {} : { issuerName: record.issuerName }),
      ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    },
  }
}
