import { createHash } from 'node:crypto'
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../app/runtime/server.ts'
import { ApplicationServiceError } from '../../app/services/contracts.ts'
import type { WorkflowService } from '../../app/services/workflow-service.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
const repositoryRoot = resolve(import.meta.dirname, '../..')
const clientRoot = join(repositoryRoot, 'dist', 'client')
const root = await mkdtemp(join(tmpdir(), 'researchhub-ux002-browser-'))
const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions'); const workspaceRoot = join(root, 'workspace'); const knowledgeBaseRoot = join(root, 'knowledge-base')
await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true }); await mkdir(workspaceRoot, { recursive: true })
await createFreshKnowledgeBaseV04(knowledgeBaseRoot, { knowledgeBaseId: `ux002-browser-${Date.now()}` })
await writeFile(join(knowledgeBaseRoot, 'entities', 'fixture-002640.yaml'), JSON.stringify({ id: 'entity:fixture-002640', type: 'company', name: '跨境通', aliases: ['跨境通'], ticker: '002640', exchange: 'SZSE', lifecycle: { status: 'active' } }) + '\n')
await writeFile(join(knowledgeBaseRoot, 'registry', 'assets.yaml'), JSON.stringify({ 'entity:fixture-002640': { type: 'entity', storageRef: 'entities/fixture-002640.yaml' } }) + '\n')

async function snapshotKnowledge(): Promise<string> {
  const files: Array<[string, string]> = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(path, relative)
      else if (entry.isFile()) files.push([relative, createHash('sha256').update(await readFile(path)).digest('hex')])
      else throw new Error(`Unexpected Knowledge Base entry: ${relative}`)
    }
  }
  await visit(knowledgeBaseRoot, '')
  return createHash('sha256').update(JSON.stringify(files.sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}

class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: Parameters<ReasoningExecutor['execute']>[0]) { return { operation: request.operation, output: {} } as never }
}

const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
const faux = fauxProvider({ provider: `researchhub-ux002-browser-${Date.now()}`, models: [{ id: 'fixture-model' }], tokensPerSecond: 18, tokenSize: { min: 1, max: 3 } })
modelRuntime.registerNativeProvider(faux.provider)
faux.setResponses([fauxAssistantMessage('Fixture response.')])

let workflowService: WorkflowService | undefined
const releaseByRunId = new Map<string, () => void>()
const completionByRunId = new Map<string, Promise<unknown>>()
const startInputs: Array<{ workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }> = []
const researchService = {
  startResearchCompany(input: { workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }) {
    startInputs.push(input)
    const service = workflowService!
    service.register({ runId: input.workflowRunId, workflowType: 'company_research', objective: `Company Research ${input.symbol}` })
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    releaseByRunId.set(input.workflowRunId, release)
    const completion = service.start(input.workflowRunId, async () => { await gate; return { status: 'completed' as const, summary: 'Isolated browser acceptance fixture.' } })
    completionByRunId.set(input.workflowRunId, completion)
    process.stdout.write(`WORKFLOW_STARTED ${JSON.stringify(input)}\n`)
    return { runId: input.workflowRunId, completion }
  },
}

const options = { cwd, agentDir, sessionDir, mountedKnowledgeBaseRoot: knowledgeBaseRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), researchService: researchService as never }
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
let serverPort = 0
let proxyPort = 0
let proxyServer: HttpServer | undefined
const eventStreamResponses = new Set<ServerResponse>()
let eventsUnavailableUntil = 0
let dropNextDispatchResponse = false
let acceptGate: { readonly promise: Promise<void>; readonly release: () => void } | undefined
let activeAcceptGate: { readonly promise: Promise<void>; readonly release: () => void } | undefined
let rejectNextAccept = false
let closed = false

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } { let release!: () => void; const promise = new Promise<void>((resolveGate) => { release = resolveGate }); return { promise, release } }

async function startServer(): Promise<void> {
  server = new ResearchHubRuntimeServer({ runtime, clientRoot, port: serverPort })
  const info = await server.start()
  serverPort = Number(new URL(info.origin).port)
  if (!proxyServer) {
    proxyServer = createHttpServer((incoming, outgoing) => {
      const path = incoming.url ?? '/'
      if (path === '/api/events' && Date.now() < eventsUnavailableUntil) { outgoing.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); outgoing.end('Fixture SSE interruption'); return }
      const dropDispatchResponse = dropNextDispatchResponse && path === '/api/research/dispatch' && incoming.method === 'POST'
      if (dropDispatchResponse) dropNextDispatchResponse = false
      const upstream = httpRequest({ host: '127.0.0.1', port: serverPort, method: incoming.method, path, headers: { ...incoming.headers, host: `127.0.0.1:${serverPort}`, ...(incoming.headers.origin ? { origin: info.origin } : {}) } }, (upstreamResponse) => {
        if (path === '/api/events' && upstreamResponse.statusCode === 200) {
          eventStreamResponses.add(outgoing)
          outgoing.once('close', () => { eventStreamResponses.delete(outgoing); upstream.destroy() })
        }
        if (dropDispatchResponse && (upstreamResponse.statusCode ?? 500) >= 200 && (upstreamResponse.statusCode ?? 500) < 300) {
          upstreamResponse.resume()
          upstreamResponse.on('end', () => { process.stdout.write(`DISPATCH_RESPONSE_DROPPED ${upstreamResponse.statusCode}\n`); outgoing.destroy() })
          return
        }
        if (path === '/api/bootstrap' && (upstreamResponse.headers['content-type'] ?? '').includes('application/json')) {
          const chunks: Buffer[] = []
          upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk))
          upstreamResponse.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { origin?: string; runtime?: { origin?: string } }
              const publicOrigin = `http://127.0.0.1:${proxyPort}`
              body.origin = publicOrigin
              if (body.runtime) body.runtime.origin = publicOrigin
              const headers = { ...upstreamResponse.headers, 'content-length': Buffer.byteLength(JSON.stringify(body)) }
              outgoing.writeHead(upstreamResponse.statusCode ?? 200, headers)
              outgoing.end(JSON.stringify(body))
            } catch {
              outgoing.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
              outgoing.end('Fixture could not rewrite Runtime bootstrap origin')
            }
          })
          return
        }
        outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(outgoing)
      })
      upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.destroy() })
      incoming.pipe(upstream)
    })
    await new Promise<void>((resolveListen, rejectListen) => { proxyServer!.once('error', rejectListen); proxyServer!.listen(0, '127.0.0.1', resolveListen) })
    proxyPort = Number((proxyServer.address() as import('node:net').AddressInfo).port)
  }
  process.stdout.write(`READY ${JSON.stringify({ origin: `http://127.0.0.1:${proxyPort}`, runtimeOrigin: info.origin, persistentPiSessionManager: runtime!.sessionManager.isPersisted(), provider: 'faux', modelNetwork: false, knowledgeBaseSha256: await snapshotKnowledge() })}\n`)
}

