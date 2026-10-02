import { sha256 } from './hash.ts'
import { DocumentInputResolver } from '../document/input-resolver.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate } from './contracts.ts'

export interface GovCnIndustryResearchPluginOptions {
  readonly fetchImpl?: typeof fetch
  readonly endpoint?: string
  readonly now?: () => string
  readonly timeoutMs?: number
  readonly maxSearchPayloadBytes?: number
  readonly maxDocumentPayloadBytes?: number
  readonly documentResolver?: Pick<DocumentInputResolver, 'parse'>
}

const DEFAULT_ENDPOINT = 'https://sousuo.www.gov.cn/search-gov/data'
const PROVIDER = 'govcn'
const NAME = 'govcn-industry-research-acquisition'
const MAX_QUERIES = 4
const MAX_PAGES = 2
const PAGE_SIZE = 10
const MAX_CANDIDATES = 8
const GENERIC = new Set(['industry', 'manufacturing', '行业', '产业', '制造'])
const TRACKING = new Set(['spm', 'from', 'source', 'share', 'share_token', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'])

type Row = { title: string; url: string; publisher?: string; publishedAt?: string; snippet?: string }
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown, max = 1000): string | undefined => typeof value === 'string' && value.trim() ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max) : undefined
const pick = (row: Record<string, unknown>, names: string[]) => names.map((name) => row[name]).find((value) => value !== undefined)
const termsOf = (request: Extract<ResearchAcquisitionRequest, { industry: unknown }>): string[] => {
  const values = [request.industry.name, ...(request.industry.aliases ?? []), ...request.industry.searchTerms]
  const normalized = values.map((value) => text(value, 120)).filter((value): value is string => Boolean(value))
  const specific = normalized.filter((value) => !GENERIC.has(value.toLocaleLowerCase()))
  return [...new Set([...specific, ...normalized])].sort((a, b) => (b.replace(/[^\p{L}\p{N}]+/gu, '').length - a.replace(/[^\p{L}\p{N}]+/gu, '').length) || a.localeCompare(b))
}
const queryList = (request: Extract<ResearchAcquisitionRequest, { industry: unknown }>): string[] => termsOf(request).slice(0, MAX_QUERIES).map((term) => term.slice(0, 120))
const overlap = (value: string | undefined, terms: readonly string[]) => terms.reduce((score, term) => score + (value?.toLocaleLowerCase().includes(term.toLocaleLowerCase()) && !GENERIC.has(term.toLocaleLowerCase()) ? 1 : 0), 0)
const validGovUrl = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'gov.cn' || url.hostname.endsWith('.gov.cn')) } catch { return false } }
const canonicalize = (value: string) => { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (TRACKING.has(key.toLocaleLowerCase())) url.searchParams.delete(key); return url.toString() }
const dateValue = (value: unknown) => { const candidate = text(value, 40); if (!candidate || Number.isNaN(Date.parse(candidate))) return undefined; return new Date(candidate).toISOString() }

function resultRows(payload: unknown): Row[] {
  const root = record(payload); const dataValue = root?.data; const data = record(dataValue); const searchVO = record(root?.searchVO); const catMap = record(searchVO?.catMap); const gongbao = record(catMap?.gongbao)
  const container = [data?.list, data?.results, data?.items, root?.list, root?.results, gongbao?.listVO].find(Array.isArray)
  if (!container) { if ((Array.isArray(dataValue) && dataValue.length === 0) || (data && (Object.keys(data).length === 0 || data.code === '0' || data.total === 0 || data.totalCount === 0))) return []; throw new Error('Gov.cn response has no bounded result array') }
  return (container as unknown[]).flatMap((item) => { const row = record(item); if (!row) return []; const title = text(pick(row, ['title', 'Title'])); const url = text(pick(row, ['url', 'URL', 'link', 'docUrl']), 2048); if (!title || !url || !validGovUrl(url)) return []; return [{ title, url: canonicalize(url), publisher: text(pick(row, ['pubOrg', 'publisher', 'organization', 'source', 'fwdw'])), publishedAt: dateValue(pick(row, ['pubTime', 'publishDate', 'publishedAt', 'date', 'pubtime', 'pubtimeStr'])), snippet: text(pick(row, ['summary', 'content', 'snippet', 'description'])) }] })
}

async function boundedText(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) { const value = new TextEncoder().encode(await response.text()); if (value.byteLength > maximum) throw new Error('Gov.cn payload exceeds bound'); return value }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); throw new Error('Gov.cn payload exceeds bound') } chunks.push(part.value) }
  const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength } return output
}

