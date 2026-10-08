import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { readCanonicalV04Assets } from '../../../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeGraphService } from '../../../app/services/knowledge-graph-service.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { INDUSTRY_MODULES } from '../../../skills/industry-research/index.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchSourceCandidate } from '../../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'
import { INDUSTRY_RESEARCH_EVIDENCE_POLICY, INDUSTRY_DATA_SOURCE_POLICIES } from '../../../data/industry-policies.ts'
import { createIndustryDataCatalog, industryMetricId } from '../../../data/industry-catalog.ts'
import { createIndustryDataResolver } from '../../../app/services/industry-data-resolver.ts'
import type { IndustryDataResolverFactory } from '../../../workflows/industry-deep-research/contracts.ts'
import { createIndustryEvidenceOperation, createIndustryMetricOperation, normalizeIndustryObservationCandidate } from '../../../plugins/research-acquisition/industry-data-operations.ts'
import { createIndustryOperatingObservation, type IndustryOperatingObservationAcquisitionResult } from '../../../plugins/research-acquisition/industry-operating-observations.ts'
import type { IndustryMetricDefinition } from '../../../data/industry-catalog.ts'
import type { ThemeScopeImpactChecker } from '../../../workflows/theme-scope-impact-check/post-write.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
const design = { definitionHypothesis: 'Fixture PCB Industry', targetKind: 'industry', scope: { included: ['PCB'], excluded: ['theme'] }, moduleQuestions: Object.fromEntries(INDUSTRY_MODULES.map((module) => [module, module])), keyMetrics: ['capacity'], evidenceRequirements: ['official'], searchTerms: ['PCB'], knownGaps: [], verificationCandidates: [] }

function source(candidateId: string, content = 'Official PCB industry market product company evidence.') : NormalizedResearchSource {
  const candidate: ResearchSourceCandidate = { candidateId, kind: 'official_disclosure', tier: 1, title: `Fixture ${candidateId}`, provider: 'fixture', publishedAt: '2026-09-08T00:00:00.000Z', metadata: { module: 'company_mapping' } }
  return { candidate, retrievedAt: '2026-09-08T01:00:00.000Z', title: candidate.title, content, contentHash: sha256(content), publisher: 'Fixture Official', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

class IndustryExecutor implements ReasoningExecutor {
  readonly calls: ReasoningRequest[] = []
  constructor(private readonly firstGap = false) {}
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    this.calls.push(structuredClone(request))
    if (request.operation === 'industry_research_design') return { operation: request.operation, output: design }
    if (request.operation === 'industry_module_analysis') {
      const input = request.input as { module: string; evidence: readonly { evidenceId: string }[] }
      const evidenceIds = input.evidence.map((item) => item.evidenceId)
      const proposals = input.module === 'company_mapping' ? [
        { proposalId: 'product', kind: 'entity' as const, subjectKey: 'product', entityType: 'product' as const, entityName: 'Fixture PCB Product' },
        { proposalId: 'company', kind: 'entity' as const, subjectKey: 'company', entityType: 'company' as const, entityName: 'Fixture PCB Company', structuredValue: { ticker: '000001', exchange: 'SZSE' } },
        { proposalId: 'product-industry', kind: 'relation' as const, subjectKey: 'product', targetKey: 'industry', relationType: 'belongs_to_industry' as const, sourceCandidateIds: evidenceIds },
        { proposalId: 'company-industry', kind: 'relation' as const, subjectKey: 'company', targetKey: 'industry', relationType: 'business_exposure' as const, sourceCandidateIds: evidenceIds },
        { proposalId: 'industry-claim', kind: 'claim' as const, subjectKey: 'industry', claimType: 'fact' as const, statement: 'Fixture PCB industry includes the fixture product and company.', sourceCandidateIds: evidenceIds },
      ] : []
      const gap = this.firstGap && input.module === 'supply_demand_analysis' && this.calls.filter((call) => call.operation === 'industry_module_analysis' && (call.input as { module: string }).module === input.module).length === 1 ? [{ gapId: 'wave-two-gap', module: input.module as never, question: 'capacity gap', reason: 'fixture first-pass gap', actionable: true, searchTerms: ['capacity-gap'] }] : []
      return { operation: request.operation, output: { module: input.module, status: gap.length ? 'partial' : 'supported', analysis: 'Deterministic fixture analysis.', evidenceIds, proposals, gaps: gap, reportMaterial: { markdown: 'Evidence-backed fixture analysis.', evidenceIds, proposalIds: proposals.map((item) => item.proposalId), relationProposalIds: proposals.filter((item) => item.kind === 'relation').map((item) => item.proposalId) } } }
    }
    const input = request.input as { evidence: readonly { evidenceId: string }[] }
    return { operation: request.operation, output: { executiveView: 'Fixture industry view.', analysis: 'Fixture synthesis.', evidenceIds: input.evidence.map((item) => item.evidenceId), proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: 'Fixture synthesis.', evidenceIds: input.evidence.map((item) => item.evidenceId), proposalIds: [] } } }
  }
}

