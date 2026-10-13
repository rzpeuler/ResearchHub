import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PiReasoningExecutor, type PiCompletionOptions } from '../../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel } from '../../app/pi/model-selection.ts'
import { ResearchHubApplicationRuntime } from '../../app/runtime/application-runtime.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const evidencePath = resolve(process.env.RHL_EXEC003_A003_FIX001_EVIDENCE_PATH ?? join(repoRoot, 'tests/validation/evidence/RHL-EXEC-003-A-003-FIX-001-real-e2e.json'))
const targets = [
  { symbol: '002487', name: '大金重工', exchange: 'SZ', fiscalYear: 2025, period: 'FY' },
  { symbol: '002487', name: '大金重工', exchange: 'SZ', fiscalYear: 2026, period: 'H1' },
  { symbol: '600519', name: '贵州茅台', exchange: 'SH', fiscalYear: 2025, period: 'FY' },
  { symbol: '600519', name: '贵州茅台', exchange: 'SH', fiscalYear: 2026, period: 'H1' },
] as const
const requestedTargets = (process.env.RHL_EXEC003_A003_FIX001_TARGETS ?? process.env.RHL_EXEC003_A003_FIX001_TARGET)?.split(',').map((value) => value.trim()).filter(Boolean)
const selectedTargets = requestedTargets
  ? targets.filter((target) => requestedTargets.includes(`${target.symbol}-${target.period}`))
  : targets
const reasoningMode = process.env.RHL_EXEC003_A003_FIX001_REASONING_MODE === 'deterministic-fallback' ? 'deterministic-fallback' : 'live-pi'
const forceManagementFallback = process.env.RHL_EXEC003_A003_FIX001_MANAGEMENT_FALLBACK === '1'

function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
async function snapshotFiles(root: string): Promise<readonly { path: string; sha256: string | null }[]> {
  const files: { path: string; sha256: string | null }[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { files.push({ path: `${path.slice(root.length + 1).replaceAll('\\', '/')}/`, sha256: null }); await visit(path) }
      else if (entry.isFile()) files.push({ path: path.slice(root.length + 1).replaceAll('\\', '/'), sha256: digest(await readFile(path)) })
    }
  }
  await visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
function redactError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/[A-Za-z]:\\[^\s)]+/g, '[local-path]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300)
}

