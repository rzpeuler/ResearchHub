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
interface PeerSearchProfile {
  readonly aliases: readonly string[]
  readonly ticker?: string
  readonly productTerms: string
  /** Generic report/disclosure vocabulary, combined with each official domain below. */
  readonly annualReportTerms?: readonly string[]
  /** Issuer IR and exchange/regulator disclosure hosts used only to focus discovery. */
  readonly officialDomains?: readonly string[]
  /** Bounded, product-specific queries; still discovery only until the page body is fetched. */
  readonly productPageQueries?: readonly string[]
  /** Exact official product pages that SERPs may omit in favor of a brand homepage. */
  readonly productPageSeeds?: readonly { readonly title: string; readonly url: string }[]
}
interface CompanyResearchProfile {
  readonly aliases: readonly string[]
  readonly officialDomains: readonly string[]
  readonly curatedUrlSeeds: readonly { readonly label: string; readonly url: string; readonly scope: 'company' | 'industry_context'; readonly priority: 'core' | 'supplemental'; readonly topics?: readonly string[] }[]
  readonly focusQueries: readonly { readonly label: string; readonly query: string }[]
  readonly industryQueries: readonly { readonly label: string; readonly query: string; readonly topics: readonly string[] }[]
}
interface PeerDiagnostic { readonly peerCompanyName: string; readonly engine: string; readonly query: string; readonly stage: 'discovered' | 'identity-rejected' | 'fetched' | 'normalized' | 'rejected' | 'search-failed'; readonly candidateId?: string; readonly title?: string; readonly url?: string; readonly resultCount?: number; readonly reason?: string; readonly history?: readonly PeerDiagnostic[] }

// The workflow supplies canonical peer names. These bounded public identities add
// common legal names, tickers and English names to discovery without treating SERP
// text as evidence. Final identity verification always uses the fetched body.
const PEER_SEARCH_PROFILES: Readonly<Record<string, PeerSearchProfile>> = {
  '鹏鼎控股': { aliases: ['鹏鼎控股股份有限公司', 'Avary Holding'], ticker: '002938', productTerms: 'FPC 柔性电路板 产品 客户 产能 年报', annualReportTerms: ['年度报告 中期报告', '投资者关系 定期报告'], officialDomains: ['avaryholding.com', 'cninfo.com.cn'] },
  '中际旭创': { aliases: ['中际旭创股份有限公司', 'InnoLight'], ticker: '300308', productTerms: '光模块 800G 1.6T 产品 客户 产能 年报', annualReportTerms: ['年度报告 中期报告', '投资者关系 定期报告'], officialDomains: ['innolight.com', 'cninfo.com.cn'] },
  '吉利汽车': {
    aliases: ['Geely Automobile Holdings', 'Geely Auto', '吉利银河'],
    ticker: '0175.HK',
    productTerms: 'automobile sales new energy vehicles annual report',
    annualReportTerms: ['annual report interim report', 'investor relations filings'],
    officialDomains: ['geelyauto.com.hk', 'hkexnews.hk', 'geely.com'],
    productPageQueries: [
      'site:galaxy.geely.com/E8 吉利银河E8 车型 官方指导价 配置 参数',
      'site:galaxy.geely.com 吉利银河 新能源车型 售价 配置 官方车型',
    ],
    productPageSeeds: [
      { title: '吉利银河E8 官方车型与配置', url: 'https://galaxy.geely.com/E8' },
    ],
  },
  '特斯拉': { aliases: ['Tesla'], ticker: 'TSLA', productTerms: '汽车 产品 销量 年报', annualReportTerms: ['annual report quarterly report', 'investor relations filings'], officialDomains: ['ir.tesla.com', 'sec.gov'] },
  '宁德时代': { aliases: ['宁德时代新能源科技股份有限公司', 'CATL'], ticker: '300750', productTerms: '动力电池 装机量 市占率 产品 2025年报', annualReportTerms: ['2025年度报告 annual report', '投资者关系 定期报告'], officialDomains: ['catl.com', 'cninfo.com.cn'] },
}

