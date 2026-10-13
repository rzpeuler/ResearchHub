import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchDispatchService } from '../../../app/services/research-dispatch-service.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { createWorkflowDefinitionRegistry } from '../../../app/services/workflow-registry.ts'
import type { ReasoningRequest } from '../../../plugins/reasoning/contracts.ts'

const NOW = '2026-10-09T08:00:00.000Z'

async function makeIdentityKnowledgeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-exec-002-matrix-kb-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `exec-002-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, now: NOW })
  await writeFile(join(root, 'entities', 'fixture-company.yaml'), JSON.stringify({ id: 'entity:fixture-company', type: 'company', name: '贵州茅台', aliases: ['茅台'], ticker: '600519', exchange: 'SH', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'claims', 'fixture-claim.yaml'), JSON.stringify({ id: 'claim:fixture-claim', claimType: 'fact', statement: 'Fixture canonical claim.', subjectRefs: ['entity:fixture-company'], sourceRefs: [], lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'theses', 'fixture-thesis.yaml'), JSON.stringify({ id: 'thesis:fixture-thesis', title: 'Fixture thesis', lifecycle: { status: 'active' } }) + '\n')
  await writeFile(join(root, 'registry', 'assets.yaml'), JSON.stringify({
    'entity:fixture-company': { type: 'entity', storageRef: 'entities/fixture-company.yaml' },
    'claim:fixture-claim': { type: 'claim', storageRef: 'claims/fixture-claim.yaml' },
    'thesis:fixture-thesis': { type: 'thesis', storageRef: 'theses/fixture-thesis.yaml' },
  }) + '\n')
  return root
}

function workflowDecision(workflowId: string, args: Readonly<Record<string, unknown>>) {
  return {
    mode: 'workflow',
    workflow: { id: workflowId, confidence: 1, arguments: args },
    skills: [],
    entities: [],
    missingRequiredInputs: [],
    contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
    persistencePolicy: { writeKnowledge: false },
    rationale: `Acceptance matrix input for ${workflowId}.`,
  }
}

function semanticExecutor(workflowId: string, args: Readonly<Record<string, unknown>>) {
  const output = workflowDecision(workflowId, args)
  return {
    capabilities: () => ({ maxContextTokens: 10_000, maxOutputTokens: 2_000, structuredOutputSupport: true, maxConcurrency: 1 }),
    async execute(request: ReasoningRequest) { return { operation: request.operation, output } },
  }
}

function memoryBundleStore() {
  const values = new Map<string, any>()
  return { values, async put(bundle: any) { values.set(bundle.bundleId, bundle) }, async get(id: string) { return values.get(id) }, async list() { return [...values.values()] } }
}

type Outcome = { readonly status: 'completed' | 'blocked' | 'completed_with_review'; readonly summary?: string; readonly blockedReason?: string; readonly reportId?: string; readonly reviewCaseId?: string }
function startControlled(workflowService: WorkflowService, input: Record<string, unknown>, outcome: Outcome | Promise<Outcome>, workflowType: string) {
  const runId = input.workflowRunId as string
  workflowService.register({ runId, workflowType, objective: `${workflowType} acceptance matrix execution` })
  const completion = workflowService.start(runId, async () => await outcome as never)
  return { runId, completion }
}

const COMPANY_ARGS = { symbol: '600519', name: '贵州茅台', exchange: 'SH' }
const THESIS_REFRESH_ARGS = {
  mode: 'REFRESH',
  refresh: {
    priorSnapshot: { thesisId: 'thesis:fixture-thesis', priorAsOf: '2026-09-01T00:00:00.000Z', propositions: [{ propositionId: 'claim:fixture-claim', statement: 'Fixture claim.' }] },
    evidence: [],
  },
}

test('production Workflow binding matrix executes all nine canonical IDs through ResearchDispatchService', async (t) => {
  const knowledgeBase = await makeIdentityKnowledgeBase()
  t.after(async () => rm(knowledgeBase, { recursive: true, force: true }))

  const cases = [
    { workflowId: 'company_research', args: COMPANY_ARGS, adapter: 'startResearchCompany', adapterArgs: { ...COMPANY_ARGS }, status: 'blocked' as const, blockedReason: 'COMPANY_COVERAGE_NOT_FOUND', mismatchedReport: true },
    { workflowId: 'industry_research', args: { name: '锂电池', aliases: ['动力电池'] }, adapter: 'startIndustryResearch', adapterArgs: { name: '锂电池', aliases: ['动力电池'] }, status: 'blocked' as const, blockedReason: 'NO_CANONICAL_INDUSTRY_METRIC' },
    { workflowId: 'earnings_review', args: { ...COMPANY_ARGS, fiscalYear: 2026, period: 'H1' }, adapter: 'startEarningsReview', adapterArgs: { ...COMPANY_ARGS, fiscalYear: 2026, period: 'H1' }, status: 'cancelled' as const },
    { workflowId: 'valuation', args: { ...COMPANY_ARGS, methods: ['PE', 'PB'], targetFiscalYear: 2027 }, adapter: 'startValuation', adapterArgs: { ...COMPANY_ARGS, methods: ['PE', 'PB'], targetFiscalYear: 2027 }, status: 'blocked' as const, blockedReason: 'VALUATION_MARKET_PRICE_UNAVAILABLE' },
    { workflowId: 'event_research', args: { ...COMPANY_ARGS, anchor: { kind: 'user_event', title: 'User supplied event', description: 'User supplied event description.' } }, adapter: 'startEventResearch', adapterArgs: { ...COMPANY_ARGS, anchor: { kind: 'user_event', title: 'User supplied event', description: 'User supplied event description.' } }, status: 'failed' as const },
    { workflowId: 'thesis_red_team', args: { ...COMPANY_ARGS, thesisRef: 'claim:fixture-claim', lookbackDays: 90 }, adapter: 'startThesisRedTeam', adapterArgs: { ...COMPANY_ARGS, thesisRef: 'claim:fixture-claim', lookbackDays: 90 }, status: 'completed' as const, reviewCase: true },
    { workflowId: 'thesis_lifecycle', args: THESIS_REFRESH_ARGS, adapter: 'runThesisLifecycle', adapterArgs: THESIS_REFRESH_ARGS, status: 'completed' as const },
    { workflowId: 'daily_intelligence', args: { briefType: 'morning', tradeDate: '2026-10-09' }, adapter: 'startBrief', adapterArgs: { briefType: 'morning', tradeDate: '2026-10-09' }, status: 'completed' as const, dailyBrief: true },
    { workflowId: 'theme_framework', args: { name: 'AI 算力', definition: 'Research theme supplied by the user.' }, adapter: 'themeStart', adapterArgs: { name: 'AI 算力', definition: 'Research theme supplied by the user.' }, status: 'completed_with_review' as const },
  ]
  assert.deepEqual(cases.map(({ workflowId }) => workflowId).sort(), createWorkflowDefinitionRegistry().list().map(({ id }) => id).sort(), 'matrix covers every canonical production Workflow ID exactly once')

  for (const item of cases) {
    await t.test(item.workflowId, async () => {
      const workflowService = new WorkflowService()
      const bundleStore = memoryBundleStore()
      const calls: { adapter: string; input: Record<string, unknown>; signal?: AbortSignal }[] = []
      const artifactRunIds = new Map<string, string>()
      let releaseCancellation: (() => void) | undefined
      const cancellationGate = new Promise<Outcome>((resolve) => { releaseCancellation = () => resolve({ status: 'completed' }) })
      const adapterOutcome: Outcome | Promise<Outcome> = item.status === 'cancelled'
        ? cancellationGate
        : item.status === 'blocked' ? { status: 'blocked', summary: 'Required canonical inputs are unavailable.', blockedReason: item.blockedReason }
          : item.status === 'completed_with_review' ? { status: 'completed_with_review' }
            : { status: 'completed' }

      const researchMethod = (method: string, workflowType: string) => (input: Record<string, unknown>, signal?: AbortSignal) => {
        calls.push({ adapter: method, input, signal })
        const runId = input.workflowRunId as string
        const domainOutcome = item.status === 'failed' ? Promise.reject(new Error('controlled adapter failure'))
          : Promise.resolve(adapterOutcome).then((outcome): Outcome => item.dailyBrief ? { ...outcome, reportId: `daily-brief-${runId}` }
            : item.mismatchedReport ? { ...outcome, reportId: 'report-from-other-run' }
              : item.reviewCase ? { ...outcome, reviewCaseId: `review-${runId}` }
                : outcome)
        if (item.dailyBrief) artifactRunIds.set(`daily-brief-${runId}`, runId)
        if (item.reviewCase) artifactRunIds.set(`review-${runId}`, runId)
        const started = startControlled(workflowService, input, domainOutcome, workflowType)
        if (signal !== undefined) signal.addEventListener('abort', () => { try { workflowService.cancelWorkflow(started.runId) } catch { /* run may already be terminal */ } }, { once: true })
        return started
      }
      const researchService = {
        async getResearchReport(reportId: string) { return reportId === 'report-from-other-run' ? { reportId, workflowRunId: 'another-run' } : undefined },
        startResearchCompany: researchMethod('startResearchCompany', 'company_research'),
        startIndustryResearch: researchMethod('startIndustryResearch', 'industry_research'),
        startEarningsReview: researchMethod('startEarningsReview', 'earnings_review'),
        startValuation: researchMethod('startValuation', 'valuation'),
        startEventResearch: researchMethod('startEventResearch', 'event_research'),
        startThesisRedTeam: researchMethod('startThesisRedTeam', 'thesis_red_team'),
      }
      const dailyIntelligenceService = {
        startBrief: researchMethod('startBrief', 'daily_intelligence'),
        async getBrief(reportId: string) { const workflowRunId = artifactRunIds.get(reportId); return workflowRunId === undefined ? undefined : { reportId, workflowRunId } },
      }
      const reviewService = { async getReviewCase(reviewCaseId: string) { const producerRunId = artifactRunIds.get(reviewCaseId); return producerRunId === undefined ? undefined : { reviewCaseId, producerRunId } } }
      const themeFrameworkService = {
        start(input: Record<string, unknown>, signal?: AbortSignal) {
          calls.push({ adapter: 'themeStart', input, signal })
          const started = startControlled(workflowService, input, adapterOutcome, 'theme_framework_construction')
          if (signal !== undefined) signal.addEventListener('abort', () => { try { workflowService.cancelWorkflow(started.runId) } catch { /* run may already be terminal */ } }, { once: true })
          return started
        },
        async getReviewCandidate(runId: string) {
          return { status: 'awaiting_review', workflowRunId: runId, candidate: { theme: { name: 'AI 算力' }, framework: { industryCandidates: [], relationCandidates: [] }, diagnostics: [] } }
        },
      }

      const service = new ResearchDispatchService({
        workflowService,
        researchService: researchService as never,
        dailyIntelligenceService: dailyIntelligenceService as never,
        themeFrameworkService: themeFrameworkService as never,
        reviewService: reviewService as never,
        mountedKnowledgeBaseRoot: knowledgeBase,
        reasoningExecutor: semanticExecutor(item.workflowId, item.args),
        bundleStore: bundleStore as never,
        clock: () => new Date(NOW),
      })
      const abortController = new AbortController()
      const started = await service.startAsync({
        query: `Run ${item.workflowId} acceptance matrix`,
        mode: { type: 'workflow', workflowId: item.workflowId },
        contextPolicy: { structuredKnowledge: true, sourceLibrary: false },
        persistencePolicy: { writeKnowledge: false },
      }, abortController.signal)

      assert.equal(started.status, 'started', `status for ${item.workflowId}: ${JSON.stringify(started.feedback)}`)
      assert.ok(started.runId)
      assert.equal(started.workflow?.runId, started.runId)
      assert.equal(started.decision.workflow?.id, item.workflowId)
      const expectedValidatedArgs = item.workflowId === 'thesis_lifecycle'
        ? { ...THESIS_REFRESH_ARGS, refresh: { ...THESIS_REFRESH_ARGS.refresh, currentAsOf: NOW } }
        : item.args
      assert.deepEqual(started.decision.workflow?.arguments, expectedValidatedArgs, `validated arguments for ${item.workflowId}`)
      const runId = started.runId!
      if (item.workflowId !== 'thesis_lifecycle') assert.equal(workflowService.getWorkflowStatus(runId)?.status, 'running')

      if (item.status === 'cancelled') {
        abortController.abort()
        releaseCancellation?.()
      }

      if (item.status === 'failed') await assert.rejects(started.completion!, /controlled adapter failure/)
      else await started.completion

      assert.equal(calls.length, item.workflowId === 'thesis_lifecycle' ? 0 : 1, `adapter invocation count for ${item.workflowId}`)
      if (item.workflowId !== 'thesis_lifecycle') {
        const call = calls[0]!
        assert.equal(call.adapter, item.adapter)
        assert.equal(call.input.workflowRunId, runId, 'same runId reaches the production adapter boundary')
        const expectedInput = item.workflowId === 'theme_framework'
          ? { ...item.adapterArgs, workflowRunId: runId }
          : {
            ...item.adapterArgs,
            ...(item.workflowId === 'company_research' || item.workflowId === 'industry_research' || item.workflowId === 'earnings_review' || item.workflowId === 'valuation' || item.workflowId === 'event_research' ? { asOf: undefined } : {}),
            workflowRunId: runId,
            writeKnowledge: false,
            useStructuredKnowledge: true,
            sourceLibraryContext: [],
          }
        assert.deepEqual(call.input, expectedInput, 'the validated domain arguments and request policies reach the adapter')
      } else {
        const result = await started.completion as { mode?: string; status?: string; refresh?: { status?: string } }
        assert.equal(result.mode, 'REFRESH', 'the production Thesis Lifecycle binding invokes its existing workflow')
        assert.ok(result.refresh?.status, 'the supplied refresh input was executed by the actual Thesis Lifecycle function')
      }

      const run = workflowService.getWorkflowStatus(runId)!
      const expectedStatus = item.status === 'failed' ? 'failed' : item.status
      assert.equal(run.status, expectedStatus, `terminal lifecycle status for ${item.workflowId}`)
      assert.equal(run.executionResult?.runId, runId)
      assert.equal(run.executionResult?.workflowId, item.workflowId)
      assert.equal(run.executionResult?.executionStatus, expectedStatus)
      assert.equal(run.executionResult?.terminalStatus, expectedStatus)
      assert.equal(run.executionResult?.bundleRef, `research-bundle-${runId}`)
      assert.equal(run.executionResult?.bundleStatus, 'available')
      if (item.status === 'failed') assert.deepEqual(run.executionResult?.diagnostics, ['WORKFLOW_EXECUTION_FAILED'])
      if (item.status === 'cancelled') assert.deepEqual(run.executionResult?.diagnostics, [])
      assert.ok(run.executionResult?.diagnostics.every((code) => /^[A-Z][A-Z0-9_]{1,95}$/.test(code)), 'projection diagnostics only contain safe diagnostic codes')
      if (item.blockedReason !== undefined) assert.equal(run.executionResult?.blockedReason, item.blockedReason)
      if (item.mismatchedReport) assert.equal(run.executionResult?.reportRef, undefined, 'a report produced by a different run is not linked')
      if (item.dailyBrief) assert.equal(run.executionResult?.reportRef, `daily-brief-${runId}`, 'a matching Daily Brief is linked')
      if (item.reviewCase) assert.deepEqual(run.executionResult?.reviewRef, { kind: 'review_case', id: `review-${runId}` }, 'a matching review case is linked')
      if (item.workflowId === 'theme_framework') assert.deepEqual(run.executionResult?.reviewRef, { kind: 'theme_framework_candidate', id: runId })
      if (item.status === 'cancelled') {
        assert.equal(run.executionResult?.summary, 'Workflow was cancelled.')
        assert.equal(run.executionResult?.reportRef, undefined)
      }

      const bundle = await service.getBundleForRun(runId)
      assert.ok(bundle, `bundle associated with run ${runId}`)
      assert.equal(bundle?.workflowRunId, runId)
      assert.equal(bundle?.executionResult?.workflowId, item.workflowId)
      assert.equal(bundle?.executionResult?.terminalStatus, expectedStatus)
      if (item.mismatchedReport) assert.equal(bundle?.report, undefined)
      if (item.dailyBrief) assert.deepEqual(bundle?.report, { reportId: `daily-brief-${runId}` })
    })
  }
})

test('Daily Intelligence evening dispatch preserves the evening adapter input and links its matching brief', async () => {
  const workflowService = new WorkflowService()
  const bundleStore = memoryBundleStore()
  let adapterInput: Record<string, unknown> | undefined
  let briefId = ''
  const dailyIntelligenceService = {
    startBrief(input: Record<string, unknown>) {
      adapterInput = input
      briefId = 'evening-brief-run'
      const runId = input.workflowRunId as string
      workflowService.register({ runId, workflowType: 'daily_intelligence', objective: 'Evening Intelligence fixture' })
      return { runId, completion: workflowService.start(runId, async () => ({ status: 'completed' as const, summary: 'Evening brief is ready.', brief: { reportId: briefId } })) }
    },
    async getBrief(reportId: string) { return reportId === briefId ? { reportId, workflowRunId: adapterInput?.workflowRunId } : undefined },
  }
  const service = new ResearchDispatchService({
    workflowService, dailyIntelligenceService: dailyIntelligenceService as never,
    reasoningExecutor: semanticExecutor('daily_intelligence', { briefType: 'evening', tradeDate: '2026-10-09' }),
    bundleStore: bundleStore as never, clock: () => new Date(NOW),
  })
  const started = await service.startAsync({ query: 'Generate evening brief 2026-10-09', mode: { type: 'workflow', workflowId: 'daily_intelligence' } })
  assert.equal(started.status, 'started')
  await started.completion
  assert.deepEqual({ briefType: adapterInput?.briefType, tradeDate: adapterInput?.tradeDate }, { briefType: 'evening', tradeDate: '2026-10-09' })
  assert.equal(started.workflow?.workflowType, 'daily_intelligence')
  const runId = started.runId!
  assert.equal(workflowService.getWorkflowStatus(runId)?.executionResult?.reportRef, briefId)
  assert.equal((await service.getBundleForRun(runId))?.report?.reportId, briefId)
})
