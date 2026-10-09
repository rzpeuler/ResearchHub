import type { EarningsMetricUnit, EarningsPeriodSpec, FinancialPeriodSnapshot, NormalizedFinancialData, VerifiedFinancialMetric } from '../../skills/earnings-review/financials.ts'
import { normalizeEastmoneyTimestamp } from './expectations/eastmoney-report.ts'

const FIELD_ALIASES: Readonly<Record<'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', readonly string[]>> = {
  revenue: ['营业总收入(元)', '营业收入(元)', '营业收入(万元)', '营业收入(亿元)', '营业总收入', '营业收入', 'total_operating_revenue', 'operating_revenue', 'revenue'],
  net_profit: ['归属于上市公司股东的净利润(元)', '归属于上市公司股东的净利润(万元)', '归属于上市公司股东的净利润(亿元)', '归属于上市公司股东的净利润', 'net_profit', 'net profit', '净利润'],
  gross_margin: ['销售毛利率(%)', '毛利率(%)', '销售毛利率', '毛利率', 'gross_margin', 'gross profit margin'],
  operating_cash_flow: ['经营活动产生的现金流量净额(元)', '经营活动产生的现金流量净额(万元)', '经营活动产生的现金流量净额(亿元)', '经营活动产生的现金流量净额', '经营活动现金流量净额', 'net_cash_flows_from_operating_activities', 'operating_cash_flow'],
  eps: ['基本每股收益(元/股)', '基本每股收益(元)', '基本每股收益', 'basic_eps', 'eps'],
}
const PERIOD_FIELDS = ['报告期', '报告日期', '报告期末', '日期', 'date', 'end_date', 'report_date', 'period', 'fiscal_period'] as const

