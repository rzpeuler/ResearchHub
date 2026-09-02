import {
  ArtifactValidationError,
  assertExactObjectKeys,
  assertNonEmptyString,
  isJsonObject,
  isJsonValue,
  validateArtifactBase,
  type ArtifactBase,
  type JsonValue,
} from '../core/index.ts'
import { validateOutcome, type Outcome } from '../outcome/index.ts'

export type ReviewArtifactBase = ArtifactBase<'review'>

export type EvaluationStatus = 'met' | 'partially_met' | 'not_met' | 'inconclusive'

export type MetricEvaluation = {
  name: string
  expected: JsonValue
  actual: JsonValue
  matched: boolean
  tolerance?: number
}

/** Shape-compatible with the EvaluationSummary defined by the approved design. */
export type EvaluationSummary = {
  status: EvaluationStatus
  comparedMetricCount: number
  matchedMetricCount: number
  metrics: MetricEvaluation[]
}

export type Review = ArtifactBase<'review'> & {
  predictionId: string
  outcome: Outcome
  evaluation: EvaluationSummary
}

export type ReviewInput = Omit<Review, 'type'>

export function createReview(input: ReviewInput): Review {
  if (!isJsonObject(input)) {
    throw new ArtifactValidationError('review must be a plain JSON-safe object')
  }

  const candidate: unknown = {
    ...input,
    type: 'review',
  }

  validateReview(candidate)
  const review = candidate as Review

  return {
    ...review,
    metadata: { ...review.metadata },
    outcome: {
      ...review.outcome,
      metrics: { ...review.outcome.metrics },
    },
    evaluation: {
      ...review.evaluation,
      metrics: review.evaluation.metrics.map((metric) => ({ ...metric })),
    },
  }
}

export function validateReview(value: unknown): asserts value is Review {
  validateReviewArtifactBase(value)
  const record = value as unknown as Record<string, unknown>

  assertNonEmptyString(record.predictionId, '$.predictionId')

  try {
    validateOutcome(record.outcome)
  } catch (error) {
    throw prefixValidationError(error, '$.outcome')
  }

  validateEvaluationSummary(record.evaluation)
}

export function isReview(value: unknown): value is Review {
  try {
    validateReview(value)
    return true
  } catch {
    return false
  }
}

export function serializeReview(review: Review): string {
  validateReview(review)

  if (!isJsonObject(review)) {
    throw new ArtifactValidationError('review must be a plain JSON-safe object')
  }

  try {
    const serialized = JSON.stringify(review)
    if (serialized === undefined) {
      throw new ArtifactValidationError('review could not be serialized')
    }

    return serialized
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'review could not be serialized'
    throw new ArtifactValidationError(message)
  }
}

export function deserializeReview(serialized: string): Review {
  if (typeof serialized !== 'string') {
    throw new ArtifactValidationError('serialized review must be a string')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new ArtifactValidationError(`invalid JSON: ${message}`)
  }

  validateReview(parsed)
  return parsed
}

function validateReviewArtifactBase(value: unknown): asserts value is ReviewArtifactBase {
  validateArtifactBase(value, 'review')
  assertExactObjectKeys(value, [
    'id',
    'type',
    'createdAt',
    'sessionId',
    'metadata',
    'predictionId',
    'outcome',
    'evaluation',
  ])
}

