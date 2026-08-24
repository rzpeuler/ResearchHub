import { NewsAcquisitionError } from '../errors.ts'

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export interface SearchInput {
  readonly query: string
  readonly entity?: string
  readonly startTime?: string
  readonly endTime?: string
  readonly limit: number
}

export interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet?: string
  readonly source: string
  readonly publishedAt?: string
  readonly metadata?: JsonObject
}

export interface SearchProvider {
  readonly name: string
  search(input: SearchInput): Promise<readonly SearchResult[]>
}

export function normalizeSearchInput(input: SearchInput): SearchInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new NewsAcquisitionError('search', 'expected a SearchInput object')
  }

  const query = input.query.trim()
  if (query.length === 0) throw new NewsAcquisitionError('search', 'query must not be empty')

  const entity = input.entity?.trim() || undefined
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new NewsAcquisitionError('search', 'limit must be an integer from 1 to 50')
  }

  const startTime = normalizeOptionalTimestamp(input.startTime, 'startTime')
  const endTime = normalizeOptionalTimestamp(input.endTime, 'endTime')
  if (startTime !== undefined && endTime !== undefined && Date.parse(startTime) > Date.parse(endTime)) {
    throw new NewsAcquisitionError('search', 'startTime must not be after endTime')
  }

  return { query, entity, startTime, endTime, limit: input.limit }
}

export function validateSearchResult(value: SearchResult): SearchResult {
  if (value === null || typeof value !== 'object') throw new NewsAcquisitionError('search', 'provider returned an invalid result')
  const title = requiredString(value.title, 'title')
  const url = validateUrl(value.url)
  const source = requiredString(value.source, 'source')
  const snippet = value.snippet === undefined ? undefined : requiredString(value.snippet, 'snippet')
  const publishedAt = value.publishedAt === undefined ? undefined : normalizeTimestamp(value.publishedAt, 'publishedAt')
  return { title, url, source, ...(snippet === undefined ? {} : { snippet }), ...(publishedAt === undefined ? {} : { publishedAt }), ...(value.metadata === undefined ? {} : { metadata: value.metadata }) }
}

export function validateUrl(value: string): string {
  const url = requiredString(value, 'url')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new NewsAcquisitionError('search', 'url must be a valid HTTP(S) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new NewsAcquisitionError('search', 'url must use HTTP(S)')
  if (parsed.username || parsed.password) throw new NewsAcquisitionError('search', 'url must not include credentials')
  return parsed.toString()
}

export function normalizeTimestamp(value: string, field: string): string {
  const timestamp = requiredString(value, field)
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) throw new NewsAcquisitionError('search', `${field} must be an ISO timestamp`)
  return parsed.toISOString()
}

function normalizeOptionalTimestamp(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : normalizeTimestamp(value, field)
}

function requiredString(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new NewsAcquisitionError('search', `${field} must be a non-empty string`)
  return value.trim()
}

