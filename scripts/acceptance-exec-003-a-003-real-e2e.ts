import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createResearchHubApplicationRuntime } from '../app/runtime/application-runtime.ts'
import { createFreshKnowledgeBaseV04 } from '../knowledge/storage/create-v04.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { readResearchReport } from '../app/services/research-report.ts'
import type { ResearchBundle } from '../app/services/research-bundle.ts'

type RecordValue = Record<string, unknown>
type PeriodRun = { readonly symbol: string; readonly name: string; readonly exchange: 'SH' | 'SZ'; readonly fiscalYear: number; readonly period: 'FY' | 'H1' }
const runs: readonly PeriodRun[] = [
  { symbol: '002487', name: '大金重工', exchange: 'SZ', fiscalYear: 2025, period: 'FY' },
  { symbol: '002487', name: '大金重工', exchange: 'SZ', fiscalYear: 2026, period: 'H1' },
  { symbol: '600519', name: '贵州茅台', exchange: 'SH', fiscalYear: 2025, period: 'FY' },
  { symbol: '600519', name: '贵州茅台', exchange: 'SH', fiscalYear: 2026, period: 'H1' },
]
const selectedRunIndexText = process.env.RHL_EXEC003_A003_RUN_INDEX
const activeRuns = selectedRunIndexText === undefined ? runs : (() => {
  const index = Number(selectedRunIndexText)
  if (!Number.isInteger(index) || index < 0 || index >= runs.length) throw new TypeError('RHL_EXEC003_A003_RUN_INDEX must be 0-3')
  return [runs[index]!]
})()
const now = () => new Date().toISOString()
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {} }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function resultSummary(value: unknown): RecordValue {
  const result = record(value); const telemetry = record(result.telemetry)
  return {
    status: result.status ?? 'missing', blockedReason: result.blockedReason ?? null,
    errors: Array.isArray(result.errors) ? result.errors : typeof result.errorSummary === 'string' ? [result.errorSummary] : [],
    providerOutcomes: Array.isArray(result.providerOutcomes) ? result.providerOutcomes : [],
    diagnostics: Array.isArray(result.acquisitionDiagnostics) ? result.acquisitionDiagnostics : [],
    selectionDiagnostics: Array.isArray(result.selectionDiagnostics) ? result.selectionDiagnostics : [],
    telemetry: {
      officialEvidenceStatus: telemetry.officialEvidenceStatus,
      structuredFinancialEvidenceStatus: telemetry.structuredFinancialEvidenceStatus,
      expectationAcquisitionStatus: telemetry.expectationAcquisitionStatus,
      expectationEstimateCount: telemetry.expectationEstimateCount,
      expectationInstitutionCount: telemetry.expectationInstitutionCount,
      expectationConsensusSnapshotCount: telemetry.expectationConsensusSnapshotCount,
      actualConsensusComparisonCount: telemetry.actualConsensusComparisonCount,
      estimateRevisionCount: telemetry.estimateRevisionCount,
      reasoning: telemetry.reasoning,
    },
    expectationAnalysis: result.expectationAnalysis ?? null,
    financialQuality: result.financialQuality ?? null,
    report: result.report ?? (typeof result.reportId === 'string' ? { reportId: result.reportId } : null),
    reportPath: result.reportPath ?? null,
  }
}

