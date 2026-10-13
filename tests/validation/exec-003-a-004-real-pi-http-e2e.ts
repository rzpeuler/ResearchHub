import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Model, Api } from '@earendil-works/pi-ai'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/index.ts'
import { PiReasoningExecutor } from '../../plugins/reasoning/pi/executor.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { selectProductionReasoningModel } from '../../app/pi/model-selection.ts'
import { createResearchHubApplicationRuntime } from '../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../app/runtime/server.ts'
import type { ResearchReport } from '../../app/services/research-report.ts'
import type { WorkflowRunView } from '../../app/services/contracts.ts'

type Dict = Record<string, unknown>
const evidencePath = resolve('tests/validation/evidence/RHL-EXEC-003-A-004-real-pi-http-e2e.json')
const tempRoot = await mkdtemp(join(tmpdir(), 'rhl-exec-003-a-004-pi-http-'))
const kbRoot = join(tempRoot, 'knowledge')
let modelRuntime: ModelRuntime | undefined
let app: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
const calls: Dict[] = []
function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function safe(value: unknown): string { return String(value instanceof Error ? value.message : value).replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]').replace(/(api[_-]?key|token|authorization|secret|password)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]').replace(/\s+/g, ' ').slice(0, 300) }
async function snapshotTree(root: string): Promise<readonly { readonly path: string; readonly sha256: string }[]> {
  const result: { path: string; sha256: string }[] = []
  const visit = async (directory: string): Promise<void> => { for (const entry of await readdir(directory, { withFileTypes: true })) { const absolute = join(directory, entry.name); if (entry.isDirectory()) await visit(absolute); else if (entry.isFile()) result.push({ path: absolute.slice(root.length).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') }) } }
  await visit(root); return result.sort((a, b) => a.path.localeCompare(b.path))
}
async function request(origin: string, token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Dict }> {
  const response = await fetch(`${origin}${path}`, { ...init, headers: { origin, 'x-researchhub-runtime-token': token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const body = await response.json().catch(() => ({})); return { status: response.status, body: isRecord(body) ? body : {} }
}
async function waitForTerminal(origin: string, token: string, runId: string): Promise<WorkflowRunView> {
  const deadline = Date.now() + 900_000
  while (Date.now() < deadline) {
    const result = await request(origin, token, `/api/workflows/${encodeURIComponent(runId)}`)
    if (result.status !== 200) throw new Error(`Workflow status HTTP ${result.status}`)
    const run = result.body as unknown as WorkflowRunView
    if (run.executionResult?.terminalStatus && run.executionResult.bundleStatus !== 'pending') return run
    await new Promise((done) => setTimeout(done, 1_000))
  }
  throw new Error('Pi ModelRuntime workflow did not reach a synchronized terminal state within 900000 ms')
}
let terminalError: string | undefined
try {
  await Promise.all([mkdir(join(tempRoot, 'runtime'), { recursive: true }), mkdir(join(tempRoot, 'workspace'), { recursive: true }), mkdir(join(tempRoot, 'sessions'), { recursive: true })])
  await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-exec-003-a-004-real-pi-http', now: new Date().toISOString() })
  modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: true, refreshOnCreate: false })
  const model = selectProductionReasoningModel(modelRuntime) as Model<Api>
  const delegate = new PiReasoningExecutor({ modelRuntime, model, timeoutMs: 180_000, maxOutputChars: 100_000 })
  const executor: ReasoningExecutor = {
    capabilities: () => delegate.capabilities(),
    async execute(input) {
      const record: Dict = { operation: input.operation, startedAt: new Date().toISOString(), status: 'running' }; calls.push(record)
      const startedAt = Date.now()
      try { const result = await delegate.execute(input); record.status = 'returned'; record.elapsedMs = Date.now() - startedAt; return result }
      catch (error) { const elapsedMs = Date.now() - startedAt; record.status = 'error'; record.elapsedMs = elapsedMs; record.errorCategory = /timeout|timed out/i.test(safe(error)) || elapsedMs >= 175_000 ? 'timeout' : 'model_or_validation_error'; throw error }
    },
  }
  app = await createResearchHubApplicationRuntime({ cwd: join(tempRoot, 'runtime'), agentDir: getAgentDir(), sessionDir: join(tempRoot, 'sessions'), workspaceRoot: join(tempRoot, 'workspace'), mountedKnowledgeBaseRoot: kbRoot, modelRuntime, model, reasoningExecutor: executor, startDailyScheduler: false })
  server = new ResearchHubRuntimeServer({ runtime: app, clientRoot: resolve('client/dist'), port: 0 })
  const info = await server.start(); const before = await snapshotTree(kbRoot)
  const started = await request(info.origin, info.runtimeToken, '/api/production/research-company', { method: 'POST', body: JSON.stringify({ symbol: '002487', name: '大金重工', exchange: 'SZSE', maxSources: 1 }) })
  if (started.status !== 202 || typeof started.body.runId !== 'string') throw new Error(`Pi ModelRuntime Company HTTP start failed with status ${started.status}`)
  const runId = started.body.runId
  const workflow = await waitForTerminal(info.origin, info.runtimeToken, runId)
  const bundleResponse = await request(info.origin, info.runtimeToken, `/api/research/bundles/by-run/${encodeURIComponent(runId)}`)
  const bundle = bundleResponse.body
  const reportId = workflow.executionResult?.reportRef
  let report: ResearchReport | undefined
  if (reportId) { const result = await request(info.origin, info.runtimeToken, `/api/research-reports/${encodeURIComponent(reportId)}`); if (result.status === 200) report = result.body as unknown as ResearchReport }
  const after = await snapshotTree(kbRoot)
  const classification = workflow.status === 'completed' && report && bundle.workflowRunId === runId ? calls.every((call) => call.status === 'returned') ? 'REAL_MODEL_COMPLETED' : 'REAL_MODEL_FALLBACK' : calls.some((call) => call.status === 'returned') ? 'REAL_MODEL_PARTIAL' : 'REAL_MODEL_BLOCKED'
  const evidence = { taskId: 'RHL-EXEC-003-A-004', generatedAt: new Date().toISOString(), classification, execution: 'ResearchRunPage HTTP API -> Application Runtime -> ResearchDispatchService -> SecurityIdentityResolver -> ResearchService -> Company Research Workflow -> PiReasoningExecutor -> configured ModelRuntime', model: { provider: model.provider, modelId: model.id, piExecutor: true }, runId, httpStartStatus: started.status, workflow: { status: workflow.status, terminalStatus: workflow.executionResult?.terminalStatus ?? null, bundleStatus: workflow.executionResult?.bundleStatus ?? null, reportRef: reportId ?? null, bundleRef: workflow.executionResult?.bundleRef ?? null, diagnostics: workflow.executionResult?.diagnostics ?? [] }, operationCalls: calls.map((call) => ({ operation: call.operation, status: call.status, elapsedMs: call.elapsedMs ?? null, errorCategory: call.errorCategory ?? null })), report: report ? { reportId: report.reportId, workflowRunId: report.workflowRunId, reportType: report.reportType, evidenceLinkCount: report.sections.flatMap((section) => section.evidenceLinks ?? []).length, canonicalRefCount: [...report.subjectRefs, ...report.sourceRefs, ...report.claimRefs].length, reloaded: true } : null, bundle: { bundleId: typeof bundle.bundleId === 'string' ? bundle.bundleId : null, workflowRunId: typeof bundle.workflowRunId === 'string' ? bundle.workflowRunId : null, reloaded: bundleResponse.status === 200 }, readOnlyKnowledge: { unchanged: JSON.stringify(before) === JSON.stringify(after), beforePathCount: before.length, afterPathCount: after.length, digest: createHash('sha256').update(JSON.stringify(after)).digest('hex') }, secretsIncluded: false, rawProviderBodiesIncluded: false, hiddenReasoningIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.log(JSON.stringify({ evidencePath, classification: evidence.classification, workflowStatus: workflow.status, operationCalls: calls.length, reportReloaded: report !== undefined, bundleReloaded: bundleResponse.status === 200 }, null, 2))
} catch (error) {
  terminalError = safe(error)
  const evidence = { taskId: 'RHL-EXEC-003-A-004', generatedAt: new Date().toISOString(), classification: calls.length === 0 ? 'REAL_MODEL_BLOCKED' : 'REAL_MODEL_FALLBACK', error: terminalError, operationCalls: calls.map((call) => ({ operation: call.operation, status: call.status, elapsedMs: call.elapsedMs ?? null, errorCategory: call.errorCategory ?? null })), secretsIncluded: false, rawProviderBodiesIncluded: false, hiddenReasoningIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); console.error(JSON.stringify({ evidencePath, classification: evidence.classification, error: terminalError, operationCalls: calls.length }, null, 2)); process.exitCode = 1
} finally {
  await server?.close().catch(() => undefined); await app?.close().catch(() => undefined); await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> } | undefined)?.dispose?.()).catch(() => undefined)
  if (!terminalError) await rm(tempRoot, { recursive: true, force: true })
}
