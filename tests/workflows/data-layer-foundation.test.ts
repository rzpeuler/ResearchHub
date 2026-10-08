import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMON_DATA_CATALOG,
  createCommonDataCatalog,
  createIndustryDataCatalog,
  DataResolver,
  industryMetricId,
  materializeSkillDataRequirements,
  materializeIndustryEvidenceRequirement,
  resolveSourcePolicy,
  validateDataRequirement,
  INDUSTRY_DATA_SOURCE_POLICIES,
  INDUSTRY_RESEARCH_EVIDENCE_POLICY,
  validateIndustryObservation,
  type AcquisitionAttempt,
  type AcquisitionResult,
  type DataRequirement,
  type IndustryMetricDefinition,
  type IndustryMetricValidation,
  type SourceCandidate,
  type SourcePolicy,
} from '../../data/index.ts'
import { getDataSourceCatalog } from '../../app/services/data-source-catalog.ts'
import { getCanonicalResearchSkill } from '../../app/services/research-skill-catalog.ts'
import { createResearchSkillRegistry } from '../../app/services/skill-registry.ts'
import { earningsExpectationSourcePolicy } from '../../workflows/earnings-review/expectations-acquisition.ts'
import { finalizeResearchEvidence } from '../../data/research-evidence.ts'

const AS_OF = '2026-10-01T00:00:00.000Z'

function industryValidation(overrides: Partial<IndustryMetricValidation> = {}): IndustryMetricValidation {
  const checks = {
    SEMANTIC: ['reported shipment quantity'],
    UNIT: ['million units'],
    PERIOD: ['monthly period total'],
    SCOPE: ['China, household PCB shipments'],
    PIT: ['publication time recorded; value-version status explicit'],
    EXTRACTION: ['deterministic parser fixture'],
    ACCEPTANCE: ['real-source acceptance record'],
  }
  return {
    validatedAt: AS_OF,
    validator: 'domain-reviewer',
    methodology: 'Compare the source field and its historical semantics to the registered definition.',
    sourceabilityEvidence: ['official source URL', 'documented retrieval route'],
    ...overrides,
    checks: { ...checks, ...overrides.checks },
  }
}

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
    canonicalUnit: 'million units',
    acceptedSourceUnits: ['million units'],
    unitConversions: [],
    frequency: 'MONTHLY',
    periodBasis: 'PERIOD',
    aggregation: 'SUM',
    geography: 'China',
    applicability: 'Household PCB shipment volume',
    requiredQualifiers: ['EXACT'],
    pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'REQUIRED_FOR_HISTORICAL' },
    lifecycleStatus: 'DISCOVERED',
    sourcePolicies: [{ policyId: 'pcb-shipment-policy', metricFamily: 'shipments' }],
    ...overrides,
    ...(overrides.validation ? { validation: industryValidation(overrides.validation) } : {}),
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
  assert.deepEqual(industry.dataRequirements.map((item) => item.id), ['production-output-evidence', 'export-volume-evidence', 'raw-material-price-evidence', 'capacity-evidence', 'demand-evidence', 'inventory-evidence', 'pricing-evidence', 'utilization-evidence'])
  assert.ok(industry.dataRequirements.every((item) => item.kind === 'DOMAIN'))
  assert.equal(industry.requirementCoverage, 'PARTIAL')
  assert.ok(industry.dataRequirements.every((item) => !('metricId' in item)))
  assert.ok(industry.dataRequirements.every((item) => item.kind !== 'DOMAIN' || (item.semanticRole !== undefined && item.metricFamily !== undefined)), 'each generic DOMAIN need must specify exact semantic role and family')
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

  const evidence = industryValidation({
    methodology: 'Compare reported shipment totals against source publication and unit definitions.',
    sourceabilityEvidence: ['official monthly release URL', 'historical series available'],
  })
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

  const evidence = industryValidation({ methodology: 'reviewed source series', sourceabilityEvidence: ['source URL'] })
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
  const evidence = industryValidation({ methodology: 'reviewed', sourceabilityEvidence: ['source URL'] })
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

