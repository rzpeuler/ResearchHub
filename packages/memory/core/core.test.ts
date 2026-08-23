import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryValidationError } from './errors.ts';
import { deserializeMemoryEntries, serializeMemoryEntries } from './serialization.ts';
import { isIsoTimestamp, validateMemoryEntry, validateMemoryQuery } from './validation.ts';
import type { MemoryEntry } from './types.ts';

const entry: MemoryEntry = {
  id: 'memory:thesis:thesis-001',
  type: 'thesis',
  content: '{"statement":"Revenue growth supports the thesis."}',
  sourceArtifactId: 'thesis-001',
  createdAt: '2026-08-23T10:00:00.000Z',
  metadata: { sessionId: 'session-001', artifactType: 'thesis' },
};

test('validates and round-trips a Memory Entry', () => {
  validateMemoryEntry(entry);
  const restored = deserializeMemoryEntries(serializeMemoryEntries([entry]));

  assert.deepEqual(restored, [entry]);
  assert.notStrictEqual(restored[0], entry);
  assert.notStrictEqual(restored[0]?.metadata, entry.metadata);
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

test('rejects cyclic metadata', () => {
  const metadata: Record<string, unknown> = { sessionId: 'session-001' };
  metadata.self = metadata;

  assert.throws(
    () => validateMemoryEntry({ ...entry, metadata: metadata as never }),
    MemoryValidationError,
  );
});
