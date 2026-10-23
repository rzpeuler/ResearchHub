import assert from 'node:assert/strict'
import test from 'node:test'
import { insertCompanyFinancialOpeningSummary, prepareCompanyFinancialAnalysis, renderCompanyFinancialTable } from '../../workflows/company-deep-research/financial-analysis.ts'
import type { CompanyResearchFinancialObservation } from '../../skills/company-research/contracts.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
const row=(periodEnd:string,revenue:number):CompanyResearchFinancialObservation=>({periodEnd,metrics:{revenue,netProfit:10,operatingCashFlow:20,capex:5},metricMetadata:Object.fromEntries(['revenue','netProfit','operatingCashFlow','capex'].map(key=>[key,{unit:'CNY',currency:'CNY',basis:'YTD' as const}])),pointInTimeSafe:false,pointInTimeStatus:'CURRENT_VALUE_ONLY'})
const input:CompanyResearchInput={company:{symbol:'002594'},asOf:'2026-10-14T00:00:00Z',sources:[{candidate:{candidateId:'financial',kind:'structured_data',tier:2,title:'Financials',provider:'fixture',metadata:{dataProvenance:{metricId:'company_financial_history'}}},retrievedAt:'2026-10-14T00:00:00Z',title:'Financials',content:'data',contentHash:'a'.repeat(64),publisher:'fixture',rights:{accessScope:'public',retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}]}
test('capital cash coverage is computed from the same cumulative period and withheld for invalid denominators or bases',()=>{
  const current={...row('2026-06-30',200),metrics:{...row('2026-06-30',200).metrics,capex:52.53,operatingCashFlow:23.84}}
  const prepare=(financialData:CompanyResearchInput['financialData'])=>prepareCompanyFinancialAnalysis({...input,financialData})
  assert.equal(prepare([current]).periodRatios[0]?.capexToOperatingCashFlowMultiple,52.53/23.84)
  for(const cash of [0,-2]) assert.equal(prepare([{...current,metrics:{...current.metrics,operatingCashFlow:cash}}]).periodRatios[0]?.capexToOperatingCashFlowMultiple,undefined)
  assert.equal(prepare([{...current,metricMetadata:{...current.metricMetadata,capex:{unit:'CNY',currency:'CNY',basis:'QUARTER'}}}]).periodRatios[0]?.capexToOperatingCashFlowMultiple,undefined)
  assert.equal(prepare([{...current,sourceConflicts:[{metric:'capex',indicatorValue:52.53,statementValue:60}]}]).periodRatios[0]?.capexToOperatingCashFlowMultiple,undefined)
  assert.ok(prepare([{...current,metrics:{...current.metrics,operatingCashFlow:0}}]).periodRatios[0]?.netMarginPercent)
})
test('simple free cash flow is computed only from compatible sourced YTD inputs and preserves its period formula',()=>{
  const annual={...row('2025-12-31',8e11),metrics:{...row('2025-12-31',8e11).metrics,operatingCashFlow:59136000000,capex:156808000000}}
  const result=prepareCompanyFinancialAnalysis({...input,financialData:[annual]})
  const calculation=result.simpleFreeCashFlow.find(item=>item.period==='2025-12-31')!
  assert.equal(calculation.displayValue,'-976.72')
  assert.equal(calculation.formula,'591.36亿元−1,568.08亿元＝-976.72亿元')
  assert.deepEqual(calculation.sourceCandidateIds,['financial'])
  const conflict=prepareCompanyFinancialAnalysis({...input,financialData:[{...annual,sourceConflicts:[{metric:'capex',indicatorValue:156808000000,statementValue:100}]}]})
  assert.equal(conflict.simpleFreeCashFlow.length,0)
})
test('company finance compares same YTD period with explicit units and calls existing calculators',()=>{const result=prepareCompanyFinancialAnalysis({...input,financialData:[row('2026-06-30',200),row('2025-06-30',100)]});assert.equal(result.growth.find(r=>r.metric==='revenue')?.growthPercent,100);assert.equal(result.financialQuality.summary.cashConversion.cfoToNetIncome,2);assert.equal(result.capitalAllocation.actions[0]?.metrics.find(r=>r.metric==='capex_intensity')?.value,0.025)})
test('ratio changes retain both raw and displayed-operand percentage-point calculations',()=>{
  const current={...row('2026-06-30',1000),metrics:{...row('2026-06-30',1000).metrics,netProfit:35.744944245}}
  const prior={...row('2025-06-30',1000),metrics:{...row('2025-06-30',1000).metrics,netProfit:41.775730976}}
  const result=prepareCompanyFinancialAnalysis({...input,financialData:[current,prior]})
  const netMargin=result.ratioChanges.find(item=>item.metric==='netMarginPercent')!
  assert.ok(Math.abs(netMargin.changePercentagePoints - (-0.603078673)) < 0.000001)
  assert.equal(netMargin.displayChangePercentagePoints,-0.61)
})
test('company finance preserves conflict but excludes disputed numbers from ratios and growth',()=>{const current={...row('2026-06-30',200),sourceConflicts:[{metric:'revenue',indicatorValue:200,statementValue:180}]};const result=prepareCompanyFinancialAnalysis({...input,financialData:[current,row('2025-06-30',100)]});assert.equal(result.growth.some(r=>r.metric==='revenue'),false);assert.equal(result.table[0]?.conflicts.length,1);assert.equal(result.businessDrivers.status,'unavailable')})
test('company finance does not mix quarters, currencies or unknown monetary units',()=>{const current={...row('2026-06-30',200),metricMetadata:{revenue:{unit:'USD',currency:'USD',basis:'QUARTER' as const}}};const result=prepareCompanyFinancialAnalysis({...input,financialData:[current,row('2025-06-30',100)]});assert.equal(result.growth.length,0);assert.equal(result.financialQuality.summary.cashConversion.cfoToNetIncome,undefined);assert.ok(result.limitations.some(r=>r.includes('incompatible')))})

test('identical unknown monetary metadata does not establish comparable growth', () => {
  const rows = [row('2026-06-30', 200), row('2025-06-30', 100)].map(item => ({...item, metricMetadata: {...item.metricMetadata, revenue: {unit:'UNKNOWN',currency:'UNKNOWN',basis:'YTD' as const}}}))
  const result = prepareCompanyFinancialAnalysis({...input, financialData: rows})
  assert.equal(result.growth.some(item => item.metric === 'revenue'), false)
  assert.ok(result.growth.some(item => item.metric === 'netProfit'))
})

test('financial display converts verified money units and preserves unavailable and conflicting cells', () => {
  const current = { ...row('2026-06-30', 2e8), metrics: {revenue: 2e8, netProfit: 1000, capex: 500}, metricMetadata: { revenue: {unit:'CNY',currency:'CNY',basis:'YTD' as const}, netProfit:{unit:'万元',currency:'CNY',basis:'YTD' as const}, capex:{unit:'CNY',currency:'CNY',basis:'QUARTER' as const} } }
  const table = renderCompanyFinancialTable({...input, financialData:[current, {...row('2025-06-30',1e8),sourceConflicts:[{metric:'revenue',indicatorValue:1e8,statementValue:2e8}]}]})!
  assert.ok(table.markdown.includes('| 营业收入 | 2.00 | 来源冲突，待核实 |'))
  assert.ok(table.markdown.includes('| 净利润（结构化字段；归母属性未注明） | 0.10 |'))
  assert.ok(table.markdown.includes('| 购建长期资产现金支出 | 未取得可用口径 |'))
  assert.ok(table.markdown.includes('[financial@paragraph:1]'))
  assert.deepEqual(table.numericDisplayAmounts.find(item => item.metric === 'netProfit' && item.period === '2026-06-30'), {metric:'netProfit',period:'2026-06-30',unit:'亿元',currency:'CNY',basis:'YTD',value:0.1,sourceCandidateId:'financial'})
  assert.equal(table.numericDisplayAmounts.some(item => item.metric === 'capex' && item.period === '2026-06-30'), false)
  assert.equal(table.numericDisplayAmounts.some(item => item.metric === 'revenue' && item.period === '2025-06-30'), false)
})

test('opening financial summary puts same-period operating-profit growth beside opposite CFO decline and labels net-profit attribution', () => {
  const period = (periodEnd: string, operatingProfit: number, operatingCashFlow: number): CompanyResearchFinancialObservation => {
    const base = row(periodEnd, 100)
    return {
      ...base,
      metrics: { ...base.metrics, operatingProfit, operatingCashFlow },
      metricMetadata: {
        ...base.metricMetadata,
        operatingProfit: { unit: 'CNY', currency: 'CNY', basis: 'YTD' },
      },
    }
  }
  const rendered = renderCompanyFinancialTable({
    ...input,
    financialData: [period('2026-06-30', 364.4783, 95.351), period('2025-06-30', 100, 100)],
  })!
  assert.match(rendered.openingSummary, /2026-06-30较2025-06-30，营业利润增长264\.48%，经营现金净流量下降4\.65%/)
  assert.match(rendered.openingSummary, /两者方向相反，现金流表现构成利润增长的反证/)
  assert.match(rendered.openingSummary, /结构化净利润字段的归属未注明/)
  assert.doesNotMatch(rendered.openingSummary, /归母净利润同比/)
  assert.match(rendered.openingSummary, /\[financial@paragraph:1\]/)
  const inserted = insertCompanyFinancialOpeningSummary('# 财务质量分析\n原有摘要\n后续分析', rendered.openingSummary)
  assert.ok(inserted.indexOf(rendered.openingSummary) < inserted.indexOf('原有摘要'))
  assert.equal(insertCompanyFinancialOpeningSummary(inserted, rendered.openingSummary), inserted, 'reapplying final report reconciliation is idempotent')

  const sameDirection = renderCompanyFinancialTable({
    ...input,
    financialData: [period('2026-06-30', 150, 150), period('2025-06-30', 100, 100)],
  })!
  assert.doesNotMatch(sameDirection.openingSummary, /方向相反|营业利润增长.*经营现金净流量增长/)
  assert.match(sameDirection.openingSummary, /结构化净利润字段的归属未注明/)

  const incomparable = renderCompanyFinancialTable({
    ...input,
    financialData: [
      period('2026-06-30', 150, 50),
      { ...period('2025-06-30', 100, 100), metricMetadata: { ...period('2025-06-30', 100, 100).metricMetadata, operatingCashFlow: { unit: 'CNY', currency: 'CNY', basis: 'QUARTER' } } },
    ],
  })!
  assert.doesNotMatch(incomparable.openingSummary, /营业利润.*经营现金净流量/)
})

test('prepared financial analysis carries only deterministic eligible display amounts as numbers', () => {
  const result = prepareCompanyFinancialAnalysis({...input, financialData:[row('2026-06-30',344815000000)]})
  assert.ok(result.financialReadableTable?.includes('3,448.15'))
  assert.equal(result.financialDisplayAmounts.find(item => item.metric === 'revenue')?.value, 3448.15)
  assert.equal(typeof result.financialDisplayAmounts[0]?.value, 'number')
  assert.deepEqual(prepareCompanyFinancialAnalysis({...input,sources:[],financialData:[row('2026-06-30',344815000000)]}).financialDisplayAmounts, [])
})

test('annual growth remains available beside latest interim growth with exact comparable periods', () => {
  const rows = [row('2026-06-30',120), row('2025-06-30',100), {...row('2025-12-31',103.46),metrics:{revenue:103.46,netProfit:81.03}}, {...row('2024-12-31',100),metrics:{revenue:100,netProfit:100}}]
  const result = prepareCompanyFinancialAnalysis({...input,financialData:rows})
  assert.equal(result.growth.find(item => item.metric === 'revenue')?.currentPeriod,'2026-06-30')
  assert.ok(Math.abs(result.annualGrowth.find(item=>item.metric==='revenue')!.growthPercent-3.46)<1e-10)
  assert.ok(Math.abs(result.annualGrowth.find(item=>item.metric==='netProfit')!.growthPercent+18.97)<1e-10)
  assert.deepEqual(result.annualGrowth[0]?.sourceCandidateIds,['financial'])
  const annualTable=renderCompanyFinancialTable({...input,financialData:rows})!
  assert.match(annualTable.markdown,/完整年度同比对照（2024-12-31至2025-12-31/)
  assert.match(annualTable.markdown,/净利润（结构化字段；归母属性未注明）下降18\.97%/)
  assert.match(annualTable.markdown,/与下述最新半年累计期间分开阅读/)
  const conflict=prepareCompanyFinancialAnalysis({...input,financialData:rows.map(item=>item.periodEnd==='2025-12-31'?{...item,sourceConflicts:[{metric:'revenue',indicatorValue:103.46,statementValue:104}]}:item)})
  assert.equal(conflict.annualGrowth.some(item=>item.metric==='revenue'),false)
  assert.equal(conflict.annualGrowth.some(item=>item.metric==='netProfit'),true)
  const incomparable=prepareCompanyFinancialAnalysis({...input,financialData:rows.map(item=>item.periodEnd==='2024-12-31'?{...item,metricMetadata:{revenue:{unit:'UNKNOWN',currency:'UNKNOWN',basis:'YTD'},netProfit:{unit:'CNY',currency:'CNY',basis:'QUARTER'}}}:item)})
  assert.equal(incomparable.annualGrowth.length,0)
  assert.equal(prepareCompanyFinancialAnalysis({...input,financialData:rows.filter(item=>item.periodEnd!=='2024-12-31')}).annualGrowth.length,0)
})

test('annual formula shows enough raw precision to reproduce the growth rate independently of rounded summary values',()=>{
  const annual=(periodEnd:string,values:{revenue:number;operatingProfit:number;netProfit:number;operatingCashFlow:number}):CompanyResearchFinancialObservation=>({
    ...row(periodEnd,values.revenue),
    metrics:{...row(periodEnd,values.revenue).metrics,...values},
    metricMetadata:{...row(periodEnd,values.revenue).metricMetadata,operatingProfit:{unit:'CNY',currency:'CNY',basis:'YTD'}},
  })
  const annual2025=annual('2025-12-31',{revenue:40_125_000_000,operatingProfit:1_268_880_792.11,netProfit:1_386_000_000,operatingCashFlow:5_307_000_000})
  const annual2024=annual('2024-12-31',{revenue:36_770_000_000,operatingProfit:1_479_602_468.51,netProfit:1_086_000_000,operatingCashFlow:4_986_000_000})
  const latest=row('2026-06-30',27_797_683_972.88)
  const prior=row('2025-06-30',16_955_163_898.89)
  const report=renderCompanyFinancialTable({...input,financialData:[latest,prior,annual2025,annual2024]})!.markdown
  assert.match(report,/营业利润下降14\.24%（\(12\.68880792−14\.79602469\)÷abs\(14\.79602469\)×100%＝-14\.2418%\）/)
  assert.match(report,/其中净利润为结构化字段且归母属性未注明/)
  const operands=report.match(/营业利润下降14\.24%（\(([\d.]+)−([\d.]+)\)÷abs\(([\d.]+)\)×100%＝(-?[\d.]+)%）/)
  assert.ok(operands)
  const recomputed=(Number(operands[1])-Number(operands[2]))/Math.abs(Number(operands[3]))*100
  assert.equal(Number(recomputed.toFixed(4)),Number(operands[4]))
})

function comparableBalanceRow(periodEnd: string, revenue: number, cfo: number, receivables: number): CompanyResearchFinancialObservation {
  const base = row(periodEnd, revenue)
  return { ...base, metrics: { ...base.metrics, operatingCashFlow: cfo, receivables }, metricMetadata: { ...base.metricMetadata, receivables: { unit: 'CNY', currency: 'CNY', basis: 'POINT_IN_TIME' } } }
}

test('growth divergences preserve signed percentage-point formulas rather than cash/quality conclusions', () => {
  const result = prepareCompanyFinancialAnalysis({ ...input, financialData: [comparableBalanceRow('2026-06-30', 120, 90, 75), comparableBalanceRow('2025-06-30', 100, 100, 50)] })
  const receivables = result.growthDivergences.find(item => item.leftMetric === 'receivables')!
  const cash = result.growthDivergences.find(item => item.rightMetric === 'operatingCashFlow')!
  assert.equal(receivables.value, 30, '50% receivables growth minus 20% revenue growth')
  assert.equal(cash.value, 30, '20% revenue growth minus -10% CFO growth')
  assert.equal(receivables.unit, 'percentage_points')
  assert.equal(receivables.formula, 'receivables同比% - revenue同比%')
  assert.equal(cash.formula, 'revenue同比% - operatingCashFlow同比%')
  assert.equal(cash.currentPeriod, '2026-06-30')
  assert.equal(cash.priorPeriod, '2025-06-30')
  assert.match(cash.interpretation, /核查信号，不代表已归因/)
  const reverse = prepareCompanyFinancialAnalysis({ ...input, financialData: [comparableBalanceRow('2026-06-30', 120, 150, 40), comparableBalanceRow('2025-06-30', 100, 100, 50)] })
  assert.equal(reverse.growthDivergences.find(item => item.leftMetric === 'receivables')?.value, -40, '-20% receivables growth minus 20% revenue growth')
  assert.equal(reverse.growthDivergences.find(item => item.rightMetric === 'operatingCashFlow')?.value, -30, '20% revenue growth minus 50% CFO growth')
})

test('growth divergence display values are calculated from the rounded operand rates shown in the report', () => {
  const currentBase = comparableBalanceRow('2026-06-30', 27797683972.88, 2383887276.1, 10598328021.04)
  const current = { ...currentBase, metrics: { ...currentBase.metrics, inventory: 11417997322.49 }, metricMetadata: { ...currentBase.metricMetadata, inventory: { unit: 'CNY', currency: 'CNY', basis: 'POINT_IN_TIME' as const } } }
  const priorBase = comparableBalanceRow('2025-06-30', 16955163898.89, 2500118021.28, 6418328579.03)
  const prior = { ...priorBase, metrics: { ...priorBase.metrics, inventory: 6408328579.03 }, metricMetadata: { ...priorBase.metricMetadata, inventory: { unit: 'CNY', currency: 'CNY', basis: 'POINT_IN_TIME' as const } } }
  const result = prepareCompanyFinancialAnalysis({ ...input, financialData: [current, prior] })
  const spread = result.growthDivergences.find(item => item.leftMetric === 'inventory')!
  assert.equal(spread.value.toFixed(4), '14.2262', 'retain the underlying unrounded difference')
  assert.equal(spread.displayValue, 14.2261, 'match the displayed subtraction of 78.1743% - 63.9482%')
})

test('inventory versus revenue growth spread is computed deterministically with separate stock and flow bases', () => {
  const inventoryRow=(periodEnd:string,revenue:number,inventory:number):CompanyResearchFinancialObservation=>{
    const base=row(periodEnd,revenue)
    return {...base,metrics:{...base.metrics,inventory},metricMetadata:{...base.metricMetadata,inventory:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}}}
  }
  const result=prepareCompanyFinancialAnalysis({...input,financialData:[inventoryRow('2026-06-30',120,75),inventoryRow('2025-06-30',100,50)]})
  const spread=result.growthDivergences.find(item=>item.leftMetric==='inventory'&&item.rightMetric==='revenue')!
  assert.equal(spread.value,30,'50% inventory balance growth minus 20% revenue cumulative growth')
  assert.equal(spread.unit,'percentage_points')
  assert.equal(spread.currentPeriod,'2026-06-30')
  assert.equal(spread.priorPeriod,'2025-06-30')
  assert.match(spread.interpretation,/核查信号，不代表已归因/)
})