function validateEvaluationSummary(value: unknown): asserts value is EvaluationSummary {
  if (!isPlainObject(value)) {
    throw new ArtifactValidationError('expected an object', '$.evaluation')
  }

  if (!isJsonObject(value)) {
    throw new ArtifactValidationError('expected a plain JSON-safe object', '$.evaluation')
  }

  assertExactObjectKeys(
    value,
    ['status', 'comparedMetricCount', 'matchedMetricCount', 'metrics'],
    '$.evaluation',
  )

  const record = value as Record<string, unknown>
  if (!isEvaluationStatus(record.status)) {
    throw new ArtifactValidationError('expected a supported evaluation status', '$.evaluation.status')
  }

  assertNonNegativeInteger(record.comparedMetricCount, '$.evaluation.comparedMetricCount')
  assertNonNegativeInteger(record.matchedMetricCount, '$.evaluation.matchedMetricCount')

  if (record.matchedMetricCount > record.comparedMetricCount) {
    throw new ArtifactValidationError(
      'matched metric count must not exceed compared metric count',
      '$.evaluation.matchedMetricCount',
    )
  }

  if (!Array.isArray(record.metrics)) {
    throw new ArtifactValidationError('expected an array', '$.evaluation.metrics')
  }

  if (!isJsonValue(record.metrics)) {
    throw new ArtifactValidationError('expected a dense JSON-safe array', '$.evaluation.metrics')
  }

  if (record.metrics.length !== record.comparedMetricCount) {
    throw new ArtifactValidationError(
      'metrics length must equal compared metric count',
      '$.evaluation.metrics',
    )
  }

  record.metrics.forEach((metric, index) => validateMetricEvaluation(metric, index))

  const matchedMetricCount = record.metrics.filter(
    (metric) => isPlainObject(metric) && metric.matched === true,
  ).length
  if (matchedMetricCount !== record.matchedMetricCount) {
    throw new ArtifactValidationError(
      'matched metric count must equal matched metrics',
      '$.evaluation.matchedMetricCount',
    )
  }

  const expectedStatus = deriveEvaluationStatus(record.comparedMetricCount, record.matchedMetricCount)
  if (record.status !== expectedStatus) {
    throw new ArtifactValidationError(
      `status must be ${expectedStatus} for the supplied metric counts`,
      '$.evaluation.status',
    )
  }
}

function validateMetricEvaluation(value: unknown, index: number): asserts value is MetricEvaluation {
  const path = `$.evaluation.metrics[${index}]`
  if (!isPlainObject(value)) {
    throw new ArtifactValidationError('expected an object', path)
  }

  if (!isJsonObject(value)) {
    throw new ArtifactValidationError('expected a plain JSON-safe object', path)
  }

  assertExactObjectKeys(value, ['name', 'expected', 'actual', 'matched', 'tolerance'], path)

  const metric = value as Record<string, unknown>
  assertNonEmptyString(metric.name, `${path}.name`)

  if (!isJsonValue(metric.expected)) {
    throw new ArtifactValidationError('expected a JSON value', `${path}.expected`)
  }

  if (!isJsonValue(metric.actual)) {
    throw new ArtifactValidationError('expected a JSON value', `${path}.actual`)
  }

  if (typeof metric.matched !== 'boolean') {
    throw new ArtifactValidationError('expected a boolean', `${path}.matched`)
  }

  if (metric.tolerance !== undefined &&
      (typeof metric.tolerance !== 'number' || !Number.isFinite(metric.tolerance) || metric.tolerance < 0)) {
    throw new ArtifactValidationError('expected a non-negative finite number', `${path}.tolerance`)
  }
}

function isEvaluationStatus(value: unknown): value is EvaluationStatus {
  return value === 'met' || value === 'partially_met' || value === 'not_met' || value === 'inconclusive'
}

function deriveEvaluationStatus(comparedMetricCount: number, matchedMetricCount: number): EvaluationStatus {
  if (comparedMetricCount === 0) {
    return 'inconclusive'
  }

  if (matchedMetricCount === comparedMetricCount) {
    return 'met'
  }

  if (matchedMetricCount === 0) {
    return 'not_met'
  }

  return 'partially_met'
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ArtifactValidationError('expected a non-negative integer', path)
  }
}

function prefixValidationError(error: unknown, prefix: string): ArtifactValidationError {
  if (error instanceof ArtifactValidationError) {
    const path = error.path === '$' ? prefix : `${prefix}${error.path.slice(1)}`
    return new ArtifactValidationError(error.message.replace(`${error.path}: `, ''), path)
  }

  return new ArtifactValidationError('invalid nested value', prefix)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