function fixturePlugin(sequence: readonly NormalizedResearchSource[] = [source('fixture-source')], observedSearchTerms?: string[][]): ResearchAcquisitionPlugin {
  let index = 0
  return {
    name: 'fixture-industry-provider',
    async discover(request) { if ('industry' in request) observedSearchTerms?.push([...(request.industry?.searchTerms ?? [])]); return [sequence[Math.min(index, sequence.length - 1)]!.candidate] },
    async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> { const item = sequence.find((value) => value.candidate.candidateId === candidate.candidateId)!; return { candidate, retrievedAt: item.retrievedAt, content: item.content, rawBytes: new TextEncoder().encode(item.content), contentHash: item.contentHash } },
    async normalize(): Promise<NormalizedResearchSource> { return sequence[Math.min(index++, sequence.length - 1)]! },
  }
}

async function fixture(options: { readonly executor?: IndustryExecutor; readonly plugins?: readonly ResearchAcquisitionPlugin[]; readonly impactChecker?: ThemeScopeImpactChecker; readonly industryDataResolverFactory?: IndustryDataResolverFactory } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rhl-app-industry-'))
  const reports = await mkdtemp(join(tmpdir(), 'rhl-app-industry-reports-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-app-industry', now: '2026-09-08T00:00:00.000Z' })
  const workflowService = new WorkflowService()
  const executor = options.executor ?? new IndustryExecutor()
  const plugin = options.plugins?.[0] ?? fixturePlugin()
  const industryDataResolverFactory: IndustryDataResolverFactory = options.industryDataResolverFactory ?? ((context) => createIndustryDataResolver({ catalog: createIndustryDataCatalog(), policies: [{ ...INDUSTRY_RESEARCH_EVIDENCE_POLICY, candidates: [INDUSTRY_RESEARCH_EVIDENCE_POLICY.candidates[0]!] }], operations: { 'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', plugin) } }, context))
  const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, workflowService, reasoningExecutor: executor, industryDataResolverFactory, acquisitionPlugins: [], ...(options.impactChecker === undefined ? {} : { themeScopeImpactChecker: options.impactChecker }) })
  return { root, reports, workflowService, service, executor }
}

