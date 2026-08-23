import {
  ArtifactValidationError,
  assertExactObjectKeys,
  assertNonEmptyString,
  assertTimestamp,
  isJsonObject,
  type JsonObject,
} from '../../artifacts/core/index.ts'

/** A caller-supplied, observed result suitable for deterministic evaluation. */
export type Outcome = {
  description: string
  timestamp: string
  source: string
  metrics: JsonObject
}

export type OutcomeInput = Outcome

export function createOutcome(input: OutcomeInput): Outcome {
  if (!isJsonObject(input)) {
    throw new ArtifactValidationError('outcome must be a plain JSON-safe object')
  }

  const candidate: unknown = { ...input }

  validateOutcome(candidate)
  return {
    ...candidate,
    metrics: { ...candidate.metrics },
  }
}

export function validateOutcome(value: unknown): asserts value is Outcome {
  if (!isPlainObject(value)) {
    throw new ArtifactValidationError('expected a plain object')
  }

  if (!isJsonObject(value)) {
    throw new ArtifactValidationError('expected a plain JSON-safe object')
  }

  assertExactObjectKeys(value, ['description', 'timestamp', 'source', 'metrics'])

  const record = value as Record<string, unknown>
  assertNonEmptyString(record.description, '$.description')
  assertTimestamp(record.timestamp, '$.timestamp')
  assertNonEmptyString(record.source, '$.source')

  if (!isJsonObject(record.metrics)) {
    throw new ArtifactValidationError('expected a JSON object', '$.metrics')
  }
}

export function isOutcome(value: unknown): value is Outcome {
  try {
    validateOutcome(value)
    return true
  } catch {
    return false
  }
}

export function serializeOutcome(outcome: Outcome): string {
  validateOutcome(outcome)

  if (!isJsonObject(outcome)) {
    throw new ArtifactValidationError('outcome must be a plain JSON-safe object')
  }

  try {
    const serialized = JSON.stringify(outcome)
    if (serialized === undefined) {
      throw new ArtifactValidationError('outcome could not be serialized')
    }

    return serialized
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'outcome could not be serialized'
    throw new ArtifactValidationError(message)
  }
}

export function deserializeOutcome(serialized: string): Outcome {
  if (typeof serialized !== 'string') {
    throw new ArtifactValidationError('serialized outcome must be a string')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new ArtifactValidationError(`invalid JSON: ${message}`)
  }

  validateOutcome(parsed)
  return parsed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
