import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentInputResolver } from '../document/input-resolver.ts'
import type { ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate, NormalizedResearchSource } from './contracts.ts'
import { sha256 } from './hash.ts'
import { acquisitionStep, type ResearchFetchOptions } from './deadlines.ts'

export interface CompanyPublicWebOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: () => string
  readonly resolveHost?: (host: string) => Promise<readonly { address: string }[]>
  /** Test seam for independently proving a synthetic proxy DNS hostname's public A records. */
  readonly resolvePublicDnsProof?: (host: string, signal?: AbortSignal) => Promise<PublicDnsProof>
  readonly documentResolver?: Pick<DocumentInputResolver, 'parse'>
  /** Runtime-only URL discovery cache. Bodies and canonical Knowledge are never stored here. */
  readonly candidateCacheRoot?: string
}
export interface PublicDnsProof { readonly Status: number; readonly Answer?: readonly { readonly type: number; readonly data: string }[] }
interface CachedPublicCandidate { readonly companySymbol: string; readonly companyName: string; readonly title: string; readonly url: string; readonly discoveryTerms: readonly string[]; readonly discoveredAt: string; readonly bodyHash: string }

/** Public search is discovery only. The fetched page body, never its search snippet, is evidence. */
export class CompanyPublicWebPlugin implements ResearchAcquisitionPlugin {
  readonly name = 'company-public-web'
  private readonly fetchImpl: typeof fetch
  private readonly now: () => string
  private readonly resolveHost: NonNullable<CompanyPublicWebOptions['resolveHost']>
  private readonly resolver: Pick<DocumentInputResolver, 'parse'>
  private readonly resolvePublicDnsProof: NonNullable<CompanyPublicWebOptions['resolvePublicDnsProof']>
  private readonly candidateCacheRoot: string | undefined
  private readonly cacheWrites = new Map<string, Promise<void>>()
  constructor(options: CompanyPublicWebOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date().toISOString())
    this.resolveHost = options.resolveHost ?? ((host) => lookup(host, { all: true }))
    this.resolver = options.documentResolver ?? new DocumentInputResolver()
    this.candidateCacheRoot = options.candidateCacheRoot ? resolve(options.candidateCacheRoot) : undefined
    this.resolvePublicDnsProof = options.resolvePublicDnsProof ?? (async (host, signal) => {
      const endpoint = new URL('https://cloudflare-dns.com/dns-query')
      endpoint.searchParams.set('name', host)
      endpoint.searchParams.set('type', 'A')
      const response = await this.fetchImpl(endpoint, { signal, redirect: 'error', headers: { accept: 'application/dns-json' } })
      if (!response.ok) throw new Error(`PUBLIC_WEB_DNS_PROOF_HTTP_${response.status}`)
      const body = await response.text()
      if (body.length > 64_000) throw new Error('PUBLIC_WEB_DNS_PROOF_TOO_LARGE')
      return JSON.parse(body) as PublicDnsProof
    })
  }
  private cachePath(symbol: string, name: string): string | undefined {
    return this.candidateCacheRoot ? join(this.candidateCacheRoot, `${sha256(`${symbol}\0${name}`)}.json`) : undefined
  }
  private async readCachedCandidates(symbol: string, name: string): Promise<readonly CachedPublicCandidate[]> {
    const path = this.cachePath(symbol, name)
    if (!path) return []
    try {
      const text = await readFile(path, 'utf8')
      if (text.length > 64_000) return []
      const parsed = JSON.parse(text) as { records?: unknown }
      if (!Array.isArray(parsed.records)) return []
      return parsed.records.filter((record): record is CachedPublicCandidate => {
        if (!record || typeof record !== 'object') return false
        const entry = record as CachedPublicCandidate
        return entry.companySymbol === symbol && entry.companyName === name && typeof entry.title === 'string' && entry.title.length > 0 && entry.title.length <= 500 && typeof entry.url === 'string' && safePublicUrlSyntax(entry.url) && typeof entry.bodyHash === 'string' && /^[a-f0-9]{64}$/.test(entry.bodyHash) && typeof entry.discoveredAt === 'string' && Number.isFinite(Date.parse(entry.discoveredAt)) && Array.isArray(entry.discoveryTerms) && entry.discoveryTerms.length <= 8 && entry.discoveryTerms.every((term) => typeof term === 'string' && term.length <= 120)
      }).slice(0, 20)
    } catch { return [] }
  }
  private async cacheNormalizedCandidate(source: ResearchFetchedSource, hash: string): Promise<void> {
    const symbol = source.candidate.metadata?.companySymbol
    const name = source.candidate.metadata?.companyName
    const url = source.candidate.url
    if (typeof symbol !== 'string' || typeof name !== 'string' || !url || !safePublicUrlSyntax(url)) return
    const path = this.cachePath(symbol, name)
    if (!path) return
    const previousWrite = this.cacheWrites.get(path) ?? Promise.resolve()
    const write = previousWrite.catch(() => {}).then(async () => {
      const previous = await this.readCachedCandidates(symbol, name)
      const terms = source.candidate.metadata?.discoveryTerms
      const record: CachedPublicCandidate = { companySymbol: symbol, companyName: name, title: source.candidate.title.slice(0, 500), url, bodyHash: hash, discoveredAt: typeof source.candidate.metadata?.discoveredAt === 'string' && Number.isFinite(Date.parse(source.candidate.metadata.discoveredAt)) ? source.candidate.metadata.discoveredAt : source.retrievedAt, discoveryTerms: Array.isArray(terms) ? terms.filter((term): term is string => typeof term === 'string').map((term) => term.slice(0, 120)).slice(0, 8) : [] }
      const records = [record, ...previous.filter((entry) => entry.url !== url)].slice(0, 20)
      await mkdir(this.candidateCacheRoot!, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try { await writeFile(temporary, JSON.stringify({ version: 1, records }), 'utf8'); await rename(temporary, path) }
      finally { await rm(temporary, { force: true }) }
    })
    this.cacheWrites.set(path, write)
    try { await write } finally { if (this.cacheWrites.get(path) === write) this.cacheWrites.delete(path) }
  }
  private async publicUrl(raw: string, signal?: AbortSignal): Promise<URL> {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hostname === 'localhost' || url.hostname.endsWith('.local') || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('PUBLIC_WEB_UNSAFE_URL')
    const addresses = await this.resolveHost(url.hostname)
    if (!addresses.length) throw new Error('PUBLIC_WEB_PRIVATE_ADDRESS')
    const blocked = addresses.filter(({ address }) => !publicAddress(address))
    if (blocked.length) {
      // Windows proxy fake-IP mappings are transport routes, never public-address evidence.
      // Only the reserved benchmark range may ask for an independent HTTPS DNS proof.
      if (blocked.some(({ address }) => !syntheticProxyAddress(address))) throw new Error('PUBLIC_WEB_PRIVATE_ADDRESS')
      const proof = await acquisitionStep({ activityId: `public-web:dns-proof:${url.hostname}`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 10_000 }, (requestSignal) => this.resolvePublicDnsProof(url.hostname, requestSignal))
      const records = proof?.Answer?.filter((answer) => answer.type === 1)
      if (proof?.Status !== 0 || !records?.length || records.some((answer) => isIP(answer.data) !== 4 || !publicAddress(answer.data))) throw new Error('PUBLIC_WEB_PUBLIC_DNS_PROOF_REJECTED')
    }
    return url
  }
  private async download(raw: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; url: string; mediaType: string }> {
    let url = raw
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const checked = await this.publicUrl(url, signal)
      const response = await this.fetchImpl(checked, { signal, redirect: 'manual', headers: { 'user-agent': 'ResearchHub/PersonalResearchV1', accept: 'text/html, application/pdf, application/rss+xml' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('PUBLIC_WEB_INVALID_REDIRECT')
        const target = new URL(location, checked)
        if (checked.hostname === 'www.sogou.com' && target.hostname === 'www.sogou.com' && /antispider|captcha/i.test(target.pathname)) throw new Error('PUBLIC_WEB_SEARCH_ACCESS_CHALLENGE')
        url = target.href
        continue
      }
      if (!response.ok) throw new Error(`PUBLIC_WEB_HTTP_${response.status}`)
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      if (reader) while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > 12_000_000) { await reader.cancel(); throw new Error('PUBLIC_WEB_BODY_TOO_LARGE') }
        chunks.push(chunk.value)
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      // Sogou's fixed link endpoint exposes a literal destination instead of an HTTP redirect.
      // Parse the literal only; never execute page JavaScript or trust it as article evidence.
      if (checked.hostname === 'www.sogou.com' && checked.pathname === '/link' && length < 10_000) {
        const target = new TextDecoder().decode(bytes).match(/window\.location\.replace\(\s*["']([^"']+)["']\s*\)/)?.[1]
        if (target) { url = xmlText(target); continue }
      }
      return { bytes, url: checked.href, mediaType: response.headers.get('content-type')?.split(';')[0] ?? 'text/html' }
    }
    throw new Error('PUBLIC_WEB_REDIRECT_LIMIT')
  }
  async discover(request: ResearchAcquisitionRequest, signal?: AbortSignal): Promise<readonly ResearchSourceCandidate[]> {
    if (!request.company || request.researchPurpose !== 'company_research') return []
    const company = request.company.name ?? request.company.symbol
    const terms = (request.searchTerms?.length ? request.searchTerms : ['公司 产品 技术 主营业务', '行业 竞争对手 市场规模', '投资者关系 年报']).slice(0, 4)
    const candidates = new Map<string, ResearchSourceCandidate>()
    const diagnostics: string[] = []
    const addCandidate = (title: string, url: string, description: string, term: string, queryText: string, engine: string) => {
      if (!title || !/^https:\/\//i.test(url)) return
      if (!`${title} ${url} ${description}`.includes(company) && !`${title} ${url} ${description}`.includes(request.company!.symbol)) return
      const previous = candidates.get(url)
      const discoveryTerms = [...new Set([...(previous?.metadata?.discoveryTerms as string[] | undefined ?? []), term])]
      candidates.set(url, { candidateId: `public-web-${sha256(url).slice(0, 16)}`, kind: 'web_article', tier: 3, title, url, provider: 'public-web', metadata: { companySymbol: request.company!.symbol, companyName: request.company!.name, originalPublisher: new URL(url).hostname, discoveryQuery: queryText, discoveryEngine: engine, discoveryTerms, discoveredAt: this.now() } })
    }
    const queries = terms.flatMap((term) => [
      { term, text: `"${company}" ${term.slice(0, 120)}` },
      { term, text: `"${company}" ${request.company!.symbol} ${term.slice(0, 120)}` },
    ])
    const searchResults = await Promise.all(queries.map(async ({ term, text: queryText }) => {
      if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      try {
        const query = new URL('https://www.bing.com/search')
        query.searchParams.set('q', queryText)
        query.searchParams.set('format', 'rss')
        const body = await acquisitionStep({ activityId: `public-web:search:${sha256(queryText).slice(0, 8)}`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 12_000 }, (requestSignal) => this.download(query.href, requestSignal))
        return { term, queryText, xml: new TextDecoder().decode(body.bytes), error: undefined }
      } catch (error) { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); return { term, queryText, xml: '', error: String(error) } }
    }))
    for (const { term, queryText, xml, error } of searchResults) {
      if (error) { diagnostics.push(error); continue }
        for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
          const title = xmlText(item[1]!.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
          const url = xmlText(item[1]!.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? '')
          const description = xmlText(item[1]!.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '').replace(/<[^>]*>/g, ' ')
          // Broad Chinese search can split a company name into an unrelated geographic term.
          // Discovery snippets may identify a candidate; they never become report evidence.
          addCandidate(title, url, description, term, queryText, 'Bing')
        }
    }
    // Free public fallback for industry/competition: quote-heavy or off-topic RSS cannot
    // displace actual article candidates. Search snippets still remain discovery-only.
    const fallbackTerms = terms.filter((term) => /行业|竞争|市场|industry|competi/i.test(term)).slice(0, 2)
    // A generic market-size query often finds report catalogs. Use the spare query
    // slot to seek actual products/applications and competitor discussion instead.
    if (fallbackTerms.length === 1 && !fallbackTerms[0]!.includes('竞争对手 产品 应用')) fallbackTerms.push('竞争对手 产品 应用')
    const fallbackResults = await Promise.all(fallbackTerms.map(async (term) => {
      const queryText = `"${company}" ${term.slice(0, 120)}`
      try {
        const endpoint = new URL('https://www.sogou.com/web')
        endpoint.searchParams.set('query', queryText)
        const body = await acquisitionStep({ activityId: `public-web:sogou:${sha256(queryText).slice(0, 8)}`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 12_000 }, (requestSignal) => this.download(endpoint.href, requestSignal))
        return { term, queryText, html: new TextDecoder().decode(body.bytes), error: undefined }
      } catch (error) { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); return { term, queryText, html: '', error: String(error) } }
    }))
    for (const { term, queryText, html, error } of fallbackResults) {
      if (error) { diagnostics.push(error); continue }
      for (const result of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
        const href = result[1]!.match(/href=["']([^"']+)["']/)?.[1]
        if (!href) continue
        try {
          const title = xmlText(result[1]!.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
          const description = xmlText(html.slice(result.index! + result[0].length, result.index! + result[0].length + 2200).split(/<h3\b/i)[0]!.replace(/<[^>]*>/g, ' '))
          addCandidate(title, new URL(xmlText(href), 'https://www.sogou.com').href, description, term, queryText, 'Sogou')
        } catch { /* Invalid search links never become candidates. */ }
      }
    }
    const liveCount = [...candidates.values()].filter(candidate => candidateResearchRank(candidate) < 10).length
    const cachedCandidates = await this.readCachedCandidates(request.company.symbol, request.company.name ?? '')
    // Many unvalidated search headlines do not prove that previously useful article
    // bodies are rediscovered. Missing verified URLs also count as discovery coverage gaps.
    if (liveCount < Math.min(request.limitPerKind ?? 6, 20) || diagnostics.length || cachedCandidates.some(cached => !candidates.has(cached.url))) {
      for (const cached of cachedCandidates) {
        if (candidates.has(cached.url)) continue
        candidates.set(cached.url, { candidateId: `public-web-${sha256(cached.url).slice(0, 16)}`, kind: 'web_article', tier: 3, title: cached.title, url: cached.url, provider: 'public-web', metadata: { companySymbol: cached.companySymbol, companyName: cached.companyName, originalPublisher: new URL(cached.url).hostname, discoveryTerms: cached.discoveryTerms, cachedDiscovery: true, previousDiscoveredAt: cached.discoveredAt, previousBodyHash: cached.bodyHash, discoveryDiagnostics: diagnostics.slice(0, 10), cacheReason: liveCount === 0 ? 'LIVE_DISCOVERY_UNAVAILABLE' : 'LIVE_DISCOVERY_INSUFFICIENT', discoveredAt: this.now(), ...historicalContext(cached.title, '', this.now()) } })
      }
    }
    if (!candidates.size && diagnostics.length === queries.length + fallbackTerms.length) throw new Error(`PUBLIC_WEB_DISCOVERY_FAILED:${diagnostics.join(';').slice(0, 200)}`)
    // Follow a bounded public site directory when discovery finds a company landing page.
    // These are candidates only; each selected page must subsequently be fetched and parsed.
    const directoryPages: ResearchSourceCandidate[] = []
    for (const seed of [...candidates.values()].slice(0, 2)) {
      try {
        const result = await acquisitionStep({ activityId: `${seed.candidateId}:directory`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 8_000 }, (requestSignal) => this.download(seed.url!, requestSignal))
        if (!result.mediaType.includes('html')) continue
        const html = new TextDecoder().decode(result.bytes)
        for (const anchor of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
          const label = xmlText(anchor[2]!.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ')
          if (!/公司简介|关于我们|关于比亚迪|技术创新|研发实力|投资者关系|主营|产品|业务|About|Technology|Investor|Business/i.test(label)) continue
          const target = new URL(xmlText(anchor[1]!), result.url)
          if (target.hostname !== new URL(result.url).hostname || target.protocol !== 'https:' || target.href === result.url || candidates.has(target.href) || directoryPages.some((page) => page.url === target.href)) continue
          directoryPages.push({ ...seed, candidateId: `public-web-${sha256(target.href).slice(0, 16)}`, title: `${company} ${label}`, url: target.href, metadata: { ...seed.metadata, directoryUrl: result.url } })
          if (directoryPages.length >= 4) break
        }
      } catch (error) { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); diagnostics.push(String(error)) }
      if (directoryPages.length >= 4) break
    }
    const all = [...candidates.values()].sort((a, b) => candidateResearchRank(a) - candidateResearchRank(b))
    const diverse: ResearchSourceCandidate[] = []
    const selected = new Set<string>()
    for (const term of terms) {
      const candidate = all.find(candidate => candidateResearchRank(candidate) < 10 && (candidate.metadata?.discoveryTerms as readonly string[] | undefined)?.includes(term) && !selected.has(candidate.candidateId))
      if (candidate) { diverse.push(candidate); selected.add(candidate.candidateId) }
    }
    // Preserve a research-topic opportunity, then retry previously body-validated URLs
    // before spending the remaining budget on additional unvalidated search headlines.
    const ordered = [...diverse, ...directoryPages.slice(0, 2), ...all.filter(candidate => candidate.metadata?.cachedDiscovery === true), ...directoryPages.slice(2), ...all]
    const unique = new Set<string>()
    return ordered.filter(candidate => { if (unique.has(candidate.candidateId)) return false; unique.add(candidate.candidateId); return true }).slice(0, Math.min(request.limitPerKind ?? 6, 20))
  }
  async fetch(candidate: ResearchSourceCandidate, signal?: AbortSignal, options?: ResearchFetchOptions): Promise<ResearchFetchedSource> {
    if (!candidate.url) throw new Error('PUBLIC_WEB_URL_REQUIRED')
    const downloaded = await acquisitionStep({ activityId: `${candidate.candidateId}:download`, providerId: 'public-web', step: 'download', sourceTitle: candidate.title, signal, timeoutMs: options?.downloadTimeoutMs ?? 30_000, deadlineAt: options?.deadlineAt, onProgress: options?.onProgress }, (requestSignal) => this.download(candidate.url!, requestSignal))
    return { candidate: { ...candidate, url: downloaded.url }, retrievedAt: this.now(), content: new TextDecoder().decode(downloaded.bytes), rawBytes: downloaded.bytes, mediaType: downloaded.mediaType }
  }
  async normalize(source: ResearchFetchedSource, signal?: AbortSignal): Promise<NormalizedResearchSource> {
    const bytes = source.rawBytes ?? new TextEncoder().encode(source.content)
    const mediaType = source.mediaType ?? 'text/html'
    const document = await this.resolver.parse({ bytes, filename: mediaType.includes('pdf') ? 'company-public.pdf' : 'company-public.html', mediaType }, signal ? { signal } : undefined)
    if (document.normalizedText.trim().length < 120) throw new Error('PUBLIC_WEB_BODY_INSUFFICIENT')
    if (isPaidResearchCatalog(document.normalizedText)) throw new Error('PUBLIC_WEB_PAID_RESEARCH_CATALOG_NO_SUBSTANTIVE_BODY')
    const companyName = source.candidate.metadata?.companyName
    const companySymbol = source.candidate.metadata?.companySymbol
    if (typeof companyName === 'string' && companyName && !document.normalizedText.includes(companyName) && !(typeof companySymbol === 'string' && companySymbol && document.normalizedText.includes(companySymbol))) throw new Error('PUBLIC_WEB_BODY_COMPANY_MISMATCH')
    // Search-result dates are intentionally not treated as publication dates.
    const contentHash = sha256(document.normalizedText)
    let candidate = { ...source.candidate, metadata: { ...source.candidate.metadata, ...historicalContext(source.candidate.title, source.content, source.retrievedAt) } }
    try { await this.cacheNormalizedCandidate(source, contentHash) } catch { candidate = { ...candidate, metadata: { ...candidate.metadata, candidateCacheDiagnostic: 'PUBLIC_WEB_CANDIDATE_CACHE_WRITE_FAILED' } } }
    return { candidate, title: source.candidate.title, retrievedAt: source.retrievedAt, content: document.normalizedText, canonicalUrl: source.candidate.url, contentHash, rawBytes: bytes, mediaType, publisher: new URL(source.candidate.url!).hostname,
      rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } }
  }
}
function safePublicUrlSyntax(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && url.hostname !== 'localhost' && !url.hostname.endsWith('.local') && !isIP(url.hostname.replace(/^\[|\]$/g, '')) } catch { return false }
}
/** Dates are contextual warnings only; title/body years never manufacture publishedAt. */
function historicalContext(title: string, html: string, retrievedAt: string): Record<string, unknown> {
  let explicitDate: string | undefined
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:name|property)=["'](?:article:published_time|datePublished|pubdate|publishdate)["']/i.test(tag[0])) continue
    const value = tag[0].match(/content=["']([^"']+)["']/i)?.[1]
    if (value && /^20\d{2}-\d{2}-\d{2}(?:T|\s|$)/.test(value) && Number.isFinite(Date.parse(value))) { explicitDate = value; break }
  }
  // Publication fields in fetched publisher JSON are also explicit date observations.
  // They remain metadata: timezone/identity verification is still required for PIT evidence.
  if (!explicitDate) {
    const value = html.match(/"(?:datePublished|pubDate)"\s*:\s*"(20\d{2}-\d{2}-\d{2}(?:T[^"\\]*|\s[^"\\]*)?)"/i)?.[1]
    if (value && Number.isFinite(Date.parse(value))) explicitDate = value
  }
  const year = explicitDate ? Number(explicitDate.slice(0, 4)) : Number(title.match(/\b(20\d{2})年/)?.[1])
  const currentYear = new Date(retrievedAt).getUTCFullYear()
  if (!Number.isFinite(year) || year >= currentYear - 1) return explicitDate ? { observedPublicationDate: explicitDate } : {}
  return { ...(explicitDate ? { observedPublicationDate: explicitDate } : {}), historicalSourceContext: { observedYear: year, basis: explicitDate ? 'fetched_html_publication_meta' : 'explicit_title_year', caution: '历史资料仅用于对应时期的竞争结构；不能据此推断当前份额、排名或规模。' } }
}
function candidateResearchRank(candidate: ResearchSourceCandidate): number {
  // A sales title is a discovery hint, never a factual finding or a permanent source ban.
  if (/报告目录|订购|购买报告|全球与中国.*(?:研究报告|预测分析报告)|20\d{2}[-—至]20\d{2}.*(?:报告|市场)/.test(candidate.title)) return 20
  if (/股票行情|行情走势|最新价格|股吧|估值新的股价|价值洼地/.test(candidate.title)) return 10
  if (candidate.metadata?.cachedDiscovery === true) return 0
  if (/对比|比较|特色|竞争格局|竞争力|内忧外患|产品|技术|业务|创新|FPC|官方/.test(candidate.title)) return 0
  return candidate.metadata?.discoveryEngine === 'Sogou' ? 1 : 2
}
function isPaidResearchCatalog(text: string): boolean {
  const sales = /订购|购买报告|报告(?:价格|售价)|(?:完整|全文)报告.{0,20}(?:收费|购买|付费)|(?:图表略|内容部分有删减).{0,50}(?:官网|完整)|免费售后服务|咨询客服/.test(text)
  if (!sales) return false
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const catalogLine = (line: string) => /^(?:\d{1,2}(?:\.\d{1,2}){0,4}\s+|第[一二三四五六七八九十\d]+章\s*|(?:图|表|图表)\s*\d+\s*)/.test(line)
  const headings = lines.filter(catalogLine)
  if (headings.length < 12) return false
  // Long actual research prose remains usable even when the publisher also sells a report.
  // Numbered promised analyses, footer/navigation and ordering terms cannot count as prose.
  const narrative = lines.filter(line => !catalogLine(line) && line.length >= 80 && /[。；]/.test(line) && !/订购|购买报告|报告(?:价格|售价)|免费售后|咨询客服/.test(line))
  return narrative.length < 3 || narrative.reduce((sum, line) => sum + line.length, 0) < 600
}
function syntheticProxyAddress(address: string): boolean { const parts = address.split('.').map(Number); return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19) }
function xmlText(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() }
function publicAddress(address: string): boolean {
  if (address.includes(':')) return !/^(::|fc|fd|fe[89ab]|ff|2001:db8:)/i.test(address) && !address.toLowerCase().includes('ffff:')
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && ![0, 10, 127].includes(parts[0]!) && !(parts[0] === 169 && parts[1] === 254) && !(parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) && !(parts[0] === 192 && (parts[1] === 168 || parts[1] === 0)) && !(parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51)) && !(parts[0] === 203 && parts[1] === 0 && parts[2] === 113) && !(parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) && parts[0]! < 224
}
