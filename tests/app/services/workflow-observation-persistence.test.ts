import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkflowObservationStore } from '../../../app/runtime/workflow-observation-store.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'

async function fixture(): Promise<{ readonly root: string; readonly store: WorkflowObservationStore; close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'workflow-observation-lifecycle-'))
  return { root, store: new WorkflowObservationStore({ rootDir: join(root, 'snapshots') }), close: () => rm(root, { recursive: true, force: true }) }
}

test('persists acknowledged Company Research observations and restores the complete terminal history without re-execution', async () => {
  const f = await fixture()
  try {
    let executions = 0
    const service = new WorkflowService({ observationStore: f.store })
    assert.deepEqual(await service.initialize(), { available: true, diagnosticCodes: [] })
    service.register({ runId: 'company-research-run-1', workflowType: 'company_deep_research', objective: 'Company research 600519' })
    const completion = service.start('company-research-run-1', async () => {
      executions += 1
      const observation = service.observationReporter('company-research-run-1')
      await observation.startStage('data_acquisition', '数据获取')
      await observation.providerObservations([{ providerId: 'cninfo', label: '上市公司公告', status: 'partial', diagnostics: ['PROVIDER_TIMEOUT'] }])
      await observation.finishStage('data_acquisition', 'completed', { summary: '已记录安全的数据源观察' })
      await observation.startSkill('company_research_synthesis', '公司研究综合分析')
      await observation.finishSkill('company_research_synthesis', 'completed', '综合分析已返回')
      await observation.startStage('report_persistence', '报告保存')
      await observation.finishStage('report_persistence', 'completed', { summary: '研究报告已保存' })
      return { status: 'completed', summary: '研究完成' }
    })
    assert.equal((await completion).status, 'completed')
    service.setExecutionResult('company-research-run-1', {
      runId: 'company-research-run-1', workflowId: 'company_research', executionStatus: 'completed', terminalStatus: 'completed',
      summary: '研究完成', reportRef: 'report-company-research-run-1', bundleRef: 'bundle-company-research-run-1', diagnostics: [], bundleStatus: 'available',
    })
    await service.flushPersistence('company-research-run-1')
    assert.equal(service.getWorkflowStatus('company-research-run-1')?.historyPersistence?.status, 'saved')

    const restarted = new WorkflowService({ observationStore: new WorkflowObservationStore({ rootDir: join(f.root, 'snapshots') }) })
    assert.deepEqual(await restarted.initialize(), { available: true, diagnosticCodes: [] })
    const restored = await restarted.getWorkflowStatusWithHistory('company-research-run-1')
    assert.equal(restored?.status, 'completed')
    assert.equal(restored?.observationSource, 'historical')
    assert.equal(restored?.historyPersistence?.status, 'saved')
    assert.deepEqual(restored?.stages.map((stage) => [stage.stageId, stage.status]), [
      ['data_acquisition', 'completed'], ['report_persistence', 'completed'],
    ])
    assert.deepEqual(restored?.providerObservations.map((item) => item.providerId), ['cninfo'])
    assert.deepEqual(restored?.skillObservations.map((item) => [item.skillId, item.status]), [['company_research_synthesis', 'completed']])
    assert.equal(restored?.executionResult?.reportRef, 'report-company-research-run-1')
    assert.equal(restored?.executionResult?.bundleRef, 'bundle-company-research-run-1')
    assert.equal(executions, 1, 'loading a snapshot never replays the Workflow')
    assert.throws(() => restarted.register({ runId: 'company-research-run-1', workflowType: 'company_deep_research', objective: 'duplicate' }), /already exists/)

    const restoredAgain = new WorkflowService({ observationStore: new WorkflowObservationStore({ rootDir: join(f.root, 'snapshots') }) })
    await restoredAgain.initialize()
    assert.deepEqual(await restoredAgain.getWorkflowStatusWithHistory('company-research-run-1'), restored)
    assert.equal(executions, 1, 'repeated recovery is read-only and idempotent')
  } finally { await f.close() }
})

