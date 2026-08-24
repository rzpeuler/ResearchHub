import { createNativeFetchTransport, type NativeFetchTransport } from '../../../../transport/index.ts'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { NewsAcquisitionError } from '../../errors.ts'
import { type FetchInput, type RawDocument, type WebFetcher } from '../interface.ts'
import { validateUrl } from '../../search/interface.ts'

export interface OfficialAnnouncementFetcherOptions {
  readonly clock?: () => Date
  readonly timeoutMs?: number
  readonly maxContentLength?: number
  readonly transport?: NativeFetchTransport
  readonly pdfTextExtractor?: PdfTextExtractor
}

export interface PdfTextExtractor {
  extract(data: Uint8Array): Promise<string>
}

/** Fetches inline official content or extracts text from the announcement PDF. */
export class OfficialAnnouncementFetcher implements WebFetcher {
  readonly name = 'official-announcement-fetcher'

  private readonly clock: () => Date
  private readonly timeoutMs: number
  private readonly maxContentLength: number
  private readonly transport: NativeFetchTransport
  private readonly pdfTextExtractor: PdfTextExtractor

  constructor(options: OfficialAnnouncementFetcherOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxContentLength = options.maxContentLength ?? 100_000
    this.transport = options.transport ?? createNativeFetchTransport()
    this.pdfTextExtractor = options.pdfTextExtractor ?? new PdfJsTextExtractor()
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new TypeError('timeoutMs must be between 1000 and 120000')
    }
    if (!Number.isInteger(this.maxContentLength) || this.maxContentLength < 1_000) {
      throw new TypeError('maxContentLength must be at least 1000')
    }
  }

  async fetch(input: FetchInput): Promise<RawDocument> {
    const url = validateUrl(input.url)
    const inlineContent = input.candidate?.snippet?.trim()
    const fetchedAt = this.readClock()
    if (inlineContent !== undefined && inlineContent.length > 0) {
      return createDocument(url, input.candidate?.title ?? 'Official announcement', inlineContent, fetchedAt)
    }

    let response: Response
    try {
      response = await this.transport.request(url, {
        method: 'GET',
        headers: {
          accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
          origin: 'https://www.cninfo.com.cn',
          referer: 'https://www.cninfo.com.cn/',
          'user-agent': 'Mozilla/5.0 (ResearchHub; NEWS-PROVIDER-FIX-001)',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new NewsAcquisitionError('fetch', `official announcement PDF request failed: ${safeCause(cause)}`, cause)
    }
    if (!response.ok) throw new NewsAcquisitionError('fetch', `official announcement PDF request failed with HTTP ${response.status}`)

    const contentType = response.headers.get('content-type') ?? ''
    if (!/application\/pdf/i.test(contentType) && !/\.pdf(?:$|[?#])/i.test(url)) {
      throw new NewsAcquisitionError('fetch', `official announcement response is not a PDF: ${contentType || 'unknown content type'}`)
    }

    let text: string
    try {
      text = (await this.pdfTextExtractor.extract(new Uint8Array(await response.arrayBuffer()))).trim()
    } catch (cause) {
      throw new NewsAcquisitionError('fetch', `official announcement PDF extraction failed: ${safeCause(cause)}`, cause)
    }
    if (text.length === 0) throw new NewsAcquisitionError('fetch', 'official announcement PDF contains no extractable text')
    return createDocument(url, input.candidate?.title ?? 'Official announcement', text.slice(0, this.maxContentLength), fetchedAt)
  }

  private readClock(): string {
    const fetchedAt = this.clock()
    if (!(fetchedAt instanceof Date) || Number.isNaN(fetchedAt.getTime())) {
      throw new NewsAcquisitionError('fetch', 'clock returned an invalid date')
    }
    return fetchedAt.toISOString()
  }
}

export class PdfJsTextExtractor implements PdfTextExtractor {
  async extract(data: Uint8Array): Promise<string> {
    const document = await getDocument({
      data,
      useWorkerFetch: false,
      verbosity: 0,
    }).promise
    const pages: string[] = []
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push(content.items
          .map((item) => 'str' in item ? item.str : '')
          .filter((item) => item.length > 0)
          .join(' '))
      }
    } finally {
      await document.cleanup()
    }
    return pages.join('\n')
  }
}

function createDocument(url: string, title: string, content: string, fetchedAt: string): RawDocument {
  return {
    url,
    html: `<article><h1>${escapeHtml(title)}</h1><p>${escapeHtml(content)}</p></article>`,
    fetchedAt,
    status: 200,
    contentType: 'text/html',
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/gi, '[redacted-url]') : 'network error'
}
