import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateEconomicBridge } from '../../workflows/company-deep-research/scenario-economic-bridge.ts'
import type { EconomicBridgeInput, EconomicBridgeLine, EconomicBridgeScalar } from '../../workflows/company-deep-research/scenario-method-contracts.ts'

const ev = (value: number) => value === 0 ? { status: 'KNOWN_ZERO' as const, value: 0 as const, evidenceRefs: ['fixture-zero'] as const } : { status: 'KNOWN' as const, value, evidenceRefs: ['fixture-value'] as const }
const unavailable = { status: 'UNAVAILABLE' as const, reason: 'fixture absent' }
const s = (sourceId: string, value: number, fields: Partial<EconomicBridgeScalar> = {}): EconomicBridgeScalar => ({
  value: ev(value), companySymbol: 'FIXTURE', metricId: sourceId, dimension: 'CURRENCY_AMOUNT', unit: 'CNY', currency: 'CNY', periodStart: '2026-01-01', periodEnd: '2026-06-30', periodBasis: 'H1_YTD', flowOrStock: 'FLOW',
  financialScope: 'CONSOLIDATED', economicScope: 'core', sourceId, accountId: sourceId, mappingRole: 'OPERATING', signConvention: 'SIGNED_AMOUNT', ...fields,
})
const line = (lineId: string, amount: number, patch: Partial<EconomicBridgeLine> = {}): EconomicBridgeLine => ({
  lineId, economicLineKey: lineId, bridgeId: 'bridge-fixture', companySymbol: 'FIXTURE', scenario: 'BASE', fromMetric: 'segmentRevenue', toMetric: 'revenue', operation: 'ADD', inputRefs: [`obs-${lineId}`], amount: ev(amount),
  dimension: 'CURRENCY_AMOUNT', unit: 'CNY', currency: 'CNY', periodStart: '2026-01-01', periodEnd: '2026-06-30', periodBasis: 'H1_YTD', flowOrStock: 'FLOW', financialScope: 'CONSOLIDATED', economicScope: 'core', originKind: 'FACT', formulaVersion: 'test-v1', evidenceRefs: [`ref-${lineId}`], adjustmentRefs: [], disposition: 'INCLUDED_ONCE', ...patch,
})
const proposal = (scenario: 'BEAR' | 'BASE' | 'BULL', patch: Partial<EconomicBridgeInput['calibrationProposals'][number]> = {}) => ({
  scenario, driverId: 'margin', baseline: 'current margin', proposedValue: 0.2, mechanism: 'process mix',
  calibration: { calibrationId: `cal-${scenario}`, lower: ev(0.1), upper: ev(0.3), dimension: 'RATE' as const, unit: 'fraction', currency: null, periodBasis: 'FY', financialScope: 'CONSOLIDATED', economicScope: 'core', method: 'operating mechanism', evidenceRefs: ['cal-ref'], category: 'OPERATIONAL_MECHANISM' as const, status: 'UNVERIFIED' as const },
  strongestCounterevidence: 'competition', trigger: 'margin below threshold', author: 'fixture-author', ...patch,
})
function input(overrides: Partial<EconomicBridgeInput> = {}): EconomicBridgeInput {
  const revenue = s('reported-revenue', 100)
  const current = s('cogs', 60)
  const expense = s('sga', 10, { signConvention: 'POSITIVE_EXPENSE', mappingRole: 'SG&A' })
  const other = s('other-income', 2, { mappingRole: 'OTHER_OPERATING_INCOME' })
  const nwc = (id: string, amount: number, periodEnd: string, role: string) => s(id, amount, { periodStart: periodEnd === '2025-12-31' ? '2025-01-01' : '2026-01-01', periodEnd, periodBasis: periodEnd === '2025-12-31' ? 'FY' : 'H1_YTD', flowOrStock: 'STOCK', mappingRole: role })
  return {
    mode: 'FIXTURE_ONLY', companySymbol: 'FIXTURE', bridgeId: 'bridge-fixture', analysisAsOf: '2026-07-01T00:00:00Z',
    horizon: { scenario: 'BASE', periodStart: '2026-01-01', periodEnd: '2026-06-30', periodBasis: 'H1_YTD' }, formulaVersion: 'economic-bridge-fixture-v1', rightsVersionClaim: 'UNVERIFIED_FIXTURE_CLAIM', valueVersionClaim: 'UNVERIFIED_FIXTURE_CLAIM',
    sourceTimeClaims: { sourcePublishedAt: '2026-06-30T00:00:00Z', retrievedAt: '2026-07-02T00:00:00Z', valueVersionAvailableAt: '2026-06-30T00:00:00Z', snapshotCapturedAt: null, snapshotSealedAt: null },
    revenue: { lines: [line('seg-a', 100)], selectedRoute: 'DISCLOSED_SEGMENT_REVENUE', volume: null, realizedNetAsp: null, reportedConsolidatedRevenue: revenue, adjustments: [] },
    profit: { cogs: current, operatingExpenses: [expense], otherOperatingIncome: [other], signedNetFinanceItems: s('finance', -2), signedNonOperatingItems: s('nonop', 0), incomeTaxExpense: s('tax', 5, { signConvention: 'POSITIVE_EXPENSE' }), profitAttributableToNci: s('nci', 3), nciBasis: 'CONSOLIDATED_TO_PARENT', ebit: s('ebit', 30), nonRecurringItems: [] },
    fcff: { unleveredEbit: s('fcff-ebit', 30), taxRate: s('tax-rate', 0.25, { dimension: 'RATE', unit: 'fraction', currency: null }), taxConvention: 'unlevered rate fixture', da: s('da', 4), capex: s('capex', 6, { signConvention: 'POSITIVE_CASH_OUTFLOW' }), nwcStart: [nwc('inventory', 10, '2025-12-31', 'OPERATING_CURRENT_ASSET'), nwc('payables', 4, '2025-12-31', 'OPERATING_CURRENT_LIABILITY')], nwcEnd: [nwc('inventory', 12, '2026-06-30', 'OPERATING_CURRENT_ASSET'), nwc('payables', 5, '2026-06-30', 'OPERATING_CURRENT_LIABILITY')], nwcComplete: true, excludedOperatingCapitalIds: ['cash', 'debt'], leaseTreatment: 'explicit fixture exclusion', acquisitionTreatment: 'none in fixture', taxTreatment: 'H1_YTD unchanged', cfo: null, purchasesOfLongTermAssets: null },
    calibrationProposals: [proposal('BEAR'), proposal('BASE'), proposal('BULL')], ...overrides,
  }
}
const has = (result: ReturnType<typeof calculateEconomicBridge>, code: string) => result.diagnostics.some((d) => d.code === code)

