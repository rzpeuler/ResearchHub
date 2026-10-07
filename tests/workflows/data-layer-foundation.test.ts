import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMON_DATA_CATALOG,
  createCommonDataCatalog,
  createIndustryDataCatalog,
  DataResolver,
  industryMetricId,
  materializeSkillDataRequirements,
  resolveSourcePolicy,
  type AcquisitionAttempt,
  type AcquisitionResult,
  type DataRequirement,
  type IndustryMetricDefinition,
  type SourceCandidate,
  type SourcePolicy,
} from '../../data/index.ts'
import { getDataSourceCatalog } from '../../app/services/data-source-catalog.ts'
import { getCanonicalResearchSkill } from '../../app/services/research-skill-catalog.ts'
import { createResearchSkillRegistry } from '../../app/services/skill-registry.ts'
import { earningsExpectationSourcePolicy } from '../../workflows/earnings-review/expectations-acquisition.ts'

const AS_OF = '2026-10-01T00:00:00.000Z'

function industryDefinition(overrides: Partial<IndustryMetricDefinition> = {}): IndustryMetricDefinition {
  return {
    metricId: industryMetricId('pcb', 'monthly-shipment'),
    industryId: 'pcb',
    metricFamily: 'shipments',
    semanticRole: 'demand',
    name: 'Monthly PCB shipments',
    description: 'Monthly shipment volume reported by an attributable source.',
    dataKind: 'timeseries',
    unit: 'million units',
    periodicity: 'monthly',
    lifecycleStatus: 'DISCOVERED',
    sourcePolicies: [{ policyId: 'pcb-shipment-policy', metricFamily: 'shipments' }],
    ...overrides,
  }
}

function requirement(overrides: Partial<DataRequirement> = {}): DataRequirement {
  return {
    id: 'fixture-requirement',
    consumer: { workflow: 'fixture-workflow', capability: 'fixture-capability' },
    subject: { industryId: 'pcb' },
    dataKind: 'metric',
    metricId: 'fixture-metric',
    period: { start: '2026-01-01', end: '2026-03-31', fiscalPeriod: '2026Q1' },
    asOf: AS_OF,
    determinismClass: 'AUTHORITATIVE_NUMERIC',
    requiredFields: ['value'],
    minimumAuthority: 'S2_PROFESSIONAL',
    llmWebFallback: 'FORBIDDEN',
    ...overrides,
  }
}

function source(sourceId: string, authority: SourceCandidate['originAuthority'] = 'S1_OFFICIAL') {
  return {
    sourceId,
    fallbackLevel: 'PRIMARY' as const,
    originPublisher: 'Official publisher',
    originAuthority: authority,
    retrievalProvider: 'fixture-retriever',
    sourceUrl: `https://example.test/${sourceId}`,
    publishedAt: '2026-09-30T12:00:00.000Z',
    retrievedAt: AS_OF,
  }
}

function attempt(sourceId: string, status: AcquisitionAttempt['status'] = 'SUCCESS'): AcquisitionAttempt {
  return {
    sourceId,
    fallbackLevel: 'PRIMARY',
    status,
    startedAt: '2026-10-01T00:00:00.000Z',
    completedAt: AS_OF,
  }
}

function acquired<T>(overrides: Partial<AcquisitionResult<T>> = {}): AcquisitionResult<T> {
  return {
    requirementId: 'fixture-requirement',
    status: 'AVAILABLE',
    source: source('fixture-source'),
    sources: [source('fixture-source')],
    quality: { pointInTimeSafe: true, complete: true, crossChecked: false },
    attempts: [attempt('fixture-source')],
    ...overrides,
  }
}

