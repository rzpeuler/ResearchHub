import type { WorkflowRun } from '../api/runtime-client'

export const terminalWorkflowStatuses: ReadonlySet<WorkflowRun['status']> = new Set(['completed', 'completed_with_review', 'blocked', 'cancelled', 'failed'])

export function isWorkflowFinalResultSynchronized(workflow: WorkflowRun): boolean {
  const result = workflow.executionResult
  return terminalWorkflowStatuses.has(workflow.status)
    && result !== undefined
    && result.runId === workflow.runId
    && result.executionStatus === workflow.status
    && result.terminalStatus === workflow.status
    && result.bundleStatus !== 'pending'
}

export interface WorkflowPollingOptions {
  readonly runId: string
  readonly intervalMs?: number
  readonly maxPolls?: number
  readonly maxUnsynchronizedTerminalPolls?: number
  readonly maxConsecutiveErrors?: number
  readonly fetchWorkflow: (runId: string) => Promise<WorkflowRun>
  readonly onUpdate: (workflow: WorkflowRun) => void
  readonly onError: (error: unknown) => void
  readonly onExhausted?: () => void
}

/** Polls one WorkflowRun without overlapping requests or restarting on state updates. */
export function startWorkflowPolling(options: WorkflowPollingOptions): () => void {
  const intervalMs = options.intervalMs ?? 1000
  const maxPolls = options.maxPolls ?? 120
  const maxUnsynchronizedTerminalPolls = options.maxUnsynchronizedTerminalPolls ?? 8
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3
  let stopped = false
  let polls = 0
  let unsynchronizedTerminalPolls = 0
  let consecutiveErrors = 0
  let exhausted = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const finish = (): void => {
    if (stopped || exhausted) return
    exhausted = true
    options.onExhausted?.()
  }

  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => { timer = undefined; void poll() }, intervalMs)
  }
  const poll = async (): Promise<void> => {
    if (stopped || polls >= maxPolls) { finish(); return }
    polls += 1
    try {
      const next = await options.fetchWorkflow(options.runId)
      if (stopped) return
      if (next.runId !== options.runId) throw new Error('Workflow response runId does not match the requested runId')
      consecutiveErrors = 0
      options.onUpdate(next)
      if (isWorkflowFinalResultSynchronized(next)) return
      if (terminalWorkflowStatuses.has(next.status)) {
        unsynchronizedTerminalPolls += 1
        if (unsynchronizedTerminalPolls >= maxUnsynchronizedTerminalPolls) { finish(); return }
      } else unsynchronizedTerminalPolls = 0
      schedule()
    } catch (error) {
      if (stopped) return
      options.onError(error)
      consecutiveErrors += 1
      if (consecutiveErrors >= maxConsecutiveErrors || polls >= maxPolls) finish()
      else schedule()
    }
  }

  void poll()
  return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
}
