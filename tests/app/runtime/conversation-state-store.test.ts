import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ConversationStateStore,
  ConversationStateStoreError,
  DEFAULT_CONVERSATION_TITLE,
  firstMessageTitleFromText,
  normalizeConversationId,
  normalizeConversationTitle,
} from '../../../app/runtime/conversation-state-store.ts'

const BASE_TIME = Date.parse('2026-10-12T08:00:00.000Z')

async function fixture(): Promise<{ root: string; stateRoot: string; store: ConversationStateStore; close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-conversation-state-'))
  const stateRoot = join(root, 'runtime-data', 'conversation-state')
  let tick = 0
  return {
    root,
    stateRoot,
    store: new ConversationStateStore({ rootDir: stateRoot, now: () => new Date(BASE_TIME + tick++).toISOString() }),
    close: () => rm(root, { recursive: true, force: true }),
  }
}

function expectStoreError(error: unknown, code: ConversationStateStoreError['code']): void {
  assert.ok(error instanceof ConversationStateStoreError)
  assert.equal(error.code, code)
}

test('normalizes Unicode titles and applies the deterministic first-message rule', () => {
  assert.equal(normalizeConversationId('pi-0192ab_cdef'), 'pi-0192ab_cdef')
  assert.throws(() => normalizeConversationId('../escape'), (error) => { expectStoreError(error, 'invalid_input'); return true })
  assert.throws(() => normalizeConversationId('session/name'), (error) => { expectStoreError(error, 'invalid_input'); return true })
  assert.equal(normalizeConversationTitle('  Research\n  company\tupdate  '), 'Research company update')
  assert.equal(firstMessageTitleFromText('  公司 😊\n研究  '), '公司 😊 研究')
  const title = firstMessageTitleFromText('界'.repeat(25))
  assert.equal(Array.from(title).length, 25)
  assert.equal(title, `${'界'.repeat(24)}…`)
  assert.equal(firstMessageTitleFromText('👨‍👩‍👧‍👦'.repeat(25)), `${'👨‍👩‍👧‍👦'.repeat(24)}…`)
  assert.equal(firstMessageTitleFromText('Contact alice@example.com'), DEFAULT_CONVERSATION_TITLE)
  assert.equal(firstMessageTitleFromText('Call 13800138000'), DEFAULT_CONVERSATION_TITLE)
  assert.equal(firstMessageTitleFromText(' \n '), DEFAULT_CONVERSATION_TITLE)
  assert.throws(() => normalizeConversationTitle('alice@example.com'), (error) => { expectStoreError(error, 'invalid_input'); assert.equal((error as Error).message.includes('alice@example.com'), false); return true })
  assert.throws(() => normalizeConversationTitle('13800138000'), (error) => { expectStoreError(error, 'invalid_input'); return true })
  assert.throws(() => normalizeConversationTitle('界'.repeat(201)), (error) => { expectStoreError(error, 'invalid_input'); return true })
})

test('title priority is DEFAULT < FIRST_MESSAGE < WORKFLOW < USER, with permanent USER lock', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('title-session')
    const accepted = await f.store.acceptRequest('title-session', { kind: 'workflow', operationId: 'first-run', requestText: '帮我研究002640', workflowRegistryId: 'company.deep-research' })
    const first = accepted.state
    assert.equal(first.titleSource, 'FIRST_MESSAGE')
    assert.equal(first.title, '帮我研究002640')
    assert.equal(first.flags.firstMessageTitleConsumed, true)
    assert.equal((await f.store.claimSubmission('title-session', 'first-run')).mayDispatch, true)
    const workflow = await f.store.markWorkflowStarted('title-session', 'first-run', { workflowRegistryId: 'company.deep-research', workflowRunId: 'run-1', titleCandidate: '跨境通 · 公司深度研究' })
    assert.equal(workflow.titleSource, 'WORKFLOW')
    assert.equal(workflow.title, '跨境通 · 公司深度研究')
    assert.equal(workflow.flags.firstWorkflowNamingOpportunityConsumed, true)

    const user = await f.store.renameConversation('title-session', '  我的标题  ')
    assert.equal(user.title, '我的标题')
    assert.equal(user.titleSource, 'USER')
    await f.store.setFirstMessageTitle('title-session', 'later first message')
    await assert.rejects(f.store.transact('title-session', (state) => ({ ...state, title: 'bypass attempt', titleSource: 'WORKFLOW' })), (error) => { expectStoreError(error, 'conflict'); return true })
    await f.store.acceptRequest('title-session', { kind: 'workflow', operationId: 'second-run', requestText: 'another request', workflowRegistryId: 'company.deep-research' })
    assert.equal((await f.store.claimSubmission('title-session', 'second-run')).mayDispatch, true)
    const later = await f.store.markWorkflowStarted('title-session', 'second-run', { workflowRegistryId: 'company.deep-research', workflowRunId: 'run-2', titleCandidate: '不得覆盖用户标题' })
    assert.equal(later.title, '我的标题')
    assert.equal(later.titleSource, 'USER')
  } finally { await f.close() }
})

