import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { createKnowledgeBase } from '../../knowledge/helpers.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 1 }
class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } }
}
const headers = (origin: string, token: string) => ({ origin, 'x-researchhub-runtime-token': token, 'content-type': 'application/json' })
const rights = { accessScope: 'authenticated', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'Caller supplied a document for research processing.' }

async function withRuntime(schema: '0.3' | '0.4', run: (input: { readonly origin: string; readonly token: string; readonly server: ResearchHubRuntimeServer; readonly runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-raw-preview-v04-'))
  const kb = schema === '0.4' ? join(root, 'kb') : await createKnowledgeBase({ schemaVersion: '0.3', knowledgeBaseId: 'kb-route-v03' })
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const workspaceRoot = join(root, 'workspace')
  await mkdir(cwd); await mkdir(agentDir); await mkdir(workspaceRoot)
  if (schema === '0.4') await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-route-v04' })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `raw-preview-route-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  try { const info = await server.start(); await run({ origin: info.origin, token: info.runtimeToken, server, runtime }) }
  finally { await server.close(); await runtime.close(); await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> }).dispose?.()); await rm(root, { recursive: true, force: true }); if (schema === '0.3') await rm(kb, { recursive: true, force: true }) }
}

test('V0.4 preview route requires caller supplied rights and runtime authorization', async () => {
  await withRuntime('0.4', async ({ origin, token, runtime }) => {
    const noRights = await fetch(`${origin}/api/production/raw-document-preview-v04`, { method: 'POST', headers: headers(origin, token), body: JSON.stringify({ workflowRunId: 'no-rights', text: 'AI computing demand', sourceMetadata: {} }) })
    assert.equal(noRights.status, 400)
    assert.equal(runtime.workflowService.getWorkflowStatus('no-rights'), undefined)
    const unauthorized = await fetch(`${origin}/api/production/raw-document-preview-v04`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'AI computing demand', sourceMetadata: {}, rights }) })
    assert.equal(unauthorized.status, 401)
  })
})

test('Schema 0.3 preview route exposes explicit incompatibility and non-committable state', async () => {
  await withRuntime('0.3', async ({ origin, token, runtime }) => {
    const start = await fetch(`${origin}/api/production/raw-document-preview-v04`, { method: 'POST', headers: headers(origin, token), body: JSON.stringify({ workflowRunId: 'old-schema-preview', text: 'AI computing demand', sourceMetadata: {}, rights }) })
    assert.equal(start.status, 202)
    const responseBody = await start.json() as { runId: string; committable: boolean }
    assert.equal(responseBody.committable, false)
    for (let attempt = 0; attempt < 50 && runtime.workflowService.getWorkflowStatus(responseBody.runId)?.status === 'running'; attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
    const read = await fetch(`${origin}/api/production/raw-document-preview-v04/${encodeURIComponent(responseBody.runId)}`, { headers: { origin, 'x-researchhub-runtime-token': token } })
    assert.equal(read.status, 200)
    const payload = await read.json() as { committable: boolean; preview: { status: string; committable: boolean; candidateGroups: readonly unknown[] } }
    assert.equal(payload.committable, false)
    assert.equal(payload.preview.status, 'incompatible_schema')
    assert.equal(payload.preview.committable, false)
    assert.deepEqual(payload.preview.candidateGroups, [])
  })
})