test('Common Data Catalog rejects duplicate IDs and retains immutable metadata', () => {
  const valuation = COMMON_DATA_CATALOG.find((definition) => definition.metricId === 'valuation_eps')
  assert.ok(valuation)
  assert.equal(valuation.meaning, '估值用年度每股收益（EPS）')
  assert.deepEqual(valuation.consumers, ['valuation'])
  assert.equal(valuation.sourcePolicyStatus, 'CONFIGURED')

  const catalog = createCommonDataCatalog([valuation])
  assert.equal(catalog.get('valuation_eps')?.dataKind, 'metric')
  assert.throws(() => createCommonDataCatalog([valuation, valuation]), /DUPLICATE_COMMON_DATA_ID:valuation_eps/)
  assert.throws(() => createCommonDataCatalog([{ ...valuation, meaning: ' ' }]), /INVALID_COMMON_DATA_DEFINITION/)
  assert.ok(Object.isFrozen(catalog.get('valuation_eps')))
  assert.ok(Object.isFrozen(catalog.get('valuation_eps')?.consumers))
})

test('Data Sources catalog consumes canonical Common definitions and keeps honest coverage metadata', () => {
  const response = getDataSourceCatalog()
  assert.equal(response.rows.length, COMMON_DATA_CATALOG.filter((definition) => definition.compatibilityCapabilityByWorkflow !== undefined).length, 'legacy administration rows stay stable until Runtime composition adopts new Common policies')
  assert.equal(response.coverageComplete, false)
  for (const row of response.rows) {
    assert.notEqual(row.capability.trim(), '')
    assert.equal(COMMON_DATA_CATALOG.some((definition) => definition.metricId === row.metricId && definition.meaning === row.chineseMeaning), true)
    assert.equal(row.finalFallback, '公网搜索（待接入）')
    assert.equal(row.coverageComplete, false)
  }
})

test('Skill catalog preserves readable inputs and publishes bounded provider-neutral data requirements', () => {
  const consensus = getCanonicalResearchSkill('consensus_expectations_analysis')
  assert.ok(consensus)
  assert.ok(consensus.inputs.length > 0)
  assert.deepEqual(consensus.dataRequirements, [], 'one-metric-per-invocation method has no fixed paired requirements')
  assert.equal(consensus.requirementCoverage, 'PARTIAL')
  const revisions = getCanonicalResearchSkill('estimate_revision_analysis')
  assert.ok(revisions)
  assert.deepEqual(revisions.dataRequirements, [], 'old/new estimate inputs are selected for one compatible metric per invocation')
  assert.equal(revisions.requirementCoverage, 'PARTIAL')

  const industry = getCanonicalResearchSkill('industry_supply_demand_cycle')
  assert.ok(industry)
  assert.deepEqual(industry.dataRequirements.map((item) => item.kind), ['DOMAIN', 'DOMAIN', 'DOMAIN', 'DOMAIN', 'DOMAIN'])
  assert.equal(industry.requirementCoverage, 'PARTIAL')
  assert.ok(industry.dataRequirements.every((item) => !('metricId' in item)))
  assert.ok(industry.dataRequirements.every((item) => !JSON.stringify(item).match(/AKShare|CNINFO|EastMoney|THS|SSE|SZSE/i)))
})

test('materialized Earnings Common requirements use Data-owned legacy routing metadata', () => {
  const skillLocalId = 'skill-local-eps-id'
  const materialized = materializeSkillDataRequirements('consensus_expectations_analysis', [{
    id: skillLocalId, kind: 'STATIC', metricId: 'earnings_expectation_eps', dataKind: 'estimate',
    determinismClass: 'AUTHORITATIVE_NUMERIC', required: true,
  }], { workflowId: 'earnings-review', asOf: AS_OF })
  const req = materialized.requirements[0]
  assert.ok(req)
  assert.notEqual(req.consumer.capability, skillLocalId)
  assert.equal(req.consumer.capability, 'earnings_expectations')
  const resolution = resolveSourcePolicy(req, [earningsExpectationSourcePolicy()])
  assert.equal(resolution.status, 'MATCHED')
  assert.equal(resolution.policy?.policyId, 'earnings-expectations-eps-source-ladder-v0.1')
})