test('observation reporter acknowledges the requested durable revision before the producer continues', async () => {
  const f = await fixture()
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const writeEntered = new Promise<void>((resolve) => { entered = resolve })
  try {
    const originalWrite = f.store.write.bind(f.store)
    f.store.write = async (workflow) => {
      if (workflow.observationRevision === 2) { entered(); await gate }
      return originalWrite(workflow)
    }
    const service = new WorkflowService({ observationStore: f.store })
    await service.initialize()
    service.register({ runId: 'acknowledged-run', workflowType: 'company_deep_research', objective: 'Company research 600519' })
    await service.flushPersistence('acknowledged-run', 0)
    let transition: Promise<void> | undefined
    const completion = service.start('acknowledged-run', async () => {
      transition = service.observationReporter('acknowledged-run').startStage('data_acquisition', '数据获取')
      await transition
      await service.observationReporter('acknowledged-run').finishStage('data_acquisition', 'completed')
      return { status: 'completed' as const }
    })
    await writeEntered
    assert.ok(transition)
    let acknowledged = false
    void transition.then(() => { acknowledged = true })
    await Promise.resolve()
    assert.equal(acknowledged, false, 'the Company workflow must still be waiting while the stage snapshot write is held')
    release()
    await transition
    assert.equal(service.getWorkflowStatus('acknowledged-run')?.historyPersistence?.persistedRevision, 2)
    assert.equal((await completion).status, 'completed')
  } finally { release(); await f.close() }
})

test('separate conversations keep A/B Workflow snapshots isolated across recovery', async () => {
  const f = await fixture()
  try {
    const service = new WorkflowService({ observationStore: f.store })
    await service.initialize()
    for (const runId of ['conversation-a-run', 'conversation-b-run']) service.register({ runId, workflowType: 'company_deep_research', objective: `Company research ${runId}` })
    const outcomes = await Promise.all([
      service.start('conversation-a-run', async () => {
        const observation = service.observationReporter('conversation-a-run')
        await observation.startStage('a_stage', 'Conversation A stage')
        await observation.providerObservations([{ providerId: 'provider_a', label: 'Provider A', status: 'success', diagnostics: [] }])
        await observation.finishStage('a_stage', 'completed')
        return { status: 'completed' as const }
      }),
      service.start('conversation-b-run', async () => {
        const observation = service.observationReporter('conversation-b-run')
        await observation.startStage('b_stage', 'Conversation B stage')
        await observation.providerObservations([{ providerId: 'provider_b', label: 'Provider B', status: 'partial', diagnostics: ['PROVIDER_TIMEOUT'] }])
        await observation.finishStage('b_stage', 'blocked')
        return { status: 'blocked' as const }
      }),
    ])
    assert.deepEqual(outcomes.map((item) => item.status), ['completed', 'blocked'])
    await service.flushPersistence()
    const recovered = new WorkflowService({ observationStore: new WorkflowObservationStore({ rootDir: join(f.root, 'snapshots') }) })
    await recovered.initialize()
    const [a, b] = await Promise.all([recovered.getWorkflowStatusWithHistory('conversation-a-run'), recovered.getWorkflowStatusWithHistory('conversation-b-run')])
    assert.equal(a?.status, 'completed')
    assert.deepEqual(a?.stages.map((item) => item.stageId), ['a_stage'])
    assert.deepEqual(a?.providerObservations.map((item) => item.providerId), ['provider_a'])
    assert.equal(b?.status, 'blocked')
    assert.deepEqual(b?.stages.map((item) => item.stageId), ['b_stage'])
    assert.deepEqual(b?.providerObservations.map((item) => item.providerId), ['provider_b'])
  } finally { await f.close() }
})

