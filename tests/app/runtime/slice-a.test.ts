import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { toSafeConversationMessage } from '../../../app/runtime/session-runtime.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }

class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } as ReasoningResult }
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-slice-a-'))
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  const sessionDir = join(root, 'sessions')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  return { root, cwd, agentDir, sessionDir, modelRuntime, faux }
}

test('Slice A uses persistent Pi sessions and restores a prior conversation', async () => {
  const fixture = await makeFixture()
  let runtime1: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  let runtime2: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime1 = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    assert.equal(runtime1.sessionManager.isPersisted(), true)
    fixture.faux.setResponses([fauxAssistantMessage('persisted answer')])
    await runtime1.sessionRuntime.prompt('persist this conversation')
    const originalId = runtime1.sessionRuntime.getCurrentState().conversationId
    assert.equal(runtime1.sessionRuntime.getCurrentMessages().some((message) => message.content === 'persisted answer'), true)
    await runtime1.close()
    runtime1 = undefined

    runtime2 = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const listed = await runtime2.sessionRuntime.listConversations()
    assert.equal(listed.some((conversation) => conversation.conversationId === originalId), true)
    await runtime2.sessionRuntime.resumeConversation(originalId)
    assert.equal(runtime2.sessionRuntime.getCurrentState().conversationId, originalId)
    assert.equal(runtime2.sessionRuntime.getCurrentMessages().some((message) => message.content === 'persisted answer'), true)
  } finally {
    await runtime2?.close()
    await runtime1?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice A binds accepted operations to exact persisted Pi user SessionEntry IDs', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const events: import('../../../app/runtime/client-events.ts').ClientEvent[] = []
    runtime.sessionRuntime.subscribeClientEvents((event) => events.push(event))
    const store = runtime.sessionRuntime.conversationStateStore
    fixture.faux.setResponses([fauxAssistantMessage('first response'), fauxAssistantMessage('second response')])

    const identities: string[] = []
    for (const operationId of ['repeat-op-one', 'repeat-op-two']) {
      await store.acceptRequest(conversationId, { kind: 'chat', operation: 'prompt', operationId, requestText: 'repeat this exact prompt' })
      await store.claimChatCommand(conversationId, operationId)
      const started = runtime.sessionRuntime.startPrompt('repeat this exact prompt', undefined, undefined, operationId)
      await started.accepted
      await store.completeSubmission(conversationId, operationId, { kind: 'chat', outcome: 'started' })
      await started.completion
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const request = (await store.get(conversationId))?.acceptedRequests.find((entry) => entry.operationId === operationId)
        if (request?.piMessageId !== undefined) { identities.push(request.piMessageId); break }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    assert.equal(identities.length, 2)
    assert.notEqual(identities[0], identities[1])
    const messages = runtime.sessionRuntime.getCurrentMessages()
    const repeatedUsers = messages.filter((message) => message.role === 'user' && message.content === 'repeat this exact prompt')
    assert.equal(repeatedUsers.length, 2)
    assert.deepEqual(repeatedUsers.map((message) => message.piMessageId), identities)
    assert.equal(events.some((event) => event.type === 'agent.started' && event.operationId === 'repeat-op-one'), true)
    assert.equal(events.some((event) => event.type === 'message.delta' && event.operationId === 'repeat-op-two'), true)
    const activities = await runtime.sessionRuntime.conversationActivities(conversationId)
    assert.deepEqual(activities.map((activity) => activity.piMessageId), identities)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice A replaces only the active Pi conversation and preserves services and Workflow runs', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const initialId = runtime.sessionRuntime.getCurrentState().conversationId
    fixture.faux.setResponses([fauxAssistantMessage('initial answer')])
    await runtime.sessionRuntime.prompt('create a persisted first conversation')
    const serviceRefs = { knowledge: runtime.knowledgeService, review: runtime.reviewService, workflow: runtime.workflowService, production: runtime.productionService }
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    runtime.workflowService.register({ runId: 'slice-a-running', workflowType: 'fixture', objective: 'independence' })
    const run = runtime.workflowService.start('slice-a-running', async () => { await gate; return { status: 'completed' as const } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(runtime.workflowService.getWorkflowStatus('slice-a-running')?.status, 'running')

    await runtime.sessionRuntime.createConversation('second')
    const secondId = runtime.sessionRuntime.getCurrentState().conversationId
    assert.notEqual(secondId, initialId)
    assert.strictEqual(runtime.knowledgeService, serviceRefs.knowledge)
    assert.strictEqual(runtime.reviewService, serviceRefs.review)
    assert.strictEqual(runtime.workflowService, serviceRefs.workflow)
    assert.strictEqual(runtime.productionService, serviceRefs.production)
    assert.equal(runtime.workflowService.getWorkflowStatus('slice-a-running')?.status, 'running')

    await runtime.sessionRuntime.abort()
    assert.equal(runtime.workflowService.getWorkflowStatus('slice-a-running')?.status, 'running')
    runtime.workflowService.cancelWorkflow('slice-a-running')
    release()
    await run
    assert.equal(runtime.workflowService.getWorkflowStatus('slice-a-running')?.status, 'cancelled')

    const conversations = await runtime.sessionRuntime.listConversations()
    assert.equal(conversations.some((conversation) => conversation.conversationId === initialId), true)
    await runtime.sessionRuntime.switchConversation(initialId)
    assert.equal(runtime.sessionRuntime.getCurrentState().conversationId, initialId)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice A does not couple Pi conversation abort to an independent WorkflowService', async () => {
  const workflow = new WorkflowService()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  workflow.register({ runId: 'independent', workflowType: 'fixture', objective: 'independence' })
  const run = workflow.start('independent', async () => { await pending; return { status: 'completed' as const } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(workflow.getWorkflowStatus('independent')?.status, 'running')
  release()
  await run
  assert.equal(workflow.getWorkflowStatus('independent')?.status, 'completed')
})

test('Slice A serializes concurrent conversation replacement operations', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const results = await Promise.all([runtime.sessionRuntime.createConversation('first'), runtime.sessionRuntime.createConversation('second')])
    assert.notEqual(results[0].conversationId, results[1].conversationId)
    assert.equal(results[0].name, 'first')
    assert.equal(results[1].name, 'second')
    assert.equal(runtime.sessionRuntime.getCurrentState().conversationId, results[1].conversationId)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('sidecar-only Workflow conversations remain listable and switchable without a Pi transcript', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const conversationId = 'workflow-sidecar-only'
    await runtime.sessionRuntime.conversationStateStore.acceptRequest(conversationId, { operationId: 'operation-sidecar-1', operation: 'prompt', requestText: '研究一个尚未进入 Pi transcript 的请求', workflowRegistryId: 'company.deep-research' })
    await runtime.sessionRuntime.conversationStateStore.claimSubmission(conversationId, 'operation-sidecar-1', '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e')
    await runtime.sessionRuntime.conversationStateStore.markWorkflowStarted(conversationId, 'operation-sidecar-1', { workflowRegistryId: 'company.deep-research', workflowRunId: 'workflow-run-sidecar-1' })
    const listed = await runtime.sessionRuntime.listConversations()
    assert.equal(listed.filter((item) => item.conversationId === conversationId).length, 1)
    assert.equal(listed.find((item) => item.conversationId === conversationId)?.latestWorkflowRunId, 'workflow-run-sidecar-1')
    await runtime.sessionRuntime.switchConversation(conversationId)
    assert.equal(runtime.sessionRuntime.getCurrentState().conversationId, conversationId)
    assert.deepEqual(runtime.sessionRuntime.getCurrentMessages(), [])
    const activities = await runtime.sessionRuntime.conversationActivities(conversationId)
    assert.equal(activities[0]?.requestText, '研究一个尚未进入 Pi transcript 的请求')
    assert.equal(activities[0]?.workflowRunId, 'workflow-run-sidecar-1')
    assert.equal((await runtime.sessionRuntime.listConversations()).filter((item) => item.conversationId === conversationId).length, 1)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a deleted Pi transcript leaves its sidecar intact but cannot be listed or rebound as a new session', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    fixture.faux.setResponses([fauxAssistantMessage('persisted transcript')])
    await runtime.sessionRuntime.prompt('Persist this Pi transcript before deletion.')
    const orphanId = runtime.sessionRuntime.getCurrentState().conversationId
    const transcriptPath = runtime.sessionManager.getSessionFile()
    assert.ok(transcriptPath)
    await runtime.sessionRuntime.listConversations()
    assert.equal((await runtime.sessionRuntime.conversationStateStore.get(orphanId))?.piTranscriptObserved, true)
    await runtime.sessionRuntime.createConversation()
    await unlink(transcriptPath)

    const listed = await runtime.sessionRuntime.listConversations()
    assert.equal(listed.some((item) => item.conversationId === orphanId), false)
    await assert.rejects(runtime.sessionRuntime.switchConversation(orphanId), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'not_found')
    await assert.rejects(runtime.sessionRuntime.conversationActivities(orphanId), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'not_found')
    assert.equal((await runtime.sessionRuntime.conversationStateStore.get(orphanId))?.piTranscriptObserved, true, 'the orphaned metadata remains available for safe recovery or operator inspection')
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('latest Workflow summary follows actual startedAt when accepted operations finish out of order', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const store = runtime.sessionRuntime.conversationStateStore
    await store.acceptRequest(conversationId, { operation: 'prompt', operationId: 'older-accepted-first', requestText: 'first accepted, started last', workflowRegistryId: 'company_research' })
    await store.acceptRequest(conversationId, { operation: 'prompt', operationId: 'newer-accepted-second', requestText: 'second accepted, started first', workflowRegistryId: 'company_research' })
    await store.claimSubmission(conversationId, 'older-accepted-first')
    await store.markWorkflowStarted(conversationId, 'older-accepted-first', { workflowRegistryId: 'company_research', workflowRunId: 'workflow-actually-latest', startedAt: '2026-10-12T09:10:00.000Z' })
    await store.claimSubmission(conversationId, 'newer-accepted-second')
    await store.markWorkflowStarted(conversationId, 'newer-accepted-second', { workflowRegistryId: 'company_research', workflowRunId: 'workflow-started-first', startedAt: '2026-10-12T09:05:00.000Z' })
    assert.equal((await runtime.sessionRuntime.getConversationSummary(conversationId)).latestWorkflowRunId, 'workflow-actually-latest')
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Runtime startup marks an ambiguous accepted dispatch interrupted and keeps its sidecar conversation switchable', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    const options = { cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() }
    runtime = await createResearchHubApplicationRuntime(options)
    await runtime.sessionRuntime.conversationStateStore.acceptRequest('restart-sidecar-only', { operationId: 'restart-operation-1', operation: 'prompt', requestText: 'Recover the accepted request after restart.', workflowRegistryId: 'company_research' })
    await runtime.sessionRuntime.conversationStateStore.claimSubmission('restart-sidecar-only', 'restart-operation-1', '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e')
    assert.equal((await runtime.sessionRuntime.getConversationSummary('restart-sidecar-only')).latestWorkflowRunId, undefined, 'a live submission reservation is not presented as a started Workflow')
    await runtime.close(); runtime = undefined
    runtime = await createResearchHubApplicationRuntime(options)
    const recovered = await runtime.sessionRuntime.conversationStateStore.get('restart-sidecar-only')
    assert.equal(recovered?.acceptedRequests[0]?.lifecycle, 'interrupted')
    assert.equal((await runtime.sessionRuntime.listConversations()).filter((item) => item.conversationId === 'restart-sidecar-only').length, 1)
    const recoveredSummary = await runtime.sessionRuntime.getConversationSummary('restart-sidecar-only')
    assert.equal(recoveredSummary.latestWorkflowRunId, '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e', 'only an interrupted, explicitly selected Workflow may expose its reserved association after restart')
    await runtime.sessionRuntime.switchConversation('restart-sidecar-only')
    assert.equal(runtime.sessionRuntime.getCurrentState().conversationId, 'restart-sidecar-only')
    const [activity] = await runtime.sessionRuntime.conversationActivities('restart-sidecar-only')
    assert.equal(activity?.status, 'interrupted')
    assert.equal(activity?.reservedWorkflowRunId, '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e')
    assert.equal(activity?.workflowRunId, undefined, 'a reserved ID is not falsely promoted to a confirmed WorkflowRun association')
    assert.equal(activity?.workflowRegistryId, 'company_research', 'the explicit registered Workflow identity remains available for its interruption card')
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice A rejects unsafe tool results and projects only fixed product summaries', () => {
  const secret = 'SECRET raw JSON C:\\workspace\\uploads\\id\\file.txt command=cat api_key=hidden'
  assert.equal(toSafeConversationMessage({ role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: secret }], timestamp: Date.now(), isError: false }), undefined)
  const safe = toSafeConversationMessage({ role: 'toolResult', toolName: 'ingest_document', content: [{ type: 'text', text: JSON.stringify({ secret, path: 'C:\\private', command: 'rm -rf' }) }], timestamp: Date.now(), isError: false })
  assert.deepEqual(safe?.content, 'Document ingestion completed')
  assert.equal(safe?.content.includes('SECRET'), false)
  assert.equal(safe?.content.includes('workspace'), false)
})

test('Slice A state access rejects after dispose', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    await runtime.close()
    assert.throws(() => runtime!.sessionRuntime.getCurrentState(), /closed/)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice A dispose retries after session cleanup failure and still attempts owned ModelRuntime cleanup', async () => {
  const fixture = await makeFixture()
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor() })
    let sessionAttempts = 0
    const sessionRuntime = runtime.sessionRuntime as unknown as { dispose: () => Promise<void> }
    const originalDispose = sessionRuntime.dispose.bind(runtime.sessionRuntime)
    sessionRuntime.dispose = async () => { sessionAttempts += 1; if (sessionAttempts === 1) throw new Error('session cleanup fixture failure'); return originalDispose() }
    let modelAttempts = 0
    Object.defineProperty(runtime.modelRuntime, 'dispose', { configurable: true, value: async () => { modelAttempts += 1; if (modelAttempts === 1) throw new Error('model cleanup fixture failure') } })
    await assert.rejects(() => runtime!.close(), /disposal failed|cleanup fixture failure/)
    assert.equal(modelAttempts, 1)
    await runtime!.close()
    assert.equal(sessionAttempts, 2)
    assert.equal(modelAttempts, 2)
    assert.throws(() => runtime!.sessionRuntime.getCurrentState(), /closed/)
  } finally {
    await runtime?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})
