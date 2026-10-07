import assert from 'node:assert/strict'
import test from 'node:test'
import { earningsPeriodSpec } from '../../../skills/earnings-review/financials.ts'
import { EARNINGS_REVIEW_SECTIONS } from '../../../skills/earnings-review/contracts.ts'
import { calculateAccrualQuality } from '../../../skills/earnings-review/financial-quality/accrual-quality.ts'
import { calculateCashConversion } from '../../../skills/earnings-review/financial-quality/cash-conversion.ts'
import { normalizeFinancialQualityData } from '../../../plugins/research-acquisition/earnings-financial-quality-normalization.ts'
import { analyzeRevenueRecognition } from '../../../skills/earnings-review/financial-quality/revenue-recognition.ts'
import { calculateEarningsFinancialQualitySummary, enrichEarningsReviewSections } from '../../../skills/earnings-review/financial-quality/summary.ts'
import type { FinancialQualityPeriodFacts } from '../../../skills/earnings-review/financial-quality/contracts.ts'
import { calculateWorkingCapital } from '../../../skills/earnings-review/financial-quality/working-capital.ts'

const THRESHOLD = 0.10

function facts(overrides: Partial<FinancialQualityPeriodFacts> = {}): FinancialQualityPeriodFacts {
  return { period: '2026-H1', daysInPeriod: 181, revenue: 1_000, cogs: 500, netIncome: 100, cashFromOperations: 120, capex: 20, receivables: 300, inventory: 200, payables: 250, contractAssets: 140, deferredRevenue: 90, totalAssets: 2_000, ...overrides }
}

test('normalization selects exact rows by date independent of order and separates opening/prior comparable', () => {
  const requested = earningsPeriodSpec(2025, 'H1')
  const result = normalizeFinancialQualityData([
    { 报告期: '2024-06-30', 营业收入: '800', 总资产: '1,600' },
    { 报告期: '2025-06-30', 营业收入: '1,000', 营业成本: '500', 应收账款: '1,234.5', 主营业务收入增长率: '99.9' },
    { 报告期: '2024-12-31', 营业收入: '900', 总资产: '1,800' },
  ], requested, 'akshare-test')
  assert.equal(result.current?.period, '2025-H1')
  assert.equal(result.current?.revenue, 1_000)
  assert.equal(result.current?.receivables, 1_234.5)
  assert.equal(result.opening?.period, '2024-FY')
  assert.equal(result.opening?.totalAssets, 1_800)
  assert.equal(result.priorComparable?.period, '2024-H1')
  assert.equal(result.priorComparable?.revenue, 800)
  assert.equal(result.current?.daysInPeriod, 181)
  assert.equal(result.current?.revenue, 1_000)
  assert.equal(result.current?.cogs, 500)
  assert.equal((result.current as unknown as Record<string, unknown>)['主营业务收入增长率'], undefined)
})

test('period-day convention is calendar-correct for non-leap and leap years', () => {
  assert.deepEqual(['Q1', 'H1', 'Q3', 'FY'].map((period) => normalizeFinancialQualityData([{ 报告期: earningsPeriodSpec(2025, period as 'Q1' | 'H1' | 'Q3' | 'FY').endDate }], earningsPeriodSpec(2025, period as 'Q1' | 'H1' | 'Q3' | 'FY'), 'x').current?.daysInPeriod), [90, 181, 273, 365])
  assert.equal(normalizeFinancialQualityData([{ 报告期: '2024-06-30' }], earningsPeriodSpec(2024, 'H1'), 'x').current?.daysInPeriod, 182)
  assert.equal(normalizeFinancialQualityData([{ 报告期: '2024-12-31' }], earningsPeriodSpec(2024, 'FY'), 'x').current?.daysInPeriod, 366)
})

test('numeric parsing is explicit, malformed values remain unavailable, and ratios are not reverse-engineered', () => {
  const result = normalizeFinancialQualityData([{ 报告期: '2026-06-30', 营业收入: '1,234.50', 营业成本: '1亿', 营业收入周转率: '2.4', 总资产: 0 }], earningsPeriodSpec(2026, 'H1'), 'x')
  assert.equal(result.current?.revenue, 1234.5)
  assert.equal(result.current?.cogs, undefined)
  assert.equal(result.current?.totalAssets, 0)
  assert.ok(result.diagnostics.some((item) => item.includes('Malformed cogs')))
  assert.equal(Object.hasOwn(result.current ?? {}, '营业收入周转率'), false)
})

test('working-capital calculations fail closed by component', () => {
  const result = calculateWorkingCapital({ current: facts(), opening: facts({ receivables: 200, inventory: 100, payables: 150, period: '2025-FY', daysInPeriod: 365 }) })
  assert.equal(result.dso, 45.25)
  assert.equal(result.dio, 54.3)
  assert.equal(result.dpo, 72.4)
  assert.ok(Math.abs((result.cashConversionCycle ?? 0) - 27.15) < 1e-12)
  const missingDpo = calculateWorkingCapital({ current: facts({ payables: undefined }), opening: facts({ receivables: 200, inventory: 100, payables: undefined }) })
  assert.equal(missingDpo.dso, 45.25)
  assert.equal(missingDpo.dio, 54.3)
  assert.equal(missingDpo.dpo, undefined)
  assert.equal(missingDpo.cashConversionCycle, undefined)
  const zeroRevenue = calculateWorkingCapital({ current: facts({ revenue: 0 }), opening: facts() })
  assert.equal(zeroRevenue.dso, undefined)
  const zeroCogs = calculateWorkingCapital({ current: facts({ cogs: 0 }), opening: facts() })
  assert.equal(zeroCogs.dio, undefined)
  assert.equal(zeroCogs.dpo, undefined)
})

