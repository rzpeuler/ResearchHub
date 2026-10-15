import { calculateFinancialQualityAnalysis } from '../../skills/financial_quality_analysis/calculations.ts'
import { calculateBusinessDriverAnalysis } from '../../skills/business_driver_analysis/calculations.ts'
import { assessCapitalAllocation } from '../../skills/capital_allocation_review/calculations.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import type { FinancialQualityPeriodFacts } from '../../skills/earnings-review/financial-quality/contracts.ts'

/** Prepare attributed calculator inputs; no provider access or inferred financial facts. */
export function prepareCompanyFinancialAnalysis(input: CompanyResearchInput) {
  const source = input.sources.find(s => (s.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined)?.metricId === 'company_financial_history')
  const rows = [...(input.financialData ?? [])].filter(r => r.periodEnd).sort((a,b) => b.periodEnd!.localeCompare(a.periodEnd!))
  const current = rows[0]
  const priorDate = current?.periodEnd?.replace(/^\d{4}/, y => String(Number(y)-1))
  const prior = rows.find(r => r.periodEnd === priorDate)
  const opening = rows.find(r => r.periodEnd === `${Number(current?.periodEnd?.slice(0,4))-1}-12-31`)
  const sourceId = source?.candidate.candidateId ?? ''
  const refs = sourceId ? [sourceId] : []
  const gaps: string[] = []
  const number = (row: typeof current | undefined, key: string): number | undefined => {
    if (row?.sourceConflicts?.some(conflict => conflict.metric === key)) return undefined
    const value = (row?.metrics as Record<string, unknown> | undefined)?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const money = (row: typeof current | undefined, key: string): number | undefined => {
    const metadata = row?.metricMetadata?.[key]
    const anchor = ['revenue','netProfit','operatingCashFlow'].map(metric=>row?.metricMetadata?.[metric]).find(meta=>meta && meta.unit!=='UNKNOWN' && meta.currency!=='UNKNOWN')
    const expectedBasis = ['receivables','inventory','payables','assets','liabilities','equity','cash'].includes(key) ? 'POINT_IN_TIME' : 'YTD'
    if (!refs.length || !metadata || !anchor || metadata.unit!==anchor.unit || metadata.currency!==anchor.currency || metadata.basis!==expectedBasis) {
      if (number(row,key)!==undefined) gaps.push(`${row?.periodEnd}:${key}:unit/currency/basis unavailable or incompatible`)
      return undefined
    }
    return number(row,key)
  }
  const facts = (row: typeof current | undefined): FinancialQualityPeriodFacts | undefined => {
    if (!row?.periodEnd) return undefined
    const year = Number(row.periodEnd.slice(0,4))
    const daysInPeriod = Math.round((Date.parse(`${row.periodEnd}T00:00:00Z`)-Date.UTC(year,0,1))/86400000)+1
    return { period: row.periodEnd, daysInPeriod, revenue: money(row,'revenue'), netIncome: money(row,'netProfit'), cashFromOperations: money(row,'operatingCashFlow'), capex: money(row,'capex'), receivables: money(row,'receivables'), inventory: money(row,'inventory'), payables: money(row,'payables'), totalAssets: money(row,'assets'), cogs: money(row,'cogs') }
  }
  const table = rows.slice(0,12).map(row => ({ period: row!.periodEnd, publishedAt: row!.publishedAt, metrics: row!.metrics, metadata: row!.metricMetadata ?? {}, conflicts: row!.sourceConflicts ?? [], pointInTimeStatus: row!.pointInTimeStatus }))
  const periodRatios=rows.slice(0,12).map(row=>{
    const revenue=money(row,'revenue'), cogs=money(row,'cogs'), income=money(row,'netProfit'),rd=money(row,'researchDevelopment'),assets=money(row,'assets'),liabilities=money(row,'liabilities'),capex=money(row,'capex'),operatingCash=money(row,'operatingCashFlow')
    return {period:row.periodEnd,sourceCandidateIds:refs,...(revenue && income!==undefined?{netMarginPercent:income/revenue*100}:{}),...(revenue && cogs!==undefined?{grossMarginPercent:(revenue-cogs)/revenue*100}:{}),...(revenue && rd!==undefined?{researchDevelopmentIntensityPercent:rd/revenue*100}:{}),...(assets && liabilities!==undefined?{liabilitiesToAssetsPercent:liabilities/assets*100}:{}),...(operatingCash!==undefined && operatingCash>0 && capex!==undefined && capex>=0?{capexToOperatingCashFlowMultiple:capex/operatingCash}:{})}
  })
  const financialQuality = calculateFinancialQualityAnalysis({ data: { current: facts(current), opening: facts(opening), priorComparable: facts(prior), sourceCandidateId: sourceId, diagnostics: sourceId ? [] : ['No attributable financial source'] }, revenueRecognitionDivergenceThreshold: 0.1 })
  const periodGrowth = (currentRow: typeof current | undefined, priorRow: typeof current | undefined) => ['revenue','netProfit','operatingProfit','operatingCashFlow','receivables','inventory','assets','liabilities','capex','researchDevelopment'].flatMap(metric => {
    const a=number(currentRow,metric), b=number(priorRow,metric)
    const meta=currentRow?.metricMetadata?.[metric], priorMeta=priorRow?.metricMetadata?.[metric]
    const comparable=meta && priorMeta && meta.unit!=='UNKNOWN' && meta.currency!=='UNKNOWN' && meta.unit===priorMeta.unit && meta.currency===priorMeta.currency && meta.basis===priorMeta.basis && meta.basis!=='UNKNOWN'
    return comparable && a !== undefined && b !== undefined && b !== 0 ? [{ metric, currentPeriod: currentRow!.periodEnd, priorPeriod: priorRow!.periodEnd, unit:meta.unit,currency:meta.currency,basis:meta.basis,delta: a-b, growthPercent: (a-b)/Math.abs(b)*100, sourceCandidateIds: refs }] : []
  })
  const growth = periodGrowth(current, prior)
  // Full-year comparisons stay distinct from the latest cumulative-period result.
  // Exact prior year-end, disclosed units/bases and conflict-free values are mandatory.
  const annualGrowth = refs.length ? rows.filter(row => row.periodEnd!.endsWith('-12-31')).flatMap(row => {
    const priorEnd = row.periodEnd!.replace(/^\d{4}/, year => String(Number(year) - 1))
    return periodGrowth(row, rows.find(candidate => candidate.periodEnd === priorEnd)).filter(item => item.basis === (['receivables','inventory','assets','liabilities'].includes(item.metric) ? 'POINT_IN_TIME' : 'YTD'))
  }) : []
  const currentRatios = periodRatios.find(row => row.period === current?.periodEnd)
  const priorRatios = periodRatios.find(row => row.period === prior?.periodEnd)
  const ratioChanges = ['netMarginPercent','grossMarginPercent','researchDevelopmentIntensityPercent','liabilitiesToAssetsPercent'].flatMap(metric => {
    const a = (currentRatios as Record<string, unknown> | undefined)?.[metric], b = (priorRatios as Record<string, unknown> | undefined)?.[metric]
    return typeof a === 'number' && typeof b === 'number' ? [{metric,currentPeriod:current!.periodEnd,priorPeriod:prior!.periodEnd,changePercentagePoints:a-b,sourceCandidateIds:refs}] : []
  })
  const growthSpreads = [['receivables','revenue'],['revenue','operatingCashFlow']] as const
  const growthDivergences = growthSpreads.flatMap(([leftMetric,rightMetric]) => {
    const left = growth.find(item => item.metric === leftMetric), right = growth.find(item => item.metric === rightMetric)
    return left && right ? [{leftMetric,rightMetric,currentPeriod:left.currentPeriod,priorPeriod:left.priorPeriod,unit:'percentage_points',value:left.growthPercent-right.growthPercent,formula:`${leftMetric}同比% - ${rightMetric}同比%`,sourceCandidateIds:refs,interpretation:'仅为增长背离核查信号，不代表已归因的现金或收入质量结论。'}] : []
  })
  const revenueComparable=growth.some(item=>item.metric==='revenue')
  const businessDrivers = calculateBusinessDriverAnalysis({ companyRef: input.company.symbol, currentPeriod: current?.periodEnd ?? 'unavailable', priorPeriod: prior?.periodEnd ?? 'unavailable', asOf: input.asOf, segments: current && prior && revenueComparable && refs.length ? [{ id:'consolidated',name:'合并口径',outcomes: [{metric:'revenue',unit:current.metricMetadata!.revenue!.unit,currentValue:money(current,'revenue'),priorValue:money(prior,'revenue'),currentSourceRefs:refs,priorSourceRefs:refs}],drivers:[] }] : [] })
  const actions = current ? (['capex','researchDevelopment'] as const).flatMap(key => {
    const amount = money(current,key)
    return amount !== undefined && amount >= 0 && refs.length ? [{id:key,actionType:key==='capex'?'organic_capex' as const:'R&D' as const,date:current.publishedAt ?? current.periodEnd!,period:current.periodEnd!,amount,unit:current.metricMetadata![key]!.unit,sourceRefs:refs}] : []
  }) : []
  const capitalAllocation = assessCapitalAllocation({ companyRef:input.company.symbol,period:current?.periodEnd ?? 'unavailable',actions,context:{currentRevenue:money(current,'revenue'),currentNetIncome:money(current,'netProfit'),sourceRefs:refs},asOf:input.asOf })
  const display = renderCompanyFinancialTable(input)
  return { table, financialReadableTable: display?.markdown, financialDisplayAmounts: display?.numericDisplayAmounts ?? [], periodRatios, ratioChanges, growthDivergences, growth, annualGrowth, financialQuality, businessDrivers, capitalAllocation, limitations: ['同比仅比较同一期间末的供应商披露值；累计口径不得解释为单季度。', '缺失单位、期间基础或科目不得补零；未归因增长保持显式残差。',...new Set(gaps)] }
}

export interface CompanyFinancialDisplayAmount {
  readonly metric: string
  readonly period: string
  readonly unit: '亿元'
  readonly currency: 'CNY'
  readonly basis: 'YTD' | 'POINT_IN_TIME'
  readonly value: number
  readonly sourceCandidateId: string
}

/** Render disclosed values directly; semantic output cannot silently change their unit or period. */
export function renderCompanyFinancialTable(input: CompanyResearchInput): { markdown: string; sourceCandidateId: string; numericDisplayAmounts: readonly CompanyFinancialDisplayAmount[] } | undefined {
  const source = input.sources.find(item => (item.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined)?.metricId === 'company_financial_history')
  if (!source) return undefined
  const all = [...(input.financialData ?? [])].filter(row => row.periodEnd).sort((a, b) => b.periodEnd!.localeCompare(a.periodEnd!))
  const latest = all[0]
  if (!latest) return undefined
  const prior = latest.periodEnd!.replace(/^\d{4}/, year => String(Number(year) - 1))
  const rows = all.filter(row => row === latest || row.periodEnd === prior || row.periodEnd!.endsWith('-12-31')).slice(0, 4)
  const metrics = [['revenue', '营业收入'], ['netProfit', '归母净利润'], ['operatingCashFlow', '经营现金净流量'], ['capex', '购建长期资产现金支出'], ['researchDevelopment', '研发费用'], ['assets', '总资产'], ['liabilities', '总负债'], ['cash', '货币资金'], ['receivables', '应收账款'], ['inventory', '存货'], ['shortTermBorrowings','短期借款'], ['longTermBorrowings','长期借款'], ['bondsPayable','应付债券'], ['currentPortionLongTermDebt','一年内到期非流动负债（含非借款项目）']] as const
  const numericDisplayAmounts: CompanyFinancialDisplayAmount[] = []
  const cell = (row: typeof latest, metric: string): string => {
    const value = (row.metrics as Record<string, unknown>)[metric]
    const meta = row.metricMetadata?.[metric]
    const expectedBasis = ['assets', 'liabilities', 'cash', 'receivables', 'inventory', 'shortTermBorrowings', 'longTermBorrowings', 'bondsPayable', 'currentPortionLongTermDebt'].includes(metric) ? 'POINT_IN_TIME' : 'YTD'
    if (row.sourceConflicts?.some(conflict => conflict.metric === metric)) return '来源冲突，待核实'
    const scales: Record<string, number> = { CNY: 1, '元': 1, '万元': 1e4, '亿元': 1e8 }
    if (typeof value !== 'number' || !Number.isFinite(value) || !meta || meta.currency !== 'CNY' || scales[meta.unit] === undefined || meta.basis !== expectedBasis) return '未取得可用口径'
    const scale = scales[meta.unit]!
    const displayValue = Number((value * scale / 1e8).toFixed(2))
    numericDisplayAmounts.push({ metric, period: row.periodEnd!, unit: '亿元', currency: 'CNY', basis: expectedBasis, value: displayValue, sourceCandidateId: source.candidate.candidateId })
    return displayValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const markdown = `确定性财务摘要（人民币亿元；损益及现金流为年初至期末累计，资产负债为期末余额；缺失与冲突不补零）。[${source.candidate.candidateId}@paragraph:1]\n\n| 指标 | ${rows.map(row => row.periodEnd).join(' | ')} |\n|---|${rows.map(() => '---:').join('|')}|\n${metrics.map(([metric, label]) => `| ${label} | ${rows.map(row => cell(row, metric)).join(' | ')} |`).join('\n')}`
  return { sourceCandidateId: source.candidate.candidateId, markdown, numericDisplayAmounts }
}
