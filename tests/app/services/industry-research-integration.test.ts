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
import { createIndustryOperatingObservation } from '../../../plugins/research-acquisition/industry-operating-observations.ts'
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
        { proposalId: 'company', kind: 'entity' as const, subjectKey: 'company', entityType: 'company' as const, entityName: 'Fixture PCB Company' },
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

async function fixture(options: { readonly executor?: IndustryExecutor; readonly plugins?: readonly ResearchAcquisitionPlugin[]; readonly impactChecker?: ThemeScopeImpactChecker } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rhl-app-industry-'))
  const reports = await mkdtemp(join(tmpdir(), 'rhl-app-industry-reports-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-app-industry', now: '2026-09-08T00:00:00.000Z' })
  const workflowService = new WorkflowService()
  const executor = options.executor ?? new IndustryExecutor()
  const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, workflowService, reasoningExecutor: executor, acquisitionPlugins: options.plugins ?? [fixturePlugin()], ...(options.impactChecker === undefined ? {} : { themeScopeImpactChecker: options.impactChecker }) })
  return { root, reports, workflowService, service, executor }
}

test('Application Industry research projects canonical graph and replays semantic objects without duplication', async () => {
  const f = await fixture()
  try {
    const first = await f.service.startIndustryResearch({ workflowRunId: 'industry-app-first', name: 'Fixture PCB Industry', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(first.status, 'completed')
    assert.match(first.reportPath ?? '', /^[A-Za-z0-9._-]+\.md$/)
    assert.equal(first.providerOutcomes.length, 1); assert.ok(first.providerOutcomes[0])
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
    assert.equal(result.status, 'completed')
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
    assert.equal(result.status, 'completed'); assert.ok(result.providerOutcomes[0])
    const outcome = result.providerOutcomes[0] as { usableSourceCount: number; providerSucceeded: boolean; providerAttempted: boolean }
    assert.equal(outcome.providerAttempted, true); assert.equal(outcome.providerSucceeded, true); assert.equal(outcome.usableSourceCount, 2); assert.deepEqual(observedSearchTerms, [['base-search-term'], ['capacity-gap', 'base-search-term']]); assert.ok(result.acquisitionDiagnostics.length <= 32)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})

test('Application Service normal Industry path accepts a fake D4 port without network access', async () => {
  let d4Calls = 0
  const d4Source = source('fixture-d4')
  const observation = createIndustryOperatingObservation({ metricKey: 'fixture.metric', observationClass: 'PRODUCTION', value: 42, qualifier: 'EXACT', unit: 'units', originalValue: 42, originalUnit: 'units', periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2025-12-31T23:59:59.999Z', frequency: 'ANNUAL', aggregation: 'PERIOD', geography: 'China national', productOrSegment: 'Fixture PCB', publishedAt: '2026-01-01T00:00:00.000Z', retrievedAt: '2026-01-02T00:00:00.000Z', originPublisher: 'Fixture Official', hostPlatform: 'Fixture', retrievalProvider: 'Fixture D4', sourceAuthority: 'S1_OFFICIAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', sourceCandidateId: 'fixture-d4', publicationPit: 'VERIFIED', valueVersionPit: 'UNVERIFIED', metadata: {} })
  const f = await fixture()
  try {
    const service = new ResearchService({ mountedKnowledgeBaseRoot: f.root, reportRoot: f.reports, workflowService: f.workflowService, reasoningExecutor: f.executor, acquisitionPlugins: [fixturePlugin()], industryOperatingObservationAcquisition: { acquire: async () => { d4Calls++; return { status: 'COMPLETED', observations: [observation], sources: [d4Source], diagnostics: [] } } } })
    const result = await service.startIndustryResearch({ workflowRunId: 'industry-app-d4-port', name: 'Fixture PCB Industry', maxSources: 4, maxEvidencePerModule: 2 }).completion
    assert.equal(result.status, 'completed'); assert.equal(d4Calls, 1); assert.equal(result.operatingObservationStatus, 'COMPLETED'); assert.equal(result.operatingObservations.length, 1); assert.match(result.operatingObservations[0]?.sourceRef ?? '', /^source:/)
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.reports, { recursive: true, force: true }) }
})
