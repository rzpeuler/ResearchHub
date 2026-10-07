import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMON_DATA_CATALOG,
  DataResolver,
  materializePhase2CommonRequirement,
  materializeSkillDataRequirements,
  resolveSourcePolicy,
  runResearchDataAcquisition,
  type DataRequirement,
  type SourcePolicy,
} from '../../data/index.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'

const cutoff = '2025-03-31T00:00:00.000Z'
const financialRequirement: DataRequirement = {
  id: 'fy-eps', consumer: { workflow: 'valuation' }, subject: { companyId: 'Example Corp', ticker: '600001' },
  dataKind: 'metric', metricId: 'valuation_eps', period: { start: '2023-01-01', end: '2023-12-31', fiscalPeriod: 'FY', fiscalYear: 2023 },
  asOf: cutoff, analysisAsOf: cutoff, determinismClass: 'AUTHORITATIVE_NUMERIC',
  requireValueVersionProof: true, llmWebFallback: 'FORBIDDEN',
}
const policy: SourcePolicy = { policyId: 'test-eps', requirementMatch: { metricId: 'valuation_eps' }, selectionMode: 'FIRST_VALID', candidates: [
  { sourceId: 'primary', fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', operationId: 'primary', supports: { dataKinds: ['metric'], metricIds: ['valuation_eps'] } },
  { sourceId: 'fallback', fallbackLevel: 'FALLBACK_1', originAuthority: 'S3_AGGREGATOR', operationId: 'fallback', supports: { dataKinds: ['metric'], metricIds: ['valuation_eps'] } },
] }

test('numeric version proof, publication, retrieval, period, and analysis cutoff remain separate', async () => {
  const result = await new DataResolver({ policies: [policy], executor: async (_r, candidate) => candidate.sourceId === 'primary'
    ? { status: 'SUCCESS', data: { value: 0 }, source: { publishedAt: '2024-04-01T00:00:00.000Z', retrievedAt: '2026-10-07T00:00:00.000Z' } }
    : { status: 'SUCCESS', data: { value: 0 }, source: { publishedAt: '2024-04-01T00:00:00.000Z', retrievedAt: '2026-10-07T00:00:00.000Z', valueVersion: { status: 'VERIFIED', versionId: 'filing-2024-04-01', availableAt: '2024-04-01T00:00:00.000Z' } } },
  }).resolve([financialRequirement])
  const item = result.items[0]!
  assert.equal(item.status, 'AVAILABLE')
  assert.equal(item.value?.value, 0)
  assert.equal(item.analysisAsOf, cutoff)
  assert.equal(item.period?.fiscalYear, 2023)
  assert.equal(item.source?.publishedAt, '2024-04-01T00:00:00.000Z')
  assert.equal(item.source?.retrievedAt, '2026-10-07T00:00:00.000Z')
  assert.equal(item.quality.valueVersionStatus, 'VERIFIED')
  assert.equal(item.quality.pointInTimeSafe, true)
  assert.deepEqual(item.attempts.map((attempt) => attempt.status), ['POINT_IN_TIME_INVALID', 'SUCCESS'])
})

test('missing numeric version proof stays PIT unsafe and strict historical request unavailable', async () => {
  const executor = async () => ({ status: 'SUCCESS' as const, data: { value: 12 }, source: { publishedAt: '2024-04-01', retrievedAt: '2026-10-07' } })
  const strict = await runResearchDataAcquisition({ requirement: financialRequirement, policies: [policy], executor })
  assert.equal(strict.status, 'UNAVAILABLE')
  assert.equal(strict.quality.pointInTimeSafe, false)
  assert.equal(strict.quality.valueVersionStatus, 'UNVERIFIED')
  assert.deepEqual(strict.attempts.map((attempt) => attempt.status), ['POINT_IN_TIME_INVALID', 'POINT_IN_TIME_INVALID'])
  const lenient = await runResearchDataAcquisition({ requirement: { ...financialRequirement, requireValueVersionProof: false }, policies: [policy], executor })
  assert.equal(lenient.status, 'AVAILABLE')
  assert.equal(lenient.quality.pointInTimeSafe, false)
  assert.equal(lenient.quality.valueVersionStatus, 'UNVERIFIED')
})

test('future publication and future numeric version remain ineligible', async () => {
  for (const source of [
    { publishedAt: '2025-04-01', valueVersion: { status: 'VERIFIED' as const, versionId: 'old', availableAt: '2024-04-01' } },
    { publishedAt: '2024-04-01', valueVersion: { status: 'VERIFIED' as const, versionId: 'future', availableAt: '2025-04-01' } },
  ]) {
    const result = await runResearchDataAcquisition({ requirement: financialRequirement, policies: [policy], executor: async () => ({ status: 'SUCCESS', data: { value: 2 }, source }) })
    assert.equal(result.status, 'UNAVAILABLE')
    assert.ok(result.attempts.every((attempt) => attempt.status === 'POINT_IN_TIME_INVALID'))
  }
})

test('historic numeric version without publication proof remains ineligible', async () => {
  const result = await runResearchDataAcquisition({ requirement: financialRequirement, policies: [policy], executor: async () => ({
    status: 'SUCCESS', data: { value: 5 }, source: { retrievedAt: '2026-10-07', valueVersion: { status: 'VERIFIED', versionId: 'revision-1', availableAt: '2024-04-01' } },
  }) })
  assert.equal(result.status, 'UNAVAILABLE')
  assert.ok(result.attempts.every((attempt) => attempt.status === 'POINT_IN_TIME_INVALID'))
})

test('market observation date is validated independently from retrieval and requested period', async () => {
  const market: DataRequirement = { ...financialRequirement, dataKind: 'timeseries', metricId: 'valuation_market_price', requireValueVersionProof: false, period: { end: '2025-03-30' } }
  const marketPolicy: SourcePolicy = { policyId: 'market', requirementMatch: { metricId: 'valuation_market_price' }, selectionMode: 'FIRST_VALID', candidates: [
    { sourceId: 'market', fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', operationId: 'market', supports: { dataKinds: ['timeseries'], metricIds: ['valuation_market_price'] } },
  ] }
  const safe = await runResearchDataAcquisition({ requirement: market, policies: [marketPolicy], executor: async () => ({ status: 'SUCCESS', data: { close: 9 }, source: { observedAt: '2025-03-30', observationAvailableAt: '2025-03-30T07:00:00.000Z', retrievedAt: '2026-10-07' } }) })
  assert.equal(safe.status, 'AVAILABLE')
  assert.equal(safe.quality.pointInTimeSafe, true)
  assert.equal(safe.source?.retrievedAt, '2026-10-07')
  assert.equal(safe.source?.observedAt, '2025-03-30')
  assert.equal(safe.source?.observationAvailableAt, '2025-03-30T07:00:00.000Z')
  const future = await runResearchDataAcquisition({ requirement: market, policies: [marketPolicy], executor: async () => ({ status: 'SUCCESS', data: { close: 9 }, source: { observedAt: '2025-04-01', observationAvailableAt: '2025-04-01T07:00:00.000Z', retrievedAt: '2026-10-07' } }) })
  assert.equal(future.status, 'UNAVAILABLE')
  assert.equal(future.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
  const afterRequestedPeriod = await runResearchDataAcquisition({ requirement: market, policies: [marketPolicy], executor: async () => ({ status: 'SUCCESS', data: { close: 9 }, source: { observedAt: '2025-03-31', observationAvailableAt: '2025-03-31T07:00:00.000Z', retrievedAt: '2026-10-07' } }) })
  assert.equal(afterRequestedPeriod.status, 'UNAVAILABLE')
})

test('market PIT fails closed for publication-only, missing observation availability, or missing requested period', async () => {
  const market: DataRequirement = { ...financialRequirement, dataKind: 'timeseries', metricId: 'valuation_market_price', requireValueVersionProof: false, period: { end: '2025-03-30' } }
  const marketPolicy: SourcePolicy = { policyId: 'market', requirementMatch: { metricId: 'valuation_market_price' }, selectionMode: 'FIRST_VALID', candidates: [
    { sourceId: 'market', fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', operationId: 'market', supports: { dataKinds: ['timeseries'], metricIds: ['valuation_market_price'] } },
  ] }
  const run = (requirement: DataRequirement, source: Record<string, string>) => runResearchDataAcquisition({ requirement, policies: [marketPolicy], executor: async () => ({ status: 'SUCCESS' as const, data: { close: 9 }, source }) })
  for (const [req, source] of [
    [market, { publishedAt: '2025-03-01', retrievedAt: '2026-10-07' }],
    [market, { publishedAt: '2025-03-01', observedAt: '2025-03-30', retrievedAt: '2026-10-07' }],
    [{ ...market, period: undefined }, { observedAt: '2025-03-30', observationAvailableAt: '2025-03-30T07:00:00.000Z', retrievedAt: '2026-10-07' }],
  ] as const) {
    const result = await run(req, source)
    assert.equal(result.status, 'UNAVAILABLE')
    assert.equal(result.quality.pointInTimeSafe, false)
    assert.equal(result.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
  }
})

test('same-day market close is ineligible before 15:00 Asia/Shanghai and eligible afterward', async () => {
  const market: DataRequirement = { ...financialRequirement, dataKind: 'timeseries', metricId: 'valuation_market_price', requireValueVersionProof: false, period: { end: '2025-03-31' } }
  const marketPolicy: SourcePolicy = { policyId: 'market', requirementMatch: { metricId: 'valuation_market_price' }, selectionMode: 'FIRST_VALID', candidates: [
    { sourceId: 'market', fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', operationId: 'market', supports: { dataKinds: ['timeseries'], metricIds: ['valuation_market_price'] } },
  ] }
  const run = (asOf: string, observationAvailableAt: string) => runResearchDataAcquisition({ requirement: { ...market, asOf, analysisAsOf: asOf }, policies: [marketPolicy], executor: async () => ({ status: 'SUCCESS' as const, data: { close: 9 }, source: { observedAt: '2025-03-31', observationAvailableAt, publishedAt: '2025-03-30', retrievedAt: '2026-10-07' } }) })
  const before = await run('2025-03-31T06:59:59.000Z', '2025-03-31T07:00:00.000Z')
  assert.equal(before.status, 'UNAVAILABLE')
  const forgedEarly = await run('2025-03-31T06:59:59.000Z', '2025-03-31T06:00:00.000Z')
  assert.equal(forgedEarly.status, 'UNAVAILABLE')
  const after = await run('2025-03-31T07:00:00.000Z', '2025-03-31T07:00:00.000Z')
  assert.equal(after.status, 'AVAILABLE')
  assert.equal(after.quality.pointInTimeSafe, true)
  assert.equal(after.source?.publishedAt, '2025-03-30')
  assert.equal(after.source?.observedAt, '2025-03-31')
  assert.equal(after.source?.observationAvailableAt, '2025-03-31T07:00:00.000Z')
  assert.equal(after.source?.retrievedAt, '2026-10-07')
})

test('a full timeseries observation timestamp on a date-only requested end remains eligible', async () => {
  const requirement: DataRequirement = { ...financialRequirement, dataKind: 'timeseries', metricId: 'fixture_timeseries', period: { end: '2025-03-31' }, asOf: '2025-03-31T08:00:00.000Z', analysisAsOf: '2025-03-31T08:00:00.000Z', requireValueVersionProof: false }
  const sourcePolicy: SourcePolicy = { policyId: 'fixture-timeseries', requirementMatch: { metricId: 'fixture_timeseries' }, selectionMode: 'FIRST_VALID', candidates: [
    { sourceId: 'fixture-timeseries', fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', operationId: 'fixture.timeseries', supports: { dataKinds: ['timeseries'], metricIds: ['fixture_timeseries'] } },
  ] }
  const result = await runResearchDataAcquisition({ requirement, policies: [sourcePolicy], executor: async () => ({ status: 'SUCCESS', data: { value: 1 }, source: { observedAt: '2025-03-31T07:00:00.000Z', observationAvailableAt: '2025-03-31T07:05:00.000Z', retrievedAt: '2026-10-07T00:00:00.000Z' } }) })
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.quality.pointInTimeSafe, true)
  assert.equal(result.source?.observedAt, '2025-03-31T07:00:00.000Z')
  assert.equal(result.source?.observationAvailableAt, '2025-03-31T07:05:00.000Z')
})

test('materialization binds one selected estimate metric with exact issuer, FY and optionality', () => {
  const result = materializeSkillDataRequirements('consensus_expectations_analysis', [{
    id: 'one-estimate', kind: 'STATIC', metricId: 'earnings_expectation_eps', dataKind: 'estimate',
    determinismClass: 'AUTHORITATIVE_NUMERIC', required: false,
  }], { workflowId: 'earnings-review', asOf: cutoff, subject: { companyId: 'Example Corp', ticker: '600001' }, period: { fiscalYear: 2025, fiscalPeriod: 'FY' } })
  assert.equal(result.requirements.length, 1)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.requirements[0]?.subject, { companyId: 'Example Corp', ticker: '600001' })
  assert.equal(result.requirements[0]?.metricId, 'earnings_expectation_eps')
  assert.equal(result.requirements[0]?.period?.fiscalYear, 2025)
  assert.equal(result.requirements[0]?.analysisAsOf, cutoff)
  assert.equal(result.requirements[0]?.required, false)
  assert.equal(PHASE2_COMMON_SOURCE_POLICIES.find((p) => p.requirementMatch.metricId === 'earnings_expectation_eps')?.candidates.length, 3)
  assert.equal(PHASE2_COMMON_SOURCE_POLICIES.find((p) => p.requirementMatch.metricId === 'earnings_expectation_net_profit')?.candidates.length, 1)
})

test('Common identities cover only current Valuation and Earnings evidence families', () => {
  const byId = new Map(COMMON_DATA_CATALOG.map((entry) => [entry.metricId, entry.dataKind]))
  assert.equal(byId.get('valuation_peer_candidate_evidence'), 'evidence')
  assert.equal(byId.get('earnings_official_filing'), 'document')
  for (const metric of ['revenue', 'net_profit', 'gross_margin', 'operating_cash_flow', 'eps']) assert.equal(byId.get(`earnings_actual_${metric}`), 'metric')
})

test('all Phase 2 Common policies are exact, executable route definitions', () => {
  const byId = new Map(COMMON_DATA_CATALOG.map((entry) => [entry.metricId, entry]))
  assert.equal(new Set(PHASE2_COMMON_SOURCE_POLICIES.map((item) => item.policyId)).size, PHASE2_COMMON_SOURCE_POLICIES.length)
  for (const sourcePolicy of PHASE2_COMMON_SOURCE_POLICIES) {
    const metricId = sourcePolicy.requirementMatch.metricId
    assert.ok(metricId && byId.has(metricId))
    assert.equal(sourcePolicy.selectionMode, 'FIRST_VALID')
    assert.ok(sourcePolicy.candidates.length > 0)
    assert.ok(sourcePolicy.candidates.every((candidate) => candidate.operationId.length > 0 && candidate.supports.metricIds?.includes(metricId)))
    const definition = byId.get(metricId)!
    const requirement: DataRequirement = { ...financialRequirement, consumer: { workflow: sourcePolicy.requirementMatch.workflow!, ...(sourcePolicy.requirementMatch.capability ? { capability: sourcePolicy.requirementMatch.capability } : {}) }, metricId, dataKind: definition.dataKind }
    assert.equal(resolveSourcePolicy(requirement, PHASE2_COMMON_SOURCE_POLICIES).policy?.policyId, sourcePolicy.policyId)
  }
})

test('Phase 2 materialization binds issuer and FY without requiring unrelated metrics', () => {
  const actual = materializePhase2CommonRequirement('earnings_actual_revenue', {
    workflowId: 'earnings-review', ticker: '600001', companyId: 'Example Corp', asOf: cutoff,
    period: { fiscalYear: 2024, fiscalPeriod: 'FY', end: '2024-12-31' }, required: false, historicalNumeric: true,
  })
  assert.deepEqual(actual.subject, { companyId: 'Example Corp', ticker: '600001' })
  assert.equal(actual.period?.fiscalYear, 2024)
  assert.equal(actual.analysisAsOf, cutoff)
  assert.equal(actual.required, false)
  assert.equal(actual.requireValueVersionProof, true)
  assert.equal(actual.metricId, 'earnings_actual_revenue')
  const estimate = materializePhase2CommonRequirement('earnings_expectation_eps', {
    workflowId: 'earnings-review', ticker: '600001', companyId: 'Example Corp', asOf: cutoff,
    period: { fiscalYear: 2025, fiscalPeriod: 'FY' }, required: true,
  })
  assert.equal(estimate.metricId, 'earnings_expectation_eps')
  assert.equal(estimate.requireValueVersionProof, undefined)
  assert.equal(resolveSourcePolicy(estimate, PHASE2_COMMON_SOURCE_POLICIES).status, 'MATCHED')
  assert.throws(() => materializePhase2CommonRequirement('earnings_actual_revenue', {
    workflowId: 'earnings-review', ticker: '600001', asOf: cutoff, required: true,
  }), /PERIOD_REQUIRED/)
  assert.throws(() => materializePhase2CommonRequirement('earnings_actual_revenue', {
    workflowId: 'earnings-review', ticker: '600001', asOf: cutoff, period: { fiscalYear: 2024 }, required: true,
  }), /FISCAL_PERIOD_REQUIRED/)
  assert.throws(() => materializePhase2CommonRequirement('valuation_market_price', {
    workflowId: 'valuation', ticker: '600001', asOf: cutoff, required: true,
  }), /MARKET_PERIOD_REQUIRED/)
})
