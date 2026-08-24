import { createNativeFetchTransport, type NativeFetchTransport } from '../../../../transport/index.ts'
import { NewsAcquisitionError } from '../../errors.ts'
import { normalizeSearchInput, normalizeTimestamp, type SearchInput, type SearchProvider, type SearchResult, validateUrl } from '../interface.ts'

export const DEFAULT_GDELT_SEARCH_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc'

export interface GdeltSearchProviderOptions {
  readonly endpoint?: string
  readonly timespan?: string
  readonly timeoutMs?: number
  readonly transport?: NativeFetchTransport
}

export class GdeltSearchProvider implements SearchProvider {
  readonly name = 'gdelt-search'

  private readonly endpoint: string
  private readonly timespan: string
  private readonly timeoutMs: number
  private readonly transport: NativeFetchTransport

  constructor(options: GdeltSearchProviderOptions = {}) {
    this.endpoint = validateUrl(options.endpoint ?? process.env.GDELT_ENDPOINT ?? DEFAULT_GDELT_SEARCH_ENDPOINT)
    this.timespan = options.timespan ?? process.env.NEWS_GDELT_TIMESPAN ?? '7d'
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.transport = options.transport ?? createNativeFetchTransport()
    if (!/^\d+(?:min|h|d|w|m)$/.test(this.timespan)) throw new TypeError('timespan must use min, h, d, w, or m')
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) throw new TypeError('timeoutMs must be between 1000 and 120000')
  }

  async search(input: SearchInput): Promise<readonly SearchResult[]> {
    const normalized = normalizeSearchInput(input)
    const url = new URL(this.endpoint)
    url.searchParams.set('query', buildQuery(normalized))
    url.searchParams.set('mode', 'artlist')
    url.searchParams.set('format', 'json')
    url.searchParams.set('maxrecords', String(normalized.limit))
    url.searchParams.set('sort', 'datedesc')
    if (normalized.startTime !== undefined) {
      url.searchParams.set('startdatetime', toGdeltDateTime(normalized.startTime))
      if (normalized.endTime !== undefined) url.searchParams.set('enddatetime', toGdeltDateTime(normalized.endTime))
    } else {
      url.searchParams.set('timespan', this.timespan)
    }

    let response: Response
    try {
      response = await this.transport.request(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'ResearchHub/NEWS-ACQUISITION-001' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new NewsAcquisitionError('search', `GDELT request failed: ${safeCause(cause)}`, cause)
    }
    if (!response.ok) {
      const detail = response.status === 429 ? ' (GDELT rate limit; retry later)' : ''
      throw new NewsAcquisitionError('search', `GDELT request failed with HTTP ${response.status}${detail}`)
    }

    let payload: unknown
    try {
      payload = await response.json() as unknown
    } catch (cause) {
      throw new NewsAcquisitionError('search', 'GDELT response was not valid JSON', cause)
    }
    if (!isRecord(payload) || !Array.isArray(payload.articles)) throw new NewsAcquisitionError('search', 'GDELT response is missing articles')
    return payload.articles.map((article, index) => parseArticle(article, index))
  }
}

function buildQuery(input: SearchInput): string {
  const entity = input.entity?.replaceAll('"', '').trim()
  const query = input.query.replaceAll('"', '').trim()
  return entity === undefined || entity.length === 0 ? `"${query}"` : `"${entity}" ${query}`
}

function parseArticle(value: unknown, index: number): SearchResult {
  if (!isRecord(value)) throw new NewsAcquisitionError('search', `GDELT article ${index} must be an object`)
  const url = validateUrl(readRequiredString(value.url, `articles[${index}].url`))
  const title = readRequiredString(value.title, `articles[${index}].title`)
  const rawTimestamp = value.seendate ?? value.publishedAt ?? value.published_at
  const publishedAt = rawTimestamp === undefined ? undefined : normalizeTimestamp(normalizeGdeltTimestamp(rawTimestamp), `articles[${index}].publishedAt`)
  const source = typeof value.domain === 'string' && value.domain.trim().length > 0 ? value.domain.trim() : new URL(url).hostname
  const snippet = typeof value.snippet === 'string' && value.snippet.trim().length > 0 ? value.snippet.trim() : undefined
  return { title, url, source, ...(snippet === undefined ? {} : { snippet }), ...(publishedAt === undefined ? {} : { publishedAt }), metadata: { provider: 'gdelt-search' } }
}

function normalizeGdeltTimestamp(value: unknown): string {
  const raw = readRequiredString(value, 'seendate')
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw)
  return compact === null ? raw : `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
}

function toGdeltDateTime(value: string): string {
  return value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/Z$/, '')
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new NewsAcquisitionError('search', `GDELT response is missing ${field}`)
  return value.trim()
}

function safeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/gi, '[redacted-url]') : 'network error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