test('F25 segment and recognized volume times net ASP routes are separately calculable; overlap rejects', () => {
  const segment = calculateEconomicBridge(input())
  assert.equal(segment.components.revenue?.value, 100)
  const volume = s('volume', 10, { dimension: 'COUNT', unit: 'unit', currency: null, mappingRole: 'RECOGNIZED_REVENUE_VOLUME' })
  const asp = s('net-asp', 10, { dimension: 'CURRENCY_PER_UNIT', unit: 'CNY/unit', mappingRole: 'REALIZED_NET_ASP' })
  const volumeResult = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('cross-check', 100, { disposition: 'CROSS_CHECK_ONLY' })], selectedRoute: 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP', volume, realizedNetAsp: asp } }))
  assert.equal(volumeResult.components.revenue?.value, 100)
  const duplicate = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('seg-a', 100), line('seg-b', 20, { economicLineKey: 'seg-a' })] } }))
  assert.ok(has(duplicate, 'DOUBLE_COUNTED_REVENUE_PATH'))
})

test('F26 rejects incompatible period, currency, unit, scope, and flow-stock metadata', () => {
  const bad = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('seg-a', 100, { periodBasis: 'FY', unit: 'CNY-thousand', economicScope: 'subsidiary' })] } }))
  assert.ok(has(bad, 'PERIOD_MISMATCH'))
  assert.ok(has(bad, 'SCOPE_MISMATCH'))
  assert.ok(has(bad, 'UNIT_MISMATCH'))
  const otherCompany = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('foreign', 100, { companySymbol: 'OTHER' })] } }))
  assert.ok(has(otherCompany, 'SCOPE_MISMATCH'))
  const otherCurrency = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('foreign-currency', 100, { currency: 'USD' })] } }))
  assert.ok(has(otherCurrency, 'UNIT_MISMATCH'))
  const otherShareBasis = calculateEconomicBridge(input({ revenue: { ...input().revenue, reportedConsolidatedRevenue: { ...input().revenue.reportedConsolidatedRevenue, shareBasis: 'BASIC' }, lines: [line('share-basis', 100, { shareBasis: 'DILUTED' })] } }))
  assert.ok(has(otherShareBasis, 'UNIT_MISMATCH'))
  const stockFlow = calculateEconomicBridge(input({ fcff: { ...input().fcff, nwcEnd: input().fcff.nwcEnd.map((x) => ({ ...x, flowOrStock: 'FLOW' as const })) } }))
  assert.ok(has(stockFlow, 'FCFF_INPUTS_MISSING'))
})

