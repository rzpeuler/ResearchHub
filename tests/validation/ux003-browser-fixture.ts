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
import { WorkflowService } from '../../app/services/workflow-service.ts'
import { ResearchService } from '../../app/services/research-service.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { SecurityIdentityResolver } from '../../app/services/security-identity-resolver.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
const repositoryRoot = resolve(import.meta.dirname, '../..')
const clientRoot = join(repositoryRoot, 'dist', 'client')
const root = process.env.RHL_UX003_FIXTURE_ROOT ? resolve(process.env.RHL_UX003_FIXTURE_ROOT) : await mkdtemp(join(tmpdir(), 'researchhub-ux003-browser-'))
const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions'); const workspaceRoot = join(root, 'workspace'); const knowledgeBaseRoot = join(root, 'knowledge-base')
await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true }); await mkdir(workspaceRoot, { recursive: true })
if (!process.env.RHL_UX003_FIXTURE_ROOT) {
  await createFreshKnowledgeBaseV04(knowledgeBaseRoot, { knowledgeBaseId: `ux003-browser-${Date.now()}` })
  await writeFile(join(knowledgeBaseRoot, 'entities', 'fixture-002640.yaml'), JSON.stringify({ id: 'entity:fixture-002640', type: 'company', name: '跨境通', aliases: ['跨境通'], ticker: '002640', exchange: 'SZSE', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(knowledgeBaseRoot, 'registry', 'assets.yaml'), JSON.stringify({ 'entity:fixture-002640': { type: 'entity', storageRef: 'entities/fixture-002640.yaml' } }) + '\n')
}

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

let acquisitionGate: { promise: Promise<void>; release: () => void } | undefined
let acquisitionGateArmed = false
const acquiredAt = new Map<string, string>()
class FixtureAcquisition implements ResearchAcquisitionPlugin {
  constructor(readonly name: string, public failDiscovery = false) {}
  async discover(request: ResearchAcquisitionRequest, signal?: AbortSignal): Promise<readonly ResearchSourceCandidate[]> {
    const startedAt = new Date().toISOString()
    acquiredAt.set(this.name, startedAt)
    process.stdout.write(`PROVIDER_DISCOVER ${JSON.stringify({ provider: this.name, startedAt })}\n`)
    if (acquisitionGateArmed && acquisitionGate) await Promise.race([acquisitionGate.promise, new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('WORKFLOW_CANCELLED')), { once: true }))])
    if (this.failDiscovery) throw new Error('controlled isolated fixture provider failure')
    const publishedAt = request.asOf ?? new Date().toISOString()
    return [{ candidateId: 'fixture-gdelt-document', kind: 'news', tier: 3, title: 'Fixture company announcement', url: 'https://example.invalid/research/fixture', provider: 'GDELT', publishedAt, snippet: 'Isolated fixture evidence published for browser acceptance.' }]
  }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> {
    const retrievedAt = new Date().toISOString()
    process.stdout.write(`PROVIDER_FETCH ${JSON.stringify({ provider: this.name, candidateId: candidate.candidateId, retrievedAt })}\n`)
    return { candidate, retrievedAt, contentType: 'text/plain', content: 'Fixture evidence: this isolated source confirms only that the browser acceptance path received a bounded source.' }
  }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> {
    process.stdout.write(`PROVIDER_NORMALIZE ${JSON.stringify({ provider: this.name, candidateId: source.candidate.candidateId, retrievedAt: source.retrievedAt })}\n`)
    return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, canonicalUrl: source.candidate.url, contentHash: sha256(source.content), publisher: 'Fixture publisher', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
  }
}

