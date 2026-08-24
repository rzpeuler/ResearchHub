import { NewsAcquisitionError } from '../errors.ts'
import { type RawDocument } from '../fetcher/interface.ts'
import { type JsonObject, normalizeTimestamp, type SearchResult, validateUrl } from '../search/interface.ts'

export interface NormalizedArticle {
  readonly title: string
  readonly content: string
  readonly source: string
  readonly publishedAt: string
  readonly url: string
  readonly metadata: JsonObject
}

export interface ArticleNormalizer {
  normalize(input: RawDocument, candidate?: SearchResult): NormalizedArticle
}

export interface HtmlArticleNormalizerOptions {
  readonly maxContentLength?: number
}

export class HtmlArticleNormalizer implements ArticleNormalizer {
  private readonly maxContentLength: number

  constructor(options: HtmlArticleNormalizerOptions = {}) {
    this.maxContentLength = options.maxContentLength ?? 100_000
    if (!Number.isInteger(this.maxContentLength) || this.maxContentLength < 1_000) throw new TypeError('maxContentLength must be at least 1000')
  }

  normalize(input: RawDocument, candidate?: SearchResult): NormalizedArticle {
    const url = validateUrl(input.url)
    const title = cleanText(candidate?.title ?? readTitle(input.html))
    const content = cleanText(extractVisibleText(input.html)).slice(0, this.maxContentLength)
    if (title.length === 0) throw new NewsAcquisitionError('normalize', 'article title is empty')
    if (content.length === 0) throw new NewsAcquisitionError('normalize', 'article content is empty')

    const source = cleanText(candidate?.source ?? new URL(url).hostname)
    if (source.length === 0) throw new NewsAcquisitionError('normalize', 'article source is empty')
    const publishedAt = normalizeTimestamp(candidate?.publishedAt ?? input.fetchedAt, 'publishedAt')
    const metadata: JsonObject = {
      ...(candidate?.metadata ?? {}),
      url,
      fetchedAt: input.fetchedAt,
      status: input.status,
    }
    if (input.contentType !== undefined) metadata.contentType = input.contentType

    return { title, content, source, publishedAt, url, metadata }
  }
}

function readTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match?.[1] ?? ''
}

function extractVisibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|article|main|section|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
