import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { runIndustryDeepResearch } from '../../workflows/industry-deep-research/index.ts'
import { INDUSTRY_MODULES } from '../../skills/industry-research/index.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { getCanonicalResearchSkill } from '../../app/services/research-skill-catalog.ts'
import { createIndustryWorkflowResolverFixture } from '../support/industry-workflow-resolver-fixture.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const evidencePath = join(repoRoot, 'tests/validation/evidence/RHL_M3B_INDUSTRY_SECOND_TARGET_GENERALITY.json')
const target = { name: 'AI Server Hardware', aliases: ['AI Server'], searchTerms: ['AI Server Hardware', 'AI server', 'data center server'] }
const content = 'AI Server Hardware industry definition, market demand, supply capacity and utilization, pricing, industry chain, competitive landscape, technology roadmap, company mapping, catalysts, risks, and key metrics for public research.'
const source = { candidate: { candidateId: 'fixture-ai-server-evidence', kind: 'official_disclosure' as const, tier: 1 as const, title: 'AI Server Hardware industry overview', provider: 'fixture', publishedAt: '2026-09-14T00:00:00.000Z', metadata: { target: target.name } }, retrievedAt: '2026-09-15T00:00:00.000Z', title: 'AI Server Hardware industry overview', content, contentHash: sha256(content), publisher: 'Fixture Official', rawBytes: new TextEncoder().encode(content), rights: { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }

function executor(includeCompanyMapping = true): ReasoningExecutor {
  return { capabilities: () => ({ maxContextTokens: 20_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 8 }), execute: async (request) => {
    const input = request.input as Record<string, any>
    if (request.operation === 'industry_research_design') return { operation: request.operation, output: { definitionHypothesis: `${target.name} bounded industry scope`, targetKind: 'industry', scope: { included: [target.name, 'public listed-company exposure'], excluded: ['unrelated server software'] }, moduleQuestions: Object.fromEntries(INDUSTRY_MODULES.map((module) => [module, `Assess ${module} for ${target.name}.`])), keyMetrics: ['server shipments', 'capacity utilization'], evidenceRequirements: ['official public evidence'], searchTerms: target.searchTerms, knownGaps: [], verificationCandidates: [] } }
    if (request.operation === 'industry_module_analysis') {
      const evidenceIds = (input.evidence ?? []).map((item: { evidenceId: string }) => item.evidenceId)
      const proposals = includeCompanyMapping && input.module === 'company_mapping' ? [
        { proposalId: 'ai-server-company', kind: 'entity', subjectKey: 'ai-server-company', entityType: 'company', entityName: 'Aurora Compute Systems' },
        { proposalId: 'ai-server-product', kind: 'entity', subjectKey: 'ai-server-product', entityType: 'product', entityName: 'Aurora AI Server Platform' },
        { proposalId: 'ai-server-offers', kind: 'relation', subjectKey: 'ai-server-company', targetKey: 'ai-server-product', relationType: 'offers_product', sourceCandidateIds: evidenceIds },
        { proposalId: 'ai-server-claim', kind: 'claim', subjectKey: 'ai-server-company', claimType: 'fact', statement: 'Aurora Compute Systems participates in AI Server Hardware.', sourceCandidateIds: evidenceIds },
      ] : []
      return { operation: request.operation, output: { module: input.module, status: 'supported', analysis: `Bounded ${input.module} analysis for ${target.name}.`, evidenceIds, proposals, gaps: [], reportMaterial: { markdown: `Evidence-backed ${input.module} material for ${target.name}.`, evidenceIds, proposalIds: proposals.map((proposal: { proposalId: string }) => proposal.proposalId), relationProposalIds: proposals.filter((proposal: { kind: string }) => proposal.kind === 'relation').map((proposal: { proposalId: string }) => proposal.proposalId) } } }
    }
    const evidenceIds = (input.evidence ?? []).map((item: { evidenceId: string }) => item.evidenceId)
    return { operation: request.operation, output: { executiveView: `${target.name} bounded executive view.`, analysis: `Cross-module synthesis for ${target.name}.`, evidenceIds, proposals: [], gaps: [], alternativeViews: ['Public evidence remains bounded to the supplied target.'], reportMaterial: { markdown: `Evidence-backed synthesis for ${target.name}.`, evidenceIds, proposalIds: [] } } }
  } }
}

const input = (reports: string, canonicalRef?: string, workflowRunId = 'industry-second-target-generality', includeCompanyMapping = true) => { const now = () => '2026-09-15T01:00:00.000Z'; return { workflowRunId, handle: undefined as never, target: canonicalRef ? { ...target, canonicalRef } : target, reportRoot: reports, reasoningExecutor: executor(includeCompanyMapping), dataResolverFactory: createIndustryWorkflowResolverFixture(async () => [source], now), skillDataRequirements: getCanonicalResearchSkill('industry_supply_demand_cycle')!.dataRequirements, now, maxSources: 2, maxEvidencePerModule: 2 } }

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-industry-second-target-'))
  const reports = await mkdtemp(join(tmpdir(), 'rhl-industry-second-target-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-second-target', now: '2026-09-15T00:00:00.000Z' })
    const registry = new KnowledgeBaseRegistry()
    const first = await runIndustryDeepResearch({ ...input(reports), handle: await registry.mount(root) })
    if (first.status !== 'completed') throw new Error(JSON.stringify({ status: first.status, errors: first.errors, intents: first.resolutionIntents, diagnostics: first.diagnostics, moduleStatuses: first.modules.map((module) => ({ module: module.module, status: module.status, evidenceIds: module.evidenceIds })) }))
    assert.equal(first.design?.targetKind, 'industry')
    assert.equal(first.design?.definitionHypothesis, 'AI Server Hardware bounded industry scope')
    assert.equal(first.modules.length, 8)
    assert.equal(first.moduleCallCounts.industry_definition, 1)
    assert.equal(first.acquisitionWaves, 1)
    assert.equal(first.gatewaySubmitCount, 1)
    assert.ok(first.report)
    assert.ok(first.entityRefs['industry'])
    assert.ok(first.entityRefs['ai-server-company'])
    assert.ok(first.relationRefs['ai-server-offers'])
    assert.ok(first.claimRefs['ai-server-claim'])
    const beforeReplay = await readCanonicalV04Assets(root)
    const replay = await runIndustryDeepResearch({ ...input(reports, first.entityRefs.industry, 'industry-second-target-generality-replay', false), handle: await registry.refresh(root) })
    assert.equal(replay.status, 'completed', replay.errors.join('; '))
    assert.equal(replay.knowledgeBaseRevision, first.knowledgeBaseRevision)
    assert.equal(replay.entityRefs.industry, first.entityRefs.industry)
    assert.deepEqual(replay.sourceRefs, first.sourceRefs)
    assert.deepEqual(replay.relationRefs, {})
    assert.deepEqual(replay.claimRefs, {})
    const afterReplay = await readCanonicalV04Assets(root)
    assert.equal(afterReplay.objects.length, beforeReplay.objects.length)
    const evidence = { generatedAt: new Date().toISOString(), taskId: 'RHL-PERSONAL-RESEARCH-V1-INDUSTRY-SECOND-TARGET-GENERALITY', classification: 'SECOND_TARGET_GENERALITY_PASS', realPiReasoningExecutor: false, target: { name: target.name, aliases: target.aliases, searchTerms: target.searchTerms }, firstRun: { status: first.status, targetKind: first.design?.targetKind, moduleCount: first.modules.length, acquisitionWaves: first.acquisitionWaves, gatewaySubmitCount: first.gatewaySubmitCount, knowledgeBaseRevision: first.knowledgeBaseRevision, reportPersisted: Boolean(first.report), canonicalEntityRefs: first.entityRefs, canonicalRelationRefs: first.relationRefs, canonicalClaimRefs: first.claimRefs, canonicalSourceRefs: first.sourceRefs }, replay: { status: replay.status, knowledgeBaseRevision: replay.knowledgeBaseRevision, gatewaySubmitCount: replay.gatewaySubmitCount, canonicalObjectCountStable: afterReplay.objects.length === beforeReplay.objects.length, industryRootStable: replay.entityRefs.industry === first.entityRefs.industry, sourceRefsStable: JSON.stringify(replay.sourceRefs) === JSON.stringify(first.sourceRefs), noNewSemanticProposals: Object.keys(replay.relationRefs).length === 0 && Object.keys(replay.claimRefs).length === 0 }, secretsIncluded: false, rawBodiesIncluded: false }
    await mkdir(resolve(repoRoot, 'tests/validation/evidence'), { recursive: true }); await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(evidence, null, 2))
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
}

void main().catch(async (error) => { const evidence = { generatedAt: new Date().toISOString(), taskId: 'RHL-PERSONAL-RESEARCH-V1-INDUSTRY-SECOND-TARGET-GENERALITY', classification: 'SECOND_TARGET_GENERALITY_FAILED', realPiReasoningExecutor: false, error: error instanceof Error ? error.message : String(error), secretsIncluded: false, rawBodiesIncluded: false }; await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.error(JSON.stringify(evidence, null, 2)); process.exitCode = 1 })
