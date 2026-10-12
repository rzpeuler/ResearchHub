import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ClientEventAdapter } from '../../../app/runtime/client-events.ts'
import { ClientEventStream, serializeClientEvent } from '../../../app/runtime/event-stream.ts'
import { toSafeConversationMessage } from '../../../app/runtime/session-runtime.ts'
import { RuntimeSecurity, RuntimeSecurityError, assertLoopbackBindAddress, type RuntimeSecurityRequest } from '../../../app/runtime/security.ts'

type TestSession = AgentSession & { emit(event: AgentSessionEvent): void }

function fakeSession(sessionId: string): TestSession {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  return {
    sessionId: sessionId,
    subscribe(listener: (event: AgentSessionEvent) => void) { listeners.add(listener); return () => listeners.delete(listener) },
    emit(event: AgentSessionEvent) { for (const listener of [...listeners]) listener(event) },
  } as unknown as TestSession
}

function baseEvent(type: string): AgentSessionEvent {
  return { type, message: { role: 'assistant', timestamp: Date.now(), content: [] } } as unknown as AgentSessionEvent
}

test('Slice B projects bounded safe events and never forwards thinking, tool payloads, paths, or stacks', () => {
  const oldSession = fakeSession('old-conversation')
  const newSession = fakeSession('new-conversation')
  const adapter = new ClientEventAdapter()
  const events: unknown[] = []
  adapter.subscribe((event) => events.push(event))
  adapter.bind(oldSession)

  const secret = 'THINKING_SECRET C:\\private\\report.pdf command=rm -rf /tmp/private api_key=hidden'
  oldSession.emit(baseEvent('agent_start'))
  oldSession.emit({
    type: 'message_update',
    message: { role: 'assistant', timestamp: Date.now(), content: [] },
    assistantMessageEvent: { type: 'thinking_delta', delta: secret, partial: {} },
  } as unknown as AgentSessionEvent)
  oldSession.emit({
    type: 'message_update',
    message: { role: 'assistant', timestamp: Date.now(), content: [] },
    assistantMessageEvent: { type: 'text_delta', delta: `safe result C:\\private\\report.pdf /var/private/report.txt ../private/report.txt ./internal/config Authorization: Bearer TOP_SECRET`, partial: {} },
  } as unknown as AgentSessionEvent)
  oldSession.emit({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: secret, path: 'C:\\private\\report.pdf' } } as unknown as AgentSessionEvent)
  oldSession.emit({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'bash', result: { content: [{ type: 'text', text: secret }], stack: 'Error: secret stack' }, isError: true } as unknown as AgentSessionEvent)
  oldSession.emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: secret, content: [], timestamp: Date.now() } } as unknown as AgentSessionEvent)

  const beforeRebind = events.length
  adapter.rebind(newSession)
  oldSession.emit(baseEvent('agent_start'))
  newSession.emit(baseEvent('agent_start'))
  newSession.emit({ type: 'queue_update', steering: ['hidden prompt'], followUp: ['another prompt'] } as unknown as AgentSessionEvent)
  adapter.dispose()

  const serialized = JSON.stringify(events)
  assert.equal(events.length > beforeRebind, true)
  assert.equal(events.filter((event) => (event as { type?: string }).type === 'session.changed').length, 1)
  assert.equal(serialized.includes('THINKING_SECRET'), false)
  assert.equal(serialized.includes('private\\report.pdf'), false)
  assert.equal(serialized.includes('rm -rf'), false)
  assert.equal(serialized.includes('secret stack'), false)
  assert.equal(serialized.includes('api_key'), false)
  assert.equal(serialized.includes('TOP_SECRET'), false)
  assert.equal(serialized.includes('../'), false)
  assert.equal(serialized.includes('./'), false)
  assert.equal(serialized.includes('internal/config'), false)
  assert.equal(events.some((event) => (event as { type?: string }).type === 'thinking.status'), true)
  assert.equal(events.some((event) => (event as { type?: string }).type === 'tool.completed'), true)
  assert.equal(events.some((event) => (event as { type?: string }).type === 'error'), true)
  assert.equal(events.every((event) => Object.keys(event as object).every((key) => !['args', 'result', 'partialResult', 'stack', 'delta'].includes(key))), true)
})

