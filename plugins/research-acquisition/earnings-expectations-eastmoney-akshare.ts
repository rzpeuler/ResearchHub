import { sha256 } from './hash.ts'
import { normalizeEastmoneyTimestamp } from './expectations/eastmoney-report.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity, ResearchProviderOutcome } from './contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EstimateProjectionResult } from './earnings-expectation-source-eastmoney.ts'

export const EASTMONEY_AKSHARE_PROVIDER = 'akshare-eastmoney-research-report' as const
export const EASTMONEY_AKSHARE_EPS_UNIT = 'CNY_per_share' as const

type Dict = Record<string, unknown>
function record(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim(); return normalized === '' ? undefined : normalized }
function finite(value: unknown): number | undefined { if (typeof value === 'number') return Number.isFinite(value) ? value : undefined; if (typeof value !== 'string' || value.trim() === '') return undefined; const parsed = Number(value.trim().replace(/,/g, '')); return Number.isFinite(parsed) ? parsed : undefined }
function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)) }
function rows(value: unknown): readonly Dict[] { if (Array.isArray(value)) return value.filter(record); if (record(value) && Array.isArray(value.data)) return value.data.filter(record); return [] }
function first(row: Dict, keys: readonly string[]): unknown { for (const key of keys) if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]; return undefined }
function forecastFields(row: Dict): readonly { readonly fiscalYear: number; readonly key: string }[] {
  return Object.keys(row).flatMap((key) => {
    const normalized = key.normalize('NFKC').replace(/\s+/g, '')
    const match = /^(\d{4})-(?:盈利预测-收益|预测每股收益|EPS)$/.exec(normalized)
    if (!match) return []
    const year = Number(match[1])
    return Number.isSafeInteger(year) && year >= 1900 && year <= 2200 ? [{ fiscalYear: year, key }] : []
  }).sort((left, right) => left.fiscalYear - right.fiscalYear || left.key.localeCompare(right.key))
}

export interface EastmoneyAkshareProjectionInput {
  readonly payload: unknown
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly retrievedAt: string
}

export function projectAkshareEastmoneyResearchReports(input: EastmoneyAkshareProjectionInput): EstimateProjectionResult {
  const diagnostics: string[] = []
  const estimates: EstimatePoint[] = []
  const sources: NormalizedResearchSource[] = []
  const institutions = new Map<string, { readonly institutionKey: string; readonly name: string; readonly providerCode: string }>()
  let futureCount = 0
  const rawRows = rows(input.payload)
  if (!Array.isArray(input.payload) && !(record(input.payload) && Array.isArray(input.payload.data))) diagnostics.push('eastmoney_akshare_response_rows_invalid')
  rawRows.forEach((row, rowIndex) => {
    const symbol = text(first(row, ['股票代码', 'stockCode', 'symbol']))
    if (symbol !== undefined && symbol !== input.company.symbol) { diagnostics.push(`eastmoney_akshare_stock_mismatch:${rowIndex}:${symbol}`); return }
    const institution = text(first(row, ['机构', '机构名称', 'orgName', 'institution']))
    if (!institution) { diagnostics.push(`eastmoney_akshare_institution_missing:${rowIndex}`); return }
    const rawDate = first(row, ['日期', 'publishDate', 'publishedAt'])
    const publishedAt = normalizeEastmoneyTimestamp(rawDate)?.iso
    if (!publishedAt) { diagnostics.push(`eastmoney_akshare_publication_invalid:${rowIndex}`); return }
    const pdfUrl = text(first(row, ['报告PDF链接', '报告PDF连接', 'reportPdfUrl', 'pdfUrl', 'url']))
    const title = text(first(row, ['报告名称', 'title'])) ?? `EastMoney research report: ${institution}`
    const sourceId = `eastmoney-akshare-report-${sha256(JSON.stringify({ symbol: input.company.symbol, institution, publishedAt, pdfUrl: pdfUrl ?? null, title, forecasts: forecastFields(row).map((field) => [field.fiscalYear, row[field.key]]) }))}`
    const source: NormalizedResearchSource = {
      candidate: { candidateId: sourceId, kind: 'structured_data', tier: 3, title, ...(pdfUrl === undefined ? {} : { url: pdfUrl }), provider: EASTMONEY_AKSHARE_PROVIDER, publishedAt, metadata: { originPublisher: 'EastMoney', retrievalProvider: 'AKShare', companySymbol: input.company.symbol, institutionName: institution, reportDateRaw: rawDate, reportPdfUrl: pdfUrl } },
      retrievedAt: input.retrievedAt,
      title,
      content: JSON.stringify({ provider: EASTMONEY_AKSHARE_PROVIDER, symbol: input.company.symbol, institution, publishedAt, reportPdfUrl: pdfUrl, row }),
      contentHash: sha256(JSON.stringify({ row, publishedAt, sourceId })),
      publisher: 'EastMoney',
      rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' },
    }
    let acceptedForRow = 0
    for (const field of forecastFields(row)) {
      const value = finite(row[field.key])
      if (value === undefined) { diagnostics.push(`eastmoney_akshare_eps_invalid:${rowIndex}:${field.key}`); continue }
      if (Date.parse(publishedAt) > Date.parse(input.asOf)) { futureCount += 1; continue }
      estimates.push({ estimateId: `eastmoney-estimate-${sha256(`${sourceId}|${input.company.symbol}|${institution}|eps|${field.fiscalYear}-FY|${publishedAt}|${value}`)}`, metric: 'eps', fiscalPeriod: `${field.fiscalYear}-FY`, value, unit: EASTMONEY_AKSHARE_EPS_UNIT, institutionKey: `eastmoney-org:${institution}`, publishedAt, sourceCandidateIds: [sourceId] })
      acceptedForRow += 1
    }
    if (acceptedForRow > 0) {
      sources.push(source)
      institutions.set(`eastmoney-org:${institution}`, { institutionKey: `eastmoney-org:${institution}`, name: institution, providerCode: institution })
    }
  })
  if (futureCount > 0) diagnostics.push(`eastmoney_akshare_future_estimate_count:${futureCount}`)
  if (estimates.length === 0 && futureCount > 0) diagnostics.push('NO_ELIGIBLE_POINT_IN_TIME_DATA')
  if (estimates.length === 0 && rawRows.length > 0 && futureCount === 0) diagnostics.push('eastmoney_akshare_no_usable_estimates')
  estimates.sort((left, right) => left.estimateId.localeCompare(right.estimateId))
  sources.sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId))
  const uniqueDiagnostics = uniqueSorted(diagnostics)
  const providerOutcome: ResearchProviderOutcome = { provider: EASTMONEY_AKSHARE_PROVIDER, providerAttempted: true, providerSucceeded: estimates.length > 0, providerEmpty: rawRows.length === 0 || estimates.length === 0, providerFailed: uniqueDiagnostics.includes('eastmoney_akshare_response_rows_invalid'), usableSourceCount: sources.length }
  return { sources, estimates, institutions: [...institutions.values()].sort((left, right) => left.institutionKey.localeCompare(right.institutionKey)), diagnostics: uniqueDiagnostics, providerOutcome, truncated: false }
}
