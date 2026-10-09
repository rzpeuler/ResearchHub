import type { ValuationFinancialRow, ValuationMarketObservation } from '../../skills/valuation/financials.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'

type Dict = Record<string, unknown>
const DATE_ALIASES = ['报告期', '报告日期', '报告期末', '日期', 'date', 'end_date', 'report_date', 'REPORT_DATE', 'period', 'fiscal_period'] as const
const PUBLICATION_ALIASES = ['公告日期', '公告日', '公告时间', 'publicationDate', 'publication_date', 'announcementDate', 'announcement_date', 'publish_date'] as const
const AGGREGATOR_NOTICE_ALIASES = ['aggregatorNoticeDate', 'aggregator_notice_date', 'NOTICE_DATE'] as const
const MARKET_DATE_ALIASES = ['日期', 'date', 'trade_date', '交易日期'] as const
const CLOSE_ALIASES = ['收盘', '收盘价', 'close', 'Close', '收盘价(元)'] as const
const EPS_ALIASES = ['基本每股收益', '基本每股收益(元)', 'EPS', 'eps', 'basic_eps', 'eps_jb', 'EPSJB'] as const
const BVPS_ALIASES = ['每股净资产', '每股净资产(元)', 'BVPS', 'bvps', 'book_value_per_share', 'BPS'] as const
const EBITDA_ALIASES = ['EBITDA', 'ebitda', '息税折旧摊销前利润', '息税折旧摊销前利润(EBITDA)'] as const
const NET_DEBT_ALIASES = ['净负债', '净负债(元)', 'net_debt', 'netDebt', 'net debt'] as const
const SHARES_ALIASES = ['总股本', '股本', 'shares', 'shares_outstanding', 'sharesOutstanding'] as const

function rowsOf(value: unknown): readonly Dict[] {
  if (Array.isArray(value)) return value.filter((item): item is Dict => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Dict).data)) return rowsOf((value as Dict).data)
  return []
}
function first(row: Dict, aliases: readonly string[]): unknown { for (const alias of aliases) if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias]; return undefined }
function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value.trim().replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}
export function normalizeValuationDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  const epoch = typeof value === 'number'
    ? Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) >= 1_000_000_000 ? value : undefined
    : /^-?\d{10}(?:\d{3})?$/.test(raw) ? Number(raw) : undefined
  if (epoch !== undefined) {
    const milliseconds = Math.abs(epoch) >= 1_000_000_000_000 ? epoch : epoch * 1_000
    const timestamp = new Date(milliseconds)
    return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString().slice(0, 10)
  }
  const match = /^(\d{4})(?:-|年)?(\d{1,2})(?:-|月)?(\d{1,2})(?:日)?/.exec(raw.replace(/[/.]/g, '-'))
  if (!match) return undefined
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function dateOf(row: Dict, aliases: readonly string[]): string | undefined { return normalizeValuationDate(first(row, aliases)) }

export function normalizeValuationMarketData(value: unknown, valuationDate: string, fixedAsOf?: string): { readonly observation?: ValuationMarketObservation; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = []; const candidates = rowsOf(value).map((row) => ({ date: dateOf(row, MARKET_DATE_ALIASES), close: numberValue(first(row, CLOSE_ALIASES)) })).filter((item): item is { date: string; close: number } => item.date !== undefined && item.close !== undefined && item.close > 0 && Number.isFinite(item.close) && (fixedAsOf === undefined ? item.date <= valuationDate : Date.parse(dailyCloseAvailableAt(item.date)) <= Date.parse(fixedAsOf))).sort((left, right) => left.date.localeCompare(right.date))
  if (candidates.length === 0) { diagnostics.push('VALUATION_MARKET_PRICE_UNAVAILABLE'); return { diagnostics } }
  const selected = candidates[candidates.length - 1]!; return { observation: { priceDate: selected.date, close: selected.close }, diagnostics }
}

export function normalizeValuationFinancialData(value: unknown): { readonly rows: readonly ValuationFinancialRow[]; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = []; const rows: ValuationFinancialRow[] = []
  for (const row of rowsOf(value)) {
    const reportDate = dateOf(row, DATE_ALIASES); if (reportDate === undefined || !reportDate.endsWith('-12-31')) continue
    const publicationDate = dateOf(row, PUBLICATION_ALIASES); const aggregatorNoticeDate = dateOf(row, AGGREGATOR_NOTICE_ALIASES); const parsed = { basisFiscalYear: Number(reportDate.slice(0, 4)), reportDate, ...(publicationDate === undefined ? {} : { publicationDate }), ...(aggregatorNoticeDate === undefined ? {} : { aggregatorNoticeDate }), ...(numberValue(first(row, EPS_ALIASES)) === undefined ? {} : { eps: numberValue(first(row, EPS_ALIASES)) }), ...(numberValue(first(row, BVPS_ALIASES)) === undefined ? {} : { bvps: numberValue(first(row, BVPS_ALIASES)) }), ...(numberValue(first(row, EBITDA_ALIASES)) === undefined ? {} : { ebitda: numberValue(first(row, EBITDA_ALIASES)) }), ...(numberValue(first(row, NET_DEBT_ALIASES)) === undefined ? {} : { netDebt: numberValue(first(row, NET_DEBT_ALIASES)) }), ...(numberValue(first(row, SHARES_ALIASES)) === undefined ? {} : { shares: numberValue(first(row, SHARES_ALIASES)) }) }
    rows.push(parsed)
  }
  if (rows.length === 0) diagnostics.push('VALUATION_FINANCIAL_BASIS_UNAVAILABLE')
  return { rows: rows.sort((left, right) => right.basisFiscalYear - left.basisFiscalYear), diagnostics }
}
