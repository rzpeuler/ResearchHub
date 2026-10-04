import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkflowService } from '../../../app/services/workflow-service.ts'

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