test('F27 applies unique consolidation adjustments once and reports explicit residual', () => {
  const adj = { adjustmentId: 'elim-1', accountId: 'elim-account', kind: 'ELIMINATION' as const, signedAmount: s('elim', -5), overlapsLineId: null, evidenceRefs: ['elim-ref'] }
  const result = calculateEconomicBridge(input({ revenue: { ...input().revenue, adjustments: [adj] } }))
  assert.equal(result.components.revenue?.value, 95)
  assert.equal(result.residual.value, 5)
  const dup = calculateEconomicBridge(input({ revenue: { ...input().revenue, adjustments: [adj, adj] } }))
  assert.ok(has(dup, 'DUPLICATE_ADJUSTMENT'))
})

test('F28 computes gross and operating profit with mapped expenses and rejects overlap or missing COGS', () => {
  const result = calculateEconomicBridge(input())
  assert.equal(result.components.grossProfit?.value, 40)
  assert.equal(result.components.operatingProfit?.value, 32)
  const overlap = calculateEconomicBridge(input({ profit: { ...input().profit, operatingExpenses: [input().profit.operatingExpenses[0]!, { ...input().profit.operatingExpenses[0]!, sourceId: 'sga-duplicate' }] } }))
  assert.ok(has(overlap, 'ACCOUNT_MAPPING_OVERLAP'))
  const oneOff = calculateEconomicBridge(input({ profit: { ...input().profit, nonRecurringItems: [{ adjustmentId: 'oneoff', accountId: 'sga', amount: s('oneoff', 10), treatment: 'INCLUDED_IN_OPERATING_EXPENSES', overlapsAccountId: 'sga' }] } }))
  assert.ok(has(oneOff, 'ACCOUNT_MAPPING_OVERLAP'))
  const missing = calculateEconomicBridge(input({ profit: { ...input().profit, cogs: { ...input().profit.cogs, value: unavailable } } }))
  assert.equal(missing.components.grossProfit?.status, 'UNAVAILABLE')
})

test('F29 computes PBT to consolidated and parent NP with signed NCI; missing NCI fails closed', () => {
  const r = calculateEconomicBridge(input())
  assert.equal(r.components.pbt?.value, 30)
  assert.equal(r.components.consolidatedNetProfit?.value, 25)
  assert.equal(r.components.parentNetProfit?.value, 22)
  const missing = calculateEconomicBridge(input({ profit: { ...input().profit, nciBasis: 'MISSING', profitAttributableToNci: { ...input().profit.profitAttributableToNci, value: unavailable } } }))
  assert.equal(missing.components.parentNetProfit?.status, 'UNAVAILABLE')
  assert.ok(has(missing, 'NCI_SCOPE_MISSING'))
  const nciLoss = calculateEconomicBridge(input({ profit: { ...input().profit, profitAttributableToNci: s('nci-loss', -3) } }))
  assert.equal(nciLoss.components.parentNetProfit?.value, 28)
  const epsAsNci = calculateEconomicBridge(input({ profit: { ...input().profit, profitAttributableToNci: s('eps', 3, { metricId: 'EPS' }) } }))
  assert.equal(epsAsNci.components.parentNetProfit?.status, 'UNAVAILABLE')
})

