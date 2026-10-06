import { sha256 } from '../hash.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity, ResearchProviderOutcome } from '../contracts.ts'
import {
  EASTMONEY_REPORT_ENDPOINT,
  EASTMONEY_REPORT_PROVIDER,
  type EastmoneyEpsForecast,
  type EastmoneyEstimateSourceRequest,
  type EastmoneyReportAcquisitionResult,
  type EastmoneyReportSourceClientOptions,
  type EastmoneyResearchReportRecord,
  type EastmoneyTimestampPrecision,
  type EastmoneyForecastProviderField,
} from './contracts.ts'

const REPORT_PAGE_URL = 'https://data.eastmoney.com/report/stock.jshtml'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 20
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
const MAX_PAGE_SIZE = 100
const MAX_PAGES = 20
const MAX_TIMEOUT_MS = 20_000
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
const SYMBOL = /^\d{6}$/

type Dict = Record<string, unknown>

interface ParsedTimestamp {
  readonly iso: string
  readonly precision: EastmoneyTimestampPrecision
}

interface ParsedRow {
  readonly record?: EastmoneyResearchReportRecord
  readonly diagnostics: readonly string[]
}

interface EastmoneyReportPage {
  readonly data: readonly unknown[]
  readonly totalPages: number
  readonly currentYear: number
}

function record(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, maximum = 2_048): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= maximum ? normalized : undefined
}

function integer(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day))
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
}

function shanghaiLocalIso(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number): string | undefined {
  if (!validCalendarDate(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) return undefined
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - SHANGHAI_OFFSET_MS).toISOString()
}

/** Normalize Eastmoney's timezone-free report timestamp as Asia/Shanghai. */
export function normalizeEastmoneyTimestamp(value: unknown): ParsedTimestamp | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochMilliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value
    const date = new Date(epochMilliseconds)
    if (!Number.isFinite(date.getTime())) return undefined
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    const iso = fields.year && fields.month && fields.day ? shanghaiLocalIso(Number(fields.year), Number(fields.month), Number(fields.day), 23, 59, 59, 999) : undefined
    return iso === undefined ? undefined : { iso, precision: 'date' }
  }
  const raw = text(value, 128)
  if (!raw) return undefined
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (dateOnly) {
    const iso = shanghaiLocalIso(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 23, 59, 59, 999)
    return iso === undefined ? undefined : { iso, precision: 'date' }
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw)
  if (local) {
    const fraction = local[7] === undefined ? '' : local[7].padEnd(3, '0')
    const iso = shanghaiLocalIso(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] ?? 0), Number(fraction || 0))
    return iso === undefined ? undefined : { iso, precision: 'datetime' }
  }
  const explicitZone = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:?\d{2})$/.exec(raw)
  if (!explicitZone) return undefined
  const parsed = Date.parse(`${explicitZone[1]}T${explicitZone[2]}${explicitZone[3]}`)
  return Number.isFinite(parsed) ? { iso: new Date(parsed).toISOString(), precision: 'datetime' } : undefined
}

export function parseEastmoneyNumeric(value: unknown): number | undefined {
  return finiteNumber(value)
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function requestOutcome(providerAttempted: boolean, providerSucceeded: boolean, providerEmpty: boolean, providerFailed: boolean, usableSourceCount: number): ResearchProviderOutcome {
  return { provider: EASTMONEY_REPORT_PROVIDER, providerAttempted, providerSucceeded, providerEmpty, providerFailed, usableSourceCount }
}

function emptyResult(diagnostics: readonly string[], outcome: ResearchProviderOutcome, forecastBaseYear?: number, truncated = false): EastmoneyReportAcquisitionResult {
  return { records: [], sources: [], diagnostics: uniqueSorted(diagnostics), providerOutcome: outcome, ...(forecastBaseYear === undefined ? {} : { forecastBaseYear }), truncated }
}

function asOfMilliseconds(value: string): number | undefined {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function shanghaiCalendarDate(asOf: string): string | undefined {
  const parsed = asOfMilliseconds(asOf)
  if (parsed === undefined) return undefined
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(parsed))
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return fields.year && fields.month && fields.day ? `${fields.year}-${fields.month}-${fields.day}` : undefined
}

function endpointIsAllowed(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'reportapi.eastmoney.com' && url.pathname.replace(/\/$/, '') === '/report/list'
  } catch {
    return false
  }
}

