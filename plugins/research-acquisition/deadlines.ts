import type { WorkflowAcquisitionActivity } from '../../workflows/observation-contracts.ts'

export interface ResearchFetchOptions {
  readonly downloadTimeoutMs?: number
  readonly parseTimeoutMs?: number
  readonly deadlineAt?: number
  readonly onProgress?: (activity: WorkflowAcquisitionActivity) => Promise<void> | void
}

/** Keep the deadline active through body consumption and propagate cancellation to the real I/O. */
export async function acquisitionStep<T>(input: {
  readonly activityId: string; readonly providerId: string; readonly step: WorkflowAcquisitionActivity['step']
  readonly sourceTitle?: string; readonly signal?: AbortSignal; readonly timeoutMs: number
  readonly deadlineAt?: number; readonly onProgress?: ResearchFetchOptions['onProgress']
}, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const startedAt = new Date().toISOString()
  const activity = { activityId: input.activityId, providerId: input.providerId, step: input.step, sourceTitle: input.sourceTitle, startedAt }
  const timeoutMs = Math.max(0, Math.min(input.timeoutMs, input.deadlineAt === undefined ? Infinity : input.deadlineAt - Date.now()))
  let timedOut = false
  const timeoutCode = input.deadlineAt !== undefined && input.deadlineAt - Date.now() <= input.timeoutMs
    ? 'ACQUISITION_BUDGET_EXCEEDED' : input.step === 'parsing' ? 'DOCUMENT_PARSE_TIMEOUT' : 'SOURCE_DOWNLOAD_TIMEOUT'
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  try {
    if (input.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    await input.onProgress?.({ ...activity, status: 'running' })
    if (timeoutMs === 0 || (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt)) { timedOut = true; throw new Error(timeoutCode) }
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(new Error(timeoutCode)); reject(new Error(timeoutCode)) }, Math.max(0, Math.min(timeoutMs, input.deadlineAt === undefined ? Infinity : input.deadlineAt - Date.now())))
      cancel = () => { controller.abort(input.signal?.reason); reject(new Error('WORKFLOW_CANCELLED')) }
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) cancel()
    })
    const result = await Promise.race([operation(controller.signal), deadline])
    await input.onProgress?.({ ...activity, status: 'completed', completedAt: new Date().toISOString() })
    return result
  } catch (error) {
    const inheritedDeadline = input.signal?.aborted && input.signal.reason instanceof Error
      && ['SOURCE_DOWNLOAD_TIMEOUT', 'DOCUMENT_PARSE_TIMEOUT', 'ACQUISITION_BUDGET_EXCEEDED'].includes(input.signal.reason.message)
      ? input.signal.reason.message : undefined
    const cancelled = input.signal?.aborted && inheritedDeadline === undefined
    await input.onProgress?.({ ...activity, status: cancelled ? 'cancelled' : timedOut || inheritedDeadline ? 'timeout' : 'failed', completedAt: new Date().toISOString(),
      diagnosticCode: cancelled ? 'WORKFLOW_CANCELLED' : inheritedDeadline ?? (timedOut ? timeoutCode : 'PROVIDER_ATTEMPT_FAILED') })
    if (cancelled) throw new Error('WORKFLOW_CANCELLED')
    if (inheritedDeadline) throw new Error(inheritedDeadline)
    if (timedOut) throw new Error(timeoutCode)
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (cancel) input.signal?.removeEventListener('abort', cancel)
  }
}