const root = await mkdtemp(join(tmpdir(), 'rhl-exec-003-a-003-live-'))
const kbRoot = join(root, 'knowledge')
const cwd = join(root, 'runtime')
const outcomes: RecordValue[] = []
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
try {
  await mkdir(cwd, { recursive: true })
  await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-exec-003-a-003-live', now: now() })
  const before = await readCanonicalV04Assets(kbRoot)
  const beforeDigest = digest(before.objects.map((item) => item.value))
  runtime = await createResearchHubApplicationRuntime({ cwd, workspaceRoot: join(root, 'workspace'), mountedKnowledgeBaseRoot: kbRoot, startDailyScheduler: false })
  const dispatch = runtime.services.researchDispatchService
  if (!dispatch) throw new Error('APPLICATION_RESEARCH_DISPATCH_UNAVAILABLE')

  for (const target of activeRuns) {
    const workflowRunId = `a003-live-${target.symbol}-${target.fiscalYear}-${target.period.toLowerCase()}`
    console.log(JSON.stringify({ event: 'RUN_START', target, at: now() }))
    const workflowArguments = { symbol: target.symbol, name: target.name, exchange: target.exchange, fiscalYear: target.fiscalYear, period: target.period }
    const started = await dispatch.startAsync({
      query: `Review ${target.name} (${target.symbol}.${target.exchange}) ${target.fiscalYear} ${target.period} earnings using official filings, actual financial data, and matching institution forecasts.`,
      mode: { type: 'workflow', workflowId: 'earnings_review' },
      workflowArgumentContext: { workflowId: 'earnings_review', arguments: workflowArguments },
      contextPolicy: { structuredKnowledge: false, sourceLibrary: false },
      persistencePolicy: { writeKnowledge: false },
    })
    let execution: unknown = null
    if (started.status === 'started' && started.completion) execution = await started.completion
    const bundle = started.runId ? await dispatch.getBundleForRun(started.runId) : undefined
    const bundleRecord = record(bundle) as ResearchBundle
    const summary = resultSummary(execution)
    let reportReloaded = false
    let reportTitleCount = 0
    const reportRef = record(summary.report)
    const reportId = typeof reportRef.reportId === 'string' ? reportRef.reportId : typeof bundleRecord?.report?.reportId === 'string' ? bundleRecord.report.reportId : undefined
    let reportEvidence: RecordValue | null = null
    if (reportId) {
      try {
        const report = await readResearchReport(join(cwd, 'runtime-data', 'reports', `${reportId}.md.json`))
        reportReloaded = report.reportId === reportId
        reportTitleCount = report.sections.length
        const evidenceTitles = new Set(['Earnings Snapshot', 'Revenue / Profit Growth', 'Margin Analysis', 'Cash Flow / Working Capital', 'Valuation Implications', 'Research Gaps / Monitoring'])
        const selectedSections = report.sections.filter((section) => evidenceTitles.has(section.title)).map((section) => ({
          title: section.title,
          markdown: section.markdown.slice(0, 2_500),
          evidenceLinks: [...new Set(section.evidenceLinks ?? [])].slice(0, 12),
        }))
        reportEvidence = {
          reportId: report.reportId,
          generatedAt: report.generatedAt,
          asOf: report.asOf,
          verifiedSecurityIdentity: report.verifiedSecurityIdentity ?? null,
          sourceRefCount: report.sourceRefs.length,
          claimRefCount: report.claimRefs.length,
          selectedSections,
        }
      } catch { /* summarized as unreadable below */ }
    }
    outcomes.push({
      target, dispatchStatus: started.status, runId: started.runId ?? null,
      dispatchResolution: started.resolution ?? null,
      dispatchFeedback: started.feedback ?? null,
      execution: summary,
      bundle: bundle ? { bundleId: bundle.bundleId, workflowRunId: bundle.workflowRunId, status: bundle.status, report: bundle.report ?? null, reloadedFromStore: true } : null,
      reportReloaded, reportSectionCount: reportTitleCount, reportEvidence,
    })
    console.log(JSON.stringify({ event: 'RUN_END', target, runId: started.runId ?? null, dispatchStatus: started.status, workflowStatus: record(execution).status ?? null, reportReloaded, reportSectionCount: reportTitleCount, at: now() }))
  }
  const after = await readCanonicalV04Assets(kbRoot)
  const afterDigest = digest(after.objects.map((item) => item.value))
  const bundleList = await dispatch.listBundles(20)
  const actualVsConsensusRealStatus = outcomes.some((item) => Number(record(record(item.execution).telemetry).actualConsensusComparisonCount) > 0)
    ? 'ACTUAL_VS_CONSENSUS_REAL_VERIFIED'
    : 'ACTUAL_VS_CONSENSUS_REAL_DATA_GAP'
  const artifact = {
    task: 'RHL-EXEC-003-A-003', capturedAt: now(), liveRun: true,
    productionPath: 'ApplicationRuntime -> ResearchDispatchService.startAsync -> ResearchService -> EarningsReview DataResolver -> catalog/source policy -> acquisition plugins -> EarningsReview Skill',
    actualVsConsensusRealStatus,
    isolatedKnowledgeBase: { schemaVersion: '0.4', beforeObjectCount: before.objects.length, afterObjectCount: after.objects.length, beforeDigest, afterDigest, unchanged: beforeDigest === afterDigest },
    dispatchBundleCount: bundleList.filter((bundle) => outcomes.some((outcome) => outcome.runId === bundle.workflowRunId)).length,
    runs: outcomes,
    resultDigest: digest(outcomes),
  }
  const evidencePath = resolve(process.env.RHL_EXEC003_A003_EVIDENCE_PATH ?? 'tests/validation/evidence/RHL-EXEC-003-A-003-real-e2e.json')
  await mkdir(join(process.cwd(), 'tests/validation/evidence'), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: outcomes.every((item) => record(item.execution).status === 'completed') ? 'COMPLETED' : 'COMPLETED_WITH_GAPS', evidencePath, runCount: outcomes.length, isolatedKnowledgeBaseUnchanged: beforeDigest === afterDigest, bundleCount: artifact.dispatchBundleCount, runs: outcomes.map((item) => ({ target: item.target, dispatchStatus: item.dispatchStatus, workflowStatus: record(item.execution).status, officialEvidenceStatus: record(record(item.execution).telemetry).officialEvidenceStatus, actualStatus: record(record(item.execution).telemetry).structuredFinancialEvidenceStatus, expectations: record(item.execution).telemetry, reportReloaded: item.reportReloaded, reportSectionCount: item.reportSectionCount })) }, null, 2))
} finally {
  if (runtime) await runtime.close()
  if (process.env.RHL_EXEC003_A003_KEEP_TEMP === '1') console.log(JSON.stringify({ retainedRuntimeRoot: root }))
  else await rm(root, { recursive: true, force: true })
}