test('the first successful Workflow start consumes naming opportunity even without a title candidate', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('one-shot-session')
    await f.store.setFirstMessageTitle('one-shot-session', '首次研究请求')
    await f.store.acceptRequest('one-shot-session', { kind: 'workflow', operationId: 'run-a', requestText: 'a', workflowRegistryId: 'company.deep-research' })
    await f.store.claimSubmission('one-shot-session', 'run-a')
    const firstStart = await f.store.markWorkflowStarted('one-shot-session', 'run-a', { workflowRegistryId: 'company.deep-research', workflowRunId: 'workflow-a' })
    assert.equal(firstStart.title, '首次研究请求')
    assert.equal(firstStart.titleSource, 'FIRST_MESSAGE')
    assert.equal(firstStart.flags.firstWorkflowNamingOpportunityConsumed, true)

    await f.store.acceptRequest('one-shot-session', { kind: 'workflow', operationId: 'run-b', requestText: 'b', workflowRegistryId: 'company.deep-research' })
    await f.store.claimSubmission('one-shot-session', 'run-b')
    const later = await f.store.markWorkflowStarted('one-shot-session', 'run-b', { workflowRegistryId: 'company.deep-research', workflowRunId: 'workflow-b', titleCandidate: 'second Workflow title' })
    assert.equal(later.title, '首次研究请求')
    assert.equal(later.titleSource, 'FIRST_MESSAGE')
  } finally { await f.close() }
})

test('revision checks reject stale writes and archive/restore preserves all state', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('revision-session')
    await f.store.acceptRequest('revision-session', { kind: 'chat', operationId: 'accepted', requestText: 'persist this request' })
    const renamed = await f.store.renameConversation('revision-session', '用户标题', 1)
    assert.equal(renamed.revision, 2)
    await assert.rejects(f.store.renameConversation('revision-session', 'stale title', 1), (error) => { expectStoreError(error, 'conflict'); return true })
    const archived = await f.store.archiveConversation('revision-session', true, 2)
    assert.equal(archived.archived, true)
    assert.equal(typeof archived.archivedAt, 'string')
    assert.equal(archived.acceptedRequests.length, 1)
    assert.equal(archived.title, '用户标题')
    const restored = await f.store.archiveConversation('revision-session', false, 3)
    assert.equal(restored.archived, false)
    assert.equal(restored.archivedAt, undefined)
    assert.equal(restored.acceptedRequests[0]?.requestText, 'persist this request')
  } finally { await f.close() }
})

