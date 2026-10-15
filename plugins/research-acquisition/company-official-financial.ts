import type { CompanyFinancialObservation } from '../../data/company-research-contracts.ts'
import type { NormalizedResearchSource } from './contracts.ts'

/** Conservative numeric fallback: complete Chinese annual report's main-accounting table only. */
export function extractOfficialAnnualFinancials(source: NormalizedResearchSource): readonly CompanyFinancialObservation[] {
  const yearMatch = source.title.match(/(20\d{2})年?年度报告/)
  if (!yearMatch || /摘要|英文|H股|English/i.test(source.title)) return []
  const year = Number(yearMatch[1])
  const start = source.content.indexOf('主要会计数据')
  if (start < 0) return []
  const text = source.content.slice(start, start + 14_000)
  // Currency and scale must be stated. Never guess whether a bare value means yuan or millions.
  if (!/人民币/.test(text) && !/营业收入[（(]元[）)]/.test(text)) return []
  const scale = /单位\s*[:：]?\s*(?:人民币)?百万元/.test(text) ? 1_000_000 : /单位\s*[:：]?\s*(?:人民币)?万元/.test(text) ? 10_000 : /单位\s*[:：]?\s*(?:人民币)?千元/.test(text) ? 1_000 : /单位\s*[:：]?\s*(?:人民币)?元/.test(text) || /[（(]元[）)]/.test(text) ? 1 : undefined
  if (scale === undefined) return []
  const labels: readonly [RegExp, keyof CompanyFinancialObservation['metrics']][] = [
    [/^营业收入(?:[（(]元[）)])?$/, 'revenue'],
    [/^归属于上市公司股东的净利润(?:[（(]元[）)])?$/, 'netProfit'],
    [/^经营活动产生的现金流量净额(?:[（(]元[）)])?$/, 'operatingCashFlow'],
    [/^总资产(?:[（(]元[）)])?$/, 'assets'],
    [/^归属于上市公司股东的净资产(?:[（(]元[）)])?$/, 'equity'],
  ]
  const metrics: Record<string, number> = {}
  let verifiedHeader = false
  for (const line of text.split('\n')) {
    const plainHeader = line.replace(/\s+/g, '').match(new RegExp(`^${year}年(?:末)?20\\d{2}年`))
    if (plainHeader) { verifiedHeader = true; continue }
    const plainRow = /^\s*(\D+?)\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s+/.exec(line)
    if (!line.trim().startsWith('|') && !plainRow) continue
    const cells = line.trim().startsWith('|') ? line.split('|').slice(1, -1).map((cell) => cell.replace(/<br\s*\/?\s*>/gi, '').replace(/\s+/g, '')) : [plainRow![1]!.replace(/\s+/g, ''), plainRow![2]!]
    if (cells[1]?.match(new RegExp(`^${year}年(?:末|度)?$`))) { verifiedHeader = true; continue }
    if (!verifiedHeader) continue
    for (const [label, metric] of labels) {
      if (!label.test(cells[0] ?? '') || metrics[metric] !== undefined) continue
      const raw = cells[1]?.replace(/,/g, '')
      if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) continue
      metrics[metric] = Number(raw) * scale
    }
  }
  if (metrics.revenue === undefined || metrics.netProfit === undefined) return []
  return [{ periodEnd: `${year}-12-31`, ...(source.candidate.publishedAt ? { publishedAt: source.candidate.publishedAt } : {}), metrics, metricMetadata: Object.fromEntries(Object.keys(metrics).map((key) => [key, { unit: 'CNY', currency: 'CNY', basis: key === 'assets' || key === 'equity' ? 'POINT_IN_TIME' as const : 'YTD' as const }])), pointInTimeSafe: false, pointInTimeStatus: 'UNVERIFIED' }]
}
