import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeError } from '../../../packages/shared/knowledge-base/index.ts'
import { createLegacyV01KnowledgeBase, createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

test('manifest-first KnowledgeBaseLoader mounts and loads a minimal v0.2 KB', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const loader = new KnowledgeBaseLoader()
    const { handle, index } = await loader.mountAndLoad(root)
    assert.equal(handle.knowledgeBaseId, 'kb-runtime-test')
    assert.equal(handle.schemaVersion, '0.2')
    assert.equal(index.entities.get('segment:gpu')?.name, 'GPU')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('KnowledgeBaseLoader requires compatibility before loading and never auto-migrates', async () => {
  const root = await createLegacyV01KnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry({ compatibility: { supported: [], migrationAvailable: true } })
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await loader.mount(root)
    await assert.rejects(() => loader.load(handle), (error: unknown) => error instanceof KnowledgeError && error.code === 'CompatibilityError')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
