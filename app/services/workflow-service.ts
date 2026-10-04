import { ApplicationServiceError, type TerminalWorkflowStatus, type WorkflowCancelResult, type WorkflowRunView, type WorkflowStatus } from './contracts.ts'

interface RunRecord extends WorkflowRunView { readonly controller?: AbortController; readonly terminal: boolean }
const TERMINAL = new Set<WorkflowStatus>(['completed', 'completed_with_review', 'blocked', 'cancelled', 'failed'])
function now(): string { return new Date().toISOString() }

export interface WorkflowRegistration { readonly runId: string; readonly workflowType: string; readonly objective: string }
export interface WorkflowOutcome { readonly status: TerminalWorkflowStatus; readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string }

export class WorkflowService {
  private readonly runs = new Map<string, RunRecord>()
  register(input: WorkflowRegistration): WorkflowRunView {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.runId)) throw new ApplicationServiceError('invalid_input', 'runId must be a safe deterministic identifier')
    if (this.runs.has(input.runId)) throw new ApplicationServiceError('invalid_input', `Workflow run already exists: ${input.runId}`)
    const timestamp = now()
    const record: RunRecord = { runId: input.runId, workflowType: input.workflowType, objective: input.objective, status: 'pending', startedAt: timestamp, updatedAt: timestamp, terminal: false }
    this.runs.set(input.runId, record)
    return this.view(record)
  }
  start<T extends WorkflowOutcome>(runId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const record = this.runs.get(runId)
    if (!record) return Promise.reject(new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`))
    if (record.status !== 'pending') return Promise.reject(new ApplicationServiceError('invalid_input', `Workflow run is not pending: ${runId}`))
    const controller = new AbortController()
    this.runs.set(runId, { ...record, status: 'running', updatedAt: now(), controller, terminal: false, progressSummary: `${record.workflowType} is running` })
    return operation(controller.signal).then((outcome) => {
      const current = this.runs.get(runId)
      if (!current || current.status === 'cancelled' || controller.signal.aborted) return outcome
      if (outcome.status === 'failed') this.markFailure(runId, outcome.errorSummary ?? outcome.summary ?? 'Workflow failed')
      else if (outcome.status === 'cancelled') this.cancelWorkflow(runId)
      else this.markTerminal(runId, outcome.status, { summary: outcome.summary, reviewCount: outcome.reviewCount, errorSummary: outcome.errorSummary })
      return outcome
    }).catch((error) => {
      const current = this.runs.get(runId)
      if (current?.status === 'cancelled' || controller.signal.aborted) throw new ApplicationServiceError('cancelled', `Workflow run cancelled: ${runId}`, { cause: error })
      this.markFailure(runId, error)
      throw error
    }).finally(() => {
      const current = this.runs.get(runId)
      if (current) { const { controller: _controller, ...withoutController } = current; this.runs.set(runId, withoutController as RunRecord) }
    })
  }
  markTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.status === 'cancelled' || current.terminal) return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: details.summary }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: details.errorSummary }) }
    this.runs.set(runId, next)
    return this.view(next)
  }
  markAuthoritativeTerminal(runId: string, status: TerminalWorkflowStatus, details: { readonly summary?: string; readonly reviewCount?: number; readonly errorSummary?: string } = {}): WorkflowRunView {
    if (!TERMINAL.has(status)) throw new ApplicationServiceError('invalid_input', `Not a terminal status: ${status}`)
    const current = this.require(runId)
    if (current.terminal && current.status !== 'cancelled') return this.view(current)
    if (status === 'failed') return this.markFailure(runId, details.errorSummary ?? details.summary ?? 'Workflow failed')
    const timestamp = now()
    const next: RunRecord = { ...current, status, updatedAt: timestamp, completedAt: timestamp, terminal: true, ...(details.summary === undefined ? {} : { progressSummary: details.summary }), ...(details.reviewCount === undefined ? {} : { reviewCount: details.reviewCount }), ...(details.errorSummary === undefined ? {} : { errorSummary: details.errorSummary }) }
    this.runs.set(runId, next)
    return this.view(next)
  }
  markFailure(runId: string, error: unknown): WorkflowRunView {
    const current = this.require(runId)
    if (current.terminal) return this.view(current)
    const timestamp = now(); const message = error instanceof ApplicationServiceError && error.code === 'cancelled' ? error.message : error instanceof Error ? error.message : String(error)
    const next: RunRecord = { ...current, status: 'failed', updatedAt: timestamp, completedAt: timestamp, terminal: true, errorSummary: message.slice(0, 500), progressSummary: 'Workflow failed' }
    this.runs.set(runId, next); return this.view(next)
  }
  getWorkflowStatus(runId: string): WorkflowRunView | undefined { const value = this.runs.get(runId); return value === undefined ? undefined : this.view(value) }
  /** Includes pending runs so Runtime configuration cannot change between registration and execution. */
  hasActiveRuns(): boolean { return [...this.runs.values()].some((record) => !record.terminal) }
  cancelWorkflow(runId: string): WorkflowCancelResult {
    const current = this.runs.get(runId)
    if (!current) throw new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`)
    if (current.status === 'running') {
      current.controller?.abort()
      const timestamp = now()
      this.runs.set(runId, { ...current, status: 'cancelled', updatedAt: timestamp, completedAt: timestamp, terminal: true, progressSummary: 'Workflow cancelled' })
      return { runId, status: 'cancelled', cancelled: true, reason: 'cancelled' }
    }
    return { runId, status: current.status, cancelled: false, reason: current.terminal ? 'already_terminal' : 'not_running' }
  }
  private require(runId: string): RunRecord { const value = this.runs.get(runId); if (!value) throw new ApplicationServiceError('not_found', `Workflow run not found: ${runId}`); return value }
  private view(record: RunRecord): WorkflowRunView { const { controller: _controller, terminal: _terminal, ...view } = record; return view }
}
