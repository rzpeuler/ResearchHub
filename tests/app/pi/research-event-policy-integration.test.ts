import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResearchHubTools } from '../../../app/pi/tools.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { sha256 } from '../../../plugins/research-acquisition/hash.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchFetchedSource, ResearchSourceCandidate } from '../../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'
import { type EventEvidenceAssessmentOutput } from '../../../skills/event-research/contracts.ts'

const AS_OF = '2026-09-09T00:00:00.000Z'
const RIGHTS = { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false }

async function snapshotTree(root: string): Promise<readonly string[]> {
  const entries: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) { entries.push(`dir:${absolute.slice(root.length)}`); await visit(absolute) }
      else if (entry.isFile()) entries.push(`file:${absolute.slice(root.length)}:${createHash('sha256').update(await readFile(absolute)).digest('hex')}`)
    }
  }
  await visit(root)
  return entries.sort()
}

function candidate(candidateId: string, provider: 'cninfo' | 'gdelt', publishedAt: string): ResearchSourceCandidate {
  return { candidateId, kind: provider === 'cninfo' ? 'official_disclosure' : 'news', tier: provider === 'cninfo' ? 1 : 3, title: `${provider} event ${candidateId}`, url: `https://example.test/${provider}/${candidateId}`, provider, publishedAt, metadata: { companySymbol: '600519' } }
}

function plugin(name: string, candidates: readonly ResearchSourceCandidate[]): ResearchAcquisitionPlugin {
  return {
    name,
    async discover() { return candidates },
    async fetch(item): Promise<ResearchFetchedSource> { const content = `Verified event evidence for ${item.candidateId}.`; return { candidate: item, retrievedAt: AS_OF, content, contentHash: sha256(content), rawBytes: new TextEncoder().encode(content) } },
    async normalize(fetched): Promise<NormalizedResearchSource> { return { candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: RIGHTS } },
  }
}

