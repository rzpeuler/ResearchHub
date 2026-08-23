import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { MemoryDuplicateError, MemoryNotFoundError, MemoryValidationError } from '../core/errors.ts';
import type { MemoryEntry } from '../core/types.ts';
import { LocalJsonMemoryPlugin } from './local-json-memory-plugin.ts';

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
    const plugin = new LocalJsonMemoryPlugin(filePath);
    const thesis = makeEntry('memory-thesis-001');
    const prediction = makeEntry('memory-prediction-001', 'prediction');

    assert.deepEqual(await plugin.retrieve(), []);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), []);
    await plugin.save(thesis);
    await plugin.save(prediction);

    assert.deepEqual(await plugin.retrieve({ type: 'thesis' }), [thesis]);
    assert.deepEqual(await plugin.retrieve({ sourceArtifactId: prediction.sourceArtifactId }), [prediction]);
    assert.deepEqual(await plugin.retrieve({ sessionId: 'session-001' }), [thesis, prediction]);
    assert.deepEqual(await plugin.retrieve({ id: 'missing' }), []);

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    assert.ok(Array.isArray(persisted));
  });
});

test('rejects duplicate and unknown IDs', async () => {
  await withTemporaryFile(async (filePath) => {
    const plugin = new LocalJsonMemoryPlugin(filePath);
    const entry = makeEntry('memory-thesis-001');

    await plugin.save(entry);
    await assert.rejects(() => plugin.save(entry), MemoryDuplicateError);
    await assert.rejects(() => plugin.update('missing', { content: 'new content' }), MemoryNotFoundError);
  });
});

test('rejects invalid entries and immutable identity patches', async () => {
  await withTemporaryFile(async (filePath) => {
    const plugin = new LocalJsonMemoryPlugin(filePath);
    const entry = makeEntry('memory-thesis-001');

    await assert.rejects(
      () => plugin.save({ ...entry, metadata: undefined } as never),
      MemoryValidationError,
    );
    await plugin.save(entry);
    await assert.rejects(
      () => plugin.update(entry.id, { id: 'changed' } as never),
      MemoryValidationError,
    );
    await assert.rejects(
      () => plugin.update(entry.id, { metadata: undefined } as never),
      MemoryValidationError,
    );
  });
});

test('returns rejected Promises for invalid query input', async () => {
  await withTemporaryFile(async (filePath) => {
    const plugin = new LocalJsonMemoryPlugin(filePath);

    await assert.rejects(
      () => plugin.retrieve({ type: 'thesis', unexpected: true } as never),
      MemoryValidationError,
    );
  });
});

test('returns defensive copies and persists updates across plugin instances', async () => {
  await withTemporaryFile(async (filePath) => {
    const firstPlugin = new LocalJsonMemoryPlugin(filePath);
    const entry = makeEntry('memory-thesis-001');
    await firstPlugin.save(entry);

    const retrieved = await firstPlugin.retrieve({ id: entry.id });
    const retrievedEntry = retrieved[0];
    assert.ok(retrievedEntry);
    retrievedEntry.content = 'mutated outside plugin';
    retrievedEntry.metadata.sessionId = 'mutated-session';

    const unchanged = await firstPlugin.retrieve({ id: entry.id });
    assert.equal(unchanged[0]?.content, entry.content);
    assert.equal(unchanged[0]?.metadata.sessionId, 'session-001');

    const updated = await firstPlugin.update(entry.id, {
      content: 'updated thesis content',
      metadata: { sessionId: 'session-002', reviewed: true },
    });
    assert.equal(updated.id, entry.id);
    assert.equal(updated.createdAt, entry.createdAt);
    assert.equal(updated.sourceArtifactId, entry.sourceArtifactId);

    const secondPlugin = new LocalJsonMemoryPlugin(filePath);
    assert.deepEqual(await secondPlugin.retrieve({ sessionId: 'session-002' }), [updated]);
  });
});

test('snapshots entry, query, and patch inputs before queued operations run', async () => {
  await withTemporaryFile(async (filePath) => {
    const plugin = new LocalJsonMemoryPlugin(filePath);
    const entry = makeEntry('memory-thesis-001');
    const savePromise = plugin.save(entry);
    entry.content = 'mutated before save ran';
    entry.metadata.sessionId = 'mutated-before-save';
    await savePromise;

    const query = { id: 'memory-thesis-001', sessionId: 'session-001' };
    const retrievePromise = plugin.retrieve(query);
    (query as { sessionId: string }).sessionId = 'mutated-before-retrieve';
    assert.deepEqual(await retrievePromise, [makeEntry('memory-thesis-001')]);

    const patch = {
      content: 'queued update',
      metadata: { sessionId: 'session-002', reviewed: true },
    };
    const updatePromise = plugin.update('memory-thesis-001', patch);
    patch.content = 'mutated before update ran';
    patch.metadata.sessionId = 'mutated-before-update';
    assert.deepEqual(await updatePromise, {
      ...makeEntry('memory-thesis-001'),
      content: 'queued update',
      metadata: { sessionId: 'session-002', reviewed: true },
    });
  });
});

test('serializes concurrent writes from plugin instances sharing one normalized path', async () => {
  await withTemporaryFile(async (filePath) => {
    const firstPlugin = new LocalJsonMemoryPlugin(filePath);
    const secondPlugin = new LocalJsonMemoryPlugin(join(dirname(filePath), '..', 'nested', 'memory.json'));
    const firstEntry = makeEntry('memory-thesis-001');
    const secondEntry = makeEntry('memory-thesis-002');

    await Promise.all([
      firstPlugin.save(firstEntry),
      secondPlugin.save(secondEntry),
    ]);

    const entries = await firstPlugin.retrieve();
    assert.deepEqual(entries.map((entry) => entry.id), [firstEntry.id, secondEntry.id]);

    const operationQueues = (LocalJsonMemoryPlugin as unknown as {
      operationQueues: Map<string, unknown>;
    }).operationQueues;
    assert.equal(operationQueues.has(resolve(filePath)), false);
  });
});
