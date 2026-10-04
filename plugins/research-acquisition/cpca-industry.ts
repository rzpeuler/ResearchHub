import { sha256 } from './hash.ts'
import { DocumentInputResolver } from '../document/input-resolver.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate } from './contracts.ts'

export interface CpcaIndustryResearchPluginOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: () => string
  readonly timeoutMs?: number
  readonly maxListPayloadBytes?: number
  readonly maxDocumentPayloadBytes?: number
  readonly documentResolver?: Pick<DocumentInputResolver, 'parse'>
  readonly routes?: readonly string[]
}

const PROVIDER = 'cpca'
const NAME = 'cpca-industry-research-acquisition'
const PUBLISHER = 'China Printed Circuit Association'
export const CPCA_INDUSTRY_ROUTES = ['https://www.cpca.org.cn/industry-287.html', 'https://www.cpca.org.cn/industry-279.html', 'https://www.cpca.org.cn/industry.html'] as const
const MAX_ROUTES = 3
const MAX_PAGES = 2
const MAX_CANDIDATES = 12
const TRACKING = new Set(['spm', 'from', 'source', 'share', 'utm_source', 'utm_medium', 'utm_campaign'])
const GENERIC = new Set(['industry', 'manufacturing', '行业', '产业', '制造业'])

export type CpcaFailureCode = 'RESTRICTED_ACCESS_GATE' | 'UNSUPPORTED_MEDIA' | 'FETCH_OR_TRANSPORT_FAILURE' | 'PARSER_OR_NORMALIZATION_FAILURE'
export class CpcaAcquisitionError extends Error {
  constructor(readonly code: CpcaFailureCode, message: string) { super(message); this.name = 'CpcaAcquisitionError' }
}

const clean = (value: string, max = 1200) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max)
const targetTokens = (value: string) => value.toLocaleLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []
export const cpcaTargetTerms = (request: Extract<ResearchAcquisitionRequest, { industry: unknown }>) => {
  const phrases = [request.industry.name, ...(request.industry.aliases ?? []), ...request.industry.searchTerms].map((x) => clean(x)).filter(Boolean)
  return [...new Set(phrases.flatMap((phrase) => [phrase, ...targetTokens(phrase)]).filter((x) => !GENERIC.has(x.toLocaleLowerCase())))]
}
const canonical = (value: string) => { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (TRACKING.has(key.toLocaleLowerCase())) url.searchParams.delete(key); return url.toString() }
export const validCpcaUrl = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'cpca.org.cn' || url.hostname === 'www.cpca.org.cn') } catch { return false } }
const dateValue = (value: string) => { const match = value.match(/20\d{2}(?:年|[-/.])\d{1,2}(?:月|[-/.])\d{1,2}日?/); if (!match) return undefined; const parsed = new Date(match[0].replace(/年|月|日/g, '-').replace(/[/.]/g, '-').replace(/-+$/, '')); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString() }
const score = (title: string, snippet: string | undefined, searchTerms: readonly string[]) => searchTerms.reduce((n, term) => n + (title.toLocaleLowerCase().includes(term.toLocaleLowerCase()) ? 3 : 0) + (snippet?.toLocaleLowerCase().includes(term.toLocaleLowerCase()) ? 1 : 0), 0)
const attachment = (url: string) => /\.(pdf|docx?|xlsx?|pptx?)($|[?#])/i.test(url)
const substantiveText = (value: string) => value.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const linkedAttachment = (html: string, baseUrl: string) => {
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    try {
      const url = canonical(new URL(match[1]!.trim(), baseUrl).toString())
      if (attachment(url) && validCpcaUrl(url)) return url
    } catch { /* malformed links are ignored */ }
  }
  return undefined
}
export const hasCpcaAccessGate = (value: string) => {
  const text = substantiveText(value).slice(0, 120_000)
  const gate = /请登录|登录后|sign\s*in|member\s*login|subscription\s*required|purchase\s+to\s+(?:read|continue)/gi
  const control = /会员|购买|订阅|付费|专享|验证码|captcha|subscription|member|purchase/i
  return [...text.matchAll(gate)].some((match) => control.test(text.slice(Math.max(0, match.index ?? 0) - 160, Math.min(text.length, (match.index ?? 0) + match[0].length + 160))))
}

type Row = { title: string; url: string; snippet?: string; publishedAt?: string; isAttachment: boolean }
function parseList(html: string, baseUrl: string): { rows: Row[]; next: string[] } {
  const rows: Row[] = []; const next: string[] = []; const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const title = clean(match[2]!.replace(/<[^>]+>/g, '')); let url: string
    try { url = canonical(new URL(match[1]!.trim(), baseUrl).toString()) } catch { continue }
    if (!title || !validCpcaUrl(url)) continue
    const context = clean(html.slice(Math.max(0, match.index - 260), Math.min(html.length, re.lastIndex + 260)))
    if (/下一页|下页|next|page\s*2|page=2/i.test(`${title} ${match[1]}`)) next.push(url)
    else rows.push({ title, url, snippet: context, publishedAt: dateValue(context), isAttachment: attachment(url) })
  }
  return { rows, next }
}

