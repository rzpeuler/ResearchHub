import { isEvidence, isPrediction, isThesis } from '../../artifacts/index.ts'
import type { WorkflowRegistry } from '../../workflows/index.ts'
import type {
  ResearchArtifactBundle,
  ResearchExecutionContext,
  ResearchExecutionResult,
  ResearchReportIdFactory,
  ResearchRequest,
  ResearchWorkflowExecutor,
} from './types.ts'
import { ResearchManagerValidationError } from './errors.ts'

export interface ResearchManagerOptions {
  readonly reportIdFactory?: ResearchReportIdFactory
}

/** Coordinates an approved Workflow definition without implementing a runtime or scheduler. */
export class ResearchManager {
  private readonly reportIdFactory: ResearchReportIdFactory

  constructor(
    private readonly workflows: WorkflowRegistry,
    private readonly executors: ReadonlyMap<string, ResearchWorkflowExecutor>,
    options: ResearchManagerOptions = {},
  ) {
    this.reportIdFactory = options.reportIdFactory ?? ((context) => `report:${context.workflow.id}:${context.request.sessionId}`)
  }

  async execute(request: ResearchRequest): Promise<ResearchExecutionResult> {
    const normalizedRequest = normalizeResearchRequest(request)
    const workflow = this.workflows.get(normalizedRequest.workflowId)
    const executor = this.executors.get(workflow.id)
    if (executor === undefined) throw new ResearchManagerValidationError(`no executor registered for workflow: ${workflow.id}`)

    const context: ResearchExecutionContext = Object.freeze({
      request: Object.freeze(normalizedRequest),
      workflow,
    })
    const artifacts = await executor.execute(context)
    validateArtifactBundle(artifacts, normalizedRequest)
    const report = createReport(context, artifacts, this.reportIdFactory(context))
    return { status: 'completed', workflowId: workflow.id, sessionId: normalizedRequest.sessionId, artifacts, report }
  }
}

function normalizeResearchRequest(value: ResearchRequest): ResearchRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResearchManagerValidationError('research request must be an object')
  }
  const request = value as unknown as Record<string, unknown>
  assertNonEmptyString(request.workflowId, '$.workflowId')
  assertSymbol(request.symbol, '$.symbol')
  assertNonEmptyString(request.question, '$.question')
  assertNonEmptyString(request.sessionId, '$.sessionId')
  assertTimestamp(request.createdAt, '$.createdAt')
  const evaluationPeriod = request.evaluationPeriod
  if (evaluationPeriod === null || typeof evaluationPeriod !== 'object' || Array.isArray(evaluationPeriod)) {
    throw new ResearchManagerValidationError('evaluationPeriod must be an object', '$.evaluationPeriod')
  }
  const period = evaluationPeriod as Record<string, unknown>
  assertTimestamp(period.start, '$.evaluationPeriod.start')
  assertTimestamp(period.end, '$.evaluationPeriod.end')
  if (Date.parse(period.start) > Date.parse(period.end)) {
    throw new ResearchManagerValidationError('evaluation period start must not be after end', '$.evaluationPeriod')
  }
  return {
    workflowId: request.workflowId.trim(),
    symbol: request.symbol.trim().toUpperCase(),
    question: request.question.trim(),
    sessionId: request.sessionId.trim(),
    createdAt: request.createdAt,
    evaluationPeriod: { start: period.start, end: period.end },
  }
}

function validateArtifactBundle(value: ResearchArtifactBundle, request: ResearchRequest): void {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.evidence) || !isThesis(value.thesis) || !isPrediction(value.prediction)) {
    throw new ResearchManagerValidationError('workflow executor returned an invalid Artifact bundle')
  }
  if (!isEvidence(value.evidence[0]) && value.evidence.length > 0) {
    throw new ResearchManagerValidationError('workflow executor returned invalid Evidence')
  }
  if (value.evidence.some(item => !isEvidence(item))) {
    throw new ResearchManagerValidationError('workflow executor returned invalid Evidence')
  }
  if (value.thesis.sessionId !== request.sessionId || value.prediction.sessionId !== request.sessionId) {
    throw new ResearchManagerValidationError('workflow Artifacts must use the request Session ID')
  }
  if (value.thesis.evidenceIds.some(id => !value.evidence.some(item => item.id === id))) {
    throw new ResearchManagerValidationError('Thesis references an Evidence ID outside the result bundle')
  }
  if (value.prediction.thesisId !== value.thesis.id) {
    throw new ResearchManagerValidationError('Prediction must reference the result Thesis')
  }
}

function createReport(context: ResearchExecutionContext, artifacts: ResearchArtifactBundle, id: string) {
  assertNonEmptyString(id, '$.report.id')
  return {
    id,
    workflowId: context.workflow.id,
    question: context.request.question,
    sessionId: context.request.sessionId,
    createdAt: context.request.createdAt,
    evidenceIds: artifacts.evidence.map(item => item.id),
    thesisIds: [artifacts.thesis.id],
    predictionIds: [artifacts.prediction.id],
    metadata: { symbol: context.request.symbol, workflowVersion: context.workflow.version },
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ResearchManagerValidationError('expected a non-empty string', path)
}

function assertSymbol(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) throw new ResearchManagerValidationError('expected a six-digit A-share symbol', path)
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path)
  if (!value.includes('T') || Number.isNaN(Date.parse(value))) throw new ResearchManagerValidationError('expected an ISO timestamp', path)
}
