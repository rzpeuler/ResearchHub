import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { hashKnowledgeObject } from '../../../packages/shared/knowledge-base/canonical-hash.ts'
import { KnowledgeError } from '../../../packages/shared/knowledge-base/errors.ts'
import { getRaw, putRaw, readRaw, verifyRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

test('canonical hash sorts object keys, preserves arrays, and rejects unsupported values', () => {
  assert.equal(hashKnowledgeObject({ b: 2, a: [true, 'x', null] }), hashKnowledgeObject({ a: [true, 'x', null], b: 2 }))
  assert.notEqual(hashKnowledgeObject({ a: [1, 2] }), hashKnowledgeObject({ a: [2, 1] }))
  assert.equal(hashKnowledgeObject({ value: -0 }), 'sha256:' + createHash('sha256').update('{"value":0}', 'utf8').digest('hex'))
  assert.equal(hashKnowledgeObject({ value: undefined }), hashKnowledgeObject({}))
  assert.throws(() => hashKnowledgeObject(new Date()), (error: unknown) => error instanceof KnowledgeError && error.code === 'CanonicalHashError')
})

test('raw archive deduplicates bytes and keeps same-name different bytes separate', async () => {
  const rawRoot = await mkdtemp(join(tmpdir(), 'researchhub-raw-'))
  try {
    const first = await putRaw({ rawRoot, bytes: Buffer.from('same bytes'), originalFilename: 'first.txt', contentType: 'text/plain', sourceMetadata: { source: 'test' }, capturedAt: '2026-08-26T00:00:00.000Z', createdAt: '2026-08-26T00:00:00.000Z' })
    const deduped = await putRaw({ rawRoot, bytes: Buffer.from('same bytes'), originalFilename: 'second.pdf', contentType: 'application/pdf' })
    const different = await putRaw({ rawRoot, bytes: Buffer.from('different bytes'), originalFilename: 'first.txt' })

    assert.equal(deduped.manifest.rawRef, first.manifest.rawRef)
    assert.equal(deduped.reused, true)
    assert.equal((await readFile(join(rawRoot, 'registry', 'raw.yaml'), 'utf8')).includes(first.manifest.rawRef), true)
    assert.equal(deduped.originalPath, first.originalPath)
    assert.notEqual(different.manifest.rawRef, first.manifest.rawRef)
    assert.deepEqual((await readdir(first.bundlePath)).sort(), ['manifest.yaml', 'original.txt'])
    assert.equal((await readRaw(rawRoot, first.manifest.rawRef)).toString(), 'same bytes')
    assert.equal((await readRaw(rawRoot, different.manifest.rawRef)).toString(), 'different bytes')
    assert.deepEqual((await getRaw(rawRoot, first.manifest.rawRef)).manifest.sourceMetadata, { source: 'test' })
    assert.equal((await verifyRaw(rawRoot, first.manifest.rawRef)).valid, true)
    assert.equal(first.manifest.schemaVersion, '0.1')
  } finally {
    await rm(rawRoot, { recursive: true, force: true })
  }
})

test('raw archive verifies manifest and bytes and rejects traversal', async () => {
  const rawRoot = await mkdtemp(join(tmpdir(), 'researchhub-raw-integrity-'))
  try {
    const record = await putRaw({ rawRoot, bytes: Buffer.from('integrity'), originalFilename: 'note.md' })
    await assert.rejects(() => getRaw(rawRoot, '../outside'), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    await assert.rejects(() => getRaw(rawRoot, 'raw-sha256-' + 'A'.repeat(64)), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')

    await writeFile(record.originalPath, 'tampered', 'utf8')
    await assert.rejects(() => verifyRaw(rawRoot, record.manifest.rawRef), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')

    const rawDirectory = join(rawRoot, 'raw')
    const invalidRef = 'raw-sha256-' + '0'.repeat(64)
    await mkdir(join(rawDirectory, invalidRef), { recursive: true })
    await writeFile(join(rawDirectory, invalidRef, 'manifest.yaml'), '{}\n', 'utf8')
    await assert.rejects(() => getRaw(rawRoot, invalidRef), (error: unknown) => error instanceof KnowledgeError && error.code === 'RawArchiveError')
    assert.equal((await readFile(record.manifestPath, 'utf8')).includes(record.manifest.rawRef), true)
  } finally {
    await rm(rawRoot, { recursive: true, force: true })
  }
})

test('raw-only archive updates raw registry without changing Knowledge revision timestamps', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const before = await readFile(join(root, 'manifest.yaml'), 'utf8')
    await putRaw({ rawRoot: root, bytes: Buffer.from('raw-only'), originalFilename: 'raw.txt' })
    const after = await readFile(join(root, 'manifest.yaml'), 'utf8')
    assert.equal(after, before)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
