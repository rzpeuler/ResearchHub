import test from 'node:test'
import assert from 'node:assert/strict'
import type { CompanyFinancialObservation } from '../../data/company-research-contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { validateCompanyScenarioAssumptions, type CompanyScenarioAssumptionsPlan, type CompanyScenarioDriver, type CompanyScenarioValidationInput } from '../../workflows/company-deep-research/scenario-assumptions.ts'

const company = { symbol: 'TEST', exchange: 'SZSE' as const }
const source = (candidateId: string, publishedAt: string, content: string): NormalizedResearchSource => ({
  candidate: { candidateId, kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'issuer', publishedAt },
  retrievedAt: '2026-01-01T00:00:00Z', title: 'Annual report', content, contentHash: 'fixture-hash', publisher: 'issuer',
  rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: false, redistributionAllowed: false },
})
const observations: CompanyFinancialObservation[] = [
  { periodEnd: '2023-12-31', publishedAt: '2024-03-01', metrics: { revenue: 100, grossMargin: 10 }, metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, grossMargin: { unit: '%', currency: 'N/A', basis: 'YTD' } }, pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' },
  { periodEnd: '2024-12-31', publishedAt: '2025-03-01', metrics: { revenue: 120, grossMargin: 12 }, metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, grossMargin: { unit: '%', currency: 'N/A', basis: 'YTD' } }, pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' },
  { periodEnd: '2025-12-31', publishedAt: '2026-03-01', metrics: { revenue: 156, grossMargin: 14 }, metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, grossMargin: { unit: '%', currency: 'N/A', basis: 'YTD' } }, pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' },
]
const sources = [source('report-2023', '2024-03-01', '营业收入 2023 100 毛利率 2023 10'), source('report-2024', '2025-03-01', '营业收入 2024 120 毛利率 2024 12'), source('report-2025', '2026-03-01', '营业收入 2025 156 毛利率 2025 14'), source('counter', '2026-04-01', '竞争加剧导致收入承压')]
const history = observations.map((row, index) => ({ value: row.metrics.revenue!, periodEnd: row.periodEnd!, publishedAt: row.publishedAt!, evidence: { sourceCandidateId: `report-${2023 + index}`, location: 'paragraph:1' as const } }))
const makeDriver = (rate: number): CompanyScenarioDriver => ({
  id: 'revenue', metricKey: 'revenue', metricLabel: '营业收入', unit: 'CNY', currency: 'CNY', basis: 'YTD', historical: history,
  proposal: { rateOriginKind: 'RESEARCH_ASSUMPTION', rate, targetValue: 156 * (1 + rate), targetValueOriginKind: 'DERIVED', targetPeriod: '2026-12-31' },
  rationale: '以三年披露收入增速区间校准情景压力；本情景取区间内值。', derivation: '末期收入乘以一加情景增速。',
  counterevidence: [{ sourceCandidateId: 'counter', location: 'paragraph:1' }], falsificationTrigger: '后续年报收入低于情景值即证伪。',
  limitations: '历史区间不等同管理层指引，外推不保证实现。', forecastBridge: { formula: 'last_observation * (1 + rate)' },
  sensitivityRange: { lowRate: 0.2, highRate: 0.3 }, dependencies: [{ sourceCandidateId: 'report-2025', location: 'paragraph:1' }],
})
const marginHistory = observations.map((row, index) => ({ value: row.metrics.grossMargin!, periodEnd: row.periodEnd!, publishedAt: row.publishedAt!, evidence: { sourceCandidateId: `report-${2023 + index}`, location: 'paragraph:1' as const } }))
const makeMarginDriver = (rate: number): CompanyScenarioDriver => ({
  ...makeDriver(rate), id: 'gross-margin', metricKey: 'grossMargin', metricLabel: '毛利率', unit: '%', currency: 'N/A', historical: marginHistory,
  proposal: { rateOriginKind: 'RESEARCH_ASSUMPTION', rate, targetValue: 14 * (1 + rate), targetValueOriginKind: 'DERIVED', targetPeriod: '2026-12-31' },
  sensitivityRange: { lowRate: 1 / 6, highRate: 0.2 },
})
const makePlan = (): CompanyScenarioAssumptionsPlan => ({
  workflowRunId: 'run-1', company, asOf: '2026-06-30', targetFiscalYear: 2026,
  method: { name: 'DCF operating bridge', outputMetric: 'equity value', outputUnit: 'CNY', outputBasis: 'FY' },
  scenarios: [
    { name: 'bear', drivers: [makeDriver(0.2), makeMarginDriver(1 / 6)] },
    { name: 'base', drivers: [makeDriver(0.25), makeMarginDriver(0.18)] },
    { name: 'bull', drivers: [makeDriver(0.3), makeMarginDriver(0.2)] },
  ],
})
const input = (plan = makePlan(), overrides: Partial<Pick<CompanyScenarioValidationInput, 'sources' | 'observations'>> = {}): CompanyScenarioValidationInput => ({ plan, currentRunId: 'run-1', company, asOf: '2026-06-30', targetFiscalYear: plan.targetFiscalYear, sources, observations, ...overrides })

