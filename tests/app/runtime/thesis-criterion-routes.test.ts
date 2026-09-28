import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { createResearchHubTools } from '../../../app/pi/tools.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

const NOW = '2026-09-28T12:00:00.000Z'
const definition = { metricRef: 'metric:revenue_growth', operator: 'lt', threshold: 0, unit: 'ratio', period: 'FY2027' }

class FixtureExecutor implements ReasoningExecutor {
  capabilities() { return { maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute() { return { operation: 'thesis_refresh', output: {} } as never }
}

async function seedCriterionTarget(kb: string) {
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-thesis-criterion-http', now: NOW })
  const gateway = new KnowledgeProductionGateway()
  const source: NormalizedResearchSource = {
    candidate: { candidateId: 'criterion-http-source', kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'fixture', publishedAt: NOW },
    retrievedAt: NOW, title: 'Annual report', content: 'Fixture source content.', contentHash: 'f'.repeat(64), publisher: 'Fixture Exchange',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
  const created = await gateway.submit({
    handle: await new KnowledgeBaseRegistry().mount(kb),
    producerType: 'criterion-http-fixture', producerRunId: 'criterion-http-seed',
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', semanticFields: { ticker: '600519', exchange: 'SSE' } },
    proposals: [
      { proposalId: 'claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Revenue grows steadily.', sourceCandidateIds: [source.candidate.candidateId] },
      { proposalId: 'thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', statement: 'The company has durable earnings growth.', thesisStatus: 'active' },
      { proposalId: 'membership', kind: 'reasoning_edge', sourceProposalId: 'claim', targetKey: 'thesis', edgeType: 'qualifies', sourceCandidateIds: [source.candidate.candidateId] },
    ],
    evidenceBindings: [{ localSourceId: source.candidate.candidateId, source }], asOf: NOW,
  })
  assert.equal(created.status, 'committed', created.errors.join('; '))
  return { thesisRef: created.thesisRefsByProposalId!.thesis!, claimRef: created.claimRefsByProposalId.claim! }
}

async function fixture(withKb = true) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-thesis-criterion-route-'))
  const kb = join(root, 'kb'); const cwd = join(root, 'cwd'); const workspace = join(root, 'workspace'); const agentDir = join(root, 'agent')
  await mkdir(cwd); await mkdir(workspace); await mkdir(agentDir)
  const target = withKb ? await seedCriterionTarget(kb) : undefined
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `thesis-criterion-http-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, ...(withKb ? { mountedKnowledgeBaseRoot: kb } : {}), workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  return { root, kb: withKb ? kb : undefined, target, runtime, server, modelRuntime, origin: server.address!.origin, token: server.address!.runtimeToken }
}

test('human criterion prepare is read-only and HTTP confirm commits and replays the exact preview', async () => {
  const f = await fixture()
  try {
    assert.ok(f.kb && f.target)
    const service = f.runtime.services.thesisCriterionService
    assert.ok(service)
    const piTools = createResearchHubTools({ ...f.runtime.services, mountedKnowledgeBaseRoot: f.kb } as never)
    assert.equal(piTools.some((tool) => /criterion/i.test(tool.name)), false)
    const headers = { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }
    const before = await readCanonicalV04Assets(f.kb)
    const request = { thesisRef: f.target.thesisRef, conditionId: 'revenue-floor', type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: [f.target.claimRef], origin: { kind: 'human_rule' } }
    const preparedResponse = await fetch(`${f.origin}/api/production/thesis-lifecycle/criteria/prepare`, { method: 'POST', headers, body: JSON.stringify(request) })
    assert.equal(preparedResponse.status, 200)
    const preview = await preparedResponse.json() as { previewHash: string; expectedKnowledgeBaseRevision: number; thesisRef: string; killCriteria?: unknown }
    assert.equal(preview.thesisRef, f.target.thesisRef)
    assert.ok(preview.previewHash)
    assert.deepEqual(await readCanonicalV04Assets(f.kb), before)

    const confirmation = { preview, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-http-confirm-1' }
    const confirmedResponse = await fetch(`${f.origin}/api/production/thesis-lifecycle/criteria/confirm`, { method: 'POST', headers, body: JSON.stringify(confirmation) })
    assert.equal(confirmedResponse.status, 200)
    const confirmed = await confirmedResponse.json() as { status: string; committedRevision: number; writerRunId: string }
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.writerRunId, confirmation.workflowRunId)
    const after = await readCanonicalV04Assets(f.kb)
    const thesis = after.objects.find((item) => item.kind === 'thesis' && item.value.id === f.target!.thesisRef)!.value as { killCriteria?: Array<{ conditionId: string; revision: number }> }
    assert.deepEqual(thesis.killCriteria?.map(({ conditionId, revision }) => [conditionId, revision]), [['revenue-floor', 1]])

    const replayResponse = await fetch(`${f.origin}/api/production/thesis-lifecycle/criteria/confirm`, { method: 'POST', headers, body: JSON.stringify(confirmation) })
    assert.equal(replayResponse.status, 200)
    assert.equal((await replayResponse.json() as { status: string }).status, 'replayed')
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }
})

test('criterion HTTP rejects extra or oversized fields and requires an active mounted v0.4 Knowledge Base', async () => {
  const f = await fixture()
  try {
    const headers = { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }
    const extra = await fetch(`${f.origin}/api/production/thesis-lifecycle/criteria/prepare`, { method: 'POST', headers, body: JSON.stringify({ thesisRef: 'thesis:missing', conditionId: 'criterion', definition, targetClaimRefs: ['claim:missing'], origin: { kind: 'human_rule' }, rawPath: 'C:\\private\\raw.txt' }) })
    assert.equal(extra.status, 400)
    const oversized = await fetch(`${f.origin}/api/production/thesis-lifecycle/criteria/prepare`, { method: 'POST', headers, body: JSON.stringify({ thesisRef: 'thesis:missing', conditionId: 'criterion', definition: { ...definition, metricRef: 'm'.repeat(257) }, targetClaimRefs: ['claim:missing'], origin: { kind: 'human_rule' } }) })
    assert.equal(oversized.status, 400)
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }

  const noKb = await fixture(false)
  try {
    assert.equal(noKb.runtime.services.thesisCriterionService, undefined)
    const response = await fetch(`${noKb.origin}/api/production/thesis-lifecycle/criteria/prepare`, { method: 'POST', headers: { origin: noKb.origin, 'x-researchhub-runtime-token': noKb.token, 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 503)
    assert.equal((await response.json() as { code: string }).code, 'no_kb_mounted')
  } finally { await noKb.server.close(); await noKb.runtime.close(); await Promise.resolve((noKb.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(noKb.root, { recursive: true, force: true }) }
})