const workflowService = new WorkflowService()
const cninfo = new FixtureAcquisition('CNINFO', true)
const gdelt = new FixtureAcquisition('GDELT')
const identityResolver = new SecurityIdentityResolver({ mountedKnowledgeBaseRoot: knowledgeBaseRoot, dataResolverFactory: () => { throw new Error('Fixture canonical identity lookup should resolve before external directory access') } })
const realResearchService = new ResearchService({ mountedKnowledgeBaseRoot: knowledgeBaseRoot, cwd, reportRoot: join(cwd, 'runtime-data', 'reports'), acquisitionPlugins: [cninfo, gdelt], researchEvidenceProviders: { cninfo, gdelt }, workflowService, reasoningExecutor: new FixtureExecutor(), securityIdentityResolver: identityResolver })
const researchServiceInternals = realResearchService as unknown as Record<string, unknown>
const originalCompanyResolverFactory = researchServiceInternals.createCompanyDataResolverFactory
if (typeof originalCompanyResolverFactory !== 'function') throw new Error('Company Research DataResolver factory is unavailable in this fixture')
researchServiceInternals.createCompanyDataResolverFactory = function () {
  const factory = Reflect.apply(originalCompanyResolverFactory, realResearchService, []) as (context: unknown) => { resolve: (...args: unknown[]) => Promise<{ items: readonly { requirementId: string; status: string; attempts: readonly { sourceId: string; status: string }[] }[] }> }
  return (context: unknown) => {
    const resolver = factory(context)
    const resolve = resolver.resolve.bind(resolver)
    resolver.resolve = async (...args: unknown[]) => {
      const bundle = await resolve(...args)
      process.stdout.write(`DATA_RESOLVER_RESULT ${JSON.stringify({ items: bundle.items.map((item) => ({ requirementId: item.requirementId, status: item.status, attempts: item.attempts.map(({ sourceId, status }) => ({ sourceId, status })) })) })}\n`)
      return bundle
    }
    return resolver
  }
}
const originalListResearchReports = realResearchService.listResearchReports.bind(realResearchService)
Object.assign(realResearchService, { listResearchReports: async (limit?: number) => { try { return await originalListResearchReports(limit) } catch (error) { process.stderr.write(`REPORT_SERVICE_ERROR ${JSON.stringify({ method: 'listResearchReports', error: error instanceof Error ? error.stack ?? error.message : String(error) })}\n`); throw error } } })
const originalGetResearchReport = realResearchService.getResearchReport.bind(realResearchService)
Object.assign(realResearchService, { getResearchReport: async (reportId: string) => { try { return await originalGetResearchReport(reportId) } catch (error) { process.stderr.write(`REPORT_SERVICE_ERROR ${JSON.stringify({ method: 'getResearchReport', reportId, error: error instanceof Error ? error.stack ?? error.message : String(error) })}\n`); throw error } } })

const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
const faux = fauxProvider({ provider: process.env.RHL_UX003_MODEL_PROVIDER ?? 'researchhub-ux003-browser-fixture', models: [{ id: 'fixture-model' }], tokensPerSecond: 18, tokenSize: { min: 1, max: 3 } })
modelRuntime.registerNativeProvider(faux.provider)
faux.setResponses(Array.from({ length: 256 }, (_, index) => fauxAssistantMessage(`Fixture response ${index + 1}.`)))

const completionByRunId = new Map<string, Promise<unknown>>()
const startInputs: Array<{ workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }> = []
const originalStartCompanyResearch = realResearchService.startResearchCompany.bind(realResearchService)
realResearchService.startResearchCompany = ((input: import('../../app/services/contracts.ts').ResearchCompanyInput, ...args: Parameters<typeof realResearchService.startResearchCompany> extends [unknown, ...infer Rest] ? Rest : never) => {
  startInputs.push({ workflowRunId: input.workflowRunId, symbol: input.symbol, ...(input.name ? { name: input.name } : {}), writeKnowledge: input.writeKnowledge === true })
  const started = originalStartCompanyResearch(input, ...args)
  completionByRunId.set(input.workflowRunId, started.completion)
  void started.completion.then((result) => {
    const providerOutcomes = (result.providerOutcomes ?? []) as readonly { readonly provider: string; readonly providerAttempted: boolean; readonly providerSucceeded: boolean; readonly providerEmpty: boolean; readonly providerFailed: boolean; readonly usableSourceCount: number }[]
    process.stdout.write(`COMPANY_PROVIDER_OUTCOMES ${JSON.stringify(providerOutcomes.map(({ provider, providerAttempted, providerSucceeded, providerEmpty, providerFailed, usableSourceCount }) => ({ provider, providerAttempted, providerSucceeded, providerEmpty, providerFailed, usableSourceCount }))) }\n`)
  })
  process.stdout.write(`REAL_COMPANY_WORKFLOW_STARTED ${JSON.stringify(input)}\n`)
  return started
}) as typeof realResearchService.startResearchCompany