test('ratio change calculations retain unrounded operands for reproducible displayed formulas',()=>{
  const balance=(periodEnd:string,assets:number,liabilities:number):CompanyResearchFinancialObservation=>{
    const base=row(periodEnd,100)
    return {...base,metrics:{...base.metrics,assets,liabilities},metricMetadata:{...base.metricMetadata,assets:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'},liabilities:{unit:'CNY',currency:'CNY',basis:'POINT_IN_TIME'}}}
  }
  const result=prepareCompanyFinancialAnalysis({...input,financialData:[balance('2026-06-30',1234.567,789.123),balance('2025-06-30',4567.89,2345.67)]})
  const change=result.ratioChanges.find(item=>item.metric==='liabilitiesToAssetsPercent')!
  const current=result.periodRatios.find(item=>item.period==='2026-06-30')!.liabilitiesToAssetsPercent!
  const prior=result.periodRatios.find(item=>item.period==='2025-06-30')!.liabilitiesToAssetsPercent!
  assert.equal(change.currentValue,current)
  assert.equal(change.priorValue,prior)
  assert.equal(change.changePercentagePoints,current-prior)
})

test('growth divergences require the exact comparable prior period and compatible per-metric bases', () => {
  const current = comparableBalanceRow('2026-06-30', 120, 90, 75)
  const wrongPeriod = prepareCompanyFinancialAnalysis({ ...input, financialData: [current, comparableBalanceRow('2025-12-31', 100, 100, 50)] })
  assert.equal(wrongPeriod.growthDivergences.length, 0)
  assert.equal(wrongPeriod.growth.length, 0)
  assert.equal(wrongPeriod.financialQuality.summary.cashConversion.cfoToNetIncome, 9, 'current-period analysis remains available')
  const prior = comparableBalanceRow('2025-06-30', 100, 100, 50)
  const mixed = prepareCompanyFinancialAnalysis({ ...input, financialData: [{ ...current, metricMetadata: { ...current.metricMetadata, revenue: { unit: 'CNY', currency: 'CNY', basis: 'QUARTER' } } }, prior] })
  assert.equal(mixed.growth.some(item => item.metric === 'revenue'), false)
  assert.equal(mixed.growthDivergences.length, 0)
  assert.equal(mixed.growth.find(item => item.metric === 'receivables')?.growthPercent, 50)
})

test('missing one metric suppresses only its divergence and retains the other supported research calculations', () => {
  const current = comparableBalanceRow('2026-06-30', 120, 90, 75)
  const prior = comparableBalanceRow('2025-06-30', 100, 100, 50)
  const { operatingCashFlow: omitted, ...metrics } = current.metrics
  assert.equal(omitted, 90)
  const result = prepareCompanyFinancialAnalysis({ ...input, financialData: [{ ...current, metrics }, prior] })
  assert.equal(result.growthDivergences.length, 1)
  assert.equal(result.growthDivergences[0]?.leftMetric, 'receivables')
  assert.equal(result.growthDivergences[0]?.value, 30)
  assert.equal(result.growth.find(item => item.metric === 'revenue')?.growthPercent, 20)
  assert.equal(result.periodRatios[0]?.netMarginPercent, 10 / 120 * 100)
  assert.equal(result.financialQuality.summary.cashConversion.cfoToNetIncome, undefined)
  assert.ok(result.capitalAllocation.actions.length > 0)
})

test('debt display keeps four disclosed categories separate and labels current noncurrent liabilities without calling all interest-bearing loans', () => {
  const debtMetrics = { shortTermBorrowings: 2e8, longTermBorrowings: 3e8, bondsPayable: 4e8, currentPortionLongTermDebt: 5e8 }
  const current = { ...row('2026-06-30', 2e9), metrics: { ...row('2026-06-30', 2e9).metrics, ...debtMetrics }, metricMetadata: { ...row('2026-06-30', 2e9).metricMetadata, ...Object.fromEntries(Object.keys(debtMetrics).map(key => [key, { unit: 'CNY', currency: 'CNY', basis: 'POINT_IN_TIME' as const }])) } }
  const result = renderCompanyFinancialTable({ ...input, financialData: [current] })!
  assert.match(result.markdown, /\| 短期借款 \| 2\.00 \|/)
  assert.match(result.markdown, /\| 长期借款 \| 3\.00 \|/)
  assert.match(result.markdown, /\| 应付债券 \| 4\.00 \|/)
  assert.match(result.markdown, /\| 一年内到期非流动负债（含非借款项目） \| 5\.00 \|/)
  assert.doesNotMatch(result.markdown, /一年内到期(?:长期)?借款|总有息债务/)
  const missingOrConflict = renderCompanyFinancialTable({ ...input, financialData: [{ ...current, sourceConflicts: [{ metric: 'bondsPayable', indicatorValue: 4e8, statementValue: 4.1e8 }], metricMetadata: { ...current.metricMetadata, shortTermBorrowings: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } } }] })!
  assert.match(missingOrConflict.markdown, /\| 短期借款 \| 未取得可用口径 \|/)
  assert.match(missingOrConflict.markdown, /\| 应付债券 \| 来源冲突，待核实 \|/)
  assert.match(missingOrConflict.markdown, /\| 长期借款 \| 3\.00 \|/)
})

test('readable calculations expose exact stock and cumulative comparison bases and proxy formulas', () => {
  const observation = (periodEnd:string,metrics:Record<string,number>):CompanyResearchFinancialObservation => ({periodEnd,metrics,metricMetadata:Object.fromEntries(Object.keys(metrics).map(metric=>[metric,{unit:'CNY',currency:'CNY',basis:['assets','receivables','inventory','payables'].includes(metric)?'POINT_IN_TIME' as const:'YTD' as const}])),pointInTimeSafe:false,pointInTimeStatus:'CURRENT_VALUE_ONLY'})
  const current=observation('2026-06-30',{revenue:27797683972.88,netProfit:2956898811.04,operatingCashFlow:2383887276.10,capex:5253357960.45,cogs:22200000000,assets:69167411001.34,receivables:10598328021.04,inventory:11417997322.49,payables:9000000000})
  const prior=observation('2025-06-30',{revenue:16955163898.89,netProfit:758005980.61,operatingCashFlow:2500118021.28,assets:47886706779.38,receivables:6002283912.67,inventory:6408328579.03})
  const opening=observation('2025-12-31',{revenue:40124858839.52,cogs:30000000000,assets:60250537094.98,receivables:9792745060.06,inventory:8928944182.01,payables:7000000000})
  const result=prepareCompanyFinancialAnalysis({...input,financialData:[current,opening,prior]})
  const text=result.financialReadableTable!
  assert.match(text,/上年同期 2025-06-30 \| 本期 2026-06-30 \| 同比公式及变化/)
  assert.match(text,/应收账款（期末余额） \| 60\.02 \| 105\.98 \| \(105\.98−60\.02\)÷abs\(60\.02\)×100%＝76\.5716%/)
  assert.match(text,/存货（期末余额） \| 64\.08 \| 114\.18 \| \(114\.18−64\.08\)÷abs\(64\.08\)×100%＝78\.1743%/)
  assert.match(text,/营业收入（年初至期末累计） \| 169\.55 \| 277\.98 \| \(277\.98−169\.55\)÷abs\(169\.55\)×100%＝63\.9482%/)
  assert.match(text,/不以并列展示的上年年末余额为同比基期/)
  assert.match(text,/简化自由现金流＝经营现金净流量−购建长期资产现金支出＝23\.84−52\.53＝-28\.69亿元/)
  assert.match(text,/净利润（结构化字段；归母属性未注明）/)
  assert.match(text,/现金转化比＝经营现金净流量÷结构化净利润（归母属性未注明）/)
  assert.doesNotMatch(text,/归母净利润/)
  assert.match(text,/应收账款同比增速与营业收入同比增速差＝应收账款同比增速−营业收入同比增速＝76\.571[0-9]%−\(63\.948[0-9]%\)＝12\.623[0-9]个百分点/)
  assert.match(text,/（29\.57−23\.84）÷\[（602\.51＋691\.67）÷2\]＝0\.89%/)
  assert.match(text,/期初为 2025-12-31，期末为 2026-06-30/)
  assert.match(text,/未年化.*净利润接口字段的归属范围未明确.*不能单独判断盈余管理/)
  assert.match(text,/不同指标.*不能把余额视为累计流量/)
  assert.match(text,/DSO确定性计算（2026-06-30，累计口径.*期初应收9,792,745,060\.06元.*期末应收10,598,328,021\.04元.*本期累计收入27,797,683,972\.88元×181天/)
  assert.match(text,/DIO确定性计算（2026-06-30，累计口径.*期初存货8,928,944,182\.01元.*期末存货11,417,997,322\.49元.*本期累计营业成本22,200,000,000元×181天/)
  assert.match(text,/DPO确定性计算（2026-06-30，累计口径.*期初应付7,000,000,000元.*期末应付9,000,000,000元.*本期累计营业成本22,200,000,000元×181天/)
  assert.match(text,/CCC确定性计算（2026-06-30.*DSO .*天＋DIO .*天−DPO .*天＝.*天/)
  assert.equal(result.financialQuality.summary.accrualQuality.accrualRatio,0.008855209704198572,'display labels preserve the original calculator value')
  const missing=prepareCompanyFinancialAnalysis({...input,financialData:[{...current,metrics:{...current.metrics,capex:undefined}},prior]})
  assert.doesNotMatch(missing.financialReadableTable!,/简化自由现金流＝|结构化净利润口径应计代理比率＝/)
  assert.match(missing.financialReadableTable!,/现金转化比＝/,'available calculations remain visible when other inputs are missing')
})

test('capital spending and R&D year-over-year display formulas with their same-period operands', () => {
  const withInvestments = (periodEnd: string, capex: number, researchDevelopment: number): CompanyResearchFinancialObservation => {
    const base = row(periodEnd, 100)
    return { ...base, metrics: { ...base.metrics, capex, researchDevelopment }, metricMetadata: { ...base.metricMetadata, researchDevelopment: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } } }
  }
  const rendered = renderCompanyFinancialTable({ ...input, financialData: [withInvestments('2026-06-30', 5e8, 78.75e8), withInvestments('2025-06-30', 10e8, 100e8)] })!
  assert.match(rendered.markdown, /购建长期资产现金支出（年初至期末累计） \| 10\.00 \| 5\.00 \| \(5\.00−10\.00\)÷abs\(10\.00\)×100%＝-50\.0000%/)
  assert.match(rendered.markdown, /研发费用（年初至期末累计） \| 100\.00 \| 78\.75 \| \(78\.75−100\.00\)÷abs\(100\.00\)×100%＝-21\.2500%/)
  const formulaRows = rendered.markdown.split('\n').filter(line => line.startsWith('|') && line.includes('abs(') && /(?:购建长期资产现金支出|研发费用)/.test(line))
  assert.equal(formulaRows.length, 2)
  for (const line of formulaRows) assert.equal((line.match(/\|/g) ?? []).length, 5, `expected intact four-column formula row: ${line}`)
})

