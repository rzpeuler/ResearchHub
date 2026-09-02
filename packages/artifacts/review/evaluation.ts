import {
  createReview,
  type EvaluationSummary,
  type MetricEvaluation,
  type Review,
} from './review.ts'
import {
  assertNonEmptyString,
  assertTimestamp,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from '../core/index.ts'
import { validatePrediction, type Prediction } from '../prediction/index.ts'
import { validateOutcome, type Outcome } from '../outcome/index.ts'
import type { EvaluationEngineOptions, ReviewClock, ReviewIdFactory } from './evaluation-types.ts'

const DEFAULT_TOLERANCE = 0

/**
 * Compares a Prediction with an Outcome and returns a new, validated Review.
 * The default identity and clock are deterministic functions of the inputs;
 * callers can inject alternatives when a distinct review identity is needed.
 */
export function evaluatePrediction(
  prediction: Prediction,
  outcome: Outcome,
  options: EvaluationEngineOptions = {},
): Review {
  validatePrediction(prediction)
  validateOutcome(outcome)
  validateMetricKeys(prediction.metrics, '$.prediction.metrics')
  validateMetricKeys(outcome.metrics, '$.outcome.metrics')

  const normalizedOptions = validateOptions(options)
  const evaluation = compareMetrics(prediction, outcome, normalizedOptions.numericTolerance)
  const id = normalizedOptions.idFactory(clonePrediction(prediction), cloneOutcome(outcome))
  const createdAt = normalizedOptions.clock(clonePrediction(prediction), cloneOutcome(outcome))

  assertNonEmptyString(id, '$.options.idFactory')
  assertTimestamp(createdAt, '$.options.clock')

  return createReview({
    id,
    createdAt,
    sessionId: prediction.sessionId,
    metadata: cloneJsonObject(normalizedOptions.metadata),
    predictionId: prediction.id,
    outcome: {
      description: outcome.description,
      timestamp: outcome.timestamp,
      source: outcome.source,
      metrics: cloneJsonObject(outcome.metrics),
    },
    evaluation,
  })
}

export function compareMetrics(
  prediction: Prediction,
  outcome: Outcome,
  numericTolerance = DEFAULT_TOLERANCE,
): EvaluationSummary {
  validatePrediction(prediction)
  validateOutcome(outcome)
  validateMetricKeys(prediction.metrics, '$.prediction.metrics')
  validateMetricKeys(outcome.metrics, '$.outcome.metrics')
  validateNumericTolerance(numericTolerance)

  const metrics: MetricEvaluation[] = []

  for (const name of Object.keys(prediction.metrics)) {
    if (!Object.prototype.hasOwnProperty.call(outcome.metrics, name)) {
      continue
    }

    const expected = prediction.metrics[name]
    const actual = outcome.metrics[name]
    const numericComparison = typeof expected === 'number' && typeof actual === 'number'
    const metric: MetricEvaluation = {
      name,
      expected: cloneJsonValue(expected),
      actual: cloneJsonValue(actual),
      matched: numericComparison
        ? Math.abs(actual - expected) <= numericTolerance
        : deepEqualJson(expected, actual),
    }

    if (numericComparison) {
      metric.tolerance = numericTolerance
    }

    metrics.push(metric)
  }

  const matchedMetricCount = metrics.filter((metric) => metric.matched).length
  return {
    status: deriveStatus(metrics.length, matchedMetricCount),
    comparedMetricCount: metrics.length,
    matchedMetricCount,
    metrics,
  }
}

type ValidatedOptions = {
  numericTolerance: number
  idFactory: ReviewIdFactory
  clock: ReviewClock
  metadata: JsonObject
}

function validateOptions(options: EvaluationEngineOptions): ValidatedOptions {
  if (!isPlainObject(options)) {
    throw new TypeError('evaluation options must be an object')
  }

  const numericTolerance = options.numericTolerance === undefined
    ? DEFAULT_TOLERANCE
    : options.numericTolerance
  validateNumericTolerance(numericTolerance)

  const idFactory = options.idFactory === undefined ? defaultIdFactory : options.idFactory
  if (typeof idFactory !== 'function') {
    throw new TypeError('evaluation options idFactory must be a function')
  }

  const clock = options.clock === undefined ? defaultClock : options.clock
  if (typeof clock !== 'function') {
    throw new TypeError('evaluation options clock must be a function')
  }

  const metadata = options.metadata === undefined ? {} : options.metadata
  if (!isJsonObject(metadata)) {
    throw new TypeError('evaluation options metadata must be a JSON object')
  }

  return { numericTolerance, idFactory, clock, metadata }
}

function validateMetricKeys(metrics: JsonObject, path: string): void {
  for (const key of Object.keys(metrics)) {
    if (key.trim().length === 0) {
      throw new TypeError(`${path} contains an invalid metric key`)
    }
  }
}

function validateNumericTolerance(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('numericTolerance must be a non-negative finite number')
  }
}

function defaultIdFactory(prediction: Prediction, outcome: Outcome): string {
  return `review:${prediction.id}:${outcome.timestamp}`
}

function defaultClock(_prediction: Prediction, outcome: Outcome): string {
  return outcome.timestamp
}

function deriveStatus(comparedMetricCount: number, matchedMetricCount: number): EvaluationSummary['status'] {
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

function deepEqualJson(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }

    return left.every((item, index) => deepEqualJson(item, right[index]))
  }

  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) {
      return false
    }

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }

    return leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqualJson(left[key], right[key]),
    )
  }

  return false
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject
}

function clonePrediction(prediction: Prediction): Prediction {
  return {
    ...prediction,
    evaluationPeriod: { ...prediction.evaluationPeriod },
    metrics: cloneJsonObject(prediction.metrics),
    metadata: cloneJsonObject(prediction.metadata),
  }
}

function cloneOutcome(outcome: Outcome): Outcome {
  return {
    ...outcome,
    metrics: cloneJsonObject(outcome.metrics),
  }
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
  }

  return value
}

function isPlainObject(value: unknown): value is EvaluationEngineOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
