import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxProvider } from '@earendil-works/pi-ai'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { normalizeResearchRequest } from '../../../app/services/research-dispatch-contracts.ts'
import type { ResearchDispatchStart } from '../../../app/services/research-dispatch-service.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'
import { randomUUID } from 'node:crypto'

test('HTTP clarification is bound, token protected, durable, and idempotently confirms one start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-clarify-http-')); const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent')
  await mkdir(cwd); await mkdir(agentDir)
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `clarify-http-${Date.now()}`, models: [{ id: 'fixture' }] }); modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, modelRuntime, model: faux.getModel() })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 }); const info = await server.start()
  const headers = { origin: info.origin, 'content-type': 'application/json', 'x-researchhub-runtime-token': info.runtimeToken }
  const post = (path: string, body: unknown, token = true) => fetch(`${info.origin}${path}`, { method: 'POST', headers: token ? headers : { origin: info.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let confirms = 0
  try {
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const request = normalizeResearchRequest({ query: 'write dsjm report', contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
    const pending: ResearchDispatchStart = { request, decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { name: 'dsjm', maxSources: 3 } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'Company report' }, status: 'needs_clarification', summary: { mode: 'Free Research', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'missing', argumentKeys: ['name','maxSources'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, clarification: { confirmationId: 'confirm-http', kind: 'security_selection', query: 'dsjm', candidates: [{ candidateId: 'SZ-002384', name: 'Dongshan', symbol: '002384', exchange: 'SZ', matchKind: 'initials' }], missingFields: [], directoryVersion: 'v1', question: 'Select company' } }
    const service = runtime.services.researchDispatchService!
    service.startAsync = async () => pending
    service.confirmAsync = async (original, input) => {
      confirms++; assert.equal(input.candidateId, 'SZ-002384'); assert.equal(original.decision.workflow?.arguments.maxSources, 3); assert.equal(original.request.persistencePolicy.writeKnowledge, false)
      return { ...original, clarification: undefined, status: 'free_research', runId: undefined }
    }
    const operationId = 'op'; const confirmBody = { conversationId, operationId, confirmationId: 'confirm-http', candidateId: 'SZ-002384', directoryVersion: 'v1' }
    assert.equal((await post('/api/research/dispatch', { ...request, conversationId, operationId })).status, 200)
    assert.equal((await post('/api/research/dispatch/confirm', confirmBody, false)).status, 401)
    assert.equal((await post('/api/research/dispatch/confirm', { ...confirmBody, confirmationId: 'wrong' })).status, 409)
    const replay = await post('/api/research/dispatch', { ...request, conversationId, operationId }); assert.equal((await replay.json()).clarification.confirmationId, 'confirm-http')
    const confirmed = await post('/api/research/dispatch/confirm', confirmBody); assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).status, 'free_research')
    assert.equal((await post('/api/research/dispatch/confirm', confirmBody)).status, 200); assert.equal(confirms, 1)
    assert.equal((await post('/api/research/dispatch/confirm', { ...confirmBody, operationId: 'different' })).status, 409)
    const snapshot = await fetch(`${info.origin}/api/conversations/${conversationId}/activities`, { headers: { origin: info.origin } }); const activity = (await snapshot.json()).activities[0]
    assert.equal(activity.operationId, 'op'); assert.equal(activity.status, 'ready_for_chat'); assert.equal(activity.clarification, undefined)
    // A Workflow terminal updates the request card without requiring a browser refresh.
    const sseAbort = new AbortController()
    const sseTimer = setTimeout(() => sseAbort.abort(), 5000)
    try {
      const events = await fetch(`${info.origin}/api/events`, { headers: { origin: info.origin }, signal: sseAbort.signal })
      const reader = events.body!.getReader()
      const runId = randomUUID()
      let finish!: () => void
      const finished = new Promise<void>(resolve => { finish = resolve })
      service.startAsync = async () => {
        runtime.workflowService.register({ runId, workflowType: 'company_research', objective: 'terminal notification' })
        const completion = runtime.workflowService.start(runId, async () => { await finished; return { status: 'cancelled' as const } })
        return { ...pending, clarification: undefined, status: 'started', runId, completion }
      }
      assert.equal((await post('/api/research/dispatch', { ...request, conversationId, operationId: 'workflow-finish' })).status, 202)
      finish()
      let frames = ''
      while ((frames.match(/"operationId":"workflow-finish"/gu) ?? []).length < 2) {
        const chunk = await reader.read(); assert.equal(chunk.done, false)
        frames += new TextDecoder().decode(chunk.value)
      }
      assert.ok(frames.includes('event: activity.updated'))
      assert.equal((await runtime.sessionRuntime.conversationStateStore.get(conversationId))!.acceptedRequests.find(item => item.operationId === 'workflow-finish')!.lifecycle, 'cancelled')
      await reader.cancel()
    } finally { clearTimeout(sseTimer); sseAbort.abort() }
    let entered!: () => void
    const preparing = new Promise<void>(resolve => { entered = resolve })
    service.startAsync = async (_request, signal) => {
      entered()
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new ApplicationServiceError('cancelled', 'Preparation cancelled')), { once: true }))
    }
    const pendingStart = post('/api/research/dispatch', { ...request, conversationId, operationId: 'preparing' })
    await preparing
    assert.equal((await post('/api/conversations/abort', {})).status, 200)
    assert.notEqual((await pendingStart).status, 202)
    const cancelled = (await runtime.sessionRuntime.conversationStateStore.get(conversationId))!.acceptedRequests.find(item => item.operationId === 'preparing')!
    assert.equal(cancelled.lifecycle, 'not_started'); assert.equal(cancelled.outcomeReasonCode, 'cancelled'); assert.equal(cancelled.reservedWorkflowRunId, undefined)
  } finally { await server.close(); await runtime.close(); await rm(root, { recursive: true, force: true }) }
})
