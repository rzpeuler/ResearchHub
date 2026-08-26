import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseRegistry, KnowledgeError } from '../../../packages/shared/knowledge-base/index.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

test('mount registry mounts, lists, deduplicates, and unmounts a compatible KB', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    const first = await registry.mount(root)
    assert.equal(first.compatibility, 'compatible')
    assert.equal(first.writable, true)
    const duplicate = await registry.mount(root)
    assert.strictEqual(duplicate, first)
    assert.equal(registry.list().length, 1)
    assert.equal(registry.unmount(first.knowledgeBaseId), true)
    assert.equal(registry.list().length, 0)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('mount registry rejects the same KB ID from a different root', async () => {
  const firstRoot = await createRuntimeKnowledgeBase()
  const secondRoot = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    await registry.mount(firstRoot)
    await assert.rejects(() => registry.mount(secondRoot), (error: unknown) => error instanceof KnowledgeError && error.code === 'MountConflict')
  } finally {
    await removeRuntimeKnowledgeBase(firstRoot)
    await removeRuntimeKnowledgeBase(secondRoot)
  }
})

test('unsupported schema is not mounted as a usable handle and readonly handle is not writable', async () => {
  const unsupportedRoot = await createRuntimeKnowledgeBase({ schemaVersion: '9.9' })
  const readonlyRoot = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-readonly', status: 'readonly' })
  try {
    await assert.rejects(() => new KnowledgeBaseRegistry().mount(unsupportedRoot), (error: unknown) => error instanceof KnowledgeError && error.code === 'UnsupportedSchema')
    const handle = await new KnowledgeBaseRegistry().mount(readonlyRoot)
    assert.equal(handle.compatibility, 'read_only_compatible')
    assert.equal(handle.writable, false)
  } finally {
    await removeRuntimeKnowledgeBase(unsupportedRoot)
    await removeRuntimeKnowledgeBase(readonlyRoot)
  }
})
