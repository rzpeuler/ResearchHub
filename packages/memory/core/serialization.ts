import { MemoryValidationError } from './errors.ts';
import { isJsonValue, validateMemoryEntry, validateMemoryEntryPatch, validateMemoryQuery } from './validation.ts';
import type { MemoryEntry, MemoryEntryPatch, MemoryQuery } from './types.ts';

function stringifyJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'value could not be serialized';
    throw new MemoryValidationError(`value could not be serialized: ${message}`);
  }

  if (typeof serialized !== 'string') {
    throw new MemoryValidationError('value could not be serialized to a JSON string');
  }

  return serialized;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(stringifyJson(value)) as T;
}

export function cloneMemoryEntry(entry: MemoryEntry): MemoryEntry {
  validateMemoryEntry(entry);
  return cloneJson(entry);
}

export function cloneMemoryQuery(query: MemoryQuery): MemoryQuery {
  validateMemoryQuery(query);
  return cloneJson(query);
}

export function cloneMemoryEntryPatch(patch: MemoryEntryPatch): MemoryEntryPatch {
  validateMemoryEntryPatch(patch);
  return cloneJson(patch);
}

export function serializeMemoryEntries(entries: readonly MemoryEntry[]): string {
  if (!Array.isArray(entries)) {
    throw new MemoryValidationError('expected an array of Memory Entries');
  }

  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    try {
      validateMemoryEntry(entry);
    } catch (error) {
      if (error instanceof MemoryValidationError) {
        throw new MemoryValidationError(error.message, `$.${index}${error.path === '$' ? '' : error.path.slice(1)}`);
      }
      throw error;
    }

    if (ids.has(entry.id)) {
      throw new MemoryValidationError(`duplicate memory entry ID: ${entry.id}`, `$.${index}.id`);
    }
    ids.add(entry.id);
  }

  if (!isJsonValue(entries)) {
    throw new MemoryValidationError('entries contain values unsafe for JSON serialization');
  }

  return `${stringifyJson(entries)}\n`;
}

export function deserializeMemoryEntries(serialized: string): MemoryEntry[] {
  if (typeof serialized !== 'string') {
    throw new MemoryValidationError('serialized memory must be a string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    throw new MemoryValidationError(`invalid JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new MemoryValidationError('expected a JSON array');
  }

  const entries = parsed.map((entry, index) => {
    try {
      validateMemoryEntry(entry);
      return cloneMemoryEntry(entry);
    } catch (error) {
      if (error instanceof MemoryValidationError) {
        throw new MemoryValidationError(error.message, `$.${index}${error.path === '$' ? '' : error.path.slice(1)}`);
      }
      throw error;
    }
  });

  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (ids.has(entry.id)) {
      throw new MemoryValidationError(`duplicate memory entry ID: ${entry.id}`, `$.${index}.id`);
    }
    ids.add(entry.id);
  }

  return entries;
}