class EventExecutor implements ReasoningExecutor {
  capabilities() { return { maxContextTokens: 32_000, maxOutputTokens: 4_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    const output = request.operation === 'event_evidence_assessment'
      ? { sourceAssessments: ['event-cninfo', 'event-gdelt'].map((sourceCandidateId, index) => ({ sourceCandidateId, verdict: 'supports', confidence: index === 0 ? 0.95 : 0.85, rationale: 'The source supports the bounded event.', evidenceRequirement: index === 0 ? 'primary' : 'corroborated' })), verifiedFacts: [{ factId: 'event-fact', statement: 'The selected event occurred.', sourceCandidateIds: ['event-cninfo', 'event-gdelt'], confidence: 0.9, evidenceRequirement: 'corroborated' }], contradictions: [] } satisfies EventEvidenceAssessmentOutput
      : { interpretations: [{ interpretationId: 'impact-interpretation', sectionId: 'first-order-impact', markdown: 'A verified event creates a bounded monitoring risk.', sourceCandidateIds: ['event-cninfo'], existingKnowledgeRefs: [], assessmentRefs: ['impact-1'] }], assessments: [{ assessmentId: 'impact-1', impactType: 'direct', basis: 'verified_fact', direction: 'negative', materiality: 'medium', timeHorizon: 'near_term', existingKnowledgeRefs: [], sourceCandidateIds: ['event-cninfo'], rationale: 'The verified event creates a monitoring risk.', causalChain: 'event -> operating impact' }], proposals: [{ proposalId: 'event-risk-claim', kind: 'claim', claimType: 'risk', subjectKey: 'company', statement: 'The event creates a company-specific monitoring risk.', sourceCandidateIds: ['event-cninfo'], existingKnowledgeRefs: [], assessmentRefs: ['impact-1'] }] }
    return { operation: request.operation, output }
  }
}

test('Pi research_event passes read-only policy through ResearchService to the real Event Gateway without changing existing Canonical Knowledge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-pi-event-policy-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-pi-event-policy-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-pi-event-policy', now: AS_OF })
    const registry = new KnowledgeBaseRegistry()
    const seed = await new KnowledgeProductionGateway(registry).submit({ handle: await registry.mount(root), producerType: 'fixture_identity', producerRunId: 'event-policy-existing-company', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SSE' } }, proposals: [], evidenceBindings: [], asOf: AS_OF, now: () => AS_OF })
    assert.equal(seed.status, 'committed')
    const cninfo = plugin('official-cninfo', [candidate('event-cninfo', 'cninfo', '2026-09-08T02:00:00.000Z')])
    const gdelt = plugin('gdelt-news', [candidate('event-gdelt', 'gdelt', '2026-09-08T03:00:00.000Z')])
    const workflowService = new WorkflowService()
    const researchService = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [cninfo, gdelt], researchEvidenceProviders: { cninfo, gdelt }, workflowService, reasoningExecutor: new EventExecutor() })
    const calls: Array<Record<string, unknown>> = []
    const startEventResearch = researchService.startEventResearch.bind(researchService)
    researchService.startEventResearch = ((input, signal) => { calls.push(input as unknown as Record<string, unknown>); return startEventResearch(input, signal) }) as typeof researchService.startEventResearch
    const policyContext = { current: { structuredKnowledge: true, sourceLibrary: true, writeKnowledge: false } }
    const tools = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService: {} as never, workflowService, researchService, policyContext })
    const before = await snapshotTree(root)
    const beforeHash = createHash('sha256').update(JSON.stringify(before)).digest('hex')
    const tool = tools.find((item) => item.name === 'research_event')
    assert.ok(tool)
    const response = await tool.execute('pi-event-policy-call', { workflowRunId: 'pi-event-policy-run', symbol: '600519', name: 'Fixture Company', exchange: 'SSE', asOf: AS_OF, anchor: { kind: 'user_event', title: 'Fixture event', description: 'A verified bounded event.', eventDate: '2026-09-08' }, writeKnowledge: true }, undefined, undefined, {} as never)
    const result = JSON.parse(response.content[0]!.type === 'text' ? response.content[0]!.text : '{}') as { status: string; proposalCount?: number; committedIds?: string[]; telemetry?: Record<string, unknown>; reportId?: string }
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.writeKnowledge, false, 'explicit read-only ResearchRequest policy must override forged Pi tool input before ResearchService starts')
    assert.equal(calls[0]?.useStructuredKnowledge, true)
    assert.equal(result.status, 'completed')
    assert.ok((result.proposalCount ?? 0) > 0, 'the real Event Workflow must accept a valid Evidence-supported Proposal')
    assert.ok((result.telemetry?.acceptedProposalCount as number) > 0, 'the accepted Proposal must reach the actual KnowledgeProductionGateway dry-run boundary')
    assert.deepEqual(result.committedIds, [])
    assert.ok(result.reportId)
    assert.equal((await researchService.getResearchReport(result.reportId!)).workflowRunId, 'pi-event-policy-run')
    assert.deepEqual(await snapshotTree(root), before, 'read-only execution must preserve every file in the pre-existing Canonical Knowledge Base')
    assert.equal(createHash('sha256').update(JSON.stringify(await snapshotTree(root))).digest('hex'), beforeHash)
    const assets = await readCanonicalV04Assets(root)
    assert.ok(assets.objects.some((item) => item.kind === 'entity' && (item.value as { type?: string }).type === 'company'))
    assert.equal(assets.objects.filter((item) => item.kind === 'source' || item.kind === 'claim').length, 0, 'read-only Event Research must not persist newly acquired sources or claims')
    const evidenceDirectory = join(process.cwd(), 'tests', 'validation', 'evidence')
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(join(evidenceDirectory, 'RHL-EXEC-003-A-004-FIX-002-event-readonly.json'), `${JSON.stringify({ taskId: 'RHL-EXEC-003-A-004-FIX-002', generatedAt: new Date().toISOString(), execution: 'ResearchRequest writeKnowledge=false -> Pi research_event Tool -> real ResearchService -> Event Research Workflow -> actual KnowledgeProductionGateway dry-run', existingCanonicalCompany: 'entity:company-600519', researchRequestPolicy: policyContext.current, forgedToolWriteFlag: true, researchServiceInput: { writeKnowledge: calls[0]?.writeKnowledge, useStructuredKnowledge: calls[0]?.useStructuredKnowledge }, workflowRunId: 'pi-event-policy-run', status: result.status, proposalCount: result.proposalCount, acceptedProposalCount: result.telemetry?.acceptedProposalCount, gatewayCommittedIds: result.committedIds, beforeTreeSha256: beforeHash, afterTreeSha256: createHash('sha256').update(JSON.stringify(await snapshotTree(root))).digest('hex'), secretsIncluded: false }, null, 2)}\n`, 'utf8')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})
