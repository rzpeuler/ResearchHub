import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { parseYaml } from '../../../packages/shared/knowledge-base/yaml.ts'
import { KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/handle.ts'
import { hashKnowledgeObject } from '../../../packages/shared/knowledge-base/canonical-hash.ts'
import { KnowledgeError } from '../../../packages/shared/knowledge-base/errors.ts'
import { archiveRaw, getRaw, readRaw, verifyRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

async function mount(root: string) {
  return new KnowledgeBaseLoader().mount(root)
}

test('canonical hash sorts object keys, preserves arrays, and rejects unsupported values', () => {
  assert.equal(hashKnowledgeObject({ b: 2, a: [true, 'x', null] }), hashKnowledgeObject({ a: [true, 'x', null], b: 2 }))
  assert.notEqual(hashKnowledgeObject({ a: [1, 2] }), hashKnowledgeObject({ a: [2, 1] }))
  assert.equal(hashKnowledgeObject({ value: -0 }), 'sha256:' + createHash('sha256').update('{"value":0}', 'utf8').digest('hex'))
  assert.equal(hashKnowledgeObject({ value: undefined }), hashKnowledgeObject({}))
  assert.throws(() => hashKnowledgeObject(new Date()), (error: unknown) => error instanceof KnowledgeError && error.code === 'CanonicalHashError')
})

test('KB-scoped raw archive writes the exact v0.2 manifest and preserves first metadata on reuse', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const handle = await mount(root)
    const first = await archiveRaw(handle, { bytes: Buffer.from('same bytes'), originalFilename: 'first.txt', mediaType: 'text/plain', suppliedMetadata: { title: 'First', institution: null, author: 'Author', publishedAt: '2026-08-26', sourceUrl: 'https://example.test/first' } }, { clock: () => '2026-08-26T00:00:00.000Z' })
    const deduped = await archiveRaw(handle, { bytes: Buffer.from('same bytes'), originalFilename: 'second.pdf', mediaType: 'application/pdf', suppliedMetadata: { title: 'Second' } }, { clock: () => '2026-08-27T00:00:00.000Z' })
    const different = await archiveRaw(handle, { bytes: Buffer.from('different bytes'), originalFilename: null })

    assert.equal(deduped.manifest.rawRef, first.manifest.rawRef)
    assert.equal(deduped.reused, true)
    assert.equal(deduped.originalPath, first.originalPath)
    assert.deepEqual(deduped.manifest, first.manifest)
    assert.notEqual(different.manifest.rawRef, first.manifest.rawRef)
    assert.deepEqual(Object.keys(first.manifest).sort(), ['contentHash', 'mediaType', 'originalFilename', 'rawRef', 'receivedAt', 'sizeBytes', 'suppliedMetadata'].sort())
    assert.deepEqual(first.manifest.suppliedMetadata, { title: 'First', institution: null, author: 'Author', publishedAt: '2026-08-26', sourceUrl: 'https://example.test/first' })
    assert.equal(first.manifest.receivedAt, '2026-08-26T00:00:00.000Z')
    assert.equal(first.manifest.sizeBytes, Buffer.byteLength('same bytes'))
    assert.deepEqual((await readdir(first.bundlePath)).sort(), ['manifest.yaml', 'original.txt'])
    assert.deepEqual((await readdir(different.bundlePath)).sort(), ['manifest.yaml', 'original.bin'])
    assert.equal((await readRaw(handle, first.manifest.rawRef)).toString(), 'same bytes')
    assert.equal((await readRaw(handle, different.manifest.rawRef)).toString(), 'different bytes')
    assert.equal((await verifyRaw(handle, first.manifest.rawRef)).valid, true)
    assert.match(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8'), new RegExp(first.manifest.rawRef))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('raw archive validates bundle, registry, bytes, and traversal', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const handle = await mount(root)
    const record = await archiveRaw(handle, { bytes: Buffer.from('integrity'), originalFilename: 'note.md' })
    await assert.rejects(() => getRaw(handle, '../outside'), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    await assert.rejects(() => getRaw(handle, 'raw-sha256-' + 'A'.repeat(64)), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    await writeFile(record.originalPath, 'tampered', 'utf8')
    await assert.rejects(() => verifyRaw(handle, record.manifest.rawRef), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

for (const status of ['readonly', 'archived'] as const) {
  test(`raw archive rejects ${status} Knowledge Bases without filesystem mutation`, async () => {
    const root = await createRuntimeKnowledgeBase({ status })
    try {
      const handle = await mount(root)
      await assert.rejects(() => archiveRaw(handle, { bytes: Buffer.from(status), originalFilename: 'raw.txt' }), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
      assert.equal(await readdir(join(root, 'raw')).then(() => true).catch(() => false), false)
      assert.equal((await readFile(join(root, 'manifest.yaml'), 'utf8')).includes('revision: 0'), true)
    } finally {
      await removeRuntimeKnowledgeBase(root)
    }
  })
}

test('raw archive rejects Schema 0.1 and arbitrary non-KB roots', async () => {
  const legacyRoot = await createRuntimeKnowledgeBase({ schemaVersion: '0.1' })
  const arbitraryRoot = await mkdtemp(join(tmpdir(), 'researchhub-arbitrary-'))
  try {
    const legacyHandle = await mount(legacyRoot)
    await assert.rejects(() => archiveRaw(legacyHandle, { bytes: Buffer.from('legacy') }), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    await assert.rejects(() => archiveRaw({ rootRef: arbitraryRoot } as KnowledgeBaseHandle, { bytes: Buffer.from('arbitrary') }), (error: unknown) => error instanceof KnowledgeError)
  } finally {
    await removeRuntimeKnowledgeBase(legacyRoot)
    await rm(arbitraryRoot, { recursive: true, force: true })
  }
})

test('raw-only archive leaves Knowledge revision and updatedAt unchanged', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const handle = await mount(root)
    const before = await readFile(join(root, 'manifest.yaml'), 'utf8')
    await archiveRaw(handle, { bytes: Buffer.from('raw-only'), originalFilename: 'raw.txt' })
    const after = await readFile(join(root, 'manifest.yaml'), 'utf8')
    assert.equal(after, before)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('raw archive rejects a stale or wrong-identity handle before mutation', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const valid = await mount(root)
    const staleIdentity = new KnowledgeBaseHandle({ knowledgeBaseId: 'kb-other', rootRef: valid.rootRef, schemaVersion: valid.schemaVersion, storageFormatVersion: valid.storageFormatVersion, revision: valid.revision, status: valid.status })
    await assert.rejects(() => archiveRaw(staleIdentity, { bytes: Buffer.from('wrong') }), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    assert.equal(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8'), '{}\n')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('concurrent different Raw archives in one KB preserve every Registry entry', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const handle = await mount(root)
    const [first, second] = await Promise.all([
      archiveRaw(handle, { bytes: Buffer.from('raw-A'), originalFilename: 'a.txt' }),
      archiveRaw(handle, { bytes: Buffer.from('raw-B'), originalFilename: 'b.txt' }),
    ])
    assert.equal((await verifyRaw(handle, first.manifest.rawRef)).valid, true)
    assert.equal((await verifyRaw(handle, second.manifest.rawRef)).valid, true)
    const registry = await readFile(join(root, 'registry', 'raw.yaml'), 'utf8')
    assert.match(registry, new RegExp(first.manifest.rawRef))
    assert.match(registry, new RegExp(second.manifest.rawRef))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('concurrent identical Raw archives share one immutable bundle and preserve first metadata', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const handle = await mount(root)
    const [first, second] = await Promise.all([
      archiveRaw(handle, { bytes: Buffer.from('same-concurrent'), originalFilename: 'first.txt', mediaType: 'text/plain', suppliedMetadata: { title: 'First' } }, { clock: () => '2026-08-26T00:00:00.000Z' }),
      archiveRaw(handle, { bytes: Buffer.from('same-concurrent'), originalFilename: 'second.pdf', mediaType: 'application/pdf', suppliedMetadata: { title: 'Second' } }, { clock: () => '2026-08-27T00:00:00.000Z' }),
    ])
    assert.equal(first.manifest.rawRef, second.manifest.rawRef)
    assert.deepEqual(first.manifest, second.manifest)
    assert.deepEqual([first.reused, second.reused].sort(), [false, true])
    const registry = parseYaml(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8'), join(root, 'registry', 'raw.yaml'))
    assert.deepEqual(Object.keys(registry as Record<string, unknown>), [first.manifest.rawRef])
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('Raw archives on different Knowledge Bases execute independently', async () => {
  const rootA = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-runtime-a' })
  const rootB = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-runtime-b' })
  try {
    const loader = new KnowledgeBaseLoader()
    const [handleA, handleB] = await Promise.all([loader.mount(rootA), loader.mount(rootB)])
    const [a, b] = await Promise.all([
      archiveRaw(handleA, { bytes: Buffer.from('A'), originalFilename: 'a.txt' }),
      archiveRaw(handleB, { bytes: Buffer.from('B'), originalFilename: 'b.txt' }),
    ])
    assert.equal((await verifyRaw(handleA, a.manifest.rawRef)).valid, true)
    assert.equal((await verifyRaw(handleB, b.manifest.rawRef)).valid, true)
  } finally {
    await removeRuntimeKnowledgeBase(rootA)
    await removeRuntimeKnowledgeBase(rootB)
  }
})
