import { calculateFinancialQualityAnalysis } from '../../skills/financial_quality_analysis/calculations.ts'
import { calculateBusinessDriverAnalysis } from '../../skills/business_driver_analysis/calculations.ts'
import { assessCapitalAllocation } from '../../skills/capital_allocation_review/calculations.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import type { FinancialQualityPeriodFacts } from '../../skills/earnings-review/financial-quality/contracts.ts'

/** Prepare attributed calculator inputs; no provider access or inferred financial facts. */
function calculateCompanyFinancialAnalysis(input: CompanyResearchInput) {
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
    if (typeof a !== 'number' || typeof b !== 'number') return []
    const displayCurrentValue = Number(a.toFixed(2)), displayPriorValue = Number(b.toFixed(2))
    return [{metric,currentPeriod:current!.periodEnd,priorPeriod:prior!.periodEnd,currentValue:a,priorValue:b,changePercentagePoints:a-b,displayChangePercentagePoints:Number((displayCurrentValue-displayPriorValue).toFixed(2)),sourceCandidateIds:refs}]
  })
  const growthSpreads = [['receivables','revenue'],['inventory','revenue'],['revenue','operatingCashFlow']] as const
  const growthDivergences = growthSpreads.flatMap(([leftMetric,rightMetric]) => {
    const left = growth.find(item => item.metric === leftMetric), right = growth.find(item => item.metric === rightMetric)
    if (!left || !right) return []
    const displayLeftRate = Number(left.growthPercent.toFixed(4))
    const displayRightRate = Number(right.growthPercent.toFixed(4))
    const displayValue = Number((displayLeftRate - displayRightRate).toFixed(4))
    return [{leftMetric,rightMetric,currentPeriod:left.currentPeriod,priorPeriod:left.priorPeriod,unit:'percentage_points',value:left.growthPercent-right.growthPercent,displayValue,formula:`${leftMetric}同比% - ${rightMetric}同比%`,sourceCandidateIds:refs,interpretation:'仅为增长背离核查信号，不代表已归因的现金或收入质量结论。'}]
  })
  const revenueComparable=growth.some(item=>item.metric==='revenue')
  const businessDrivers = calculateBusinessDriverAnalysis({ companyRef: input.company.symbol, currentPeriod: current?.periodEnd ?? 'unavailable', priorPeriod: prior?.periodEnd ?? 'unavailable', asOf: input.asOf, segments: current && prior && revenueComparable && refs.length ? [{ id:'consolidated',name:'合并口径',outcomes: [{metric:'revenue',unit:current.metricMetadata!.revenue!.unit,currentValue:money(current,'revenue'),priorValue:money(prior,'revenue'),currentSourceRefs:refs,priorSourceRefs:refs}],drivers:[] }] : [] })
  const actions = current ? (['capex','researchDevelopment'] as const).flatMap(key => {
    const amount = money(current,key)
    return amount !== undefined && amount >= 0 && refs.length ? [{id:key,actionType:key==='capex'?'organic_capex' as const:'R&D' as const,date:current.publishedAt ?? current.periodEnd!,period:current.periodEnd!,amount,unit:current.metricMetadata![key]!.unit,sourceRefs:refs}] : []
  }) : []
  const capitalAllocation = assessCapitalAllocation({ companyRef:input.company.symbol,period:current?.periodEnd ?? 'unavailable',actions,context:{currentRevenue:money(current,'revenue'),currentNetIncome:money(current,'netProfit'),sourceRefs:refs},asOf:input.asOf })
  const simpleFreeCashFlow = rows.flatMap(row => {
    const operatingCashFlow = money(row,'operatingCashFlow')
    const capex = money(row,'capex')
    if (!row.periodEnd || operatingCashFlow === undefined || capex === undefined) return []
    const value = operatingCashFlow-capex
    const formatYuan = (amount: number) => (amount/1e8).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
    return [{period:row.periodEnd,basis:'YTD',unit:'CNY',operatingCashFlow,capex,value,displayUnit:'亿元',displayOperatingCashFlow:formatYuan(operatingCashFlow),displayCapex:formatYuan(capex),displayValue:formatYuan(value),formula:`${formatYuan(operatingCashFlow)}亿元−${formatYuan(capex)}亿元＝${formatYuan(value)}亿元`,sourceCandidateIds:refs,limitation:'仅为经营现金净流量减购建长期资产现金支出的简化覆盖指标，不是FCFF；不得年化累计期间。'}]
  })
  const workingCapitalCalculations: { metric: 'DSO' | 'DIO' | 'DPO' | 'CCC'; period: string; daysInPeriod: number; value: number; formula: string; sourceCandidateIds: readonly string[] }[] = []
  const working = financialQuality.summary.workingCapital
  const currentFacts = facts(current), openingFacts = facts(opening)
  const raw = (value: number | undefined) => value?.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: true })
  if (currentFacts?.period && openingFacts && currentFacts.daysInPeriod && working.dso !== undefined && currentFacts.receivables !== undefined && openingFacts.receivables !== undefined && currentFacts.revenue !== undefined) {
    workingCapitalCalculations.push({ metric: 'DSO', period: currentFacts.period, daysInPeriod: currentFacts.daysInPeriod, value: working.dso, formula: `((期初应收${raw(openingFacts.receivables)}元＋期末应收${raw(currentFacts.receivables)}元)÷2)÷本期累计收入${raw(currentFacts.revenue)}元×${currentFacts.daysInPeriod}天＝${working.dso.toFixed(2)}天`, sourceCandidateIds: refs })
  }
  if (currentFacts?.period && openingFacts && currentFacts.daysInPeriod && working.dio !== undefined && currentFacts.inventory !== undefined && openingFacts.inventory !== undefined && currentFacts.cogs !== undefined) {
    workingCapitalCalculations.push({ metric: 'DIO', period: currentFacts.period, daysInPeriod: currentFacts.daysInPeriod, value: working.dio, formula: `((期初存货${raw(openingFacts.inventory)}元＋期末存货${raw(currentFacts.inventory)}元)÷2)÷本期累计营业成本${raw(currentFacts.cogs)}元×${currentFacts.daysInPeriod}天＝${working.dio.toFixed(2)}天`, sourceCandidateIds: refs })
  }
  if (currentFacts?.period && openingFacts && currentFacts.daysInPeriod && working.dpo !== undefined && currentFacts.payables !== undefined && openingFacts.payables !== undefined && currentFacts.cogs !== undefined) {
    workingCapitalCalculations.push({ metric: 'DPO', period: currentFacts.period, daysInPeriod: currentFacts.daysInPeriod, value: working.dpo, formula: `((期初应付${raw(openingFacts.payables)}元＋期末应付${raw(currentFacts.payables)}元)÷2)÷本期累计营业成本${raw(currentFacts.cogs)}元×${currentFacts.daysInPeriod}天＝${working.dpo.toFixed(2)}天`, sourceCandidateIds: refs })
  }
  if (currentFacts?.period && currentFacts.daysInPeriod && working.cashConversionCycle !== undefined && working.dso !== undefined && working.dio !== undefined && working.dpo !== undefined) {
    workingCapitalCalculations.push({ metric: 'CCC', period: currentFacts.period, daysInPeriod: currentFacts.daysInPeriod, value: working.cashConversionCycle, formula: `DSO ${working.dso.toFixed(2)}天＋DIO ${working.dio.toFixed(2)}天−DPO ${working.dpo.toFixed(2)}天＝${working.cashConversionCycle.toFixed(2)}天`, sourceCandidateIds: refs })
  }
  return { table, periodRatios, ratioChanges, growthDivergences, growth, annualGrowth, financialQuality, workingCapitalCalculations, businessDrivers, capitalAllocation, simpleFreeCashFlow, calculationConventions: {averageAssetsObservationCount:2,accrualAnnualized:false,accrualProfitBasis:'结构化净利润代理；字段未注明是否归母，与合并现金流存在范围差异',freeCashFlowBasis:'经营现金净流量减购建长期资产现金支出；逐期确定性计算，非FCFF',workingCapitalBasis:'DSO/DIO/DPO use average opening and closing balances divided by current cumulative revenue or cost of goods sold, multiplied by current period days'}, limitations: ['同比仅比较同一期间末的供应商披露值；累计口径不得解释为单季度。', '结构化 netProfit/净利润字段未明确归母属性时不得升级为归母净利润。', '缺失单位、期间基础或科目不得补零；未归因增长保持显式残差。',...new Set(gaps)] }
}

