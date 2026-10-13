import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { createResearchHubApplicationRuntime } from '../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../app/runtime/server.ts'
import type { ResearchReport } from '../../app/services/research-report.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResearchBundle } from '../../app/services/research-bundle.ts'
import type { WorkflowRunView } from '../../app/services/contracts.ts'

type Dict = Record<string, unknown>
type Target = { readonly symbol: '002487' | '600519'; readonly exchange: 'SZSE' | 'SSE'; readonly name: string; readonly fiscalRuns: readonly { readonly fiscalYear: 2025 | 2026; readonly period: 'FY' | 'H1' }[] }
type Operation = 'company' | 'valuation' | 'earnings'
const targets: readonly Target[] = [
  { symbol: '002487', exchange: 'SZSE', name: '大金重工', fiscalRuns: [{ fiscalYear: 2025, period: 'FY' }, { fiscalYear: 2026, period: 'H1' }] },
  { symbol: '600519', exchange: 'SSE', name: '贵州茅台', fiscalRuns: [{ fiscalYear: 2025, period: 'FY' }, { fiscalYear: 2026, period: 'H1' }] },
]
const selectedSymbol = process.env.RHL_A004_E2E_SYMBOL
const selectedOperation = process.env.RHL_A004_E2E_OPERATION as Operation | undefined
const sourceLimit = process.env.RHL_A004_E2E_MAX_SOURCES === undefined ? 2 : Number(process.env.RHL_A004_E2E_MAX_SOURCES)
const runTargets = selectedSymbol ? targets.filter((target) => target.symbol === selectedSymbol) : targets
if (runTargets.length === 0) throw new Error(`RHL_A004_E2E_SYMBOL is not a configured sample: ${selectedSymbol}`)
if (selectedOperation !== undefined && !['company', 'valuation', 'earnings'].includes(selectedOperation)) throw new Error(`RHL_A004_E2E_OPERATION is invalid: ${selectedOperation}`)
if (!Number.isSafeInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 50) throw new Error('RHL_A004_E2E_MAX_SOURCES must be an integer from 1 to 50')
const operationPath: Record<Operation, string> = { company: '/api/production/research-company', valuation: '/api/production/analyze-valuation', earnings: '/api/production/review-earnings' }
const terminalStatuses = new Set(['completed', 'completed_with_review', 'blocked', 'failed', 'cancelled'])
const evidencePath = resolve(process.env.RHL_A004_EVIDENCE_PATH ?? 'tests/validation/evidence/RHL-EXEC-003-A-004-real-http-e2e.json')
const reportSnapshotPath = process.env.RHL_A004_REPORT_SNAPSHOT_PATH === undefined ? undefined : resolve(process.env.RHL_A004_REPORT_SNAPSHOT_PATH)

