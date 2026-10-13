import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { createServer as createHttpServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { AttachmentService, type AttachmentRef } from '../../../app/runtime/attachment-service.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer, type RuntimeServerInfo } from '../../../app/runtime/server.ts'
import { ProductionService } from '../../../app/services/production-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { IngestionWorkflowResult } from '../../../workflows/raw-document-knowledge-ingestion/contracts.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'
import { createKnowledgeBase, readManifest, removeKnowledgeBase } from '../../knowledge/helpers.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
class FixtureExecutor implements ReasoningExecutor { capabilities(): ReasoningCapabilities { return capabilities } async execute(request: Parameters<ReasoningExecutor['execute']>[0]) { return { operation: request.operation, output: {} } as never } }
class FakeSseResponse extends EventEmitter {
  readonly writes: string[] = []
  writable = true
  destroyed = false
  writableEnded = false
  constructor(private readonly writeResults: boolean[]) { super() }
  writeHead(): void {}
  write(frame: string): boolean { this.writes.push(frame); return this.writeResults.length > 0 ? this.writeResults.shift()! : true }
  end(): void { this.writableEnded = true; this.writable = false }
}

function responseResult(): IngestionWorkflowResult { return { workflowRunId: 'fixture', knowledgeBaseId: 'fixture-kb', status: 'completed', unitSummaries: [], candidateCounts: {}, rejectedCandidates: [], reviewItems: [], reviewSummary: { total: 0, rootCount: 0, dependencyCount: 0, byCategory: {}, byCandidateKind: {}, samplesByCategory: {} }, errors: [] } as unknown as IngestionWorkflowResult }

async function makeRuntimeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-slice-c-'))
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-slice-c-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  return { root, cwd, agentDir, sessionDir, modelRuntime, runtime, faux }
}

