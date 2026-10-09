import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { projectResearchExecutionResult } from '../../../app/services/research-execution-result.ts'

test('Runtime configuration guard sees pending and running workflows, then clears on completion', async () => {
  const service = new WorkflowService()
  assert.equal(service.hasActiveRuns(), false)
  service.register({ runId: 'settings-guard', workflowType: 'test', objective: 'guard' })
  assert.equal(service.hasActiveRuns(), true)

  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const completion = service.start('settings-guard', async () => {
    await pending
    return { status: 'completed' as const }
  })
  assert.equal(service.hasActiveRuns(), true)
  finish()
  await completion
  assert.equal(service.hasActiveRuns(), false)
})

test('Workflow failure summary omits paths, credentials, and multiline stack details', async () => {
  const service = new WorkflowService()
  service.register({ runId: 'safe-failure', workflowType: 'test', objective: 'failure' })
  await assert.rejects(service.start('safe-failure', async () => { throw new Error('adapter failed at C:\\Users\\fixture\\private.ts Authorization: Bearer secret-value\n at invoke (C:\\Users\\fixture\\private.ts:1:1)') }))
  const status = service.getWorkflowStatus('safe-failure')
  assert.equal(status?.status, 'failed')
  assert.equal(status?.errorSummary, 'Workflow execution failed; sensitive details were omitted.')
  assert.equal(JSON.stringify(status).includes('secret-value'), false)
  assert.equal(JSON.stringify(status).includes('private.ts'), false)
})

test('cancelled Workflow keeps a verified ResearchBundle link but suppresses report and review links', async () => {
  const service = new WorkflowService()
  service.register({ runId: 'cancelled-result', workflowType: 'industry_research', objective: 'cancelled research' })
  let release!: () => void
  const completion = service.start('cancelled-result', async () => {
    await new Promise<void>((resolve) => { release = resolve })
    return { status: 'completed' as const, summary: 'Late completion.' }
  })
  service.cancelWorkflow('cancelled-result')
  release()
  await completion
  const status = service.setExecutionResult('cancelled-result', {
    runId: 'cancelled-result', workflowId: 'industry_research', executionStatus: 'cancelled', terminalStatus: 'cancelled',
    summary: 'A late result must not replace cancellation.', reportRef: 'report-1', bundleRef: 'research-bundle-cancelled-result',
    reviewRef: { kind: 'review_case', id: 'review-1' }, diagnostics: ['WORKFLOW_CANCELLED'], bundleStatus: 'available',
  })
  assert.equal(status.status, 'cancelled')
  assert.equal(status.executionResult?.summary, 'Workflow was cancelled.')
  assert.equal(status.executionResult?.bundleRef, 'research-bundle-cancelled-result')
  assert.equal(status.executionResult?.reportRef, undefined)
  assert.equal(status.executionResult?.reviewRef, undefined)
  assert.deepEqual(status.executionResult?.diagnostics, [])
})

test('execution result projection drops summaries containing private paths or credential values', () => {
  const service = new WorkflowService()
  service.register({ runId: 'safe-summary', workflowType: 'company_research', objective: 'safe summary' })
  const workflow = service.getWorkflowStatus('safe-summary')!
  for (const summary of ['Private file C:\\Users\\fixture\\secret.md', 'Authorization: Bearer private-token', 'api_key=private-value']) {
    const projection = projectResearchExecutionResult({ workflowId: 'company_research', workflow, domainResult: { summary }, bundleStatus: 'unavailable' })
    assert.equal(projection.summary, undefined, summary)
  }
})