export function prepareCompanyFinancialAnalysis(input: CompanyResearchInput) {
  const calculated = calculateCompanyFinancialAnalysis(input)
  const display = renderFinancialTable(input, calculated)
  return {...calculated,financialReadableTable:display?.markdown,financialDisplayAmounts:display?.numericDisplayAmounts ?? []}
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
export function renderCompanyFinancialTable(input: CompanyResearchInput): { markdown: string; openingSummary: string; sourceCandidateId: string; numericDisplayAmounts: readonly CompanyFinancialDisplayAmount[] } | undefined {
  return renderFinancialTable(input, calculateCompanyFinancialAnalysis(input))
}

function renderFinancialTable(input: CompanyResearchInput, calculated: ReturnType<typeof calculateCompanyFinancialAnalysis>): { markdown: string; openingSummary: string; sourceCandidateId: string; numericDisplayAmounts: readonly CompanyFinancialDisplayAmount[] } | undefined {
  const source = input.sources.find(item => (item.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined)?.metricId === 'company_financial_history')
  if (!source) return undefined
  const all = [...(input.financialData ?? [])].filter(row => row.periodEnd).sort((a, b) => b.periodEnd!.localeCompare(a.periodEnd!))
  const latest = all[0]
  if (!latest) return undefined
  const prior = latest.periodEnd!.replace(/^\d{4}/, year => String(Number(year) - 1))
  const rows = all.filter(row => row === latest || row.periodEnd === prior || row.periodEnd!.endsWith('-12-31')).slice(0, 4)
  const metrics = [['revenue', '营业收入'], ['operatingProfit', '营业利润'], ['netProfit', '净利润（结构化字段；归母属性未注明）'], ['operatingCashFlow', '经营现金净流量'], ['capex', '购建长期资产现金支出'], ['researchDevelopment', '研发费用'], ['assets', '总资产'], ['liabilities', '总负债'], ['cash', '货币资金'], ['receivables', '应收账款'], ['inventory', '存货'], ['shortTermBorrowings','短期借款'], ['longTermBorrowings','长期借款'], ['bondsPayable','应付债券'], ['currentPortionLongTermDebt','一年内到期非流动负债（含非借款项目）']] as const
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
  const mainTable = `确定性财务摘要（人民币亿元；损益及现金流为年初至期末累计，资产负债为期末余额；缺失与冲突不补零）。[${source.candidate.candidateId}@paragraph:1]\n\n| 指标 | ${rows.map(row => row.periodEnd).join(' | ')} |\n|---|${rows.map(() => '---:').join('|')}|\n${metrics.map(([metric, label]) => `| ${label} | ${rows.map(row => cell(row, metric)).join(' | ')} |`).join('\n')}`
  const displayAmount = (metric: string, period: string | undefined) => numericDisplayAmounts.find(item => item.metric === metric && item.period === period)?.value
  const format = (value: number) => value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
  const formatPrecise = (value: number) => value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:8})
  const preciseAmount = (metric: (typeof metrics)[number][0], period: string | undefined): number | undefined => {
    const row=all.find(item=>item.periodEnd===period)
    const value=row?.metrics[metric]
    const meta=row?.metricMetadata?.[metric]
    const expectedBasis=['assets','liabilities','cash','receivables','inventory','shortTermBorrowings','longTermBorrowings','bondsPayable','currentPortionLongTermDebt'].includes(metric)?'POINT_IN_TIME':'YTD'
    const scales:Record<string,number>={CNY:1,'元':1,'万元':1e4,'亿元':1e8}
    if(!row||row.sourceConflicts?.some(conflict=>conflict.metric===metric)||typeof value!=='number'||!Number.isFinite(value)||!meta||meta.currency!=='CNY'||meta.basis!==expectedBasis||scales[meta.unit]===undefined)return undefined
    return value*scales[meta.unit]!/1e8
  }
  const formatRate = (value: number) => value.toLocaleString('zh-CN',{minimumFractionDigits:4,maximumFractionDigits:4})
  const reference = `[${source.candidate.candidateId}@paragraph:1]`
  const scopeNotes: string[] = []
  const comparisons = (['revenue','operatingProfit','netProfit','operatingCashFlow','capex','researchDevelopment','receivables','inventory','liabilities'] as const).flatMap(metric => {
    const growth = calculated.growth.find(item => item.metric === metric)
    const current = preciseAmount(metric, latest.periodEnd), previous = preciseAmount(metric, prior)
    if (!growth || current === undefined || previous === undefined || previous === 0) return []
    const label = metrics.find(item => item[0] === metric)![1]
    // Keep displayed period cells concise but make the formula reproduce the
    // calculator result from source precision, rather than from rounded cells.
    // `abs()` makes the denominator rule explicit in the four-column table.
    const formula = `(${formatPrecise(current)}−${formatPrecise(previous)})÷abs(${formatPrecise(previous)})×100%≈${formatRate(growth.growthPercent)}%`
    return [`| ${label}（${growth.basis === 'POINT_IN_TIME' ? '期末余额' : '年初至期末累计'}） | ${format(previous)} | ${format(current)} | ${formula} |`]
  })
  if (comparisons.length) scopeNotes.push(`同期口径复核（人民币亿元）：下表期间金额列四舍五入至两位小数；同比公式使用同一结构化来源的未四舍五入原始金额换算为亿元，并显示足够小数以复核结果。同比仅比较 ${prior} 与 ${latest.periodEnd}，不以并列展示的上年年末余额为同比基期；累计流量也不是单季度。${reference}\n\n| 指标与口径 | 上年同期 ${prior} | 本期 ${latest.periodEnd} | 同比公式及变化 |\n|---|---:|---:|---|\n${comparisons.join('\n')}\n\n余额同比与收入累计同比的增长差仅用于营运资金风险筛查；二者属于不同指标，不能把余额视为累计流量，也不能单凭背离认定回款恶化或收入失实。`)
  const annualCurrentPeriod = all.filter(row=>row.periodEnd!.endsWith('-12-31')).map(row=>row.periodEnd!).sort().at(-1)
  const annualPriorPeriod = annualCurrentPeriod?.replace(/^\d{4}/,year=>String(Number(year)-1))
  const annualRows = annualCurrentPeriod && annualPriorPeriod ? (['revenue','operatingProfit','netProfit','operatingCashFlow'] as const).flatMap(metric=>{
    const growth=calculated.annualGrowth.find(item=>item.metric===metric&&item.currentPeriod===annualCurrentPeriod&&item.priorPeriod===annualPriorPeriod)
    const currentValue=preciseAmount(metric,annualCurrentPeriod),priorValue=preciseAmount(metric,annualPriorPeriod)
    if(!growth||currentValue===undefined||priorValue===undefined)return []
    const label=metrics.find(item=>item[0]===metric)![1]
    const formula=`(${formatPrecise(currentValue)}−${formatPrecise(priorValue)})÷abs(${formatPrecise(priorValue)})×100%＝${formatRate(growth.growthPercent)}%`
    return [`${label}${growth.growthPercent>=0?'增长':'下降'}${Math.abs(growth.growthPercent).toFixed(2)}%（${formula}）`]
  }):[]
  if(annualRows.length)scopeNotes.push(`完整年度同比对照（${annualPriorPeriod}至${annualCurrentPeriod}；人民币亿元，损益及现金流均为全年累计）：${annualRows.join('；')}。其中净利润为结构化字段且归母属性未注明。此为全年对照，与下述最新半年累计期间分开阅读，不把年度反证与半年趋势混作一个期间。${reference}`)
  const netProfitGrowth = calculated.growth.find(item => item.metric === 'netProfit')
  const netProfitCurrent = latest.metrics.netProfit
  const netProfitPrior = all.find(row => row.periodEnd === prior)?.metrics.netProfit
  const netProfitMeta = latest.metricMetadata?.netProfit
  const priorNetProfitMeta = all.find(row => row.periodEnd === prior)?.metricMetadata?.netProfit
  const yuanScale: Record<string, number> = { CNY: 1, '元': 1, '万元': 1e4, '亿元': 1e8 }
  if (netProfitGrowth && typeof netProfitCurrent === 'number' && typeof netProfitPrior === 'number' && netProfitMeta && priorNetProfitMeta && netProfitMeta.unit === priorNetProfitMeta.unit && netProfitMeta.currency === 'CNY' && priorNetProfitMeta.currency === 'CNY' && netProfitMeta.basis === 'YTD' && priorNetProfitMeta.basis === 'YTD' && yuanScale[netProfitMeta.unit] !== undefined) {
    const currentYuan = netProfitCurrent * yuanScale[netProfitMeta.unit]!
    const priorYuan = netProfitPrior * yuanScale[netProfitMeta.unit]!
    const currentText = currentYuan.toLocaleString('zh-CN',{maximumFractionDigits:2})
    const priorText = priorYuan.toLocaleString('zh-CN',{maximumFractionDigits:2})
    scopeNotes.push(`净利润同比复算（结构化净利润字段，归母属性未注明）：（${currentText}元−${priorText}元）÷abs(${priorText}元)×100%＝${formatRate(netProfitGrowth.growthPercent)}%；比较 ${prior} 与 ${latest.periodEnd} 的同口径累计值，公式用原始结构化金额计算；来源 ${reference}`)
  }
  const summary = calculated.financialQuality.summary
  const currentCfo = displayAmount('operatingCashFlow',latest.periodEnd), currentIncome = displayAmount('netProfit',latest.periodEnd), currentCapex = displayAmount('capex',latest.periodEnd)
  const currentAssets = displayAmount('assets',latest.periodEnd)
  const openingDate = `${Number(latest.periodEnd!.slice(0,4))-1}-12-31`
  const openingAssets = displayAmount('assets',openingDate)
  const formulas: string[] = []
  for (const spread of calculated.growthDivergences) {
    const left = calculated.growth.find(item => item.metric === spread.leftMetric)
    const right = calculated.growth.find(item => item.metric === spread.rightMetric)
    if (!left || !right) continue
    const leftLabel = metrics.find(item => item[0] === spread.leftMetric)?.[1] ?? spread.leftMetric
    const rightLabel = metrics.find(item => item[0] === spread.rightMetric)?.[1] ?? spread.rightMetric
    const leftRate = Number(left.growthPercent.toFixed(4)), rightRate = Number(right.growthPercent.toFixed(4))
    formulas.push(`${leftLabel}同比增速与${rightLabel}同比增速差＝${leftLabel}同比增速−${rightLabel}同比增速＝${formatRate(leftRate)}%−(${rightRate<0?'−':''}${formatRate(Math.abs(rightRate))}%)＝${formatRate(spread.displayValue ?? Number((leftRate-rightRate).toFixed(4)))}个百分点（${spread.priorPeriod}至${spread.currentPeriod}；前者为${left.basis==='POINT_IN_TIME'?'期末余额':'累计流量'}，后者为${right.basis==='POINT_IN_TIME'?'期末余额':'累计流量'}）。这是两个不同科目的增长背离筛查信号，不代表已归因的现金或收入质量结论。`)
  }
  if (summary.cashConversion.freeCashFlow !== undefined && currentCfo !== undefined && currentCapex !== undefined) {
    const capexUnit = latest.metricMetadata?.capex?.unit
    const scale = ({CNY:1,'元':1,'万元':1e4,'亿元':1e8} as Record<string,number>)[capexUnit ?? '']
    if (scale !== undefined) formulas.push(`简化自由现金流＝经营现金净流量−购建长期资产现金支出＝${format(currentCfo)}−${format(currentCapex)}＝${format(summary.cashConversion.freeCashFlow*scale/1e8)}亿元。该值为 ${latest.periodEnd!.slice(0,4)} 年初至 ${latest.periodEnd} 累计，不是完整企业自由现金流估值口径，未另作营运资金或融资调整。`)
  }
  if (summary.cashConversion.cfoToNetIncome !== undefined && currentCfo !== undefined && currentIncome !== undefined) formulas.push(`现金转化比＝经营现金净流量÷结构化净利润（归母属性未注明）＝${format(currentCfo)}÷${format(currentIncome)}＝${format(summary.cashConversion.cfoToNetIncome)}倍；分子分母均为同一累计期间，净利润科目属性以接口字段为限。`)
  const sameAssetUnit = latest.metricMetadata?.assets?.unit === all.find(row=>row.periodEnd===openingDate)?.metricMetadata?.assets?.unit
  if (summary.accrualQuality.accrualRatio !== undefined && currentIncome !== undefined && currentCfo !== undefined && currentAssets !== undefined && openingAssets !== undefined && sameAssetUnit) formulas.push(`结构化净利润口径应计代理比率＝（结构化净利润（归母属性未注明）−经营现金净流量）÷平均总资产＝（${format(currentIncome)}−${format(currentCfo)}）÷[（${format(openingAssets)}＋${format(currentAssets)}）÷2]＝${format(summary.accrualQuality.accrualRatio*100)}%。平均总资产的期初为 ${openingDate}，期末为 ${latest.periodEnd}；分子为当年累计，未年化。净利润接口字段的归属范围未明确，与合并现金流和总资产口径可能存在范围差异；这不是标准应计比率，不能单独判断盈余管理、证明利润质量或排除应计风险。`)
  for (const calculation of calculated.workingCapitalCalculations) formulas.push(`${calculation.metric}确定性计算（${calculation.period}，累计口径，来源为结构化三表原始值）：${calculation.formula}。使用期初与期末余额的平均值，不是期末单点周转；这是期间筛查指标。`)
  if (formulas.length) scopeNotes.push(`计算器公式及口径：以下金额展示已四舍五入，增长率展示至小数点后四位；结果由未四舍五入的原始值计算；缺项或冲突不补零。${reference}\n\n${formulas.join('\n\n')}`)
  const markdown = [mainTable,...scopeNotes].join('\n\n')
  const currentNetProfit = latest.metrics.netProfit
  const openingParts: string[] = []
  const operatingProfitGrowth = calculated.growth.find(item => item.metric === 'operatingProfit')
  const operatingCashGrowth = calculated.growth.find(item => item.metric === 'operatingCashFlow')
  if (operatingProfitGrowth && operatingCashGrowth
    && typeof operatingProfitGrowth.currentPeriod === 'string' && typeof operatingProfitGrowth.priorPeriod === 'string'
    && operatingProfitGrowth.currentPeriod === operatingCashGrowth.currentPeriod
    && operatingProfitGrowth.priorPeriod === operatingCashGrowth.priorPeriod
    && operatingProfitGrowth.growthPercent * operatingCashGrowth.growthPercent < 0) {
    const rate = (value: number) => `${Math.abs(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
    const profitDirection = operatingProfitGrowth.growthPercent >= 0 ? '增长' : '下降'
    const cashDirection = operatingCashGrowth.growthPercent >= 0 ? '增长' : '下降'
    const exactYuan = (metric: keyof typeof latest.metrics, period: string): number | undefined => {
      const row = all.find(item => item.periodEnd === period)
      const value = row?.metrics[metric]
      const metadata = row?.metricMetadata?.[metric]
      const unitScale: Record<string, number> = { CNY: 1, 元: 1, 万元: 1e4, 亿元: 1e8 }
      return typeof value === 'number' && metadata?.currency === 'CNY' && metadata.basis === 'YTD' && unitScale[metadata.unit] !== undefined ? value * unitScale[metadata.unit]! : undefined
    }
    const profitCurrent = exactYuan('operatingProfit', operatingProfitGrowth.currentPeriod)
    const profitPrior = exactYuan('operatingProfit', operatingProfitGrowth.priorPeriod)
    const profitValues = profitCurrent !== undefined && profitPrior !== undefined
      ? (() => {
        const currentText = profitCurrent.toLocaleString('zh-CN',{maximumFractionDigits:2})
        const priorText = profitPrior.toLocaleString('zh-CN',{maximumFractionDigits:2})
        return `；营业利润原值为${priorText}元至${currentText}元，变化率公式为（${currentText}−${priorText}）÷abs(${priorText})×100%＝${operatingProfitGrowth.growthPercent.toFixed(4)}%`
      })()
      : ''
    openingParts.push(`同口径财务摘要：${operatingProfitGrowth.currentPeriod}较${operatingProfitGrowth.priorPeriod}，营业利润${profitDirection}${rate(operatingProfitGrowth.growthPercent)}，经营现金净流量${cashDirection}${rate(operatingCashGrowth.growthPercent)}${profitValues}；两者方向相反，现金流表现构成利润增长的反证。`)
  }
  const capexGrowth = calculated.growth.find(item => item.metric === 'capex')
  if (capexGrowth && typeof capexGrowth.currentPeriod === 'string' && typeof capexGrowth.priorPeriod === 'string') {
    const unitScale: Record<string, number> = { CNY: 1, 元: 1, 万元: 1e4, 亿元: 1e8 }
    const exact = (period: string) => {
      const row = all.find(item => item.periodEnd === period)
      const value = row?.metrics.capex
      const meta = row?.metricMetadata?.capex
      return typeof value === 'number' && meta?.currency === 'CNY' && meta.basis === 'YTD' && unitScale[meta.unit] !== undefined ? value * unitScale[meta.unit]! : undefined
    }
    const priorCapex = exact(capexGrowth.priorPeriod), currentCapex = exact(capexGrowth.currentPeriod)
    if (priorCapex !== undefined && currentCapex !== undefined) {
      const formatYuan = (value: number) => value.toLocaleString('zh-CN',{maximumFractionDigits:2})
      openingParts.push(`购建长期资产现金支出同口径复算（${capexGrowth.priorPeriod}至${capexGrowth.currentPeriod}，均为年初至期末累计）：（${formatYuan(currentCapex)}元−${formatYuan(priorCapex)}元）÷abs(${formatYuan(priorCapex)}元)×100%＝${capexGrowth.growthPercent.toFixed(4)}%。`)
    }
  }
  if (typeof currentNetProfit === 'number' && Number.isFinite(currentNetProfit)) {
    openingParts.push('结构化净利润字段的归属未注明，本报告不将其表述为归母净利润。')
  }
  const openingSummary = openingParts.length ? `${openingParts.join(' ')} [${source.candidate.candidateId}@paragraph:1]` : ''
  return { sourceCandidateId: source.candidate.candidateId, markdown, openingSummary, numericDisplayAmounts }
}

/** Keep the verified same-period financial counter-evidence at the section opening. */
export function insertCompanyFinancialOpeningSummary(markdown: string, openingSummary: string): string {
  if (!openingSummary || markdown.includes(openingSummary)) return markdown
  const headingEnd = markdown.indexOf('\n')
  if (headingEnd < 0) return `${openingSummary}\n\n${markdown}`
  return `${markdown.slice(0, headingEnd + 1)}\n${openingSummary}\n\n${markdown.slice(headingEnd + 1)}`
}
