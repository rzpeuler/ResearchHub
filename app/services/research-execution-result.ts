import type { WorkflowExecutionResultProjection, WorkflowRunView } from './contracts.ts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,95}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ')
  if (!text || /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|private|var|tmp)\/|\bBearer\s+\S+|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+)/iu.test(text)) return undefined
  return text.slice(0, 1_000)
}

function safeCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && SAFE_CODE.test(item)))].slice(0, 12)
}

export function projectResearchExecutionResult(input: {
  readonly workflowId: string
  readonly workflow: WorkflowRunView
  readonly domainResult?: unknown
  readonly bundleStatus: WorkflowExecutionResultProjection['bundleStatus']
  readonly bundleRef?: string
  readonly verifiedReportId?: string
  readonly verifiedReviewCaseId?: string
  readonly extraDiagnostics?: readonly string[]
}): WorkflowExecutionResultProjection {
  const result = isRecord(input.domainResult) ? input.domainResult : undefined
  const terminal = input.workflow.status === 'pending' || input.workflow.status === 'running' ? undefined : input.workflow.status
  const summary = safeText(result?.summary) ?? safeText(result?.executiveSummary) ?? safeText(result?.executiveView) ?? safeText(input.workflow.progressSummary)
  const rawBlockedReason = result?.blockedReason
  const blockedReason = typeof rawBlockedReason === 'string' && SAFE_CODE.test(rawBlockedReason) ? rawBlockedReason : undefined
  const diagnostics = safeCodes([...(Array.isArray(result?.diagnostics) ? result.diagnostics : []), ...(input.extraDiagnostics ?? [])])
  const directReviewId = input.verifiedReviewCaseId !== undefined && SAFE_ID.test(input.verifiedReviewCaseId) ? input.verifiedReviewCaseId : undefined
  const themeCandidate = input.workflowId === 'theme_framework'
    && input.workflow.status === 'completed_with_review'
    && result?.workflowRunId === input.workflow.runId
    && result.status === 'awaiting_review'
    ? input.workflow.runId
    : undefined
  const executionResult: WorkflowExecutionResultProjection = {
    runId: input.workflow.runId,
    workflowId: input.workflowId,
    executionStatus: input.workflow.status,
    ...(terminal === undefined ? {} : { terminalStatus: terminal }),
    ...(summary === undefined ? {} : { summary }),
    ...(input.verifiedReportId !== undefined && SAFE_ID.test(input.verifiedReportId) ? { reportRef: input.verifiedReportId } : {}),
    ...(input.bundleRef !== undefined && SAFE_ID.test(input.bundleRef) ? { bundleRef: input.bundleRef } : {}),
    ...(directReviewId !== undefined ? { reviewRef: { kind: 'review_case' as const, id: directReviewId } } : themeCandidate === undefined ? {} : { reviewRef: { kind: 'theme_framework_candidate' as const, id: themeCandidate } }),
    ...(blockedReason === undefined ? {} : { blockedReason }),
    diagnostics,
    bundleStatus: input.bundleStatus,
  }
  return executionResult
}
