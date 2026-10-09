import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRun } from '../api/runtime-client'
import { startWorkflowPolling } from './workflow-polling'

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
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(workflow('running')).mockResolvedValueOnce(workflow('completed'))
    const stop = startWorkflowPolling({ runId: 'run-1', fetchWorkflow, onUpdate: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchWorkflow).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops after a completed_with_review terminal response', async () => {
    vi.useFakeTimers()
    const fetchWorkflow = vi.fn().mockResolvedValueOnce(workflow('running')).mockResolvedValueOnce(workflow('completed_with_review'))
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