const options = { cwd, agentDir, sessionDir, mountedKnowledgeBaseRoot: knowledgeBaseRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), workflowService, securityIdentityResolver: identityResolver, researchService: realResearchService }
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
let serverPort = 0
let proxyPort = 0
let proxyServer: HttpServer | undefined
const eventStreamResponses = new Set<ServerResponse>()
const performanceSamples: Array<{ index: number; durationMs: number; handlerCostMs: number; observerCostMs: number }> = []
const piLifecycleEvidence: Array<{ event: string; conversationId?: string; at: string }> = []
let eventsUnavailableUntil = 0
let dropNextDispatchResponse = false
let acceptGate: { readonly promise: Promise<void>; readonly release: () => void } | undefined
let activeAcceptGate: { readonly promise: Promise<void>; readonly release: () => void } | undefined
let rejectNextAccept = false
let closed = false

const browserPerformanceProbe = `
<script>
(() => {
  const pending = new Map();
  let handlerCostMs = 0;
  let observerCostMs = 0;
  let completedSampleCount = 0;
  const post = (sample) => fetch('/__fixture/performance-sample', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sample), keepalive: true }).catch(() => {});
  document.addEventListener('click', (event) => {
    const started = performance.now();
    const button = event.target instanceof Element ? event.target.closest('.composer-actions button') : null;
    if (button && (button.textContent.includes('Send') || button.textContent.includes('发送'))) {
      const textarea = document.querySelector('textarea[aria-label="Message"],textarea[aria-label="消息"]');
      const text = textarea?.value || '';
      if (text.startsWith('UX002 internal paint sample ')) pending.set(text, { index: Number(text.slice(-3)), startedAt: started, done: false, handlerCostMs: 0, observerBaseline: observerCostMs });
    }
    const cost = performance.now() - started;
    handlerCostMs += cost;
    const textarea = document.querySelector('textarea[aria-label="Message"],textarea[aria-label="消息"]');
    const sample = pending.get(textarea?.value || '');
    if (sample) sample.handlerCostMs = cost;
  }, true);
  const observer = new MutationObserver((records) => {
    const started = performance.now();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const row = target?.closest('.optimistic-request') || target?.querySelector?.('.optimistic-request') || [...record.addedNodes].map((node) => node instanceof Element ? node.matches('.optimistic-request') ? node : node.querySelector('.optimistic-request') : null).find(Boolean);
      if (!row) continue;
      const text = row.querySelector('.message-body')?.textContent || '';
      const sample = pending.get(text);
      if (!sample || sample.done) continue;
      sample.done = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const durationMs = performance.now() - sample.startedAt;
        completedSampleCount++;
        post({ index: sample.index, durationMs, handlerCostMs: sample.handlerCostMs, observerCostMs: Math.max(0, observerCostMs - sample.observerBaseline) });
      }));
    }
    observerCostMs += performance.now() - started;
  });
  window.__ux002PerformanceProbe = { get completedSampleCount() { return completedSampleCount; }, get handlerCostMs() { return handlerCostMs; }, get observerCostMs() { return observerCostMs; } };
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
</script>`

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } { let release!: () => void; const promise = new Promise<void>((resolveGate) => { release = resolveGate }); return { promise, release } }

async function startServer(): Promise<void> {
  server = new ResearchHubRuntimeServer({ runtime, clientRoot, port: serverPort })
  const info = await server.start()
  serverPort = Number(new URL(info.origin).port)
  if (!proxyServer) {
    proxyServer = createHttpServer((incoming, outgoing) => {
      const path = incoming.url ?? '/'
      const pathname = new URL(path, 'http://127.0.0.1').pathname
      if (pathname === '/__fixture/performance-sample' && incoming.method === 'GET') {
        outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        outgoing.end(JSON.stringify(performanceSamples))
        return
      }
      if (pathname === '/__fixture/performance-sample' && incoming.method === 'POST') {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { index?: number; durationMs?: number; handlerCostMs?: number; observerCostMs?: number; done?: boolean; count?: number; error?: string }
            if (value.done) process.stdout.write(`PERFORMANCE_DONE ${JSON.stringify(value)}\n`)
            else if (value.error) process.stdout.write(`PERFORMANCE_ERROR ${JSON.stringify(value)}\n`)
            else if (typeof value.index === 'number' && Number.isFinite(value.durationMs)) performanceSamples.push({ index: value.index, durationMs: value.durationMs!, handlerCostMs: value.handlerCostMs ?? 0, observerCostMs: value.observerCostMs ?? 0 })
            outgoing.writeHead(204, { 'cache-control': 'no-store' }); outgoing.end()
          } catch { outgoing.writeHead(400); outgoing.end() }
        })
        return
      }
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
        if ((upstreamResponse.headers['content-type'] ?? '').includes('text/html') && new URL(path, 'http://127.0.0.1').searchParams.has('ux002Perf')) {
          const chunks: Buffer[] = []
          upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk))
          upstreamResponse.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf8').replace('</head>', `${browserPerformanceProbe}</head>`)
            const headers = { ...upstreamResponse.headers, 'content-length': Buffer.byteLength(html) }
            outgoing.writeHead(upstreamResponse.statusCode ?? 200, headers); outgoing.end(html)
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

