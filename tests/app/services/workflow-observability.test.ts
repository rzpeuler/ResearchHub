import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { listWorkflowDefinitions } from '../../../app/services/workflow-registry.ts'

function runningWorkflow(service: WorkflowService, runId: string) {
  service.register({ runId, workflowType: 'company_research', objective: 'Company research 600519' })
  let finish!: (value: { readonly status: 'completed' }) => void
  const completion = service.start(runId, () => new Promise<{ readonly status: 'completed' }>((resolve) => { finish = resolve }))
  return { completion, finish }
}

test('Workflow observations are ordered, idempotent, revisioned, and terminal-safe', async () => {
  const service = new WorkflowService()
  const run = runningWorkflow(service, 'observe-run-1')
  const initial = service.getWorkflowStatus('observe-run-1')!
  assert.equal(initial.status, 'running')
  assert.equal(initial.observationRevision, 1)
  const unmatchedFinish = service.finishStage('observe-run-1', 'not-started', 'completed', { summary: 'late completion' })
  assert.equal(unmatchedFinish.stages.length, 0)
  assert.equal(unmatchedFinish.observationRevision, initial.observationRevision)
  const first = service.startStage('observe-run-1', 'data_acquisition', '数据获取')
  const duplicate = service.startStage('observe-run-1', 'data_acquisition', '改写后的标签')
  assert.equal(duplicate.observationRevision, first.observationRevision)
  assert.equal(duplicate.stages.length, 1)
  const complete = service.finishStage('observe-run-1', 'data_acquisition', 'completed', { summary: '真实采集已结束' })
  const duplicateFinish = service.finishStage('observe-run-1', 'data_acquisition', 'failed', { summary: 'late event' })
  assert.equal(duplicateFinish.stages[0]?.status, 'completed')
  assert.equal(duplicateFinish.observationRevision, complete.observationRevision)
  assert.ok((complete.stages[0]?.durationMs ?? -1) >= 0)
  service.startStage('observe-run-1', 'research_synthesis', '研究综合分析')
  run.finish({ status: 'completed' })
  await run.completion
  const terminal = service.getWorkflowStatus('observe-run-1')!
  assert.equal(terminal.status, 'completed')
  assert.equal(terminal.stages[1]?.status, 'completed')
  assert.ok((terminal.stages[1]?.durationMs ?? -1) >= 0)
  const afterLateEvent = service.finishStage('observe-run-1', 'research_synthesis', 'failed')
  assert.equal(afterLateEvent.observationRevision, terminal.observationRevision)
  assert.equal(afterLateEvent.stages[1]?.status, 'completed')
})

test('successful Workflow closure leaves no running Skill observation', async () => {
  const service = new WorkflowService()
  const run = runningWorkflow(service, 'observe-run-skill-close')
  service.startSkill('observe-run-skill-close', 'company_synthesis', '公司研究综合分析')
  run.finish({ status: 'completed' })
  await run.completion
  const snapshot = service.getWorkflowStatus('observe-run-skill-close')!
  assert.equal(snapshot.skillObservations[0]?.status, 'completed')
  assert.ok(snapshot.skillObservations[0]?.completedAt)
  assert.ok((snapshot.skillObservations[0]?.durationMs ?? -1) >= 0)
})