test('canonical Skill requirement coverage is explicit and registry clones deeply isolate requirements', () => {
  const all = ['NONE', 'PARTIAL', 'COMPLETE']
  const skills = createResearchSkillRegistry()
  assert.equal(all.includes(skills.get('consensus_expectations_analysis')?.requirementCoverage ?? ''), true)
  const first = skills.get('reverse_dcf_expectation_decode')
  assert.ok(first?.dataRequirements?.[0])
  assert.equal(first.requirementCoverage, 'PARTIAL')
  const requirementCopy = first.dataRequirements[0]
  assert.ok(Object.isFrozen(first.dataRequirements))
  assert.ok(Object.isFrozen(requirementCopy))
  assert.equal(Reflect.set(requirementCopy, 'metricId', 'mutated'), false)
  const subsequentRequirement = skills.get('reverse_dcf_expectation_decode')?.dataRequirements?.[0]
  assert.ok(subsequentRequirement && 'metricId' in subsequentRequirement)
  assert.equal(subsequentRequirement.metricId, 'valuation_market_price')
  const listed = skills.list().find((item) => item.id === 'reverse_dcf_expectation_decode')
  assert.ok(listed?.dataRequirements?.[0])
  assert.notEqual(listed?.dataRequirements?.[0], first.dataRequirements[0])
})

test('Industry catalog enforces namespaces, policy association, lifecycle evidence, and explicit canonical promotion', () => {
  assert.equal(industryMetricId('pcb', 'monthly-shipment'), 'industry:pcb:monthly-shipment')
  assert.throws(() => createIndustryDataCatalog([industryDefinition({ metricId: 'monthly-shipment' })]), /INVALID_INDUSTRY_METRIC_NAMESPACE/)

  const catalog = createIndustryDataCatalog()
  const discovered = catalog.registerDiscovered(industryDefinition({ sourcePolicies: [] }))
  assert.throws(() => catalog.registerDiscovered(industryDefinition()), /DUPLICATE_INDUSTRY_METRIC_ID/)
  assert.equal(discovered.lifecycleStatus, 'DISCOVERED')
  assert.deepEqual(discovered.sourcePolicies, [])
  assert.deepEqual(catalog.resolve('pcb', 'demand', 'shipments'), [], 'registration must not promote a discovered metric')
  assert.throws(() => catalog.registerDiscovered(industryDefinition({ metricId: industryMetricId('pcb', 'other'), lifecycleStatus: 'VALIDATED' })), /INDUSTRY_REGISTRATION_MUST_START_DISCOVERED/)

  const evidence = {
    validatedAt: AS_OF,
    validator: 'domain-reviewer',
    methodology: 'Compare reported shipment totals against source publication and unit definitions.',
    sourceabilityEvidence: ['official monthly release URL', 'historical series available'],
  }
  assert.throws(() => catalog.transition(discovered.metricId, 'VALIDATED'), /INDUSTRY_TRANSITION_REQUIRES_VALIDATION_EVIDENCE_AND_POLICY/)
  const associated = catalog.associateSourcePolicy(discovered.metricId, { policyId: 'pcb-shipment-policy', metricFamily: 'shipments' })
  assert.deepEqual(associated.sourcePolicies, [{ policyId: 'pcb-shipment-policy', metricFamily: 'shipments' }])
  assert.throws(() => catalog.associateSourcePolicy(discovered.metricId, { policyId: 'pcb-shipment-policy' }), /DUPLICATE_INDUSTRY_SOURCE_POLICY_REFERENCE/)
  const validated = catalog.transition(discovered.metricId, 'VALIDATED', evidence)
  assert.equal(validated.lifecycleStatus, 'VALIDATED')
  assert.deepEqual(catalog.resolve('pcb', 'demand', 'shipments'), [], 'validated definitions are not yet canonical')
  const canonical = catalog.transition(discovered.metricId, 'CANONICAL', evidence)
  assert.equal(canonical.lifecycleStatus, 'CANONICAL')
  assert.throws(() => catalog.associateSourcePolicy(discovered.metricId, { policyId: 'late-policy' }), /INDUSTRY_CANONICAL_POLICY_CHANGE_REQUIRES_REVIEW/)
  assert.deepEqual(catalog.resolve('pcb', 'demand', 'shipments').map((item) => item.metricId), [discovered.metricId])
  assert.throws(() => catalog.transition(discovered.metricId, 'DISCOVERED', evidence), /INVALID_INDUSTRY_METRIC_TRANSITION/)
  assert.throws(() => createIndustryDataCatalog([industryDefinition({ lifecycleStatus: 'CANONICAL', validation: evidence, sourcePolicies: [] })]), /INDUSTRY_CANONICAL_REQUIRES_VALIDATION_AND_POLICY/)
})

