import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeError, loadKnowledgeBaseManifest } from '../../../packages/shared/knowledge-base/index.ts'

test('manifest loader reports missing and malformed manifests explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-manifest-'))
  try {
    await assert.rejects(() => loadKnowledgeBaseManifest(root), (error: unknown) => error instanceof KnowledgeError && error.code === 'ManifestNotFound')
    await writeFile(join(root, 'manifest.yaml'), 'knowledgeBaseId: kb-invalid\nstatus: active\n')
    await assert.rejects(() => loadKnowledgeBaseManifest(root), (error: unknown) => error instanceof KnowledgeError && error.code === 'ManifestError')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
