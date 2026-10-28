import test from 'node:test'
import assert from 'node:assert/strict'
import type { CompanyFinancialObservation } from '../../data/company-research-contracts.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'
import { buildCompanyScenarioAssumptionPlan, validateCompanyScenarioAssumptions } from '../../workflows/company-deep-research/scenario-assumptions.ts'

const asOf = '2026-10-28T00:00:00Z'
const reportRows = (input: { companyName: string; years: number[]; revenue: number[]; profit: number[]; publishedAt: string; titleYear: number; candidateId: string }): NormalizedResearchSource => {
  const growth = (values: number[], index: number): string => `${((values[index]! / values[index + 1]! - 1) * 100).toFixed(2)}%`
  const years = input.years
  const formatAmount = (value: number): string => value.toLocaleString('en-US', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const revenueCells = [input.revenue[0], input.revenue[1], growth(input.revenue, 0), input.revenue[2]].map(value => typeof value === 'number' ? formatAmount(value) : value).join(' ')
  const profitCells = [input.profit[0], input.profit[1], growth(input.profit, 0), input.profit[2]].map(value => typeof value === 'number' ? formatAmount(value) : value).join(' ')
  const content = [
    `${input.companyName} ${input.titleYear} 年年度报告全文`,
    `${input.companyName}`,
    `${input.titleYear} 年年度报告`,
    '',
    '主要会计数据和财务指标',
    '公司是否需追溯调整或重述以前年度会计数据',
    '□是 ☑否',
    years.map(year => `${year} 年`).join(' ') + ' 本年比上年增减',
    `营业收入（元） ${revenueCells}`,
    `归属于上市公司股东的净利润（元） ${profitCells}`,
  ].join('\n')
  return source(input.candidateId, `${input.titleYear}年年度报告`, input.publishedAt, content, input.companyName)
}

function halfYearSource(companyName: string, candidateId: string, publishedAt: string, revenue: [number, number], profit: [number, number]): NormalizedResearchSource {
  const content = [
    `${companyName} 2026 年半年度报告全文`, `${companyName}`, '2026 年半年度报告', '', '主要会计数据和财务指标',
    '本报告期 上年同期', '本报告期比上年同期增减',
    `营业收入（元） ${revenue[0].toLocaleString('en-US', { useGrouping: true })} ${revenue[1].toLocaleString('en-US', { useGrouping: true })} 8.00%`,
    `归属于上市公司股东的净利润（元） ${profit[0].toLocaleString('en-US', { useGrouping: true })} ${profit[1].toLocaleString('en-US', { useGrouping: true })} -8.00%`,
  ].join('\n')
  return source(candidateId, '2026年半年度报告', publishedAt, content, companyName)
}

function source(candidateId: string, title: string, publishedAt: string, content: string, companyName: string, rights: Partial<NormalizedResearchSource['rights']> = {}): NormalizedResearchSource {
  return {
    candidate: { candidateId, kind: 'official_disclosure', tier: 1, title, provider: 'CNINFO', publishedAt },
    retrievedAt: '2026-10-28T00:00:00Z', title, content, contentHash: `hash-${candidateId}`, publisher: companyName,
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: false, redistributionAllowed: false, ...rights },
  }
}

interface Fixture {
  readonly company: ResearchCompanyIdentity
  readonly observations: CompanyFinancialObservation[]
  readonly sources: NormalizedResearchSource[]
}

function fixture(companyName: string, symbol: string, revenue: [number, number, number], profit: [number, number, number], h1Revenue: [number, number], h1Profit: [number, number]): Fixture {
  const company = { name: companyName, symbol, exchange: 'SZSE' }
  const years = [2025, 2024, 2023]
  const annual2024 = reportRows({ companyName, years: [2024, 2023, 2022], revenue: [revenue[1], revenue[0], revenue[0] * 0.85], profit: [profit[1], profit[0], profit[0] * 0.85], publishedAt: '2025-03-27T00:00:00Z', titleYear: 2024, candidateId: `${symbol}-fy2024` })
  const annual2025 = reportRows({ companyName, years, revenue: [revenue[2], revenue[1], revenue[0]], profit: [profit[2], profit[1], profit[0]], publishedAt: '2026-03-27T00:00:00Z', titleYear: 2025, candidateId: `${symbol}-fy2025` })
  const h1 = halfYearSource(companyName, `${symbol}-h1-2026`, '2026-08-28T00:00:00Z', h1Revenue, h1Profit)
  const observations: CompanyFinancialObservation[] = [
    ...[2023, 2024, 2025].map((year, index) => ({
      periodEnd: `${year}-12-31`, publishedAt: `${year + 1}-03-28T00:00:00Z`,
      metrics: { revenue: revenue[index], netProfit: profit[index] },
      metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' as const }, netProfit: { unit: 'CNY', currency: 'CNY', basis: 'YTD' as const } },
      pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' as const,
    })),
    { periodEnd: '2025-06-30', publishedAt: '2025-08-01T00:00:00Z', metrics: { revenue: h1Revenue[1], netProfit: h1Profit[1] }, metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, netProfit: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } }, pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' },
    { periodEnd: '2026-06-30', publishedAt: '2026-08-29T00:00:00Z', metrics: { revenue: h1Revenue[0], netProfit: h1Profit[0] }, metricMetadata: { revenue: { unit: 'CNY', currency: 'CNY', basis: 'YTD' }, netProfit: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } }, pointInTimeSafe: true, pointInTimeStatus: 'CURRENT_VALUE_ONLY' },
  ]
  return { company, observations, sources: [annual2024, annual2025, h1] }
}