test('accrual quality uses average assets and fails closed for missing/non-positive assets', () => {
  const result = calculateAccrualQuality({ current: facts({ totalAssets: 2_000, netIncome: 100, cashFromOperations: 80 }), opening: facts({ totalAssets: 1_800 }) })
  assert.equal(result.accrualRatio, 20 / 1900)
  assert.equal(calculateAccrualQuality({ current: facts(), opening: facts({ totalAssets: undefined }) }).accrualRatio, undefined)
  assert.equal(calculateAccrualQuality({ current: facts({ totalAssets: 0 }), opening: facts({ totalAssets: 0 }) }).accrualRatio, undefined)
})

test('cash conversion supports negative net income and explicit FCF', () => {
  const result = calculateCashConversion({ current: facts({ cashFromOperations: 120, netIncome: 100, capex: 20 }) })
  assert.equal(result.cfoToNetIncome, 1.2)
  assert.equal(result.freeCashFlow, 100)
  assert.equal(result.fcfToNetIncome, 1)
  const negative = calculateCashConversion({ current: facts({ cashFromOperations: 50, netIncome: -100, capex: 20 }) })
  assert.equal(negative.cfoToNetIncome, -0.5)
  assert.equal(negative.freeCashFlow, 30)
  assert.equal(negative.fcfToNetIncome, -0.3)
  const zero = calculateCashConversion({ current: facts({ netIncome: 0 }) })
  assert.equal(zero.cfoToNetIncome, undefined)
  assert.equal(zero.fcfToNetIncome, undefined)
  assert.equal(zero.freeCashFlow, 100)
})

test('revenue-recognition flags use explicit threshold and safe semantics', () => {
  const current = facts({ revenue: 130, receivables: 150, contractAssets: 110, cashFromOperations: 110, deferredRevenue: 90 })
  const prior = facts({ period: '2025-H1', revenue: 100, receivables: 100, contractAssets: 100, cashFromOperations: 100, deferredRevenue: 100 })
  const result = analyzeRevenueRecognition({ current, priorComparable: prior, threshold: THRESHOLD })
  assert.deepEqual(result.flags.map((item) => item.code), ['receivables_outgrowing_sales', 'sales_outgrowing_cfo', 'context_dependent_deferred_revenue_divergence'])
  assert.equal(result.flags.some((item) => item.code === 'contract_assets_outgrowing_sales'), false)
  assert.ok(result.flags.every((item) => !/(?:is|indicates|constitutes|finding of)\s+(?:fraud|manipulation)/i.test(item.explanation)))
  assert.ok(result.flags.some((item) => item.code === 'context_dependent_deferred_revenue_divergence' && /context-dependent.*follow-up/i.test(item.explanation)))
  const unavailable = analyzeRevenueRecognition({ current: facts({ revenue: 130, cashFromOperations: 0 }), priorComparable: facts({ revenue: 0, cashFromOperations: -1 }), threshold: THRESHOLD })
  assert.deepEqual(unavailable.flags, [])
  assert.ok(unavailable.unavailableComparisons.includes('revenue_growth'))
  assert.ok(unavailable.unavailableComparisons.includes('cfo_growth'))
  const exact = analyzeRevenueRecognition({ current: facts({ revenue: 100, contractAssets: 110 }), priorComparable: facts({ revenue: 100, contractAssets: 100 }), threshold: THRESHOLD })
  assert.equal(exact.flags.some((item) => item.code === 'contract_assets_outgrowing_sales'), false)
})

test('summary is report-only, carries source candidate ID, and never contains non-finite values', () => {
  const normalized = { sourceCandidateId: 'akshare-earnings-600519-2026-H1', diagnostics: [], current: facts(), opening: facts({ period: '2025-FY', daysInPeriod: 365 }), priorComparable: facts({ period: '2025-H1', revenue: 100, receivables: 100, contractAssets: 100, cashFromOperations: 100, deferredRevenue: 100 }) }
  const summary = calculateEarningsFinancialQualitySummary(normalized, THRESHOLD)
  assert.equal(summary.sourceCandidateId, 'akshare-earnings-600519-2026-H1')
  assert.equal(summary.period, '2026-H1')
  assert.ok(summary.workingCapital.dso !== undefined)
  assert.ok(summary.accrualQuality.accrualRatio !== undefined)
  const sections = EARNINGS_REVIEW_SECTIONS.map((title) => ({ id: title, title, markdown: `Existing ${title}`, sourceCandidateIds: [] as string[], assessmentRefs: [] as string[] }))
  const enriched = enrichEarningsReviewSections(sections, summary)
  assert.equal(enriched.length, 14)
  assert.match(enriched.find((item) => item.title === 'Cash Flow / Working Capital')!.markdown, /DSO/)
  assert.match(enriched.find((item) => item.title === 'Earnings Quality')!.markdown, /Accrual ratio/)
  assert.ok(enriched.find((item) => item.title === 'Cash Flow / Working Capital')!.sourceCandidateIds.includes(summary.sourceCandidateId))
  const serialized = JSON.stringify(summary)
  assert.equal(/NaN|Infinity/.test(serialized), false)
})