function instrumentPiSessionLifecycle(): void {
  const sessionRuntime = runtime!.sessionRuntime as unknown as { piRuntime: { session: { sessionManager: { getSessionId(): string | undefined }; abort(): Promise<void>; dispose(): void }; switchSession(path: string): Promise<unknown>; newSession(...args: unknown[]): Promise<unknown> } }
  const piRuntime = sessionRuntime.piRuntime
  const instrumentOutgoing = (outgoing: typeof piRuntime.session) => {
    const conversationId = outgoing.sessionManager.getSessionId()
    const originalAbort = outgoing.abort.bind(outgoing)
    const originalDispose = outgoing.dispose.bind(outgoing)
    outgoing.abort = async () => { piLifecycleEvidence.push({ event: 'session.abort.begin', conversationId, at: new Date().toISOString() }); try { await originalAbort() } finally { piLifecycleEvidence.push({ event: 'session.abort.end', conversationId, at: new Date().toISOString() }) } }
    outgoing.dispose = () => { piLifecycleEvidence.push({ event: 'session.dispose', conversationId, at: new Date().toISOString() }); return originalDispose() }
    return conversationId
  }
  const originalSwitch = piRuntime.switchSession.bind(piRuntime)
  piRuntime.switchSession = async (path: string) => {
    const outgoing = piRuntime.session
    instrumentOutgoing(outgoing)
    try { return await originalSwitch(path) } finally { piLifecycleEvidence.push({ event: 'session.switch.complete', conversationId: piRuntime.session.sessionManager.getSessionId(), at: new Date().toISOString() }) }
  }
  const originalNewSession = piRuntime.newSession.bind(piRuntime)
  piRuntime.newSession = async (...args: unknown[]) => {
    instrumentOutgoing(piRuntime.session)
    try { return await Reflect.apply(originalNewSession, piRuntime, args) } finally { piLifecycleEvidence.push({ event: 'session.new.complete', conversationId: piRuntime.session.sessionManager.getSessionId(), at: new Date().toISOString() }) }
  }
}

async function start(): Promise<void> {
  runtime = await createResearchHubApplicationRuntime(options)
  await installAcceptControls()
  instrumentPiSessionLifecycle()
  await startServer()
}

async function releaseRuns(): Promise<void> {
  acquisitionGate?.release()
  acquisitionGate = undefined
  acquisitionGateArmed = false
  await Promise.all(completionByRunId.values())
  completionByRunId.clear()
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
    if (command === 'fail-all-providers') { cninfo.failDiscovery = true; gdelt.failDiscovery = true; process.stdout.write('PROVIDER_FAILURES_ARMED\n'); return }
    if (command === 'fixture-providers-default') { cninfo.failDiscovery = true; gdelt.failDiscovery = false; process.stdout.write('PROVIDER_FIXTURE_DEFAULTS_RESTORED\n'); return }
    if (command === 'hold-acquisition') { acquisitionGate = deferred(); acquisitionGateArmed = true; process.stdout.write('ACQUISITION_HELD\n'); return }
    if (command === 'release-acquisition') { acquisitionGate?.release(); acquisitionGate = undefined; acquisitionGateArmed = false; process.stdout.write('ACQUISITION_RELEASED\n'); return }
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
    if (command === 'snapshot') process.stdout.write(`SNAPSHOT ${JSON.stringify({ started: startInputs, knowledgeBaseSha256: await snapshotKnowledge(), piLifecycleEvidence, performanceSamples, providerDiscovery: Object.fromEntries(acquiredAt), workflows: startInputs.map(({ workflowRunId }) => workflowService.getWorkflowStatus(workflowRunId)) })}\n`)
  })().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`) })
})
process.on('SIGINT', () => { void shutdown(true).finally(() => process.exit(0)) })
process.on('SIGTERM', () => { void shutdown(true).finally(() => process.exit(0)) })

await start()
