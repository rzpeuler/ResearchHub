import type { AcquisitionAttemptStatus } from './contracts.ts'

export interface CompanySourceAttemptTrace {
  readonly metricId: string
  readonly sourceId: string
  readonly status: AcquisitionAttemptStatus
  readonly requirementId?: string
  readonly round?: number
  readonly diagnostic?: string
  /** True only after usable evidence/data passes acquisition validation. */
  readonly validated?: boolean
}
export interface CompanySourceHealthAdvice {
  readonly metricId: string
  readonly requirementId?: string
  readonly sourceId: string
  readonly status: 'repeated_failure' | 'replacement_recommended'
  readonly failureCount: number
  readonly latestDiagnostic?: string
  readonly replacementSourceId?: string
}

/** Run-local advice, never a mutation of the persisted source policy or global source health. */
export function assessCompanySourceHealth(trace: readonly CompanySourceAttemptTrace[]): readonly CompanySourceHealthAdvice[] {
  const groups = new Map<string, { attempt: CompanySourceAttemptTrace; indices: number[] }>()
  trace.forEach((attempt, index) => {
    const key = JSON.stringify([attempt.metricId, attempt.requirementId ?? '', attempt.sourceId])
    if (attempt.status === 'SUCCESS' && attempt.validated === true) { groups.delete(key); return }
    if (!providerFailure(attempt)) return
    const group = groups.get(key) ?? { attempt, indices: [] }
    group.attempt = attempt
    group.indices.push(index)
    groups.set(key, group)
  })
  const advice: CompanySourceHealthAdvice[] = []
  for (const { attempt, indices } of groups.values()) {
    if (indices.length < 2) continue
    const replacement = trace.slice(indices.at(-1)! + 1).find((other) => other.metricId === attempt.metricId && (other.requirementId ?? '') === (attempt.requirementId ?? '') && other.sourceId !== attempt.sourceId && other.status === 'SUCCESS' && other.validated === true)
    advice.push({ metricId: attempt.metricId, ...(attempt.requirementId ? { requirementId: attempt.requirementId } : {}), sourceId: attempt.sourceId, status: replacement ? 'replacement_recommended' : 'repeated_failure', failureCount: indices.length, ...(attempt.diagnostic ? { latestDiagnostic: attempt.diagnostic.replace(/[\r\n]+/g, ' ').slice(0, 240) } : {}), ...(replacement ? { replacementSourceId: replacement.sourceId } : {}) })
  }
  return advice
}

function providerFailure(attempt: CompanySourceAttemptTrace): boolean {
  if (/ACQUISITION_BUDGET_EXCEEDED|WORKFLOW_CANCELLED|CONSUMER_PRE_FETCH|OUTSIDE_PERIOD|FUTURE|POINT_IN_TIME/i.test(attempt.diagnostic ?? '')) return false
  return ['NO_DATA', 'TIMEOUT', 'RATE_LIMITED', 'ACCESS_DENIED', 'SOURCE_ERROR', 'PARSE_ERROR', 'VALIDATION_ERROR', 'UNSUPPORTED'].includes(attempt.status)
}
