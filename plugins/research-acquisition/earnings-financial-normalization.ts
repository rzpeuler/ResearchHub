import type { EarningsMetricUnit, EarningsPeriodSpec, FinancialPeriodSnapshot, NormalizedFinancialData, VerifiedFinancialMetric } from '../../skills/earnings-review/financials.ts'
import { normalizeEastmoneyTimestamp } from './expectations/eastmoney-report.ts'

const FIELD_ALIASES: Readonly<Record<'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', readonly string[]>> = {
  revenue: ['营业总收入', '营业收入', 'total_operating_revenue', 'operating_revenue', 'revenue'],
  net_profit: ['净利润', '归属于上市公司股东的净利润', 'net_profit', 'net profit'],
  gross_margin: ['销售毛利率', '毛利率', 'gross_margin', 'gross profit margin'],
  operating_cash_flow: ['经营活动产生的现金流量净额', '经营活动现金流量净额', 'net_cash_flows_from_operating_activities', 'operating_cash_flow'],
  eps: ['基本每股收益', '基本每股收益(元)', 'basic_eps', 'eps'],
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
/** All financial projections use the same exact-period, correction-aware row. */
export function selectAkshareFinancialRow(value: unknown, endDate: string): Record<string, unknown> | undefined {
  return rowsOf(value).filter((row) => normalizeAksharePeriod(valueFor(row, PERIOD_FIELDS)) === endDate).sort((left, right) => {
    const leftPublication = akshareFinancialRowPublication(left) ?? ''
    const rightPublication = akshareFinancialRowPublication(right) ?? ''
    return rightPublication.localeCompare(leftPublication) || stableRowKey(left).localeCompare(stableRowKey(right))
  })[0]
}
function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const normalized = value.trim().replace(/,/g, '')
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(normalized)) return undefined
  const parsed = Number(normalized.replace(/%$/, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}
function snapshot(row: Record<string, unknown>, period: string, sourceCandidateId: string, diagnostics: string[]): FinancialPeriodSnapshot {
  const metrics: Partial<Record<'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', VerifiedFinancialMetric>> = {}
  const definitions: ReadonlyArray<readonly ['revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', EarningsMetricUnit]> = [['revenue', 'CNY'], ['net_profit', 'CNY'], ['gross_margin', 'percent'], ['operating_cash_flow', 'CNY'], ['eps', 'CNY_per_share']]
  for (const [metric, unit] of definitions) {
    const raw = valueFor(row, FIELD_ALIASES[metric]); if (raw === undefined || raw === null || raw === '') continue
    const value = numberValue(raw); if (value === undefined) { diagnostics.push(`Malformed ${metric} value for ${period}`); continue }
    metrics[metric] = { metric, value, unit, period, comparator: 'eq', calculation: 'observed', sourceCandidateIds: [sourceCandidateId] }
  }
  return { period, metrics }
}

export function normalizeAkshareFinancialData(value: unknown, requested: EarningsPeriodSpec, sourceCandidateId = `akshare-earnings-${requested.key}`): NormalizedFinancialData {
  const diagnostics: string[] = []; const currentDate = requested.endDate; const priorDate = `${requested.fiscalYear - 1}${requested.endDate.slice(4)}`
  const currentRow = selectAkshareFinancialRow(value, currentDate); const priorRow = selectAkshareFinancialRow(value, priorDate)
  if (!currentRow) diagnostics.push(`Exact financial period ${requested.key} was not found`)
  const current = currentRow === undefined ? undefined : snapshot(currentRow, requested.key, sourceCandidateId, diagnostics)
  const priorYear = priorRow === undefined ? undefined : snapshot(priorRow, `${requested.fiscalYear - 1}-${requested.period}`, sourceCandidateId, diagnostics)
  return { requested, ...(current === undefined ? {} : { current }), ...(priorYear === undefined ? {} : { priorYear }), diagnostics, sourceCandidateId }
}
