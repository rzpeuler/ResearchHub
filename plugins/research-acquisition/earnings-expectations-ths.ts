import { sha256 } from './hash.ts'
import { normalizeEastmoneyTimestamp } from './expectations/eastmoney-report.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity, ResearchProviderOutcome } from './contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EstimateProjectionResult } from './earnings-expectation-source-eastmoney.ts'

export const THS_INSTITUTION_FORECAST_INDICATOR = '业绩预测详表-机构' as const
export const THS_PROVIDER = 'akshare-ths-institution-forecast' as const
export const THS_EPS_UNIT = 'CNY_per_share' as const
export const THS_NET_PROFIT_UNIT = 'CNY_yuan' as const

type Dict = Record<string, unknown>

function record(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim(); return normalized === '' ? undefined : normalized }
function finite(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value.trim().replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)) }
function rows(value: unknown): readonly Dict[] {
  if (Array.isArray(value)) return value.filter(record)
  if (record(value) && Array.isArray(value.data)) return value.data.filter(record)
  return []
}
function dateOnlyOrTimestamp(value: unknown): string | undefined { return normalizeEastmoneyTimestamp(value)?.iso }

/** Parse only explicit Chinese monetary units; bare numeric profit values are ambiguous and rejected. */
export function parseChineseMoney(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(亿元|亿|万元|万|元)$/.exec(value.normalize('NFKC').replace(/,/g, '').trim())
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  const multiplier = match[2].startsWith('亿') ? 100_000_000 : match[2].startsWith('万') ? 10_000 : 1
  const normalized = amount * multiplier
  return Number.isFinite(normalized) ? normalized : undefined
}

function fiscalFields(row: Dict, pattern: RegExp): readonly { readonly fiscalYear: number; readonly key: string }[] {
  return Object.keys(row).flatMap((key) => {
    const match = pattern.exec(key.normalize('NFKC').replace(/\s+/g, ''))
    if (!match) return []
    const fiscalYear = Number(match[1])
    return Number.isSafeInteger(fiscalYear) && fiscalYear >= 1900 && fiscalYear <= 2200 ? [{ fiscalYear, key }] : []
  }).sort((left, right) => left.fiscalYear - right.fiscalYear || left.key.localeCompare(right.key))
}

function rowSource(company: ResearchCompanyIdentity, row: Dict, institutionKey: string, publishedAt: string, retrievedAt: string): NormalizedResearchSource {
  const sourceId = `ths-institution-${sha256(stable({ symbol: company.symbol, institutionKey, publishedAt, row }))}`
  const title = `Tonghuashun institution forecast: ${institutionKey}`
  const content = JSON.stringify({ provider: THS_PROVIDER, symbol: company.symbol, institution: institutionKey, publishedAt, row })
  return {
    candidate: {
      candidateId: sourceId,
      kind: 'structured_data',
      tier: 3,
      title,
      provider: THS_PROVIDER,
      publishedAt,
      metadata: { originPublisher: 'Tonghuashun / 同花顺', retrievalProvider: 'AKShare', companySymbol: company.symbol, institutionName: institutionKey },
    },
    retrievedAt,
    title,
    content,
    contentHash: sha256(content),
    publisher: 'Tonghuashun / 同花顺',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' },
  }
}

function estimateId(sourceId: string, company: ResearchCompanyIdentity, institutionKey: string, metric: string, fiscalYear: number, publishedAt: string, value: number): string {
  return `ths-estimate-${sha256(`${sourceId}|${company.symbol}|${institutionKey}|${metric}|${fiscalYear}-FY|${publishedAt}|${value}`)}`
}

export interface ThsProjectionInput {
  readonly payload: unknown
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly retrievedAt: string
}

export function projectThsInstitutionForecasts(input: ThsProjectionInput): EstimateProjectionResult {
  const diagnostics: string[] = []
  const estimates: EstimatePoint[] = []
  const sources: NormalizedResearchSource[] = []
  const institutions = new Map<string, { readonly institutionKey: string; readonly name: string; readonly providerCode: string }>()
  let futureCount = 0
  const rawRows = rows(input.payload)
  if (!Array.isArray(input.payload) && !(record(input.payload) && Array.isArray(input.payload.data))) diagnostics.push('ths_response_rows_invalid')
  rawRows.forEach((row, rowIndex) => {
    const institution = text(row['机构名称'] ?? row.institution ?? row.institutionName)
    if (!institution) { diagnostics.push(`ths_row_institution_missing:${rowIndex}`); return }
    const publishedAt = dateOnlyOrTimestamp(row['报告日期'] ?? row.reportDate ?? row.publishedAt)
    if (!publishedAt) { diagnostics.push(`ths_row_publication_invalid:${rowIndex}`); return }
    const source = rowSource(input.company, row, institution, publishedAt, input.retrievedAt)
    const analyst = text(row['研究员'] ?? row.analyst)
    const fields = [
      ...fiscalFields(row, /^预测年报每股收益(\d{4})预测$/).map((item) => ({ ...item, metric: 'eps' as const, unit: THS_EPS_UNIT, parse: finite })),
      ...fiscalFields(row, /^预测年报净利润(\d{4})预测$/).map((item) => ({ ...item, metric: 'net_profit' as const, unit: THS_NET_PROFIT_UNIT, parse: parseChineseMoney })),
    ]
    let acceptedForRow = 0
    for (const field of fields) {
      const value = field.parse(row[field.key])
      if (value === undefined) { diagnostics.push(`ths_value_invalid:${rowIndex}:${field.key}`); continue }
      if (Date.parse(publishedAt) > Date.parse(input.asOf)) { futureCount += 1; continue }
      const point: EstimatePoint = {
        estimateId: estimateId(source.candidate.candidateId, input.company, institution, field.metric, field.fiscalYear, publishedAt, value),
        metric: field.metric,
        fiscalPeriod: `${field.fiscalYear}-FY`,
        value,
        unit: field.unit,
        institutionKey: `ths-org:${institution}`,
        ...(analyst === undefined ? {} : { analystKey: `ths-analyst:${analyst}` }),
        publishedAt,
        sourceCandidateIds: [source.candidate.candidateId],
      }
      estimates.push(point)
      acceptedForRow += 1
    }
    if (acceptedForRow > 0) {
      sources.push(source)
      institutions.set(`ths-org:${institution}`, { institutionKey: `ths-org:${institution}`, name: institution, providerCode: institution })
    }
  })
  if (futureCount > 0) diagnostics.push(`ths_future_estimate_count:${futureCount}`)
  if (estimates.length === 0 && futureCount > 0) diagnostics.push('NO_ELIGIBLE_POINT_IN_TIME_DATA')
  if (estimates.length === 0 && rawRows.length > 0 && futureCount === 0) diagnostics.push('ths_no_usable_estimates')
  estimates.sort((left, right) => left.estimateId.localeCompare(right.estimateId))
  sources.sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId))
  const uniqueDiagnostics = uniqueSorted(diagnostics)
  const providerOutcome: ResearchProviderOutcome = { provider: THS_PROVIDER, providerAttempted: true, providerSucceeded: estimates.length > 0, providerEmpty: rawRows.length === 0 || estimates.length === 0, providerFailed: uniqueDiagnostics.includes('ths_response_rows_invalid'), usableSourceCount: sources.length }
  return { sources, estimates, institutions: [...institutions.values()].sort((left, right) => left.institutionKey.localeCompare(right.institutionKey)), diagnostics: uniqueDiagnostics, providerOutcome, truncated: false }
}