test('concurrent rename and archive mutations sharing a revision commit one writer and reject the stale loser', async () => {
  const renameFirst = await fixture()
  try {
    const initial = await renameFirst.store.ensure('rename-first-session')
    const [rename, archive] = await Promise.allSettled([
      renameFirst.store.renameConversation('rename-first-session', '用户标题', initial.revision),
      renameFirst.store.archiveConversation('rename-first-session', true, initial.revision),
    ])
    assert.equal(rename.status, 'fulfilled')
    assert.equal(archive.status, 'rejected')
    if (archive.status === 'rejected') expectStoreError(archive.reason, 'conflict')
    const renamed = await renameFirst.store.get('rename-first-session')
    assert.equal(renamed?.title, '用户标题')
    assert.equal(renamed?.titleSource, 'USER')
    assert.equal(renamed?.archived, false)
    assert.equal(renamed?.revision, initial.revision + 1)
  } finally { await renameFirst.close() }

  const archiveFirst = await fixture()
  try {
    const initial = await archiveFirst.store.ensure('archive-first-session')
    const [archive, rename] = await Promise.allSettled([
      archiveFirst.store.archiveConversation('archive-first-session', true, initial.revision),
      archiveFirst.store.renameConversation('archive-first-session', '过期标题', initial.revision),
    ])
    assert.equal(archive.status, 'fulfilled')
    assert.equal(rename.status, 'rejected')
    if (rename.status === 'rejected') expectStoreError(rename.reason, 'conflict')
    const final = await archiveFirst.store.get('archive-first-session')
    assert.equal(final?.archived, true)
    assert.equal(final?.title, DEFAULT_CONVERSATION_TITLE)
    assert.equal(final?.revision, initial.revision + 1)
  } finally { await archiveFirst.close() }
})

test('operationId replay is idempotent only for an identical text and Workflow intent', async () => {
  const f = await fixture()
  try {
    const first = await f.store.acceptRequest('idempotent-session', { kind: 'workflow', operationId: 'submit-1', requestText: '研究公司', workflowRegistryId: 'company.deep-research' })
    assert.equal(first.duplicate, false)
    assert.equal(first.request.acceptedWorkflowRegistryId, 'company.deep-research')
    const same = await f.store.acceptRequest('idempotent-session', { kind: 'workflow', operationId: 'submit-1', requestText: '研究公司', workflowRegistryId: 'company.deep-research' })
    assert.equal(same.duplicate, true)
    assert.equal(same.state.revision, first.state.revision)
    await assert.rejects(f.store.acceptRequest('idempotent-session', { kind: 'workflow', operationId: 'submit-1', requestText: '研究不同公司', workflowRegistryId: 'company.deep-research' }), (error) => { expectStoreError(error, 'conflict'); return true })
    await assert.rejects(f.store.acceptRequest('idempotent-session', { kind: 'workflow', operationId: 'submit-1', requestText: '研究公司', workflowRegistryId: 'industry.deep-research' }), (error) => { expectStoreError(error, 'conflict'); return true })
    await assert.rejects(f.store.acceptRequest('idempotent-session', { kind: 'chat', operationId: 'submit-1', requestText: '研究公司' }), (error) => { expectStoreError(error, 'conflict'); return true })
    await assert.rejects(f.store.acceptRequest('idempotent-session', { kind: 'chat', operationId: 'submit-2', requestText: 'api_key=sk-012345678901234567890123' }), (error) => { expectStoreError(error, 'invalid_input'); return true })
    await assert.rejects(f.store.acceptRequest('empty-session', { operationId: 'empty-request', requestText: ' \n\t ', operation: 'prompt' }), (error) => { expectStoreError(error, 'invalid_input'); return true })
    assert.equal(await f.store.get('empty-session'), undefined)

    const pii = await f.store.acceptRequest('pii-title-session', { operationId: 'pii-title', requestText: 'Contact alice@example.com about research.', operation: 'prompt' })
    assert.equal(pii.state.title, DEFAULT_CONVERSATION_TITLE)
    await assert.rejects(f.store.renameConversation('pii-title-session', 'Call 13800138000'), (error) => { expectStoreError(error, 'invalid_input'); return true })
  } finally { await f.close() }
})

test('concurrent per-session updates serialize without losing accepted requests', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('concurrent-session')
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => f.store.acceptRequest('concurrent-session', { kind: 'chat', operationId: `operation-${index}`, requestText: `request ${index}` })))
    assert.ok(results.every((result) => result.status === 'fulfilled'))
    const state = await f.store.get('concurrent-session')
    assert.equal(state?.acceptedRequests.length, 20)
    assert.equal(new Set(state?.acceptedRequests.map((request) => request.operationId)).size, 20)
    assert.equal(state?.revision, 20)
  } finally { await f.close() }
})