test('Industry evidence query context enforces bounds and rejects provider-specific keys', () => {
  const base = requirement({
    consumer: { workflow: 'industry-deep-research' }, subject: { industryId: 'unregistered-industry' },
    metricId: 'industry_research_evidence', dataKind: 'evidence', determinismClass: 'SEMANTIC_QUALITATIVE',
    industryEvidenceQueryContext: { displayTarget: 'Rare-earth magnets', searchTerms: ['capacity', 'pricing'], purpose: 'Locate dated public evidence', start: '2024-01-01', end: '2025-12-31' },
  })
  assert.deepEqual(validateDataRequirement(base), [])
  assert.ok(validateDataRequirement({ ...base, industryEvidenceQueryContext: { ...base.industryEvidenceQueryContext!, searchTerms: Array.from({ length: 9 }, (_, index) => `term-${index}`) } }).some((error) => error.includes('1-8')))
  assert.ok(validateDataRequirement({ ...base, industryEvidenceQueryContext: { ...base.industryEvidenceQueryContext!, provider: 'MIIT' } as never }).some((error) => error.includes('provider-specific')))
  assert.ok(validateDataRequirement({ ...base, industryEvidenceQueryContext: { ...base.industryEvidenceQueryContext!, start: '2026-01-01', end: '2025-01-01' } }).some((error) => error.includes('must not precede')))
  assert.equal(COMMON_DATA_CATALOG.find((item) => item.metricId === 'industry_research_evidence')?.dataKind, 'evidence')
})

test('Industry evidence requirements materialize through the Common identity for any target', () => {
  const materialized = materializeIndustryEvidenceRequirement({
    id: 'industry-wave-1', displayTarget: 'Unregistered industrial activity', searchTerms: ['production', 'orders'],
    purpose: 'Find dated source documents for the research question', asOf: AS_OF,
    subject: { industryId: 'unregistered_industry' }, period: { start: '2024-01-01', end: '2025-12-31' },
  })
  assert.equal(materialized.metricId, 'industry_research_evidence')
  assert.equal(materialized.dataKind, 'evidence')
  assert.equal(materialized.industryEvidenceQueryContext?.searchTerms.length, 2)
  assert.equal(materialized.industryEvidenceQueryContext?.start, '2024-01-01')
  assert.equal(materialized.required, false)
})

