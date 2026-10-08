import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { INDUSTRY_MODULES } from '../../../skills/industry-research/contracts.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'
import { runIndustryDeepResearch } from '../../../workflows/industry-deep-research/index.ts'
import { getCanonicalResearchSkill } from '../../../app/services/research-skill-catalog.ts'
import { createIndustryWorkflowResolverFixture } from '../../support/industry-workflow-resolver-fixture.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'

const source: NormalizedResearchSource = { candidate: { candidateId: 'resolver-fixture-source', kind: 'official_disclosure', tier: 1, title: 'Resolver fixture source', provider: 'fixture', publishedAt: '2026-09-01T00:00:00.000Z' }, retrievedAt: '2026-09-02T00:00:00.000Z', title: 'Resolver fixture source', content: 'Official industry definition and operating evidence.', contentHash: sha256('Official industry definition and operating evidence.'), publisher: 'Fixture official source', canonicalUrl: 'https://fixture.test/industry', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
const design = { definitionHypothesis: 'household air conditioner industry', targetKind: 'industry' as const, scope: { included: ['fixture'], excluded: [] }, moduleQuestions: Object.fromEntries(INDUSTRY_MODULES.map((module) => [module, module])), keyMetrics: ['production'], evidenceRequirements: ['official'], searchTerms: ['fixture'], knownGaps: [], verificationCandidates: [] }
function executor(seen: Array<{ module: string; observations: unknown[] }>): ReasoningExecutor { return { capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 10000, structuredOutputSupport: true, maxConcurrency: 8 }), execute: async (request) => { const operation = String(request.operation); if (operation === 'industry_research_design') return { operation: request.operation, output: design }; if (operation === 'industry_module_analysis') { const input = request.input as { module: string; evidence: Array<{ evidenceId: string }>; operatingObservations?: unknown[] }; seen.push({ module: input.module, observations: input.operatingObservations ?? [] }); const ids = input.evidence.map((item) => item.evidenceId); return { operation: request.operation, output: { module: input.module, status: 'supported', analysis: 'fixture', evidenceIds: ids, proposals: [], gaps: [], reportMaterial: { markdown: 'fixture', evidenceIds: ids, proposalIds: [] } } } } const input = request.input as { evidence: Array<{ evidenceId: string }> }; const ids = input.evidence.map((item) => item.evidenceId); return { operation: request.operation, output: { executiveView: 'fixture', analysis: 'fixture', evidenceIds: ids, proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: 'fixture', evidenceIds: ids, proposalIds: [] } } } } } }

test('Industry Workflow materializes DOMAIN requirements and reports missing canonical metrics as partial gaps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-industry-domain-resolution-')); const reports = await mkdtemp(join(tmpdir(), 'rhl-industry-domain-resolution-reports-')); const seen: Array<{ module: string; observations: unknown[] }> = []
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-domain-resolution', now: '2026-09-01T00:00:00.000Z' })
    const now = () => '2026-09-23T00:00:00.000Z'
    const result = await runIndustryDeepResearch({ workflowRunId: 'industry-domain-resolution', handle: await new KnowledgeBaseRegistry().mount(root), target: { name: '家用空调' }, reportRoot: reports, reasoningExecutor: executor(seen), dataResolverFactory: createIndustryWorkflowResolverFixture(async () => [source], now), skillDataRequirements: getCanonicalResearchSkill('industry_supply_demand_cycle')!.dataRequirements, asOf: '2026-09-23', now, writeKnowledge: false })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.equal(result.requirementCoverage, 'PARTIAL')
    assert.ok(result.dataRequirementGaps.some((gap) => gap.startsWith('production-output-evidence:NO_CANONICAL_INDUSTRY_METRIC')))
    assert.ok(result.dataRequirementGaps.some((gap) => gap.startsWith('capacity-evidence:NO_CANONICAL_INDUSTRY_METRIC')))
    assert.deepEqual(result.operatingObservations, [])
    assert.ok(result.acquisitionWaves >= 1)
    assert.equal(seen.find((item) => item.module === 'market_size_growth')?.observations.length, 0)
    assert.equal(seen.find((item) => item.module === 'supply_demand_analysis')?.observations.length, 0)
    assert.equal(seen.find((item) => item.module === 'technology_evolution')?.observations.length, 0)
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})

test('Unregistered Industry identity keeps generic evidence resolution available and surfaces the identity gap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-industry-unregistered-')); const reports = await mkdtemp(join(tmpdir(), 'rhl-industry-unregistered-reports-')); const seen: Array<{ module: string; observations: unknown[] }> = []
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-unregistered', now: '2026-09-01T00:00:00.000Z' })
    const now = () => '2026-09-23T00:00:00.000Z'
    const result = await runIndustryDeepResearch({ workflowRunId: 'industry-unregistered', handle: await new KnowledgeBaseRegistry().mount(root), target: { name: 'Unregistered Specialty Industry' }, reportRoot: reports, reasoningExecutor: executor(seen), dataResolverFactory: createIndustryWorkflowResolverFixture(async () => [source], now), skillDataRequirements: getCanonicalResearchSkill('industry_supply_demand_cycle')!.dataRequirements, asOf: '2026-09-23', now, writeKnowledge: false })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.equal(result.evidence.length, 1)
    assert.ok(result.diagnostics.some((item) => item.startsWith('INDUSTRY_IDENTITY_UNRESOLVED:')))
    assert.ok(result.dataRequirementGaps.some((item) => item.endsWith(':INDUSTRY_ID_REQUIRED')))
    assert.equal(result.requirementCoverage, 'PARTIAL')
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})