test('opening financial summary gives exact operating-profit operands and capex formula', () => {
  const observation = (periodEnd: string, operatingProfit: number, capex: number, operatingCashFlow: number): CompanyResearchFinancialObservation => {
    const base = row(periodEnd, 100)
    return {
      ...base,
      metrics: { ...base.metrics, operatingProfit, capex, operatingCashFlow },
      metricMetadata: { ...base.metricMetadata, operatingProfit: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, capex: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } },
    }
  }
  const rendered = renderCompanyFinancialTable({ ...input, financialData: [
    observation('2026-06-30', 3503364330.33, 5253357960.45, 2383887276.10),
    observation('2025-06-30', 961199707.53, 2148254435.73, 2500118021.28),
  ] })!
  assert.match(rendered.openingSummary, /营业利润原值为961,199,707\.53元至3,503,364,330\.33元/)
  assert.match(rendered.openingSummary, /变化率公式为（3,503,364,330\.33−961,199,707\.53）÷abs\(961,199,707\.53\)×100%＝264\.4783%/)
  assert.match(rendered.openingSummary, /购建长期资产现金支出同口径复算.*（5,253,357,960\.45元−2,148,254,435\.73元）÷abs\(2,148,254,435\.73元\)×100%＝144\.5408%/)
  assert.match(rendered.markdown, /营业利润（年初至期末累计） \|/)
})