test('recovers a persisted in-flight Workflow as interrupted with its last real stage and no fabricated completion', async () => {
  const f = await fixture()
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const producerEntered = new Promise<void>((resolve) => { entered = resolve })
  try {
    const first = new WorkflowService({ observationStore: f.store })
    await first.initialize()
    first.register({ runId: 'in-flight-run-1', workflowType: 'company_deep_research', objective: 'Company research 600519' })
    let executions = 0
    const completion = first.start('in-flight-run-1', async () => {
      executions += 1
      await first.observationReporter('in-flight-run-1').startStage('data_acquisition', '数据获取')
      entered()
      await gate
      return { status: 'completed' }
    })
    await producerEntered
    first.setExecutionResult('in-flight-run-1', { runId: 'in-flight-run-1', workflowId: 'company_research', executionStatus: 'running', diagnostics: [], bundleStatus: 'pending' })
    await first.flushPersistence('in-flight-run-1')

    const restarted = new WorkflowService({ observationStore: new WorkflowObservationStore({ rootDir: join(f.root, 'snapshots') }) })
    await restarted.initialize()
    const recovered = await restarted.getWorkflowStatusWithHistory('in-flight-run-1')
    assert.equal(recovered?.status, 'interrupted')
    assert.equal(recovered?.observationSource, 'historical')
    assert.deepEqual(recovered?.recoveryState, { kind: 'interrupted', lastObservedStatus: 'running' })
    assert.equal(recovered?.executionResult?.executionStatus, 'interrupted', 'the nested execution projection must not advertise a recovered run as still running')
    assert.equal(recovered?.executionResult?.terminalStatus, undefined, 'recovery must not fabricate a producer terminal result')
    assert.equal(recovered?.completedAt, undefined)
    assert.equal(recovered?.stages[0]?.status, 'interrupted')
    assert.equal(recovered?.stages[0]?.completedAt, undefined)
    assert.equal(recovered?.stages[0]?.durationMs, undefined)
    assert.equal(executions, 1)
    assert.throws(() => restarted.register({ runId: 'in-flight-run-1', workflowType: 'company_deep_research', objective: 'retry' }), /already exists/)

    release()
    await completion
  } finally { release(); await f.close() }
})

test('snapshot I/O failure is visible without changing the actual Workflow result', async () => {
  const f = await fixture()
  try {
    const obstruction = join(f.root, 'file-not-directory')
    await writeFile(obstruction, 'fixture')
    const service = new WorkflowService({ observationStore: new WorkflowObservationStore({ rootDir: join(obstruction, 'snapshots') }) })
    const initialized = await service.initialize()
    assert.equal(initialized.available, false)
    service.register({ runId: 'write-failure-run', workflowType: 'company_deep_research', objective: 'Company research 600519' })
    const result = await service.start('write-failure-run', async () => ({ status: 'completed', summary: 'Business result succeeded' }))
    await service.flushPersistence('write-failure-run')
    assert.equal(result.status, 'completed')
    assert.equal(service.getWorkflowStatus('write-failure-run')?.status, 'completed')
    assert.equal(service.getWorkflowStatus('write-failure-run')?.historyPersistence?.status, 'failed')
    assert.equal(service.getWorkflowStatus('write-failure-run')?.historyPersistence?.errorCode, 'io')
  } finally { await f.close() }
})

test('durable projection removes transient read metadata and redacts sensitive objective text', async () => {
  const f = await fixture()
  try {
    const service = new WorkflowService({ observationStore: f.store })
    await service.initialize()
    service.register({ runId: 'safe-projection-run', workflowType: 'company_deep_research', objective: 'api_key=do-not-store' })
    await service.flushPersistence('safe-projection-run')
    const stored = await f.store.read('safe-projection-run')
    assert.equal(stored?.workflow.objective, 'Workflow objective omitted for safety.')
    assert.equal(stored?.workflow.observationSource, undefined)
    assert.equal(stored?.workflow.historyPersistence, undefined)
    const serialized = JSON.stringify(stored)
    assert.equal(serialized.includes('do-not-store'), false)
  } finally { await f.close() }
})