async function installAcceptControls(): Promise<void> {
  const store = runtime!.sessionRuntime.conversationStateStore
  const accept = store.acceptRequest.bind(store)
  store.acceptRequest = async (...args: Parameters<typeof store.acceptRequest>) => {
    if (rejectNextAccept) { rejectNextAccept = false; throw new ApplicationServiceError('conflict', 'Fixture rejected request before acceptance') }
    if (acceptGate !== undefined) { activeAcceptGate = acceptGate; acceptGate = undefined; process.stdout.write('ACCEPT_HELD\n'); await activeAcceptGate.promise; activeAcceptGate = undefined }
    return accept(...args)
  }
}

async function start(): Promise<void> {
  runtime = await createResearchHubApplicationRuntime(options)
  workflowService = runtime.workflowService
  await installAcceptControls()
  await startServer()
}

async function releaseRuns(): Promise<void> {
  for (const release of releaseByRunId.values()) release()
  await Promise.all(completionByRunId.values())
  releaseByRunId.clear(); completionByRunId.clear()
}

async function stop(): Promise<void> {
  if (server) await server.close()
  server = undefined
  if (runtime) await runtime.close()
  runtime = undefined
}

async function shutdown(removeFixture: boolean): Promise<void> {
  if (closed) return
  closed = true
  acceptGate?.release(); acceptGate = undefined
  activeAcceptGate?.release(); activeAcceptGate = undefined
  await releaseRuns().catch(() => undefined)
  await stop().catch(() => undefined)
  if (proxyServer) { await new Promise<void>((resolveClose) => proxyServer!.close(() => resolveClose())); proxyServer = undefined }
  if (removeFixture) await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  void (async () => {
    const command = line.trim()
    if (command === 'hold-next-accept') { acceptGate = deferred(); process.stdout.write('ACCEPT_ARMED\n'); return }
    if (command === 'release-accept') { activeAcceptGate?.release(); activeAcceptGate = undefined; acceptGate?.release(); acceptGate = undefined; process.stdout.write('ACCEPT_RELEASED\n'); return }
    if (command === 'reject-next-accept') { rejectNextAccept = true; process.stdout.write('ACCEPT_REJECTION_ARMED\n'); return }
    if (command === 'lose-next-dispatch-response') { dropNextDispatchResponse = true; process.stdout.write('DISPATCH_RESPONSE_LOSS_ARMED\n'); return }
    if (command === 'reply-short') { faux.setResponses([fauxAssistantMessage('分段回复：第一段。第二段已到达。')]); return }
    if (command === 'reply-long') { faux.setResponses([fauxAssistantMessage(Array.from({ length: 100 }, (_, index) => `第${index + 1}段实时内容`).join('；'))]); return }
    if (command === 'reply-tool') { faux.setResponses([fauxAssistantMessage(fauxToolCall('researchhub_status', {}, { id: `ux002-tool-${Date.now()}` })), fauxAssistantMessage('工具检查已完成。')]); return }
    if (command === 'reply-error') { faux.setResponses([fauxAssistantMessage('受控失败回复。', { stopReason: 'error', errorMessage: 'controlled provider failure' })]); return }
    if (command === 'bounce-events') { eventsUnavailableUntil = Date.now() + 2_500; for (const response of [...eventStreamResponses]) response.destroy(); process.stdout.write('EVENT_STREAM_INTERRUPTED\n'); return }
    if (command === 'release') { await releaseRuns(); process.stdout.write(`RELEASED ${JSON.stringify(startInputs)}\n`); return }
    if (command === 'stop') { await shutdown(true); input.close(); process.exitCode = 0; return }
    if (command === 'snapshot') process.stdout.write(`SNAPSHOT ${JSON.stringify({ started: startInputs, knowledgeBaseSha256: await snapshotKnowledge() })}\n`)
  })().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`) })
})
process.on('SIGINT', () => { void shutdown(true).finally(() => process.exit(0)) })
process.on('SIGTERM', () => { void shutdown(true).finally(() => process.exit(0)) })

await start()