async function makeMountedRuntimeFixture(researchService?: import('../../../app/services/research-service.ts').ResearchService) {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-mounted-c-'))
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions'); const workspaceRoot = join(root, 'workspace'); const mountedKnowledgeBaseRoot = await createKnowledgeBase({ knowledgeBaseId: `kb-mounted-${Date.now()}-${Math.random()}` })
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `researchhub-runtime-mounted-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir, mountedKnowledgeBaseRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), ...(researchService === undefined ? {} : { researchService }) })
  return { root, cwd, agentDir, sessionDir, workspaceRoot, mountedKnowledgeBaseRoot, modelRuntime, runtime, faux }
}

async function multipartBody(fields: { readonly name: string; readonly value: Blob; readonly filename?: string }[]): Promise<{ readonly body: AsyncIterable<Uint8Array>; readonly contentType: string }> {
  const form = new FormData()
  for (const field of fields) form.append(field.name, field.value, field.filename)
  const request = new Request('http://127.0.0.1/upload', { method: 'POST', body: form })
  return { body: Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0]), contentType: request.headers.get('content-type')! }
}

async function* oneByteChunks(body: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  for await (const chunk of body) for (let index = 0; index < chunk.length; index += 1) yield chunk.subarray(index, index + 1)
}

test('Slice C AttachmentService streams, hashes, normalizes, and keeps upload outside Raw', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-attachment-c-'))
  try {
    const service = new AttachmentService({ workspaceRoot: root, maxBytes: 100 })
    const request = await multipartBody([{ name: 'file', value: new Blob(['hello'], { type: 'text/plain' }), filename: '../nested\\report.txt' }])
    const attachment = await service.upload(request.body, request.contentType)
    assert.equal(attachment.filename, 'report.txt'); assert.deepEqual(Object.keys(attachment).sort(), ['attachmentId', 'createdAt', 'filename', 'mediaType', 'sha256', 'size']); assert.equal('path' in attachment, false); assert.equal('workspaceRelativePath' in attachment, false)
    const workspaceReference = await service.getWorkspaceFileReference(attachment.attachmentId)
    assert.equal(isAbsolute(workspaceReference), false); assert.notEqual(workspaceReference, ''); assert.deepEqual(workspaceReference.split(/[\\/]+/), ['uploads', attachment.attachmentId, 'report.txt'])
    assert.equal((await service.getAttachment(attachment.attachmentId)).sha256.length, 64)
    assert.deepEqual(await readdir(join(root, 'uploads', attachment.attachmentId)), ['metadata.json', 'report.txt'])
    const reserved = await multipartBody([{ name: 'file', value: new Blob(['reserved content'], { type: 'text/plain' }), filename: 'metadata.json' }])
    const reservedAttachment = await service.upload(reserved.body, reserved.contentType)
    assert.notEqual(reservedAttachment.filename.toLowerCase(), 'metadata.json')
    assert.equal((await service.getAttachment(reservedAttachment.attachmentId)).size, 'reserved content'.length)
    assert.match(await readFile((await service.openAttachment(reservedAttachment.attachmentId)).path, 'utf8'), /reserved content/)
    assert.equal((await readdir(root)).includes('raw'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C AttachmentService preserves multipart boundaries across one-byte chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-attachment-one-byte-c-'))
  try {
    const service = new AttachmentService({ workspaceRoot: root, maxBytes: 100 })
    const request = await multipartBody([{ name: 'file', value: new Blob(['one-byte multipart content'], { type: 'text/plain' }), filename: 'one-byte.txt' }])
    const attachment = await service.upload(oneByteChunks(request.body), request.contentType)
    assert.equal(attachment.filename, 'one-byte.txt'); assert.equal(attachment.size, 'one-byte multipart content'.length)
    assert.equal((await service.getAttachment(attachment.attachmentId)).sha256, attachment.sha256)
    assert.equal(await readFile((await service.openAttachment(attachment.attachmentId)).path, 'utf8'), 'one-byte multipart content')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C AttachmentService preserves CRLF--abcX pseudo boundaries across one-byte chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-attachment-pseudo-boundary-c-')); const boundary = 'abc'; const content = 'prefix\r\n--abcXsuffix with content after the pseudo boundary'
  try {
    const service = new AttachmentService({ workspaceRoot: root, maxBytes: 100 })
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pseudo.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`)
    const body = (async function* (): AsyncIterable<Uint8Array> { yield payload })()
    const attachment = await service.upload(oneByteChunks(body), `multipart/form-data; boundary=${boundary}`)
    assert.equal(attachment.size, Buffer.byteLength(content))
    assert.equal(attachment.sha256, createHash('sha256').update(content).digest('hex'))
    assert.equal(await readFile((await service.openAttachment(attachment.attachmentId)).path, 'utf8'), content)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C AttachmentService rejects control names, size overflow, metadata tamper, and symlink escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-attachment-security-c-'))
  try {
    const service = new AttachmentService({ workspaceRoot: root, maxBytes: 4 })
    const control = await multipartBody([{ name: 'file', value: new Blob(['x']), filename: 'bad\u0000name.txt' }])
    await assert.rejects(() => service.upload(control.body, control.contentType), /control|NUL/i)
    const tooLarge = await multipartBody([{ name: 'file', value: new Blob(['12345']), filename: 'large.txt' }])
    await assert.rejects(() => service.upload(tooLarge.body, tooLarge.contentType), /limit|size/i)
    const goodService = new AttachmentService({ workspaceRoot: root, maxBytes: 100 })
    const good = await multipartBody([{ name: 'file', value: new Blob(['safe']), filename: 'safe.txt' }])
    const attachment = await goodService.upload(good.body, good.contentType)
    const metadataPath = join((await goodService.openAttachment(attachment.attachmentId)).path.replace(/\\[^\\]+$/, ''), 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    metadata.workspaceRelativePath = '../outside.txt'; await writeFile(metadataPath, JSON.stringify(metadata))
    await assert.rejects(() => goodService.getAttachment(attachment.attachmentId), /metadata path|invalid/i)
    metadata.workspaceRelativePath = `uploads/${attachment.attachmentId}/safe.txt`; await writeFile(metadataPath, JSON.stringify(metadata))
    metadata.sha256 = '0'.repeat(64); await writeFile(metadataPath, JSON.stringify(metadata))
    await assert.rejects(() => goodService.getAttachment(attachment.attachmentId), /hash/i)
    const outside = join(root, 'outside.txt'); await writeFile(outside, 'outside')
    const escapeDir = join(root, 'uploads', 'escape-link'); await symlink(outside, escapeDir)
    await assert.rejects(() => goodService.getAttachment('escape-link'), /invalid|not found/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C Runtime rejects overlapping canonical Knowledge and workspace roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-boundary-c-')); const kb = join(root, 'kb'); const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent')
  await mkdir(kb, { recursive: true })
  const create = (workspaceRoot: string) => createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kb, workspaceRoot, reasoningExecutor: new FixtureExecutor() })
  try {
    await assert.rejects(() => create(kb), /disjoint|overlap/i)
    await assert.rejects(() => create(join(kb, 'workspace')), /disjoint|overlap/i)
    await assert.rejects(() => create(root), /disjoint|overlap/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C Runtime rejects a workspace symlink resolving into canonical Knowledge', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-runtime-symlink-c-')); const kb = join(root, 'kb'); const workspace = join(root, 'workspace-link')
  await mkdir(kb, { recursive: true })
  try {
    try { await symlink(kb, workspace, 'junction') } catch { t.skip('junction symlinks are unavailable on this Windows host'); return }
    await assert.rejects(() => createResearchHubApplicationRuntime({ cwd: join(root, 'cwd'), agentDir: join(root, 'agent'), mountedKnowledgeBaseRoot: kb, workspaceRoot: workspace, reasoningExecutor: new FixtureExecutor() }), /disjoint|overlap|resolved/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C AttachmentService accepts sibling roots and keeps uploads outside canonical Knowledge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-attachment-boundary-c-')); const kb = join(root, 'kb'); const workspace = join(root, 'workspace'); const marker = join(kb, 'marker.txt')
  await mkdir(kb, { recursive: true }); await writeFile(marker, 'unchanged')
  try {
    const service = new AttachmentService({ workspaceRoot: workspace, forbiddenRoot: kb, maxBytes: 100 })
    const request = await multipartBody([{ name: 'file', value: new Blob(['outside canonical'], { type: 'text/plain' }), filename: 'outside.txt' }])
    const attachment = await service.upload(request.body, request.contentType)
    const stored = await service.openAttachment(attachment.attachmentId)
    assert.equal((await readFile(marker, 'utf8')), 'unchanged')
    assert.equal(stored.path.startsWith(kb), false)
    assert.equal((await readdir(kb)).includes('marker.txt'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Slice C server rejects an injected AttachmentService with an unsafe workspace', async () => {
  const fixture = await makeMountedRuntimeFixture(); const unsafe = new AttachmentService({ workspaceRoot: join(fixture.mountedKnowledgeBaseRoot, 'unsafe') }); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, attachmentService: unsafe, port: 0 })
  try { await assert.rejects(() => server.start(), /disjoint|overlap/i) } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }); await removeKnowledgeBase(fixture.mountedKnowledgeBaseRoot) }
})

test('Slice C HTTP upload returns only the public Attachment DTO and leaves canonical Knowledge unchanged', async () => {
  const fixture = await makeMountedRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  try {
    const beforeManifest = await readManifest(fixture.mountedKnowledgeBaseRoot); const beforeFiles = (await readdir(fixture.mountedKnowledgeBaseRoot, { recursive: true })).sort(); const info = await server.start(); const form = new FormData(); form.append('file', new Blob(['not canonical'], { type: 'text/plain' }), 'upload.txt')
    const response = await fetch(`${info.origin}/api/attachments`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }, body: form })
    assert.equal(response.status, 201); const payload = await response.json() as { attachment: Record<string, unknown> }; assert.deepEqual(Object.keys(payload.attachment).sort(), ['attachmentId', 'createdAt', 'filename', 'mediaType', 'sha256', 'size']); assert.equal('workspaceRelativePath' in payload.attachment, false); assert.equal('path' in payload.attachment, false); assert.deepEqual(await readManifest(fixture.mountedKnowledgeBaseRoot), beforeManifest); assert.deepEqual((await readdir(fixture.mountedKnowledgeBaseRoot, { recursive: true })).sort(), beforeFiles)
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }); await removeKnowledgeBase(fixture.mountedKnowledgeBaseRoot) }
})

