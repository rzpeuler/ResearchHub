import { MemoryValidationError } from '../core/errors.ts'
import { isJsonObject, isJsonValue, isIsoTimestamp } from '../core/validation.ts'
import { MEMORY_ITEM_TYPES, type MemoryItem, type MemoryItemType, type MemoryTraceReference } from './memory-item.ts'

const FORBIDDEN_KEYS = new Set([
  'prompt',
  'token',
  'tokens',
  'modelreasoning',
  'reasoning',
  'chainofthought',
  'runtime',
  'runtimelog',
])

export function isMemoryItemType(value: unknown): value is MemoryItemType {
  return typeof value === 'string' && (MEMORY_ITEM_TYPES as readonly string[]).includes(value)
}

export function validateMemoryItem(value: unknown): asserts value is MemoryItem {
  if (!isJsonObject(value)) throw new MemoryValidationError('expected a JSON-safe object')

  const allowedFields = new Set([
    'id',
    'type',
    'content',
    'sourceArtifacts',
    'traceReferences',
    'entity',
    'topic',
    'industry',
    'confidence',
    'createdAt',
    'metadata',
  ])
  assertAllowedFields(value, allowedFields, '$')
  assertNoForbiddenKeys(value, '$')
  assertNonEmptyString(value.id, '$.id')
  if (!isMemoryItemType(value.type)) throw new MemoryValidationError('unsupported MemoryItem type', '$.type')
  if (!isJsonObject(value.content)) throw new MemoryValidationError('expected a JSON object', '$.content')
  if (!Array.isArray(value.sourceArtifacts) || value.sourceArtifacts.length === 0) {
    throw new MemoryValidationError('expected at least one source Artifact reference', '$.sourceArtifacts')
  }
  value.sourceArtifacts.forEach((reference, index) => validateArtifactReference(reference, `$.sourceArtifacts[${index}]`))
  if (!Array.isArray(value.traceReferences)) {
    throw new MemoryValidationError('expected an array', '$.traceReferences')
  }
  value.traceReferences.forEach((reference, index) => validateMemoryTraceReference(reference, `$.traceReferences[${index}]`))
  for (const key of ['entity', 'topic', 'industry'] as const) {
    if (value[key] !== undefined) assertNonEmptyString(value[key], `$.${key}`)
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new MemoryValidationError('expected a number between 0 and 1', '$.confidence')
  }
  if (!isIsoTimestamp(value.createdAt)) throw new MemoryValidationError('expected an ISO 8601 timestamp', '$.createdAt')
  if (!isJsonObject(value.metadata)) throw new MemoryValidationError('expected a JSON object', '$.metadata')
}

export function cloneMemoryItem(item: MemoryItem): MemoryItem {
  validateMemoryItem(item)
  return JSON.parse(JSON.stringify(item)) as MemoryItem
}

export function validateMemoryTraceReference(value: unknown, path = '$'): asserts value is MemoryTraceReference {
  if (typeof value === 'string') {
    assertNonEmptyString(value, path)
    return
  }
  if (!isJsonObject(value)) throw new MemoryValidationError('expected a JSON-safe object', path)
  assertAllowedFields(value, new Set(['eventId', 'rootArtifactId']), path)
  assertNonEmptyString(value.eventId, `${path}.eventId`)
  assertNonEmptyString(value.rootArtifactId, `${path}.rootArtifactId`)
}

function validateArtifactReference(value: unknown, path: string): void {
  if (!isJsonObject(value)) throw new MemoryValidationError('expected a JSON-safe object', path)
  assertAllowedFields(value, new Set(['artifactId', 'artifactType', 'version']), path)
  assertNonEmptyString(value.artifactId, `${path}.artifactId`)
  assertNonEmptyString(value.artifactType, `${path}.artifactType`)
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    throw new MemoryValidationError('expected a positive integer', `${path}.version`)
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) throw new MemoryValidationError(`unknown field: ${key}`, `${path}.${key}`)
  }
}

function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (!isJsonValue(value)) throw new MemoryValidationError('value is not JSON-safe', path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
        throw new MemoryValidationError(`forbidden field: ${key}`, `${path}.${key}`)
      }
      assertNoForbiddenKeys(item, `${path}.${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MemoryValidationError('expected a non-empty string', path)
  }
}
