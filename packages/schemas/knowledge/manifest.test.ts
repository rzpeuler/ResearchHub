import assert from 'node:assert/strict'
import test from 'node:test'
import { parseKnowledgeBaseManifest } from './manifest.ts'

const validManifest = {
  knowledgeBaseId: 'kb-runtime-test',
  name: 'Runtime Test Knowledge Base',
  schemaVersion: '0.2',
  storageFormatVersion: '1',
  revision: 0,
  status: 'active',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
}

test('Knowledge Base manifest parses required fields and preserves extension fields', () => {
  const manifest = parseKnowledgeBaseManifest({ ...validManifest, owner: 'fixture' })
  assert.equal(manifest.knowledgeBaseId, 'kb-runtime-test')
  assert.equal(manifest.owner, 'fixture')
})

test('Knowledge Base manifest rejects missing required fields', () => {
  const { schemaVersion: _schemaVersion, ...missing } = validManifest
  assert.throws(() => parseKnowledgeBaseManifest(missing), /schemaVersion/)
})

test('Knowledge Base manifest rejects invalid status and revision', () => {
  assert.throws(() => parseKnowledgeBaseManifest({ ...validManifest, status: 'deleted' }), /status/)
  assert.throws(() => parseKnowledgeBaseManifest({ ...validManifest, revision: -1 }), /revision/)
  assert.throws(() => parseKnowledgeBaseManifest({ ...validManifest, revision: 1.5 }), /revision/)
})