test('Slice C Runtime production ingress hands off a validated workspace-relative attachment reference', async () => {
  const fixture = await makeMountedRuntimeFixture(); const workflow = fixture.runtime.workflowService; let receivedReference: string | undefined
  const production = new ProductionService({ mountedKnowledgeBaseRoot: fixture.mountedKnowledgeBaseRoot, workspaceRoot: fixture.workspaceRoot, cwd: fixture.cwd, reasoningExecutor: new FixtureExecutor(), workflowService: workflow, workflowRunner: async ({ documentInput }) => { if (documentInput.type !== 'file') throw new Error('expected a file document input'); return responseResult() } })
  const originalStart = production.startIngestDocument.bind(production)
  production.startIngestDocument = ((input, signal) => { receivedReference = input.workspaceFile; return originalStart(input, signal) }) as typeof production.startIngestDocument
  ;(fixture.runtime.services as unknown as { productionService: ProductionService }).productionService = production
  const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  try {
    const info = await server.start(); const form = new FormData(); form.append('file', new Blob(['production handoff'], { type: 'text/plain' }), 'handoff.txt')
    const uploaded = await fetch(`${info.origin}/api/attachments`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }, body: form }); assert.equal(uploaded.status, 201); const attachment = (await uploaded.json() as { attachment: AttachmentRef }).attachment
    const started = await fetch(`${info.origin}/api/production/ingest`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json', 'x-researchhub-runtime-token': info.runtimeToken }, body: JSON.stringify({ attachmentId: attachment.attachmentId }) }); assert.equal(started.status, 202); const startedBody = await started.json() as { runId: string }
    for (let attempt = 0; attempt < 50 && workflow.getWorkflowStatus(startedBody.runId)?.status === 'running'; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assert.equal(receivedReference, `uploads/${attachment.attachmentId}/handoff.txt`); assert.equal(workflow.getWorkflowStatus(startedBody.runId)?.status, 'completed')
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }); await removeKnowledgeBase(fixture.mountedKnowledgeBaseRoot) }
})

test('Slice C Windows canonical and lexical workspace representations use the relative attachment handoff', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows-specific canonical/lexical regression'); return }
  const fixture = await makeMountedRuntimeFixture(); const workspaceVariant = join(fixture.root, 'WORKSPACE'); const workflow = fixture.runtime.workflowService; let receivedReference: string | undefined
  const production = new ProductionService({ mountedKnowledgeBaseRoot: fixture.mountedKnowledgeBaseRoot, workspaceRoot: fixture.workspaceRoot, cwd: fixture.cwd, reasoningExecutor: new FixtureExecutor(), workflowService: workflow, workflowRunner: async ({ documentInput }) => { if (documentInput.type !== 'file') throw new Error('expected a file document input'); return responseResult() } })
  const originalStart = production.startIngestDocument.bind(production)
  production.startIngestDocument = ((input, signal) => { receivedReference = input.workspaceFile; return originalStart(input, signal) }) as typeof production.startIngestDocument
  ;(fixture.runtime.services as unknown as { productionService: ProductionService }).productionService = production
  const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, attachmentService: new AttachmentService({ workspaceRoot: workspaceVariant, forbiddenRoot: fixture.mountedKnowledgeBaseRoot }), port: 0 })
  try {
    const info = await server.start(); const form = new FormData(); form.append('file', new Blob(['windows handoff'], { type: 'text/plain' }), 'windows.txt')
    const uploaded = await fetch(`${info.origin}/api/attachments`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }, body: form }); assert.equal(uploaded.status, 201); const attachment = (await uploaded.json() as { attachment: AttachmentRef }).attachment
    const started = await fetch(`${info.origin}/api/production/ingest`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json', 'x-researchhub-runtime-token': info.runtimeToken }, body: JSON.stringify({ attachmentId: attachment.attachmentId }) }); assert.equal(started.status, 202); const startedBody = await started.json() as { runId: string }
    for (let attempt = 0; attempt < 50 && workflow.getWorkflowStatus(startedBody.runId)?.status === 'running'; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assert.equal(receivedReference, `uploads/${attachment.attachmentId}/windows.txt`); assert.equal(workflow.getWorkflowStatus(startedBody.runId)?.status, 'completed')
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }); await removeKnowledgeBase(fixture.mountedKnowledgeBaseRoot) }
})

test('Slice C ProductionService exposes asynchronous start, failure, and cancellation with one workflow path', async () => {
  const kb = await createKnowledgeBase({ knowledgeBaseId: 'kb-production-c' })
  try {
    const workflow = new WorkflowService()
    const service = new ProductionService({ mountedKnowledgeBaseRoot: kb, workspaceRoot: join(kb, 'workspace'), reasoningExecutor: new FixtureExecutor(), workflowService: workflow, workflowRunner: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); return responseResult() } })
    const started = service.startIngestDocument({ workflowRunId: 'async-production', text: 'fixture' }); assert.equal(started.runId, 'async-production'); assert.equal(workflow.getWorkflowStatus(started.runId)?.status, 'running'); assert.equal((await started.completion).status, 'completed')
    const failingWorkflow = new WorkflowService(); const failing = new ProductionService({ mountedKnowledgeBaseRoot: kb, workspaceRoot: join(kb, 'workspace'), reasoningExecutor: new FixtureExecutor(), workflowService: failingWorkflow, workflowRunner: async () => { throw new Error('fixture failure') } })
    const failed = failing.startIngestDocument({ workflowRunId: 'failed-production', text: 'fixture' }); await assert.rejects(failed.completion, /fixture failure/); assert.equal(failingWorkflow.getWorkflowStatus('failed-production')?.status, 'failed')
    const cancellingWorkflow = new WorkflowService(); const cancelling = new ProductionService({ mountedKnowledgeBaseRoot: kb, workspaceRoot: join(kb, 'workspace'), reasoningExecutor: new FixtureExecutor(), workflowService: cancellingWorkflow, workflowRunner: async ({ signal }) => new Promise<IngestionWorkflowResult>((_resolve, reject) => { if (signal?.aborted) reject(new Error('aborted')); else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }) })
    const cancelled = cancelling.startIngestDocument({ workflowRunId: 'cancelled-production', text: 'fixture' }); cancellingWorkflow.cancelWorkflow('cancelled-production'); const cancellationResult = await cancelled.completion; assert.equal(cancellationResult.status, 'cancelled')
  } finally { await removeKnowledgeBase(kb) }
})