test('generic submission completion records Pi chat and known not-started outcomes without Workflow naming', async () => {
  const f = await fixture()
  try {
    await f.store.acceptRequest('chat-session', { kind: 'chat', operationId: 'chat-op', requestText: 'chat request' })
    assert.equal((await f.store.claimSubmission('chat-session', 'chat-op')).mayDispatch, true)
    assert.equal((await f.store.claimSubmission('chat-session', 'chat-op')).mayDispatch, false)
    const started = await f.store.completeSubmission('chat-session', 'chat-op', { kind: 'chat', outcome: 'started' })
    assert.equal(started.acceptedRequests[0]?.outcome, 'chat_started')
    assert.equal(started.flags.firstWorkflowNamingOpportunityConsumed, false)
    assert.equal((await f.store.completeSubmission('chat-session', 'chat-op', { kind: 'chat', outcome: 'started' })).revision, started.revision)

    await f.store.acceptRequest('needs-input-session', { kind: 'workflow', operationId: 'needs-input', requestText: 'incomplete research request' })
    await f.store.claimSubmission('needs-input-session', 'needs-input')
    const notStarted = await f.store.completeSubmission('needs-input-session', 'needs-input', { kind: 'workflow', outcome: 'not_started', reasonCode: 'needs_input' })
    assert.equal(notStarted.acceptedRequests[0]?.lifecycle, 'not_started')
    assert.equal(notStarted.flags.firstWorkflowNamingOpportunityConsumed, false)
    assert.equal((await f.store.claimSubmission('needs-input-session', 'needs-input')).mayDispatch, false)
  } finally { await f.close() }
})

test('accepted prompt moves through workflow or ready_for_chat once and reserves stable run identity', async () => {
  const f = await fixture()
  try {
    await f.store.acceptRequest('workflow-route', { operation: 'prompt', operationId: 'needs-input-route', requestText: '补齐报告期间', workflowRegistryId: 'earnings_review' })
    await assert.rejects(f.store.claimChatCommand('workflow-route', 'needs-input-route'), (error) => { expectStoreError(error, 'conflict'); return true })
    const reservedRunId = '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e'
    assert.equal((await f.store.claimSubmission('workflow-route', 'needs-input-route', reservedRunId)).mayDispatch, true)
    const duplicateClaim = await f.store.claimSubmission('workflow-route', 'needs-input-route', '659a5bfd-66fb-478b-9a3a-26f10c071452')
    assert.equal(duplicateClaim.mayDispatch, false)
    assert.equal(duplicateClaim.state.acceptedRequests[0]?.reservedWorkflowRunId, reservedRunId)
    const needsInput = await f.store.markNotStarted('workflow-route', 'needs-input-route', 'needs_input')
    assert.equal(needsInput.acceptedRequests[0]?.lifecycle, 'not_started')
    assert.equal((await f.store.claimSubmission('workflow-route', 'needs-input-route')).mayDispatch, false)
    assert.equal(needsInput.flags.firstWorkflowNamingOpportunityConsumed, false)

    await f.store.acceptRequest('chat-route', { operation: 'prompt', operationId: 'free-route', requestText: '自由研究请求' })
    await f.store.claimSubmission('chat-route', 'free-route', reservedRunId)
    await f.store.markReadyForChat('chat-route', 'free-route', 'free_research')
    assert.equal((await f.store.claimChatCommand('chat-route', 'free-route')).mayDispatch, true)
    const chatStarted = await f.store.completeSubmission('chat-route', 'free-route', { kind: 'chat', outcome: 'started' })
    assert.equal(chatStarted.acceptedRequests[0]?.lifecycle, 'started')
    assert.equal(chatStarted.acceptedRequests[0]?.outcome, 'chat_started')
    assert.equal((await f.store.claimChatCommand('chat-route', 'free-route')).mayDispatch, false)
  } finally { await f.close() }
})

test('atomic sidecar writes reload complete private state', async () => {
  const f = await fixture()
  try {
    await f.store.acceptRequest('reload-session', { kind: 'chat', operationId: 'submit-2', requestText: '帮我研究002640' })
    await f.store.renameConversation('reload-session', '重启后仍保留')
    const files = await readdir(f.stateRoot)
    assert.deepEqual(files, ['reload-session.json'])
    const fileStat = await stat(join(f.stateRoot, files[0]!))
    if (process.platform !== 'win32') {
      assert.equal(fileStat.mode & 0o777, 0o600)
      assert.equal((await stat(f.stateRoot)).mode & 0o777, 0o700)
    }
    const restored = await new ConversationStateStore({ rootDir: f.stateRoot, now: () => new Date(BASE_TIME).toISOString() }).get('reload-session')
    assert.equal(restored?.title, '重启后仍保留')
    assert.equal(restored?.titleSource, 'USER')
    assert.equal(restored?.acceptedRequests[0]?.requestText, '帮我研究002640')
  } finally { await f.close() }
})