test('Slice B correlates a persisted Pi user SessionEntry by exact message object and accepted operation', () => {
  const session = fakeSession('identity-session')
  const persisted: Array<{ conversationId: string; operationId: string; piMessageId: string }> = []
  const adapter = new ClientEventAdapter((conversationId, operationId, piMessageId) => persisted.push({ conversationId, operationId, piMessageId }))
  const events: import('../../../app/runtime/client-events.ts').ClientEvent[] = []
  adapter.subscribe((event) => events.push(event))
  adapter.bind(session)

  const firstMessage = { role: 'user', content: 'same text', timestamp: Date.now() }
  adapter.setActiveOperationId('operation-one')
  session.emit({ type: 'message_start', message: firstMessage } as unknown as AgentSessionEvent)
  session.emit({ type: 'entry_appended', entry: { type: 'message', id: 'entry-one', parentId: null, timestamp: new Date().toISOString(), message: firstMessage } } as unknown as AgentSessionEvent)

  const secondMessage = { role: 'user', content: 'same text', timestamp: Date.now() }
  adapter.setActiveOperationId('operation-two')
  session.emit({ type: 'message_start', message: secondMessage } as unknown as AgentSessionEvent)
  session.emit({ type: 'entry_appended', entry: { type: 'message', id: 'entry-two', parentId: 'entry-one', timestamp: new Date().toISOString(), message: secondMessage } } as unknown as AgentSessionEvent)
  session.emit({ type: 'entry_appended', entry: { type: 'message', id: 'unmatched-entry', parentId: 'entry-two', timestamp: new Date().toISOString(), message: { role: 'user', content: 'same text' } } } as unknown as AgentSessionEvent)

  assert.deepEqual(persisted, [
    { conversationId: 'identity-session', operationId: 'operation-one', piMessageId: 'entry-one' },
    { conversationId: 'identity-session', operationId: 'operation-two', piMessageId: 'entry-two' },
  ])
  assert.equal(events.filter((event) => event.type === 'message.started').every((event) => event.operationId !== undefined), true)
  adapter.dispose()
})

test('Slice B Adapter redacts bare Bearer credentials and bare commands in text summaries', () => {
  const session = fakeSession('adapter-summary-security')
  const adapter = new ClientEventAdapter()
  const events: unknown[] = []
  adapter.subscribe((event) => events.push(event))
  adapter.bind(session)
  session.emit({
    type: 'message_update',
    message: { role: 'assistant', timestamp: Date.now(), content: [] },
    assistantMessageEvent: { type: 'text_delta', delta: 'Bearer sk-live-SECRET ghp_TESTTOKEN AKIA1234567890ABCDEF -----BEGIN PRIVATE KEY----- then rm -rf /tmp/private at /etc and / with key=TOP_SECRET \\private\\report.txt', partial: {} },
  } as unknown as AgentSessionEvent)
  const serialized = JSON.stringify(events)
  assert.equal(serialized.includes('sk-live-SECRET'), false)
  assert.equal(serialized.includes('rm -rf'), false)
  assert.equal(serialized.includes('/tmp/private'), false)
  assert.equal(serialized.includes('/etc'), false)
  assert.equal(serialized.includes('located at /'), false)
  assert.equal(serialized.includes('TOP_SECRET'), false)
  assert.equal(serialized.includes('\\private\\report.txt'), false)
  assert.equal(serialized.includes('ghp_TESTTOKEN'), false)
  assert.equal(serialized.includes('AKIA1234567890ABCDEF'), false)
  assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false)
  assert.equal((events[0] as { summary?: string }).summary, '[redacted]')
  adapter.dispose()
})

