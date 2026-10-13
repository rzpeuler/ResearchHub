import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import type { WorkflowService } from '../../../app/services/workflow-service.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
const requestText = '帮我研究002640'
const workflowRegistryId = 'company_research'

class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: Parameters<ReasoningExecutor['execute']>[0]) { return { operation: request.operation, output: {} } as never }
}

async function snapshotFiles(root: string): Promise<readonly (readonly [string, string])[]> {
  const entries: [string, string][] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path, relative)
      else if (entry.isFile()) entries.push([relative, createHash('sha256').update(await readFile(path)).digest('hex')])
      else throw new Error(`Unexpected Knowledge Base entry type: ${relative}`)
    }
  }
  await visit(root, '')
  return entries.sort(([left], [right]) => left.localeCompare(right))
}

test('UX-001 HTTP lifecycle persists a Company Research request, links its Workflow, and restores it after Runtime restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-ux001-lifecycle-'))
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions'); const workspaceRoot = join(root, 'workspace'); const knowledgeBaseRoot = join(root, 'knowledge-base')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  await createFreshKnowledgeBaseV04(knowledgeBaseRoot, { knowledgeBaseId: `ux001-${Date.now()}` })
  await writeFile(join(knowledgeBaseRoot, 'entities', 'fixture-002640.yaml'), JSON.stringify({ id: 'entity:fixture-002640', type: 'company', name: '跨境通', aliases: ['跨境通'], ticker: '002640', exchange: 'SZSE', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(knowledgeBaseRoot, 'registry', 'assets.yaml'), JSON.stringify({ 'entity:fixture-002640': { type: 'entity', storageRef: 'entities/fixture-002640.yaml' } }) + '\n')
  const knowledgeSnapshot = await snapshotFiles(knowledgeBaseRoot)
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-ux001-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)

  let workflowService: WorkflowService | undefined
  const releases: Array<() => void> = []
  const completions: Promise<unknown>[] = []
  const startedInputs: Array<{ workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }> = []
  const researchService = {
    startResearchCompany(input: { workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }) {
      startedInputs.push(input)
      const service = workflowService!
      service.register({ runId: input.workflowRunId, workflowType: workflowRegistryId, objective: `Company Research ${input.symbol}` })
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      releases.push(release)
      const completion = service.start(input.workflowRunId, async () => { await gate; return { status: 'completed' as const, summary: 'Isolated UX-001 fixture execution.' } })
      completions.push(completion)
      return { runId: input.workflowRunId, completion }
    },
  }
  const runtimeOptions = { cwd, agentDir, sessionDir, mountedKnowledgeBaseRoot: knowledgeBaseRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), researchService: researchService as never }
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  let server: ResearchHubRuntimeServer | undefined
  let runtimeAfterRestart: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  let serverAfterRestart: ResearchHubRuntimeServer | undefined

  const startRuntime = async () => {
    const created = await createResearchHubApplicationRuntime(runtimeOptions)
    workflowService = created.workflowService
    const http = new ResearchHubRuntimeServer({ runtime: created, port: 0 })
    const info = await http.start()
    return { created, http, info, headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken, 'content-type': 'application/json' } }
  }
  const post = (origin: string, headers: Record<string, string>, path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

  try {
    const first = await startRuntime(); runtime = first.created; server = first.http
    assert.equal(runtime.sessionManager.isPersisted(), true, 'acceptance uses the persistent Pi SessionManager')
    const conversationId = runtime.sessionRuntime.getCurrentState().conversationId
    const operation1 = 'ux001-company-request-1'
    const accepted1 = await post(first.info.origin, first.headers, '/api/conversations/requests/accept', { conversationId, operationId: operation1, requestText, operation: 'prompt', workflowRegistryId })
    assert.equal(accepted1.status, 200)
    assert.deepEqual(await accepted1.json(), { accepted: true, conversationId, operationId: operation1, status: 'accepted' })
    const summaryBefore = await runtime.sessionRuntime.getConversationSummary(conversationId)
    assert.equal(summaryBefore.name, requestText)
    assert.equal(summaryBefore.titleSource, 'first_message')

    const dispatchBody = {
      conversationId,
      operationId: operation1,
      query: requestText,
      mode: { type: 'workflow', workflowId: workflowRegistryId },
      contextPolicy: { structuredKnowledge: true, sourceLibrary: true },
      persistencePolicy: { writeKnowledge: false },
      workflowArgumentContext: { workflowId: workflowRegistryId, arguments: { symbol: '002640' } },
    }
    const firstDispatch = await post(first.info.origin, first.headers, '/api/research/dispatch', dispatchBody)
    assert.equal(firstDispatch.status, 202)
    const firstRun = await firstDispatch.json() as { accepted: boolean; runId: string; workflow?: { runId: string; status: string } }
    assert.equal(firstRun.accepted, true); assert.ok(firstRun.runId); assert.equal(firstRun.workflow?.runId, firstRun.runId)
    assert.equal(runtime.workflowService.getWorkflowStatus(firstRun.runId)?.status, 'running')
    assert.equal(startedInputs.length, 1)
    assert.equal(startedInputs[0]?.workflowRunId, firstRun.runId)
    assert.equal(startedInputs[0]?.symbol, '002640'); assert.equal(startedInputs[0]?.name, '跨境通'); assert.equal(startedInputs[0]?.writeKnowledge, false)

    const linkedSummary = await runtime.sessionRuntime.getConversationSummary(conversationId)
    assert.equal(linkedSummary.name, '跨境通 · 公司深度研究')
    assert.equal(linkedSummary.titleSource, 'workflow')
    assert.equal(linkedSummary.latestWorkflowRunId, firstRun.runId)
    const currentWithWorkflowTitle = await fetch(`${first.info.origin}/api/conversations/current`, { headers: first.headers })
    assert.equal((await currentWithWorkflowTitle.json() as { conversationId: string; name: string }).name, '跨境通 · 公司深度研究')
    const activities1 = await runtime.sessionRuntime.conversationActivities(conversationId)
    assert.equal(activities1.length, 1)
    assert.equal(activities1[0]?.requestText, requestText)
    assert.equal(activities1[0]?.workflowRegistryId, workflowRegistryId)
    assert.equal(activities1[0]?.workflowSubject, '跨境通')
    assert.equal(activities1[0]?.workflowRunId, firstRun.runId)

    faux.setResponses([fauxAssistantMessage('Persisted Pi transcript response.')])
    const piPrompt = await post(first.info.origin, first.headers, '/api/conversations/prompt', { conversationId, operationId: 'ux001-pi-transcript-1', text: 'Pi transcript persistence check.' })
    assert.equal(piPrompt.status, 202)
    for (let attempt = 0; attempt < 100 && !runtime.sessionRuntime.getCurrentState().isIdle; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(runtime.sessionRuntime.getCurrentMessages().some((message) => message.role === 'user' && message.content === 'Pi transcript persistence check.'), true)
    assert.equal(runtime.sessionRuntime.getCurrentMessages().some((message) => message.role === 'assistant' && message.content === 'Persisted Pi transcript response.'), true)
    const otherConversation = await post(first.info.origin, first.headers, '/api/conversations/new', {})
    assert.equal(otherConversation.status, 200)
    const secondConversationId = (await otherConversation.json() as { conversationId: string }).conversationId
    assert.notEqual(secondConversationId, conversationId)
    const switchBack = await post(first.info.origin, first.headers, '/api/conversations/switch', { conversationId })
    assert.equal(switchBack.status, 200)
    const restoredMessages = await fetch(`${first.info.origin}/api/conversations/messages`, { headers: { origin: first.info.origin } })
    const transcript = await restoredMessages.json() as { conversationId: string; messages: readonly { role: string; content: string }[]; activities: readonly { operationId: string; workflowRunId?: string }[] }
    assert.equal(transcript.conversationId, conversationId)
    assert.equal(transcript.messages.some((message) => message.role === 'user' && message.content === 'Pi transcript persistence check.'), true)
    assert.equal(transcript.activities.find((item) => item.operationId === operation1)?.workflowRunId, firstRun.runId)

    const replay1 = await post(first.info.origin, first.headers, '/api/research/dispatch', dispatchBody)
    assert.equal(replay1.status, 202)
    const replayed1 = await replay1.json() as { accepted: boolean; status: string; runId: string; replayed: boolean }
    assert.equal(replayed1.accepted, true); assert.equal(replayed1.status, 'started'); assert.equal(replayed1.runId, firstRun.runId); assert.equal(replayed1.replayed, true)
    assert.equal(startedInputs.length, 1, 'replaying the same operation must not start another Workflow')
    const changedReplay = await post(first.info.origin, first.headers, '/api/research/dispatch', { ...dispatchBody, mode: undefined })
    assert.equal(changedReplay.status, 409, 'replay cannot omit or change the accepted Workflow identity')

    const unassociated = await post(first.info.origin, first.headers, '/api/research/dispatch', { query: requestText, mode: dispatchBody.mode })
    assert.equal(unassociated.status, 400)

    const beforeRename = await runtime.sessionRuntime.getConversationSummary(conversationId)
    const rename = await fetch(`${first.info.origin}/api/conversations/${encodeURIComponent(conversationId)}/metadata`, { method: 'PATCH', headers: first.headers, body: JSON.stringify({ name: '用户指定标题', expectedVersion: beforeRename.version }) })
    assert.equal(rename.status, 200)
    const userTitle = await rename.json() as { name: string; titleSource: string; version: number }
    assert.equal(userTitle.name, '用户指定标题'); assert.equal(userTitle.titleSource, 'user')

    const operation2 = 'ux001-company-request-2'
    const accepted2 = await post(first.info.origin, first.headers, '/api/conversations/requests/accept', { conversationId, operationId: operation2, requestText: `${requestText} 再次研究`, operation: 'prompt', workflowRegistryId })
    assert.equal(accepted2.status, 200)
    const dispatch2 = await post(first.info.origin, first.headers, '/api/research/dispatch', { ...dispatchBody, operationId: operation2, query: `${requestText} 再次研究` })
    assert.equal(dispatch2.status, 202)
    const secondRun = await dispatch2.json() as { runId: string }
    assert.notEqual(secondRun.runId, firstRun.runId)
    assert.equal(startedInputs.length, 2)
    const userTitleAfterWorkflow = await runtime.sessionRuntime.getConversationSummary(conversationId)
    assert.equal(userTitleAfterWorkflow.name, '用户指定标题')
    assert.equal(userTitleAfterWorkflow.titleSource, 'user')

    const archive = await post(first.info.origin, first.headers, `/api/conversations/${encodeURIComponent(conversationId)}/archive`, { expectedVersion: userTitleAfterWorkflow.version })
    assert.equal(archive.status, 200)
    const archived = await archive.json() as { archived: boolean; version: number }
    assert.equal(archived.archived, true)
    const activeList = await fetch(`${first.info.origin}/api/conversations?archived=0`, { headers: { origin: first.info.origin } })
    const archiveList = await fetch(`${first.info.origin}/api/conversations?archived=1&search=${encodeURIComponent('用户指定标题')}`, { headers: { origin: first.info.origin } })
    assert.equal(((await activeList.json()) as { conversations: readonly { conversationId: string }[] }).conversations.some((item) => item.conversationId === conversationId), false)
    assert.equal(((await archiveList.json()) as { conversations: readonly { conversationId: string }[] }).conversations.filter((item) => item.conversationId === conversationId).length, 1)

    for (const release of releases) release()
    await Promise.all(completions)
    await server.close(); server = undefined
    await runtime.close(); runtime = undefined

    const restarted = await startRuntime(); runtimeAfterRestart = restarted.created; serverAfterRestart = restarted.http
    const afterRestart = await runtimeAfterRestart.sessionRuntime.getConversationSummary(conversationId)
    assert.equal(afterRestart.name, '用户指定标题')
    assert.equal(afterRestart.titleSource, 'user')
    assert.equal(afterRestart.archived, true)
    assert.equal(afterRestart.latestWorkflowRunId, secondRun.runId)
    const currentAfterRestart = await fetch(`${restarted.info.origin}/api/conversations/current`, { headers: restarted.headers })
    const currentAfterRestartBody = await currentAfterRestart.json() as { conversationId: string; name: string }
    assert.equal(currentAfterRestartBody.conversationId, conversationId)
    assert.equal(currentAfterRestartBody.name, '用户指定标题')
    const persistedActivities = await runtimeAfterRestart.sessionRuntime.conversationActivities(conversationId)
    const persistedWorkflowActivities = persistedActivities.filter((item) => item.workflowRunId !== undefined)
    assert.deepEqual(persistedWorkflowActivities.map((item) => item.requestText), [requestText, `${requestText} 再次研究`])
    assert.deepEqual(persistedWorkflowActivities.map((item) => item.workflowRunId), [firstRun.runId, secondRun.runId])
    assert.deepEqual(persistedWorkflowActivities.map((item) => item.status), ['completed', 'completed'], 'Runtime restart preserves the terminal outcomes already confirmed by WorkflowService')
    assert.deepEqual(persistedWorkflowActivities.map((item) => item.outcome), ['workflow_completed', 'workflow_completed'])
    await runtimeAfterRestart.sessionRuntime.switchConversation(conversationId)
    assert.equal(runtimeAfterRestart.sessionRuntime.getCurrentMessages().some((message) => message.role === 'user' && message.content === 'Pi transcript persistence check.'), true)
    assert.equal(runtimeAfterRestart.sessionRuntime.getCurrentMessages().some((message) => message.role === 'assistant' && message.content === 'Persisted Pi transcript response.'), true)
    const missingOldRun = await fetch(`${restarted.info.origin}/api/workflows/${encodeURIComponent(secondRun.runId)}`, { headers: { origin: restarted.info.origin } })
    assert.equal(missingOldRun.status, 404, 'Runtime restart does not fabricate active Workflow status')
    const interruptedReplay = await post(restarted.info.origin, restarted.headers, '/api/research/dispatch', { ...dispatchBody, operationId: operation2, query: `${requestText} 再次研究` })
    assert.equal(interruptedReplay.status, 200)
    assert.equal((await interruptedReplay.json() as { status: string }).status, 'completed')

    const restore = await post(restarted.info.origin, restarted.headers, `/api/conversations/${encodeURIComponent(conversationId)}/restore`, { expectedVersion: afterRestart.version })
    assert.equal(restore.status, 200)
    const restored = await restore.json() as { archived: boolean; name: string; titleSource: string }
    assert.equal(restored.archived, false); assert.equal(restored.name, '用户指定标题'); assert.equal(restored.titleSource, 'user')
    const activeAfterRestore = await fetch(`${restarted.info.origin}/api/conversations?archived=0&search=${encodeURIComponent('用户指定标题')}`, { headers: { origin: restarted.info.origin } })
    assert.equal(((await activeAfterRestore.json()) as { conversations: readonly { conversationId: string }[] }).conversations.filter((item) => item.conversationId === conversationId).length, 1)
    assert.deepEqual(await snapshotFiles(knowledgeBaseRoot), knowledgeSnapshot, 'the isolated fixture Knowledge Base is unchanged by UX-001 Runtime operations')
  } finally {
    for (const release of releases) release()
    if (serverAfterRestart) await serverAfterRestart.close()
    if (runtimeAfterRestart) await runtimeAfterRestart.close()
    if (server) await server.close()
    if (runtime) await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})
