import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResearchHubTools } from '../../../app/pi/tools.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const NOW = '2026-09-24T00:00:00.000Z'
const AS_OF = '2026-09-23T00:00:00.000Z'

class ThesisExecutor implements ReasoningExecutor {
  readonly calls: ReasoningRequest[] = []
  constructor(private readonly evidenceRef: string) {}
  capabilities() { return { maxContextTokens: 8_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    this.calls.push(request)
    return { operation: request.operation, output: { summary: 'Durable earnings growth.', propositions: [{ propositionId: 'growth', statement: 'Capacity expansion supports durable growth.', propositionType: 'business_driver', basis: 'verified_evidence', timeHorizon: 'medium_term', sourceRefs: [this.evidenceRef] }] } }
  }
}

function source(): NormalizedResearchSource {
  return { candidate: { candidateId: 'thesis-policy-annual', kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'fixture', publishedAt: AS_OF }, retrievedAt: NOW, title: 'Annual report', content: 'Revenue and capacity details.', contentHash: 'a'.repeat(64), publisher: 'Fixture Exchange', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

test('authorized Pi create_thesis enters the real Thesis CREATE and Gateway/Writer path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-pi-thesis-policy-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-pi-thesis-policy-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-pi-thesis-policy', now: NOW })
    const registry = new KnowledgeBaseRegistry()
    const gateway = new KnowledgeProductionGateway(registry)
    const company = await gateway.submit({ handle: await registry.mount(root), producerType: 'fixture', producerRunId: 'thesis-policy-company', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Co', semanticFields: { ticker: '600519', exchange: 'SSE' } }, proposals: [], evidenceBindings: [], now: () => NOW })
    assert.equal(company.status, 'committed')
    const companyRef = company.entityRefsByLocalKey.company as `entity:${string}`
    const evidence = await gateway.submit({ handle: await registry.mount(root), producerType: 'fixture', producerRunId: 'thesis-policy-evidence', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Co', semanticFields: { ticker: '600519', exchange: 'SSE' }, existingEntityRef: companyRef }, proposals: [{ proposalId: 'capacity-claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Capacity expansion is underway.', sourceCandidateIds: ['thesis-policy-annual'], temporal: { asOf: AS_OF } }], evidenceBindings: [{ localSourceId: 'thesis-policy-annual', source: source() }], asOf: AS_OF, now: () => NOW })
    assert.equal(evidence.status, 'committed', JSON.stringify(evidence))
    const evidenceRef = evidence.claimRefsByProposalId['capacity-claim'] as `claim:${string}`
    const executor = new ThesisExecutor(evidenceRef)
    const workflowService = new WorkflowService()
    const researchService = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], workflowService, reasoningExecutor: executor })
    const policyContext = { current: { structuredKnowledge: true, sourceLibrary: false, writeKnowledge: true } }
    const tools = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService: {} as never, workflowService, researchService, policyContext })
    const createTool = tools.find((item) => item.name === 'create_thesis')
    assert.ok(createTool)
    const response = await createTool.execute('authorized-thesis-create', { workflowRunId: 'authorized-thesis-create', companyRef, thesisTitle: 'Durable growth', narrative: 'Capacity expansion supports sustained growth.', evidenceRefs: [evidenceRef], asOf: AS_OF }, undefined, undefined, {} as never)
    const result = JSON.parse(response.content[0]!.type === 'text' ? response.content[0]!.text : '{}') as { status: string; thesisRef?: string; committedRevision?: number; writerRunId?: string }
    assert.equal(result.status, 'completed')
    assert.ok(result.thesisRef)
    assert.equal(executor.calls.length, 1, 'authorized request must reach Thesis Formalize')
    const assets = await readCanonicalV04Assets(root)
    assert.ok(assets.objects.some((item) => item.kind === 'thesis' && item.value.id === result.thesisRef))
    assert.ok(assets.objects.some((item) => item.kind === 'claim' && item.value.id === evidenceRef))
    assert.ok(result.writerRunId)
    const evidenceDirectory = join(process.cwd(), 'tests', 'validation', 'evidence')
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(join(evidenceDirectory, 'RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json'), `${JSON.stringify({ taskId: 'RHL-EXEC-003-A-004-FIX-002', generatedAt: new Date().toISOString(), execution: 'authorized Pi create_thesis Tool -> real ResearchService -> Thesis Formalize -> KnowledgeProductionGateway -> Writer', policy: policyContext.current, workflowRunId: 'authorized-thesis-create', status: result.status, companyRef, evidenceRef, thesisRef: result.thesisRef, writerRunId: result.writerRunId, formalizeCallCount: executor.calls.length, committedRevision: result.committedRevision, secretsIncluded: false }, null, 2)}\n`, 'utf8')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})