// Focused, reproducible public discovery for issuers where broad SERPs tend to
// return only homepages. These queries nominate URLs only; fetched page bodies
// remain the sole evidence. Keep market context separately scoped so it cannot
// be mistaken for company-specific disclosure.
const COMPANY_RESEARCH_PROFILES: Readonly<Record<string, CompanyResearchProfile>> = {
  '002594': {
    aliases: ['比亚迪股份有限公司', 'BYD'],
    officialDomains: ['byd.com', 'bydglobal.com'],
    curatedUrlSeeds: [
      // These bounded first-party pages cover the portfolio, a dated model-level
      // price/specification example, and commercialization evidence. The workflow
      // still has to evaluate each fetched body; page presence is not a finding.
      { label: 'products_models', url: 'https://www.byd.com/cn/dynasty-home/models', scope: 'company', priority: 'core' },
      { label: 'model_price_launch', url: 'https://www.byd.com/cn/ocean-home/models/haibao/haibao-07-dm-i', scope: 'company', priority: 'core' },
      { label: 'sales_delivery', url: 'https://www.byd.com/cn/detail630', scope: 'company', priority: 'core' },
      { label: 'china_nev_market', url: 'https://www.miit.gov.cn/jgsj/zbys/qcgy/art/2026/art_4c5ed7009d21485da32b2a01abcf2819.html', scope: 'industry_context', priority: 'core', topics: ['新能源汽车', '产销'] },
      { label: 'technology', url: 'https://www.byd.com/cn/brand-center/leading-in-technology-markets', scope: 'company', priority: 'supplemental' },
      { label: 'global_ev_market', url: 'https://iea.blob.core.windows.net/assets/beae65ce-6b6d-4a8b-b67a-c591093756be/GEVO2026_LaunchWebinarSlides.pdf', scope: 'industry_context', priority: 'supplemental', topics: ['electric car', 'sales', 'China'] },
      { label: 'history_strategy', url: 'https://www.byd.com/en/about-byd', scope: 'company', priority: 'supplemental' },
    ],
    focusQueries: [
      { label: 'products_models', query: 'site:byd.com/cn/ 比亚迪 王朝 海洋 腾势 仰望 方程豹 车型列表 官方车型' },
      { label: 'vehicle_launch_pricing', query: 'site:byd.com/cn/news/ 比亚迪 新车型 上市 售价 预售 车型 官方' },
      { label: 'vehicle_sales_delivery', query: 'site:byd.com/cn/news/ 比亚迪 新能源汽车 销量 交付 海外 国内 车型' },
      { label: 'technology', query: 'site:byd.com/cn/ 比亚迪 刀片电池 e平台 技术创新 官方' },
      { label: 'commercialization', query: 'site:byd.com/cn/news/ 比亚迪 新能源汽车 销量 海外 产能' },
      { label: 'history_strategy', query: 'site:byd.com/en/about-byd BYD company history founded technology new energy vehicle' },
    ],
    industryQueries: [
      { label: 'china_nev_market', query: 'site:miit.gov.cn 2025年12月汽车工业经济运行情况 新能源汽车 产销', topics: ['新能源汽车', '产销'] },
      { label: 'global_ev_market', query: 'site:iea.org/reports/global-ev-outlook-2026 trends in electric cars 2025 sales 2026 outlook China', topics: ['electric car', 'sales', 'China'] },
    ],
  },
}

const INDUSTRY_CONTEXT_HOSTS = new Set(['caam.org.cn', 'iea.org', 'iea.blob.core.windows.net', 'cpcaauto.com', 'gov.cn', 'miit.gov.cn', 'stats.gov.cn'])
const PUBLIC_WEB_MAX_BYTES = 12_000_000
function isIndustryContextHost(hostname: string): boolean { return [...INDUSTRY_CONTEXT_HOSTS].some(domain => hostname === domain || hostname.endsWith(`.${domain}`)) }

function peerSearchProfile(name: string): PeerSearchProfile {
  return PEER_SEARCH_PROFILES[name] ?? { aliases: [], productTerms: '年报 产品 收入 客户 产能' }
}

