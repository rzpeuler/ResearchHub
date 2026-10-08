import { sha256 } from './hash.ts'
import type { ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate, NormalizedResearchSource } from './contracts.ts'
import { DocumentInputResolver } from '../document/input-resolver.ts'

export interface GdeltResearchPluginOptions { readonly endpoint?: string; readonly fetchImpl?: typeof fetch; readonly now?: () => string }
export class GdeltResearchPlugin implements ResearchAcquisitionPlugin {
  readonly name = 'gdelt-research-acquisition'
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => string
  private readonly resolver = new DocumentInputResolver()
  constructor(options: GdeltResearchPluginOptions = {}) { this.endpoint = options.endpoint ?? 'https://api.gdeltproject.org/api/v2/doc/doc'; this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? (() => new Date().toISOString()) }
  async discover(request: ResearchAcquisitionRequest): Promise<readonly ResearchSourceCandidate[]> {
    if (!('company' in request)) {
      const target = request.industry
      if (!target) return []
      const terms = [target.name, ...(target.aliases ?? []), ...target.searchTerms].slice(0, 8).map((x) => x.trim()).filter(Boolean)
      return this.discoverForQuery(request, terms, (index) => ({ index, industryName: target.name }))
    }
    const company = request.company
    if (!company) return []
    const terms = [company.name ?? company.symbol]
    return this.discoverForQuery(request, terms, (index) => ({ index, companySymbol: company.symbol }))
  }
  private async discoverForQuery(request: ResearchAcquisitionRequest, terms: readonly string[], metadata: (index: number) => Record<string, unknown>): Promise<readonly ResearchSourceCandidate[]> {
    const query = terms.map((term) => `"${term.slice(0, 120)}"`).join(' OR ')
    const url = new URL(this.endpoint); url.searchParams.set('query', query.slice(0, 900)); url.searchParams.set('mode', 'artlist'); url.searchParams.set('format', 'json'); url.searchParams.set('maxrecords', String(Math.min(Math.max(request.limitPerKind ?? 5, 1), 20))); url.searchParams.set('sort', 'datedesc')
    const response = await this.fetchImpl(url); if (!response.ok) throw new Error(`GDELT request failed with HTTP ${response.status}`)
    const payload = await response.json() as { articles?: readonly Record<string, unknown>[] }; if (!Array.isArray(payload.articles)) return []
    return payload.articles.slice(0, 20).flatMap((article, index) => { const articleUrl = typeof article.url === 'string' ? article.url : undefined; const title = typeof article.title === 'string' ? article.title : undefined; if (!articleUrl || !title) return []; return [{ candidateId: `gdelt-${sha256(articleUrl).slice(0, 16)}`, kind: 'news', tier: 3, title, url: articleUrl, provider: 'gdelt', publishedAt: normalizeDate(article.seendate), snippet: typeof article.seendate === 'string' ? article.seendate : undefined, metadata: metadata(index) }] })
  }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> { if (!candidate.url) throw new Error('GDELT candidate has no URL'); const response = await this.fetchImpl(candidate.url); if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`); const rawBytes = new Uint8Array(await response.arrayBuffer()); const content = new TextDecoder().decode(rawBytes); return { candidate, retrievedAt: this.now(), content, rawBytes, contentType: response.headers.get('content-type') ?? undefined, contentHash: sha256(content) } }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> { const bytes = source.rawBytes ?? new TextEncoder().encode(source.content); const document = await this.resolver.parse({ bytes, filename: 'gdelt-article.html', mediaType: 'text/html' }); return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: document.normalizedText, canonicalUrl: source.candidate.url, contentHash: source.contentHash ?? sha256(source.content), rawBytes: bytes, publisher: source.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } }
}
function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (!match) return undefined
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`
  const date = new Date(iso)
  return !Number.isNaN(date.getTime()) && date.toISOString() === iso ? iso : undefined
}