const byd = fixture('比亚迪', '002594', [602_315_354_000, 777_102_455_000, 803_964_958_000], [30_040_811_000, 40_254_346_000, 32_619_022_000], [344_815_421_000, 371_280_948_000], [12_325_408_000, 15_510_533_000])
const dongshan = fixture('东山精密', '002384', [33_651_205_468.8, 36_770_374_347.58, 40_124_858_839.52], [1_964_525_269.65, 1_085_641_847.89, 1_386_066_705.56], [27_797_683_972.88, 16_955_163_898.89], [2_956_898_811.04, 758_005_980.61])

function build(f: Fixture, overrides: Partial<Parameters<typeof buildCompanyScenarioAssumptionPlan>[0]> = {}) {
  return buildCompanyScenarioAssumptionPlan({ runId: 'run-1', company: f.company, asOf, targetFiscalYear: 2026, observations: f.observations, sources: f.sources, ...overrides })
}
function validate(f: Fixture, plan = build(f).plan!) {
  return validateCompanyScenarioAssumptions({ plan, currentRunId: 'run-1', company: f.company, asOf, targetFiscalYear: 2026, observations: f.observations, sources: f.sources })
}

test('generates BYD and Dongshan FY2026 candidates from precisely paired annual rows', () => {
  for (const f of [byd, dongshan]) {
    const result = build(f)
    assert.equal(result.status, 'candidate_requires_semantic_review')
    assert.deepEqual(result.diagnostics, ['ECONOMIC_RATIONALE_NOT_PROVEN_BY_HISTORICAL_DATA'])
    assert.ok(result.plan)
    assert.equal(result.plan!.scenarios.length, 3)
    assert.deepEqual(result.plan!.scenarios.map(item => item.name), ['bear', 'base', 'bull'])
    assert.equal(result.plan!.economicRationaleStatus, 'REQUIRES_SEMANTIC_REVIEW')
    const validation = validate(f, result.plan)
    assert.equal(validation.structurallyValid, true, validation.diagnostics.join(', '))
    assert.equal(validation.valid, false)
    assert.equal(validation.reportEligible, false)
    assert.ok(validation.diagnostics.includes('ECONOMIC_RATIONALE_REQUIRES_INDEPENDENT_SEMANTIC_REVIEW'))
    const rates = result.plan!.scenarios.map(scenario => scenario.drivers[0]!.proposal.rate)
    assert.ok(rates[0]! < rates[1]! && rates[1]! < rates[2]!)
    assert.ok(result.plan!.scenarios.every(scenario => scenario.drivers.every(driver => driver.proposal.rateOriginKind === 'RESEARCH_ASSUMPTION' && driver.proposal.targetValueOriginKind === 'DERIVED')))
    for (const scenario of result.plan!.scenarios) {
      assert.equal(scenario.drivers.length, 2)
      assert.equal(scenario.drivers[0]!.proposal.targetValue, scenario.drivers[0]!.historical[2]!.value * (1 + scenario.drivers[0]!.proposal.rate))
      assert.equal(scenario.drivers[1]!.proposal.targetValue, scenario.drivers[1]!.historical[2]!.value * (1 + scenario.drivers[1]!.proposal.rate))
      assert.equal(scenario.impliedParentNetMargin.value, scenario.drivers[1]!.proposal.targetValue / scenario.drivers[0]!.proposal.targetValue)
    }
  }
})

test('filters percentage columns and pairs annual values by the separate year header', () => {
  const result = build(byd)
  assert.ok(result.plan)
  const revenue = result.plan!.scenarios[1]!.drivers.find(driver => driver.id === 'revenue')!
  assert.deepEqual(revenue.historical.map(point => point.value), [602_315_354_000, 777_102_455_000, 803_964_958_000])
  assert.deepEqual(revenue.historical.map(point => point.evidence.location), ['paragraph:9', 'paragraph:9', 'paragraph:9'])
  assert.equal(result.plan!.h1CrossCheck.revenue.current, 344_815_421_000)
  assert.equal(result.plan!.h1CrossCheck.revenue.prior, 371_280_948_000)
  assert.notEqual(result.plan!.h1CrossCheck.revenue.current, revenue.historical[2]!.value)
})

