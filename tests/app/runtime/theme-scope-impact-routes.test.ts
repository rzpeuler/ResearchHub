import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-theme-scope-impact-route-'))
  const cwd = join(root, 'cwd'); const workspace = join(root, 'workspace'); const agentDir = join(root, 'agent'); const kb = join(root, 'kb')
  await mkdir(cwd); await mkdir(workspace); await mkdir(agentDir)
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: `kb-scope-impact-route-${Date.now()}` })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `scope-impact-http-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const calls: unknown[] = []
  const receiptKey = 'a'.repeat(64)
  const proposalId = `theme-scope-impact:${'b'.repeat(40)}`
  const proposal = { proposalId, themeRef: 'entity:theme-ai', candidate: { kind: 'industry', name: 'PCB' }, candidateFingerprint: `sha256:${'b'.repeat(64)}`, changeKind: 'new_theme_node', rationale: 'New evidence identifies PCB as a direct upstream node.', evidenceRefs: ['source:annual-report'], changedRefs: ['entity:pcb'], basedOnRevision: 4, status: 'pending' }
  const record = { receiptKey, knowledgeBaseId: 'kb-safe', baseRevision: 3, committedRevision: 4, status: 'ready', proposals: [proposal], diagnostics: [] }
  const impactService = {
    async list(input: unknown) { calls.push(['list', input]); return { items: [record], total: 1, truncated: false } },
    async get(key: string) { calls.push(['get', key]); return record },
    async decideBatch(input: unknown) { calls.push(['decideBatch', input]); return { ...record, proposals: [{ ...proposal, status: 'accepted', decision: 'include' }] } },
    async reject(key: string, id: string) { calls.push(['reject', key, id]); return { ...proposal, status: 'rejected', decision: 'dismiss' } },
  }
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: { capabilities: () => ({ maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute(request) { return { operation: request.operation, output: {} } } } })
  Object.defineProperty(runtime.services, 'themeScopeImpactService', { value: impactService, configurable: true })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  return { root, runtime, server, modelRuntime, origin: server.address!.origin, token: server.address!.runtimeToken, calls, receiptKey, proposalId }
}

test('Theme scope impact inbox and decisions require runtime token and only accept persisted proposal identity', async () => {
  const f = await fixture()
  try {
    const headers = { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }
    const unauthenticated = await fetch(`${f.origin}/api/theme-scope-impact?limit=10`, { headers: { origin: f.origin } })
    assert.equal(unauthenticated.status, 401)
    const invalidLimit = await fetch(`${f.origin}/api/theme-scope-impact?limit=101`, { headers })
    assert.equal(invalidLimit.status, 400)

    const listed = await fetch(`${f.origin}/api/theme-scope-impact?limit=10`, { headers })
    assert.equal(listed.status, 200)
    assert.equal((await listed.json() as { items: readonly unknown[] }).items.length, 1)
    assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'list'), ['list', { limit: 10 }])

    const detailPath = `${f.origin}/api/theme-scope-impact/records/${f.receiptKey}`
    assert.equal((await fetch(detailPath, { headers: { origin: f.origin } })).status, 401)
    const detail = await fetch(detailPath, { headers })
    assert.equal(detail.status, 200)
    assert.equal(JSON.stringify(await detail.json()).includes('rawRef'), false)

    const batchPath = `${f.origin}/api/theme-scope-impact/records/${f.receiptKey}/decisions`
    const injectedEvidence = await fetch(batchPath, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'scope-test-1', decisions: [{ proposalId: f.proposalId, decision: 'include', evidenceRefs: ['source:forged'] }] }) })
    assert.equal(injectedEvidence.status, 400)
    assert.equal(f.calls.some((call) => Array.isArray(call) && call[0] === 'decideBatch'), false)

    const accepted = await fetch(batchPath, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'scope-test-1', decisions: [{ proposalId: f.proposalId, decision: 'include', rationale: 'Confirmed by analyst' }] }) })
    assert.equal(accepted.status, 200)
    assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'decideBatch'), ['decideBatch', { receiptKey: f.receiptKey, workflowRunId: 'scope-test-1', decisions: [{ proposalId: f.proposalId, decision: 'include', rationale: 'Confirmed by analyst' }] }])

    const proposalPath = `${f.origin}/api/theme-scope-impact/records/${f.receiptKey}/proposals/${encodeURIComponent(f.proposalId)}`
    const dismissed = await fetch(`${proposalPath}/dismiss`, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'scope-test-2' }) })
    assert.equal(dismissed.status, 200)
    assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'reject'), ['reject', f.receiptKey, f.proposalId])
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }
})