export class GovCnIndustryResearchPlugin implements ResearchAcquisitionPlugin {
  readonly name = NAME
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly maxSearchPayloadBytes: number
  private readonly maxDocumentPayloadBytes: number
  private readonly resolver: Pick<DocumentInputResolver, 'parse'>
  constructor(options: GovCnIndustryResearchPluginOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT; this.now = options.now ?? (() => new Date().toISOString()); this.timeoutMs = Math.min(20_000, Math.max(1, options.timeoutMs ?? 15_000)); this.maxSearchPayloadBytes = Math.min(2 * 1024 * 1024, options.maxSearchPayloadBytes ?? 2 * 1024 * 1024); this.maxDocumentPayloadBytes = Math.min(8 * 1024 * 1024, options.maxDocumentPayloadBytes ?? 8 * 1024 * 1024); this.resolver = options.documentResolver ?? new DocumentInputResolver() }
  private async request(url: URL, init: RequestInit = {}, maximum = this.maxSearchPayloadBytes): Promise<{ response: Response; bytes: Uint8Array }> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); try { const response = await this.fetchImpl(url.toString(), { ...init, signal: controller.signal }); if (!response.ok) throw new Error(`Gov.cn request failed with HTTP ${response.status}`); return { response, bytes: await boundedText(response, maximum) } } finally { clearTimeout(timer) } }
  async discover(request: ResearchAcquisitionRequest): Promise<readonly ResearchSourceCandidate[]> { if ('company' in request) return []; const terms = termsOf(request); const queries = queryList(request); const candidates = new Map<string, ResearchSourceCandidate>()
    for (const query of queries) for (let page = 1; page <= MAX_PAGES; page++) { const url = new URL(this.endpoint); for (const [key, value] of Object.entries({ t: 'zhengcelibrary_gw_bm_gb', searchfield: 'title:content:summary', orderBy: 'RELEVANCE', q: query, pageNum: String(page), pageSize: String(PAGE_SIZE) })) url.searchParams.set(key, value); const result = await this.request(url); let rows: Row[]; try { rows = resultRows(JSON.parse(new TextDecoder().decode(result.bytes))) } catch (error) { throw error instanceof Error ? error : new Error('Gov.cn response is invalid JSON') } for (const row of rows) { if (!validGovUrl(row.url)) continue; const relevanceTerms = terms.filter((term) => overlap(`${row.title} ${row.snippet ?? ''}`, [term]) > 0); if (relevanceTerms.length === 0) continue; const candidate: ResearchSourceCandidate = { candidateId: `govcn-${sha256(row.url)}`, kind: 'web_article', tier: 1, title: row.title, url: row.url, provider: PROVIDER, publishedAt: row.publishedAt, snippet: row.snippet, metadata: { publicationOrganization: row.publisher, discoveryQuery: query, relevanceTerms, governmentSearchCategory: 'zhengcelibrary_gw_bm_gb' } }; candidates.set(row.url, candidate) } if (rows.length < PAGE_SIZE) break }
    return [...candidates.values()].sort((a, b) => { const at = overlap(a.title, terms) * 2 + overlap(a.snippet, terms); const bt = overlap(b.title, terms) * 2 + overlap(b.snippet, terms); return bt - at || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || (a.url ?? '').localeCompare(b.url ?? '') }).slice(0, Math.min(MAX_CANDIDATES, Math.max(0, request.limitPerKind ?? 6)))
  }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> { if (candidate.provider !== PROVIDER || !candidate.url || !validGovUrl(candidate.url) || candidate.candidateId !== `govcn-${sha256(canonicalize(candidate.url))}`) throw new Error('candidate does not belong to Gov.cn'); const requested = new URL(candidate.url); const { response, bytes } = await this.request(requested, { headers: { accept: 'text/html,application/xhtml+xml,application/pdf' } }, this.maxDocumentPayloadBytes); const finalUrl = response.url || requested.toString(); if (!validGovUrl(finalUrl)) throw new Error('Gov.cn redirect crossed domain boundary'); const contentType = (response.headers.get('content-type') ?? '').split(';')[0].toLocaleLowerCase(); if (!['application/pdf', 'text/html', 'application/xhtml+xml'].includes(contentType)) throw new Error(`Gov.cn unsupported or missing content type: ${contentType || 'missing'}`); return { candidate: { ...candidate, url: canonicalize(finalUrl) }, retrievedAt: this.now(), content: new TextDecoder().decode(bytes), contentType, mediaType: contentType, rawBytes: bytes, contentHash: sha256(bytes) } }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> { if (source.candidate.provider !== PROVIDER || !source.rawBytes?.byteLength || !source.candidate.url || !validGovUrl(source.candidate.url)) throw new Error('source does not belong to Gov.cn'); const mediaType = (source.mediaType ?? source.contentType ?? '').split(';')[0]!.toLowerCase(); if (!['application/pdf', 'text/html', 'application/xhtml+xml'].includes(mediaType)) throw new Error('Gov.cn unsupported or missing content type'); const filename = mediaType === 'application/pdf' ? 'government-document.pdf' : 'government-document.html'; const document = await this.resolver.parse({ bytes: source.rawBytes, filename, mediaType }); if (!document.normalizedText.trim()) throw new Error('Gov.cn normalized document is empty'); const publisher = text(record(source.candidate.metadata)?.publicationOrganization) ?? 'China Government Website'; return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: document.normalizedText, canonicalUrl: canonicalize(source.candidate.url), contentHash: source.contentHash ?? sha256(source.rawBytes), rawBytes: Uint8Array.from(source.rawBytes), mediaType, publisher, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } } }
}
