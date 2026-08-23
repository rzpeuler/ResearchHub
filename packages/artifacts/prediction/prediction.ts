import {
  assertNonEmptyString,
  assertTimestamp,
  deserializeArtifact,
  isJsonObject,
  serializeArtifact,
  validateArtifactBase,
  ArtifactValidationError,
  type ArtifactBase,
  type JsonObject,
} from '../core/index.ts'

export type EvaluationPeriod = {
  start: string
  end: string
}

export type Prediction = ArtifactBase<'prediction'> & {
  thesisId: string
  expectation: string
  evaluationPeriod: EvaluationPeriod
  metrics: JsonObject
}

export type PredictionInput = Omit<Prediction, 'type'>

export function createPrediction(input: PredictionInput): Prediction {
  const candidate: unknown = {
    ...input,
    type: 'prediction',
  }

  validatePrediction(candidate)
  return {
    ...candidate,
    evaluationPeriod: { ...candidate.evaluationPeriod },
    metrics: { ...candidate.metrics },
    metadata: { ...candidate.metadata },
  }
}

export function validatePrediction(value: unknown): asserts value is Prediction {
  validateArtifactBase(value, 'prediction')
  const record = value as unknown as Record<string, unknown>

  assertNonEmptyString(record.thesisId, '$.thesisId')
  assertNonEmptyString(record.expectation, '$.expectation')
  validateEvaluationPeriod(record.evaluationPeriod)

  if (!isJsonObject(record.metrics)) {
    throw new ArtifactValidationError('expected a JSON object', '$.metrics')
  }
}

export function isPrediction(value: unknown): value is Prediction {
  try {
    validatePrediction(value)
    return true
  } catch {
    return false
  }
}

export function serializePrediction(prediction: Prediction): string {
  return serializeArtifact(prediction, validatePrediction)
}

export function deserializePrediction(serialized: string): Prediction {
  return deserializeArtifact(serialized, validatePrediction)
}

function validateEvaluationPeriod(value: unknown): asserts value is EvaluationPeriod {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactValidationError('expected an object', '$.evaluationPeriod')
  }

  const period = value as Record<string, unknown>
  assertTimestamp(period.start, '$.evaluationPeriod.start')
  assertTimestamp(period.end, '$.evaluationPeriod.end')

  if (Date.parse(period.start) > Date.parse(period.end)) {
    throw new ArtifactValidationError(
      'evaluation period start must not be after end',
      '$.evaluationPeriod',
    )
  }
}
