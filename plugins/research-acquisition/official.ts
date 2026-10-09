import type { ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchCompanyIdentity, ResearchFetchedSource, ResearchSourceCandidate, NormalizedResearchSource } from './contracts.ts'
import { sha256 } from './hash.ts'
import { DocumentInputResolver } from '../document/input-resolver.ts'

const CNINFO_TOP_SEARCH_ENDPOINT = 'https://www.cninfo.com.cn/new/information/topSearch/query'
const MAX_MANAGEMENT_COMMUNICATION_PAGES = 10
const MAX_MANAGEMENT_COMMUNICATION_PAGE_SIZE = 30
const MAX_ANNUAL_REPORT_PAGES = 6
const MAX_ANNUAL_REPORT_PAGE_SIZE = 30
const CNINFO_ANNUAL_REPORT_CATEGORY = 'category_ndbg_szsh'

export interface OfficialDisclosureRecord { readonly title: string; readonly url: string; readonly publishedAt: string; readonly rawPublishedAt?: string; readonly announcementId?: string; readonly issuer?: string; readonly correctionOf?: string; readonly content?: string }
export interface OfficialDisclosureDocument { readonly content: string; readonly bytes: Uint8Array; readonly mediaType: string }
export interface AnnualReportPublicationRequest { readonly company: ResearchCompanyIdentity; readonly fiscalYear: number; readonly asOf?: string }
export interface AnnualReportPublicationProof { readonly issuer: string; readonly fiscalYear: number; readonly reportTitle: string; readonly officialPublishedAt: string; readonly rawPublishedAt: string; readonly sourceUrl: string; readonly announcementId?: string; readonly originPublisher: 'CNINFO'; readonly originAuthority: 'S0_STATUTORY'; readonly retrievalProvider: 'CNINFO'; readonly retrievedAt: string }
export interface OfficialDisclosureClient { list(request: ResearchAcquisitionRequest): Promise<readonly OfficialDisclosureRecord[]>; listManagementCommunication?(request: { readonly company: ResearchCompanyIdentity; readonly lookbackStartDate: string; readonly asOf: string }): Promise<readonly OfficialDisclosureRecord[]>; listIndustry?(request: Extract<ResearchAcquisitionRequest, { industry: unknown }>): Promise<readonly OfficialDisclosureRecord[]>; resolveAnnualReportPublication?(request: AnnualReportPublicationRequest): Promise<AnnualReportPublicationProof | undefined>; fetch(record: OfficialDisclosureRecord): Promise<string>; fetchDocument?(record: OfficialDisclosureRecord): Promise<OfficialDisclosureDocument> }
export interface CninfoOfficialDisclosureClientOptions { readonly fetchImpl?: typeof fetch; readonly endpoint?: string; readonly pageSize?: number; readonly industryPageSize?: number; readonly timeoutMs?: number; readonly now?: () => string; readonly documentResolver?: Pick<DocumentInputResolver, 'parse'> }
export class CninfoOfficialDisclosureClient implements OfficialDisclosureClient {
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly pageSize: number
  private readonly managementCommunicationPageSize: number
  private readonly industryPageSize: number
  private readonly timeoutMs: number
  private readonly now: () => string
  private readonly documentResolver: Pick<DocumentInputResolver, 'parse'>
  constructor(options: CninfoOfficialDisclosureClientOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; this.endpoint = options.endpoint ?? 'https://www.cninfo.com.cn/new/hisAnnouncement/query'; this.pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20)); this.managementCommunicationPageSize = Math.min(MAX_MANAGEMENT_COMMUNICATION_PAGE_SIZE, this.pageSize); this.industryPageSize = Math.min(30, Math.max(1, options.industryPageSize ?? 10)); this.timeoutMs = Math.min(20_000, Math.max(1, options.timeoutMs ?? 15_000)); this.now = options.now ?? (() => new Date().toISOString()); this.documentResolver = options.documentResolver ?? new DocumentInputResolver() }
  private async request(input: string, init: RequestInit = {}): Promise<Response> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); try { return await this.fetchImpl(input, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) } }
  private static record(row: unknown): OfficialDisclosureRecord | undefined { if (!row || typeof row !== 'object') return undefined; const value = row as Record<string, unknown>; const title = typeof value.announcementTitle === 'string' ? value.announcementTitle.replace(/<[^>]+>/g, '').trim() : typeof value.title === 'string' ? value.title.trim() : ''; const adjunctUrl = typeof value.adjunctUrl === 'string' ? value.adjunctUrl : ''; const url = adjunctUrl.startsWith('http') ? adjunctUrl : adjunctUrl ? `https://static.cninfo.com.cn/${adjunctUrl.replace(/^\/+/, '')}` : ''; const rawValue = value.announcementTime; const rawDate = typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''; let date: Date | undefined; if (typeof rawValue === 'number' || (typeof rawValue === 'string' && /^\d{10,13}$/.test(rawValue))) { const timestamp = Number(rawValue); if (Number.isFinite(timestamp)) date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp) } else if (typeof rawValue === 'string' && !Number.isNaN(Date.parse(rawValue))) date = new Date(rawValue); const parsedDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : ''; const announcementId = textValue(value.announcementId) ?? textValue(value.id) ?? textValue(value.adjunctId); const correctionOf = textValue(value.correctionOf) ?? textValue(value.correctsAnnouncementId); if (!title || !url || !parsedDate || !validCninfoUrl(url)) return undefined; return { title, url, publishedAt: parsedDate, rawPublishedAt: rawDate || parsedDate, ...(announcementId === undefined ? {} : { announcementId }), issuer: typeof value.secName === 'string' ? value.secName : undefined, ...(correctionOf === undefined ? {} : { correctionOf }) } }
  async resolveOrganizationId(secCode: string): Promise<string> {
    if (!/^\d{6}$/.test(secCode)) throw new Error(`CNINFO_INVALID_SECURITY_CODE:${secCode}`)
    const form = new URLSearchParams({ keyWord: secCode, maxNum: '10' })
    const response = await this.request(CNINFO_TOP_SEARCH_ENDPOINT, { method: 'POST', headers: cninfoHeaders(), body: form })
    if (!response.ok) throw new Error(`CNINFO topSearch request failed with HTTP ${response.status}`)
    const payload = await response.json() as unknown
    const rows = Array.isArray(payload) ? payload : []
    const exact = rows.find((row) => isExactSecurityMatch(row, secCode))
    const orgId = exact === undefined ? undefined : textValue((exact as Record<string, unknown>).orgId)
    if (orgId === undefined) throw new Error(`CNINFO_ORG_ID_NOT_FOUND:${secCode}`)
    return orgId
  }
  async list(request: ResearchAcquisitionRequest): Promise<readonly OfficialDisclosureRecord[]> {
    if ('industry' in request) return []
    const exchange = request.company.exchange?.toLowerCase(); const column = exchange === 'sse' || exchange === 'szse' ? exchange : request.company.symbol.startsWith('6') ? 'sse' : 'szse'
    const stock = await this.companyStock(request.company.symbol)
    if (request.filingPeriod !== undefined && request.asOf !== undefined) {
      const { fiscalYear, fiscalPeriod } = request.filingPeriod
      const asOfDate = cninfoShanghaiCalendarDate(request.asOf)
      const monthRange: Readonly<Record<typeof fiscalPeriod, readonly [string, string]>> = {
        Q1: [`${fiscalYear}-04-01`, asOfDate],
        H1: [`${fiscalYear}-07-01`, asOfDate],
        Q3: [`${fiscalYear}-10-01`, asOfDate],
        FY: [`${fiscalYear + 1}-01-01`, asOfDate],
      }
      const [periodStart, rawEnd] = monthRange[fiscalPeriod]
      const periodEnd = rawEnd < periodStart ? periodStart : rawEnd
      const reportTitle = fiscalPeriod === 'FY' ? '年度报告' : fiscalPeriod === 'H1' ? '半年度报告' : fiscalPeriod === 'Q1' ? '第一季度报告' : '第三季度报告'
      const periodSearch = `${fiscalYear}年${reportTitle}`
      const targeted = await this.queryAnnouncements({ stock, searchkey: periodSearch, pageNum: '1', pageSize: String(this.pageSize), tabName: 'fulltext', column, seDate: `${periodStart}~${periodEnd}` }, request.asOf, 4)
      if (targeted.length > 0) return targeted
    }
    const exact = await this.queryAnnouncements({ stock, searchkey: '', pageNum: '1', pageSize: String(this.pageSize), tabName: 'fulltext', column }, request.asOf)
    if (exact.length > 0 || !request.company.name) return exact
    return this.queryAnnouncements({ stock, searchkey: request.company.name, pageNum: '1', pageSize: String(this.pageSize), tabName: 'fulltext', column }, request.asOf)
  }
  async listManagementCommunication(request: { readonly company: ResearchCompanyIdentity; readonly lookbackStartDate: string; readonly asOf: string }): Promise<readonly OfficialDisclosureRecord[]> {
    const exchange = request.company.exchange?.toLowerCase(); const column = exchange === 'sse' || exchange === 'szse' ? exchange : request.company.symbol.startsWith('6') ? 'sse' : 'szse'
    const stock = await this.companyStock(request.company.symbol)
    const seDate = `${cninfoShanghaiCalendarDate(request.lookbackStartDate)}~${cninfoShanghaiCalendarDate(request.asOf)}`
    const terms = ['投资者关系活动记录', '业绩说明会召开情况', '业绩说明会活动记录', '业绩说明会投资者问答']
    const records = new Map<string, OfficialDisclosureRecord>()
    for (const searchkey of terms) {
      const matches = await this.queryAnnouncements({ stock, searchkey, pageNum: '1', pageSize: String(this.managementCommunicationPageSize), tabName: 'fulltext', column, seDate }, request.asOf, MAX_MANAGEMENT_COMMUNICATION_PAGES)
      for (const record of matches) records.set(record.url, record)
    }
    return [...records.values()].sort((left, right) => left.publishedAt.localeCompare(right.publishedAt) || left.url.localeCompare(right.url))
  }
  private async companyStock(secCode: string): Promise<string> {
    return `${secCode},${await this.resolveOrganizationId(secCode)}`
  }
  async resolveAnnualReportPublication(request: AnnualReportPublicationRequest): Promise<AnnualReportPublicationProof | undefined> {
    if (!Number.isInteger(request.fiscalYear) || request.fiscalYear < 1990 || request.fiscalYear > 2100) throw new Error('CNINFO_INVALID_FISCAL_YEAR')
    const exchange = request.company.exchange?.toLowerCase(); const column = exchange === 'sse' || exchange === 'szse' ? exchange : request.company.symbol.startsWith('6') ? 'sse' : 'szse'
    const plate = column === 'sse' ? 'sh' : request.company.symbol.startsWith('300') ? 'szcy' : 'sz'
    const startDate = `${request.fiscalYear + 1}-01-01`
    const requestedEnd = request.asOf === undefined ? `${request.fiscalYear + 2}-12-31` : cninfoShanghaiCalendarDate(request.asOf)
    const endDate = requestedEnd < startDate ? startDate : requestedEnd > `${request.fiscalYear + 2}-12-31` ? `${request.fiscalYear + 2}-12-31` : requestedEnd
    const records = await this.queryAnnouncements({ pageNum: '1', pageSize: String(MAX_ANNUAL_REPORT_PAGE_SIZE), column, plate, stock: await this.companyStock(request.company.symbol), searchkey: '', secid: '', category: CNINFO_ANNUAL_REPORT_CATEGORY, trade: '', seDate: `${startDate}~${endDate}`, sortName: '', sortType: '', isHLtitle: 'true', tabName: 'fulltext' }, request.asOf, MAX_ANNUAL_REPORT_PAGES)
    const selected = selectCninfoAnnualReportRecord(records, request.fiscalYear)
    if (selected === undefined) return undefined
    return { issuer: selected.issuer ?? request.company.name ?? request.company.symbol, fiscalYear: request.fiscalYear, reportTitle: selected.title, officialPublishedAt: selected.publishedAt, rawPublishedAt: selected.rawPublishedAt ?? selected.publishedAt, sourceUrl: selected.url, ...(selected.announcementId === undefined ? {} : { announcementId: selected.announcementId }), originPublisher: 'CNINFO', originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', retrievedAt: this.now() }
  }
  async listIndustry(request: Extract<ResearchAcquisitionRequest, { industry: unknown }>): Promise<readonly OfficialDisclosureRecord[]> {
    const terms = [...new Set([request.industry.name, ...(request.industry.aliases ?? []), ...request.industry.searchTerms].map((term) => term.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter((term) => term.length >= 2))].slice(0, 4)
    const records = new Map<string, OfficialDisclosureRecord>()
    for (const column of ['szse', 'sse']) for (const term of terms) {
      const form = new URLSearchParams({ pageNum: '1', pageSize: String(this.industryPageSize), column, tabName: 'fulltext', plate: '', stock: '', searchkey: term, secid: '', category: '', trade: '', seDate: `2000-01-01~${(request.asOf ?? new Date().toISOString()).slice(0, 10)}`, sortName: '', sortType: '', isHLtitle: 'true' })
      const response = await this.request(this.endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ResearchHub/PersonalResearchV1' }, body: form }); if (!response.ok) throw new Error(`CNINFO Industry request failed with HTTP ${response.status}`); const payload = await response.json() as Record<string, unknown>; for (const row of Array.isArray(payload.announcements) ? payload.announcements : []) { const record = CninfoOfficialDisclosureClient.record(row); if (!record || (request.asOf && Date.parse(record.publishedAt) > Date.parse(request.asOf))) continue; records.set(record.url, record) }
    }
    return [...records.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url)).slice(0, this.industryPageSize)
  }
  async fetch(record: OfficialDisclosureRecord): Promise<string> {
    if (record.content) return record.content
    return (await this.fetchDocument(record)).content
  }
  async fetchDocument(record: OfficialDisclosureRecord): Promise<OfficialDisclosureDocument> {
    if (record.content) return { content: record.content, bytes: new TextEncoder().encode(record.content), mediaType: 'text/plain' }
    if (!validCninfoUrl(record.url)) throw new Error('CNINFO disclosure URL is outside the allowed domain')
    const response = await this.request(record.url, { headers: { accept: 'text/html, application/pdf' } })
    if (!response.ok) throw new Error(`CNINFO disclosure fetch failed with HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0] ?? (record.url.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html')
    const filename = record.url.toLowerCase().endsWith('.pdf') ? 'cninfo-disclosure.pdf' : 'cninfo-disclosure.html'
    const document = await this.documentResolver.parse({ bytes, filename, mediaType })
    return { content: document.normalizedText, bytes, mediaType }
  }
  private async queryAnnouncements(parameters: Record<string, string>, asOf?: string, maxPages = 1): Promise<readonly OfficialDisclosureRecord[]> {
    const records = new Map<string, OfficialDisclosureRecord>()
    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
      const page = await this.queryAnnouncementPage({ ...parameters, pageNum: String(pageNum) }, asOf)
      for (const record of page.records) records.set(record.url, record)
      if (page.rawCount === 0 || !page.hasMore) break
    }
    return [...records.values()]
  }
  private async queryAnnouncementPage(parameters: Record<string, string>, asOf?: string): Promise<{ readonly records: readonly OfficialDisclosureRecord[]; readonly rawCount: number; readonly hasMore: boolean }> {
    const form = new URLSearchParams(parameters)
    const response = await this.request(this.endpoint, { method: 'POST', headers: cninfoHeaders(), body: form })
    if (!response.ok) throw new Error(`CNINFO request failed with HTTP ${response.status}`)
    const payload = await response.json() as Record<string, unknown>
    const rows = Array.isArray(payload.announcements) ? payload.announcements : []
    const records = rows.flatMap((row) => {
      const record = CninfoOfficialDisclosureClient.record(row)
      return record && (asOf === undefined || Date.parse(record.publishedAt) <= Date.parse(asOf)) ? [record] : []
    })
    const hasMoreValue = payload.hasMore
    const hasMore = typeof hasMoreValue === 'boolean'
      ? hasMoreValue
      : typeof hasMoreValue === 'string'
        ? hasMoreValue.toLowerCase() === 'true'
        : numberValue(payload.totalpages) > Number(parameters.pageNum)
    return { records, rawCount: rows.length, hasMore }
  }
}
function cninfoHeaders(): HeadersInit { return { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ResearchHub/PersonalResearchV1' } }
function isExactSecurityMatch(value: unknown, secCode: string): value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const row = value as Record<string, unknown>; return textValue(row.code) === secCode || textValue(row.secCode) === secCode }
function textValue(value: unknown): string | undefined { if (typeof value === 'string' && value.trim() !== '') return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); return undefined }
function numberValue(value: unknown): number { const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; return Number.isFinite(number) ? number : Number.NaN }
export function isCninfoAnnualReportBodyTitle(title: string, fiscalYear: number): boolean {
  const normalized = title.normalize('NFKC').replace(/\s+/g, '')
  if (!new RegExp(`${fiscalYear}(?:年年度报告|年度报告)`).test(normalized)) return false
  return !/(摘要|英文|审计报告|内控报告|提示性公告|取消公告|更正公告|更正后|修订|补充公告)/u.test(normalized)
}
export function selectCninfoAnnualReportRecord(records: readonly OfficialDisclosureRecord[], fiscalYear: number): OfficialDisclosureRecord | undefined {
  const candidates = records.filter((record) => isCninfoAnnualReportBodyTitle(record.title, fiscalYear)).sort((left, right) => left.publishedAt.localeCompare(right.publishedAt) || left.url.localeCompare(right.url))
  if (candidates.length === 0) return undefined
  const earliest = candidates[0]!
  const samePublication = candidates.filter((record) => record.publishedAt === earliest.publishedAt)
  if (samePublication.length > 1) throw new Error('ANNUAL_REPORT_PUBLICATION_AMBIGUOUS')
  return earliest
}
export function cninfoShanghaiCalendarDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2].padStart(2, '0')}-${dateOnly[3].padStart(2, '0')}`
  const instant = Date.parse(value)
  if (Number.isNaN(instant)) throw new Error('CNINFO_INVALID_CALENDAR_DATE')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) throw new Error('CNINFO_INVALID_CALENDAR_DATE')
  return `${year}-${month}-${day}`
}
export function cninfoShanghaiLookbackDate(asOf: string, lookbackDays: number): string {
  const calendarDate = cninfoShanghaiCalendarDate(asOf)
  const date = new Date(`${calendarDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - lookbackDays)
  return date.toISOString().slice(0, 10)
}
const validCninfoUrl = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'www.cninfo.com.cn' || url.hostname === 'static.cninfo.com.cn') } catch { return false } }
export class OfficialDisclosureResearchPlugin implements ResearchAcquisitionPlugin {
  readonly name = 'official-disclosure-research-acquisition'
  constructor(private readonly client: OfficialDisclosureClient, private readonly now: () => string = () => new Date().toISOString()) {}
  async discover(request: ResearchAcquisitionRequest): Promise<readonly ResearchSourceCandidate[]> { const limit = Math.min(20, Math.max(0, request.limitPerKind ?? 5)); if (request.industry !== undefined) { if (!this.client.listIndustry) return []; return (await this.client.listIndustry(request)).slice(0, limit).map((record) => ({ candidateId: `official-${sha256(record.url).slice(0, 16)}`, kind: 'official_disclosure', tier: 1, title: record.title, url: record.url, provider: 'cninfo', publishedAt: record.publishedAt, metadata: { industryTarget: request.industry.name, sourceAccountRef: 'cninfo:official-industry-disclosure', issuer: record.issuer, ...(record.announcementId ? { announcementId: record.announcementId } : {}), ...(record.rawPublishedAt ? { rawPublishedAt: record.rawPublishedAt } : {}) } })) } const fiscalPeriod = request.filingPeriod; return (await this.client.list(request)).slice(0, limit).map((record) => ({ candidateId: `official-${sha256(record.url).slice(0, 16)}`, kind: 'official_disclosure', tier: 1, title: record.title, url: record.url, provider: 'cninfo', publishedAt: record.publishedAt, metadata: { companySymbol: request.company.symbol, exchange: request.company.exchange, sourceAccountRef: 'cninfo:official-disclosure', issuer: record.issuer, ...(fiscalPeriod === undefined ? {} : { fiscalYear: fiscalPeriod.fiscalYear, period: fiscalPeriod.fiscalPeriod, fiscalPeriod: `${fiscalPeriod.fiscalYear}-${fiscalPeriod.fiscalPeriod}` }), ...(record.announcementId ? { announcementId: record.announcementId } : {}), ...(record.rawPublishedAt ? { rawPublishedAt: record.rawPublishedAt } : {}), ...(record.correctionOf ? { correctionOf: record.correctionOf } : {}) } })) }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> { const metadata = candidate.metadata ?? {}; const record: OfficialDisclosureRecord = { title: candidate.title, url: candidate.url!, publishedAt: candidate.publishedAt ?? this.now(), ...(typeof metadata.announcementId === 'string' ? { announcementId: metadata.announcementId } : {}), ...(typeof metadata.rawPublishedAt === 'string' ? { rawPublishedAt: metadata.rawPublishedAt } : {}), ...(typeof metadata.issuer === 'string' ? { issuer: metadata.issuer } : {}), ...(typeof metadata.correctionOf === 'string' ? { correctionOf: metadata.correctionOf } : {}) }; const document = this.client.fetchDocument ? await this.client.fetchDocument(record) : undefined; const content = document?.content ?? await this.client.fetch(record); return { candidate, retrievedAt: this.now(), content, contentHash: sha256(content), ...(document === undefined ? {} : { rawBytes: document.bytes, mediaType: document.mediaType }) } }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> { return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash ?? sha256(source.content), ...(source.rawBytes === undefined ? {} : { rawBytes: Uint8Array.from(source.rawBytes) }), canonicalUrl: source.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } }
}
