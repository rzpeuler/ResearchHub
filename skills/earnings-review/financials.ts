export type EarningsPeriod = 'Q1' | 'H1' | 'Q3' | 'FY'
export type EarningsMetricName = 'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps' | 'revenue_yoy' | 'net_profit_yoy' | 'gross_margin_delta_bps' | 'operating_cash_flow_to_net_profit'
export type EarningsMetricUnit = 'CNY' | 'percent' | 'CNY_per_share' | 'basis_points' | 'ratio'

export interface EarningsPeriodSpec { readonly fiscalYear: number; readonly period: EarningsPeriod; readonly key: string; readonly endDate: string }
export interface VerifiedFinancialMetric { readonly metric: EarningsMetricName; readonly value: number; readonly unit: EarningsMetricUnit; readonly period: string; readonly comparator: 'eq' | 'approx'; readonly calculation: 'observed' | 'derived'; readonly sourceCandidateIds: readonly string[] }
export interface FinancialPeriodSnapshot { readonly period: string; readonly metrics: Readonly<Partial<Record<'revenue' | 'net_profit' | 'gross_margin' | 'operating_cash_flow' | 'eps', VerifiedFinancialMetric>>> }
export interface NormalizedFinancialData { readonly requested: EarningsPeriodSpec; readonly current?: FinancialPeriodSnapshot; readonly priorYear?: FinancialPeriodSnapshot; readonly diagnostics: readonly string[]; readonly sourceCandidateId: string }
export interface EarningsComputation { readonly metrics: readonly VerifiedFinancialMetric[]; readonly byMetric: Readonly<Record<string, VerifiedFinancialMetric>>; readonly unavailable: readonly string[] }

const PERIOD_DATES: Readonly<Record<EarningsPeriod, { readonly month: number; readonly day: number }>> = { Q1: { month: 3, day: 31 }, H1: { month: 6, day: 30 }, Q3: { month: 9, day: 30 }, FY: { month: 12, day: 31 } }
const PERIOD_ALIASES: Readonly<Record<EarningsPeriod, readonly string[]>> = { Q1: ['第一季度报告', '一季度报告', '一季度'], H1: ['半年度报告', '半年报', '中期报告'], Q3: ['第三季度报告', '三季度报告', '三季度'], FY: ['年度报告', '年报'] }
export function earningsPeriodSpec(fiscalYear: number, period: EarningsPeriod): EarningsPeriodSpec {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) throw new TypeError('fiscalYear must be an integer between 1900 and 2200')
  if (!Object.prototype.hasOwnProperty.call(PERIOD_DATES, period)) throw new TypeError('period must be Q1, H1, Q3, or FY')
  const date = PERIOD_DATES[period]
  return { fiscalYear, period, key: `${fiscalYear}-${period}`, endDate: `${fiscalYear}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` }
}

export function periodKey(fiscalYear: number, period: EarningsPeriod): string { return earningsPeriodSpec(fiscalYear, period).key }
export function periodTitleAliases(period: EarningsPeriod): readonly string[] { return PERIOD_ALIASES[period] }

function derived(metric: EarningsMetricName, value: number, unit: EarningsMetricUnit, period: string, sourceCandidateId: string): VerifiedFinancialMetric { return { metric, value, unit, period, comparator: 'eq', calculation: 'derived', sourceCandidateIds: [sourceCandidateId] } }
function yoy(current: VerifiedFinancialMetric | undefined, prior: VerifiedFinancialMetric | undefined, metric: EarningsMetricName, period: string, sourceCandidateId: string): VerifiedFinancialMetric | undefined { if (!current || !prior || current.unit !== prior.unit || prior.value === 0) return undefined; const value = (current.value - prior.value) / Math.abs(prior.value) * 100; return Number.isFinite(value) ? derived(metric, value, 'percent', period, sourceCandidateId) : undefined }

export function computeEarningsMetrics(data: NormalizedFinancialData): EarningsComputation {
  const metrics: VerifiedFinancialMetric[] = []; const unavailable: string[] = []; const current = data.current?.metrics ?? {}; const prior = data.priorYear?.metrics ?? {}; const period = data.requested.key; const source = data.sourceCandidateId
  for (const name of ['revenue', 'net_profit', 'gross_margin', 'operating_cash_flow', 'eps'] as const) { const metric = current[name]; if (metric) metrics.push(metric); else unavailable.push(name) }
  const revenueYoy = yoy(current.revenue, prior.revenue, 'revenue_yoy', period, source); revenueYoy ? metrics.push(revenueYoy) : unavailable.push('revenue_yoy')
  const profitYoy = yoy(current.net_profit, prior.net_profit, 'net_profit_yoy', period, source); profitYoy ? metrics.push(profitYoy) : unavailable.push('net_profit_yoy')
  if (current.gross_margin && prior.gross_margin && current.gross_margin.unit === 'percent' && prior.gross_margin.unit === 'percent') metrics.push(derived('gross_margin_delta_bps', (current.gross_margin.value - prior.gross_margin.value) * 100, 'basis_points', period, source)); else unavailable.push('gross_margin_delta_bps')
  if (current.operating_cash_flow && current.net_profit && current.operating_cash_flow.unit === 'CNY' && current.net_profit.unit === 'CNY' && current.net_profit.value !== 0) metrics.push(derived('operating_cash_flow_to_net_profit', current.operating_cash_flow.value / current.net_profit.value, 'ratio', period, source)); else unavailable.push('operating_cash_flow_to_net_profit')
  return { metrics, byMetric: Object.fromEntries(metrics.map((metric) => [metric.metric, metric])), unavailable }
}

export function hasUsableExactPeriod(data: NormalizedFinancialData): boolean { return data.current !== undefined && Object.keys(data.current.metrics).length > 0 }
export function metricStructuredValues(computation: EarningsComputation): readonly Readonly<Record<string, unknown>>[] { return computation.metrics.map((metric) => ({ metric: metric.metric, value: metric.value, unit: metric.unit, period: metric.period, comparator: metric.comparator })) }