function stableForecasts(value: readonly EastmoneyEpsForecast[]): readonly EastmoneyEpsForecast[] {
  return value.slice().sort((left, right) => left.fiscalYear - right.fiscalYear || left.providerField.localeCompare(right.providerField) || left.value - right.value)
}

function providerFingerprint(value: EastmoneyResearchReportRecord): string {
  return JSON.stringify({ infoCode: value.infoCode, stockCode: value.stockCode, stockName: value.stockName ?? null, title: value.title, orgCode: value.orgCode, orgName: value.orgName ?? null, orgShortName: value.orgShortName, researcher: value.researcher ?? null, publishDateRaw: value.publishDateRaw, publishedAt: value.publishedAt, timestampPrecision: value.timestampPrecision, forecastBaseYear: value.forecastBaseYear, epsForecasts: stableForecasts(value.epsForecasts), rating: value.rating ?? null, reportPdfUrl: value.reportPdfUrl ?? null })
}

function parseRow(value: unknown, currentYear: number, company: ResearchCompanyIdentity): ParsedRow {
  if (!record(value)) return { diagnostics: ['eastmoney_report_row_invalid'] }
  const row = value
  const infoCode = text(row.infoCode)
  if (!infoCode) return { diagnostics: ['eastmoney_report_infoCode_required'] }
  const stockCode = text(row.stockCode)
  if (!stockCode || !SYMBOL.test(stockCode)) return { diagnostics: [`eastmoney_report_stock_code_invalid:${infoCode}`] }
  if (stockCode !== company.symbol) return { diagnostics: [`eastmoney_report_stock_mismatch:${infoCode}:${stockCode}`] }
  const title = text(row.title, 512)
  if (!title) return { diagnostics: [`eastmoney_report_title_required:${infoCode}`] }
  const orgCode = text(row.orgCode, 128)
  if (!orgCode) return { diagnostics: [`eastmoney_report_orgCode_required:${infoCode}`] }
  const orgShortName = text(row.orgSName ?? row.orgShortName, 256)
  if (!orgShortName) return { diagnostics: [`eastmoney_report_orgShortName_required:${infoCode}`] }
  const publishDateRaw = text(row.publishDate ?? row.publishDateRaw, 128)
  const timestamp = normalizeEastmoneyTimestamp(publishDateRaw)
  if (!publishDateRaw || !timestamp) return { diagnostics: [`eastmoney_report_timestamp_invalid:${infoCode}`] }
  const diagnostics: string[] = []
  const fields: readonly [EastmoneyForecastProviderField, number][] = [
    ['predictThisYearEps', 0],
    ['predictNextYearEps', 1],
    ['predictNextTwoYearEps', 2],
  ]
  const epsForecasts: EastmoneyEpsForecast[] = []
  for (const [providerField, offset] of fields) {
    const rawForecast = row[providerField]
    if (rawForecast === undefined || rawForecast === null || (typeof rawForecast === 'string' && rawForecast.trim() === '')) continue
    const forecast = finiteNumber(rawForecast)
    if (forecast === undefined) { diagnostics.push(`eastmoney_eps_invalid:${infoCode}:${providerField}`); continue }
    epsForecasts.push({ fiscalYear: currentYear + offset, value: forecast, providerField })
  }
  const recordValue: EastmoneyResearchReportRecord = {
    infoCode,
    stockCode,
    ...(text(row.stockName, 256) === undefined ? {} : { stockName: text(row.stockName, 256) }),
    title,
    orgCode,
    ...(text(row.orgName, 256) === undefined ? {} : { orgName: text(row.orgName, 256) }),
    orgShortName,
    ...(text(row.researcher, 512) === undefined ? {} : { researcher: text(row.researcher, 512) }),
    publishDateRaw,
    publishedAt: timestamp.iso,
    timestampPrecision: timestamp.precision,
    forecastBaseYear: currentYear,
    epsForecasts: stableForecasts(epsForecasts),
    ...(text(row.emRatingName ?? row.sRatingName, 128) === undefined ? {} : { rating: text(row.emRatingName ?? row.sRatingName, 128) }),
    ...(text(row.pdfUrl ?? row.reportPdfUrl ?? row.reportPdfLink, 2_048) === undefined ? {} : { reportPdfUrl: text(row.pdfUrl ?? row.reportPdfUrl ?? row.reportPdfLink, 2_048) }),
  }
  return { record: recordValue, diagnostics }
}