test('Slice B Adapter guards malformed Pi event shapes without throwing', () => {
  const session = fakeSession('malformed-events')
  const adapter = new ClientEventAdapter()
  const events: unknown[] = []
  adapter.subscribe((event) => events.push(event))
  adapter.bind(session)
  const malformedEvents: unknown[] = [
    null,
    undefined,
    {},
    { type: 'message_update', assistantMessageEvent: null },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: { raw: 'secret' } } },
    { type: 'agent_end', willRetry: 'true', messages: null },
    { type: 'queue_update', steering: null, followUp: [] },
    { type: 'queue_update', steering: [], followUp: 'not-an-array' },
  ]
  for (const event of malformedEvents) assert.doesNotThrow(() => session.emit(event as AgentSessionEvent))
  assert.equal(events.every((event) => !JSON.stringify(event).includes('secret')), true)
  assert.equal(events.every((event) => !Object.keys(event as object).some((key) => ['args', 'result', 'raw', 'stack'].includes(key))), true)
  adapter.dispose()
})

test('Slice B conversation message timestamp validation falls back to undefined', () => {
  for (const timestamp of [NaN, Infinity, -Infinity, Number.MAX_VALUE, 'not-a-date']) {
    let message: ReturnType<typeof toSafeConversationMessage>
    assert.doesNotThrow(() => { message = toSafeConversationMessage({ role: 'assistant', content: 'safe', timestamp }) })
    assert.equal(message!.timestamp, undefined)
  }
})

test('Slice B getCurrentMessages redacts historical user and assistant sensitive text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-slice-b-'))
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  const sessionDir = join(root, 'sessions')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-slice-b-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir, modelRuntime, model: faux.getModel() })
    const secret = 'Bearer sk-live-SECRET ghp_TESTTOKEN AKIA1234567890ABCDEF -----BEGIN PRIVATE KEY----- key=TOP_SECRET rm -rf /tmp/private /etc / ../private ./internal C:\\private'
    faux.setResponses([fauxAssistantMessage(secret)])
    await runtime.sessionRuntime.prompt(secret)
    const messages = runtime.sessionRuntime.getCurrentMessages()
    const serialized = JSON.stringify(messages)
    assert.equal(messages.some((message) => message.role === 'user'), true)
    assert.equal(messages.some((message) => message.role === 'assistant'), true)
    assert.equal(serialized.includes('sk-live-SECRET'), false)
    assert.equal(serialized.includes('TOP_SECRET'), false)
    assert.equal(serialized.includes('rm -rf'), false)
    assert.equal(serialized.includes('/tmp/private'), false)
    assert.equal(serialized.includes('/etc'), false)
    assert.equal(serialized.includes('../'), false)
    assert.equal(serialized.includes('./'), false)
    assert.equal(serialized.includes('C:\\private'), false)
    assert.equal(serialized.includes('ghp_TESTTOKEN'), false)
    assert.equal(serialized.includes('AKIA1234567890ABCDEF'), false)
    assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false)
    assert.equal(messages.filter((message) => message.role === 'user' || message.role === 'assistant').every((message) => message.content === '[redacted]'), true)
  } finally {
    await runtime?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Slice B projects sensitive conversation names before Pi persistence and client reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-slice-b-name-'))
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'agent')
  const sessionDir = join(root, 'sessions')
  await mkdir(cwd, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-name-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
  try {
    runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir, modelRuntime, model: faux.getModel() })
    const sensitiveName = 'Research Bearer sk-live-SECRET ghp_TESTTOKEN AKIA1234567890ABCDEF -----BEGIN PRIVATE KEY----- rm -rf /tmp/private /etc'
    const created = await runtime.sessionRuntime.createConversation(sensitiveName)
    assert.equal(created.name, '[redacted]')
    assert.equal(runtime.sessionRuntime.getCurrentState().name, '[redacted]')
    faux.setResponses([fauxAssistantMessage('safe session content')])
    await runtime.sessionRuntime.prompt('safe session content')
    const listed = await runtime.sessionRuntime.listConversations()
    const listedCreated = listed.find((conversation) => conversation.conversationId === created.conversationId)
    assert.equal(listedCreated?.name, '[redacted]')
    await runtime.close()
    runtime = undefined
    const persistedFiles = (await readdir(sessionDir)).filter((file) => file.endsWith('.jsonl'))
    const persisted = (await Promise.all(persistedFiles.map((file) => readFile(join(sessionDir, file), 'utf8')))).join('\n')
    assert.equal(persisted.includes('sk-live-SECRET'), false)
    assert.equal(persisted.includes('ghp_TESTTOKEN'), false)
    assert.equal(persisted.includes('AKIA1234567890ABCDEF'), false)
    assert.equal(persisted.includes('BEGIN PRIVATE KEY'), false)
    assert.equal(persisted.includes('rm -rf'), false)
    assert.equal(persisted.includes('/tmp/private'), false)
  } finally {
    await runtime?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Slice B event stream serializes normalized frames and cleans up subscribers', () => {
  const stream = new ClientEventStream(2)
  const frames: string[] = []
  const event = { eventId: 'conversation:1', conversationId: 'conversation', timestamp: new Date(0).toISOString(), type: 'agent.started', summary: 'Agent started' } as const
  const unsubscribe = stream.subscribe((frame) => frames.push(frame))
  stream.publish(event)
  assert.equal(stream.subscriberCount, 1)
  assert.match(frames[0], /^id: conversation:1\nevent: agent\.started\ndata: /)
  assert.match(frames[0], /"summary":"Agent started"/)
  unsubscribe()
  stream.publish(event)
  assert.equal(frames.length, 1)
  assert.equal(stream.subscriberCount, 0)
  const boundedFrame = serializeClientEvent({ ...event, summary: 'x'.repeat(20_000) })
  assert.equal(boundedFrame.length < 16_384, true)
  assert.equal((JSON.parse(boundedFrame.split('data: ')[1].split('\n')[0]) as { summary: string }).summary.length <= 2_000, true)
  stream.clear()
})

