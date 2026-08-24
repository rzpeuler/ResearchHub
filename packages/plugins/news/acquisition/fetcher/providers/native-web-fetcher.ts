import { createNativeFetchTransport, type NativeFetchTransport } from '../../../../transport/index.ts'
import { NewsAcquisitionError } from '../../errors.ts'
import { type FetchInput, type RawDocument, type WebFetcher } from '../interface.ts'
import { validateUrl } from '../../search/interface.ts'

export interface NativeWebFetcherOptions {
  readonly timeoutMs?: number
  readonly maxContentLength?: number
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
}

export class NativeWebFetcher implements WebFetcher {
  readonly name = 'native-web-fetcher'

  private readonly timeoutMs: number
  private readonly maxContentLength: number
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date

  constructor(options: NativeWebFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxContentLength = options.maxContentLength ?? 1_000_000
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) throw new TypeError('timeoutMs must be between 1000 and 120000')
    if (!Number.isInteger(this.maxContentLength) || this.maxContentLength < 1_000) throw new TypeError('maxContentLength must be at least 1000')
  }

  async fetch(input: FetchInput): Promise<RawDocument> {
    const url = validateUrl(input.url)
    let response: Response
    try {
      response = await this.transport.request(url, {
        method: 'GET',
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ResearchHub/NEWS-ACQUISITION-001' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new NewsAcquisitionError('fetch', `request failed: ${safeCause(cause)}`, cause)
    }
    if (!response.ok) throw new NewsAcquisitionError('fetch', `request failed with HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? undefined
    if (contentType !== undefined && !/(?:text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      throw new NewsAcquisitionError('fetch', `unsupported content type: ${contentType.split(';')[0]}`)
    }
    const html = await response.text()
    if (html.trim().length === 0) throw new NewsAcquisitionError('fetch', 'response body is empty')
    const boundedHtml = html.slice(0, this.maxContentLength)
    const fetchedAt = this.clock()
    if (!(fetchedAt instanceof Date) || Number.isNaN(fetchedAt.getTime())) throw new NewsAcquisitionError('fetch', 'clock returned an invalid date')
    return { url, html: boundedHtml, fetchedAt: fetchedAt.toISOString(), status: response.status, ...(contentType === undefined ? {} : { contentType }) }
  }
}

function safeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/gi, '[redacted-url]') : 'network error'
}
