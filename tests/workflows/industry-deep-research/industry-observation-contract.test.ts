import assert from 'node:assert/strict'
import test from 'node:test'
import type { IndustryObservationCandidate } from '../../../data/industry-observations.ts'
import type { IndustryMetricDefinition } from '../../../data/industry-catalog.ts'
import type { DataRequirement } from '../../../data/contracts.ts'

const AS_OF = '2026-10-01T00:00:00.000Z'

function metricDefinition(overrides: Record<string, unknown> = {}): IndustryMetricDefinition {
  return {
    metricId: 'industry:lithium_battery:lithium-carbonate-period-average-price',
    industryId: 'lithium_battery',
    metricFamily: 'pricing',
    semanticRole: 'pricing',
    name: 'Lithium carbonate period average price',
    description: 'MIIT article-period average price, not a spot/futures/ASP quote.',
    dataKind: 'timeseries',
    canonicalUnit: '元/吨',
    acceptedSourceUnits: ['元/吨', '万元/吨'],
    unitConversions: [{ sourceUnit: '万元/吨', targetUnit: '元/吨', conversionId: 'TEN_THOUSAND_CNY_TO_CNY' }],
    frequency: 'H1',
    periodBasis: 'YTD',
    aggregation: 'AVERAGE',
    geography: 'China national',
    applicability: 'lithium salts',
    product: 'lithium salts',
    grade: 'battery-grade',
    requiredQualifiers: ['EXACT', 'LOWER_BOUND', 'UPPER_BOUND'],
    pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'UNVERIFIED_CURRENT_VALUE_ONLY' },
    lifecycleStatus: 'CANONICAL',
    sourcePolicies: [{ policyId: 'miit-lithium-price', metricFamily: 'pricing' }],
    ...overrides,
  } as IndustryMetricDefinition
}

function candidate(overrides: Record<string, unknown> = {}): IndustryObservationCandidate {
  return {
    metricId: 'industry:lithium_battery:lithium-carbonate-period-average-price',
    value: 16.3,
    qualifier: 'LOWER_BOUND',
    unit: '万元/吨',
    originalValue: '16.3',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-06-30T23:59:59.999Z',
    frequency: 'H1',
    periodBasis: 'YTD',
    aggregation: 'AVERAGE',
    geography: 'China national',
    product: 'lithium salts',
    grade: 'battery-grade',
    publishedAt: '2026-07-10T12:00:00.000Z',
    retrievedAt: '2026-07-11T00:00:00.000Z',
    originPublisher: 'MIIT',
    hostPlatform: 'MIIT official web',
    retrievalProvider: 'ResearchHub direct HTTPS',
    authority: 'S1_OFFICIAL',
    publicationPit: 'VERIFIED',
    valueVersion: { status: 'UNVERIFIED', reason: 'Historical revisions are not retained.' },
    sourceIdentity: 'url:https://miit.example.test/lithium-h1',
    diagnostics: [],
    ...overrides,
  } as IndustryObservationCandidate
}

function requirement(overrides: Record<string, unknown> = {}): DataRequirement {
  return {
    id: 'price-h1',
    consumer: { workflow: 'industry-deep-research', skill: 'industry_supply_demand_cycle' },
    subject: { industryId: 'lithium_battery' },
    dataKind: 'timeseries',
    metricId: 'industry:lithium_battery:lithium-carbonate-period-average-price',
    period: { start: '2026-01-01', end: '2026-06-30' },
    asOf: AS_OF,
    analysisAsOf: AS_OF,
    asOfMode: 'CURRENT_VALUE_ONLY',
    determinismClass: 'EVIDENCE_BACKED_NUMERIC',
    llmWebFallback: 'FORBIDDEN',
    ...overrides,
  } as DataRequirement
}

async function observationContract() {
  const contract = await import('../../../data/industry-observations.ts').catch(() => undefined)
  assert.ok(contract, 'Data-owned Industry observation contract must be available')
  return contract!
}

test('Industry observation validation preserves qualifiers and original units', async () => {
  const contract = await observationContract()
  const result = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement())
  assert.equal(result.status, 'VALID')
  assert.equal(result.point?.value, 163000)
  assert.equal(result.point?.canonicalUnit, '元/吨')
  assert.equal(result.point?.qualifier, 'LOWER_BOUND')
  assert.equal(result.point?.originalValue, '16.3')
  assert.equal(result.point?.originalUnit, '万元/吨')
  assert.equal(result.point?.periodBasis, 'YTD')
  assert.equal(result.point?.valueVersion.status, 'UNVERIFIED')
})