test('Industry evidence preserves publisher host and retriever separately and rejects denied rights', () => {
  const requirementValue = materializeIndustryEvidenceRequirement({
    id: 'industry-evidence-rights', displayTarget: 'Lithium battery', searchTerms: ['production'],
    purpose: 'Find dated source documents', asOf: AS_OF, subject: { industryId: 'lithium_battery' },
  })
  const deniedDocument = {
    record: { candidate: { candidateId: 'doc-1', kind: 'official_disclosure' as const, tier: 1 as const, title: 'Article', provider: 'miit-adapter', publishedAt: '2026-09-15' }, retrievedAt: AS_OF, title: 'Article', content: 'bounded source content', contentHash: 'a'.repeat(64), publisher: 'MIIT', rights: { accessScope: 'public' as const, retentionAllowed: false, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } },
    publishedAt: '2026-09-15', retrievedAt: AS_OF, sourceUrl: 'https://miit.gov.cn/article', contentHash: 'a'.repeat(64),
    originPublisher: 'MIIT', hostPlatform: 'MIIT official web', retrievalProvider: 'ResearchHub direct HTTPS',
    rights: { accessScope: 'public' as const, retentionAllowed: false, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
  const finalized = finalizeResearchEvidence(requirementValue, acquired({
    data: { kind: 'evidence' as const, documents: [], outcome: { transportSucceeded: true, fetchSucceeded: true, discovered: 1, fetched: 1, failed: 0, empty: 0, rejected: 0, deduplicated: 0, diagnostics: [] } },
    observations: [{ data: { kind: 'evidence' as const, documents: [deniedDocument], outcome: { transportSucceeded: true, fetchSucceeded: true, discovered: 1, fetched: 1, failed: 0, empty: 0, rejected: 0, deduplicated: 0, diagnostics: [] } }, source: { ...source('miit-evidence'), hostPlatform: 'MIIT official web' } }],
  }))
  assert.equal(finalized.status, 'UNAVAILABLE')
  assert.equal(finalized.observations?.[0]?.data.documents.length, 0)
  assert.ok(finalized.observations?.[0]?.data.outcome.diagnostics.includes('industry_evidence_rights_rejected'))
  assert.equal(finalized.observations?.[0]?.source.hostPlatform, 'MIIT official web')
})

test('Industry policies match exact metric identities and preserve configured operation order', () => {
  assert.equal(INDUSTRY_RESEARCH_EVIDENCE_POLICY.selectionMode, 'COLLECT_DIVERSE')
  assert.deepEqual(INDUSTRY_RESEARCH_EVIDENCE_POLICY.candidates.map((item) => item.operationId), [
    'industry.evidence.miit', 'industry.evidence.govcn', 'industry.evidence.cpca', 'industry.evidence.eastmoney-board',
  ])
  const metricPolicy = INDUSTRY_DATA_SOURCE_POLICIES.find((item) => item.requirementMatch.metricId === 'industry:lithium_battery:lithium-carbonate-period-average-price')!
  const exactRequirement = requirement({ consumer: { workflow: 'industry-deep-research' }, metricId: metricPolicy.requirementMatch.metricId, dataKind: 'timeseries' })
  assert.equal(resolveSourcePolicy(exactRequirement, [metricPolicy]).status, 'MATCHED')
  assert.equal(resolveSourcePolicy({ ...exactRequirement, metricId: 'industry:lithium_battery:lithium-hydroxide-period-average-price' }, [metricPolicy]).status, 'NO_REGISTERED_POLICY')
  assert.equal(metricPolicy.candidates[0]?.operationId, 'industry.metric.miit.lithium-carbonate-average-price')
})

test('Industry identity resolves only registered exact aliases', async () => {
  const { resolveIndustryIdentity } = await import('../../data/industry-catalog.ts')
  assert.equal(typeof resolveIndustryIdentity, 'function')
  if (typeof resolveIndustryIdentity !== 'function') return
  assert.deepEqual(resolveIndustryIdentity('  锂离子电池  '), { status: 'RESOLVED', industryId: 'lithium_battery' })
  assert.deepEqual(resolveIndustryIdentity('ROOM AIR CONDITIONER'), { status: 'RESOLVED', industryId: 'household_air_conditioner' })
  assert.deepEqual(resolveIndustryIdentity('steel'), { status: 'UNRESOLVED', input: 'steel', candidateIndustryIds: [] })
  assert.deepEqual(resolveIndustryIdentity('lithium battery!'), { status: 'UNRESOLVED', input: 'lithium battery!', candidateIndustryIds: [] })
})

test('Industry identity reports ambiguous aliases without selecting an ID', async () => {
  const { resolveIndustryIdentity } = await import('../../data/industry-catalog.ts')
  assert.equal(typeof resolveIndustryIdentity, 'function')
  if (typeof resolveIndustryIdentity !== 'function') return
  assert.deepEqual(resolveIndustryIdentity('shared alias', [
    { industryId: 'zeta', aliases: ['Shared Alias'] },
    { industryId: 'alpha', aliases: ['shared alias'] },
  ]), { status: 'AMBIGUOUS', input: 'shared alias', candidateIndustryIds: ['alpha', 'zeta'] })
})

test('Industry DOMAIN materialization reports multiple exact canonical matches as ambiguous', () => {
  const evidence = industryValidation({ methodology: 'reviewed', sourceabilityEvidence: ['official series'] })
  const catalog = createIndustryDataCatalog([
    industryDefinition({ lifecycleStatus: 'CANONICAL', validation: evidence }),
    industryDefinition({ metricId: industryMetricId('pcb', 'monthly-shipment-alternative'), lifecycleStatus: 'CANONICAL', validation: evidence }),
  ])
  const template = { kind: 'DOMAIN', domain: 'industry', id: 'demand', semanticRole: 'demand', metricFamily: 'shipments', required: false, dataKind: 'timeseries', determinismClass: 'EVIDENCE_BACKED_NUMERIC' } as const
  const result = materializeSkillDataRequirements('industry-skill', [template], { workflowId: 'industry-deep-research', asOf: AS_OF, subject: { industryId: 'pcb' } }, catalog)
  assert.deepEqual(result.requirements, [])
  assert.deepEqual(result.unresolved, [{ templateId: 'demand', required: false, reason: 'AMBIGUOUS_CANONICAL_INDUSTRY_METRIC' }])
})

test('Industry metric cannot become canonical without policy semantic unit scope extraction and PIT evidence', () => {
  const validation = { validatedAt: AS_OF, validator: 'reviewer', methodology: 'reviewed', sourceabilityEvidence: ['official series'] }
  const incomplete = industryDefinition({ lifecycleStatus: 'VALIDATED', validation })
  const catalog = createIndustryDataCatalog([incomplete])
  assert.throws(() => catalog.transition(incomplete.metricId, 'CANONICAL', validation), /INDUSTRY_CANONICAL_REQUIRES_COMPLETE_DEFINITION_AND_EVIDENCE/)
})

test('Industry canonical definition preserves unverified value-version limitation', () => {
  const definition = industryDefinition({
    pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'UNVERIFIED_CURRENT_VALUE_ONLY' },
  } as Partial<IndustryMetricDefinition>)
  const catalog = createIndustryDataCatalog([definition])
  assert.deepEqual(catalog.get(definition.metricId)?.pitPolicy, { publicationPit: 'REQUIRED', valueVersionPit: 'UNVERIFIED_CURRENT_VALUE_ONLY' })
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
    validation: industryValidation(),
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
  const metricPayload = { observationPoints: [{ metricId: industryMetricId('pcb', 'monthly-shipment'), canonicalUnit: 'million units', periodStart: '2026-01-01', periodEnd: '2026-03-31', sourceIdentity: 'url:https://fixture.test/series' }] }
  const resolver = new DataResolver<typeof metricPayload>({
    policies: [policy],
    executor: async () => ({ status: 'SUCCESS', data: metricPayload, source: source('fixture-industry-source') }),
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
  assert.equal(result.unresolvedRequirements.length, 8)
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
  assert.equal(requiredAcquisitionFailure.unresolvedRequirements.length, 8)

  const requiredTemplate = [{ kind: 'DOMAIN', domain: 'industry', id: 'required-demand', semanticRole: 'demand', metricFamily: 'demand', dataKind: 'timeseries', required: true, determinismClass: 'EVIDENCE_BACKED_NUMERIC' }] as const
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
    validation: industryValidation(),
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
  const metricPayload = { value: 12, observationPoints: [{ metricId, canonicalUnit: 'million units', periodStart: '2026-01-01', periodEnd: '2026-03-31', sourceIdentity: 'url:https://fixture.test/series' }] }
  const resolver = new DataResolver<typeof metricPayload>({
    policies: [makePolicy('pcb-shipment-policy', 'associated-source'), makePolicy('unassociated-policy', 'other-source')],
    industryCatalog,
    executor: async (_requirement, _candidate) => ({ status: 'SUCCESS', data: metricPayload, source: { publishedAt: '2026-09-30T00:00:00.000Z', retrievedAt: AS_OF } }),
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

test('DataResolver blocks historical unversioned Industry values and keeps current-only uncertainty visible', async () => {
  const metricId = industryMetricId('pcb', 'monthly-shipment')
  const validation = industryValidation({ methodology: 'deterministic current-only fixture', sourceabilityEvidence: ['fixture source'] })
  const catalog = createIndustryDataCatalog([industryDefinition({ metricId, lifecycleStatus: 'CANONICAL', validation })])
  const policy: SourcePolicy = {
    policyId: 'pcb-shipment-policy', requirementMatch: { workflow: 'fixture-workflow', metricId, dataKind: 'timeseries' }, selectionMode: 'FIRST_VALID',
    candidates: [{ sourceId: 'pcb-monthly-source', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'fixture.industry.metric', supports: { dataKinds: ['timeseries'], metricIds: [metricId] } }],
  }
  const executor = async (dataRequirement: DataRequirement) => {
    const observation = {
      metricId, value: 12, qualifier: 'EXACT' as const, unit: 'million units', originalValue: '12',
      periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-03-31T23:59:59.999Z', frequency: 'MONTHLY', periodBasis: 'PERIOD' as const, aggregation: 'SUM' as const,
      geography: 'China', product: 'Household PCB', publishedAt: '2026-03-31T00:00:00.000Z', retrievedAt: AS_OF,
      originPublisher: 'Official publisher', hostPlatform: 'official.example', retrievalProvider: 'fixture-retriever', authority: 'S1_OFFICIAL' as const,
      publicationPit: 'VERIFIED' as const, valueVersion: { status: 'UNVERIFIED' as const, reason: 'Fixture does not archive revisions.' }, sourceIdentity: 'url:https://official.example/series',
    }
    const validated = validateIndustryObservation(observation, catalog.get(metricId)!, dataRequirement)
    return validated.status === 'VALID'
      ? { status: 'SUCCESS' as const, data: validated.point!, source: { originAuthority: 'S1_OFFICIAL' as const, originPublisher: 'Official publisher', hostPlatform: 'official.example', retrievalProvider: 'fixture-retriever', sourceUrl: 'https://official.example/series', publishedAt: observation.publishedAt, retrievedAt: AS_OF, valueVersion: observation.valueVersion } }
      : { status: 'STALE' as const, diagnostic: validated.diagnostics.join('|'), source: { originAuthority: 'S1_OFFICIAL' as const, originPublisher: 'Official publisher', hostPlatform: 'official.example', retrievalProvider: 'fixture-retriever', sourceUrl: 'https://official.example/series', publishedAt: observation.publishedAt, retrievedAt: AS_OF, valueVersion: observation.valueVersion } }
  }
  const resolver = new DataResolver({ policies: [policy], executor, industryCatalog: catalog })
  const current = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', consumer: { workflow: 'fixture-workflow' }, asOfMode: 'CURRENT_VALUE_ONLY' }))
  assert.equal(current.status, 'AVAILABLE')
  assert.equal(current.acquisition.quality.valueVersionStatus, 'UNVERIFIED')
  const historical = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', consumer: { workflow: 'fixture-workflow' }, asOfMode: 'HISTORICAL' }))
  assert.equal(historical.status, 'UNAVAILABLE')
  assert.match(historical.attempts[0]?.diagnostic ?? '', /INDUSTRY_VALUE_VERSION_UNVERIFIED/)
})

test('DataResolver enforces historical value-version availability on the requirement path', async () => {
  const metricId = industryMetricId('pcb', 'monthly-shipment')
  const catalog = createIndustryDataCatalog([industryDefinition({ metricId, lifecycleStatus: 'CANONICAL', validation: industryValidation() })])
  const policy: SourcePolicy = {
    policyId: 'pcb-shipment-policy', requirementMatch: { metricId, dataKind: 'timeseries' }, selectionMode: 'FIRST_VALID',
    candidates: [{ sourceId: 'pcb-monthly-source', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'fixture.industry.metric', supports: { dataKinds: ['timeseries'], metricIds: [metricId] } }],
  }
  let version: { readonly status: 'VERIFIED'; readonly versionId: string; readonly availableAt: string } | { readonly status: 'UNVERIFIED' } = { status: 'UNVERIFIED' }
  const resolver = new DataResolver({ policies: [policy], industryCatalog: catalog, executor: async () => ({
    status: 'SUCCESS' as const,
    data: { value: 0, metricId, canonicalUnit: 'million units', periodStart: '2026-01-01', periodEnd: '2026-03-31', sourceIdentity: 'url:https://official.example/series' },
    source: { ...source('pcb-monthly-source'), publishedAt: '2026-09-30T00:00:00.000Z', observedAt: '2026-03-31', observationAvailableAt: '2026-03-31T16:00:00.000Z', valueVersion: version },
  }) })
  const current = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', asOfMode: 'CURRENT_VALUE_ONLY' }))
  assert.equal(current.status, 'AVAILABLE', 'zero is a present observation, even if the current version cannot be archived')
  assert.equal(current.quality.valueVersionStatus, 'UNVERIFIED')
  const historicalUnverified = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', asOfMode: 'HISTORICAL' }))
  assert.equal(historicalUnverified.status, 'UNAVAILABLE')
  assert.match(historicalUnverified.attempts[0]?.diagnostic ?? '', /value version or publication unverified/)
  version = { status: 'VERIFIED', versionId: 'series-v1', availableAt: '2026-09-30T12:00:00.000Z' }
  const historicalAvailable = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', asOfMode: 'HISTORICAL' }))
  assert.equal(historicalAvailable.status, 'AVAILABLE')
  version = { status: 'VERIFIED', versionId: 'series-v2', availableAt: '2026-10-02T00:00:00.000Z' }
  const versionAfterCutoff = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries', asOfMode: 'HISTORICAL' }))
  assert.equal(versionAfterCutoff.status, 'UNAVAILABLE')
  assert.match(versionAfterCutoff.attempts[0]?.diagnostic ?? '', /valueVersion is invalid or after analysisAsOf/)
})

test('DataResolver makes Industry numeric availability depend on valid observations, not document fetch success', async () => {
  const metricId = industryMetricId('pcb', 'monthly-shipment')
  const catalog = createIndustryDataCatalog([industryDefinition({ metricId, lifecycleStatus: 'CANONICAL', validation: industryValidation() })])
  const policy: SourcePolicy = {
    policyId: 'pcb-shipment-policy', requirementMatch: { metricId, dataKind: 'timeseries' }, selectionMode: 'FIRST_VALID',
    candidates: [{ sourceId: 'pcb-monthly-source', fallbackLevel: 'PRIMARY', originAuthority: 'S1_OFFICIAL', operationId: 'fixture.industry.metric', supports: { dataKinds: ['timeseries'], metricIds: [metricId] } }],
  }
  let payload: { readonly value: number; readonly documents: readonly unknown[]; readonly observationPoints: readonly unknown[]; readonly observationDiagnostics: readonly string[] } = { value: 1, documents: [{}], observationPoints: [], observationDiagnostics: ['INDUSTRY:UNSUPPORTED_INDUSTRY_UNIT'] }
  const resolver = new DataResolver({ policies: [policy], industryCatalog: catalog, executor: async () => ({ status: 'SUCCESS' as const, data: payload, source: { ...source('pcb-monthly-source'), publishedAt: '2026-09-30T00:00:00.000Z' } }) })
  const invalidUnit = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries' }))
  assert.equal(invalidUnit.status, 'UNAVAILABLE')
  assert.equal(invalidUnit.unavailableReason, 'UNIT_INVALID')
  assert.equal(invalidUnit.value?.documents.length, 1, 'qualified document evidence remains available alongside the numeric gap')
  payload = { value: 1, documents: [{}], observationPoints: [], observationDiagnostics: [] }
  const parserReturnedNoMetric = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries' }))
  assert.equal(parserReturnedNoMetric.status, 'UNAVAILABLE')
  assert.equal(parserReturnedNoMetric.unavailableReason, 'PARSER_UNAVAILABLE')
  payload = { value: 0, documents: [{}], observationPoints: [{ value: 0, metricId, canonicalUnit: 'million units', periodStart: '2026-01-01', periodEnd: '2026-03-31', sourceIdentity: 'url:https://official.example/series' }], observationDiagnostics: [] }
  const qualifiedZero = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries' }))
  assert.equal(qualifiedZero.status, 'AVAILABLE')
  assert.equal(qualifiedZero.value?.observationPoints[0] && (qualifiedZero.value.observationPoints[0] as { value: number }).value, 0)
  payload = { value: 2, documents: [{}], observationPoints: [{ value: 2, metricId, canonicalUnit: 'million units', periodStart: '2026-01-01', periodEnd: '2026-03-31', sourceIdentity: 'url:https://official.example/series' }], observationDiagnostics: ['INDUSTRY_METRIC_CONFLICT:series'] }
  const partialConflict = await resolver.resolveOne(requirement({ metricId, dataKind: 'timeseries' }))
  assert.equal(partialConflict.status, 'PARTIAL')
  assert.match(partialConflict.value?.observationDiagnostics[0] ?? '', /CONFLICT/)
})