test('ambiguous dispatches recover as interrupted and are never redispatched', async () => {
  const f = await fixture()
  try {
    await f.store.acceptRequest('recovery-session', { kind: 'workflow', operationId: 'submit-3', requestText: 'start company research' })
    assert.equal((await f.store.claimSubmission('recovery-session', 'submit-3')).mayDispatch, true)
    const restarted = new ConversationStateStore({ rootDir: f.stateRoot, now: () => new Date(BASE_TIME + 500).toISOString() })
    assert.equal(await restarted.recoverInterruptedDispatches(), 1)
    assert.equal((await restarted.get('recovery-session'))?.acceptedRequests[0]?.lifecycle, 'interrupted')
    assert.equal((await restarted.claimSubmission('recovery-session', 'submit-3')).mayDispatch, false)
    assert.equal(await restarted.recoverInterruptedDispatches(), 0)

    await restarted.acceptRequest('started-before-crash', { operation: 'prompt', operationId: 'started-run', requestText: 'started before crash', workflowRegistryId: 'company_research' })
    await restarted.claimSubmission('started-before-crash', 'started-run', '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e')
    await restarted.markWorkflowStarted('started-before-crash', 'started-run', { workflowRegistryId: 'company_research', workflowRunId: '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e', startedAt: '2026-10-12T08:00:01.000Z' })
    const afterCrash = new ConversationStateStore({ rootDir: f.stateRoot, now: () => new Date(BASE_TIME + 600).toISOString() })
    assert.equal(await afterCrash.recoverInterruptedDispatches(), 1)
    const interruptedStarted = (await afterCrash.get('started-before-crash'))?.acceptedRequests[0]
    assert.equal(interruptedStarted?.lifecycle, 'interrupted')
    assert.equal(interruptedStarted?.workflowRunId, '75ba7d5a-49a4-4fa3-9dca-14626fa17d4e')
    assert.equal(interruptedStarted?.startedAt, '2026-10-12T08:00:01.000Z')
    assert.equal(interruptedStarted?.outcome, undefined)
    assert.equal((await afterCrash.claimSubmission('started-before-crash', 'started-run')).mayDispatch, false)
  } finally { await f.close() }
})

test('corrupt records and unknown schema versions fail closed', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('corrupt-session')
    await writeFile(join(f.stateRoot, 'corrupt-session.json'), '{broken', 'utf8')
    await assert.rejects(f.store.get('corrupt-session'), (error) => { expectStoreError(error, 'corrupt'); return true })
    await writeFile(join(f.stateRoot, 'future-session.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8')
    await assert.rejects(f.store.get('future-session'), (error) => { expectStoreError(error, 'unsupported_version'); return true })
  } finally { await f.close() }
})

test('sidecar identity is bound to its safe Pi session ID', async () => {
  const f = await fixture()
  try {
    await f.store.ensure('bound-session')
    const path = join(f.stateRoot, 'bound-session.json')
    const state = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    state.conversationId = 'different-session'
    await writeFile(path, JSON.stringify(state), 'utf8')
    await assert.rejects(f.store.get('bound-session'), (error) => { expectStoreError(error, 'corrupt'); return true })
  } finally { await f.close() }
})

test('conversation sidecar root rejects a symlink destination', async () => {
  const f = await fixture()
  try {
    const realRoot = join(f.root, 'real-state')
    const linkedRoot = join(f.root, 'linked-state')
    await mkdir(realRoot)
    await symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const unsafeStore = new ConversationStateStore({ rootDir: linkedRoot })
    await assert.rejects(unsafeStore.ensure('symlink-session'), (error) => { expectStoreError(error, 'io'); return true })
    assert.deepEqual(await readdir(realRoot), [])
  } finally { await f.close() }
})