test('3x3 sensitivity independently recomputes every revenue and parent-profit rate combination', () => {
  const result = build(dongshan)
  const grid = result.plan!.sensitivityGrid
  assert.equal(grid.cells.length, 3)
  assert.ok(grid.cells.every(row => row.length === 3))
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const cell = grid.cells[row]![column]!
    assert.equal(cell.revenue, dongshan.observations.find(item => item.periodEnd === '2025-12-31')!.metrics.revenue! * (1 + grid.rowRates[row]!))
    assert.equal(cell.parentNetProfit, dongshan.observations.find(item => item.periodEnd === '2025-12-31')!.metrics.netProfit! * (1 + grid.columnRates[column]!))
    assert.equal(cell.impliedParentNetMargin, cell.parentNetProfit / cell.revenue)
    assert.equal(cell.originKind, 'DERIVED')
  }
  const validation = validate(dongshan)
  assert.equal(validation.structurallyValid, true, validation.diagnostics.join(', '))
})

test('blocks target years outside FY2026, missing company identity, and history-only claims of economic validity', () => {
  assert.ok(build(byd, { targetFiscalYear: 2025 }).diagnostics.includes('ONLY_FY2026_SCENARIOS_SUPPORTED'))
  assert.ok(build(byd, { company: { symbol: '002594', exchange: 'SZSE' } }).diagnostics.includes('RUN_COMPANY_OR_AS_OF_UNVERIFIABLE'))
  const result = build(byd)
  assert.equal(result.status, 'candidate_requires_semantic_review')
  assert.ok(result.diagnostics.includes('ECONOMIC_RATIONALE_NOT_PROVEN_BY_HISTORICAL_DATA'))
})

test('rejects company-mismatched reports and annual rows whose year/value columns are swapped', () => {
  const wrongCompany = byd.sources.map(item => item.candidate.candidateId === '002594-fy2025' ? { ...item, content: item.content.replaceAll('比亚迪', '其他公司') } : item)
  const wrongCompanyResult = build(byd, { sources: wrongCompany })
  assert.equal(wrongCompanyResult.status, 'blocked')
  assert.ok(wrongCompanyResult.diagnostics.some(item => item.includes('ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN')))

  const swapped = byd.sources.map(item => item.candidate.candidateId === '002594-fy2025'
    ? { ...item, content: item.content.replace('803,964,958,000.00 777,102,455,000.00 3.46% 602,315,354,000.00', '602,315,354,000.00 777,102,455,000.00 3.46% 803,964,958,000.00') }
    : item)
  const swappedResult = build(byd, { sources: swapped })
  assert.equal(swappedResult.status, 'blocked', swappedResult.diagnostics.join(', '))

  const revised = byd.sources.map(item => item.candidate.candidateId === '002594-fy2025'
    ? { ...item, content: item.content.replace('602,315,354,000.00', '612,315,354,000.00') }
    : item)
  assert.equal(build(byd, { sources: revised }).status, 'blocked')
})

test('blocks missing/unauthorized exact source rows, bad source dates, and unsupported half-year cross-checks', () => {
  const noH1 = byd.sources.filter(item => item.candidate.candidateId !== '002594-h1-2026')
  assert.ok(build(byd, { sources: noH1 }).diagnostics.includes('FY2026_H1_CROSS_CHECK_UNPROVEN:revenue'))
  const unauthorized = byd.sources.map(item => item.candidate.candidateId.startsWith('002594-fy') ? { ...item, rights: { ...item.rights, aiProcessingAllowed: false } } : item)
  assert.equal(build(byd, { sources: unauthorized }).status, 'blocked')
  const future = byd.sources.map(item => item.candidate.candidateId === '002594-h1-2026' ? { ...item, candidate: { ...item.candidate, publishedAt: '2026-11-01T00:00:00Z' } } : item)
  assert.equal(build(byd, { sources: future }).status, 'blocked')
})

test('rejects duplicated, conflicted, nonpositive, or non-CNY/YTD annual observations', () => {
  const duplicate = [...byd.observations, byd.observations[0]!]
  assert.ok(build(byd, { observations: duplicate }).diagnostics.some(item => item.includes('ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN')))
  const conflicted = byd.observations.map(item => item.periodEnd === '2024-12-31' ? { ...item, sourceConflicts: [{ metric: 'revenue', indicatorValue: 1, statementValue: 2 }] } : item)
  assert.ok(build(byd, { observations: conflicted }).diagnostics.some(item => item.includes('ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN')))
  const nonpositive = byd.observations.map(item => item.periodEnd === '2023-12-31' ? { ...item, metrics: { ...item.metrics, netProfit: 0 } } : item)
  assert.ok(build(byd, { observations: nonpositive }).diagnostics.includes('ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN:netProfit:2023'))
  const wrongUnit = byd.observations.map(item => item.periodEnd === '2025-12-31' ? { ...item, metricMetadata: { ...item.metricMetadata, revenue: { unit: 'USD', currency: 'USD', basis: 'YTD' as const } } } : item)
  assert.ok(build(byd, { observations: wrongUnit }).diagnostics.some(item => item.includes('ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN:revenue:2025')))
})