test('Slice C ProductionService preserves authoritative completion after a late cancellation signal', async () => {
  const kb = await createKnowledgeBase({ knowledgeBaseId: 'kb-production-authoritative-c' })
  try {
    const workflow = new WorkflowService(); let entered!: () => void; const enteredPromise = new Promise<void>((resolve) => { entered = resolve }); let release!: () => void
    const service = new ProductionService({ mountedKnowledgeBaseRoot: kb, workspaceRoot: join(kb, 'workspace'), reasoningExecutor: new FixtureExecutor(), workflowService: workflow, workflowRunner: async () => { entered(); await new Promise<void>((resolve) => { release = resolve }); return responseResult() } })
    const controller = new AbortController(); const started = service.startIngestDocument({ workflowRunId: 'authoritative-completed', text: 'fixture' }, controller.signal)
    await enteredPromise; controller.abort(); release()
    const result = await started.completion
    assert.equal(result.status, 'completed'); assert.equal(workflow.getWorkflowStatus('authoritative-completed')?.status, 'completed')
  } finally { await removeKnowledgeBase(kb) }
})

test('Slice C HTTP server provides bootstrap/security/202/product APIs, no-KB mapping, and close', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 }); let info: RuntimeServerInfo
  try {
    info = await server.start(); const jsonHeaders = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    const bootstrapResponse = await fetch(`${info.origin}/api/bootstrap`, { headers: { host: `${info.bindAddress}:${info.port}` } }); assert.equal(bootstrapResponse.status, 200); const bootstrap = await bootstrapResponse.json() as { runtime: { runtimeToken: string; origin: string }; knowledgeError?: { code: string } }; assert.equal(bootstrap.runtime.origin, info.origin); assert.equal(bootstrap.knowledgeError?.code, 'no_kb_mounted')
    const unauthorized = await fetch(`${info.origin}/api/conversations/new`, { method: 'POST', headers: { ...jsonHeaders, 'x-researchhub-runtime-token': '0'.repeat(64) }, body: '{}' }); assert.equal(unauthorized.status, 401); assert.equal((await unauthorized.json()).code, 'unauthorized_runtime_token')
    const accepted = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text: 'safe prompt' }) }); assert.equal(accepted.status, 202); assert.equal((await accepted.json()).accepted, true)
    const noKb = await fetch(`${info.origin}/api/researchhub/status`, { headers: { host: `${info.bindAddress}:${info.port}` } }); assert.equal(noKb.status, 503); assert.equal((await noKb.json()).code, 'no_kb_mounted')
    const uploadForm = new FormData(); uploadForm.append('file', new Blob(['server upload'], { type: 'text/plain' }), '../../server.txt')
    const uploaded = await fetch(`${info.origin}/api/attachments`, { method: 'POST', headers: { origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }, body: uploadForm }); assert.equal(uploaded.status, 201); const uploadedJson = await uploaded.json() as { attachment: AttachmentRef }; assert.equal(uploadedJson.attachment.filename, 'server.txt')
    const attachmentRead = await fetch(`${info.origin}/api/attachments/${uploadedJson.attachment.attachmentId}`); assert.equal(attachmentRead.status, 200); assert.equal((await attachmentRead.json()).attachment.attachmentId, uploadedJson.attachment.attachmentId)
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }) }
  assert.equal(server.address, undefined); await assert.rejects(() => fetch(`${info!.origin}/api/bootstrap`))
})

