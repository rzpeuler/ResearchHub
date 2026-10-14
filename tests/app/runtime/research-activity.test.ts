import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationStateStore } from '../../../app/runtime/conversation-state-store.ts'
import { normalizeResearchRequest } from '../../../app/services/research-dispatch-contracts.ts'
import type { ResearchDispatchStart } from '../../../app/services/research-dispatch-service.ts'
import { createResearchHubTools, type ResearchHubPolicyContext } from '../../../app/pi/tools.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { serializeClientEvent } from '../../../app/runtime/event-stream.ts'
import { toSafeConversationMessage, researchContextPrompt } from '../../../app/runtime/session-runtime.ts'

function envelope(): ResearchDispatchStart {
  const request = normalizeResearchRequest({ query: 'write dsjm report', contextPolicy: { structuredKnowledge: false, sourceLibrary: false }, persistencePolicy: { writeKnowledge: false } })
  return { request, status: 'needs_clarification', decision: { mode: 'workflow', workflow: { id: 'company_research', confidence: 1, arguments: { name: 'dsjm' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy, rationale: 'Company report' }, summary: { mode: 'Free Research', workflowId: 'company_research', selectedSkillIds: [], argumentsStatus: 'missing', argumentKeys: ['name'], contextPolicy: request.contextPolicy, persistencePolicy: request.persistencePolicy }, clarification: { confirmationId: 'confirm-1', kind: 'security_selection', query: 'dsjm', workflowId: 'company_research', candidates: [{ candidateId: 'SZ-002384', name: 'Dongshan', symbol: '002384', exchange: 'SZ', matchKind: 'initials' }], missingFields: [], question: 'Select company', directoryVersion: 'v1' } }
}

test('pending clarification survives refresh and admits exactly one concurrent confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-clarification-'))
  try {
    let store = new ConversationStateStore({ rootDir: root })
    await store.ensure('session'); await store.acceptRequest('session', { operationId: 'op', requestText: 'write dsjm report' }); await store.claimSubmission('session', 'op')
    await store.recordDispatchEnvelope('session', 'op', envelope())
    store = new ConversationStateStore({ rootDir: root })
    assert.equal((await store.get('session'))?.acceptedRequests[0]?.lifecycle, 'needs_clarification')
    assert.equal(await store.recoverInterruptedDispatches(), 0)
    await assert.rejects(store.claimClarification('session', 'op', 'wrong', '1f51ac21-8555-40f6-aa3a-9849a23c1410'))
    const results = await Promise.all([store.claimClarification('session', 'op', 'confirm-1', '1f51ac21-8555-40f6-aa3a-9849a23c1410'), store.claimClarification('session', 'op', 'confirm-1', '24c8b18b-0f30-42fd-a226-43994456bb42')])
    assert.equal(results.filter(result => result.mayDispatch).length, 1)
    assert.deepEqual((await store.get('session'))?.acceptedRequests[0]?.dispatchEnvelope?.request.contextPolicy, { structuredKnowledge: false, sourceLibrary: false })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('automatic routing of a chat request records a Workflow start and naming without schema rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-automatic-start-'))
  try {
    const store = new ConversationStateStore({ rootDir: root })
    await store.ensure('session'); await store.acceptRequest('session', { operationId: 'op', requestText: 'write company report' }); await store.claimSubmission('session', 'op')
    await store.recordWorkflowCandidate('session', 'op', { workflowRegistryId: 'company_research', workflowSubject: 'Dongshan', titleCandidate: 'Dongshan report' })
    await store.markWorkflowStarted('session', 'op', { workflowRegistryId: 'company_research', workflowRunId: 'run-company' })
    const snapshot = (await store.get('session'))!
    assert.equal(snapshot.acceptedRequests[0]?.lifecycle, 'started'); assert.equal(snapshot.acceptedRequests[0]?.kind, 'workflow'); assert.equal(snapshot.title, 'Dongshan report')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v2 sidecars migrate single Workflow association and retain multiple tool links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-activity-migration-'))
  try {
    let store = new ConversationStateStore({ rootDir: root })
    await store.ensure('session'); await store.acceptRequest('session', { operationId: 'op', requestText: 'research company', workflowRegistryId: 'company_research' }); await store.claimSubmission('session', 'op')
    await store.markWorkflowStarted('session', 'op', { workflowRegistryId: 'company_research', workflowRunId: 'run-one' })
    const path = join(root, 'session.json'); const previous = JSON.parse(await readFile(path, 'utf8')); previous.schemaVersion = 2
    await writeFile(path, JSON.stringify(previous)); store = new ConversationStateStore({ rootDir: root })
    assert.deepEqual((await store.get('session'))?.acceptedRequests[0]?.linkedWorkflows, [{ runId: 'run-one', workflowRegistryId: 'company_research' }])
    await store.linkToolWorkflow('session', 'op', { runId: 'run-two', workflowRegistryId: 'valuation', toolCallId: 'tool-2' })
    await store.recordToolActivity('session', 'op', { toolCallId: 'tool-2', name: 'analyze_valuation', status: 'running', summary: 'Valuation started' })
    await store.recordToolActivity('session', 'op', { toolCallId: 'tool-2', name: 'analyze_valuation', status: 'completed', completedAt: new Date().toISOString() })
    await store.recordToolActivity('session', 'op', { toolCallId: 'tool-2', name: 'analyze_valuation', status: 'running' })
    const request = (await store.get('session'))!.acceptedRequests[0]!
    assert.equal(request.linkedWorkflows?.length, 2); assert.equal(request.toolActivities?.length, 1); assert.equal(request.toolActivities?.[0]?.status, 'completed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Agent stop releases tool wait while linked Workflow continues and remains separately cancellable', async () => {
  const workflowService = new WorkflowService()
  let finish!: () => void
  let callerSignal: AbortSignal | undefined
  const linked: string[] = []
  const policyContext: ResearchHubPolicyContext = { owner: { conversationId: 'session', operationId: 'op' }, onWorkflowStarted: async (owner, workflow) => { assert.equal(owner.operationId, 'op'); linked.push(workflow.runId) } }
  const researchService = { startResearchCompany: (input: { workflowRunId: string }, signal?: AbortSignal) => {
    callerSignal = signal; workflowService.register({ runId: input.workflowRunId, workflowType: 'company_research', objective: 'Company report' })
    return { runId: input.workflowRunId, completion: workflowService.start(input.workflowRunId, () => new Promise<{ status: 'completed' }>(resolve => { finish = () => resolve({ status: 'completed' }) })) }
  } } as never
  const tool = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService: {} as never, workflowService, researchService, policyContext }).find(tool => tool.name === 'research_company')!
  const controller = new AbortController()
  const pending = tool.execute('tool-1', { workflowRunId: 'run-independent', symbol: '002384' }, controller.signal, undefined, {} as never)
  controller.abort(); const result = await pending
  assert.equal(callerSignal, undefined); assert.deepEqual(linked, ['run-independent'])
  assert.equal((result as { isError?: boolean }).isError, true); assert.notEqual(workflowService.getWorkflowStatus('run-independent')?.status, 'cancelled')
  workflowService.cancelWorkflow('run-independent'); assert.equal(workflowService.getWorkflowStatus('run-independent')?.status, 'cancelled')
  finish()
})

test('document Workflow start retains explicit write authorization and captures owner before Agent stop', async () => {
  const workflowService = new WorkflowService(); const owners: string[] = []
  let finish!: () => void
  const policyContext: ResearchHubPolicyContext = { current: { writeKnowledge: true, structuredKnowledge: true, sourceLibrary: true }, owner: { conversationId: 'session', operationId: 'ingest-op' }, onWorkflowStarted: async (owner) => { owners.push(owner.operationId) } }
  const productionService = { startIngestDocument: (input: { workflowRunId: string }, signal?: AbortSignal) => {
    assert.equal(signal, undefined); assert.equal(policyContext.current?.writeKnowledge, true)
    workflowService.register({ runId: input.workflowRunId, workflowType: 'raw_document_knowledge_ingestion', objective: 'Document ingestion' })
    return { runId: input.workflowRunId, completion: workflowService.start(input.workflowRunId, () => new Promise<{ status: 'completed' }>(resolve => { finish = () => resolve({ status: 'completed' }) })) }
  } } as never
  const tool = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService, workflowService, policyContext }).find(tool => tool.name === 'ingest_document')!
  const controller = new AbortController(); const pending = tool.execute('ingest-tool', { workflowRunId: 'ingest-independent', text: 'fixture evidence' }, controller.signal, undefined, {} as never)
  policyContext.owner = { conversationId: 'session', operationId: 'next-op' }; policyContext.current = { writeKnowledge: false, structuredKnowledge: false, sourceLibrary: false }
  controller.abort(); await pending
  assert.deepEqual(owners, ['ingest-op']); assert.equal(workflowService.getWorkflowStatus('ingest-independent')?.status, 'running')
  workflowService.cancelWorkflow('ingest-independent'); finish()
})

test('blank assistant tool messages are omitted and activity SSE carries only stable safe fields', () => {
  assert.equal(toSafeConversationMessage({ role: 'assistant', content: [{ type: 'toolCall', name: 'research_company', arguments: { secret: 'private' } }] }), undefined)
  const frame = serializeClientEvent({ type: 'activity.updated', eventId: 'event-1', conversationId: 'session', operationId: 'op', timestamp: new Date().toISOString(), rawArguments: { secret: 'private' }, summary: 'private' })
  assert.match(frame, /event: activity.updated/); assert.equal(frame.includes('private'), false); assert.match(frame, /"operationId":"op"/)
})

test('Runtime-appended research context is removed only from trailing user snapshot projection', () => {
  const suffix = researchContextPrompt({ selectedSkills: [], sourceLibraryHits: [], entities: [], evidenceRefs: [] })
  assert.equal(toSafeConversationMessage({ role: 'user', content: `Research company${suffix}` })?.content, 'Research company')
  assert.equal(toSafeConversationMessage({ role: 'user', content: `Discuss marker${suffix}\nThis is my text.` })?.content.includes('This is my text.'), true)
})