test('all terminal paths close active Skills with the matching outcome and reject late Skill events', async () => {
  const terminalizers: readonly { readonly name: string; readonly expected: 'completed' | 'failed' | 'cancelled'; readonly finish: (service: WorkflowService, runId: string) => void }[] = [
    { name: 'markTerminal completed', expected: 'completed', finish: (service, runId) => { service.markTerminal(runId, 'completed') } },
    { name: 'markTerminal completed_with_review', expected: 'completed', finish: (service, runId) => { service.markTerminal(runId, 'completed_with_review') } },
    { name: 'markTerminal blocked', expected: 'failed', finish: (service, runId) => { service.markTerminal(runId, 'blocked') } },
    { name: 'authoritative completed', expected: 'completed', finish: (service, runId) => { service.markAuthoritativeTerminal(runId, 'completed') } },
    { name: 'authoritative completed_with_review', expected: 'completed', finish: (service, runId) => { service.markAuthoritativeTerminal(runId, 'completed_with_review') } },
    { name: 'authoritative blocked', expected: 'failed', finish: (service, runId) => { service.markAuthoritativeTerminal(runId, 'blocked') } },
    { name: 'authoritative cancelled', expected: 'cancelled', finish: (service, runId) => { service.markAuthoritativeTerminal(runId, 'cancelled') } },
    { name: 'failure', expected: 'failed', finish: (service, runId) => { service.markFailure(runId, new Error('PROVIDER_FAILED')) } },
    { name: 'cancellation', expected: 'cancelled', finish: (service, runId) => { service.cancelWorkflow(runId) } },
  ]

  for (const [index, terminalizer] of terminalizers.entries()) {
    const service = new WorkflowService()
    const runId = `observe-skill-terminal-${index}`
    const run = runningWorkflow(service, runId)
    service.startSkill(runId, 'company_synthesis', '公司研究综合分析')
    terminalizer.finish(service, runId)
    const terminal = service.getWorkflowStatus(runId)!
    assert.equal(terminal.skillObservations[0]?.status, terminalizer.expected, terminalizer.name)
    assert.ok(terminal.skillObservations[0]?.completedAt, terminalizer.name)
    assert.ok((terminal.skillObservations[0]?.durationMs ?? -1) >= 0, terminalizer.name)

    const revision = terminal.observationRevision
    service.finishSkill(runId, 'company_synthesis', 'completed', 'late completion')
    service.startSkill(runId, 'late_skill', '迟到的 Skill')
    assert.equal(service.getWorkflowStatus(runId)?.observationRevision, revision, terminalizer.name)
    assert.equal(service.getWorkflowStatus(runId)?.skillObservations.length, 1, terminalizer.name)

    run.finish({ status: 'completed' })
    await run.completion
    assert.equal(service.getWorkflowStatus(runId)?.status, terminal.status, terminalizer.name)
  }
})

test('Workflow cancellation closes running stages and Skills without claiming success', async () => {
  const service = new WorkflowService()
  const run = runningWorkflow(service, 'observe-run-cancel')
  service.startStage('observe-run-cancel', 'data_acquisition', '数据获取')
  service.startSkill('observe-run-cancel', 'company_synthesis', '公司研究综合分析')
  const cancelled = service.cancelWorkflow('observe-run-cancel')
  assert.equal(cancelled.cancelled, true)
  run.finish({ status: 'completed' })
  await run.completion
  const snapshot = service.getWorkflowStatus('observe-run-cancel')!
  assert.equal(snapshot.status, 'cancelled')
  assert.equal(snapshot.stages[0]?.status, 'cancelled')
  assert.equal(snapshot.skillObservations[0]?.status, 'cancelled')
  assert.ok((snapshot.stages[0]?.durationMs ?? -1) >= 0)
})

