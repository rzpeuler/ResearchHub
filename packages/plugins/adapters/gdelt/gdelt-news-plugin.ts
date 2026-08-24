import { PluginError, PluginValidationError, type DataPlugin, type FinancialDataMetadata } from '../../core/index.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import type { NewsPluginData, NewsPluginItem, NewsSearchInput } from '../../news/plugin.ts'

export const DEFAULT_GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc'
export const DEFAULT_GDELT_TIMESPAN = '7d'
export const DEFAULT_GDELT_LIMIT = 10
const DEFAULT_TIMEOUT_MS = 30_000

export interface GdeltNewsPluginOptions {
  readonly endpoint?: string
  readonly timespan?: string
  readonly limit?: number
  readonly timeoutMs?: number
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
  readonly symbolEntities?: Readonly<Record<string, string>>
}

export interface GdeltArticle {
  readonly url: string
  readonly title: string
  readonly seendate: string
  readonly domain?: string
}

export interface GdeltNewsResponse {
  readonly articles: readonly GdeltArticle[]
}

/** Real GDELT DOC ArticleList adapter projected into the unchanged News Plugin data contract. */
export class GdeltNewsPlugin implements DataPlugin<NewsSearchInput, NewsPluginData> {
  readonly name = 'gdelt-news'

  private readonly endpoint: string
  private readonly timespan: string
  private readonly limit: number
  private readonly timeoutMs: number
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date
  private readonly symbolEntities: Readonly<Record<string, string>>

  constructor(options: GdeltNewsPluginOptions = {}) {
    this.endpoint = validateEndpoint(options.endpoint ?? process.env.GDELT_ENDPOINT ?? DEFAULT_GDELT_ENDPOINT)
    this.timespan = validateTimespan(options.timespan ?? process.env.NEWS_GDELT_TIMESPAN ?? DEFAULT_GDELT_TIMESPAN)
    this.limit = validateLimit(options.limit ?? DEFAULT_GDELT_LIMIT)
    this.timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
    this.symbolEntities = options.symbolEntities ?? { '600519': 'Kweichow Moutai' }
  }

  async fetch(request: NewsSearchInput) {
    const symbol = normalizeRequest(request)
    const query = buildGdeltQuery(symbol, this.symbolEntities)
    const url = new URL(this.endpoint)
    url.searchParams.set('query', query)
    url.searchParams.set('mode', 'artlist')
    url.searchParams.set('format', 'json')
    url.searchParams.set('maxrecords', String(this.limit))
    url.searchParams.set('timespan', this.timespan)
    url.searchParams.set('sort', 'datedesc')

    let response: Response
    try {
      response = await this.transport.request(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'ResearchHub/PLUGIN-VALIDATION-001 (+https://github.com/rzpeuler/ResearchHub)',
        },
        signal: timeoutSignal(this.timeoutMs),
      })
    } catch (cause) {
      throw new GdeltNewsPluginError(`gdelt-news request failed: ${safeCause(cause)}`, cause)
    }
    if (!response.ok) {
      const detail = response.status === 429 ? ' (GDELT rate limit; retry later)' : ''
      throw new GdeltNewsPluginError(`gdelt-news request failed with HTTP ${response.status}${detail}`)
    }

    const payload = await readJson(response)
    const raw = parseResponse(payload)
    const items = raw.articles.map((article) => normalizeArticle(article, symbol))
    const clockValue = this.clock()
    if (!(clockValue instanceof Date) || Number.isNaN(clockValue.getTime())) throw new GdeltNewsPluginError('gdelt-news clock returned an invalid date')
    const metadata: FinancialDataMetadata = {
      plugin: this.name,
      source: 'gdelt-doc',
      timestamp: clockValue.toISOString(),
      quality: items.length === 0 ? 'low' : 'medium',
      confidence: items.length === 0 ? 0.5 : averageConfidence(items),
    }
    return { data: { symbol, items }, metadata }
  }

  validate(value: unknown): asserts value is NewsPluginData {
    validateNewsPluginData(value)
  }
}

export function buildGdeltQuery(symbol: string, symbolEntities: Readonly<Record<string, string>> = { '600519': 'Kweichow Moutai' }): string {
  const entity = symbolEntities[symbol] ?? symbol
  return `"${entity.replaceAll('"', '')}"`
}

