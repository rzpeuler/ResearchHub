import { earningsPeriodSpec, type EarningsPeriodSpec } from '../../skills/earnings-review/financials.ts'
import { normalizeAksharePeriod, selectAkshareFinancialRow } from './earnings-financial-normalization.ts'
import type { FinancialQualityPeriodFacts, NormalizedFinancialQualityData } from '../../skills/earnings-review/financial-quality/contracts.ts'

const PERIOD_FIELDS = ['报告期', '报告日期', '报告期末', '日期', 'date', 'end_date', 'report_date', 'period', 'fiscal_period'] as const

const FIELD_ALIASES: Readonly<Record<keyof Omit<FinancialQualityPeriodFacts, 'period' | 'daysInPeriod'>, readonly string[]>> = {
  revenue: ['营业收入', '营业总收入', '主营业务收入', 'operating_revenue', 'total_operating_revenue', 'revenue'],
  cogs: ['营业成本', '主营业务成本', 'operating_cost', 'cost_of_revenue', 'cogs'],
  netIncome: ['净利润', '归属于上市公司股东的净利润', 'net_profit', 'net income', 'net_income'],
  cashFromOperations: ['经营活动产生的现金流量净额', '经营活动现金流量净额', 'net_cash_flows_from_operating_activities', 'operating_cash_flow', 'cash_from_operations'],
  capex: ['购建固定资产、无形资产和其他长期资产支付的现金', 'capital_expenditure', 'capex'],
  receivables: ['应收账款', '应收帐款', 'accounts_receivable', 'receivables'],
  inventory: ['存货', 'inventory'],
  payables: ['应付账款', '应付帐款', 'accounts_payable', 'payables'],
  contractAssets: ['合同资产', 'contract_assets'],
  deferredRevenue: ['合同负债', 'deferred_revenue', 'contract_liabilities'],
  totalAssets: ['总资产(元)', '总资产', '资产总计', 'total_assets', 'totalAssets'],
}

type FinancialAmountField = keyof typeof FIELD_ALIASES

function rowsOf(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).data)) return rowsOf((value as Record<string, unknown>).data)
  return []
}

function valueFor(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const alias = aliases.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate] !== undefined && row[candidate] !== null && row[candidate] !== '')
  return alias === undefined ? undefined : row[alias]
}

function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const normalized = value.trim().replace(/,/g, '')
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rowForDate(rows: readonly Record<string, unknown>[], date: string, diagnostics: string[], label: string): Record<string, unknown> | undefined {
  const matching = rows.filter((row) => normalizeAksharePeriod(valueFor(row, PERIOD_FIELDS)) === date)
  if (matching.length > 1) diagnostics.push(`Multiple exact ${label} rows found for ${date}; selected deterministic row`)
  return selectAkshareFinancialRow(matching, date)
}

function daysInPeriod(fiscalYear: number, period: EarningsPeriodSpec['period']): number {
  const endDate = earningsPeriodSpec(fiscalYear, period).endDate
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  const start = Date.parse(`${fiscalYear}-01-01T00:00:00.000Z`)
  return Math.floor((end - start) / 86_400_000) + 1
}

function amountFor(row: Record<string, unknown>, field: FinancialAmountField, period: string, diagnostics: string[]): number | undefined {
  const raw = valueFor(row, FIELD_ALIASES[field])
  if (raw === undefined) return undefined
  const parsed = parseAmount(raw)
  if (parsed === undefined) diagnostics.push(`Malformed ${field} value for ${period}`)
  return parsed
}

function factsFor(row: Record<string, unknown> | undefined, fiscalYear: number, period: EarningsPeriodSpec['period'], periodKey: string, diagnostics: string[]): FinancialQualityPeriodFacts | undefined {
  if (row === undefined) return undefined
  const facts: FinancialQualityPeriodFacts = {
    period: periodKey,
    daysInPeriod: daysInPeriod(fiscalYear, period),
    ...Object.fromEntries((Object.keys(FIELD_ALIASES) as FinancialAmountField[]).flatMap((field) => {
      const value = amountFor(row, field, periodKey, diagnostics)
      return value === undefined ? [] : [[field, value]]
    })),
  } as FinancialQualityPeriodFacts
  return facts
}

/** Normalize only explicit raw accounting amounts from the already-acquired AKShare payload. */
export function normalizeFinancialQualityData(value: unknown, requested: EarningsPeriodSpec, sourceCandidateId: string): NormalizedFinancialQualityData {
  const rows = rowsOf(value)
  const diagnostics: string[] = []
  const openingDate = earningsPeriodSpec(requested.fiscalYear - 1, 'FY').endDate
  const priorComparableDate = earningsPeriodSpec(requested.fiscalYear - 1, requested.period).endDate
  const currentRow = rowForDate(rows, requested.endDate, diagnostics, 'current')
  const openingRow = rowForDate(rows, openingDate, diagnostics, 'opening')
  const priorComparableRow = rowForDate(rows, priorComparableDate, diagnostics, 'prior-comparable')
  if (currentRow === undefined) diagnostics.push(`Exact financial-quality period ${requested.key} was not found`)
  if (openingRow === undefined) diagnostics.push(`Opening financial-quality period ${requested.fiscalYear - 1}-FY was not found`)
  if (priorComparableRow === undefined) diagnostics.push(`Prior-comparable financial-quality period ${requested.fiscalYear - 1}-${requested.period} was not found`)
  const current = factsFor(currentRow, requested.fiscalYear, requested.period, requested.key, diagnostics)
  const opening = factsFor(openingRow, requested.fiscalYear - 1, 'FY', `${requested.fiscalYear - 1}-FY`, diagnostics)
  const priorComparable = factsFor(priorComparableRow, requested.fiscalYear - 1, requested.period, `${requested.fiscalYear - 1}-${requested.period}`, diagnostics)
  return { sourceCandidateId, diagnostics, ...(current === undefined ? {} : { current }), ...(opening === undefined ? {} : { opening }), ...(priorComparable === undefined ? {} : { priorComparable }) }
}
