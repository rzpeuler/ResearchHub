import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareCompanyFinancialAnalysis, renderCompanyFinancialTable } from '../../workflows/company-deep-research/financial-analysis.ts'
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
test('company finance compares same YTD period with explicit units and calls existing calculators',()=>{const result=prepareCompanyFinancialAnalysis({...input,financialData:[row('2026-06-30',200),row('2025-06-30',100)]});assert.equal(result.growth.find(r=>r.metric==='revenue')?.growthPercent,100);assert.equal(result.financialQuality.summary.cashConversion.cfoToNetIncome,2);assert.equal(result.capitalAllocation.actions[0]?.metrics.find(r=>r.metric==='capex_intensity')?.value,0.025)})
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
  assert.ok(table.markdown.includes('| 归母净利润 | 0.10 |'))
  assert.ok(table.markdown.includes('| 购建长期资产现金支出 | 未取得可用口径 |'))
  assert.ok(table.markdown.includes('[financial@paragraph:1]'))
  assert.deepEqual(table.numericDisplayAmounts.find(item => item.metric === 'netProfit' && item.period === '2026-06-30'), {metric:'netProfit',period:'2026-06-30',unit:'亿元',currency:'CNY',basis:'YTD',value:0.1,sourceCandidateId:'financial'})
  assert.equal(table.numericDisplayAmounts.some(item => item.metric === 'capex' && item.period === '2026-06-30'), false)
  assert.equal(table.numericDisplayAmounts.some(item => item.metric === 'revenue' && item.period === '2025-06-30'), false)
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
  const conflict=prepareCompanyFinancialAnalysis({...input,financialData:rows.map(item=>item.periodEnd==='2025-12-31'?{...item,sourceConflicts:[{metric:'revenue',indicatorValue:103.46,statementValue:104}]}:item)})
  assert.equal(conflict.annualGrowth.some(item=>item.metric==='revenue'),false)
  assert.equal(conflict.annualGrowth.some(item=>item.metric==='netProfit'),true)
  const incomparable=prepareCompanyFinancialAnalysis({...input,financialData:rows.map(item=>item.periodEnd==='2024-12-31'?{...item,metricMetadata:{revenue:{unit:'UNKNOWN',currency:'UNKNOWN',basis:'YTD'},netProfit:{unit:'CNY',currency:'CNY',basis:'QUARTER'}}}:item)})
  assert.equal(incomparable.annualGrowth.length,0)
  assert.equal(prepareCompanyFinancialAnalysis({...input,financialData:rows.filter(item=>item.periodEnd!=='2024-12-31')}).annualGrowth.length,0)
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
