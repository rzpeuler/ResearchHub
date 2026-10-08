import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMON_DATA_CATALOG, type CommonDataDefinition } from '../../../data/common-catalog.ts'
import { INDUSTRY_IDENTITIES, createIndustryDataCatalog, industryMetricId, type IndustryMetricDefinition } from '../../../data/industry-catalog.ts'
import { INDUSTRY_DATA_SOURCE_POLICIES } from '../../../data/industry-policies.ts'
import { PHASE3_COMMON_SOURCE_POLICIES } from '../../../data/company-research-policies.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../../data/valuation-earnings-policies.ts'
import type { DataSourceIntegrationView } from '../../../app/services/data-source-administration-contracts.ts'
import type { SourcePolicy } from '../../../data/contracts.ts'

const modulePath: string = '../../../app/services/data-catalog-projection.ts'
const projectionModule = await import(modulePath).catch(() => ({})) as Record<string, unknown>

type CommonProjectionInput = { definitions: readonly CommonDataDefinition[]; policies: readonly SourcePolicy[]; integrations: readonly DataSourceIntegrationView[] }
type IndustryProjectionInput = { catalog: ReturnType<typeof createIndustryDataCatalog>; identities: typeof INDUSTRY_IDENTITIES; policies: readonly SourcePolicy[]; integrations: readonly DataSourceIntegrationView[] }

function projectCommon(input: CommonProjectionInput): Record<string, unknown> {
  const project = projectionModule.projectCommonDataCatalog
  assert.equal(typeof project, 'function', 'projectCommonDataCatalog must expose the Common projection')
  return (project as (input: CommonProjectionInput) => Record<string, unknown>)(input)
}

function projectIndustry(input: IndustryProjectionInput): Record<string, unknown> {
  const project = projectionModule.projectIndustryDataCatalog
  assert.equal(typeof project, 'function', 'projectIndustryDataCatalog must expose the Industry projection')
  return (project as (input: IndustryProjectionInput) => Record<string, unknown>)(input)
}

const allPolicies = [...PHASE2_COMMON_SOURCE_POLICIES, ...PHASE3_COMMON_SOURCE_POLICIES, ...INDUSTRY_DATA_SOURCE_POLICIES]

function commonView(integrationId: string, sourceId: string, metricId: string): DataSourceIntegrationView {
  return {
    integration: {
      integrationId,
      displayName: 'Fixture adapter',
      sourceIds: [sourceId],
      credentialFields: [{ id: 'api_key', label: 'API key', required: true }],
      capabilities: [{ id: 'history', label: 'Historical data', metricIds: [metricId] }],
      supportedTests: { connection: true, capabilitySamples: ['history'] },
    },
    credentialState: 'configured',
    policyLinked: true,
    latestTests: [
      { integrationId, kind: 'connection', status: 'passed', startedAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T00:00:01.000Z' },
      { integrationId, kind: 'capability_sample', capabilityId: 'history', status: 'passed', startedAt: '2026-10-01T00:00:02.000Z', completedAt: '2026-10-01T00:00:03.000Z' },
    ],
  }
}

function industryDefinition(lifecycleStatus: IndustryMetricDefinition['lifecycleStatus'] = 'DISCOVERED'): IndustryMetricDefinition {
  const metricId = industryMetricId('household_air_conditioner', 'room-air-conditioner-production')
  return {
    metricId,
    industryId: 'household_air_conditioner',
    metricFamily: 'air-conditioner-production',
    semanticRole: 'production_volume',
    name: 'Room air conditioner production',
    description: 'Annual production of room air conditioners.',
    dataKind: 'timeseries',
    canonicalUnit: 'unit',
    acceptedSourceUnits: ['unit', '10k units'],
    unitConversions: [{ sourceUnit: '10k units', targetUnit: 'unit', conversionId: 'scale-10000' }],
    frequency: 'annual',
    periodBasis: 'PERIOD',
    aggregation: 'SUM',
    geography: 'China',
    applicability: 'Household room air conditioners',
    product: 'Room air conditioner',
    segment: 'Household',
    grade: 'All grades',
    requiredQualifiers: ['EXACT'],
    pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'REQUIRED_FOR_HISTORICAL' },
    lifecycleStatus,
    sourcePolicies: [{ policyId: `industry-metric:${metricId}`, metricFamily: 'air-conditioner-production' }],
    discoveredFrom: 'MIIT/NBS source audit',
    validation: { validatedAt: '2026-10-01T00:00:00.000Z', validator: 'catalog-review', methodology: 'source and semantic audit', sourceabilityEvidence: ['official annual table'] },
  }
}

test('common projection includes every live definition exactly once', () => {
  const projected = projectCommon({ definitions: COMMON_DATA_CATALOG, policies: allPolicies, integrations: [] })
  const definitions = projected.definitions as readonly Record<string, unknown>[]
  assert.equal(definitions.length, COMMON_DATA_CATALOG.length)
  assert.equal(new Set(definitions.map((item) => item.metricId)).size, COMMON_DATA_CATALOG.length)
  const actualById = new Map(definitions.map(({ metricId, meaning, dataKind, consumers }) => [metricId, { metricId, meaning, dataKind, consumers }]))
  const expected = COMMON_DATA_CATALOG.map(({ metricId, meaning, dataKind, consumers }) => ({ metricId, meaning, dataKind, consumers })).sort((left, right) => left.metricId.localeCompare(right.metricId))
  assert.deepEqual([...actualById.values()], expected)
})

