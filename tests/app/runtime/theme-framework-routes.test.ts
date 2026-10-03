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

async function fixture(withService = true, withKb = true) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-theme-framework-route-'))
  const cwd = join(root, 'cwd'); const workspace = join(root, 'workspace'); const agentDir = join(root, 'agent'); const kb = join(root, 'kb')
  await mkdir(cwd); await mkdir(workspace); await mkdir(agentDir)
  if (withKb) await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: `kb-theme-route-${Date.now()}` })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `theme-framework-http-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const calls: unknown[] = []
  const safeCandidate = { status: 'awaiting_review', workflowRunId: 'theme-route-run-1', candidate: { knowledgeBaseId: 'kb-safe', basedOnRevision: 0, theme: { name: 'AI 算力' }, framework: { industryCandidates: [], relationCandidates: [] }, acquisitionStatus: 'unavailable', diagnostics: [], evidence: [{ evidenceId: 'evidence-1', summary: 'Retained public source', sourceRef: 'source:retained-source' }] } }
  const themeFrameworkService = {
    start(input: unknown) { calls.push(['start', input]); return { runId: 'theme-route-run-1', completion: Promise.resolve({ status: 'awaiting_review', workflowRunId: 'theme-route-run-1' }) } },
    async getReviewCandidate(runId: string) { calls.push(['get', runId]); return { ...safeCandidate, workflowRunId: runId } },
    async accept(input: unknown) { calls.push(['accept', input]); return { status: 'committed', workflowRunId: 'theme-route-run-1', themeRef: 'entity:theme-safe', committedRevision: 1, decisionCount: 2 } },
    async reject(runId: string) { calls.push(['reject', runId]); return { status: 'rejected', workflowRunId: runId } },
  }
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, ...(withKb ? { mountedKnowledgeBaseRoot: kb } : {}), workspaceRoot: workspace, modelRuntime, model: faux.getModel(), reasoningExecutor: { capabilities: () => ({ maxContextTokens: 32_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute(request) { return { operation: request.operation, output: {} } } }, ...(withService ? { themeFrameworkService: themeFrameworkService as never } : {}) })
  const server = new ResearchHubRuntimeServer({ runtime, clientRoot: join(root, 'missing-client'), port: 0 })
  await server.start()
  return { root, runtime, server, modelRuntime, origin: server.address!.origin, token: server.address!.runtimeToken, calls }
}

test('Theme Framework start/get/accept/reject use runtime-token protected routes and safe DTOs', async () => {
  const f = await fixture()
  try {
    const headers = { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }
    const started = await fetch(`${f.origin}/api/theme-framework/start`, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'theme-route-run-1', name: 'AI 算力' }) })
    assert.equal(started.status, 202)
    assert.equal((await started.json() as { runId: string }).runId, 'theme-route-run-1')
    const unauthorizedRead = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1`, { headers: { origin: f.origin } })
    assert.equal(unauthorizedRead.status, 401)
    const browserLikeRead = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1`, { headers: { 'x-researchhub-runtime-token': f.token } })
    assert.equal(browserLikeRead.status, 200)
    const crossOriginRead = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1`, { headers: { origin: 'http://127.0.0.1:1', 'x-researchhub-runtime-token': f.token } })
    assert.equal(crossOriginRead.status, 401)
    const candidateResponse = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1`, { headers })
    assert.equal(candidateResponse.status, 200)
    const candidate = await candidateResponse.json() as { candidate: { evidence: readonly Record<string, unknown>[] } }
    assert.equal(candidate.candidate.evidence[0]?.sourceRef, 'source:retained-source')
    assert.equal(JSON.stringify(candidate).includes('rawRef'), false)

    const accepted = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/accept`, { method: 'POST', headers, body: JSON.stringify({ decisions: { industry_1: 'include', relation_1: 'pending' } }) })
    assert.equal(accepted.status, 200)
    assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'accept'), ['accept', { workflowRunId: 'theme-route-run-1', decisions: { industry_1: 'include', relation_1: 'pending' } }])
    const rejected = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/reject`, { method: 'POST', headers, body: '{}' })
    assert.equal(rejected.status, 200)
    const mutationWithoutOrigin = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/reject`, { method: 'POST', headers: { 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }, body: '{}' })
    assert.equal(mutationWithoutOrigin.status, 401)
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }
})

test('Theme Framework routes reject unsupported request and ref fields with narrow size bounds', async () => {
  const f = await fixture()
  try {
    const headers = { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }
    const extra = await fetch(`${f.origin}/api/theme-framework/start`, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'theme-route-run-1', name: 'AI 算力', framework: {} }) })
    assert.equal(extra.status, 400)
    const oversized = await fetch(`${f.origin}/api/theme-framework/start`, { method: 'POST', headers, body: JSON.stringify({ workflowRunId: 'theme-route-run-1', name: 'x'.repeat(301) }) })
    assert.equal(oversized.status, 400)
    const invalidDecision = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/accept`, { method: 'POST', headers, body: JSON.stringify({ decisions: { 'unsafe/ref': 'include' } }) })
    assert.equal(invalidDecision.status, 400)
    const extraReject = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/reject`, { method: 'POST', headers, body: JSON.stringify({ decision: 'reject' }) })
    assert.equal(extraReject.status, 400)
    const huge = await fetch(`${f.origin}/api/theme-framework/runs/theme-route-run-1/accept`, { method: 'POST', headers, body: JSON.stringify({ decisions: { industry: 'include', filler: 'x'.repeat(40_000) } }) })
    assert.equal(huge.status, 400)
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }
})

test('Theme Framework start reports unavailable service when no active Schema 0.4 KB service is mounted', async () => {
  const f = await fixture(false, false)
  try {
    const response = await fetch(`${f.origin}/api/theme-framework/start`, { method: 'POST', headers: { origin: f.origin, 'x-researchhub-runtime-token': f.token, 'content-type': 'application/json' }, body: JSON.stringify({ workflowRunId: 'theme-route-run-1', name: 'AI 算力' }) })
    assert.equal(response.status, 503)
    assert.equal((await response.json() as { code: string }).code, 'no_kb_mounted')
  } finally { await f.server.close(); await f.runtime.close(); await Promise.resolve((f.modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(f.root, { recursive: true, force: true }) }
})