test('conversation APIs persist accepted request activity, metadata, archive state, and replay prompt commands once', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  try {
    const info = await server.start(); const headers = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    const conversationId = fixture.runtime.sessionRuntime.getCurrentState().conversationId
    const accepted = await fetch(`${info.origin}/api/conversations/requests/accept`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: 'web-operation-1', requestText: 'Persist this accepted prompt.', operation: 'prompt' }) })
    assert.equal(accepted.status, 200)
    const initialList = await fetch(`${info.origin}/api/conversations?archived=0`, { headers }); const initialSummary = (await initialList.json() as { conversations: { conversationId: string; version: number; name: string }[] }).conversations.find((item) => item.conversationId === conversationId)!
    assert.ok(initialSummary)
    fixture.faux.setResponses([fauxAssistantMessage('one response')])
    const commandBody = JSON.stringify({ conversationId, operationId: 'web-operation-1', text: 'Persist this accepted prompt.' })
    const command = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: commandBody }); assert.equal(command.status, 202)
    const userMessageCount = fixture.runtime.sessionRuntime.getCurrentMessages().filter((message) => message.role === 'user').length
    const replay = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: commandBody }); assert.equal(replay.status, 202)
    assert.equal(fixture.runtime.sessionRuntime.getCurrentMessages().filter((message) => message.role === 'user').length, userMessageCount)
    const messages = await fetch(`${info.origin}/api/conversations/messages`, { headers }); const messagesBody = await messages.json() as { conversationId: string; activities: { requestText: string; status: string; operation: string }[] }
    assert.equal(messagesBody.conversationId, conversationId); assert.equal(messagesBody.activities[0]?.requestText, 'Persist this accepted prompt.'); assert.equal(messagesBody.activities[0]?.status, 'completed')
    const latestList = await fetch(`${info.origin}/api/conversations?archived=0`, { headers }); const latestVersion = ((await latestList.json() as { conversations: { conversationId: string; version: number }[] }).conversations.find((item) => item.conversationId === conversationId))!.version
    const rename = await fetch(`${info.origin}/api/conversations/${encodeURIComponent(conversationId)}/metadata`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Explicit title', expectedVersion: latestVersion }) })
    assert.equal(rename.status, 200); const renamed = await rename.json() as { name: string; titleSource: string; version: number }
    assert.equal(renamed.name, 'Explicit title'); assert.equal(renamed.titleSource, 'user')
    const current = await fetch(`${info.origin}/api/conversations/current`, { headers })
    assert.equal((await current.json() as { name: string }).name, 'Explicit title')
    const archived = await fetch(`${info.origin}/api/conversations/${encodeURIComponent(conversationId)}/archive`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: renamed.version }) })
    assert.equal(archived.status, 200); assert.equal((await archived.json() as { archived: boolean }).archived, true)
    const archivedList = await fetch(`${info.origin}/api/conversations?archived=1&search=Explicit`, { headers }); assert.equal((await archivedList.json() as { conversations: unknown[] }).conversations.length, 1)
    const idSearch = await fetch(`${info.origin}/api/conversations?search=${encodeURIComponent(conversationId)}`, { headers }); assert.equal((await idSearch.json() as { conversations: unknown[] }).conversations.length, 0)
    const restore = await fetch(`${info.origin}/api/conversations/${encodeURIComponent(conversationId)}/restore`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: renamed.version + 1 }) })
    assert.equal(restore.status, 200); assert.equal((await restore.json() as { archived: boolean }).archived, false)
    const activities = await fetch(`${info.origin}/api/conversations/${encodeURIComponent(conversationId)}/activities`, { headers }); assert.equal((await activities.json() as { activities: unknown[] }).activities.length, 1)
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