test('Slice B SSE preserves safe message deltas longer than the summary limit and carries operation identity', () => {
  const delta = ` streamed-word \n  ${'streamed-word '.repeat(38)}tail `
  const frame = serializeClientEvent({ eventId: 'conversation:delta', conversationId: 'conversation', operationId: 'operation-123', timestamp: new Date(0).toISOString(), type: 'message.delta', role: 'assistant', summary: delta })
  const data = JSON.parse(frame.split('data: ')[1]!.split('\n')[0]!) as { operationId?: string; summary?: string }
  assert.equal(data.operationId, 'operation-123')
  assert.equal(data.summary, delta)
  assert.equal(data.summary!.length > 240, true)

  const unsafe = serializeClientEvent({ eventId: 'conversation:unsafe-delta', conversationId: 'conversation', operationId: 'operation-124', timestamp: new Date(0).toISOString(), type: 'message.delta', role: 'assistant', summary: 'Authorization: Bearer TOP_SECRET' })
  assert.equal(JSON.stringify(JSON.parse(unsafe.split('data: ')[1]!.split('\n')[0]!)).includes('TOP_SECRET'), false)
})

test('Slice B removes a failing subscriber while continuing delivery to healthy subscribers', () => {
  const stream = new ClientEventStream(3)
  const event = { eventId: 'conversation:2', conversationId: 'conversation', timestamp: new Date(0).toISOString(), type: 'agent.started', summary: 'Agent started' } as const
  let failingCalls = 0
  let healthyCalls = 0
  stream.subscribe(() => { failingCalls += 1; throw new Error('disconnected client') })
  stream.subscribe(() => { healthyCalls += 1 })
  stream.publish(event)
  stream.publish(event)
  assert.equal(failingCalls, 1)
  assert.equal(healthyCalls, 2)
  assert.equal(stream.subscriberCount, 1)
})