test('F30 computes FCFF with EBIT, tax, D&A, CapEx and paired operating NWC', () => {
  const r = calculateEconomicBridge(input())
  assert.equal(r.components.deltaNwc?.value, 1)
  assert.equal(r.components.fcff?.value, 19.5)
  const missing = calculateEconomicBridge(input({ fcff: { ...input().fcff, da: { ...input().fcff.da, value: unavailable } } }))
  assert.equal(missing.components.fcff?.status, 'UNAVAILABLE')
  assert.ok(has(missing, 'FCFF_INPUTS_MISSING'))
})

test('F31 CFO less long-term purchases is separate from unavailable FCFF', () => {
  const fc = input().fcff
  const r = calculateEconomicBridge(input({ fcff: { ...fc, unleveredEbit: { ...fc.unleveredEbit, value: unavailable }, cfo: s('cfo', 12), purchasesOfLongTermAssets: s('lt-purchases', 7, { signConvention: 'POSITIVE_CASH_OUTFLOW' }) } }))
  assert.equal(r.cashFlowDifference.value, 5)
  assert.equal(r.components.fcff?.status, 'UNAVAILABLE')
  assert.ok(has(r, 'FCFF_INPUTS_MISSING'))
})

test('F32 preserves H1_YTD and distinguishes KNOWN_ZERO from unavailable or not applicable', () => {
  const r = calculateEconomicBridge(input())
  assert.equal(r.components.revenue?.value, 100, 'H1 values are not annualized')
  const zero = calculateEconomicBridge(input({ revenue: { ...input().revenue, adjustments: [{ adjustmentId: 'zero', accountId: 'zero-account', kind: 'RECLASSIFICATION', signedAmount: { ...s('zero', 0), value: ev(0) }, overlapsLineId: null, evidenceRefs: ['zero-ref'] }] } }))
  assert.equal(zero.components.revenue?.value, 100)
  const na = calculateEconomicBridge(input({ revenue: { ...input().revenue, adjustments: [{ adjustmentId: 'na', accountId: 'na-account', kind: 'RECLASSIFICATION', signedAmount: { ...s('na', 0), value: { status: 'NOT_APPLICABLE', reason: 'not in scope', evidenceRefs: ['na-ref'] } }, overlapsLineId: null, evidenceRefs: ['na-ref'] }] } }))
  assert.equal(na.components.revenue?.status, 'UNAVAILABLE')
})

test('F33 acquisition, disposal, reclassification and elimination remain separately signed adjustments', () => {
  const adjustments = [
    { adjustmentId: 'acq', accountId: 'a', kind: 'ACQUISITION' as const, signedAmount: s('acq', 8), overlapsLineId: null, evidenceRefs: ['a-ref'] },
    { adjustmentId: 'disp', accountId: 'd', kind: 'DISPOSAL' as const, signedAmount: s('disp', -3), overlapsLineId: null, evidenceRefs: ['d-ref'] },
    { adjustmentId: 'reclass', accountId: 'r', kind: 'RECLASSIFICATION' as const, signedAmount: s('reclass', 2), overlapsLineId: null, evidenceRefs: ['r-ref'] },
  ]
  const r = calculateEconomicBridge(input({ revenue: { ...input().revenue, adjustments } }))
  assert.equal(r.components.revenue?.value, 107)
  const noReported = calculateEconomicBridge(input({ revenue: { ...input().revenue, reportedConsolidatedRevenue: { ...input().revenue.reportedConsolidatedRevenue, value: unavailable } } }))
  assert.equal(noReported.residual.status, 'UNAVAILABLE')
  assert.ok(has(noReported, 'RESIDUAL_UNVERIFIED'))
})

