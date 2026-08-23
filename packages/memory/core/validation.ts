import { MemoryValidationError } from './errors.ts';
import { MEMORY_ENTRY_TYPES, type JsonObject, type JsonValue, type MemoryEntry, type MemoryEntryPatch, type MemoryEntryType, type MemoryQuery } from './types.ts';

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnsafeSerializationProperties(value: object): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return true;
  }

  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (Object.prototype.hasOwnProperty.call(prototype, 'toJSON')) {
      return true;
    }
    prototype = Object.getPrototypeOf(prototype);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') {
      continue;
    }

    if (Array.isArray(value)) {
      const index = Number(key);
      const isArrayIndex = Number.isInteger(index)
        && index >= 0
        && index < 2 ** 32 - 1
        && String(index) === key;
      if (!isArrayIndex) {
        return true;
      }
    }

    if (!descriptor.enumerable || 'get' in descriptor || 'set' in descriptor || key === 'toJSON') {
      return true;
    }
  }

  return false;
}

function isJsonValueWithin(value: unknown, ancestors: WeakSet<object>): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (hasUnsafeSerializationProperties(value)) {
      return false;
    }

    if (ancestors.has(value)) {
      return false;
    }

    ancestors.add(value);
    try {
      return value.every((item) => isJsonValueWithin(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }

  if (!isPlainObject(value) || ancestors.has(value)) {
    return false;
  }

  if (hasUnsafeSerializationProperties(value)) {
    return false;
  }

  ancestors.add(value);
  try {
    return Object.values(value).every((item) => isJsonValueWithin(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  try {
    return isJsonValueWithin(value, new WeakSet<object>());
  } catch {
    return false;
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}

export function isMemoryEntryType(value: unknown): value is MemoryEntryType {
  return typeof value === 'string' && (MEMORY_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MemoryValidationError('expected a non-empty string', path);
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  if (!isIsoTimestamp(value)) {
    throw new MemoryValidationError('expected an ISO 8601 timestamp', path);
  }
}

function assertMemoryType(value: unknown, path: string): asserts value is MemoryEntryType {
  if (!isMemoryEntryType(value)) {
    throw new MemoryValidationError('expected a supported memory entry type', path);
  }
}

/** Validates the complete persisted Memory Entry shape. */
export function validateMemoryEntry(value: unknown): asserts value is MemoryEntry {
  if (!isPlainObject(value)) {
    throw new MemoryValidationError('expected a plain object');
  }

  if (!isJsonObject(value)) {
    throw new MemoryValidationError('expected a JSON-safe object');
  }

  const allowedFields = new Set(['id', 'type', 'content', 'sourceArtifactId', 'createdAt', 'metadata']);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new MemoryValidationError(`unknown field: ${key}`, `$.${key}`);
    }
  }

  assertNonEmptyString(value.id, '$.id');
  assertMemoryType(value.type, '$.type');
  assertNonEmptyString(value.content, '$.content');
  assertNonEmptyString(value.sourceArtifactId, '$.sourceArtifactId');
  assertTimestamp(value.createdAt, '$.createdAt');

  if (!isJsonObject(value.metadata)) {
    throw new MemoryValidationError('expected a JSON object', '$.metadata');
  }

  if (Object.prototype.hasOwnProperty.call(value.metadata, 'sessionId')) {
    assertNonEmptyString(value.metadata.sessionId, '$.metadata.sessionId');
  }
}

/** Validates an exact-match retrieval query. */
export function validateMemoryQuery(value: unknown): asserts value is MemoryQuery {
  if (!isPlainObject(value)) {
    throw new MemoryValidationError('expected a plain object');
  }

  if (!isJsonObject(value)) {
    throw new MemoryValidationError('expected a JSON-safe object');
  }

  const allowedFields = new Set(['id', 'type', 'sourceArtifactId', 'sessionId']);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new MemoryValidationError(`unknown field: ${key}`, `$.${key}`);
    }
  }

  for (const key of ['id', 'sourceArtifactId', 'sessionId'] as const) {
    if (key in value) {
      assertNonEmptyString(value[key], `$.${key}`);
    }
  }

  if ('type' in value) {
    assertMemoryType(value.type, '$.type');
  }
}

/** Validates only fields that may be changed by update(). */
export function validateMemoryEntryPatch(value: unknown): asserts value is MemoryEntryPatch {
  if (!isPlainObject(value)) {
    throw new MemoryValidationError('expected a plain object');
  }

  if (!isJsonObject(value)) {
    throw new MemoryValidationError('expected a JSON-safe object');
  }

  for (const key of Object.keys(value)) {
    if (key !== 'content' && key !== 'metadata') {
      throw new MemoryValidationError(`field cannot be updated: ${key}`, `$.${key}`);
    }
  }

  if ('content' in value) {
    assertNonEmptyString(value.content, '$.content');
  }

  if ('metadata' in value && !isJsonObject(value.metadata)) {
    throw new MemoryValidationError('expected a JSON object', '$.metadata');
  }
}

export function assertMemoryId(value: unknown, path = '$.id'): asserts value is string {
  assertNonEmptyString(value, path);
}
