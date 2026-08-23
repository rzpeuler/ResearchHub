import { ArtifactValidationError } from './errors.ts';
import { ARTIFACT_TYPES, type ArtifactBase, type ArtifactType, type JsonObject, type JsonValue } from './types.ts';

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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
    return Number.isFinite(value) && !Object.is(value, -0);
  }

  if (Array.isArray(value)) {
    if (!hasSafeArrayProperties(value) || ancestors.has(value)) {
      return false;
    }

    ancestors.add(value);
    try {
      return value.every((item) => isJsonValueWithin(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }

  if (!isPlainObject(value) || !hasSafeObjectProperties(value) || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  try {
    return Object.keys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined &&
        'value' in descriptor &&
        isJsonValueWithin(descriptor.value, ancestors);
    });
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

/** Rejects enumerable properties outside a structure's declared field set. */
export function assertExactObjectKeys(
  value: object,
  allowedKeys: readonly string[],
  path = '$',
): void {
  const allowed = new Set(allowedKeys);
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unexpectedKey !== undefined) {
    const propertyPath = path === '$' ? `$.${unexpectedKey}` : `${path}.${unexpectedKey}`;
    throw new ArtifactValidationError('unexpected property', propertyPath);
  }
}

export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = getDaysInMonth(year, month);

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(value));
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

  if (!isJsonObject(value)) {
    throw new ArtifactValidationError('expected a plain JSON-safe object');
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

function hasSafeObjectProperties(value: Record<string, unknown>): boolean {
  if (hasInheritedToJson(value)) {
    return false;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      return false;
    }

    if (key === 'toJSON') {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return false;
    }
  }

  return true;
}

function hasSafeArrayProperties(value: unknown[]): boolean {
  if (hasInheritedToJson(value)) {
    return false;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      return false;
    }

    if (key === 'length') {
      continue;
    }

    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return false;
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
      return false;
    }
  }

  return true;
}

function hasInheritedToJson(value: object): boolean {
  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (Object.prototype.hasOwnProperty.call(prototype, 'toJSON')) {
      return true;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return false;
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