test('F34 missing assumption review fields keep all scenarios REVIEW_REQUIRED', () => {
  const r = calculateEconomicBridge(input({ calibrationProposals: [proposal('BEAR', { author: null }), proposal('BASE', { trigger: null }), proposal('BULL', { baseline: null })] }))
  assert.equal(r.assumptionReviewStatus, 'REVIEW_REQUIRED')
  assert.ok(r.diagnostics.filter((d) => d.code === 'REVIEW_REQUIRED').length >= 3)
})

test('F35 historical or industry extrema cannot qualify as operational calibration', () => {
  const historical = { ...proposal('BASE'), calibration: { ...proposal('BASE').calibration!, category: 'HISTORICAL_OR_INDUSTRY_ENVELOPE' as const } }
  const r = calculateEconomicBridge(input({ calibrationProposals: [proposal('BEAR'), historical, proposal('BULL')] }))
  assert.ok(has(r, 'HISTORICAL_ENVELOPE_NOT_CALIBRATION'))
  assert.equal(r.assumptionReviewStatus, 'REVIEW_REQUIRED')
})

test('extra regressions: non-finite, negative volume, zero gross margin denominator, overflow and hash invariants', () => {
  const nan = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('nan', Number.NaN)] } }))
  assert.ok(has(nan, 'INVALID_NUMBER') || has(nan, 'INVALID_STRUCTURE'))
  const neg = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [], selectedRoute: 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP', volume: s('volume', -1, { dimension: 'COUNT', unit: 'unit', currency: null, mappingRole: 'RECOGNIZED_REVENUE_VOLUME' }), realizedNetAsp: s('asp', 2, { dimension: 'CURRENCY_PER_UNIT', unit: 'CNY/unit', mappingRole: 'REALIZED_NET_ASP' }) } }))
  assert.ok(has(neg, 'NEGATIVE_PHYSICAL_QUANTITY'))
  const zeroRevenue = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('zero', 0)], reportedConsolidatedRevenue: { ...input().revenue.reportedConsolidatedRevenue, value: ev(0) } } }))
  assert.equal(zeroRevenue.components.grossMargin?.status, 'UNAVAILABLE')
  assert.ok(has(zeroRevenue, 'MISSING_REQUIRED_OPERAND'))
  const overflow = calculateEconomicBridge(input({ revenue: { ...input().revenue, lines: [line('huge-a', Number.MAX_VALUE), line('huge-b', Number.MAX_VALUE)] } }))
  assert.ok(has(overflow, 'INVALID_NUMBER'))
  const base = input({ revenue: { ...input().revenue, lines: [line('a', 40), line('b', 60)] } })
  const stable = calculateEconomicBridge(base)
  const reordered = calculateEconomicBridge({ ...base, revenue: { ...base.revenue, lines: [...base.revenue.lines].reverse() } })
  assert.equal(stable.inputHash, reordered.inputHash)
  assert.equal(stable.reportEligible, false)
  assert.notEqual(stable.inputHash, calculateEconomicBridge({ ...base, formulaVersion: 'v-next' }).inputHash)
  assert.notEqual(stable.inputHash, calculateEconomicBridge({ ...base, rightsVersionClaim: 'changed' }).inputHash)
  assert.notEqual(stable.inputHash, calculateEconomicBridge({ ...base, valueVersionClaim: 'changed' }).inputHash)
  assert.notEqual(stable.inputHash, calculateEconomicBridge({ ...base, analysisAsOf: '2026-07-03T00:00:00Z' }).inputHash)
  const untouched = structuredClone(base)
  calculateEconomicBridge(base)
  assert.deepEqual(base, untouched)
  const malformed = calculateEconomicBridge(null as unknown as EconomicBridgeInput)
  assert.equal(malformed.status, 'UNAVAILABLE')
})