test('Workflow observation projection omits unsafe details and accepts only stable diagnostic codes', async () => {
  const service = new WorkflowService()
  const run = runningWorkflow(service, 'observe-run-safe')
  service.startStage('observe-run-safe', 'data_acquisition', 'C:\\Users\\private\\token=secret')
  service.finishStage('observe-run-safe', 'data_acquisition', 'blocked', { summary: 'Bearer hidden', diagnostics: ['NO_COMPANY_RESEARCH_EVIDENCE', 'provider failed: secret'] })
  service.observationReporter('observe-run-safe').providerObservations([{ providerId: 'cninfo', label: '上市公司公告', status: 'partial', recordCount: 2, startedAt: '2026-10-12T00:00:02.000Z', completedAt: '2026-10-12T00:00:01.000Z', diagnostics: ['PROVIDER_ATTEMPT_FAILED', 'private path C:\\Users\\me'] }])
  const snapshot = service.getWorkflowStatus('observe-run-safe')!
  assert.equal(snapshot.stages[0]?.label, 'Workflow observation')
  assert.equal(snapshot.stages[0]?.summary, 'Additional details omitted.')
  assert.deepEqual(snapshot.stages[0]?.diagnostics, ['NO_COMPANY_RESEARCH_EVIDENCE'])
  assert.equal(snapshot.providerObservations[0]?.status, 'partial')
  assert.equal(snapshot.providerObservations[0]?.startedAt, undefined)
  assert.equal(snapshot.providerObservations[0]?.completedAt, undefined)
  assert.equal(snapshot.providerObservations[0]?.durationMs, undefined)
  assert.deepEqual(snapshot.providerObservations[0]?.diagnostics, ['PROVIDER_ATTEMPT_FAILED', 'PROVIDER_TIMING_INVALID'])
  service.observationReporter('observe-run-safe').providerObservations([{ providerId: 'gdelt', label: '新闻资料', status: 'success', startedAt: '2026-10-12T00:00:00-05:00', completedAt: '2026-10-12T05:00:00.250Z', diagnostics: [] }])
  const validOffsetObservation = service.getWorkflowStatus('observe-run-safe')!.providerObservations.find((item) => item.providerId === 'gdelt')
  assert.equal(validOffsetObservation?.durationMs, 250)
  assert.equal(validOffsetObservation?.startedAt, '2026-10-12T05:00:00.000Z')
  service.cancelWorkflow('observe-run-safe')
  run.finish({ status: 'completed' })
  await run.completion
})

test('free-form provider and identity errors, paths, tokens, and stack traces are redacted', async () => {
  const unsafeSummaries = [
    'Provider rejected query for user@example.com: private portfolio is 100 shares',
    'UNRESOLVED_REFERENCE: issuer identity mismatch for Customer Secret Acquisition LLC',
    'C:\\Users\\Administrator\\private\\provider.log: token=top-secret',
    'Bearer eyJhbGciOi...\n    at Provider.fetch (C:\\Users\\Administrator\\app.js:12:4)',
    'Error: secret provider payload\n    at resolveIdentity (/home/private/runtime.js:9:3)',
  ]

  for (const [index, unsafeSummary] of unsafeSummaries.entries()) {
    const service = new WorkflowService()
    const runId = `observe-redaction-${index}`
    service.register({ runId, workflowType: 'company_research', objective: 'Company research 600519' })
    const projected = service.markFailure(runId, new Error(unsafeSummary)).errorSummary
    assert.equal(projected, 'Workflow execution failed; details were omitted.')
    assert.equal(unsafeSummary.includes(projected ?? ''), false)
  }

  const service = new WorkflowService()
  service.register({ runId: 'observe-redaction-terminal', workflowType: 'company_research', objective: 'Company research 600519' })
  const run = service.start('observe-redaction-terminal', async () => ({ status: 'completed' as const }))
  const terminal = service.markTerminal('observe-redaction-terminal', 'blocked', { errorSummary: unsafeSummaries[0] })
  assert.equal(terminal.errorSummary, 'Workflow execution failed; details were omitted.')
  await run
})

test('all registered Workflows expose trusted Chinese display labels without changing IDs', () => {
  const workflows = listWorkflowDefinitions()
  assert.equal(workflows.length, 9)
  assert.deepEqual(workflows.map((workflow) => workflow.id), ['company_research', 'daily_intelligence', 'earnings_review', 'event_research', 'industry_research', 'theme_framework', 'thesis_lifecycle', 'thesis_red_team', 'valuation'])
  assert.ok(workflows.every((workflow) => workflow.displayNameZh?.trim()))
})