test('skill requirement materialization carries runtime context and resolves only canonical industry metrics', () => {
  const templates = [
    { kind: 'STATIC', id: 'revenue', metricId: 'valuation_eps', required: true, dataKind: 'metric', determinismClass: 'AUTHORITATIVE_NUMERIC', minimumAuthority: 'S1_OFFICIAL', requiredFields: ['value'] },
    { kind: 'DOMAIN', domain: 'industry', id: 'demand', semanticRole: 'demand', metricFamily: 'shipments', required: false, dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC', requiredFields: ['value'] },
  ] as const
  const context = {
    workflowId: 'industry-deep-research',
    asOf: AS_OF,
    subject: { industryId: 'pcb', geography: 'CN' },
    period: { start: '2026-01-01', end: '2026-03-31', fiscalPeriod: '2026Q1' },
  }
  const catalog = createIndustryDataCatalog([industryDefinition({ lifecycleStatus: 'DISCOVERED' })])
  const beforePromotion = materializeSkillDataRequirements('industry-skill', templates, context, catalog)
  assert.equal(beforePromotion.requirements.length, 1)
  assert.deepEqual(beforePromotion.unresolved, [{ templateId: 'demand', required: false, reason: 'NO_CANONICAL_INDUSTRY_METRIC' }])

  const evidence = { validatedAt: AS_OF, validator: 'reviewer', methodology: 'reviewed source series', sourceabilityEvidence: ['source URL'] }
  catalog.transition(industryMetricId('pcb', 'monthly-shipment'), 'VALIDATED', evidence)
  catalog.transition(industryMetricId('pcb', 'monthly-shipment'), 'CANONICAL', evidence)
  const result = materializeSkillDataRequirements('industry-skill', templates, context, catalog)
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.requirements.length, 2)
  const staticRequirement = result.requirements[0]!
  assert.equal(staticRequirement.id, 'industry-skill:revenue')
  assert.equal(staticRequirement.metricId, 'valuation_eps')
  assert.deepEqual(staticRequirement.subject, context.subject)
  assert.deepEqual(staticRequirement.period, context.period)
  assert.equal(staticRequirement.asOf, AS_OF)
  assert.deepEqual(staticRequirement.requiredFields, ['value'])
  assert.equal(staticRequirement.required, true)
  const domainRequirement = result.requirements[1]!
  assert.equal(domainRequirement.metricId, industryMetricId('pcb', 'monthly-shipment'))
  assert.equal(domainRequirement.metricFamily, 'shipments')
  assert.equal(domainRequirement.required, false)
  assert.equal(domainRequirement.dataKind, 'timeseries')
  assert.equal(domainRequirement.consumer.capability, undefined, 'Industry Skills must not route with their local template ID')
  assert.deepEqual(materializeSkillDataRequirements('industry-skill', [templates[1]], { ...context, subject: {} }, catalog).unresolved, [
    { templateId: 'demand', required: false, reason: 'INDUSTRY_ID_REQUIRED' },
  ])
})

