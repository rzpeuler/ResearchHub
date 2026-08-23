import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { MemoryDuplicateError, MemoryNotFoundError, MemoryValidationError } from '../core/errors.ts';
import type { MemoryEntry } from '../core/types.ts';
import { LocalJsonMemoryProvider } from './local-json-memory-provider.ts';

async function withTemporaryFile<T>(callback: (filePath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-memory-'));
  const filePath = join(directory, 'nested', 'memory.json');

  try {
    return await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeEntry(id: string, type: MemoryEntry['type'] = 'thesis'): MemoryEntry {
  return {
    id,
    type,
    content: `{"id":"${id}"}`,
    sourceArtifactId: `${type}-artifact-${id}`,
    createdAt: '2026-08-23T10:00:00.000Z',
    metadata: { sessionId: 'session-001', artifactType: type },
  };
}

test('creates a JSON array file and saves/retrieves entries with exact filters', async () => {
  await withTemporaryFile(async (filePath) => {
    const provider = new LocalJsonMemoryProvider(filePath);
    const thesis = makeEntry('memory-thesis-001');
    const prediction = makeEntry('memory-prediction-001', 'prediction');

    assert.deepEqual(await provider.retrieve(), []);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), []);
    await provider.save(thesis);
    await provider.save(prediction);

    assert.deepEqual(await provider.retrieve({ type: 'thesis' }), [thesis]);
    assert.deepEqual(await provider.retrieve({ sourceArtifactId: prediction.sourceArtifactId }), [prediction]);
    assert.deepEqual(await provider.retrieve({ sessionId: 'session-001' }), [thesis, prediction]);
    assert.deepEqual(await provider.retrieve({ id: 'missing' }), []);

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    assert.ok(Array.isArray(persisted));
  });
});

test('rejects duplicate and unknown IDs', async () => {
  await withTemporaryFile(async (filePath) => {
    const provider = new LocalJsonMemoryProvider(filePath);
    const entry = makeEntry('memory-thesis-001');

    await provider.save(entry);
    await assert.rejects(() => provider.save(entry), MemoryDuplicateError);
    await assert.rejects(() => provider.update('missing', { content: 'new content' }), MemoryNotFoundError);
  });
});

test('rejects invalid entries and immutable identity patches', async () => {
  await withTemporaryFile(async (filePath) => {
    const provider = new LocalJsonMemoryProvider(filePath);
    const entry = makeEntry('memory-thesis-001');

    await assert.rejects(
      () => provider.save({ ...entry, metadata: undefined } as never),
      MemoryValidationError,
    );
    await provider.save(entry);
    await assert.rejects(
      () => provider.update(entry.id, { id: 'changed' } as never),
      MemoryValidationError,
    );
    await assert.rejects(
      () => provider.update(entry.id, { metadata: undefined } as never),
      MemoryValidationError,
    );
  });
});

test('returns rejected Promises for invalid query input', async () => {
  await withTemporaryFile(async (filePath) => {
    const provider = new LocalJsonMemoryProvider(filePath);

    await assert.rejects(
      () => provider.retrieve({ type: 'thesis', unexpected: true } as never),
      MemoryValidationError,
    );
  });
});

test('returns defensive copies and persists updates across provider instances', async () => {
  await withTemporaryFile(async (filePath) => {
    const firstProvider = new LocalJsonMemoryProvider(filePath);
    const entry = makeEntry('memory-thesis-001');
    await firstProvider.save(entry);

    const retrieved = await firstProvider.retrieve({ id: entry.id });
    const retrievedEntry = retrieved[0];
    assert.ok(retrievedEntry);
    retrievedEntry.content = 'mutated outside provider';
    retrievedEntry.metadata.sessionId = 'mutated-session';

    const unchanged = await firstProvider.retrieve({ id: entry.id });
    assert.equal(unchanged[0]?.content, entry.content);
    assert.equal(unchanged[0]?.metadata.sessionId, 'session-001');

    const updated = await firstProvider.update(entry.id, {
      content: 'updated thesis content',
      metadata: { sessionId: 'session-002', reviewed: true },
    });
    assert.equal(updated.id, entry.id);
    assert.equal(updated.createdAt, entry.createdAt);
    assert.equal(updated.sourceArtifactId, entry.sourceArtifactId);

    const secondProvider = new LocalJsonMemoryProvider(filePath);
    assert.deepEqual(await secondProvider.retrieve({ sessionId: 'session-002' }), [updated]);
  });
});

test('snapshots entry, query, and patch inputs before queued operations run', async () => {
  await withTemporaryFile(async (filePath) => {
    const provider = new LocalJsonMemoryProvider(filePath);
    const entry = makeEntry('memory-thesis-001');
    const savePromise = provider.save(entry);
    entry.content = 'mutated before save ran';
    entry.metadata.sessionId = 'mutated-before-save';
    await savePromise;

    const query = { id: 'memory-thesis-001', sessionId: 'session-001' };
    const retrievePromise = provider.retrieve(query);
    (query as { sessionId: string }).sessionId = 'mutated-before-retrieve';
    assert.deepEqual(await retrievePromise, [makeEntry('memory-thesis-001')]);

    const patch = {
      content: 'queued update',
      metadata: { sessionId: 'session-002', reviewed: true },
    };
    const updatePromise = provider.update('memory-thesis-001', patch);
    patch.content = 'mutated before update ran';
    patch.metadata.sessionId = 'mutated-before-update';
    assert.deepEqual(await updatePromise, {
      ...makeEntry('memory-thesis-001'),
      content: 'queued update',
      metadata: { sessionId: 'session-002', reviewed: true },
    });
  });
});

test('serializes concurrent writes from provider instances sharing one normalized path', async () => {
  await withTemporaryFile(async (filePath) => {
    const firstProvider = new LocalJsonMemoryProvider(filePath);
    const secondProvider = new LocalJsonMemoryProvider(join(dirname(filePath), '..', 'nested', 'memory.json'));
    const firstEntry = makeEntry('memory-thesis-001');
    const secondEntry = makeEntry('memory-thesis-002');

    await Promise.all([
      firstProvider.save(firstEntry),
      secondProvider.save(secondEntry),
    ]);

    const entries = await firstProvider.retrieve();
    assert.deepEqual(entries.map((entry) => entry.id), [firstEntry.id, secondEntry.id]);

    const operationQueues = (LocalJsonMemoryProvider as unknown as {
      operationQueues: Map<string, unknown>;
    }).operationQueues;
    assert.equal(operationQueues.has(resolve(filePath)), false);
  });
});