test('research dispatch requires an accepted association and reconciles a reserved run after association write failure', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  const store = fixture.runtime.sessionRuntime.conversationStateStore
  const originalMarkWorkflowStarted = store.markWorkflowStarted.bind(store)
  let associationWrites = 0
  Object.defineProperty(store, 'markWorkflowStarted', { configurable: true, value: async (...args: Parameters<typeof store.markWorkflowStarted>) => {
    associationWrites += 1
    if (associationWrites === 1) throw new Error('injected sidecar write failure')
    return originalMarkWorkflowStarted(...args)
  } })
  let dispatchCalls = 0
  const startedRunIds: string[] = []
  Object.defineProperty(fixture.runtime.services.researchDispatchService!, 'startAsync', { configurable: true, value: async (_input: unknown, _signal: AbortSignal, serverOwnedRunId?: string) => {
    dispatchCalls += 1
    assert.ok(serverOwnedRunId)
    startedRunIds.push(serverOwnedRunId)
    const pending = fixture.runtime.workflowService.register({ runId: serverOwnedRunId, workflowType: 'company_research', objective: 'Research 002640' })
    void fixture.runtime.workflowService.start(serverOwnedRunId, async () => new Promise<never>(() => {}))
    return { status: 'started', runId: serverOwnedRunId, workflow: pending, decision: { workflow: { id: 'company_research', arguments: { symbol: '002640', name: 'Unverified Semantic Name' } } }, ...(dispatchCalls > 1 ? { verifiedSecurityIdentity: { symbol: '002640', exchange: 'SZ', verifiedName: 'Verified Company Name', verificationSource: 'akshare_security_directory', originAuthority: 'S3_AGGREGATOR', verifiedAt: new Date().toISOString() } } : {}) } as never
  } })
  try {
    const info = await server.start(); const headers = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    const conversationId = fixture.runtime.sessionRuntime.getCurrentState().conversationId
    const unassociated = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify({ query: '研究 002640', mode: { type: 'workflow', workflowId: 'company_research' } }) })
    assert.equal(unassociated.status, 400); assert.equal(dispatchCalls, 0)
    const accepted = await fetch(`${info.origin}/api/conversations/requests/accept`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: 'workflow-operation-1', requestText: '研究 002640', operation: 'prompt', workflowRegistryId: 'company_research' }) })
    assert.equal(accepted.status, 200)
    const mismatched = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: 'workflow-operation-1', query: '研究 002640' }) })
    assert.equal(mismatched.status, 409); assert.equal(dispatchCalls, 0)
    const dispatchBody = { conversationId, operationId: 'workflow-operation-1', query: '研究 002640', mode: { type: 'workflow', workflowId: 'company_research' } }
    const first = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify(dispatchBody) })
    assert.equal(first.status, 202); assert.equal(dispatchCalls, 1)
    const firstBody = await first.json() as { runId: string }
    const duringFailure = (await store.get(conversationId))!.acceptedRequests[0]!
    assert.equal(duringFailure.lifecycle, 'submitting'); assert.equal(duringFailure.reservedWorkflowRunId, firstBody.runId)
    const replay = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify(dispatchBody) })
    assert.equal(replay.status, 202); assert.equal(dispatchCalls, 1)
    const replayBody = await replay.json() as { runId: string; replayed?: boolean }
    assert.equal(replayBody.runId, firstBody.runId); assert.equal(replayBody.replayed, true)
    const activity = (await store.get(conversationId))!.acceptedRequests[0]!
    assert.equal(activity.lifecycle, 'started'); assert.equal(activity.workflowRunId, firstBody.runId); assert.equal(activity.workflowSubject, '002640')
    const safeActivity = (await fixture.runtime.sessionRuntime.conversationActivities(conversationId))[0]!
    assert.equal(safeActivity.workflowSubject, '002640'); assert.equal(safeActivity.workflowRunId, firstBody.runId)
    assert.equal((await fixture.runtime.sessionRuntime.getConversationSummary(conversationId)).name, '002640 · 公司深度研究')
    assert.equal(associationWrites, 2)
    const secondOperationId = 'workflow-operation-2'
    const secondAccepted = await fetch(`${info.origin}/api/conversations/requests/accept`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: secondOperationId, requestText: '研究 002640 again', operation: 'prompt', workflowRegistryId: 'company_research' }) })
    assert.equal(secondAccepted.status, 200)
    const verifiedDispatch = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: secondOperationId, query: '研究 002640 again', mode: { type: 'workflow', workflowId: 'company_research' } }) })
    assert.equal(verifiedDispatch.status, 202)
    assert.equal((await store.get(conversationId))!.acceptedRequests[1]?.workflowSubject, 'Verified Company Name')
    assert.equal(dispatchCalls, 2)
    const autoOperationId = 'workflow-operation-auto'
    const autoQuery = '自动路由研究 002640'
    const autoAccepted = await fetch(`${info.origin}/api/conversations/requests/accept`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: autoOperationId, requestText: autoQuery, operation: 'prompt' }) })
    assert.equal(autoAccepted.status, 200)
    const autoDispatchBody = { conversationId, operationId: autoOperationId, query: autoQuery }
    const autoDispatch = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify(autoDispatchBody) })
    assert.equal(autoDispatch.status, 202)
    const autoRunId = (await autoDispatch.json() as { runId: string }).runId
    const autoReplay = await fetch(`${info.origin}/api/research/dispatch`, { method: 'POST', headers, body: JSON.stringify(autoDispatchBody) })
    assert.equal(autoReplay.status, 202)
    assert.equal((await autoReplay.json() as { runId: string; replayed: boolean }).runId, autoRunId)
    assert.equal((await store.get(conversationId))!.acceptedRequests[2]?.acceptedWorkflowRegistryId, undefined)
    assert.equal((await store.get(conversationId))!.acceptedRequests[2]?.workflowRegistryId, 'company_research')
    const autoAcceptReplay = await fetch(`${info.origin}/api/conversations/requests/accept`, { method: 'POST', headers, body: JSON.stringify({ conversationId, operationId: autoOperationId, requestText: autoQuery, operation: 'prompt' }) })
    assert.equal(autoAcceptReplay.status, 200)
    assert.equal(dispatchCalls, 3)
  } finally {
    await server.close()
    for (const runId of startedRunIds) fixture.runtime.workflowService.cancelWorkflow(runId)
    await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Pi conversation defaults research persistence to deny, honors explicit policy, rejects authorized follow-up, and does not leak permission across tools', async () => {
  const received: Record<string, unknown>[] = []
  let releaseAuthorized!: () => void
  const start = (input: Record<string, unknown>) => { received.push(input); const completion = input.writeKnowledge === true ? new Promise((resolve) => { releaseAuthorized = () => resolve({ status: 'completed', runId: input.workflowRunId, summary: 'authorized fixture' }) }) : Promise.resolve({ status: 'completed', runId: input.workflowRunId, summary: 'read-only fixture' }); return { completion } }
  const researchService = { startResearchCompany: start, startEventResearch: start } as never
  const fixture = await makeMountedRuntimeFixture(researchService)
  const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  const toolResponse = (runId: string, toolName = 'research_company') => [fauxAssistantMessage(fauxToolCall(toolName, toolName === 'research_event' ? { workflowRunId: runId, symbol: '600519', anchor: { kind: 'user_event', title: 'Fixture', description: 'Ordinary follow-up', eventDate: '2026-09-08' } } : { workflowRunId: runId, symbol: '600519' }, { id: `${runId}-tool` })), fauxAssistantMessage('Research completed.')]
  const waitForResearchCall = async (count: number) => { for (let attempt = 0; attempt < 100 && received.length < count; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 10)); assert.ok(received.length >= count, `expected ${count} ResearchService call(s), received ${received.length}`) }
  try {
    const info = await server.start(); const headers = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    fixture.faux.setResponses(toolResponse('http-default'))
    const noPolicy = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'Research company without a persistence policy.' }) })
    assert.equal(noPolicy.status, 202)
    await waitForResearchCall(1)
    assert.equal(received[0]?.writeKnowledge, false)
    assert.equal(received[0]?.useStructuredKnowledge, true)

    fixture.faux.setResponses(toolResponse('http-readonly'))
    const readonly = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'Read-only research.', researchPolicy: { contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } } }) })
    assert.equal(readonly.status, 202)
    await waitForResearchCall(2)
    assert.equal(received[1]?.writeKnowledge, false)

    fixture.faux.setResponses(toolResponse('http-authorized'))
    const authorized = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'Authorized Knowledge production.', researchPolicy: { contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: true } } }) })
    assert.equal(authorized.status, 202)
    for (let attempt = 0; attempt < 30 && received.length < 3; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 10))
    assert.equal(received[2]?.writeKnowledge, true)

    const followUp = await fetch(`${info.origin}/api/conversations/follow_up`, { method: 'POST', headers, body: JSON.stringify({ text: 'Try to continue the authorized write.' }) })
    assert.equal(followUp.status, 409)
    releaseAuthorized()
    for (let attempt = 0; attempt < 100 && !fixture.runtime.sessionRuntime.getCurrentState().isIdle; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 10))
    fixture.faux.setResponses(toolResponse('followup-readonly-event', 'research_event'))
    await fixture.runtime.sessionRuntime.prompt('Continue the conversation in a new ordinary turn.')
    await waitForResearchCall(4)
    assert.equal(received[3]?.writeKnowledge, false)
  } finally {
    releaseAuthorized?.()
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }); await removeKnowledgeBase(fixture.mountedKnowledgeBaseRoot)
  }
})