class DeterministicFallbackExecutor implements ReasoningExecutor {
  capabilities() { return { maxContextTokens: 100_000, maxOutputTokens: 20_000, structuredOutputSupport: true, maxConcurrency: 2 } }
  async execute(request: Parameters<ReasoningExecutor['execute']>[0]) { return { operation: request.operation, operationId: `a004-http-${request.operation}`, output: {} } }
}

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function itemIdentityWasVerified(value: unknown): boolean { return isRecord(value) && isRecord(value.verifiedSecurityIdentity) && typeof value.verifiedSecurityIdentity.verifiedName === 'string' && typeof value.verifiedSecurityIdentity.verificationSource === 'string' }
function shortError(value: unknown): string { return (value instanceof Error ? value.message : String(value)).replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]').replace(/(api[_-]?key|token|authorization)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]').slice(0, 500) }
function safeDiagnostic(value: unknown): string { return String(value).replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]').replace(/(api[_-]?key|token|authorization|secret|password)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]').replace(/\s+/g, ' ').slice(0, 240) }
function safeEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return undefined
  try { const url = new URL(value); for (const key of [...url.searchParams.keys()]) if (/(?:token|key|secret|auth|password)/i.test(key)) url.searchParams.set(key, '[redacted]'); return url.href.slice(0, 2_048) } catch { return undefined }
}
async function snapshotTree(root: string): Promise<readonly { readonly path: string; readonly kind: 'file' | 'directory'; readonly sha256?: string }[]> {
  const rows: { path: string; kind: 'file' | 'directory'; sha256?: string }[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      const path = absolute.slice(root.length).replaceAll('\\', '/') || '/'
      if (entry.isDirectory()) { rows.push({ path, kind: 'directory' }); await visit(absolute) }
      else if (entry.isFile()) rows.push({ path, kind: 'file', sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') })
    }
  }
  await visit(root)
  return rows.sort((left, right) => left.path.localeCompare(right.path))
}
async function requestJson(origin: string, token: string, path: string, init: RequestInit = {}): Promise<{ readonly status: number; readonly body: Dict }> {
  const response = await fetch(`${origin}${path}`, { ...init, headers: { origin, 'x-researchhub-runtime-token': token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body: isRecord(body) ? body : {} }
}
async function pollTerminal(origin: string, token: string, runId: string, timeoutMs = 3_600_000): Promise<WorkflowRunView> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await requestJson(origin, token, `/api/workflows/${encodeURIComponent(runId)}`)
    if (result.status !== 200) throw new Error(`Workflow ${runId} status request returned HTTP ${result.status}`)
    const workflow = result.body as unknown as WorkflowRunView
    if (terminalStatuses.has(workflow.status) && workflow.executionResult?.bundleStatus !== 'pending') return workflow
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  }
  throw new Error(`Workflow ${runId} did not reach a synchronized terminal status within ${timeoutMs} ms`)
}
function reportRefIds(report: ResearchReport): readonly string[] {
  return [...new Set([...report.subjectRefs, ...report.sourceRefs, ...report.claimRefs, ...report.sections.flatMap((section) => [...(section.sourceRefs ?? []), ...(section.claimRefs ?? []), ...(section.relationRefs ?? [])])])]
}
function providerSummary(value: unknown): readonly Dict[] {
  const record = isRecord(value) ? value : {}
  const candidates = Array.isArray(record.providerOutcomes) ? record.providerOutcomes : Array.isArray(record.providerOutcome) ? record.providerOutcome : isRecord(record.providerOutcome) ? [record.providerOutcome] : []
  return candidates.filter(isRecord).map((item) => ({ provider: item.provider ?? item.retrievalProvider ?? null, attempted: item.providerAttempted ?? item.attempted ?? null, succeeded: item.providerSucceeded ?? item.transportSucceeded ?? null, empty: item.providerEmpty ?? item.empty ?? null, failed: item.providerFailed ?? item.failed ?? null, usableSourceCount: item.usableSourceCount ?? null, diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.slice(0, 8).map(safeDiagnostic) : [], ...Object.fromEntries(['marketTransportSucceeded', 'financialTransportSucceeded', 'officialPublicationVerified', 'companyBasicRowCount', 'financialRowCount', 'marketRowCount', 'marketPriceFound', 'fiscalYearBasisFound', 'usableForValuation'].filter((key) => item[key] !== undefined).map((key) => [key, item[key]])) }))
}
function reportsAndBundlesReconciled(runs: readonly Dict[], expectedRunCount: number): boolean {
  return runs.length === expectedRunCount && runs.every((run) => {
    const runId = run.runId
    const lifecycle = isRecord(run.lifecycle) ? run.lifecycle : {}
    const bundle = isRecord(run.bundle) ? run.bundle : {}
    const report = run.report === null ? undefined : isRecord(run.report) ? run.report : undefined
    if (typeof runId !== 'string' || lifecycle.bundleStatus !== 'available' || lifecycle.bundleRef !== bundle.bundleId) return false
    if (bundle.reloaded !== true || bundle.bundleId !== `research-bundle-${runId}` || bundle.workflowRunId !== runId) return false
    if (bundle.terminalStatus !== lifecycle.terminalStatus || lifecycle.status !== lifecycle.terminalStatus) return false
    if (typeof lifecycle.reportRef !== 'string') return report === undefined && bundle.reportId === null
    return report !== undefined
      && report.reportId === lifecycle.reportRef
      && report.reportId === bundle.reportId
      && report.workflowRunId === runId
      && report.reportReloaded === true
      && report.canonicalRefsResolve === true
  })
}

const tempRoot = await mkdtemp(join(tmpdir(), 'rhl-exec-003-a-004-http-'))
const kbRoot = join(tempRoot, 'knowledge')
const cwd = join(tempRoot, 'runtime')
const workspaceRoot = join(tempRoot, 'workspace')
const agentDir = join(tempRoot, 'agent')
const sessions = join(tempRoot, 'sessions')
let modelRuntime: ModelRuntime | undefined
let applicationRuntime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
const runs: Dict[] = []
let terminalFailure: string | undefined
try {
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(workspaceRoot, { recursive: true }), mkdir(agentDir, { recursive: true }), mkdir(sessions, { recursive: true })])
  await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-exec-003-a-004-real-http', now: new Date().toISOString() })
  modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `exec003-a004-http-${Date.now()}`, models: [{ id: 'deterministic-test-host' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const reasoningExecutor = new DeterministicFallbackExecutor()
  applicationRuntime = await createResearchHubApplicationRuntime({ cwd, agentDir, sessionDir: sessions, workspaceRoot, mountedKnowledgeBaseRoot: kbRoot, modelRuntime, model: faux.getModel(), reasoningExecutor, startDailyScheduler: false })
  server = new ResearchHubRuntimeServer({ runtime: applicationRuntime, clientRoot: resolve('client/dist'), port: 0 })
  const info = await server.start()
  const knowledgeBefore = await snapshotTree(kbRoot)
  for (const target of runTargets) {
    const targetRuns: Dict[] = []
    const cases: readonly { readonly operation: Operation; readonly args: Dict; readonly label: string }[] = [
      { operation: 'company' as const, args: { symbol: target.symbol, name: target.name, exchange: target.exchange, maxSources: sourceLimit }, label: 'Company Research' },
      { operation: 'valuation' as const, args: { symbol: target.symbol, name: target.name, exchange: target.exchange, methods: ['PE', 'PB'], targetFiscalYear: 2025 }, label: 'Valuation' },
      ...target.fiscalRuns.map((fiscal) => ({ operation: 'earnings' as const, args: { symbol: target.symbol, name: target.name, exchange: target.exchange, fiscalYear: fiscal.fiscalYear, period: fiscal.period }, label: `Earnings Review ${fiscal.period} ${fiscal.fiscalYear}` })),
    ].filter((item) => selectedOperation === undefined || item.operation === selectedOperation)
    for (const item of cases) {
      const before = await snapshotTree(kbRoot)
      const started = await requestJson(info.origin, info.runtimeToken, operationPath[item.operation], { method: 'POST', body: JSON.stringify(item.args) })
      if (started.status !== 202 || typeof started.body.runId !== 'string') throw new Error(`${target.symbol} ${item.label} start failed: HTTP ${started.status} ${String(started.body.error ?? '')}`)
      const runId = started.body.runId
      const workflow = await pollTerminal(info.origin, info.runtimeToken, runId)
      const bundleResponse = await requestJson(info.origin, info.runtimeToken, `/api/research/bundles/by-run/${encodeURIComponent(runId)}`)
      const bundle = bundleResponse.body as unknown as ResearchBundle
      if (bundleResponse.status !== 200 || bundle.workflowRunId !== runId || bundle.executionResult?.runId !== runId || bundle.executionResult?.terminalStatus !== workflow.status) throw new Error(`${target.symbol} ${item.label} Bundle/run reconciliation failed: HTTP ${bundleResponse.status}`)
      const reportId = workflow.executionResult?.reportRef
      let report: ResearchReport | undefined
      let canonicalRefsResolve = false
      let externalEvidenceLinkCount = 0
      if (reportId) {
        const reportResponse = await requestJson(info.origin, info.runtimeToken, `/api/research-reports/${encodeURIComponent(reportId)}`)
        if (reportResponse.status !== 200) throw new Error(`${target.symbol} ${item.label} report reload failed: HTTP ${reportResponse.status}`)
        report = reportResponse.body as unknown as ResearchReport
        if (report.workflowRunId !== runId) throw new Error(`${target.symbol} ${item.label} report belongs to a different Workflow run`)
        if (reportSnapshotPath !== undefined && selectedOperation === 'company' && item.operation === 'company') {
          await mkdir(dirname(reportSnapshotPath), { recursive: true })
          await writeFile(reportSnapshotPath, `${JSON.stringify({ taskId: 'RHL-EXEC-003-A-004', runId, report }, null, 2)}\n`, 'utf8')
        }
        const canonical = await readCanonicalV04Assets(kbRoot)
        const registry = new Set(canonical.registry.map((entry) => entry.id))
        canonicalRefsResolve = reportRefIds(report).every((ref) => registry.has(ref))
        if (!canonicalRefsResolve) throw new Error(`${target.symbol} ${item.label} report contains an unregistered canonical reference`)
        externalEvidenceLinkCount = report.sections.flatMap((section) => section.evidenceLinks ?? []).filter((url) => /^https:\/\//i.test(url)).length
      }
      const after = await snapshotTree(kbRoot)
      const unchanged = JSON.stringify(before) === JSON.stringify(after)
      if (!unchanged) throw new Error(`${target.symbol} ${item.label} read-only Workflow changed the Knowledge file tree`)
      const structured = isRecord(bundle.structuredResult) ? bundle.structuredResult : {}
      const providers = providerSummary(structured)
      const runStatus = workflow.status
      const run = {
        target: { symbol: target.symbol, exchange: target.exchange, verifiedName: (isRecord(started.body.verifiedSecurityIdentity) ? started.body.verifiedSecurityIdentity.verifiedName : report?.verifiedSecurityIdentity?.verifiedName) ?? null, verificationSource: (isRecord(started.body.verifiedSecurityIdentity) ? started.body.verifiedSecurityIdentity.verificationSource : report?.verifiedSecurityIdentity?.verificationSource) ?? null, originAuthority: isRecord(started.body.verifiedSecurityIdentity) ? started.body.verifiedSecurityIdentity.originAuthority ?? null : report?.verifiedSecurityIdentity?.originAuthority ?? null, verifiedAt: isRecord(started.body.verifiedSecurityIdentity) ? started.body.verifiedSecurityIdentity.verifiedAt ?? null : report?.verifiedSecurityIdentity?.verifiedAt ?? null, sourceId: isRecord(started.body.verifiedSecurityIdentity) ? started.body.verifiedSecurityIdentity.sourceId ?? null : report?.verifiedSecurityIdentity?.sourceId ?? null, sourceUrl: isRecord(started.body.verifiedSecurityIdentity) ? safeEvidenceUrl(started.body.verifiedSecurityIdentity.sourceUrl) ?? null : safeEvidenceUrl(report?.verifiedSecurityIdentity?.sourceUrl) ?? null },
        operation: item.operation, label: item.label, request: item.args, runId, httpStartStatus: started.status,
        lifecycle: { status: workflow.status, executionStatus: workflow.executionResult?.executionStatus ?? null, terminalStatus: workflow.executionResult?.terminalStatus ?? null, bundleStatus: workflow.executionResult?.bundleStatus ?? null, reportRef: reportId ?? null, bundleRef: workflow.executionResult?.bundleRef ?? null, diagnostics: workflow.executionResult?.diagnostics ?? [] },
        providerOutcomes: providers,
        providerClassification: runStatus === 'completed' ? providers.some((item) => item.succeeded === true) || itemIdentityWasVerified(started.body) ? 'REAL_PROVIDER_COMPLETED' : 'REAL_PROVIDER_PARTIAL' : runStatus === 'blocked' ? 'REAL_PROVIDER_BLOCKED' : `REAL_PROVIDER_${runStatus.toUpperCase()}`,
        report: report ? { reportId: report.reportId, reportType: report.reportType, workflowRunId: report.workflowRunId, asOf: report.asOf, sections: report.sections.map((section) => ({ title: section.title, substantive: !section.markdown.startsWith('Research gap:'), sourceRefs: [...(section.sourceRefs ?? []), ...(section.claimRefs ?? [])], evidenceLinks: (section.evidenceLinks ?? []).map(safeEvidenceUrl).filter((url): url is string => url !== undefined) })), evidenceLinkCount: externalEvidenceLinkCount, canonicalRefCount: reportRefIds(report).length, canonicalRefsResolve, reportReloaded: true } : null,
        domainOutcome: { blockedReason: typeof structured.blockedReason === 'string' ? structured.blockedReason : null, errorSummary: typeof structured.errorSummary === 'string' ? safeDiagnostic(structured.errorSummary) : null, diagnostics: Array.isArray(structured.diagnostics) ? structured.diagnostics.slice(0, 12).map(safeDiagnostic) : [], acquisitionDiagnostics: Array.isArray(structured.acquisitionDiagnostics) ? structured.acquisitionDiagnostics.slice(0, 12).map((item) => isRecord(item) ? { provider: item.provider ?? null, status: item.status ?? null, reason: safeDiagnostic(item.reason ?? '') } : safeDiagnostic(item)) : [] },
        bundle: { bundleId: bundle.bundleId, workflowRunId: bundle.workflowRunId, reportId: bundle.report?.reportId ?? null, status: bundle.status, reloaded: true, terminalStatus: bundle.executionResult?.terminalStatus ?? null },
        readOnlyKnowledge: { unchanged, beforePathCount: before.length, afterPathCount: after.length, beforeDigest: createHash('sha256').update(JSON.stringify(before)).digest('hex'), afterDigest: createHash('sha256').update(JSON.stringify(after)).digest('hex') },
      }
      runs.push(run)
      targetRuns.push(run)
      console.log(JSON.stringify({ event: 'RUN_FINISHED', symbol: target.symbol, workflow: item.label, status: workflow.status, report: report?.reportId ?? null, bundle: bundle.bundleId }))
    }
    if (targetRuns.length !== cases.length || targetRuns.some((run) => (run.target as Dict).verifiedName !== target.name)) throw new Error(`${target.symbol} did not preserve verified identity across all selected product runs`)
  }
  const finalTree = await snapshotTree(kbRoot)
  const completeTriplet = runTargets.some((target) => {
    const matching = runs.filter((run) => (run.target as Dict).symbol === target.symbol)
    return ['company', 'valuation'].every((operation) => matching.some((run) => run.operation === operation && (run.lifecycle as Dict).status === 'completed' && run.report !== null)) && matching.some((run) => run.operation === 'earnings' && (run.lifecycle as Dict).status === 'completed' && run.report !== null)
  })
  const expectedRunCount = runTargets.length * (selectedOperation === 'earnings' ? 2 : selectedOperation === undefined ? 4 : 1)
  const evidence = { taskId: 'RHL-EXEC-003-A-004', generatedAt: new Date().toISOString(), execution: 'ResearchRunPage HTTP API -> ResearchDispatchService explicit Workflow -> verified identity -> ResearchService -> Workflow -> real AKShare/CNINFO/GDELT providers -> DataResolver -> Skill -> ResearchReport/ResearchBundle', providerMode: 'real provider / deterministic semantic fallback; Pi ModelRuntime tested separately', knowledgeBaseSchema: '0.4', targets: runTargets, requestedOperation: selectedOperation ?? 'all', expectedRunCount, runs, allRunsSynchronized: runs.length === expectedRunCount && runs.every((run) => (run.lifecycle as Dict).bundleStatus === 'available'), allReportsAndBundlesReconciled: reportsAndBundlesReconciled(runs, expectedRunCount), atLeastOneCompletedCompanyValuationEarningsTriplet: completeTriplet, allReadOnlyTreesUnchanged: runs.length === expectedRunCount && runs.every((run) => (run.readOnlyKnowledge as Dict).unchanged === true), finalKnowledgeTreeUnchanged: JSON.stringify(knowledgeBefore) === JSON.stringify(finalTree), finalKnowledgeDigest: createHash('sha256').update(JSON.stringify(finalTree)).digest('hex'), secretsIncluded: false, rawProviderBodiesIncluded: false, hiddenReasoningIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ evidencePath, runCount: runs.length, allReportsAndBundlesReconciled: evidence.allReportsAndBundlesReconciled, allReadOnlyTreesUnchanged: evidence.allReadOnlyTreesUnchanged }, null, 2))
} catch (error) {
  terminalFailure = shortError(error)
  const evidence = { taskId: 'RHL-EXEC-003-A-004', generatedAt: new Date().toISOString(), classification: 'REAL_HTTP_E2E_INCOMPLETE', completedRunCount: runs.length, runs, error: terminalFailure, secretsIncluded: false, rawProviderBodiesIncluded: false, hiddenReasoningIncluded: false }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify({ evidencePath, completedRunCount: runs.length, error: terminalFailure }, null, 2))
  process.exitCode = 1
} finally {
  await server?.close().catch(() => undefined)
  await applicationRuntime?.close().catch(() => undefined)
  await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> } | undefined)?.dispose?.()).catch(() => undefined)
  if (!terminalFailure) await rm(tempRoot, { recursive: true, force: true })
}
