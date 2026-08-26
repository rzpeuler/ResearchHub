import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { CanonicalV02KnowledgeLoader, KnowledgeError, KnowledgeLoader } from '../../../packages/shared/knowledge-base/index.ts'
import { createLegacyV01KnowledgeBase, createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

test('Schema 0.2 adapter loads canonical registry/assets.yaml storageRef mapping', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registryText = await readFile(join(root, 'registry', 'assets.yaml'), 'utf8')
    assert.match(registryText, /storageRef: entities\/gpu\.yaml/)
    assert.doesNotMatch(registryText, /assets:/)
    const index = await new CanonicalV02KnowledgeLoader(root).load()
    assert.equal(index.entities.get('segment:gpu')?.name, 'GPU')
    assert.equal(index.registry.get('segment:gpu'), 'entities/gpu.yaml')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('Schema 0.2 canonical Registry is authoritative and rejects legacy representation', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    await writeFile(join(root, 'entities', 'unregistered.yaml'), 'id: segment:unregistered\ntype: segment\nname: Unregistered\n')
    const index = await new CanonicalV02KnowledgeLoader(root).load()
    assert.equal(index.entities.has('segment:unregistered'), false)
    await writeFile(join(root, 'registry', 'assets.yaml'), `assets:
  - id: segment:gpu
    type: entity
    path: entities/gpu.yaml
`)
    await assert.rejects(() => new CanonicalV02KnowledgeLoader(root).load(), (error: unknown) => error instanceof KnowledgeError && error.code === 'RegistryError')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('Schema 0.2 Registry storageRef escape and missing asset fail explicitly', async () => {
  const escapeRoot = await createRuntimeKnowledgeBase()
  const missingRoot = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-missing-asset' })
  try {
    await writeFile(join(escapeRoot, 'registry', 'assets.yaml'), `segment:gpu:
  type: entity
  storageRef: ../../outside.yaml
`)
    await assert.rejects(() => new CanonicalV02KnowledgeLoader(escapeRoot).load(), (error: unknown) => error instanceof KnowledgeError && error.code === 'RegistryError')
    await writeFile(join(missingRoot, 'registry', 'assets.yaml'), `segment:missing:
  type: entity
  storageRef: entities/missing.yaml
`)
    await assert.rejects(() => new CanonicalV02KnowledgeLoader(missingRoot).load(), (error: unknown) => error instanceof KnowledgeError && error.code === 'RegistryError')
  } finally {
    await removeRuntimeKnowledgeBase(escapeRoot)
    await removeRuntimeKnowledgeBase(missingRoot)
  }
})

test('Schema 0.2 Registry key must match loaded asset id and asset id is required', async () => {
  const mismatchRoot = await createRuntimeKnowledgeBase()
  const missingIdRoot = await createRuntimeKnowledgeBase({ knowledgeBaseId: 'kb-missing-id' })
  try {
    await writeFile(join(mismatchRoot, 'entities', 'gpu.yaml'), 'id: company:amd\ntype: company\nname: AMD\n')
    await assert.rejects(() => new CanonicalV02KnowledgeLoader(mismatchRoot).load(), (error: unknown) => error instanceof KnowledgeError && error.code === 'RegistryError')
    await writeFile(join(missingIdRoot, 'entities', 'gpu.yaml'), 'type: segment\nname: GPU\n')
    await assert.rejects(() => new CanonicalV02KnowledgeLoader(missingIdRoot).load(), (error: unknown) => error instanceof KnowledgeError && error.code === 'RegistryError')
  } finally {
    await removeRuntimeKnowledgeBase(mismatchRoot)
    await removeRuntimeKnowledgeBase(missingIdRoot)
  }
})

test('Schema 0.1 legacy adapter and legacy Loader retain assets[] + path compatibility', async () => {
  const root = await createLegacyV01KnowledgeBase()
  try {
    const index = await new KnowledgeLoader({ rootDir: root }).load()
    assert.equal(index.entities.get('segment:gpu')?.name, 'GPU')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
