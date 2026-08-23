import { ArtifactValidationError } from './errors.ts';
import { ARTIFACT_TYPES, type ArtifactBase, type ArtifactType, type JsonObject, type JsonValue } from './types.ts';

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Returns whether a value can be represented without loss by JSON. */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueWithin(value, new WeakSet<object>());
}

function isJsonValueWithin(value: unknown, ancestors: WeakSet<object>): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
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

  ancestors.add(value);
  try {
    return Object.values(value).every((item) => isJsonValueWithin(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** Returns whether a value is a plain JSON object containing only JSON values. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) {
    return false;
  }

  return isJsonValue(value);
}

export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArtifactValidationError('expected a non-empty string', path);
  }
}

export function assertTimestamp(value: unknown, path: string): asserts value is string {
  if (!isIsoTimestamp(value)) {
    throw new ArtifactValidationError('expected an ISO 8601 timestamp', path);
  }
}

export function assertConfidence(value: unknown, path = '$.confidence'): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ArtifactValidationError('expected a number between 0 and 1', path);
  }
}

export function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ArtifactValidationError('expected an array of non-empty strings', path);
  }
}

/** Validates the common artifact envelope without resolving external references. */
export function validateArtifactBase<TType extends ArtifactType = ArtifactType>(
  value: unknown,
  expectedType?: TType,
): asserts value is ArtifactBase<TType> {
  if (!isPlainObject(value)) {
    throw new ArtifactValidationError('expected a plain object');
  }

  assertNonEmptyString(value.id, '$.id');

  if (!isArtifactType(value.type)) {
    throw new ArtifactValidationError('expected a supported artifact type', '$.type');
  }

  if (expectedType !== undefined && value.type !== expectedType) {
    throw new ArtifactValidationError(`expected artifact type ${expectedType}`, '$.type');
  }

  assertTimestamp(value.createdAt, '$.createdAt');
  assertNonEmptyString(value.sessionId, '$.sessionId');

  if (!isJsonObject(value.metadata)) {
    throw new ArtifactValidationError('expected a JSON object', '$.metadata');
  }
}