function peerQueries(peerCompanyName: string, profile: PeerSearchProfile): readonly string[] {
  const identities = [...new Set([peerCompanyName, ...(profile.ticker ? [profile.ticker] : []), ...profile.aliases])].slice(0, 4)
  const identityQueries = identities.map(identity => `"${identity}" ${peerCompanyName === identity ? '' : `"${peerCompanyName}" `}${profile.productTerms}`)
  const primaryQueries = (profile.officialDomains ?? []).flatMap(domain =>
    (profile.annualReportTerms ?? ['annual report', 'interim report', 'filings investor relations']).map((reportTerms) =>
      `"${peerCompanyName}" ${profile.ticker ?? ''} ${reportTerms} site:${domain}`.replace(/\s+/g, ' ').trim(),
    ),
  )
  return [...new Set([...primaryQueries, ...identityQueries, ...(profile.productPageQueries ?? [])])]
}

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
    if (source.candidate.metadata?.researchSubject === 'peer_company') return
    if (source.candidate.metadata?.researchScope === 'industry_context') return
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
  private async download(raw: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; url: string; mediaType: string; contentType: string }> {
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
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > PUBLIC_WEB_MAX_BYTES) throw new Error('PUBLIC_WEB_BODY_TOO_LARGE')
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      if (reader) while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > PUBLIC_WEB_MAX_BYTES) { await reader.cancel(); throw new Error('PUBLIC_WEB_BODY_TOO_LARGE') }
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
      const contentType=response.headers.get('content-type') ?? 'text/html'
      return { bytes, url: checked.href, mediaType: contentType.split(';')[0]!, contentType }
    }
    throw new Error('PUBLIC_WEB_REDIRECT_LIMIT')
  }
  async discover(request: ResearchAcquisitionRequest, signal?: AbortSignal): Promise<readonly ResearchSourceCandidate[]> {
    if (!request.company || request.researchPurpose !== 'company_research') return []
    const company = request.company.name ?? request.company.symbol
    const companyProfile = COMPANY_RESEARCH_PROFILES[request.company.symbol]
    const requestedTerms = request.searchTerms?.length ? request.searchTerms : ['公司 产品 技术 主营业务', '行业 竞争对手 市场规模', '投资者关系 年报']
    const peerNames = [...new Set(requestedTerms.filter((term) => term.startsWith('peer:')).map((term) => term.slice('peer:'.length).trim()).filter(Boolean))].slice(0, 2)
    const terms = requestedTerms.filter((term) => !term.startsWith('peer:')).slice(0, Math.max(1, 4 - peerNames.length))
    const candidates = new Map<string, ResearchSourceCandidate>()
    const diagnostics: string[] = []
    const peerDiagnostics: PeerDiagnostic[] = []
    for (const peerCompanyName of peerNames) {
      const profile = peerSearchProfile(peerCompanyName)
      const peerIdentityTerms = [...new Set([peerCompanyName, ...profile.aliases, ...(profile.ticker ? [profile.ticker] : [])])]
      for (const seed of profile.productPageSeeds ?? []) {
        let hostname = ''
        try { hostname = new URL(seed.url).hostname.toLowerCase() } catch { continue }
        const trustedHost = (profile.officialDomains ?? []).some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
        if (!trustedHost || !seed.url.startsWith('https://')) continue
        candidates.set(seed.url, {
          candidateId: `public-web-${sha256(seed.url).slice(0, 16)}`,
          kind: 'web_article', tier: 3, title: seed.title, url: seed.url, provider: 'public-web',
          metadata: {
            companySymbol: request.company.symbol,
            companyName: request.company.name,
            researchSubject: 'peer_company',
            peerCompanyName,
            peerIdentityTerms,
            focusedPeerProduct: true,
            curatedPeerProductSeed: true,
            originalPublisher: hostname,
            discoveryQuery: `curated-peer-product:${peerCompanyName}`,
            discoveryEngine: 'curated-official-url',
            discoveryTerms: [`peer:${peerCompanyName}`],
            discoveredAt: this.now(),
          },
        })
      }
    }
    for (const [seedOrder, seed] of (companyProfile?.curatedUrlSeeds ?? []).entries()) {
      let hostname = ''
      try { hostname = new URL(seed.url).hostname.toLowerCase() } catch { continue }
      const companyHost = Boolean(companyProfile?.officialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))
      if ((seed.scope === 'company' && !companyHost) || (seed.scope === 'industry_context' && !isIndustryContextHost(hostname))) continue
      const candidateId = `public-web-${sha256(seed.url).slice(0, 16)}`
      candidates.set(seed.url, {
        candidateId, kind: 'web_article', tier: 3, title: `${company} ${seed.label} page`, url: seed.url, provider: 'public-web',
        metadata: { companySymbol: request.company.symbol, companyName: request.company.name, originalPublisher: hostname, researchScope: seed.scope, ...(seed.topics ? { contextTopics: seed.topics } : {}), ...(companyHost ? { officialCompanyHost: true } : {}), curatedUrlSeed: true, curatedSeedOrder: seedOrder, curatedSeedPriority: seed.priority, focusedResearchQuery: seed.label, discoveryTerms: [`focus:${seed.label}`], discoveredAt: this.now() },
      })
    }
    const addCandidate = (title: string, url: string, description: string, term: string, queryText: string, engine: string, peerCompanyName?: string, peerAliases: readonly string[] = [], scope: 'company' | 'industry_context' = 'company', contextTopics: readonly string[] = []) => {
      if (!title || !/^https:\/\//i.test(url)) return
      const candidateIdentity = `${title} ${url} ${description}`
      const matchedIdentity = peerCompanyName ? [peerCompanyName, ...peerAliases].find(identity => identity && candidateIdentity.toLocaleLowerCase().includes(identity.toLocaleLowerCase())) : undefined
      if (peerCompanyName && !matchedIdentity) {
        peerDiagnostics.push({ peerCompanyName, engine, query: queryText, stage: 'identity-rejected', title: title.slice(0, 300), url: url.slice(0, 1000), reason: 'SERP_TITLE_URL_DESCRIPTION_MISSING_PEER_IDENTITY' })
        return
      }
      let hostname = ''
      try { hostname = new URL(url).hostname.toLowerCase() } catch { return }
      const officialCompanyHost = Boolean(companyProfile?.officialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))
      if (!peerCompanyName && scope === 'company' && !candidateIdentity.includes(company) && !candidateIdentity.includes(request.company!.symbol) && !officialCompanyHost) return
      if (scope === 'industry_context') {
        const topicalMatch = contextTopics.filter(topic => candidateIdentity.toLocaleLowerCase().includes(topic.toLocaleLowerCase())).length
        if (!isIndustryContextHost(hostname) || topicalMatch < Math.min(1, contextTopics.length)) return
      }
      const previous = candidates.get(url)
      const discoveryTerms = [...new Set([...(previous?.metadata?.discoveryTerms as string[] | undefined ?? []), term])]
      const candidateId = `public-web-${sha256(url).slice(0, 16)}`
      const peerIdentityTerms = peerCompanyName ? [...new Set([peerCompanyName, ...peerAliases])] : undefined
      const peerProfile = peerCompanyName ? peerSearchProfile(peerCompanyName) : undefined
      const focusedPeerProduct = Boolean(peerProfile?.productPageQueries?.includes(queryText))
      const candidatePeerDiagnostics = peerCompanyName ? [
        ...(previous?.metadata?.peerAcquisitionDiagnostics as PeerDiagnostic[] | undefined ?? []),
        { peerCompanyName, engine, query: queryText, stage: 'discovered' as const, candidateId, title: title.slice(0, 300), url: url.slice(0, 1000), resultCount: 1 },
      ] : undefined
      candidates.set(url, { candidateId, kind: 'web_article', tier: 3, title, url, provider: 'public-web', metadata: { ...previous?.metadata, companySymbol: request.company!.symbol, companyName: request.company!.name, ...(peerCompanyName ? { researchSubject: 'peer_company', peerCompanyName, peerIdentityTerms, ...(focusedPeerProduct || previous?.metadata?.focusedPeerProduct === true ? { focusedPeerProduct: true } : {}), peerAcquisitionDiagnostics: candidatePeerDiagnostics } : {}), ...(scope === 'industry_context' ? { researchScope: scope, contextTopics } : {}), ...(officialCompanyHost ? { officialCompanyHost: true } : {}), originalPublisher: hostname, discoveryQuery: queryText, discoveryEngine: engine, discoveryTerms, ...(term.startsWith('focus:') ? { focusedResearchQuery: term.slice('focus:'.length) } : {}), discoveredAt: this.now() } })
    }
    const queries: { term: string; text: string; peerCompanyName?: string; peerAliases?: readonly string[] }[] = terms.flatMap((term) => [
      { term, text: `"${company}" ${term.slice(0, 120)}` },
      { term, text: `"${company}" ${request.company!.symbol} ${term.slice(0, 120)}` },
    ])
    for (const peerCompanyName of peerNames) {
      const profile = peerSearchProfile(peerCompanyName)
      const peerAliases = [...new Set([peerCompanyName, ...profile.aliases, ...(profile.ticker ? [profile.ticker] : [])])]
      for (const text of peerQueries(peerCompanyName, profile)) queries.push({ term: `peer:${peerCompanyName}`, text, peerCompanyName, peerAliases })
    }
    for (const focus of companyProfile?.focusQueries ?? []) queries.push({ term: `focus:${focus.label}`, text: focus.query })
    const industryQueries = (companyProfile?.industryQueries ?? []).map((entry) => ({ term: `focus:${entry.label}`, text: entry.query, scope: 'industry_context' as const, contextTopics: entry.topics }))
    for (const entry of industryQueries) queries.push({ term: entry.term, text: entry.text })
    const searchResults = await Promise.all(queries.map(async ({ term, text: queryText, peerCompanyName, peerAliases }) => {
      if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      try {
        const query = new URL('https://www.bing.com/search')
        query.searchParams.set('q', queryText)
        query.searchParams.set('format', 'rss')
        const body = await acquisitionStep({ activityId: `public-web:search:${sha256(queryText).slice(0, 8)}`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 12_000 }, (requestSignal) => this.download(query.href, requestSignal))
        return { term, queryText, peerCompanyName, peerAliases, xml: new TextDecoder().decode(body.bytes), error: undefined }
      } catch (error) { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); return { term, queryText, peerCompanyName, peerAliases, xml: '', error: String(error) } }
    }))
    for (const { term, queryText, peerCompanyName, peerAliases, xml, error } of searchResults) {
      if (error) {
        diagnostics.push(error)
        if (peerCompanyName) peerDiagnostics.push({ peerCompanyName, engine: 'Bing', query: queryText, stage: 'search-failed', reason: error.slice(0, 500) })
        continue
      }
      let resultCount = 0
        for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
          resultCount += 1
          const title = xmlText(item[1]!.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
          const url = xmlText(item[1]!.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? '')
          const description = xmlText(item[1]!.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '').replace(/<[^>]*>/g, ' ')
          // Broad Chinese search can split a company name into an unrelated geographic term.
          // Discovery snippets may identify a candidate; they never become report evidence.
          const focusedCompanyQuery = (companyProfile?.focusQueries ?? []).some(focus => term === `focus:${focus.label}`)
          if (focusedCompanyQuery) {
            let hostname = ''
            try { hostname = new URL(url).hostname.toLowerCase() } catch { continue }
            if (!companyProfile?.officialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) continue
          }
          const industry = industryQueries.find(entry => entry.term === term && entry.text === queryText)
          addCandidate(title, url, description, term, queryText, 'Bing', peerCompanyName, peerAliases, industry ? 'industry_context' : 'company', industry?.contextTopics)
        }
      if (peerCompanyName) peerDiagnostics.push({ peerCompanyName, engine: 'Bing', query: queryText, stage: 'discovered', resultCount })
    }
    // Free public fallback for industry/competition: quote-heavy or off-topic RSS cannot
    // displace actual article candidates. Search snippets still remain discovery-only.
    const fallbackTerms = [...new Set(terms.filter((term) => /行业|竞争|市场|industry|competi/i.test(term)))].slice(0, 2)
    // Gap retries often pass atomic terms ("竞争", "份额", "优势") and can
    // otherwise spend both public-search slots on near-duplicate broad queries.
    // Reserve one bounded slot for sourced competitor/product/customer evidence;
    // only fetched page bodies can later enter a research packet.
    if (fallbackTerms.some((term) => /竞争|competi/i.test(term))) {
      const targeted = '竞争对手 产品 应用 客户 技术 成本 对比'
      if (!fallbackTerms.includes(targeted)) fallbackTerms.unshift(targeted)
      fallbackTerms.length = Math.min(fallbackTerms.length, 2)
    } else if (fallbackTerms.length === 1 && !fallbackTerms[0]!.includes('竞争对手 产品 应用')) fallbackTerms.push('竞争对手 产品 应用')
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
    // A second public search engine is a bounded fallback for named peers.
    // Search snippets only nominate candidates; normalize() still requires
    // the fetched article body to contain the exact peer identity.
    const peerFallbackQueries = peerNames.flatMap(peerCompanyName => {
      const profile = peerSearchProfile(peerCompanyName)
      const peerAliases = [...new Set([peerCompanyName, ...profile.aliases, ...(profile.ticker ? [profile.ticker] : [])])]
      return peerQueries(peerCompanyName, profile).map(queryText => ({ peerCompanyName, peerAliases, term: `peer:${peerCompanyName}`, queryText }))
    })
    const peerFallbackResults = await Promise.all(peerFallbackQueries.map(async ({ peerCompanyName, peerAliases, term, queryText }) => {
      try {
        const endpoint = new URL('https://www.sogou.com/web')
        endpoint.searchParams.set('query', queryText)
        const body = await acquisitionStep({ activityId: `public-web:sogou-peer:${sha256(queryText).slice(0, 8)}`, providerId: 'public-web', step: 'discovery', signal, timeoutMs: 12_000 }, (requestSignal) => this.download(endpoint.href, requestSignal))
        return { peerCompanyName, peerAliases, term, queryText, html: new TextDecoder().decode(body.bytes), error: undefined }
      } catch (error) { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED'); return { peerCompanyName, peerAliases, term, queryText, html: '', error: String(error) } }
    }))
    for (const { peerCompanyName, peerAliases, term, queryText, html, error } of peerFallbackResults) {
      if (error) {
        diagnostics.push(error)
        peerDiagnostics.push({ peerCompanyName, engine: 'Sogou', query: queryText, stage: 'search-failed', reason: error.slice(0, 500) })
        continue
      }
      let resultCount = 0
      for (const result of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
        resultCount += 1
        const href = result[1]!.match(/href=["']([^"']+)["']/)?.[1]
        if (!href) continue
        try {
          const title = xmlText(result[1]!.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
          const description = xmlText(html.slice(result.index! + result[0].length, result.index! + result[0].length + 2200).split(/<h3\b/i)[0]!.replace(/<[^>]*>/g, ' '))
          addCandidate(title, new URL(xmlText(href), 'https://www.sogou.com').href, description, term, queryText, 'Sogou', peerCompanyName, peerAliases)
        } catch (error) { peerDiagnostics.push({ peerCompanyName, engine: 'Sogou', query: queryText, stage: 'identity-rejected', title: xmlText(result[1]!.replace(/<[^>]*>/g, '')).slice(0, 300), reason: `INVALID_SEARCH_RESULT_URL:${String(error).slice(0, 200)}` }) }
      }
      peerDiagnostics.push({ peerCompanyName, engine: 'Sogou', query: queryText, stage: 'discovered', resultCount })
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
    const peerCandidates = all.filter(candidate => candidate.metadata?.researchSubject === 'peer_company')
    const peerCoverage = peerNames.flatMap(name => peerCandidates.find(candidate => candidate.metadata?.peerCompanyName === name) ?? [])
    const peerCoverageIds = new Set(peerCoverage.map(candidate => candidate.candidateId))
    const curatedCandidates = all.filter(candidate => candidate.metadata?.curatedUrlSeed === true).sort((a, b) => Number(a.metadata?.curatedSeedOrder) - Number(b.metadata?.curatedSeedOrder))
    const coreCuratedCandidates = curatedCandidates.filter(candidate => candidate.metadata?.curatedSeedPriority === 'core')
    const supplementalCuratedCandidates = curatedCandidates.filter(candidate => candidate.metadata?.curatedSeedPriority !== 'core')
    const focusedCandidates = all.filter(candidate => candidate.metadata?.curatedUrlSeed !== true && typeof candidate.metadata?.focusedResearchQuery === 'string')
    const focusedByQuery = new Map<string, ResearchSourceCandidate>()
    for (const candidate of focusedCandidates) {
      const label = String(candidate.metadata?.focusedResearchQuery)
      if (!focusedByQuery.has(label)) focusedByQuery.set(label, candidate)
    }
    const focusedFirst = [...focusedByQuery.values()]
    const focusedRemainder = focusedCandidates.filter(candidate => !focusedFirst.includes(candidate))
    // Keep the capped evidence mix useful for company research: portfolio/model
    // evidence, a dated model price, company sales/launch disclosure and market
    // context are curated first; named peers retain their own slots. At larger
    // budgets, focused catalogue/launch/delivery results precede general context.
    const companyProductLabels = new Set(['products_models', 'vehicle_launch_pricing', 'vehicle_sales_delivery'])
    const focusedProductCandidates = focusedFirst.filter(candidate => companyProductLabels.has(String(candidate.metadata?.focusedResearchQuery ?? '')))
    const otherFocusedCandidates = focusedFirst.filter(candidate => !focusedProductCandidates.includes(candidate))
    const ordered = [...coreCuratedCandidates, ...peerCoverage, ...peerCandidates.filter(candidate => !peerCoverageIds.has(candidate.candidateId)), ...focusedProductCandidates, ...supplementalCuratedCandidates, ...otherFocusedCandidates, ...diverse, ...focusedRemainder, ...directoryPages.slice(0, 2), ...all.filter(candidate => candidate.metadata?.cachedDiscovery === true), ...directoryPages.slice(2), ...all]
    const unique = new Set<string>()
    const selectedCandidates = ordered.filter(candidate => { if (unique.has(candidate.candidateId)) return false; unique.add(candidate.candidateId); return true }).slice(0, Math.min(request.limitPerKind ?? 6, 20))
    if (!selectedCandidates.length && peerNames.length) throw new Error(`PUBLIC_WEB_PEER_DISCOVERY_EMPTY:${JSON.stringify(peerDiagnostics.slice(0, 100))}`)
    return selectedCandidates.map(candidate => {
      const peerName = candidate.metadata?.researchSubject === 'peer_company' && typeof candidate.metadata.peerCompanyName === 'string' ? candidate.metadata.peerCompanyName : undefined
      const audit = peerName ? peerDiagnostics.filter(item => item.peerCompanyName === peerName) : peerDiagnostics
      return { ...candidate, metadata: { ...candidate.metadata, peerAcquisitionDiagnostics: [...((candidate.metadata?.peerAcquisitionDiagnostics as PeerDiagnostic[] | undefined) ?? []), ...audit].slice(0, 100) } }
    })
  }
  async fetch(candidate: ResearchSourceCandidate, signal?: AbortSignal, options?: ResearchFetchOptions): Promise<ResearchFetchedSource> {
    if (!candidate.url) throw new Error('PUBLIC_WEB_URL_REQUIRED')
    try {
      const downloaded = await acquisitionStep({ activityId: `${candidate.candidateId}:download`, providerId: 'public-web', step: 'download', sourceTitle: candidate.title, signal, timeoutMs: options?.downloadTimeoutMs ?? 30_000, deadlineAt: options?.deadlineAt, onProgress: options?.onProgress }, (requestSignal) => this.download(candidate.url!, requestSignal))
      const peerCandidate = candidate.metadata?.researchSubject === 'peer_company'
      const fetchedCandidate = peerCandidate ? withPeerDiagnostic({ ...candidate, url: downloaded.url }, { peerCompanyName: String(candidate.metadata?.peerCompanyName ?? ''), engine: String(candidate.metadata?.discoveryEngine ?? 'unknown'), query: String(candidate.metadata?.discoveryQuery ?? ''), stage: 'fetched', candidateId: candidate.candidateId, title: candidate.title.slice(0, 300), url: downloaded.url.slice(0, 1000) }) : { ...candidate, url: downloaded.url }
      return { candidate: fetchedCandidate, retrievedAt: this.now(), content: downloaded.mediaType.includes('html') ? decodeCompanyPublicHtml(downloaded.bytes,downloaded.contentType) : new TextDecoder().decode(downloaded.bytes), rawBytes: downloaded.bytes, mediaType: downloaded.mediaType }
    } catch (error) {
      if (candidate.metadata?.researchSubject !== 'peer_company' || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw error
      throw peerStageError(candidate, 'rejected', error)
    }
  }
  async normalize(source: ResearchFetchedSource, signal?: AbortSignal): Promise<NormalizedResearchSource> {
    const bytes = source.rawBytes ?? new TextEncoder().encode(source.content)
    const mediaType = source.mediaType ?? 'text/html'
    const peerCandidate = source.candidate.metadata?.researchSubject === 'peer_company'
    let document: Awaited<ReturnType<DocumentInputResolver['parse']>>
    try { document = await this.resolver.parse({ bytes: mediaType.includes('html') ? new TextEncoder().encode(source.content) : bytes, filename: mediaType.includes('pdf') ? 'company-public.pdf' : 'company-public.html', mediaType }, signal ? { signal } : undefined) }
    catch (error) { if (peerCandidate && !(error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw peerStageError(source.candidate, 'rejected', error); throw error }
    if (document.normalizedText.trim().length < 120) throw peerCandidate ? peerStageError(source.candidate, 'rejected', new Error('PUBLIC_WEB_BODY_INSUFFICIENT')) : new Error('PUBLIC_WEB_BODY_INSUFFICIENT')
    if (isPaidResearchCatalog(document.normalizedText)) throw peerCandidate ? peerStageError(source.candidate, 'rejected', new Error('PUBLIC_WEB_PAID_RESEARCH_CATALOG_NO_SUBSTANTIVE_BODY')) : new Error('PUBLIC_WEB_PAID_RESEARCH_CATALOG_NO_SUBSTANTIVE_BODY')
    const companyName = source.candidate.metadata?.companyName
    const companySymbol = source.candidate.metadata?.companySymbol
    const peerCompanyName = peerCandidate ? source.candidate.metadata?.peerCompanyName : undefined
    const researchScope = source.candidate.metadata?.researchScope
    if (researchScope === 'industry_context') {
      let hostname = ''
      try { hostname = new URL(source.candidate.url ?? '').hostname.toLowerCase() } catch { throw new Error('PUBLIC_WEB_INDUSTRY_CONTEXT_HOST_INVALID') }
      const topics = Array.isArray(source.candidate.metadata?.contextTopics) ? source.candidate.metadata.contextTopics.filter((topic): topic is string => typeof topic === 'string' && topic.length > 1) : []
      const matchedTopics = topics.filter(topic => document.normalizedText.toLocaleLowerCase().includes(topic.toLocaleLowerCase())).length
      if (!isIndustryContextHost(hostname) || topics.length < 2 || matchedTopics < Math.min(2, topics.length)) throw new Error('PUBLIC_WEB_INDUSTRY_CONTEXT_BODY_MISMATCH')
    } else if (typeof peerCompanyName === 'string' && peerCompanyName) {
      const identityTerms = Array.isArray(source.candidate.metadata?.peerIdentityTerms) ? source.candidate.metadata.peerIdentityTerms.filter((term): term is string => typeof term === 'string' && term.length > 1) : [peerCompanyName]
      if (!identityTerms.some(identity => document.normalizedText.toLocaleLowerCase().includes(identity.toLocaleLowerCase()))) throw peerStageError(source.candidate, 'rejected', new Error('PUBLIC_WEB_BODY_PEER_MISMATCH'))
    } else if (typeof companyName === 'string' && companyName && !document.normalizedText.includes(companyName) && !(typeof companySymbol === 'string' && companySymbol && document.normalizedText.includes(companySymbol)) && !(companyProfileIdentityTerms(companySymbol).some(identity => document.normalizedText.toLocaleLowerCase().includes(identity.toLocaleLowerCase())))) throw new Error('PUBLIC_WEB_BODY_COMPANY_MISMATCH')
    // Search-result dates are intentionally not treated as publication dates.
    const contentHash = sha256(document.normalizedText)
    const focusedPeerProduct = source.candidate.metadata?.focusedPeerProduct === true
      && hasPeerProductBodyEvidence(document.normalizedText, source.candidate.title)
    let candidate: ResearchSourceCandidate = { ...source.candidate, metadata: { ...source.candidate.metadata, ...(source.candidate.metadata?.focusedPeerProduct === true && !focusedPeerProduct ? { focusedPeerProduct: undefined } : {}), ...historicalContext(source.candidate.title, source.content, source.retrievedAt) } }
    if (peerCandidate) candidate = withPeerDiagnostic(candidate, { peerCompanyName: String(peerCompanyName ?? ''), engine: String(source.candidate.metadata?.discoveryEngine ?? 'unknown'), query: String(source.candidate.metadata?.discoveryQuery ?? ''), stage: 'normalized', candidateId: source.candidate.candidateId, title: source.candidate.title.slice(0, 300), url: (source.candidate.url ?? '').slice(0, 1000) })
    try { await this.cacheNormalizedCandidate(source, contentHash) } catch { candidate = { ...candidate, metadata: { ...candidate.metadata, candidateCacheDiagnostic: 'PUBLIC_WEB_CANDIDATE_CACHE_WRITE_FAILED' } } }
    return { candidate, title: source.candidate.title, retrievedAt: source.retrievedAt, content: document.normalizedText, canonicalUrl: source.candidate.url, contentHash, rawBytes: bytes, mediaType, publisher: new URL(source.candidate.url!).hostname,
      rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } }
  }
}
function companyProfileIdentityTerms(symbol: unknown): readonly string[] {
  return typeof symbol === 'string' ? COMPANY_RESEARCH_PROFILES[symbol]?.aliases ?? [] : []
}
function withPeerDiagnostic(candidate: ResearchSourceCandidate, diagnostic: PeerDiagnostic): ResearchSourceCandidate {
  const current = Array.isArray(candidate.metadata?.peerAcquisitionDiagnostics) ? candidate.metadata.peerAcquisitionDiagnostics as PeerDiagnostic[] : []
  return { ...candidate, metadata: { ...candidate.metadata, peerAcquisitionDiagnostics: [...current, diagnostic].slice(0, 100) } }
}
function peerStageError(candidate: ResearchSourceCandidate, stage: 'rejected', error: unknown): Error {
  const history = Array.isArray(candidate.metadata?.peerAcquisitionDiagnostics) ? (candidate.metadata.peerAcquisitionDiagnostics as PeerDiagnostic[]).slice(-20) : []
  const diagnostic: PeerDiagnostic = { peerCompanyName: String(candidate.metadata?.peerCompanyName ?? ''), engine: String(candidate.metadata?.discoveryEngine ?? 'unknown'), query: String(candidate.metadata?.discoveryQuery ?? ''), stage, candidateId: candidate.candidateId, title: candidate.title.slice(0, 300), url: (candidate.url ?? '').slice(0, 1000), reason: (error instanceof Error ? error.message : String(error)).slice(0, 500), history }
  return new Error(`PUBLIC_WEB_PEER_ACQUISITION_DIAGNOSTIC:${JSON.stringify(diagnostic)}`)
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
  if (candidate.metadata?.researchSubject === 'peer_company' && candidate.metadata?.focusedPeerProduct === true && isConfiguredOfficialPeerHost(candidate)) return -1
  if (candidate.metadata?.researchSubject === 'peer_company' && isConfiguredOfficialPeerHost(candidate)) return 0
  if (candidate.metadata?.cachedDiscovery === true) return 0
  if (/对比|比较|特色|竞争格局|竞争力|内忧外患|产品|技术|业务|创新|FPC|官方/.test(candidate.title)) return 0
  return candidate.metadata?.discoveryEngine === 'Sogou' ? 1 : 2
}
function isConfiguredOfficialPeerHost(candidate: ResearchSourceCandidate): boolean {
  const peerName = candidate.metadata?.peerCompanyName
  if (typeof peerName !== 'string' || !candidate.url) return false
  let hostname: string
  try { hostname = new URL(candidate.url).hostname.toLowerCase() } catch { return false }
  return (peerSearchProfile(peerName).officialDomains ?? []).some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}
function hasPeerProductBodyEvidence(text: string, title: string): boolean {
  const modelTerms = [...title.matchAll(/(?:银河s*)?E8|Galaxy\s*E8/gi)].map(match => match[0])
  if (!modelTerms.length) return false
  const paragraphs = text.split(/\r?\n/).map(row => row.trim()).filter(Boolean)
  const modelRows = paragraphs.flatMap((row, index) => /(?:银河\s*E8|Galaxy\s*E8)/i.test(row) ? [index] : [])
  return modelRows.some(index => paragraphs.slice(Math.max(0, index - 1), Math.min(paragraphs.length, index + 5)).join(' ').length > 0
    && /(?:指导价|售价|价格|纯电续航|续航里程|CLTC|配置|参数|\bkWh\b|\bkm\b)/i.test(paragraphs.slice(Math.max(0, index - 1), Math.min(paragraphs.length, index + 5)).join(' ')))
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


/** Decode HTML for parsing while original downloaded bytes remain the Raw provenance. */
export function decodeCompanyPublicHtml(bytes: Uint8Array, contentType: string): string {
  const header = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0,8192))
  let meta: string | undefined
  for (const tag of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    // Consume complete attribute values, so a description mentioning "charset=gbk"
    // cannot become an encoding declaration for an otherwise UTF-8 page.
    const attributes = new Map([...tag[0].matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)].map(attribute => [attribute[1]!.toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '']))
    meta = attributes.get('charset')?.trim() || ((attributes.get('http-equiv') ?? '').trim().toLowerCase() === 'content-type' ? /charset\s*=\s*["']?([^;\s"']+)/i.exec(attributes.get('content') ?? '')?.[1] : undefined)
    if (meta) break
  }
  const declared=(header ?? meta ?? 'utf-8').toLowerCase()
  const encoding=({utf8:'utf-8','utf-8':'utf-8',gbk:'gb18030',gb2312:'gb18030',gb18030:'gb18030'} as Record<string,string>)[declared]
  if(!encoding) throw new Error(`PUBLIC_WEB_UNSUPPORTED_CHARSET:${declared.slice(0,40)}`)
  try { return new TextDecoder(encoding,{fatal:true}).decode(bytes) }
  catch { throw new Error(`PUBLIC_WEB_INVALID_TEXT_ENCODING:${encoding}`) }
}