const generatedAt = new Date().toISOString()
const tempRoot = await mkdtemp(join(tmpdir(), 'rhl-exec003-a003-fix001-e2e-'))
const kbRoot = join(tempRoot, 'knowledge')
const workspaceRoot = join(tempRoot, 'workspace')
await mkdir(workspaceRoot, { recursive: true })
let modelRuntime: ModelRuntime | undefined
let application: ResearchHubApplicationRuntime | undefined
const runs: Record<string, unknown>[] = []
const reasoningCalls: Record<string, unknown>[] = []
let fatalError: string | undefined
let currentStage = 'initializing'
const stageLog = (stage: string): void => { currentStage = stage; console.log(`[e2e ${new Date().toISOString()}] ${stage}`) }
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs) })])
  } finally { if (timer) clearTimeout(timer) }
}
async function reloadPersistedReportForRun(runId: string) {
  if (!application?.services.researchService) return undefined
  const reportRoot = join(tempRoot, 'runtime-data', 'reports')
  for (const file of await readdir(reportRoot).catch(() => [] as string[])) {
    if (!file.endsWith('.md.json')) continue
    try {
      const stored = JSON.parse(await readFile(join(reportRoot, file), 'utf8')) as { reportId?: unknown; workflowRunId?: unknown }
      if (stored.workflowRunId !== runId || typeof stored.reportId !== 'string') continue
      const report = await application.services.researchService.getResearchReport(stored.reportId)
      if (report === undefined) continue
      const markdown = await readFile(join(reportRoot, `${stored.reportId}.md`), 'utf8').catch(() => '')
      return { report, markdownReloaded: markdown.includes(stored.reportId) && markdown.length > 0 }
    } catch { /* continue to the next persisted report */ }
  }
  return undefined
}
try {
  stageLog('creating isolated Schema 0.4 Knowledge Base')
  await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-exec003-a003-fix001-live', now: generatedAt })
  const beforeFiles = await snapshotFiles(kbRoot)
  const beforeAssets = await readCanonicalV04Assets(kbRoot)
  const beforeManifest = await loadKnowledgeBaseManifest(kbRoot)
  stageLog('initializing Pi ModelRuntime')
  modelRuntime = await ModelRuntime.create({ authPath: join(getAgentDir(), 'auth.json'), modelsPath: join(getAgentDir(), 'models.json'), allowModelNetwork: true, refreshOnCreate: false })
  const model = reasoningMode === 'live-pi' ? selectProductionReasoningModel(modelRuntime) as Model<Api> : undefined
  const completion = async (selectedModel: Model<Api> | undefined, context: Parameters<ModelRuntime['complete']>[1], options: PiCompletionOptions) => {
    const operation = typeof options.metadata.operation === 'string' ? options.metadata.operation : 'unknown'
    const startedAt = new Date().toISOString()
    const startedMs = Date.now()
    const call = { operation, operationId: options.operationId, startedAt }
    reasoningCalls.push(call)
    stageLog(`Pi completion started operation=${operation} operationId=${options.operationId}`)
    try {
      if (reasoningMode === 'deterministic-fallback') {
        Object.assign(call, { completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, callerSignalAborted: false, status: 'deterministic_invalid_output' })
        stageLog(`Deterministic fallback selected operation=${operation} operationId=${options.operationId}`)
        return '{}'
      }
      if (forceManagementFallback && operation === 'management_communication_extract') {
        Object.assign(call, { completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, callerSignalAborted: false, status: 'harness_forced_invalid_output_fallback' })
        stageLog(`Optional management extraction routed to deterministic fallback by E2E harness operationId=${options.operationId}`)
        return '{}'
      }
      if (selectedModel === undefined) throw new Error('Pi selected model is unavailable')
      const response = await modelRuntime!.complete(selectedModel, context, { signal: options.signal, maxTokens: options.maxTokens })
      const durationMs = Date.now() - startedMs
      Object.assign(call, { completedAt: new Date().toISOString(), durationMs, callerSignalAborted: options.signal.aborted, status: options.signal.aborted ? 'returned_after_executor_abort' : 'completed' })
      stageLog(`Pi completion completed operation=${operation} operationId=${options.operationId} durationMs=${Date.now() - startedMs}`)
      return response
    } catch (error) {
      Object.assign(call, { completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, callerSignalAborted: options.signal.aborted, status: 'failed', errorType: error instanceof Error ? error.name : 'UnknownError' })
      stageLog(`Pi completion failed operation=${operation} operationId=${options.operationId} durationMs=${Date.now() - startedMs} errorType=${error instanceof Error ? error.name : 'UnknownError'}`)
      throw error
    }
  }
  const reasoningExecutor = new PiReasoningExecutor({ ...(reasoningMode === 'live-pi' ? { modelRuntime, model } : {}), completion, timeoutMs: 900_000, maxOutputChars: 400_000 })
  stageLog(`reasoning mode=${reasoningMode}`)
  stageLog('creating ApplicationRuntime and production services')
  application = await ResearchHubApplicationRuntime.create({ cwd: tempRoot, agentDir: getAgentDir(), workspaceRoot, mountedKnowledgeBaseRoot: kbRoot, modelRuntime, reasoningExecutor, startDailyScheduler: false })
  const dispatch = application.services.researchDispatchService
  const research = application.services.researchService
  if (!dispatch || !research) throw new Error('Application Runtime did not assemble ResearchDispatchService and ResearchService')
  for (const target of selectedTargets) {
    stageLog(`starting production dispatch for ${target.symbol}.${target.exchange} ${target.period} ${target.fiscalYear}`)
    const args = { symbol: target.symbol, name: target.name, exchange: target.exchange, fiscalYear: target.fiscalYear, period: target.period }
    const runAbort = new AbortController()
    let start: Awaited<ReturnType<typeof dispatch.startAsync>>
    try {
      start = await withTimeout(dispatch.startAsync({
        query: `Review ${target.name} (${target.symbol}.${target.exchange}) earnings for ${target.period === 'FY' ? 'FY' : 'H1'} ${target.fiscalYear}`,
        mode: { type: 'workflow', workflowId: 'earnings_review' },
        workflowArgumentContext: { workflowId: 'earnings_review', arguments: args },
        contextPolicy: { structuredKnowledge: false, sourceLibrary: false },
        persistencePolicy: { writeKnowledge: false },
      }, runAbort.signal), 180_000, `ResearchDispatchService.startAsync for ${target.symbol}.${target.exchange} ${target.period} ${target.fiscalYear}`)
    } catch (error) {
      runAbort.abort()
      runs.push({ target, dispatchStatus: 'timeout_or_error', completed: false, failedStage: currentStage, error: redactError(error) })
      continue
    }
    if (start.status !== 'started' || !start.runId || !start.completion) {
      runs.push({ target, dispatchStatus: start.status, dispatchResolution: start.resolution ?? null, feedback: start.feedback?.reason ?? null, completed: false })
      continue
    }
    let value: Record<string, any>
    try {
      stageLog(`awaiting ResearchService completion for run ${start.runId}`)
      value = await withTimeout(start.completion as Promise<Record<string, any>>, 5_400_000, `ResearchService completion for ${start.runId}`)
      stageLog(`ResearchService completed run ${start.runId} with status ${String(value.status)}`)
    }
    catch (error) {
      runAbort.abort()
      await Promise.race([start.completion.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 30_000))])
      const persisted = await reloadPersistedReportForRun(start.runId).catch(() => undefined)
      const bundle = await withTimeout(dispatch.getBundleForRun(start.runId), 30_000, `Bundle reload after timeout for ${start.runId}`).catch(() => undefined)
      const afterAssets = await readCanonicalV04Assets(kbRoot)
      const afterFiles = await snapshotFiles(kbRoot)
      const registryIds = new Set(afterAssets.registry.map((entry) => entry.id))
      const report = persisted?.report
      const reportReferenceIds = report === undefined ? [] : [
        ...(report.sourceRefs ?? []), ...(report.claimRefs ?? []), ...(report.subjectRefs ?? []),
        ...report.sections.flatMap((section) => [...(section.sourceRefs ?? []), ...(section.claimRefs ?? [])]),
      ].filter((ref): ref is string => typeof ref === 'string')
      const unresolvedReportRefs = reportReferenceIds.filter((ref) => !registryIds.has(ref))
      runs.push({
        target, runId: start.runId, dispatchResolution: start.resolution ?? null, completed: false,
        failedStage: currentStage, error: redactError(error), cancellationRequested: true,
        reportId: report?.reportId ?? null, reportReloaded: report !== undefined,
        reportMarkdownReloaded: persisted?.markdownReloaded ?? false, reportWorkflowRunId: report?.workflowRunId ?? null,
        reportSectionCount: report?.sections.length ?? 0, reportSourceRefs: report?.sourceRefs ?? [],
        reportClaimRefs: report?.claimRefs ?? [], reportSubjectRefs: report?.subjectRefs ?? [],
        reportSectionReferenceCount: reportReferenceIds.length, reportUnresolvedCanonicalRefs: unresolvedReportRefs,
        reportCanonicalRefsResolveInRegistry: report !== undefined && unresolvedReportRefs.length === 0,
        reportEvidenceLinks: report?.sections.flatMap((section) => section.evidenceLinks).filter((url): url is string => typeof url === 'string' && /^https:\/\//.test(url)) ?? [],
        bundleId: bundle?.bundleId ?? null, bundleReloaded: bundle !== undefined,
        bundleWorkflowRunId: bundle?.workflowRunId ?? null, bundleStatus: bundle?.status ?? null,
        canonicalObjectCountAfter: afterAssets.objects.length,
        knowledgeTreeUnchanged: JSON.stringify(afterFiles) === JSON.stringify(beforeFiles),
        knowledgeRevisionBefore: beforeManifest.revision,
        knowledgeRevisionAfter: (await loadKnowledgeBaseManifest(kbRoot)).revision,
        rawRegistryPresentBefore: beforeFiles.some((item) => item.path === 'registry/raw.yaml'),
        rawRegistryPresentAfter: afterFiles.some((item) => item.path === 'registry/raw.yaml'),
      })
      continue
    }
    const reportId = typeof value.reportId === 'string' ? value.reportId : typeof value.report?.reportId === 'string' ? value.report.reportId : undefined
    const report = reportId ? await research.getResearchReport(reportId) : undefined
    const reportRoot = join(tempRoot, 'runtime-data', 'reports')
    const reportMarkdown = reportId === undefined ? '' : await readFile(join(reportRoot, `${reportId}.md`), 'utf8').catch(() => '')
    const reportMarkdownReloaded = report !== undefined && reportMarkdown.includes(report.reportId) && reportMarkdown.length > 0
    const bundle = await dispatch.getBundleForRun(start.runId)
    const actual = report?.sections.find((section) => section.title === 'Earnings Snapshot')
    const metrics = [...(report?.sections ?? [])].flatMap((section) => [...section.markdown.matchAll(/^\s*-\s*(revenue|net_profit|gross_margin|eps|revenue_yoy|net_profit_yoy|gross_margin_yoy):\s*([-+]?\d+(?:\.\d+)?)/gim)].map((match) => ({ metric: match[1], value: Number(match[2]) })))
    const afterAssets = await readCanonicalV04Assets(kbRoot)
    const afterFiles = await snapshotFiles(kbRoot)
    const registryIds = new Set(afterAssets.registry.map((entry) => entry.id))
    const reportReferenceGroups = report === undefined ? [] : [
      ...(report.sourceRefs ?? []), ...(report.claimRefs ?? []), ...(report.subjectRefs ?? []),
      ...report.sections.flatMap((section) => [...(section.sourceRefs ?? []), ...(section.claimRefs ?? [])]),
    ]
    const reportReferenceIds = reportReferenceGroups.filter((ref): ref is string => typeof ref === 'string')
    const unresolvedReportRefs = reportReferenceIds.filter((ref) => !registryIds.has(ref))
    const reasoning = value.telemetry?.reasoning ?? {}
    const providers = (value.providerOutcomes ?? []).map((item: Record<string, unknown>) => ({ provider: item.provider, providerAttempted: item.providerAttempted, providerSucceeded: item.providerSucceeded, providerEmpty: item.providerEmpty, providerFailed: item.providerFailed, usableSourceCount: item.usableSourceCount }))
    runs.push({
      target, runId: start.runId, dispatchStatus: start.status, dispatchResolution: start.resolution ?? null,
      workflowStatus: value.status, blockedReason: value.blockedReason ?? null, completed: value.status === 'completed', errors: value.errors ?? [],
      acquisitionDiagnostics: (value.acquisitionDiagnostics ?? []).map((item: Record<string, unknown>) => ({ provider: item.provider, status: item.status, reason: typeof item.reason === 'string' ? redactError(item.reason) : undefined })),
      selectionDiagnostics: value.selectionDiagnostics ?? [], reportId,
      reportReloaded: report !== undefined, reportMarkdownReloaded, reportSectionCount: report?.sections.length ?? 0,
      reportWorkflowRunId: report?.workflowRunId ?? null, reportSourceRefs: report?.sourceRefs ?? [], reportClaimRefs: report?.claimRefs ?? [],
      reportSubjectRefs: report?.subjectRefs ?? [], reportSectionReferenceCount: reportReferenceIds.length,
      reportUnresolvedCanonicalRefs: unresolvedReportRefs, reportCanonicalRefsResolveInRegistry: report !== undefined && unresolvedReportRefs.length === 0,
      reportEvidenceLinks: report?.sections.flatMap((section) => section.evidenceLinks).filter((url): url is string => typeof url === 'string' && /^https:\/\//.test(url)) ?? [],
      earningsSnapshotHasStructuredActual: typeof actual?.markdown === 'string' && actual.markdown.length > 0,
      metrics, reasoning: { called: reasoning.called ?? false, validated: reasoning.validated ?? false, applied: reasoning.applied ?? false, fallbackUsed: reasoning.fallbackUsed ?? false },
      providers, bundleId: bundle?.bundleId ?? null, bundleReloaded: bundle !== undefined, bundleWorkflowRunId: bundle?.workflowRunId ?? null,
      canonicalEntityCount: afterAssets.objects.filter((item) => item.kind === 'entity').length,
      canonicalSourceCount: afterAssets.objects.filter((item) => item.kind === 'source').length,
      canonicalClaimCount: afterAssets.objects.filter((item) => item.kind === 'claim').length,
      canonicalDelta: afterAssets.objects.length - beforeAssets.objects.length,
      knowledgeTreeUnchanged: JSON.stringify(afterFiles) === JSON.stringify(beforeFiles),
      knowledgeRevisionBefore: beforeManifest.revision,
      knowledgeRevisionAfter: (await loadKnowledgeBaseManifest(kbRoot)).revision,
      rawRegistryPresentBefore: beforeFiles.some((item) => item.path === 'registry/raw.yaml'),
      rawRegistryPresentAfter: afterFiles.some((item) => item.path === 'registry/raw.yaml'),
      rawRegistryExists: afterFiles.some((item) => item.path === 'registry/raw.yaml'),
    })
  }
} catch (error) { fatalError = redactError(error) }
finally {
  const cleanupIssues: string[] = []
  if (application) { stageLog('closing ApplicationRuntime'); await withTimeout(application.close(), 30_000, 'ApplicationRuntime.close').catch((error) => cleanupIssues.push(redactError(error))) }
  if (modelRuntime) { stageLog('disposing Pi ModelRuntime'); await withTimeout(Promise.resolve((modelRuntime as unknown as { dispose?: () => Promise<void> }).dispose?.()), 30_000, 'ModelRuntime.dispose').catch((error) => cleanupIssues.push(redactError(error))) }
  if (cleanupIssues.length) runs.push({ cleanupIssues })
}
const checkedRuns = runs.filter((run) => typeof run.knowledgeTreeUnchanged === 'boolean')
const reportCheckedRuns = runs.filter((run) => typeof run.reportCanonicalRefsResolveInRegistry === 'boolean')
const evidence = { taskId: 'RHL-EXEC-003-A-003-FIX-001', generatedAt, reasoningMode, managementModelMode: forceManagementFallback ? 'harness_forced_invalid_output_deterministic_fallback' : reasoningMode, productionPath: 'ApplicationRuntime -> ResearchDispatchService.startAsync -> ResearchService -> Earnings Review Workflow -> DataResolver -> Catalog/SourcePolicy -> CNINFO/AKShare Plugins -> Earnings Review Skill', isolatedKnowledgeBaseSchema: '0.4', targets: selectedTargets, reasoningCalls, runs, ...(fatalError ? { fatalError, failedStage: currentStage } : {}), completedRunCount: runs.filter((run) => run.completed === true).length, reportBundleReloadedRunCount: runs.filter((run) => run.completed === true && run.reportReloaded === true && run.reportMarkdownReloaded === true && run.bundleReloaded === true).length, allReportsAndBundlesReloaded: runs.length === selectedTargets.length && runs.every((run) => run.completed === true && run.reportReloaded === true && run.reportMarkdownReloaded === true && run.bundleReloaded === true), knowledgeCheckCount: checkedRuns.length, allKnowledgeUnchanged: checkedRuns.length === selectedTargets.length && checkedRuns.every((run) => run.knowledgeTreeUnchanged === true), reportReferenceCheckCount: reportCheckedRuns.length, allReportCanonicalRefsResolve: reportCheckedRuns.length === selectedTargets.length && reportCheckedRuns.every((run) => run.reportCanonicalRefsResolveInRegistry === true), secretsIncluded: false, rawBodiesIncluded: false }
await mkdir(resolve(repoRoot, 'tests/validation/evidence'), { recursive: true })
await (await import('node:fs/promises')).writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ evidencePath, completedRunCount: evidence.completedRunCount, reportBundleReloadedRunCount: evidence.reportBundleReloadedRunCount, allReportsAndBundlesReloaded: evidence.allReportsAndBundlesReloaded, allKnowledgeUnchanged: evidence.allKnowledgeUnchanged, fatalError: fatalError ?? null }, null, 2))
await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
if (fatalError || evidence.completedRunCount !== selectedTargets.length || !evidence.allReportsAndBundlesReloaded || !evidence.allKnowledgeUnchanged || !evidence.allReportCanonicalRefsResolve) process.exitCode = 1