test('Slice B SSE publish delivers the normalized allowlisted event as its second argument', () => {
  const stream = new ClientEventStream()
  const malicious = {
    eventId: 'key=TOP_SECRET',
    conversationId: 'Bearer sk-live-SECRET',
    timestamp: new Date(0).toISOString(),
    type: 'tool.completed',
    toolCallId: 'token-call',
    name: 'secret-tool',
    status: 'completed',
    isError: false,
    summary: 'key=TOP_SECRET /etc /',
    args: { command: 'rm -rf /tmp/private' },
    result: { raw: 'secret' },
    path: '/etc',
    stack: 'private stack',
  } as unknown as import('../../../app/runtime/client-events.ts').ClientEvent
  let delivered: import('../../../app/runtime/client-events.ts').ClientEvent | undefined
  stream.subscribe((_frame, event) => { delivered = event })
  stream.publish(malicious)
  assert.notStrictEqual(delivered, malicious)
  assert.deepEqual(Object.keys(delivered ?? {}).sort(), ['conversationId', 'eventId', 'isError', 'name', 'status', 'summary', 'timestamp', 'toolCallId', 'type'].sort())
  assert.equal(JSON.stringify(delivered).includes('TOP_SECRET'), false)
  assert.equal(JSON.stringify(delivered).includes('sk-live-SECRET'), false)
  assert.equal(JSON.stringify(delivered).includes('args'), false)
  assert.equal(JSON.stringify(delivered).includes('result'), false)
  assert.equal(JSON.stringify(delivered).includes('stack'), false)
  assert.equal(delivered?.eventId, 'event')
  assert.equal(delivered?.conversationId, 'conversation')
  const deliveredTool = delivered?.type === 'tool.completed' ? delivered : undefined
  assert.equal(deliveredTool?.toolCallId, 'tool-call')
  assert.equal(deliveredTool?.name, 'tool')
})

test('Slice B malformed SSE input degrades to a safe runtime error for every subscriber', () => {
  const stream = new ClientEventStream()
  const delivered: import('../../../app/runtime/client-events.ts').ClientEvent[] = []
  stream.subscribe((_frame, event) => delivered.push(event))
  for (const input of [null, undefined, { type: 'unknown', raw: 'secret' }]) assert.doesNotThrow(() => stream.publish(input))
  assert.equal(delivered.length, 3)
  assert.equal(delivered.every((event) => event.type === 'error'), true)
  assert.equal(delivered.every((event) => !JSON.stringify(event).includes('secret')), true)
  assert.equal(delivered.every((event) => !Object.keys(event).some((key) => ['raw', 'args', 'result', 'stack'].includes(key))), true)
})

test('Slice B SSE serialization rebuilds an allowlisted event and strips runtime extras', () => {
  const malicious = {
    eventId: 'conversation:3',
    conversationId: 'conversation',
    timestamp: new Date(0).toISOString(),
    type: 'tool.completed',
    toolCallId: 'call-3',
    name: 'ingest_document',
    status: 'completed',
    isError: false,
    summary: 'Authorization: Bearer TOP_SECRET ../private/report command=rm -rf',
    args: { command: 'rm -rf C:\\private' },
    result: { raw: 'secret' },
    path: 'C:\\private',
    raw: 'untrusted',
  } as unknown as import('../../../app/runtime/client-events.ts').ClientEvent
  const frame = serializeClientEvent(malicious)
  const data = JSON.parse(frame.split('data: ')[1].split('\n')[0]) as Record<string, unknown>
  assert.deepEqual(Object.keys(data).sort(), ['conversationId', 'eventId', 'isError', 'name', 'status', 'summary', 'timestamp', 'toolCallId', 'type'].sort())
  assert.equal(JSON.stringify(data).includes('TOP_SECRET'), false)
  assert.equal(JSON.stringify(data).includes('rm -rf'), false)
  assert.equal(JSON.stringify(data).includes('private'), false)
  assert.equal('args' in data, false)
  assert.equal('result' in data, false)
  assert.equal('raw' in data, false)
})