test('accepts current-FY scenarios with mixed revenue CNY and margin percent drivers grounded in exact rows', () => {
  const result = validateCompanyScenarioAssumptions(input())
  assert.equal(result.valid, true, result.diagnostics.join(', '))
  assert.deepEqual(result.diagnostics, [])
})

test('rejects an arbitrary rate outside the observed historical calibration range', () => {
  const plan = makePlan()
  const changed = { ...plan, scenarios: plan.scenarios.map(scenario => scenario.name === 'bull' ? { ...scenario, drivers: [makeDriver(0.8), makeMarginDriver(0.2)] } : scenario) }
  const result = validateCompanyScenarioAssumptions(input(changed))
  assert.equal(result.valid, false)
  assert.ok(result.diagnostics.includes('ASSUMPTION_RATE_OUTSIDE_HISTORICAL_CALIBRATION'))
  assert.ok(result.diagnostics.includes('SENSITIVITY_RANGE_INVALID_OR_UNCALIBRATED'))
})

test('rejects unrelated, stale, or mismatched historical evidence and observations', () => {
  const plan = makePlan()
  const brokenDriver = makeDriver(0.3)
  const bad = { ...brokenDriver, historical: [{ ...history[2]!, evidence: { sourceCandidateId: 'counter', location: 'paragraph:1' as const }, value: 999 }, ...history.slice(0, 2)] }
  const changed = { ...plan, scenarios: plan.scenarios.map(scenario => ({ ...scenario, drivers: [bad, makeMarginDriver(scenario.name === 'bear' ? 1 / 6 : scenario.name === 'base' ? 0.18 : 0.2)] })) }
  const result = validateCompanyScenarioAssumptions(input(changed))
  assert.equal(result.valid, false)
  assert.ok(result.diagnostics.includes('EVIDENCE_REF_IRRELEVANT_TO_METRIC'))
  assert.ok(result.diagnostics.includes('SOURCE_LOCATOR_VALUE_OR_PERIOD_MISMATCH'))
  assert.ok(result.diagnostics.includes('OBSERVATION_VALUE_PERIOD_UNIT_CURRENCY_OR_BASIS_MISMATCH'))
})