test('rejects duplicated, equal, tampered, or unordered scenarios and a changed method', () => {
  const base = build(byd).plan!
  const sameScenarioRates = {
    ...base,
    scenarios: base.scenarios.map(scenario => ({
      ...scenario,
      drivers: scenario.drivers.map(driver => {
        if (scenario.name !== 'bull') return driver
        const baseRate = base.scenarios[1]!.drivers.find(other => other.id === driver.id)!.proposal.rate
        return { ...driver, proposal: { ...driver.proposal, rate: baseRate, targetValue: driver.historical[2]!.value * (1 + baseRate) } }
      }) as unknown as typeof scenario.drivers,
    })),
  }
  const sameResult = validate(byd, sameScenarioRates)
  assert.equal(sameResult.structurallyValid, false)
  assert.ok(sameResult.diagnostics.includes('SCENARIO_RATE_NOT_HISTORICAL_ENVELOPE_POINT'))
  const changedMethod = validate(byd, { ...base, method: { ...base.method, outputBasis: 'QUARTER' as 'FY' } })
  assert.ok(changedMethod.diagnostics.includes('METHOD_BASIS_INCONSISTENT'))
  const badGrid = { ...base, sensitivityGrid: { ...base.sensitivityGrid, cells: base.sensitivityGrid.cells.map((row, index) => index === 0 ? row.map(cell => ({ ...cell, revenue: -1 })) as unknown as typeof row : row) as typeof base.sensitivityGrid.cells } }
  assert.ok(validate(byd, badGrid).diagnostics.includes('SENSITIVITY_GRID_ARITHMETIC_OR_MONOTONICITY_INVALID'))
})

test('validator rechecks exact annual row pairing, data source rights, and H1 row binding', () => {
  const base = build(byd).plan!
  const firstDriver = base.scenarios[0]!.drivers[0]!
  const tamperedPoint = { ...firstDriver.historical[0]!, evidence: { ...firstDriver.historical[0]!.evidence, location: 'paragraph:10' as const } }
  const tampered = { ...base, scenarios: base.scenarios.map(scenario => ({ ...scenario, drivers: scenario.drivers.map(driver => driver.id === 'revenue' ? { ...driver, historical: [tamperedPoint, ...driver.historical.slice(1)] } : driver) as unknown as typeof scenario.drivers })) }
  assert.ok(validate(byd, tampered).diagnostics.includes('ANNUAL_REPORT_YEAR_VALUE_PAIR_MISMATCH'))
  const unauthorizedSources = byd.sources.map(item => item.candidate.candidateId === '002594-fy2025' ? { ...item, rights: { ...item.rights, retentionAllowed: false } } : item)
  const invalid = validateCompanyScenarioAssumptions({ plan: base, currentRunId: 'run-1', company: byd.company, asOf, targetFiscalYear: 2026, observations: byd.observations, sources: unauthorizedSources })
  assert.ok(invalid.diagnostics.includes('ANNUAL_EVIDENCE_UNRESOLVED_OR_UNAUTHORIZED'))
})

test('preserves real annual values and exact fiscal-year pairing for BYD and Dongshan', () => {
  const expected: readonly [Fixture, number[], number[]][] = [
    [byd, [602_315_354_000, 777_102_455_000, 803_964_958_000], [30_040_811_000, 40_254_346_000, 32_619_022_000]],
    [dongshan, [33_651_205_468.8, 36_770_374_347.58, 40_124_858_839.52], [1_964_525_269.65, 1_085_641_847.89, 1_386_066_705.56]],
  ]
  for (const [f, revenueValues, profitValues] of expected) {
    const plan = build(f).plan!
    const revenue = plan.scenarios[0]!.drivers.find(driver => driver.id === 'revenue')!
    const profit = plan.scenarios[0]!.drivers.find(driver => driver.id === 'parent-net-profit')!
    assert.deepEqual(revenue.historical.map(point => point.value), revenueValues)
    assert.deepEqual(profit.historical.map(point => point.value), profitValues)
    assert.deepEqual(revenue.historical.map(point => point.periodEnd), ['2023-12-31', '2024-12-31', '2025-12-31'])
    assert.deepEqual(profit.historical.map(point => point.periodEnd), ['2023-12-31', '2024-12-31', '2025-12-31'])
  }
})
