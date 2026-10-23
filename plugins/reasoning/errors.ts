import type { ReasoningOperation } from './contracts.ts'

export const REASONING_ERROR_CODES = [
  'reasoning_host_unavailable',
  'reasoning_configuration_invalid',
  'reasoning_execution_failed',
  'reasoning_timeout',
  'reasoning_output_invalid',
  'reasoning_output_too_large',
  'reasoning_structured_output_configuration_failed',
] as const

export type ReasoningFailureClass =
  | 'structured_output_configuration'
  | 'authentication_or_account'
  | 'model_unavailable'
  | 'rate_limit_or_quota'
  | 'safety_or_policy'
  | 'timeout_or_cancel'
  | 'transport_or_service'
  | 'unknown_nonzero_exit'

export type ReasoningExitState = 'not_started' | 'started' | 'normal_exit' | 'nonzero_exit' | 'timeout' | 'cancelled'

export type ReasoningErrorCode = (typeof REASONING_ERROR_CODES)[number]

const SAFE_TRANSPORT_CODES = new Set([
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ABORT_ERR',
])

/** Return only bounded error metadata suitable for persisted workflow diagnostics. */
export function summarizeReasoningFailure(error: unknown): { readonly message: string; readonly causeSummary?: string } {
  const topMessage = error instanceof Error ? error.message : String(error)
  const message = safeDiagnosticText(topMessage).slice(0, 300) || 'Reasoning execution failed'
  if (!(error instanceof ReasoningExecutorError) || error.cause === undefined) return { message }

  const parts: string[] = []
  if (error.code) parts.push(error.code)
  let cause: unknown = error.cause
  const seen = new Set<unknown>([error])
  let safeCodeFound = false
  for (let depth = 0; cause && depth < 2 && !seen.has(cause); depth++) {
    seen.add(cause)
    if (typeof cause !== 'object' && typeof cause !== 'function') break
    const record = cause as { name?: unknown; code?: unknown; cause?: unknown }
    const name = typeof record.name === 'string' ? record.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) : ''
    const code = typeof record.code === 'string' && SAFE_TRANSPORT_CODES.has(record.code) ? record.code : ''
    safeCodeFound ||= Boolean(code)
    if (name || code) parts.push(`${name || 'Error'}${code ? `[${code}]` : ''}`)
    cause = record.cause
  }
  if (!safeCodeFound) parts.push('cause detail unavailable')
  return { message, ...(parts.length ? { causeSummary: parts.join(' <- ').slice(0, 180) } : {}) }
}

function safeDiagnosticText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(/\b(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
}

export class ReasoningExecutorError extends Error {
  readonly code: ReasoningErrorCode
  readonly operation?: ReasoningOperation
  readonly operationId?: string
  readonly exitCode?: number
  /** Legacy provider detail retained for the non-Codex adapter; Codex CLI never sets it. */
  readonly stderr?: string
  readonly processStarted?: boolean
  readonly exitState?: ReasoningExitState
  readonly failureClass?: ReasoningFailureClass
  readonly structuredEventType?: string
  readonly safeErrorCode?: string
  /** Bounded actual model output rejected by parsing/contract validation; never validated evidence. */
  readonly rawOutput?: string

  constructor(
    code: ReasoningErrorCode,
    message: string,
    details: {
      operation?: ReasoningOperation
      operationId?: string
      exitCode?: number
      stderr?: string
      processStarted?: boolean
      exitState?: ReasoningExitState
      failureClass?: ReasoningFailureClass
      structuredEventType?: string
      safeErrorCode?: string
      rawOutput?: string
      cause?: unknown
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'ReasoningExecutorError'
    this.code = code
    this.operation = details.operation
    this.operationId = details.operationId
    this.exitCode = details.exitCode
    if (details.stderr !== undefined) this.stderr = details.stderr
    this.processStarted = details.processStarted
    this.exitState = details.exitState
    this.failureClass = details.failureClass
    this.structuredEventType = details.structuredEventType
    this.safeErrorCode = details.safeErrorCode
    if (details.rawOutput !== undefined) this.rawOutput = details.rawOutput
  }
}