test('Slice C HTTP conversation commands honor Pi preflight and preserve queue paths', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 }); let release!: () => void; let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve }); const gate = new Promise<void>((resolve) => { release = resolve }); const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  const piEvents: import('../../../app/runtime/client-events.ts').ClientEvent[] = []
  const unsubscribeEvents = fixture.runtime.sessionRuntime.subscribeClientEvents((event) => piEvents.push(event))
  fixture.faux.setResponses([
    async () => { entered(); await gate; return fauxAssistantMessage('first completed') },
    fauxAssistantMessage('steer completed'),
    fauxAssistantMessage('follow-up completed'),
  ])
  process.on('unhandledRejection', onUnhandled)
  try {
    const info = await server.start(); const headers = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    const first = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'first prompt' }) })
    assert.equal(first.status, 202)
    await enteredPromise
    const second = await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'ordinary while busy' }) })
    assert.notEqual(second.status, 202); assert.equal((await second.json()).code, 'conflict')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal((server as unknown as { backgroundOperations: Set<unknown> }).backgroundOperations.size, 1)
    const steer = await fetch(`${info.origin}/api/conversations/steer`, { method: 'POST', headers, body: JSON.stringify({ text: 'steer while busy' }) })
    assert.equal(steer.status, 202)
    const followUp = await fetch(`${info.origin}/api/conversations/follow_up`, { method: 'POST', headers, body: JSON.stringify({ text: 'follow up while busy' }) })
    assert.equal(followUp.status, 202)
    release()
    await new Promise<void>((resolve) => setImmediate(resolve)); await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(unhandled.length, 0)
    assert.equal(fixture.runtime.sessionRuntime.getCurrentMessages().some((message) => message.content === 'first prompt'), true)
    const conversationId = fixture.runtime.sessionRuntime.getCurrentState().conversationId
    const activities = await fixture.runtime.sessionRuntime.conversationActivities(conversationId)
    const firstActivity = activities.find((activity) => activity.requestText === 'first prompt')
    assert.ok(firstActivity?.piMessageId)
    assert.equal(piEvents.some((event) => event.type === 'agent.started' && event.operationId === firstActivity.operationId), true)
    assert.equal(fixture.runtime.sessionRuntime.getCurrentMessages().some((message) => message.piMessageId === firstActivity.piMessageId), true)
    for (const requestText of ['steer while busy', 'follow up while busy']) {
      const activity = activities.find((item) => item.requestText === requestText)
      assert.ok(activity?.piMessageId)
      assert.equal(fixture.runtime.sessionRuntime.getCurrentMessages().some((message) => message.piMessageId === activity.piMessageId), true)
      assert.equal(piEvents.some((event) => event.type === 'message.started' && event.operationId === activity.operationId), true)
    }
  } finally {
    release(); unsubscribeEvents(); process.off('unhandledRejection', onUnhandled); await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C server does not dispose an injected runtime on close', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  try {
    await server.start()
    await server.close()
    assert.equal(fixture.runtime.sessionRuntime.isDisposed, false)
    assert.doesNotThrow(() => fixture.runtime.sessionRuntime.getCurrentState())
  } finally {
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C server closes a runtime it creates itself', async () => {
  const fixture = await makeRuntimeFixture()
  const server = new ResearchHubRuntimeServer({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor(), port: 0 })
  let ownedRuntime: NonNullable<ResearchHubRuntimeServer['applicationRuntime']> | undefined
  try {
    await server.start()
    ownedRuntime = server.applicationRuntime
    assert.ok(ownedRuntime)
    await server.close()
    assert.equal(ownedRuntime.sessionRuntime.isDisposed, true)
  } finally {
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C server shares concurrent starts and retries after startup failure', async () => {
  const fixture = await makeRuntimeFixture(); const blocker = createHttpServer(); await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const blockedPort = (blocker.address() as { readonly port: number }).port
  const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: blockedPort })
  try {
    const starts = [server.start(), server.start(), server.start()]
    const failures = await Promise.all(starts.map((promise) => promise.then(() => undefined, (error) => error)))
    assert.equal(failures[0], failures[1]); assert.equal(failures[1], failures[2])
    await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()))
    const info = await server.start(); assert.equal(info.port, blockedPort)
    const repeated = await server.start(); assert.equal(repeated, info)
  } finally {
    if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()))
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C server close retries a failed owned runtime cleanup', async () => {
  const fixture = await makeRuntimeFixture()
  const server = new ResearchHubRuntimeServer({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor(), port: 0 })
  let ownedRuntime: NonNullable<ResearchHubRuntimeServer['applicationRuntime']> | undefined
  let closeAttempts = 0
  try {
    await server.start(); ownedRuntime = server.applicationRuntime; assert.ok(ownedRuntime)
    const originalClose = ownedRuntime.close.bind(ownedRuntime)
    ownedRuntime.close = async () => { closeAttempts += 1; if (closeAttempts === 1) throw new Error('first close failure'); await originalClose() }
    await assert.rejects(() => server.close(), /first close failure/)
    assert.equal(closeAttempts, 1); assert.equal(server.address, undefined)
    await server.close()
    assert.equal(closeAttempts, 2); assert.equal(ownedRuntime.sessionRuntime.isDisposed, true)
  } finally {
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C server rejects start once close has begun and leaves no listener', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  try {
    await server.start()
    const closing = server.close()
    const starting = server.start()
    await assert.rejects(starting, (error: unknown) => (error as { readonly code?: string }).code === 'conflict')
    await closing
    assert.equal(server.address, undefined)
  } finally {
    await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C SSE registers before heartbeat and releases the slot when a client closes', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0, maxSseSubscribers: 1 })
  let first: Response | undefined; let third: Response | undefined
  try {
    const info = await server.start(); const headers = { host: `${info.bindAddress}:${info.port}`, origin: info.origin }
    first = await fetch(`${info.origin}/api/events`, { headers }); assert.equal(first.status, 200)
    const rejected = await fetch(`${info.origin}/api/events`, { headers }); assert.equal(rejected.status, 500); assert.equal((await rejected.json()).code, 'failed')
    await first.body?.cancel(); await new Promise((resolve) => setTimeout(resolve, 25))
    third = await fetch(`${info.origin}/api/events`, { headers }); assert.equal(third.status, 200)
  } finally {
    await first?.body?.cancel(); await third?.body?.cancel(); await server.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C SSE drains a bounded client queue after write backpressure', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  const response = new FakeSseResponse([false, true])
  try {
    await server.start()
    const openEvents = (server as unknown as { openEvents: (value: unknown) => void }).openEvents.bind(server)
    openEvents(response)
    assert.equal(response.writes.length, 1, JSON.stringify(response.writes))
    const client = [...(server as unknown as { sseClients: Set<{ readonly waitingForDrain: boolean; readonly pendingFrames: readonly string[] }> }).sseClients][0]!
    assert.equal(client.waitingForDrain, true)
    const eventStream = (server as unknown as { eventStream: { publish: (event: unknown) => void } }).eventStream
    eventStream.publish({ eventId: 'backpressure-1', conversationId: 'conversation', timestamp: new Date().toISOString(), type: 'session.changed', summary: 'Session changed' })
    assert.equal(client.waitingForDrain, true); assert.equal(client.pendingFrames.length, 1)
    assert.equal(response.writes.length, 1, JSON.stringify(response.writes))
    response.emit('drain')
    assert.equal(response.writes.length, 2); assert.match(response.writes[1]!, /backpressure-1/)
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

test('Slice C SSE disconnects only the client whose pending queue exceeds its bound', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  const slow = new FakeSseResponse([true, false]); const healthy = new FakeSseResponse([true])
  try {
    await server.start()
    const openEvents = (server as unknown as { openEvents: (value: unknown) => void }).openEvents.bind(server)
    openEvents(slow); openEvents(healthy)
    const eventStream = (server as unknown as { eventStream: { publish: (event: unknown) => void } }).eventStream
    for (let index = 0; index < 66; index += 1) eventStream.publish({ eventId: `overflow-${index}`, conversationId: 'conversation', timestamp: new Date().toISOString(), type: 'session.changed', summary: 'Session changed' })
    assert.equal(slow.writableEnded, true); assert.equal(healthy.writableEnded, false); assert.equal(healthy.writes.length, 67)
  } finally { await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

test('Slice C close cancels and settles pending 202 operations before owned runtime disposal', async () => {
  const fixture = await makeRuntimeFixture(); const kb = await createKnowledgeBase({ knowledgeBaseId: 'kb-runtime-close-background-c' })
  const server = new ResearchHubRuntimeServer({ cwd: fixture.cwd, agentDir: fixture.agentDir, sessionDir: fixture.sessionDir, mountedKnowledgeBaseRoot: kb, modelRuntime: fixture.modelRuntime, model: fixture.faux.getModel(), reasoningExecutor: new FixtureExecutor(), port: 0 })
  let conversationReject!: (error: Error) => void; let conversationCancelled = false; let productionCancelled = false; let operationsSettled = false; let runtimeDisposed = false
  const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason) }; process.on('unhandledRejection', onUnhandled)
  try {
    await server.start(); const ownedRuntime = server.applicationRuntime!; const sessionRuntime = ownedRuntime.sessionRuntime
    sessionRuntime.startPrompt = () => ({ accepted: Promise.resolve(), completion: new Promise<void>((_resolve, reject) => { conversationReject = reject }) })
    sessionRuntime.abort = async () => { conversationCancelled = true; conversationReject(new Error('conversation cancelled')) }
    ownedRuntime.productionService.startIngestDocument = ((_input, signal) => ({ runId: 'production-background-c', completion: new Promise<never>((_resolve, reject) => { signal?.addEventListener('abort', () => { productionCancelled = true; reject(new Error('production cancelled')) }, { once: true }) }) })) as typeof ownedRuntime.productionService.startIngestDocument
    const originalClose = ownedRuntime.close.bind(ownedRuntime)
    ownedRuntime.close = async () => { assert.equal(conversationCancelled, true); assert.equal(productionCancelled, true); operationsSettled = true; await originalClose(); runtimeDisposed = true }
    const info = server.address!; const headers = { 'content-type': 'application/json', origin: info.origin, 'x-researchhub-runtime-token': info.runtimeToken }
    assert.equal((await fetch(`${info.origin}/api/conversations/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'pending conversation' }) })).status, 202)
    assert.equal((await fetch(`${info.origin}/api/production/ingest`, { method: 'POST', headers, body: JSON.stringify({ text: 'pending production' }) })).status, 202)
    const registry = (server as unknown as { backgroundOperations: Set<unknown> }).backgroundOperations
    assert.equal(registry.size, 2)
    await server.close()
    assert.equal(operationsSettled, true); assert.equal(runtimeDisposed, true); assert.equal(registry.size, 0); assert.equal(unhandled.length, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled); await server.close(); await fixture.runtime.close(); await removeKnowledgeBase(kb); await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Slice C full background registry observes a rejected overflow operation', async () => {
  const fixture = await makeRuntimeFixture(); const server = new ResearchHubRuntimeServer({ runtime: fixture.runtime, port: 0 })
  const trackBackground = (server as unknown as { trackBackground: (operation: Promise<unknown>, cancel: () => void) => void }).trackBackground.bind(server)
  const releases: Array<() => void> = []; const registry = (server as unknown as { backgroundOperations: Set<unknown> }).backgroundOperations
  const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason) }; process.on('unhandledRejection', onUnhandled)
  try {
    for (let index = 0; index < 128; index += 1) {
      let release!: () => void
      const operation = new Promise<void>((resolve) => { release = resolve })
      releases.push(release); trackBackground(operation, () => release())
    }
    const rejected = Promise.reject(new Error('overflow rejection'))
    assert.throws(() => trackBackground(rejected, () => undefined), /limit/)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(unhandled.length, 0); assert.equal(registry.size, 128)
    await server.close(); assert.equal(registry.size, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled); await server.close(); await fixture.runtime.close(); await rm(fixture.root, { recursive: true, force: true })
  }
})