function canonicalProductionFixture(): { readonly catalog: ReturnType<typeof createIndustryDataCatalog>; readonly acquisition: { acquire: () => Promise<IndustryOperatingObservationAcquisitionResult>; acquireNamed: (_request: unknown, metricId: string) => Promise<IndustryOperatingObservationAcquisitionResult> }; readonly pointMetricId: string; readonly exportMetricId: string; readonly productionObservation: ReturnType<typeof createIndustryOperatingObservation>; readonly productionSource: NormalizedResearchSource; readonly exportSource: NormalizedResearchSource } {
  const metricId = industryMetricId('household_air_conditioner', 'room-air-conditioner-production')
  const exportMetricId = industryMetricId('household_air_conditioner', 'air-conditioner-export-volume')
  const policyId = `industry-metric:${metricId}`
  const exportPolicyId = `industry-metric:${exportMetricId}`
  const checks = { SEMANTIC: ['official definition'], UNIT: ['source unit reviewed'], PERIOD: ['period semantics reviewed'], SCOPE: ['geography and product reviewed'], PIT: ['publication PIT verified'], EXTRACTION: ['deterministic parser'], ACCEPTANCE: ['fixture operation acceptance'] }
  const canonical = (definition: Omit<IndustryMetricDefinition, 'lifecycleStatus' | 'sourcePolicies' | 'validation'>, policy: string): IndustryMetricDefinition => ({ ...definition, lifecycleStatus: 'CANONICAL', sourcePolicies: [{ policyId: policy }], validation: { validatedAt: '2026-10-08T00:00:00.000Z', validator: 'Phase 4 deterministic fixture', methodology: 'Fixture proves exact runtime matching only; it is not live-source acceptance.', sourceabilityEvidence: ['Test-only named operation'], checks } })
  const productionDefinition = canonical({ metricId, industryId: 'household_air_conditioner', metricFamily: 'operating_output', semanticRole: 'production', name: 'Room air conditioner production', description: 'Annual room air conditioner production in China.', dataKind: 'timeseries', canonicalUnit: '万台', acceptedSourceUnits: ['万台'], frequency: 'ANNUAL', periodBasis: 'PERIOD', aggregation: 'SUM', geography: 'China national', applicability: 'Room air conditioner production', product: '房间空气调节器', requiredQualifiers: ['EXACT'], pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'UNVERIFIED_CURRENT_VALUE_ONLY' } }, policyId)
  const exportDefinition = canonical({ metricId: exportMetricId, industryId: 'household_air_conditioner', metricFamily: 'trade_volume', semanticRole: 'export_volume', name: 'Household air conditioner export volume', description: 'Monthly household air conditioner export volume.', dataKind: 'timeseries', canonicalUnit: '台', acceptedSourceUnits: ['台'], frequency: 'MONTHLY', periodBasis: 'PERIOD', aggregation: 'SUM', geography: 'China national exports', applicability: 'Household air conditioner exports', product: '家用空调器', requiredQualifiers: ['EXACT'], pitPolicy: { publicationPit: 'REQUIRED', valueVersionPit: 'UNVERIFIED_CURRENT_VALUE_ONLY' } }, exportPolicyId)
  const normalized = source('fixture-nbs-production')
  const productionUrl = 'https://fixture.test/nbs/room-air-conditioner-production'
  const productionSource: NormalizedResearchSource = { ...normalized, canonicalUrl: productionUrl, candidate: { ...normalized.candidate, url: productionUrl, publishedAt: '2026-03-02T15:59:59.999Z' }, retrievedAt: '2026-09-02T00:00:00.000Z', publisher: 'National Bureau of Statistics' }
  const productionObservation = createIndustryOperatingObservation({ metricKey: 'room_air_conditioner.production', observationClass: 'PRODUCTION', value: 26697.5, qualifier: 'EXACT', unit: '万台', originalValue: '26697.5', originalUnit: '万台', periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2025-12-31T23:59:59.999Z', frequency: 'ANNUAL', aggregation: 'PERIOD', geography: 'China national', productOrSegment: '房间空气调节器', publishedAt: '2026-03-02T15:59:59.999Z', retrievedAt: '2026-09-02T00:00:00.000Z', originPublisher: 'National Bureau of Statistics', hostPlatform: 'fixture.test', retrievalProvider: 'fixture NBS operation', sourceAuthority: 'S0_STATUTORY', determinismClass: 'EVIDENCE_BACKED_NUMERIC', sourceCandidateId: productionSource.candidate.candidateId, sourceRef: `url:${productionUrl}`, publicationPit: 'VERIFIED', valueVersionPit: 'UNVERIFIED', metadata: { canonicalUrl: productionUrl } })
  const exportUrl = 'https://fixture.test/cheaa/air-conditioner-export-volume'
  const exportSource: NormalizedResearchSource = { ...source('fixture-cheaa-export'), canonicalUrl: exportUrl, candidate: { ...source('fixture-cheaa-export').candidate, url: exportUrl, publishedAt: '2024-11-08T15:59:59.999Z' }, publisher: 'CHEAA' }
  const exportObservation = createIndustryOperatingObservation({ metricKey: 'air_conditioner.export_volume', observationClass: 'TRADE', value: 4039692, qualifier: 'EXACT', unit: '台', originalValue: '4039692', originalUnit: '台', periodStart: '2024-09-01T00:00:00.000Z', periodEnd: '2024-09-30T23:59:59.999Z', frequency: 'MONTHLY', aggregation: 'PERIOD', geography: 'China national exports', productOrSegment: '家用空调器', publishedAt: '2024-11-08T15:59:59.999Z', retrievedAt: '2026-09-02T00:00:00.000Z', originPublisher: 'CHEAA', hostPlatform: 'fixture.test', retrievalProvider: 'fixture CHEAA operation', sourceAuthority: 'S2_PROFESSIONAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', sourceCandidateId: exportSource.candidate.candidateId, sourceRef: `url:${exportUrl}`, publicationPit: 'VERIFIED', valueVersionPit: 'UNVERIFIED', metadata: { canonicalUrl: exportUrl } })
  const productionResult: IndustryOperatingObservationAcquisitionResult = { status: 'COMPLETED', observations: [productionObservation], sources: [productionSource], diagnostics: [] }
  const exportResult: IndustryOperatingObservationAcquisitionResult = { status: 'COMPLETED', observations: [exportObservation], sources: [exportSource], diagnostics: [] }
  return { catalog: createIndustryDataCatalog([productionDefinition, exportDefinition]), acquisition: { acquire: async () => productionResult, acquireNamed: async (_request, selectedMetricId) => selectedMetricId === metricId ? productionResult : selectedMetricId === exportMetricId ? exportResult : { status: 'SCOPE_UNSUPPORTED', observations: [], sources: [], diagnostics: ['FIXTURE_METRIC_ID_MISMATCH'] } }, pointMetricId: metricId, exportMetricId, productionObservation, productionSource, exportSource }
}

test('Application Industry research projects canonical graph and replays semantic objects without duplication', async () => {
  const f = await fixture()
  try {
    const first = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-first', name: 'Fixture PCB Industry', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(first.status, 'completed', first.errorSummary)
    assert.match(first.reportPath ?? '', /^[A-Za-z0-9._-]+\.md$/)
    assert.equal(first.providerOutcomes.length, 0)
    assert.ok(first.acquisitionDiagnostics.length <= 32)
    const report = JSON.parse(await readFile(join(f.reports, `${first.reportPath!}.json`), 'utf8')) as { sections: unknown[] }
    assert.equal(report.sections.length, 16)
    const assetsBefore = await readCanonicalV04Assets(f.root)
    const valuesBefore = assetsBefore.objects.map((item) => item.value as { id: string; type?: string; sourceRef?: string; targetRef?: string })
    const industry = valuesBefore.find((value) => value.type === 'industry' && value.id.startsWith('entity:'))!
    assert.ok(industry)
    const graph = new KnowledgeGraphService(f.root)
    const projected = await graph.getGraphProjection({ rootRef: industry.id, depth: 2, maxNodes: 10, maxEdges: 10 })
    assert.equal(projected.profile, 'industry_context'); assert.equal(projected.nodes.find((node) => node.ref === industry.id)?.isRoot, true)
    assert.ok(projected.nodes.some((node) => node.entityType === 'product')); assert.ok(projected.nodes.some((node) => node.entityType === 'company'))
    assert.ok(projected.edges.some((edge) => edge.relationType === 'belongs_to_industry' || edge.relationType === 'business_exposure'))
    const canonicalIds = new Set(valuesBefore.map((value) => value.id)); for (const item of [...projected.nodes, ...projected.edges]) assert.ok(canonicalIds.has(item.ref))
    const bounded = await graph.getGraphProjection({ rootRef: industry.id, depth: 1, maxNodes: 1, maxEdges: 1 }); assert.equal(bounded.nodes.some((node) => node.isRoot), true); assert.ok(bounded.nodes.length <= 1); assert.ok(bounded.edges.length <= 1)
    const countsBefore = valuesBefore.reduce<Record<string, number>>((counts, value) => { const kind = value.id.split(':', 1)[0]!; counts[kind] = (counts[kind] ?? 0) + 1; return counts }, {})
    const second = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-replay', name: 'Fixture PCB Industry', canonicalRef: industry.id, maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(second.status, 'completed')
    const valuesAfter = (await readCanonicalV04Assets(f.root)).objects.map((item) => item.value as { id: string; type?: string })
    const countsAfter = valuesAfter.reduce<Record<string, number>>((counts, value) => { const kind = value.id.split(':', 1)[0]!; counts[kind] = (counts[kind] ?? 0) + 1; return counts }, {})
    assert.deepEqual(countsAfter, countsBefore)
    const projectedAgain = await graph.getGraphProjection({ rootRef: industry.id, depth: 2 })
    assert.deepEqual(projectedAgain.nodes.map((node) => node.ref), projected.nodes.map((node) => node.ref)); assert.deepEqual(projectedAgain.edges.map((edge) => edge.ref), projected.edges.map((edge) => edge.ref))
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Industry research sends verified canonical changes to the scope impact inbox', async () => {
  const receipts: unknown[] = []
  const f = await fixture({ impactChecker: { check: async (receipt) => { receipts.push(receipt); return { receiptKey: 'a'.repeat(64), knowledgeBaseId: 'kb-app-industry', baseRevision: 0, committedRevision: 1, status: 'ready', proposals: [], diagnostics: [] } } } })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-impact-trigger', name: 'Fixture PCB Industry', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.equal(result.themeScopeImpact.status, 'ready')
    assert.equal(receipts.length, 1)
    const receipt = receipts[0] as { writerRunId: string; knowledgeBaseId: string; createdRefs: readonly string[]; updatedRefs: readonly string[] }
    assert.equal(receipt.writerRunId, 'industry-impact-trigger')
    assert.equal(receipt.knowledgeBaseId, 'kb-app-industry')
    assert.deepEqual(new Set([...receipt.createdRefs, ...receipt.updatedRefs]), new Set(result.committedIds))
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Industry research aggregates bounded provider evidence across two waves', async () => {
  const executor = new IndustryExecutor(true)
  const observedSearchTerms: string[][] = []
  const f = await fixture({ executor, plugins: [fixturePlugin([source('wave-one'), source('wave-two', 'Official capacity-gap evidence for the PCB industry.')], observedSearchTerms)] })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-two-wave', name: 'Fixture PCB Industry', searchTerms: ['base-search-term'], maxSources: 4 }).completion
    assert.equal(result.status, 'completed', result.errorSummary); assert.equal(result.providerOutcomes.length, 0)
    assert.deepEqual(observedSearchTerms, [['base-search-term'], ['capacity-gap', 'base-search-term']]); assert.ok(result.acquisitionDiagnostics.length <= 32)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Industry invocation traverses Workflow, DataResolver, catalog policy, Plugin operation, and Skill with honest metric gaps', async () => {
  const calls = { discover: 0, fetch: 0, normalize: 0 }
  const plugin = fixturePlugin()
  const tracedPlugin: ResearchAcquisitionPlugin = { name: plugin.name, async discover(request, signal) { calls.discover++; return plugin.discover(request, signal) }, async fetch(candidate, signal) { calls.fetch++; return plugin.fetch(candidate, signal) }, async normalize(fetched, signal) { calls.normalize++; return plugin.normalize(fetched, signal) } }
  const f = await fixture({ plugins: [tracedPlugin] })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-data-resolver', name: 'Fixture PCB Industry', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.ok(calls.discover > 0); assert.ok(calls.fetch > 0); assert.ok(calls.normalize > 0)
    assert.equal(result.operatingObservations.length, 0)
    assert.equal(result.requirementCoverage, 'PARTIAL')
    assert.ok(result.dataRequirementGaps.some((gap) => gap.endsWith(':INDUSTRY_ID_REQUIRED')))
    const report = JSON.parse(await readFile(join(f.reports, `${result.reportPath!}.json`), 'utf8')) as { sections: Array<{ title: string; markdown: string }> }
    assert.match(report.sections.find((section) => section.title === 'Key Metrics & Monitoring')!.markdown, /no canonical Industry metric resolved/i)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Industry invocation selects the exact canonical production metric and gives provider-neutral points to relevant Skills', async () => {
  const canonical = canonicalProductionFixture()
  const plugin = fixturePlugin()
  const factory: IndustryDataResolverFactory = (context) => createIndustryDataResolver({
    catalog: canonical.catalog,
    policies: INDUSTRY_DATA_SOURCE_POLICIES,
    operations: {
      'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', plugin),
      'industry.metric.nbs.room-air-conditioner-production': createIndustryMetricOperation(canonical.acquisition),
      'industry.metric.cheaa.air-conditioner-export-volume': createIndustryMetricOperation(canonical.acquisition),
    },
  }, context)
  const f = await fixture({ industryDataResolverFactory: factory })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-canonical-production', name: '家用空调', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.equal(result.operatingObservations.length, 2)
    assert.equal(result.operatingObservations[0]?.metricId, canonical.pointMetricId)
    assert.equal(result.operatingObservations[0]?.canonicalUnit, '万台')
    assert.equal(result.operatingObservations[0]?.value, 26697.5)
    const moduleCalls = (f.executor as IndustryExecutor).calls.filter((call) => call.operation === 'industry_module_analysis')
    const pointsFor = (module: string) => (moduleCalls.find((call) => (call.input as { module: string }).module === module)?.input as { operatingObservations: readonly { metricId: string; unit: string; sourceIdentity: string }[] } | undefined)?.operatingObservations ?? []
    assert.equal(pointsFor('market_size_growth').length, 1)
    assert.equal(pointsFor('supply_demand_analysis').length, 2)
    assert.equal(pointsFor('technology_evolution').length, 0)
    assert.deepEqual(new Set(pointsFor('supply_demand_analysis').map((point) => point.metricId)), new Set([canonical.pointMetricId, canonical.exportMetricId]))
    assert.equal(pointsFor('supply_demand_analysis').find((point) => point.metricId === canonical.pointMetricId)?.unit, '万台')
    assert.equal(pointsFor('supply_demand_analysis').find((point) => point.metricId === canonical.exportMetricId)?.unit, '台')
    assert.match(pointsFor('supply_demand_analysis').find((point) => point.metricId === canonical.pointMetricId)?.sourceIdentity ?? '', /^url:https:\/\/fixture\.test\/nbs/)
    const knowledge = (await readCanonicalV04Assets(f.root)).objects.map((item) => item.value as { id: string; canonicalUrl?: string; rawRefs?: readonly string[] })
    const sources = knowledge.filter((item) => item.id.startsWith('source:'))
    const metricSourceRefs = new Set<string>()
    for (const observation of result.operatingObservations) {
      const url = observation.sourceIdentity.replace(/^url:/, '')
      const matches = sources.filter((item) => item.canonicalUrl === url)
      assert.equal(matches.length, 1, `one canonical Source must bind ${observation.sourceIdentity}`)
      assert.equal(matches[0]?.rawRefs?.length, 1, 'the canonical Source must retain its Raw binding')
      metricSourceRefs.add(matches[0]!.id)
    }
    const report = JSON.parse(await readFile(join(f.reports, `${result.reportPath!}.json`), 'utf8')) as { sections: Array<{ title: string; markdown: string; sourceRefs?: string[] }> }
    const metricReportSection = report.sections.find((section) => section.title === 'Key Metrics & Monitoring')!
    for (const sourceRef of metricSourceRefs) assert.ok(metricReportSection.sourceRefs?.includes(sourceRef), `report must cite bound Source ${sourceRef}`)
    assert.doesNotMatch(metricReportSection.markdown, /\| url:https:\/\//, 'report must not present an unbound URL identity as a canonical citation')
    assert.equal(result.requirementCoverage, 'PARTIAL')
    assert.ok(result.dataRequirementGaps.some((gap) => gap.startsWith('capacity-evidence:NO_CANONICAL_INDUSTRY_METRIC')))
    assert.ok(result.dataRequirementGaps.some((gap) => gap.startsWith('demand-evidence:NO_CANONICAL_INDUSTRY_METRIC')))
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Industry keeps an unbound canonical metric out of Skill input and reports an explicit provenance gap', async () => {
  const canonical = canonicalProductionFixture()
  let pluginCalls = 0
  const plugin = fixturePlugin()
  const tracedPlugin: ResearchAcquisitionPlugin = {
    name: plugin.name,
    async discover(request, signal) { pluginCalls++; return plugin.discover(request, signal) },
    async fetch(candidate, signal) { return plugin.fetch(candidate, signal) },
    async normalize(fetched, signal) { return plugin.normalize(fetched, signal) },
  }
  const factory: IndustryDataResolverFactory = (context) => createIndustryDataResolver({
    catalog: canonical.catalog,
    policies: INDUSTRY_DATA_SOURCE_POLICIES,
    operations: {
      'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', tracedPlugin),
      'industry.metric.nbs.room-air-conditioner-production': async ({ requirement, candidate, now }) => {
        const observationCandidate = normalizeIndustryObservationCandidate(canonical.productionObservation, requirement, candidate.operationId)
        return {
          status: 'SUCCESS',
          data: { documents: [], observationCandidates: observationCandidate ? [observationCandidate] : [], diagnostics: [], outcome: { transportSucceeded: true, fetchSucceeded: true, discovered: 1, fetched: 0, failed: 0, empty: 0, rejected: 0, deduplicated: 0 } },
          source: { originAuthority: candidate.originAuthority, retrievalProvider: 'fixture metric operation', retrievedAt: now() },
        }
      },
    },
  }, context)
  const f = await fixture({ plugins: [tracedPlugin], industryDataResolverFactory: factory })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-unbound-metric', name: '家用空调', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    const observation = result.operatingObservations.find((point) => point.metricId === canonical.pointMetricId)
    assert.ok(observation, 'the resolver may retain a valid metric for report context')
    assert.ok(observation.diagnostics.includes('INDUSTRY_METRIC_PROVENANCE_GAP'))
    const moduleCalls = (f.executor as IndustryExecutor).calls.filter((call) => call.operation === 'industry_module_analysis')
    const pointInputs = moduleCalls.flatMap((call) => (call.input as { operatingObservations: readonly { sourceIdentity: string }[] }).operatingObservations)
    assert.equal(pointInputs.some((point) => point.sourceIdentity === observation.sourceIdentity), false)
    assert.ok(result.dataRequirementGaps.some((gap) => gap === `${canonical.pointMetricId}:PROVENANCE_GAP`))
    assert.equal(result.requirementCoverage, 'PARTIAL')
    assert.ok(pluginCalls > 0, 'the test traverses the Application evidence plugin path as well as the metric operation')
    const report = JSON.parse(await readFile(join(f.reports, `${result.reportPath!}.json`), 'utf8')) as { sections: Array<{ title: string; markdown: string }> }
    assert.match(report.sections.find((section) => section.title === 'Key Metrics & Monitoring')!.markdown, /context\/report only/)
    const values = (await readCanonicalV04Assets(f.root)).objects.map((item) => item.value as { id: string; canonicalUrl?: string })
    assert.equal(values.some((value) => value.id.startsWith('source:') && value.canonicalUrl === canonical.productionSource.canonicalUrl), false)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application explicit historical asOf reaches numeric Industry DataRequirements and rejects unversioned values', async () => {
  const canonical = canonicalProductionFixture()
  const observed: Array<{ readonly metricId?: string; readonly asOf: string; readonly asOfMode?: string }> = []
  const factory: IndustryDataResolverFactory = (context) => {
    const metricOperation = createIndustryMetricOperation(canonical.acquisition)
    const capture = async (request: Parameters<typeof metricOperation>[0]) => {
      observed.push({ metricId: request.requirement.metricId, asOf: request.requirement.analysisAsOf ?? request.requirement.asOf, asOfMode: request.requirement.asOfMode })
      return metricOperation(request)
    }
    return createIndustryDataResolver({ catalog: canonical.catalog, policies: INDUSTRY_DATA_SOURCE_POLICIES, operations: {
      'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', fixturePlugin()),
      'industry.metric.nbs.room-air-conditioner-production': capture,
      'industry.metric.cheaa.air-conditioner-export-volume': capture,
    } }, context)
  }
  const f = await fixture({ industryDataResolverFactory: factory })
  try {
    const cutoff = '2026-09-08T00:00:00.000Z'
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-historical-asof', name: '家用空调', asOf: cutoff, maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.ok(observed.length >= 2)
    assert.ok(observed.every((item) => item.asOf === cutoff && item.asOfMode === 'HISTORICAL'))
    assert.equal(result.operatingObservations.length, 0)
    assert.ok(result.dataRequirementGaps.some((gap) => gap.endsWith(':NO_ELIGIBLE_POINT_IN_TIME_DATA')))
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Generic and metric paths for the same official document share one canonical Source and Raw', async () => {
  const canonical = canonicalProductionFixture()
  const factory: IndustryDataResolverFactory = (context) => createIndustryDataResolver({
    catalog: canonical.catalog,
    policies: INDUSTRY_DATA_SOURCE_POLICIES,
    operations: {
      'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', fixturePlugin([canonical.productionSource])),
      'industry.metric.nbs.room-air-conditioner-production': createIndustryMetricOperation(canonical.acquisition),
      'industry.metric.cheaa.air-conditioner-export-volume': createIndustryMetricOperation(canonical.acquisition),
    },
  }, context)
  const f = await fixture({ industryDataResolverFactory: factory })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-shared-metric-source', name: '家用空调', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    const sources = (await readCanonicalV04Assets(f.root)).objects.map((item) => item.value as { id: string; canonicalUrl?: string; rawRefs?: readonly string[] }).filter((item) => item.id.startsWith('source:'))
    const shared = sources.filter((item) => item.canonicalUrl === canonical.productionSource.canonicalUrl)
    assert.equal(shared.length, 1)
    assert.equal(shared[0]?.rawRefs?.length, 1)
    const report = JSON.parse(await readFile(join(f.reports, `${result.reportPath!}.json`), 'utf8')) as { sections: Array<{ title: string; sourceRefs?: string[] }> }
    const section = report.sections.find((item) => item.title === 'Key Metrics & Monitoring')!
    assert.ok(section.sourceRefs?.includes(shared[0]!.id))
    assert.equal(sources.filter((item) => item.canonicalUrl === canonical.productionSource.canonicalUrl).length, 1, 'same document identity must not create duplicate Sources')
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Rights-denied metric sources never reach Skill input or canonical Source/Raw', async () => {
  const canonical = canonicalProductionFixture()
  const deniedSource: NormalizedResearchSource = { ...canonical.productionSource, rights: { ...canonical.productionSource.rights, derivativeKnowledgeAllowed: false } }
  const acquisition = {
    ...canonical.acquisition,
    acquireNamed: async (request: unknown, metricId: string) => {
      const result = await canonical.acquisition.acquireNamed(request, metricId)
      return metricId === canonical.pointMetricId ? { ...result, sources: [deniedSource] } : result
    },
  }
  const factory: IndustryDataResolverFactory = (context) => createIndustryDataResolver({ catalog: canonical.catalog, policies: INDUSTRY_DATA_SOURCE_POLICIES, operations: {
    'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', fixturePlugin()),
    'industry.metric.nbs.room-air-conditioner-production': createIndustryMetricOperation(acquisition),
    'industry.metric.cheaa.air-conditioner-export-volume': createIndustryMetricOperation(acquisition),
  } }, context)
  const f = await fixture({ industryDataResolverFactory: factory })
  try {
    const result = await f.service.startIndustryResearch({ workflowRunId: 'industry-rights-denied-metric', name: '家用空调', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.equal(result.operatingObservations.some((item) => item.metricId === canonical.pointMetricId), false)
    assert.ok(result.dataRequirementGaps.some((gap) => gap.endsWith(':RIGHTS_REJECTED')))
    const sources = (await readCanonicalV04Assets(f.root)).objects.map((item) => item.value as { id: string; canonicalUrl?: string }).filter((item) => item.id.startsWith('source:'))
    assert.equal(sources.some((item) => item.canonicalUrl === canonical.productionSource.canonicalUrl), false)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})