async function bounded(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) { const bytes = new TextEncoder().encode(await response.text()); if (bytes.byteLength > maximum) throw new Error('CPCA payload exceeds bound'); return bytes }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); throw new Error('CPCA payload exceeds bound') } chunks.push(part.value) }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength } return bytes
}

export class CpcaIndustryResearchPlugin implements ResearchAcquisitionPlugin {
  readonly name = NAME
  private readonly fetchImpl: typeof fetch
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly listMax: number
  private readonly documentMax: number
  private readonly resolver: Pick<DocumentInputResolver, 'parse'>
  private readonly routes: readonly string[]
  constructor(options: CpcaIndustryResearchPluginOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? (() => new Date().toISOString()); this.timeoutMs = Math.min(20_000, Math.max(1, options.timeoutMs ?? 15_000)); this.listMax = Math.min(2 * 1024 * 1024, options.maxListPayloadBytes ?? 2 * 1024 * 1024); this.documentMax = Math.min(32 * 1024 * 1024, options.maxDocumentPayloadBytes ?? 32 * 1024 * 1024); this.resolver = options.documentResolver ?? new DocumentInputResolver(); this.routes = (options.routes ?? CPCA_INDUSTRY_ROUTES).slice(0, MAX_ROUTES).filter(validCpcaUrl) }
    private async request(url: string, maximum: number, accept: string) { if (!validCpcaUrl(url)) throw new CpcaAcquisitionError('FETCH_OR_TRANSPORT_FAILURE', 'CPCA URL is outside the allowed domain'); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); try { let response: Response; try { response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept } }) } catch (error) { throw new CpcaAcquisitionError('FETCH_OR_TRANSPORT_FAILURE', `CPCA request transport failed: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`) } const finalUrl = canonical(response.url || url); if (!validCpcaUrl(finalUrl)) throw new CpcaAcquisitionError('RESTRICTED_ACCESS_GATE', 'CPCA redirect crossed domain boundary'); if (!response.ok) throw new CpcaAcquisitionError('FETCH_OR_TRANSPORT_FAILURE', `CPCA request failed with HTTP ${response.status}`); let bytes: Uint8Array; try { bytes = await bounded(response, maximum) } catch (error) { if (error instanceof CpcaAcquisitionError) throw error; throw new CpcaAcquisitionError('FETCH_OR_TRANSPORT_FAILURE', `CPCA payload could not be read: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`) } return { response, finalUrl, bytes } } finally { clearTimeout(timer) } }
  async discover(request: ResearchAcquisitionRequest): Promise<readonly ResearchSourceCandidate[]> {
    if ('company' in request) return []
    const searchTerms = cpcaTargetTerms(request); if (!searchTerms.length) return []
    const found = new Map<string, ResearchSourceCandidate>()
    for (const route of this.routes) { let page = route; const visited = new Set<string>(); const routeHost = new URL(route).hostname
      for (let pageIndex = 0; pageIndex < MAX_PAGES && page; pageIndex++) { if (visited.has(page)) break; visited.add(page); const result = await this.request(page, this.listMax, 'text/html,application/xhtml+xml'); const parsed = parseList(new TextDecoder().decode(result.bytes), result.finalUrl)
        for (const row of parsed.rows) { const relevance = score(row.title, row.snippet, searchTerms); if (!relevance || (row.publishedAt && request.asOf && row.publishedAt > new Date(request.asOf).toISOString())) continue; const candidate: ResearchSourceCandidate = { candidateId: `${PROVIDER}-${sha256(row.url)}`, kind: 'web_article', tier: 4, title: row.title, url: row.url, provider: PROVIDER, ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}), snippet: row.snippet, metadata: { discoveryRoute: new URL(route).pathname, relevanceTerms: searchTerms.filter((term) => `${row.title} ${row.snippet ?? ''}`.toLocaleLowerCase().includes(term.toLocaleLowerCase())), isAttachment: row.isAttachment } }; found.set(row.url, candidate) }
        page = parsed.next.find((value) => validCpcaUrl(value) && new URL(value).hostname === routeHost) ?? ''
      }
    }
    return [...found.values()].sort((a, b) => score(b.title, b.snippet, searchTerms) - score(a.title, a.snippet, searchTerms) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || (a.url ?? '').localeCompare(b.url ?? '')).slice(0, Math.min(MAX_CANDIDATES, Math.max(0, request.limitPerKind ?? 6)))
  }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> {
    if (candidate.provider !== PROVIDER || candidate.tier !== 4 || !candidate.url || !validCpcaUrl(candidate.url) || candidate.candidateId !== `${PROVIDER}-${sha256(canonical(candidate.url))}`) throw new Error('candidate does not belong to CPCA')
    const result = await this.request(canonical(candidate.url), this.documentMax, 'text/html,application/xhtml+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const contentType = (result.response.headers.get('content-type') ?? '').split(';')[0].toLocaleLowerCase(); const isPdf = contentType === 'application/pdf'; const allowed = ['text/html', 'application/xhtml+xml', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(contentType); if (!allowed) throw new CpcaAcquisitionError('UNSUPPORTED_MEDIA', `CPCA unsupported or missing content type: ${contentType || 'missing'}`)
    const content = new TextDecoder().decode(result.bytes); if (hasCpcaAccessGate(content)) throw new CpcaAcquisitionError('RESTRICTED_ACCESS_GATE', 'CPCA content is restricted or teaser-only')
    // Some CPCA article pages contain a rich HTML article plus an unrelated
    // legacy PDF link in the footer. Follow one attachment only when the
    // article itself is too thin to be usable.
    if (!isPdf && ['text/html', 'application/xhtml+xml'].includes(contentType) && substantiveText(content).length < 1200) {
      const attachmentUrl = linkedAttachment(content, result.finalUrl)
      if (attachmentUrl && attachmentUrl !== result.finalUrl) {
        const attached = await this.request(attachmentUrl, this.documentMax, 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        const attachedType = (attached.response.headers.get('content-type') ?? '').split(';')[0].toLocaleLowerCase(); const attachedPdf = attachedType === 'application/pdf'; const attachedAllowed = attachedPdf || ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(attachedType); if (!attachedAllowed) throw new CpcaAcquisitionError('UNSUPPORTED_MEDIA', `CPCA attachment unsupported or missing content type: ${attachedType || 'missing'}`)
        const attachedContent = new TextDecoder().decode(attached.bytes); if (hasCpcaAccessGate(attachedContent)) throw new CpcaAcquisitionError('RESTRICTED_ACCESS_GATE', 'CPCA attachment is restricted or teaser-only')
        return { candidate: { ...candidate, url: attached.finalUrl, metadata: { ...(candidate.metadata ?? {}), sourcePageUrl: result.finalUrl, attachmentUrl: attached.finalUrl } }, retrievedAt: this.now(), content: attachedContent, contentType: attachedType, mediaType: attachedType, rawBytes: attached.bytes, contentHash: sha256(attached.bytes) }
      }
    }
    return { candidate: { ...candidate, url: result.finalUrl }, retrievedAt: this.now(), content, contentType, mediaType: contentType, rawBytes: result.bytes, contentHash: sha256(result.bytes) }
  }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> {
    if (source.candidate.provider !== PROVIDER || source.candidate.tier !== 4 || !source.rawBytes?.byteLength || !source.candidate.url || !validCpcaUrl(source.candidate.url)) throw new Error('source does not belong to CPCA')
    const mediaType = source.mediaType ?? source.contentType ?? ''; if (!['application/pdf', 'text/html', 'application/xhtml+xml', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mediaType)) throw new CpcaAcquisitionError('UNSUPPORTED_MEDIA', 'CPCA source has missing or unsupported media type'); const filename = mediaType === 'application/pdf' ? 'cpca-document.pdf' : mediaType === 'text/html' || mediaType === 'application/xhtml+xml' ? 'cpca-document.html' : 'cpca-document.bin'; let document: Awaited<ReturnType<DocumentInputResolver['parse']>>; try { document = await this.resolver.parse({ bytes: source.rawBytes, filename, mediaType }) } catch { throw new CpcaAcquisitionError('PARSER_OR_NORMALIZATION_FAILURE', 'CPCA document parser failed') } if (!document.normalizedText.trim()) throw new CpcaAcquisitionError('PARSER_OR_NORMALIZATION_FAILURE', 'CPCA document has no substantive normalized content'); if (hasCpcaAccessGate(document.normalizedText)) throw new CpcaAcquisitionError('RESTRICTED_ACCESS_GATE', 'CPCA normalized content is restricted or teaser-only')
    return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: document.normalizedText, canonicalUrl: canonical(source.candidate.url), contentHash: source.contentHash ?? sha256(source.rawBytes), rawBytes: Uint8Array.from(source.rawBytes), mediaType, publisher: PUBLISHER, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } }
  }
}
