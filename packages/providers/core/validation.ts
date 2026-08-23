import { ProviderValidationError } from './errors.ts'
import { FINANCIAL_DATA_QUALITIES, type DataProvider, type FinancialDataMetadata, type FinancialDataQuality, type JsonObject, type JsonValue, type ProviderResult } from './types.ts'

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function hasUnsafeSerializationProperties(value: object): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return true
  }

  let prototype = Object.getPrototypeOf(value)
  while (prototype !== null) {
    if (Object.prototype.hasOwnProperty.call(prototype, 'toJSON')) {
      return true
    }
    prototype = Object.getPrototypeOf(prototype)
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') {
      continue
    }

    if (Array.isArray(value)) {
      const index = Number(key)
      const isArrayIndex = Number.isInteger(index)
        && index >= 0
        && index < 2 ** 32 - 1
        && String(index) === key
      if (!isArrayIndex) {
        return true
      }
    }

    if (!descriptor.enumerable || 'get' in descriptor || 'set' in descriptor || key === 'toJSON') {
      return true
    }
  }

  return false
}

function isJsonValueWithin(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    if (hasUnsafeSerializationProperties(value) || ancestors.has(value)) {
      return false
    }

    ancestors.add(value)
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, String(index)) || !isJsonValueWithin(value[index], ancestors)) {
          return false
        }
      }
      return true
    } finally {
      ancestors.delete(value)
    }
  }

  if (!isPlainObject(value) || ancestors.has(value)) {
    return false
  }

  if (hasUnsafeSerializationProperties(value)) {
    return false
  }

  ancestors.add(value)
  try {
    return Object.keys(value).every((key) => isJsonValueWithin(value[key], ancestors))
  } finally {
    ancestors.delete(value)
  }
}

/** Returns whether a value can cross a JSON serialization boundary safely. */
export function isJsonValue(value: unknown): value is JsonValue {
  try {
    return isJsonValueWithin(value, new WeakSet<object>())
  } catch {
    return false
  }
}

/** Returns whether a value is a JSON-safe object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value)
}

/** Returns whether a value is a valid ISO 8601 timestamp with an explicit timezone. */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (match === null || Number.isNaN(Date.parse(value))) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day
}

export function isFinancialDataQuality(value: unknown): value is FinancialDataQuality {
  return typeof value === 'string' && (FINANCIAL_DATA_QUALITIES as readonly string[]).includes(value)
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderValidationError('expected a non-empty string', path)
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  if (!isIsoTimestamp(value)) {
    throw new ProviderValidationError('expected an ISO 8601 timestamp', path)
  }
}

function assertQuality(value: unknown, path: string): asserts value is FinancialDataQuality {
  if (!isFinancialDataQuality(value)) {
    throw new ProviderValidationError('expected one of: high, medium, low', path)
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProviderValidationError('expected a finite number between 0 and 1', path)
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new ProviderValidationError(`unknown field: ${key}`, `$.${key}`)
    }
  }
}

/** Validates the metadata attached to a Provider result. */
export function validateFinancialDataMetadata(value: unknown): asserts value is FinancialDataMetadata {
  if (!isPlainObject(value)) {
    throw new ProviderValidationError('expected a plain object')
  }

  if (!isJsonObject(value)) {
    throw new ProviderValidationError('expected a JSON-safe object')
  }

  assertAllowedFields(value, new Set(['source', 'timestamp', 'quality', 'confidence']))
  if (!Object.prototype.hasOwnProperty.call(value, 'source')) {
    throw new ProviderValidationError('missing required field', '$.source')
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'timestamp')) {
    throw new ProviderValidationError('missing required field', '$.timestamp')
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'quality')) {
    throw new ProviderValidationError('missing required field', '$.quality')
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'confidence')) {
    throw new ProviderValidationError('missing required field', '$.confidence')
  }

  assertNonEmptyString(value.source, '$.source')
  assertTimestamp(value.timestamp, '$.timestamp')
  assertQuality(value.quality, '$.quality')
  assertConfidence(value.confidence, '$.confidence')
}

/** Validates the JSON-safe envelope returned by a DataProvider. */
export function validateProviderResult(value: unknown): asserts value is ProviderResult<JsonValue> {
  if (!isPlainObject(value)) {
    throw new ProviderValidationError('expected a plain object')
  }

  if (!isJsonObject(value)) {
    throw new ProviderValidationError('expected a JSON-safe object')
  }

  assertAllowedFields(value, new Set(['data', 'metadata']))
  if (!Object.prototype.hasOwnProperty.call(value, 'data')) {
    throw new ProviderValidationError('missing required field', '$.data')
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'metadata')) {
    throw new ProviderValidationError('missing required field', '$.metadata')
  }

  validateFinancialDataMetadata(value.metadata)
}

/** Validates the callable shape and stable name of a Provider before registration. */
export interface DataProviderInspection {
  readonly provider: DataProvider<unknown, unknown>
  readonly name: string
  readonly fetch: DataProvider<unknown, unknown>['fetch']
  readonly validate: DataProvider<unknown, unknown>['validate']
}

/** Reads and validates a Provider's callable boundary exactly once. */
export function inspectDataProvider(value: unknown): DataProviderInspection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderValidationError('expected a Provider object')
  }

  let name: unknown
  let fetch: unknown
  let validate: unknown
  try {
    const provider = value as Record<string, unknown>
    name = provider.name
    fetch = provider.fetch
    validate = provider.validate
  } catch {
    throw new ProviderValidationError('Provider properties could not be read')
  }

  assertNonEmptyString(name, '$.name')
  if (typeof fetch !== 'function') {
    throw new ProviderValidationError('expected a fetch function', '$.fetch')
  }
  if (typeof validate !== 'function') {
    throw new ProviderValidationError('expected a validate function', '$.validate')
  }

  return {
    provider: value as DataProvider<unknown, unknown>,
    name,
    fetch: fetch as DataProvider<unknown, unknown>['fetch'],
    validate: validate as DataProvider<unknown, unknown>['validate'],
  }
}

export function validateDataProvider(value: unknown): asserts value is DataProvider<unknown, unknown> {
  inspectDataProvider(value)
}

/** Validates a Provider name used by Registry operations. */
export function assertProviderName(value: unknown, path = '$.name'): asserts value is string {
  assertNonEmptyString(value, path)
}
