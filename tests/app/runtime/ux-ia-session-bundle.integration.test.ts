import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'

test('Free Research Bundle remains owned by original conversation operation after completion and Runtime restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-ux-ia-session-bundle-'))
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `ux-ia-session-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const reasoningExecutor: ReasoningExecutor = { capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }), async execute(request) { return { operation: request.operation, output: { mode: 'free_research', skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false }, rationale: 'Fixture request has no registered workflow' } } } }
  const options = { cwd, agentDir, sessionDir, modelRuntime, model: faux.getModel(), reasoningExecutor }
  let runtime = await createResearchHubApplicationRuntime(options)
  let server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  let info = await server.start()
  const post = (path: string, body: unknown) => fetch(`${info.origin}${path}`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${info.origin}${path}`, { headers: { origin: info.origin } })
  try {
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const operationId = 'free-original'; const query = 'Free Research original request'
    const body = { conversationId, operationId, query, mode: { type: 'free_research' }, contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } }
    const dispatched = await post('/api/research/dispatch', body)
    assert.equal(dispatched.status, 200)
    const result = await dispatched.json() as { runId: string; status: string }
    assert.equal(result.status, 'free_research'); assert.match(result.runId, /^free-/)
    const replay = await post('/api/research/dispatch', body)
    assert.equal((await replay.json() as { runId: string }).runId, result.runId)
    const wrong = await post('/api/conversations/prompt', { conversationId, operationId, text: query, researchBundleId: 'free-659a5bfd-66fb-478b-9a3a-26f10c071452' })
    assert.equal(wrong.status, 409)
    assert.equal((await runtime.sessionRuntime.conversationStateStore.get(conversationId))?.acceptedRequests[0]?.lifecycle, 'ready_for_chat')
    const other = await post('/api/conversations/prompt', { conversationId, operationId: 'different-op', text: 'different request', researchBundleId: result.runId })
    assert.equal(other.status, 409)
    faux.setResponses([fauxAssistantMessage('Free Research completed answer.')])
    const accepted = await post('/api/conversations/prompt', { conversationId, operationId, text: query })
    assert.equal(accepted.status, 202, 'omitted client hint still uses the authoritative session Bundle association')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bundle = await runtime.services.researchDispatchService!.getBundleForRun(result.runId)
      if (bundle?.status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const bundle = await runtime.services.researchDispatchService!.getBundleForRun(result.runId)
    assert.equal(bundle?.status, 'completed'); assert.equal(bundle?.report, undefined)
    const terminalReplay = await post('/api/research/dispatch', body)
    assert.equal((await terminalReplay.json() as { runId: string }).runId, result.runId)
    await server.close(); await runtime.close()
    runtime = await createResearchHubApplicationRuntime(options); server = new ResearchHubRuntimeServer({ runtime, port: 0 }); info = await server.start()
    const activities = await get(`/api/conversations/${conversationId}/activities`)
    const ledger = await activities.json() as { activities: Array<{ operationId: string; researchBundleRunId?: string }> }
    assert.equal(ledger.activities.find((item) => item.operationId === operationId)?.researchBundleRunId, result.runId)
    const recovered = await get(`/api/research/bundles/by-run/${result.runId}`)
    assert.equal(recovered.status, 200)
    assert.equal((await recovered.json() as { workflowRunId: string }).workflowRunId, result.runId)
    assert.equal(runtime.workflowService.getWorkflowStatus(result.runId), undefined, 'session Bundle does not fabricate a Workflow run')
    const newConversation = await post('/api/conversations/new', {})
    assert.equal(newConversation.status, 200)
    const otherConversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const crossConversation = await post('/api/conversations/prompt', { conversationId: otherConversationId, operationId, text: query, researchBundleId: result.runId })
    assert.equal(crossConversation.status, 409)
    assert.equal((await runtime.sessionRuntime.conversationStateStore.get(otherConversationId))?.acceptedRequests.length, 0)
  } finally { await server.close(); await runtime.close(); await rm(root, { recursive: true, force: true }) }
})
