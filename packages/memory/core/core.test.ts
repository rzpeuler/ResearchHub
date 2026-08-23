import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryValidationError } from './errors.ts';
import { cloneMemoryEntry, cloneMemoryEntryPatch, deserializeMemoryEntries, serializeMemoryEntries } from './serialization.ts';
import { isIsoTimestamp, isJsonObject, isJsonValue, validateMemoryEntry, validateMemoryEntryPatch, validateMemoryQuery } from './validation.ts';
import type { MemoryEntry } from './types.ts';

const entry: MemoryEntry = {
  id: 'memory:thesis:thesis-001',
  type: 'thesis',
  content: '{"statement":"Revenue growth supports the thesis."}',
  sourceArtifactId: 'thesis-001',
  createdAt: '2026-08-23T10:00:00.000Z',
  metadata: { sessionId: 'session-001', artifactType: 'thesis' },
};

const reviewEntry: MemoryEntry = {
  id: 'memory:review:review-001',
  type: 'review',
  content: '{"type":"review","id":"review-001"}',
  sourceArtifactId: 'review-001',
  createdAt: '2026-08-23T10:01:00.000Z',
  metadata: { sessionId: 'session-001', artifactType: 'review' },
};

test('validates and round-trips a Memory Entry', () => {
  validateMemoryEntry(entry);
  const restored = deserializeMemoryEntries(serializeMemoryEntries([entry]));

  assert.deepEqual(restored, [entry]);
  assert.notStrictEqual(restored[0], entry);
  assert.notStrictEqual(restored[0]?.metadata, entry.metadata);
});

test('accepts review Memory Entry types and queries', () => {
  validateMemoryEntry(reviewEntry);
  validateMemoryQuery({ type: 'review' });

  const restored = deserializeMemoryEntries(serializeMemoryEntries([reviewEntry]));
  assert.deepEqual(restored, [reviewEntry]);
});

test('rejects invalid entry fields and duplicate IDs', () => {
  assert.throws(
    () => validateMemoryEntry({ ...entry, confidence: 0.8 }),
    MemoryValidationError,
  );
  assert.throws(
    () => validateMemoryEntry({ ...entry, createdAt: 'not-a-timestamp' }),
    MemoryValidationError,
  );
  assert.throws(
    () => serializeMemoryEntries([entry, entry]),
    MemoryValidationError,
  );
});

test('rejects unknown MemoryQuery fields', () => {
  assert.throws(
    () => validateMemoryQuery({ type: 'thesis', unexpected: 'value' } as never),
    MemoryValidationError,
  );
});

test('rejects impossible calendar dates and empty metadata session IDs', () => {
  assert.equal(isIsoTimestamp('2026-02-30T10:00:00.000Z'), false);
  assert.equal(isIsoTimestamp('2026-02-28T10:00:00.000Z'), true);
  assert.throws(
    () => validateMemoryEntry({ ...entry, metadata: { sessionId: ' ' } }),
    MemoryValidationError,
  );
});

test('rejects values with unsafe JSON serialization hooks', () => {
  const entries = [entry] as MemoryEntry[] & { toJSON?: () => undefined };
  Object.defineProperty(entries, 'toJSON', { value: () => undefined });

  assert.throws(
    () => serializeMemoryEntries(entries),
    MemoryValidationError,
  );
});

test('rejects inherited Object.prototype toJSON hooks consistently and restores the prototype', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');

  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      enumerable: false,
      value: () => ({ spoofed: true }),
      writable: true,
    });

    assert.equal(isJsonValue(entry), false);
    assert.equal(isJsonObject(entry), false);
    assert.throws(() => validateMemoryEntry(entry), MemoryValidationError);
    assert.throws(() => cloneMemoryEntry(entry), MemoryValidationError);
    assert.throws(() => serializeMemoryEntries([entry]), MemoryValidationError);
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, 'toJSON');
    } else {
      Object.defineProperty(Object.prototype, 'toJSON', originalDescriptor);
    }
  }
});

test('rejects inherited Array.prototype and custom-prototype toJSON hooks consistently', () => {
  const originalArrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  const customArrayPrototype = Object.create(Array.prototype) as object;
  Object.defineProperty(customArrayPrototype, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: () => ({ spoofed: true }),
    writable: true,
  });
  const customArray = [] as unknown[];
  Object.setPrototypeOf(customArray, customArrayPrototype);
  const entryWithArrayMetadata = {
    ...entry,
    metadata: { sessionId: 'session-001', values: [1, 2, 3] },
  } as MemoryEntry;

  try {
    Object.defineProperty(Array.prototype, 'toJSON', {
      configurable: true,
      enumerable: false,
      value: () => ({ spoofed: true }),
      writable: true,
    });

    assert.equal(isJsonValue([entry]), false);
    assert.equal(isJsonObject({ values: [1, 2, 3] }), false);
    assert.equal(isJsonValue(customArray), false);
    assert.throws(() => validateMemoryEntry(entryWithArrayMetadata), MemoryValidationError);
    assert.throws(() => cloneMemoryEntry(entryWithArrayMetadata), MemoryValidationError);
    assert.throws(() => cloneMemoryEntryPatch({ metadata: { values: [1, 2, 3] } }), MemoryValidationError);
    assert.throws(() => validateMemoryEntryPatch({ metadata: { values: [1, 2, 3] } }), MemoryValidationError);
    assert.throws(() => serializeMemoryEntries([entry]), MemoryValidationError);
  } finally {
    if (originalArrayDescriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, 'toJSON');
    } else {
      Object.defineProperty(Array.prototype, 'toJSON', originalArrayDescriptor);
    }
  }
});

test('rejects cyclic metadata', () => {
  const metadata: Record<string, unknown> = { sessionId: 'session-001' };
  metadata.self = metadata;

  assert.throws(
    () => validateMemoryEntry({ ...entry, metadata: metadata as never }),
    MemoryValidationError,
  );
});
