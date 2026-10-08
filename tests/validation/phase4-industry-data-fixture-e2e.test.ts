import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { ResearchService } from '../../app/services/research-service.ts'
import { WorkflowService } from '../../app/services/workflow-service.ts'
import { createIndustryDataResolver } from '../../app/services/industry-data-resolver.ts'
import { createIndustryDataCatalog } from '../../data/industry-catalog.ts'
import { INDUSTRY_RESEARCH_EVIDENCE_POLICY } from '../../data/industry-policies.ts'
import type { IndustryDataResolverFactory } from '../../workflows/industry-deep-research/contracts.ts'
import { createIndustryEvidenceOperation } from '../../plugins/research-acquisition/industry-data-operations.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import { INDUSTRY_MODULES } from '../../skills/industry-research/contracts.ts'

const asOf = '2026-10-01T00:00:00.000Z'
const publishedAt = '2026-09-20T10:00:00.000Z'
const content = 'Official source states that the fixture industry includes household appliance production.'
const url = 'https://fixture.test/industry/report/2026-09'
const candidate: ResearchSourceCandidate = { candidateId: 'fixture-industry-report', kind: 'official_disclosure', tier: 1, title: 'Fixture Industry Report', provider: 'fixture-official', url, publishedAt }
const source: NormalizedResearchSource = { candidate, canonicalUrl: url, retrievedAt: '2026-10-01T01:00:00.000Z', title: candidate.title, content, contentHash: sha256(content), publisher: 'Fixture Official Publisher', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }

class FixturePlugin implements ResearchAcquisitionPlugin {
  readonly name = 'fixture-official'
  async discover(): Promise<readonly ResearchSourceCandidate[]> { return [candidate] }
  async fetch(value: ResearchSourceCandidate): Promise<ResearchFetchedSource> { return { candidate: value, retrievedAt: source.retrievedAt, content, rawBytes: new TextEncoder().encode(content), contentHash: source.contentHash } }
  async normalize(): Promise<NormalizedResearchSource> { return source }
}

class FixtureReasoning implements ReasoningExecutor {
  readonly calls: ReasoningRequest[] = []
  capabilities(): ReasoningCapabilities { return { maxContextTokens: 20_000, maxOutputTokens: 8_000, structuredOutputSupport: true, maxConcurrency: 2 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    this.calls.push(structuredClone(request))
    if (request.operation === 'industry_research_design') return { operation: request.operation, output: { definitionHypothesis: 'Fixture Industry', targetKind: 'industry', scope: { included: ['fixture production'], excluded: [] }, moduleQuestions: Object.fromEntries(INDUSTRY_MODULES.map((module) => [module, `Analyze ${module}.`])), keyMetrics: ['production'], evidenceRequirements: ['official evidence'], searchTerms: ['fixture'], knownGaps: [], verificationCandidates: [] } }
    const input = request.input as { module?: string; evidence?: readonly { evidenceId: string }[] }
    const evidenceIds = input.evidence?.map((item) => item.evidenceId) ?? []
    if (request.operation === 'industry_module_analysis') return { operation: request.operation, output: { module: input.module, status: 'supported', analysis: 'Evidence was supplied through the production resolver path.', evidenceIds, proposals: [], gaps: [], reportMaterial: { markdown: 'Evidence-backed fixture analysis.', evidenceIds, proposalIds: [] } } }
    return { operation: request.operation, output: { executiveView: 'Fixture industry view.', analysis: 'Evidence-backed fixture synthesis.', evidenceIds, proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: 'Fixture synthesis.', evidenceIds, proposalIds: [] } } }
  }
}

test('Industry Data Layer fixture E2E preserves source provenance and PIT through Application and Workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-phase4-industry-e2e-'))
  const reports = await mkdtemp(join(tmpdir(), 'rhl-phase4-industry-e2e-reports-'))
  const executor = new FixtureReasoning()
  const plugin = new FixturePlugin()
  const resolverFactory: IndustryDataResolverFactory = (context) => createIndustryDataResolver({
    catalog: createIndustryDataCatalog(),
    policies: [{ ...INDUSTRY_RESEARCH_EVIDENCE_POLICY, candidates: [INDUSTRY_RESEARCH_EVIDENCE_POLICY.candidates[0]!] }],
    operations: { 'industry.evidence.miit': createIndustryEvidenceOperation('industry.evidence.miit', plugin) },
  }, context)
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-phase4-industry-e2e', now: asOf })
    const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, workflowService: new WorkflowService(), reasoningExecutor: executor, acquisitionPlugins: [plugin], industryDataResolverFactory: resolverFactory })
    const result = await service.startIndustryResearch({ workflowRunId: 'phase4-industry-e2e', name: 'Fixture Industry', asOf, maxSources: 4 }).completion
    assert.equal(result.status, 'completed', result.errorSummary)
    assert.equal(result.requirementCoverage, 'PARTIAL')
    assert.ok(result.dataRequirementGaps.some((gap) => gap.endsWith(':INDUSTRY_ID_REQUIRED')))
    const moduleInputs = executor.calls.filter((call) => call.operation === 'industry_module_analysis').map((call) => call.input as { evidence: readonly { title: string; publisher: string; provider: string; publishedAt?: string }[] })
    assert.ok(moduleInputs.some((input) => input.evidence.some((item) => item.title === source.title && item.publisher === source.publisher && item.provider === source.candidate.provider && item.publishedAt === publishedAt)))
    const report = JSON.parse(await readFile(join(reports, `${result.reportPath!}.json`), 'utf8')) as { sourceRefs?: readonly string[]; sections: readonly { sourceRefs: readonly string[] }[] }
    const reportSourceRefs = [...new Set((report.sections ?? []).flatMap((section) => section.sourceRefs).concat(report.sourceRefs ?? []))]
    const assets = await readCanonicalV04Assets(root)
    const persisted = assets.objects.map((item) => item.value as { id: string; publisher?: string; publishedAt?: string | null; canonicalUrl?: string | null; rawRefs?: readonly string[]; rights?: { accessScope?: string; providerTermsKnown?: boolean; retentionAllowed?: boolean; aiProcessingAllowed?: boolean; derivativeKnowledgeAllowed?: boolean; redistributionAllowed?: boolean } }).find((item) => item.canonicalUrl === url)
    assert.ok(persisted)
    assert.ok(reportSourceRefs.includes(persisted.id))
    assert.equal(persisted.publisher, 'Fixture Official Publisher')
    assert.equal(persisted.publishedAt, publishedAt)
    assert.equal(persisted.canonicalUrl, url)
    assert.ok((persisted.rawRefs?.length ?? 0) > 0)
    assert.deepEqual(persisted.rights, { accessScope: 'public', providerTermsKnown: false, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})