test('Industry DOMAIN requirements reject mismatched kinds and only materialize compatible definitions', () => {
  const evidence = { validatedAt: AS_OF, validator: 'reviewer', methodology: 'reviewed', sourceabilityEvidence: ['source URL'] }
  const catalog = createIndustryDataCatalog([
    industryDefinition({ lifecycleStatus: 'CANONICAL', validation: evidence }),
    industryDefinition({ metricId: industryMetricId('pcb', 'monthly-shipment-value'), dataKind: 'metric', lifecycleStatus: 'CANONICAL', validation: evidence }),
  ])
  const template = { kind: 'DOMAIN', domain: 'industry', id: 'demand', semanticRole: 'demand', metricFamily: 'shipments', required: false, dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC' } as const
  const result = materializeSkillDataRequirements('industry-skill', [template], { workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' } }, catalog)
  assert.deepEqual(result.requirements.map((item) => item.metricId), [industryMetricId('pcb', 'monthly-shipment')])
  assert.equal(result.requirements[0]?.dataKind, 'timeseries')
  assert.deepEqual(result.unresolved, [{ templateId: 'demand', required: false, reason: 'INDUSTRY_DATA_KIND_MISMATCH' }])

  const allMismatched = createIndustryDataCatalog([industryDefinition({ dataKind: 'metric', lifecycleStatus: 'CANONICAL', validation: evidence })])
  const mismatch = materializeSkillDataRequirements('industry-skill', [template], { workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' } }, allMismatched)
  assert.deepEqual(mismatch.requirements, [])
  assert.deepEqual(mismatch.unresolved, [{ templateId: 'demand', required: false, reason: 'INDUSTRY_DATA_KIND_MISMATCH' }])
})

test('DataResolver preserves an available zero, source authority, provenance, period, and attempts', async () => {
  const req = requirement()
  const resolved = await new DataResolver<number>({
    policies: [],
    executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async () => acquired({ data: 0 }),
  }).resolveOne(req)

  assert.equal(resolved.status, 'AVAILABLE')
  assert.equal(resolved.value, 0)
  assert.equal(resolved.authority, 'S1_OFFICIAL')
  assert.equal(resolved.source?.originPublisher, 'Official publisher')
  assert.equal(resolved.source?.retrievalProvider, 'fixture-retriever')
  assert.equal(resolved.source?.sourceUrl, 'https://example.test/fixture-source')
  assert.deepEqual(resolved.period, req.period)
  assert.deepEqual(resolved.attempts, [attempt('fixture-source')])
  assert.equal(resolved.acquisition.data, 0)
})

test('DataResolver reports PARTIAL and retains PIT attempts, provenance, and cross-check conflicts', async () => {
  const requirements = [requirement({ id: 'conflicted' }), requirement({ id: 'pit-failed', required: false })]
  const conflictResult = acquired<number>({
    requirementId: 'conflicted',
    status: 'PARTIAL',
    data: 10,
    source: source('official-a'),
    sources: [source('official-a'), source('official-b', 'S2_PROFESSIONAL')],
    observations: [
      { data: 10, source: source('official-a') },
      { data: 12, source: source('official-b', 'S2_PROFESSIONAL') },
    ],
    quality: { pointInTimeSafe: true, complete: false, crossChecked: true },
    attempts: [attempt('official-a'), attempt('official-b')],
    unavailableReason: 'SOURCE_CONFLICT',
    crossCheckStatus: 'CONFLICT',
  })
  const pitResult = acquired<number>({
    requirementId: 'pit-failed',
    status: 'UNAVAILABLE',
    source: null,
    quality: { pointInTimeSafe: false, complete: false, crossChecked: false },
    attempts: [attempt('late-source', 'POINT_IN_TIME_INVALID')],
    unavailableReason: 'NO_ELIGIBLE_POINT_IN_TIME_DATA',
  })
  const resolver = new DataResolver<number>({
    policies: [],
    executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async (item) => item.id === 'conflicted' ? conflictResult : pitResult,
  })
  const result = await resolver.resolve(requirements)

  assert.equal(result.completeness, 'PARTIAL')
  assert.equal(result.requiredUnresolved.length, 1)
  assert.equal(result.requiredUnresolved[0]?.requirementId, 'conflicted')
  assert.equal(result.optionalUnresolved[0]?.requirementId, 'pit-failed')
  assert.equal(result.items[0]?.crossCheckStatus, 'CONFLICT')
  assert.equal(result.items[0]?.unavailableReason, 'SOURCE_CONFLICT')
  assert.equal(result.items[0]?.acquisition.observations?.[1]?.data, 12)
  assert.equal(result.items[0]?.sources?.[1]?.originAuthority, 'S2_PROFESSIONAL')
  assert.deepEqual(result.items[0]?.attempts, [attempt('official-a'), attempt('official-b')])
  assert.equal(result.items[1]?.attempts[0]?.status, 'POINT_IN_TIME_INVALID')
  assert.equal(result.items[1]?.unavailableReason, 'NO_ELIGIBLE_POINT_IN_TIME_DATA')
})

test('DataResolver reports UNAVAILABLE when all required acquisitions are unavailable', async () => {
  const requirements = [requirement({ id: 'required-a' }), requirement({ id: 'required-b' })]
  const result = await new DataResolver<number>({
    policies: [],
    executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async (item) => acquired({
      requirementId: item.id,
      status: 'UNAVAILABLE',
      source: null,
      quality: { pointInTimeSafe: false, complete: false, crossChecked: false },
      attempts: [attempt(`${item.id}-source`, 'NO_DATA')],
      unavailableReason: 'DATA_NOT_PUBLISHED',
    }),
  }).resolve(requirements)
  assert.equal(result.completeness, 'UNAVAILABLE')
  assert.equal(result.requiredUnresolved.length, 2)
  assert.equal(result.items.every((item) => item.status === 'UNAVAILABLE'), true)
})

test('DataResolver propagates cancellation from acquisition', async () => {
  const controller = new AbortController()
  controller.abort()
  const candidate: SourceCandidate = {
    sourceId: 'fixture-source',
    fallbackLevel: 'PRIMARY',
    originAuthority: 'S1_OFFICIAL',
    operationId: 'fixture.operation',
    supports: { dataKinds: ['metric'], metricIds: ['fixture-metric'] },
  }
  const policy: SourcePolicy = {
    policyId: 'fixture-policy',
    requirementMatch: { metricId: 'fixture-metric' },
    selectionMode: 'FIRST_VALID',
    candidates: [candidate],
  }
  const resolver = new DataResolver<number>({
    policies: [policy],
    signal: controller.signal,
    executor: async () => ({ status: 'SUCCESS', data: 1 }),
  })
  await assert.rejects(() => resolver.resolveOne(requirement()), /WORKFLOW_CANCELLED/)
})

test('DataResolver reports unresolved required catalog needs and resolves canonical domain definitions', async () => {
  const industryCatalog = createIndustryDataCatalog([industryDefinition({
    lifecycleStatus: 'CANONICAL',
    validation: { validatedAt: AS_OF, validator: 'reviewer', methodology: 'reviewed', sourceabilityEvidence: ['source URL'] },
  })])
  const policy: SourcePolicy = {
    policyId: 'pcb-shipment-policy',
    requirementMatch: { metricId: industryMetricId('pcb', 'monthly-shipment') },
    selectionMode: 'FIRST_VALID',
    candidates: [{
      sourceId: 'fixture-industry-source',
      fallbackLevel: 'PRIMARY',
      originAuthority: 'S1_OFFICIAL',
      operationId: 'fixture.industry.shipments',
      supports: { dataKinds: ['timeseries'], metricIds: [industryMetricId('pcb', 'monthly-shipment')] },
    }],
  }
  const resolver = new DataResolver<number>({
    policies: [policy],
    executor: async () => ({ status: 'SUCCESS', data: 5, source: source('fixture-industry-source') }),
    industryCatalog,
  })
  const templates = [{
    kind: 'DOMAIN', domain: 'industry', id: 'demand', semanticRole: 'demand', metricFamily: 'shipments',
    required: true, dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC',
  }] as const
  const resolved = await resolver.resolveSkillRequirements('industry_supply_demand_cycle', templates, {
    workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' },
  })
  assert.equal(resolved.completeness, 'COMPLETE')
  assert.equal(resolved.items[0]?.metricId, industryMetricId('pcb', 'monthly-shipment'))
  assert.deepEqual(resolved.unresolvedRequirements, [])

  const noIndustry = await resolver.resolveSkillRequirements('industry_supply_demand_cycle', templates, {
    workflowId: 'industry-deep-research', asOf: AS_OF, subject: {},
  })
  assert.equal(noIndustry.completeness, 'UNAVAILABLE')
  assert.deepEqual(noIndustry.unresolvedRequirements, [{ templateId: 'demand', required: true, reason: 'INDUSTRY_ID_REQUIRED' }])
})

test('DataResolver marks unresolved optional Industry needs PARTIAL even when the bundle is empty', async () => {
  const skill = getCanonicalResearchSkill('industry_supply_demand_cycle')
  assert.ok(skill)
  const result = await new DataResolver<number>({
    policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
  }).resolveSkillRequirements(skill.canonicalSkillId, skill.dataRequirements, {
    workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' },
  })
  assert.equal(result.items.length, 0)
  assert.equal(result.unresolvedRequirements.length, 5)
  assert.ok(result.unresolvedRequirements.every((item) => item.required === false))
  assert.equal(result.completeness, 'PARTIAL')

  const requiredAcquisitionFailure = await new DataResolver<number>({
    policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async (item) => acquired({
      requirementId: item.id, status: 'UNAVAILABLE', source: null,
      quality: { pointInTimeSafe: false, complete: false, crossChecked: false }, attempts: [],
      unavailableReason: 'DATA_NOT_PUBLISHED',
    }),
  }).resolveSkillRequirements('industry_skill', [
    { kind: 'STATIC', id: 'required-price', metricId: 'valuation_market_price', dataKind: 'timeseries', required: true, determinismClass: 'AUTHORITATIVE_NUMERIC' },
    ...skill.dataRequirements,
  ], { workflowId: 'valuation', asOf: AS_OF, subject: { industryId: 'pcb' } })
  assert.equal(requiredAcquisitionFailure.completeness, 'UNAVAILABLE')
  assert.equal(requiredAcquisitionFailure.unresolvedRequirements.length, 5)

  const requiredTemplate = [{ kind: 'DOMAIN', domain: 'industry', id: 'required-demand', semanticRole: 'demand', dataKind: 'timeseries', required: true, determinismClass: 'EVIDENCE_BACKED_NUMERIC' }] as const
  const noBasis = await new DataResolver<number>({ policies: [], executor: async () => ({ status: 'UNSUPPORTED' }) }).resolveSkillRequirements(
    'industry-skill', requiredTemplate, { workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' } },
  )
  assert.equal(noBasis.completeness, 'UNAVAILABLE')
  assert.equal(noBasis.unresolvedRequirements[0]?.required, true)

  const partialBasis = await new DataResolver<number>({
    policies: [], executor: async () => ({ status: 'UNSUPPORTED' }), resolveAcquisition: async () => acquired({ data: 7 }),
  }).resolveSkillRequirements('industry-skill', [
    { kind: 'STATIC', id: 'price', metricId: 'valuation_market_price', dataKind: 'timeseries', required: true, determinismClass: 'AUTHORITATIVE_NUMERIC' },
    ...requiredTemplate,
  ], { workflowId: 'valuation', asOf: AS_OF })
  assert.equal(partialBasis.items[0]?.status, 'AVAILABLE')
  assert.equal(partialBasis.completeness, 'PARTIAL')
  assert.deepEqual(partialBasis.unresolvedRequirements, [{ templateId: 'required-demand', required: true, reason: 'INDUSTRY_ID_REQUIRED' }])

  const requiredGapAndResolvedInput = [
    { kind: 'STATIC', id: 'price', metricId: 'valuation_market_price', dataKind: 'timeseries', required: true, determinismClass: 'AUTHORITATIVE_NUMERIC' },
    ...requiredTemplate,
  ] as const
  const noValue = await new DataResolver<number>({
    policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async (item) => acquired<number>({ requirementId: item.id, data: undefined }),
  }).resolveSkillRequirements('industry-skill', requiredGapAndResolvedInput, { workflowId: 'valuation', asOf: AS_OF })
  assert.equal(noValue.items[0]?.status, 'AVAILABLE')
  assert.equal(noValue.items[0]?.value, undefined)
  assert.equal(noValue.completeness, 'UNAVAILABLE', 'an AVAILABLE status without a value is not an execution basis')

  const zeroValue = await new DataResolver<number>({
    policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
    resolveAcquisition: async (item) => acquired({ requirementId: item.id, data: 0 }),
  }).resolveSkillRequirements('industry-skill', requiredGapAndResolvedInput, { workflowId: 'valuation', asOf: AS_OF })
  assert.equal(zeroValue.items[0]?.value, 0)
  assert.equal(zeroValue.completeness, 'PARTIAL', 'numeric zero is a present usable result')
})

test('DataResolver limits an Industry metric to its catalog-associated source policy', async () => {
  const metricId = industryMetricId('pcb', 'monthly-shipment')
  const industryCatalog = createIndustryDataCatalog([industryDefinition({
    lifecycleStatus: 'CANONICAL',
    validation: { validatedAt: AS_OF, validator: 'reviewer', methodology: 'reviewed', sourceabilityEvidence: ['source URL'] },
  })])
  const makePolicy = (policyId: string, sourceId: string): SourcePolicy => ({
    policyId,
    requirementMatch: { metricId },
    selectionMode: 'FIRST_VALID',
    candidates: [{
      sourceId,
      fallbackLevel: 'PRIMARY',
      originAuthority: 'S1_OFFICIAL',
      operationId: `${sourceId}.fetch`,
      supports: { dataKinds: ['timeseries'], metricIds: [metricId] },
    }],
  })
  const resolver = new DataResolver<{ readonly value: number }>({
    policies: [makePolicy('pcb-shipment-policy', 'associated-source'), makePolicy('unassociated-policy', 'other-source')],
    industryCatalog,
    executor: async (_requirement, _candidate) => ({ status: 'SUCCESS', data: { value: 42 }, source: { publishedAt: '2026-09-30T00:00:00.000Z', retrievedAt: AS_OF } }),
  })
  const result = await resolver.resolveOne(requirement({ metricId, metricFamily: 'shipments', dataKind: 'timeseries' }))
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.source?.sourceId, 'associated-source')
  assert.deepEqual(result.attempts.map((item) => item.sourceId), ['associated-source'])
})

test('DataResolver fails closed for Industry identities without a canonical catalog, even with an injected resolver', async () => {
  let injectedCalls = 0
  let executorCalls = 0
  const metricId = industryMetricId('pcb', 'unreviewed-metric')
  const resolver = new DataResolver<number>({
    policies: [{
      policyId: 'broad-policy', requirementMatch: { dataKind: 'metric' }, selectionMode: 'FIRST_VALID', candidates: [],
    }],
    executor: async () => { executorCalls += 1; return { status: 'UNSUPPORTED' } },
    resolveAcquisition: async () => { injectedCalls += 1; return acquired({ data: 1 }) },
  })
  const result = await resolver.resolveOne(requirement({ metricId, dataKind: 'metric' }))
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.unavailableReason, 'NO_REGISTERED_POLICY')
  assert.equal(injectedCalls, 0)
  assert.equal(executorCalls, 0)
})