test('rejects missing rationale, counterevidence, falsification, sensitivity and wrong bridge arithmetic', () => {
  const plan = makePlan()
  const broken: CompanyScenarioDriver = { ...makeDriver(0.3), rationale: ' ', counterevidence: [], falsificationTrigger: '', sensitivityRange: { lowRate: 0.4, highRate: 0.5 }, proposal: { ...makeDriver(0.3).proposal, targetValue: 999 } }
  const changed = { ...plan, scenarios: plan.scenarios.map(scenario => ({ ...scenario, drivers: [broken, makeMarginDriver(scenario.name === 'bear' ? 1 / 6 : scenario.name === 'base' ? 0.18 : 0.2)] })) }
  const result = validateCompanyScenarioAssumptions(input(changed))
  assert.equal(result.valid, false)
  assert.ok(result.diagnostics.includes('RATIONALE_MISSING'))
  assert.ok(result.diagnostics.includes('COUNTEREVIDENCE_MISSING'))
  assert.ok(result.diagnostics.includes('FALSIFICATION_TRIGGER_MISSING'))
  assert.ok(result.diagnostics.includes('SENSITIVITY_RANGE_INVALID_OR_UNCALIBRATED'))
  assert.ok(result.diagnostics.includes('FORECAST_BRIDGE_ARITHMETIC_MISMATCH'))
})

test('rejects wrong run, company, past or unbounded target year, and future-dated sources', () => {
  const plan = makePlan()
  const futurePlan = { ...plan, workflowRunId: 'other', company: { symbol: 'OTHER' }, asOf: '2027-01-01', targetFiscalYear: 2025 }
  const result = validateCompanyScenarioAssumptions({ ...input(futurePlan), currentRunId: 'run-1' })
  assert.equal(result.valid, false)
  assert.ok(result.diagnostics.includes('RUN_ID_MISMATCH'))
  assert.ok(result.diagnostics.includes('COMPANY_MISMATCH'))
  assert.ok(result.diagnostics.includes('AS_OF_MISMATCH_OR_INVALID'))
  assert.ok(result.diagnostics.includes('TARGET_FISCAL_YEAR_INVALID'))
  assert.ok(validateCompanyScenarioAssumptions(input({ ...plan, targetFiscalYear: 2032 })).diagnostics.includes('TARGET_FISCAL_YEAR_INVALID'))
})

test('rejects driver currency and unit mismatches, observation source conflicts, and inconsistent driver sets', () => {
  const plan = makePlan()
  const revenue = makeDriver(0.2)
  const badCurrency = { ...revenue, currency: 'USD' }
  const badUnit = { ...revenue, unit: 'shares' }
  const mixed = { ...plan, scenarios: plan.scenarios.map(scenario => ({ ...scenario, drivers: scenario.name === 'bear' ? [badCurrency] : scenario.name === 'base' ? [badUnit] : [revenue, makeMarginDriver(0.2)] })) }
  const conflictedObservations = observations.map((row, index) => index === 0 ? { ...row, sourceConflicts: [{ metric: 'revenue', indicatorValue: 100, statementValue: 101 }] } : row)
  const result = validateCompanyScenarioAssumptions(input(mixed, { observations: conflictedObservations }))
  assert.ok(result.diagnostics.includes('OBSERVATION_VALUE_PERIOD_UNIT_CURRENCY_OR_BASIS_MISMATCH'))
  assert.ok(result.diagnostics.includes('OBSERVATION_SOURCE_CONFLICT_FOR_METRIC'))
  assert.ok(result.diagnostics.includes('SCENARIO_DRIVER_SET_INCONSISTENT'))
  assert.ok(result.diagnostics.includes('DRIVER_CONTRACT_INCONSISTENT_ACROSS_SCENARIOS'))
})

test('rejects conflicting duplicate observation rows and unauthorized source processing rights', () => {
  const plan = makePlan()
  const duplicated = [...observations, { ...observations[0]!, metrics: { ...observations[0]!.metrics, revenue: 101 } }]
  const unauthorizedSources = sources.map(item => item.candidate.candidateId === 'report-2024' ? { ...item, rights: { ...item.rights, accessScope: 'restricted' as const } } : item)
  const result = validateCompanyScenarioAssumptions(input(plan, { observations: duplicated, sources: unauthorizedSources }))
  assert.ok(result.diagnostics.includes('CONFLICTING_OBSERVATION_ROWS_FOR_PERIOD'))
  assert.ok(result.diagnostics.includes('SOURCE_RIGHTS_UNAUTHORIZED_FOR_RUN_EVIDENCE'))
})
