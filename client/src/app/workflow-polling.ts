import type { WorkflowRun } from '../api/runtime-client'

export const terminalWorkflowStatuses: ReadonlySet<WorkflowRun['status']> = new Set(['completed', 'completed_with_review', 'blocked', 'cancelled', 'failed'])

export interface WorkflowPollingOptions {
  readonly runId: string
  readonly intervalMs?: number
  readonly maxPolls?: number
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
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3
  let stopped = false
  let polls = 0
  let consecutiveErrors = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => { timer = undefined; void poll() }, intervalMs)
  }
  const poll = async (): Promise<void> => {
    if (stopped || polls >= maxPolls) { options.onExhausted?.(); return }
    polls += 1
    try {
      const next = await options.fetchWorkflow(options.runId)
      if (stopped) return
      consecutiveErrors = 0
      options.onUpdate(next)
      if (!terminalWorkflowStatuses.has(next.status)) schedule()
    } catch (error) {
      if (stopped) return
      options.onError(error)
      consecutiveErrors += 1
      if (consecutiveErrors >= maxConsecutiveErrors || polls >= maxPolls) options.onExhausted?.()
      else schedule()
    }
  }

  void poll()
  return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
}
