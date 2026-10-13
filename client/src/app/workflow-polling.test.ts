import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRun } from '../api/runtime-client'
import { isWorkflowFinalResultSynchronized, startWorkflowPolling } from './workflow-polling'

function workflow(status: WorkflowRun['status'], runId = 'run-1'): WorkflowRun {
  return { runId, workflowType: 'ingest_document', objective: 'Test workflow', status, startedAt: 'now', updatedAt: 'now' }
}

describe('workflow polling', () => {
  afterEach(() => vi.useRealTimers())

  it('polls an active run once immediately and then once per interval', async () => {
    vi.useFakeTimers()
    const fetchWorkflow = vi.fn(async () => workflow('running'))
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchWorkflow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchWorkflow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(3)
    stop()
  })

  it('stops after a completed terminal response', async () => {
    vi.useFakeTimers()
    const completed = { ...workflow('completed'), executionResult: { runId: 'run-1', workflowId: 'company_research', executionStatus: 'completed' as const, terminalStatus: 'completed' as const, diagnostics: [], bundleStatus: 'available' as const } }
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(workflow('running')).mockResolvedValueOnce(completed)
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops after a completed_with_review terminal response', async () => {
    vi.useFakeTimers()
    const completeWithReview = { ...workflow('completed_with_review'), executionResult: { runId: 'run-1', workflowId: 'theme_framework', executionStatus: 'completed_with_review' as const, terminalStatus: 'completed_with_review' as const, diagnostics: [], bundleStatus: 'available' as const } }
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(workflow('running')).mockResolvedValueOnce(completeWithReview)
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops an old run and ignores its late response when a new run replaces it', async () => {
    vi.useFakeTimers()
    let resolveOld!: (value: WorkflowRun) => void
    const oldFetch = vi.fn(() => new Promise<WorkflowRun>((resolve) => { resolveOld = resolve }))
    const updates: string[] = []
    const stopOld = startWorkflowPolling({ runId: 'run-A', fetchWorkflow: oldFetch, onUpdate: (next) => updates.push(next.runId), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    stopOld()
    const newFetch = vi.fn(async () => workflow('running', 'run-B'))
    const stopNew = startWorkflowPolling({ runId: 'run-B', fetchWorkflow: newFetch, onUpdate: (next) => updates.push(next.runId), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    resolveOld(workflow('completed', 'run-A'))
    await vi.advanceTimersByTimeAsync(0)
    expect(updates).toEqual(['run-B'])
    expect(oldFetch).toHaveBeenCalledTimes(1)
    stopNew()
  })

  it('does not overlap a slow status request with another request', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (value: WorkflowRun) => void
    const fetchWorkflow = vi.fn()
      .mockImplementationOnce(() => new Promise<WorkflowRun>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(workflow('running'))
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(1)
    resolveFirst(workflow('running'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchWorkflow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    stop()
  })

  it('continues after terminal Workflow status until its matching execution result arrives', async () => {
    vi.useFakeTimers()
    const blocked = { ...workflow('blocked'), executionResult: { runId: 'run-1', workflowId: 'industry_research', executionStatus: 'blocked' as const, terminalStatus: 'blocked' as const, blockedReason: 'NO_CANONICAL_INDUSTRY_METRIC', bundleRef: 'research-bundle-run-1', diagnostics: [], bundleStatus: 'available' as const } }
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(workflow('running')).mockResolvedValueOnce(workflow('blocked')).mockResolvedValueOnce(blocked)
    const updates: WorkflowRun[] = []
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: (run) => updates.push(run), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(updates.at(-1)?.status).toBe('blocked')
    expect(isWorkflowFinalResultSynchronized(updates.at(-1)!)).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(3)
    expect(updates.at(-1)?.executionResult?.blockedReason).toBe('NO_CANONICAL_INDUSTRY_METRIC')
    expect(isWorkflowFinalResultSynchronized(updates.at(-1)!)).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(3)
    stop()
  })

  it.each([
    ['completed', 'available', { summary: 'Completed after delayed projection.' }],
    ['completed_with_review', 'available', { summary: 'Review is ready.', reviewRef: { kind: 'review_case', id: 'review-1' } }],
    ['cancelled', 'available', { summary: 'Workflow was cancelled.' }],
    ['failed', 'failed', { summary: 'Workflow failed safely.', diagnostics: ['BUNDLE_PERSIST_FAILED'] }],
  ] as const)('waits for the matching %s result projection and its Bundle state', async (status, bundleStatus, terminalFields) => {
    vi.useFakeTimers()
    const delayed = workflow(status)
    const synchronized = { ...delayed, executionResult: { runId: 'run-1', workflowId: 'test', executionStatus: status, terminalStatus: status, diagnostics: [], bundleStatus, ...terminalFields } } as WorkflowRun
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(delayed).mockResolvedValueOnce(synchronized)
    const updates: WorkflowRun[] = []
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: (run) => updates.push(run), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    expect(updates.at(-1)?.executionResult).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    expect(updates.at(-1)?.status).toBe(status)
    expect(isWorkflowFinalResultSynchronized(updates.at(-1)!)).toBe(true)
    if (status === 'cancelled') {
      expect(updates.at(-1)?.executionResult?.summary).toBe('Workflow was cancelled.')
      expect(updates.at(-1)?.executionResult?.reportRef).toBeUndefined()
      expect(updates.at(-1)?.executionResult?.reviewRef).toBeUndefined()
    }
    if (status === 'completed_with_review') expect(updates.at(-1)?.executionResult?.reviewRef).toEqual({ kind: 'review_case', id: 'review-1' })
    if (status === 'failed') expect(updates.at(-1)?.executionResult?.diagnostics).toContain('BUNDLE_PERSIST_FAILED')
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    stop()
  })

  it.each([
    ['completed', 'available'],
    ['completed_with_review', 'available'],
    ['cancelled', 'available'],
    ['failed', 'failed'],
  ] as const)('recognizes synchronized %s result when Bundle state is %s', (status, bundleStatus) => {
    const run = { ...workflow(status), executionResult: { runId: 'run-1', workflowId: 'test', executionStatus: status, terminalStatus: status, diagnostics: [], bundleStatus } } as WorkflowRun
    expect(isWorkflowFinalResultSynchronized(run)).toBe(true)
  })

  it('keeps polling when execution result belongs to a different run or its Bundle is pending', async () => {
    vi.useFakeTimers()
    const wrongRun = { ...workflow('blocked'), executionResult: { runId: 'other-run', workflowId: 'industry_research', executionStatus: 'blocked' as const, terminalStatus: 'blocked' as const, diagnostics: [], bundleStatus: 'available' as const } }
    const pending = { ...workflow('blocked'), executionResult: { runId: 'run-1', workflowId: 'industry_research', executionStatus: 'blocked' as const, terminalStatus: 'blocked' as const, bundleStatus: 'pending' as const, diagnostics: [] } }
    const final = { ...workflow('blocked'), executionResult: { ...pending.executionResult, bundleStatus: 'failed' as const, diagnostics: ['BUNDLE_PERSIST_FAILED'] } }
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(wrongRun).mockResolvedValueOnce(pending).mockResolvedValueOnce(final)
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(3)
    stop()
  })

  it('stops after the configured consecutive fetch-error limit', async () => {
    vi.useFakeTimers()
    const onExhausted = vi.fn()
    const fetchWorkflow = vi.fn().mockRejectedValue(new Error('private transport detail'))
    const stop = startWorkflowPolling({ runId: 'run-1', intervalMs: 10, maxConsecutiveErrors: 2, fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn(), onExhausted })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    expect(onExhausted).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops after the configured polling bound even while a workflow remains active', async () => {
    vi.useFakeTimers()
    const onExhausted = vi.fn()
    const fetchWorkflow = vi.fn(async () => workflow('running'))
    const stop = startWorkflowPolling({ runId: 'run-1', intervalMs: 10, maxPolls: 2, fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn(), onExhausted })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    expect(onExhausted).toHaveBeenCalledTimes(1)
    stop()
  })
})