function parsePage(value: unknown): EastmoneyReportPage {
  if (!record(value) || !Array.isArray(value.data)) throw new Error('eastmoney_response_data_invalid')
  const root = value as Dict
  const totalPages = integer(root.TotalPage)
  if (totalPages === undefined || totalPages < 0) throw new Error('eastmoney_response_pagination_invalid')
  const currentYear = integer(root.currentYear)
  if (currentYear === undefined || currentYear < 1900 || currentYear > 2200) throw new Error('eastmoney_response_currentYear_invalid')
  return { data: root.data as readonly unknown[], totalPages, currentYear }
}

function reportSource(recordValue: EastmoneyResearchReportRecord, retrievedAt: string): NormalizedResearchSource {
  const candidateId = `eastmoney-report-${sha256(recordValue.infoCode)}`
  const metadata: Record<string, unknown> = {
    dataKind: 'analyst_estimate_report',
    companySymbol: recordValue.stockCode,
    providerObjectId: recordValue.infoCode,
    institutionCode: recordValue.orgCode,
    institutionName: recordValue.orgName,
    institutionShortName: recordValue.orgShortName,
    researcher: recordValue.researcher,
    forecastBaseYear: recordValue.forecastBaseYear,
    timestampPrecision: recordValue.timestampPrecision,
    rating: recordValue.rating,
    forecastFields: recordValue.epsForecasts.map((item) => item.providerField),
  }
  for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key]
  const candidate = {
    candidateId,
    kind: 'structured_data' as const,
    tier: 3 as const,
    title: recordValue.title,
    url: recordValue.reportPdfUrl ?? `${REPORT_PAGE_URL}?infocode=${encodeURIComponent(recordValue.infoCode)}`,
    provider: EASTMONEY_REPORT_PROVIDER,
    publishedAt: recordValue.publishedAt,
    metadata,
  }
  const content = JSON.stringify({
    provider: EASTMONEY_REPORT_PROVIDER,
    report: {
      infoCode: recordValue.infoCode,
      stockCode: recordValue.stockCode,
      stockName: recordValue.stockName,
      title: recordValue.title,
      institution: { orgCode: recordValue.orgCode, orgName: recordValue.orgName, orgShortName: recordValue.orgShortName },
      researcher: recordValue.researcher,
      publishDateRaw: recordValue.publishDateRaw,
      publishedAt: recordValue.publishedAt,
      timestampPrecision: recordValue.timestampPrecision,
      forecastBaseYear: recordValue.forecastBaseYear,
      epsForecasts: recordValue.epsForecasts,
      rating: recordValue.rating,
    },
  })
  return {
    candidate,
    retrievedAt,
    title: recordValue.title,
    content,
    canonicalUrl: candidate.url,
    contentHash: sha256(content),
    publisher: 'Eastmoney Research Reports',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' },
  }
}

function failure(diagnostics: readonly string[]): EastmoneyReportAcquisitionResult {
  return emptyResult(diagnostics, requestOutcome(true, false, false, true, 0))
}

export class EastmoneyReportClient {
  readonly name = 'eastmoney-reportapi-expectation-source'
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly pageSize: number
  private readonly maxPages: number
  private readonly maxPayloadBytes: number