test('Slice B SSE summaries redact POSIX paths, bare commands, command paths, and Bearer credentials', () => {
  const cases = [
    { type: 'agent.started', summary: 'located at /var/private/report.txt' },
    { type: 'agent.started', summary: 'located at /etc' },
    { type: 'agent.started', summary: 'located at /' },
    { type: 'agent.started', summary: 'key=TOP_SECRET' },
    { type: 'tool.completed', toolCallId: 'call-posix', name: 'tool', status: 'completed', summary: 'rm -rf /tmp/private' },
    { type: 'message.delta', role: 'assistant', summary: 'read /var/private/report.txt' },
    { type: 'error', code: 'runtime_error', summary: 'Bearer sk-live-SECRET' },
    { type: 'error', code: 'runtime_error', summary: 'ghp_TESTTOKEN AKIA1234567890ABCDEF -----BEGIN PRIVATE KEY-----' },
  ] as const
  for (const event of cases) {
  const frame = serializeClientEvent({ ...event, eventId: 'summary-test', conversationId: 'conversation', timestamp: new Date(0).toISOString() } as unknown as import('../../../app/runtime/client-events.ts').ClientEvent)
    assert.equal(frame.includes('/var/private'), false)
    assert.equal(frame.includes('/tmp/private'), false)
    assert.equal(frame.includes('/etc'), false)
    assert.equal(frame.includes('located at /'), false)
    assert.equal(frame.includes('rm -rf'), false)
    assert.equal(frame.includes('read /'), false)
    assert.equal(frame.includes('sk-live-SECRET'), false)
  }
})

test('Slice B does not project a retrying agent_end as a terminal completion or error', () => {
  const session = fakeSession('retrying-conversation')
  const adapter = new ClientEventAdapter()
  const events: unknown[] = []
  adapter.subscribe((event) => events.push(event))
  adapter.bind(session)
  session.emit({
    type: 'agent_end',
    willRetry: true,
    messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'retryable failure', content: [], timestamp: Date.now() }],
  } as unknown as AgentSessionEvent)
  assert.equal(events.some((event) => (event as { type?: string }).type === 'agent.completed'), false)
  assert.equal(events.some((event) => (event as { type?: string }).type === 'error'), false)
  adapter.dispose()
})

test('Slice B runtime security requires exact loopback Host, Origin, and nonce token', () => {
  const security = new RuntimeSecurity({ bindAddress: '127.0.0.1', expectedOrigin: 'http://127.0.0.1:4317' })
  const request = { host: '127.0.0.1:4317', origin: security.expectedOrigin, runtimeToken: security.runtimeToken }
  assert.doesNotThrow(() => security.validateRequest(request))
  assert.throws(() => security.validateRequest({ ...request, runtimeToken: undefined }), RuntimeSecurityError)
  const legacyTokenPolicyField = ['requires', 'Token'].join('')
  const bypassAttempt = { ...request, runtimeToken: undefined, [legacyTokenPolicyField]: false } as unknown as RuntimeSecurityRequest
  assert.throws(
    () => security.validateRequest(bypassAttempt),
    RuntimeSecurityError,
  )
  assert.doesNotThrow(() => security.validateRequest({ ...request, runtimeToken: undefined }, 'read'))
  assert.throws(() => security.validateRequest({ ...request, runtimeToken: undefined }, 'mutation'), RuntimeSecurityError)
  assert.throws(() => security.validateRequest({ ...request, runtimeToken: 'wrong' }), RuntimeSecurityError)
  assert.throws(() => security.validateRequest({ ...request, origin: 'http://evil.example' }), RuntimeSecurityError)
  assert.throws(() => security.validateRequest({ ...request, host: '127.0.0.1:4318' }), RuntimeSecurityError)
  assert.equal(Object.values(security.corsHeaders()).includes('*'), false)
  assert.equal(security.corsHeaders()['Access-Control-Allow-Origin'], security.expectedOrigin)
})

test('Slice B runtime security rejects public or LAN binding and only accepts safe IPv6 loopback', () => {
  assert.equal(assertLoopbackBindAddress(), '127.0.0.1')
  assert.equal(assertLoopbackBindAddress('::1'), '::1')
  assert.throws(() => assertLoopbackBindAddress('0.0.0.0'), /loopback/)
  assert.throws(() => assertLoopbackBindAddress('192.168.1.20'), /loopback/)
  assert.throws(() => assertLoopbackBindAddress('localhost'), /loopback/)
  assert.throws(() => new RuntimeSecurity({ bindAddress: '0.0.0.0', expectedOrigin: 'http://127.0.0.1:4317' }), /loopback/)
  assert.throws(() => new RuntimeSecurity({ bindAddress: '::1', expectedOrigin: 'http://192.168.1.20:4317' }), /loopback origin/)
})