export function normalizeGdeltTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new GdeltNewsPluginError('gdelt article is missing seendate')
  const trimmed = value.trim()
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(trimmed)
  const candidate = compact === null
    ? trimmed
    : `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
  const timestamp = new Date(candidate)
  if (Number.isNaN(timestamp.getTime())) throw new GdeltNewsPluginError(`invalid gdelt publication time: ${value}`)
  return timestamp.toISOString()
}

function normalizeRequest(value: NewsSearchInput): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PluginValidationError('expected a News plugin request')
  if (typeof value.symbol !== 'string' || value.symbol.trim().length === 0) throw new PluginValidationError('expected a non-empty symbol', '$.symbol')
  return value.symbol.trim().toUpperCase()
}

function parseResponse(value: unknown): GdeltNewsResponse {
  if (!isRecord(value) || !Array.isArray(value.articles)) throw new GdeltNewsPluginError('gdelt-news response is malformed: missing articles')
  const articles = value.articles.map((article, index) => parseArticle(article, index))
  return { articles }
}

function parseArticle(value: unknown, index: number): GdeltArticle {
  if (!isRecord(value)) throw new GdeltNewsPluginError(`gdelt article ${index} must be an object`)
  const url = readRequiredString(value.url, `articles[${index}].url`)
  const title = readRequiredString(value.title, `articles[${index}].title`)
  const seendate = readRequiredString(value.seendate ?? value.publishedAt ?? value.published_at, `articles[${index}].seendate`)
  const domain = typeof value.domain === 'string' && value.domain.trim().length > 0 ? value.domain.trim() : undefined
  return { url, title, seendate, domain }
}

function normalizeArticle(article: GdeltArticle, symbol: string): NewsPluginItem {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(article.url)
  } catch (cause) {
    throw new GdeltNewsPluginError('gdelt article URL is invalid', cause)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new GdeltNewsPluginError('gdelt article URL must use HTTP(S)')
  const source = article.domain ?? parsedUrl.hostname
  if (source.trim().length === 0) throw new GdeltNewsPluginError('gdelt article source domain is empty')
  return {
    symbol,
    headline: article.title.trim(),
    content: article.title.trim(),
    source,
    timestamp: normalizeGdeltTimestamp(article.seendate),
    confidence: 0.8,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch (cause) {
    throw new GdeltNewsPluginError('gdelt-news response was not valid JSON', cause)
  }
}

function validateNewsPluginData(value: unknown): asserts value is NewsPluginData {
  if (!isRecord(value) || typeof value.symbol !== 'string' || !Array.isArray(value.items)) throw new PluginValidationError('invalid News Plugin data')
  if (value.symbol.trim().length === 0) throw new PluginValidationError('News Plugin symbol must not be empty', '$.symbol')
  value.items.forEach((item, index) => {
    if (!isRecord(item)) throw new PluginValidationError('News Plugin item must be an object', `$.items[${index}]`)
    for (const field of ['symbol', 'headline', 'content', 'source', 'timestamp']) {
      if (typeof item[field] !== 'string' || (item[field] as string).trim().length === 0) throw new PluginValidationError('expected a non-empty string', `$.items[${index}].${field}`)
    }
    if (!/^\d{6}$/.test(item.symbol as string) || item.symbol !== value.symbol) throw new PluginValidationError('item symbol must match request', `$.items[${index}].symbol`)
    if (Number.isNaN(Date.parse(item.timestamp as string)) || !(item.timestamp as string).includes('T')) throw new PluginValidationError('expected an ISO timestamp', `$.items[${index}].timestamp`)
    if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new PluginValidationError('expected confidence between 0 and 1', `$.items[${index}].confidence`)
  })
}

function averageConfidence(items: readonly NewsPluginItem[]): number {
  return Number((items.reduce((total, item) => total + item.confidence, 0) / items.length).toFixed(4))
}

function validateEndpoint(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new GdeltNewsPluginError('gdelt endpoint must be a valid HTTP(S) URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new GdeltNewsPluginError('gdelt endpoint must be a valid HTTP(S) URL')
  if (parsed.username || parsed.password) throw new GdeltNewsPluginError('gdelt endpoint must not include credentials')
  return parsed.toString().replace(/\/$/, '')
}

function validateTimespan(value: string): string {
  if (!/^\d+(?:min|h|d|w|m)$/.test(value)) throw new GdeltNewsPluginError('gdelt timespan must use min, h, d, w, or m')
  return value
}

function validateLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 250) throw new GdeltNewsPluginError('gdelt limit must be an integer from 1 to 250')
  return value
}

function validateTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1_000 || value > 120_000) throw new GdeltNewsPluginError('gdelt timeout must be between 1000 and 120000 milliseconds')
  return value
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new GdeltNewsPluginError(`gdelt response is missing ${field}`)
  return value.trim()
}

function safeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/gi, '[redacted-url]') : 'network error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class GdeltNewsPluginError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'GdeltNewsPluginError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