  constructor(options: EastmoneyReportSourceClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.endpoint = options.endpoint ?? EASTMONEY_REPORT_ENDPOINT
    if (!endpointIsAllowed(this.endpoint)) throw new Error('eastmoney_endpoint_not_allowlisted')
    this.now = options.now ?? (() => new Date().toISOString())
    this.timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    this.pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
    this.maxPages = Math.min(MAX_PAGES, Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES))
    this.maxPayloadBytes = Math.min(MAX_PAYLOAD_BYTES, Math.max(1_024, options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES))
  }

  private async requestPage(request: EastmoneyEstimateSourceRequest, pageNo: number, beginTime: string, endTime: string): Promise<EastmoneyReportPage> {
    const url = new URL(this.endpoint)
    const params: Record<string, string> = {
      industryCode: '*',
      pageSize: String(this.pageSize),
      industry: '*',
      rating: '*',
      ratingChange: '*',
      beginTime,
      endTime,
      pageNo: String(pageNo),
      fields: '',
      qType: '0',
      orgCode: '',
      code: request.company.symbol,
      rcode: '',
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url.toString(), { headers: { Accept: 'application/json', Referer: 'https://data.eastmoney.com/', 'User-Agent': 'ResearchHub/expectation-source-001a' }, signal: controller.signal })
      const finalUrl = response.url || url.toString()
      if (!endpointIsAllowed(finalUrl)) throw new Error('eastmoney_redirect_crossed_host')
      if (!response.ok) throw new Error(`eastmoney_http_${response.status}`)
      const body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > this.maxPayloadBytes) throw new Error('eastmoney_payload_exceeds_bound')
      let payload: unknown
      try { payload = JSON.parse(body) } catch { throw new Error('eastmoney_response_not_json') }
      return parsePage(payload)
    } finally {
      clearTimeout(timer)
    }
  }

  async acquire(request: EastmoneyEstimateSourceRequest): Promise<EastmoneyReportAcquisitionResult> {
    const asOf = asOfMilliseconds(request.asOf)
    const endTime = shanghaiCalendarDate(request.asOf)
    if (!SYMBOL.test(request.company.symbol)) return emptyResult(['eastmoney_company_symbol_invalid'], requestOutcome(false, false, false, false, 0))
    if (asOf === undefined || endTime === undefined) return emptyResult(['eastmoney_asOf_invalid'], requestOutcome(false, false, false, false, 0))
    if (!Number.isSafeInteger(request.targetFiscalYear)) return emptyResult(['eastmoney_target_fiscal_year_invalid'], requestOutcome(false, false, false, false, 0))
    if (request.maxPages !== undefined && (!Number.isSafeInteger(request.maxPages) || request.maxPages < 1)) return emptyResult(['eastmoney_max_pages_invalid'], requestOutcome(false, false, false, false, 0))
    const maxPages = Math.min(this.maxPages, request.maxPages ?? this.maxPages)
    const beginTime = `${request.targetFiscalYear - 2}-01-01`
    const diagnostics: string[] = []
    const rows: EastmoneyResearchReportRecord[] = []
    let forecastBaseYear: number | undefined
    let totalPages = 0
    let sawData = false
    let truncated = false
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      let page: EastmoneyReportPage
      try { page = await this.requestPage(request, pageNo, beginTime, endTime) } catch (error) { return failure([...diagnostics, error instanceof Error ? error.message : 'eastmoney_request_failed']) }
      if (forecastBaseYear === undefined) forecastBaseYear = page.currentYear
      else if (forecastBaseYear !== page.currentYear) return failure([...diagnostics, 'eastmoney_currentYear_inconsistent'])
      totalPages = page.totalPages
      if (page.data.length > 0) sawData = true
      for (const item of page.data) {
        const parsed = parseRow(item, page.currentYear, request.company)
        diagnostics.push(...parsed.diagnostics)
        if (parsed.record) rows.push(parsed.record)
      }
      if (page.data.length === 0 || pageNo >= totalPages) break
      if (pageNo === maxPages && totalPages > maxPages) { truncated = true; diagnostics.push('eastmoney_report_pagination_truncated') }
    }
    const byInfoCode = new Map<string, EastmoneyResearchReportRecord[]>()
    for (const item of rows) byInfoCode.set(item.infoCode, [...(byInfoCode.get(item.infoCode) ?? []), item])
    const accepted: EastmoneyResearchReportRecord[] = []
    for (const infoCode of [...byInfoCode.keys()].sort()) {
      const group = byInfoCode.get(infoCode)!.slice().sort((left, right) => providerFingerprint(left).localeCompare(providerFingerprint(right)))
      const fingerprints = uniqueSorted(group.map(providerFingerprint))
      if (fingerprints.length > 1) { diagnostics.push(`eastmoney_report_identity_conflict:${infoCode}`); continue }
      const item = group[0]!
      if (Date.parse(item.publishedAt) > asOf) { diagnostics.push(`eastmoney_report_published_after_asOf:${infoCode}`); continue }
      accepted.push(item)
    }
    accepted.sort((left, right) => left.infoCode.localeCompare(right.infoCode))
    const retrievedAt = this.now()
    const sources = accepted.map((item) => reportSource(item, retrievedAt)).sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId))
    return {
      records: accepted,
      sources,
      diagnostics: uniqueSorted(diagnostics),
      providerOutcome: requestOutcome(true, true, !sawData, false, sources.length),
      ...(forecastBaseYear === undefined ? {} : { forecastBaseYear }),
      truncated,
    }
  }
}

export const EastmoneyResearchReportClient = EastmoneyReportClient