test('Industry observation rejects ambiguous unit and period semantics', async () => {
  const contract = await observationContract()
  const unsupportedUnit = contract.validateIndustryObservation(candidate({ unit: '吨/元' }), metricDefinition(), requirement())
  assert.equal(unsupportedUnit.status, 'INVALID')
  assert.ok(unsupportedUnit.diagnostics.includes('UNSUPPORTED_INDUSTRY_UNIT'))
  const wrongBasis = contract.validateIndustryObservation(candidate({ periodBasis: 'PERIOD' }), metricDefinition(), requirement())
  assert.equal(wrongBasis.status, 'INVALID')
  assert.ok(wrongBasis.diagnostics.includes('INDUSTRY_PERIOD_SEMANTICS_MISMATCH'))
  const outsidePeriod = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement({ period: { start: '2026-07-01', end: '2026-12-31' } }))
  assert.equal(outsidePeriod.status, 'INVALID')
  assert.ok(outsidePeriod.diagnostics.includes('INDUSTRY_PERIOD_START_MISMATCH'))
})

test('Industry observation rejects catalog kind, industry, and authority mismatches', async () => {
  const contract = await observationContract()
  const mismatch = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement({
    dataKind: 'metric', subject: { industryId: 'household_air_conditioner' }, minimumAuthority: 'S0_STATUTORY',
  }))
  assert.equal(mismatch.status, 'INVALID')
  assert.ok(mismatch.diagnostics.includes('INDUSTRY_DATA_KIND_MISMATCH'))
  assert.ok(mismatch.diagnostics.includes('INDUSTRY_ID_MISMATCH'))
  assert.ok(mismatch.diagnostics.includes('INDUSTRY_AUTHORITY_BELOW_REQUIREMENT'))
})

test('Industry observation distinguishes PERIOD YTD and POINT_IN_TIME slots', async () => {
  const contract = await observationContract()
  const ytd = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement())
  const period = contract.validateIndustryObservation(candidate({ periodBasis: 'PERIOD' }), metricDefinition({ periodBasis: 'PERIOD' }), requirement())
  const pointInTime = contract.validateIndustryObservation(candidate({
    periodStart: '2026-06-30T00:00:00.000Z', periodEnd: '2026-06-30T23:59:59.999Z', periodBasis: 'POINT_IN_TIME', frequency: 'DAILY', aggregation: 'END_OF_PERIOD',
  }), metricDefinition({ periodBasis: 'POINT_IN_TIME', frequency: 'DAILY', aggregation: 'END_OF_PERIOD' }), requirement({
    period: { start: '2026-06-30', end: '2026-06-30' },
  }))
  assert.equal(ytd.status, 'VALID')
  assert.equal(period.status, 'VALID')
  assert.equal(pointInTime.status, 'VALID')
  const merged = contract.mergeIndustryObservationPoints([ytd.point!, period.point!, pointInTime.point!])
  assert.equal(merged.conflicts.length, 0)
  assert.equal(merged.points.length, 3)
})

test('Industry observation PIT keeps current-only uncertainty visible and rejects historical unverified values', async () => {
  const contract = await observationContract()
  const current = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement())
  assert.equal(current.status, 'VALID')
  assert.equal(current.point?.valueVersion.status, 'UNVERIFIED')
  const historical = contract.validateIndustryObservation(candidate(), metricDefinition(), requirement({ asOfMode: 'HISTORICAL' }))
  assert.equal(historical.status, 'INVALID')
  assert.ok(historical.diagnostics.includes('INDUSTRY_VALUE_VERSION_UNVERIFIED'))
  const futurePublication = contract.validateIndustryObservation(candidate({ publishedAt: '2026-10-02T00:00:00.000Z' }), metricDefinition(), requirement())
  assert.equal(futurePublication.status, 'INVALID')
  assert.ok(futurePublication.diagnostics.includes('INDUSTRY_PUBLICATION_AFTER_CUTOFF'))
})

test('Industry observation preserves same-slot conflicts', async () => {
  const contract = await observationContract()
  const first = contract.validateIndustryObservation(candidate({ qualifier: 'EXACT' }), metricDefinition(), requirement())
  const second = contract.validateIndustryObservation(candidate({ qualifier: 'LOWER_BOUND', value: 15.3, originalValue: '15.3', sourceIdentity: 'url:https://other.example.test/lithium-h1' }), metricDefinition(), requirement())
  const merged = contract.mergeIndustryObservationPoints([first.point!, second.point!])
  assert.equal(merged.points.length, 2)
  assert.deepEqual(merged.points.map((point) => point.qualifier), ['EXACT', 'LOWER_BOUND'])
  assert.equal(merged.conflicts.length, 1)
  assert.deepEqual(merged.conflicts[0]?.values, [153000, 163000])
})

test('Industry missingness never becomes numeric zero', async () => {
  const contract = await observationContract()
  assert.deepEqual(contract.INDUSTRY_OBSERVATION_MISSING_REASONS, ['MISSING', 'NOT_REPORTED', 'NOT_APPLICABLE', 'SOURCE_UNAVAILABLE', 'TRANSPORT_UNAVAILABLE', 'PARSER_UNAVAILABLE', 'NO_CANONICAL_METRIC'])
  const missing = contract.validateIndustryObservation(candidate({ value: undefined }), metricDefinition(), requirement())
  assert.equal(missing.status, 'INVALID')
  assert.ok(missing.point === undefined)
})
