import { MemoryValidationError } from '../core/errors.ts'
import { isJsonObject } from '../core/validation.ts'
import { isMemoryItemType } from '../models/index.ts'
import type { ResearchMemoryQuery } from './research-memory.ts'

export function validateResearchMemoryQuery(value: unknown): asserts value is ResearchMemoryQuery {
  if (!isJsonObject(value)) throw new MemoryValidationError('expected a JSON-safe object')
  const allowedFields = new Set(['entity', 'topic', 'industry', 'type', 'artifactId', 'confidence', 'minConfidence', 'limit'])
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) throw new MemoryValidationError(`unknown field: ${key}`, `$.${key}`)
  }
  for (const key of ['entity', 'topic', 'industry', 'artifactId'] as const) {
    if (value[key] !== undefined) assertNonEmptyString(value[key], `$.${key}`)
  }
  if (value.type !== undefined && !isMemoryItemType(value.type)) {
    throw new MemoryValidationError('unsupported MemoryItem type', '$.type')
  }
  if (value.confidence !== undefined) assertConfidence(value.confidence, '$.confidence')
  if (value.minConfidence !== undefined) assertConfidence(value.minConfidence, '$.minConfidence')
  if (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1)) {
    throw new MemoryValidationError('expected a positive integer', '$.limit')
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryValidationError('expected a number between 0 and 1', path)
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MemoryValidationError('expected a non-empty string', path)
  }
}