test('unmatched Common definitions expose no guessed policy or fallback', () => {
  const definition: CommonDataDefinition = { metricId: 'fixture_unmapped', meaning: 'Fixture without an exact policy', dataKind: 'metric', consumers: ['fixture-workflow'], sourcePolicyStatus: 'CONFIGURED' }
  const projected = projectCommon({ definitions: [definition], policies: [], integrations: [] })
  const [item] = projected.definitions as readonly Record<string, unknown>[]
  assert.equal(item?.sourcePolicyStatus, 'NOT_CONFIGURED')
  assert.equal(item?.sourceMappingStatus, 'UNMAPPED')
  assert.deepEqual(item?.sourcePolicies, [])
})

test('policy configuration does not imply adapter, test, or PIT acceptance', () => {
  const definition = COMMON_DATA_CATALOG.find((item) => item.metricId === 'company_market_history')!
  const withoutAdapter = projectCommon({ definitions: [definition], policies: allPolicies, integrations: [] })
  const [unbound] = (withoutAdapter.definitions as readonly Record<string, unknown>[])[0]!.sourcePolicies as readonly Record<string, unknown>[]
  const [candidate] = unbound!.candidates as readonly Record<string, unknown>[]
  assert.equal((withoutAdapter.definitions as readonly Record<string, unknown>[])[0]?.sourcePolicyStatus, 'CONFIGURED')
  assert.equal((withoutAdapter.definitions as readonly Record<string, unknown>[])[0]?.sourceMappingStatus, 'MAPPED')
  assert.equal(candidate?.runtimeAdapterStatus, 'UNBOUND')
  assert.equal(candidate?.connectionTestStatus, 'NOT_TESTED')
  assert.equal(candidate?.capabilitySampleStatus, 'NOT_TESTED')
  assert.equal(candidate?.historicalPitStatus, 'NOT_VERIFIED')

  const mapped = projectCommon({ definitions: [definition], policies: allPolicies, integrations: [commonView('akshare', 'akshare-company_market_history', definition.metricId)] })
  const [mappedDefinition] = mapped.definitions as readonly Record<string, unknown>[]
  const [mappedPolicy] = mappedDefinition!.sourcePolicies as readonly Record<string, unknown>[]
  const [mappedCandidate] = mappedPolicy!.candidates as readonly Record<string, unknown>[]
  assert.equal(mappedDefinition?.sourceMappingStatus, 'MAPPED')
  assert.equal(mappedCandidate?.runtimeAdapterStatus, 'BOUND')
  assert.equal(mappedCandidate?.connectionTestStatus, 'PASSED')
  assert.equal(mappedCandidate?.capabilitySampleStatus, 'PASSED')
  assert.equal(mappedCandidate?.historicalPitStatus, 'NOT_VERIFIED')
})

test('empty Industry projection preserves identities and reports zero definitions', () => {
  const catalog = createIndustryDataCatalog()
  const projected = projectIndustry({ catalog, identities: INDUSTRY_IDENTITIES, policies: INDUSTRY_DATA_SOURCE_POLICIES, integrations: [] })
  assert.deepEqual(projected.identities, INDUSTRY_IDENTITIES)
  assert.deepEqual(projected.definitions, [])
  assert.equal(projected.definitionCount, 0)
  assert.equal(projected.canonicalCount, 0)
  assert.equal(catalog.list().length, 0)
})

test('Industry projection preserves definitions and lifecycle with actual policy metadata', () => {
  const definition = industryDefinition()
  const catalog = createIndustryDataCatalog([definition])
  const before = catalog.list()
  const projected = projectIndustry({ catalog, identities: INDUSTRY_IDENTITIES, policies: INDUSTRY_DATA_SOURCE_POLICIES, integrations: [] })
  const [item] = projected.definitions as readonly Record<string, unknown>[]
  assert.equal(item?.metricId, definition.metricId)
  assert.equal(item?.industryId, definition.industryId)
  assert.equal(item?.metricFamily, definition.metricFamily)
  assert.equal(item?.semanticRole, definition.semanticRole)
  assert.equal(item?.dataKind, definition.dataKind)
  assert.equal(item?.lifecycleStatus, 'DISCOVERED')
  assert.equal(item?.canonicalUnit, 'unit')
  assert.deepEqual(item?.acceptedSourceUnits, ['unit', '10k units'])
  assert.equal(item?.frequency, 'annual')
  assert.equal(item?.periodBasis, 'PERIOD')
  assert.equal(item?.aggregation, 'SUM')
  assert.equal(item?.geography, 'China')
  assert.equal(item?.product, 'Room air conditioner')
  assert.equal(item?.segment, 'Household')
  assert.equal(item?.grade, 'All grades')
  assert.deepEqual(item?.requiredQualifiers, ['EXACT'])
  assert.deepEqual(item?.pitPolicy, { publicationPit: 'REQUIRED', valueVersionPit: 'REQUIRED_FOR_HISTORICAL' })
  assert.equal((item?.sourcePolicies as readonly Record<string, unknown>[])[0]?.policyId, `industry-metric:${definition.metricId}`)
  assert.equal((item?.sourcePolicies as readonly Record<string, unknown>[])[0]?.mappingStatus, 'MAPPED')
  assert.deepEqual(catalog.list(), before)
})