export function normalizeAksharePeriod(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text)
  const separated = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  const match = chinese ?? separated
  if (!match) return undefined
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const validated = new Date(Date.UTC(year, month - 1, day))
  if (validated.getUTCFullYear() !== year || validated.getUTCMonth() !== month - 1 || validated.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function rowsOf(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).data)) return rowsOf((value as Record<string, unknown>).data)
  return []
}
function valueFor(row: Record<string, unknown>, aliases: readonly string[]): unknown { for (const alias of aliases) if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias]; return undefined }
export function akshareFinancialRowPublication(row: Record<string, unknown>): string | undefined {
  return normalizeEastmoneyTimestamp(valueFor(row, ['公告日期', '公告日', 'NOTICE_DATE', 'noticeDate', 'publishedAt']))?.iso
}
function stableRowKey(row: Record<string, unknown>): string { return JSON.stringify(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))) }
function comparableMetricValue(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  const raw = valueFor(row, aliases)
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : undefined
  return typeof raw === 'string' ? raw.normalize('NFKC').replace(/,/g, '').trim() : undefined
}
function sameVersionConflict(rows: readonly Record<string, unknown>[]): boolean {
  if (rows.length < 2) return false
  return (Object.values(FIELD_ALIASES)).some((aliases) => {
    const values = rows.map((row) => comparableMetricValue(row, aliases)).filter((value): value is string => value !== undefined)
    return new Set(values).size > 1
  })
}
export function hasConflictingAkshareFinancialVersion(value: unknown, endDate: string): boolean {
  const matching = rowsOf(value).filter((row) => normalizeAksharePeriod(valueFor(row, PERIOD_FIELDS)) === endDate)
  if (matching.length < 2) return false
  const ranked = [...matching].sort((left, right) => (akshareFinancialRowPublication(right) ?? '').localeCompare(akshareFinancialRowPublication(left) ?? '') || stableRowKey(left).localeCompare(stableRowKey(right)))
  const newestPublication = akshareFinancialRowPublication(ranked[0]!) ?? ''
  const newest = ranked.filter((row) => (akshareFinancialRowPublication(row) ?? '') === newestPublication)
  return sameVersionConflict(newest)
}
/** All financial projections use the same exact-period, correction-aware row. */
export function selectAkshareFinancialRow(value: unknown, endDate: string): Record<string, unknown> | undefined {
  if (hasConflictingAkshareFinancialVersion(value, endDate)) return undefined
  return rowsOf(value).filter((row) => normalizeAksharePeriod(valueFor(row, PERIOD_FIELDS)) === endDate).sort((left, right) => {
    const leftPublication = akshareFinancialRowPublication(left) ?? ''
    const rightPublication = akshareFinancialRowPublication(right) ?? ''
    return rightPublication.localeCompare(leftPublication) || stableRowKey(left).localeCompare(stableRowKey(right))
  })[0]
}
function normalizedMetricValue(value: unknown, metric: keyof typeof FIELD_ALIASES): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return metric === 'gross_margin' && Math.abs(value) <= 1 && value !== 0 ? value * 100 : value
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').replace(/,/g, '').trim()
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(亿元|亿|万元|万|元\/股|元|CNY|%)?$/i.exec(normalized)
  if (!match) return undefined
  let parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return undefined
  const unit = (match[2] ?? '').toLowerCase()
  if (metric === 'gross_margin') {
    if (unit !== '%' && Math.abs(parsed) <= 1 && parsed !== 0) parsed *= 100
  } else if (metric === 'revenue' || metric === 'net_profit' || metric === 'operating_cash_flow') {
    if (unit === '亿元' || unit === '亿') parsed *= 100_000_000
    else if (unit === '万元' || unit === '万') parsed *= 10_000
    else if (unit !== '' && unit !== '元' && unit !== 'cny') return undefined
  } else if (unit !== '' && unit !== '元/股' && unit !== '元' && unit !== 'cny') return undefined
  return Number.isFinite(parsed) ? parsed : undefined
}
function snapshot(row: Record<string, unknown>, period: string, sourceCandidateId: string, diagnostics: string[]): FinancialPeriodSnapshot {
  const metrics: Partial<Record<'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', VerifiedFinancialMetric>> = {}
  const definitions: ReadonlyArray<readonly ['revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', EarningsMetricUnit]> = [['revenue', 'CNY'], ['net_profit', 'CNY'], ['gross_margin', 'percent'], ['operating_cash_flow', 'CNY'], ['eps', 'CNY_per_share']]
  for (const [metric, unit] of definitions) {
    const raw = valueFor(row, FIELD_ALIASES[metric]); if (raw === undefined || raw === null || raw === '') continue
    const value = normalizedMetricValue(raw, metric); if (value === undefined) { diagnostics.push(`Malformed or unit-incompatible ${metric} value for ${period}`); continue }
    metrics[metric] = { metric, value, unit, period, comparator: 'eq', calculation: 'observed', sourceCandidateIds: [sourceCandidateId] }
  }
  return { period, metrics }
}

export function normalizeAkshareFinancialData(value: unknown, requested: EarningsPeriodSpec, sourceCandidateId = `akshare-earnings-${requested.key}`): NormalizedFinancialData {
  const diagnostics: string[] = []; const currentDate = requested.endDate; const priorDate = `${requested.fiscalYear - 1}${requested.endDate.slice(4)}`
  const currentRow = selectAkshareFinancialRow(value, currentDate); const priorRow = selectAkshareFinancialRow(value, priorDate)
  if (!currentRow) diagnostics.push(hasConflictingAkshareFinancialVersion(value, currentDate) ? `SOURCE_CONFLICT: conflicting latest numeric rows for ${requested.key}` : `Exact financial period ${requested.key} was not found`)
  if (!priorRow && hasConflictingAkshareFinancialVersion(value, priorDate)) diagnostics.push(`SOURCE_CONFLICT: conflicting latest numeric rows for ${requested.fiscalYear - 1}-${requested.period}`)
  const current = currentRow === undefined ? undefined : snapshot(currentRow, requested.key, sourceCandidateId, diagnostics)
  const priorYear = priorRow === undefined ? undefined : snapshot(priorRow, `${requested.fiscalYear - 1}-${requested.period}`, sourceCandidateId, diagnostics)
  return { requested, ...(current === undefined ? {} : { current }), ...(priorYear === undefined ? {} : { priorYear }), diagnostics, sourceCandidateId }
}
