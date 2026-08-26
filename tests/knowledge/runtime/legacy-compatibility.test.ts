import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeIndex } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { parseYaml } from '../../../packages/skills/knowledge-access/yaml.ts'
import { createLegacyV01KnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

test('legacy KnowledgeLoader, KnowledgeIndex, and YAML imports remain compatible', async () => {
  const root = await createLegacyV01KnowledgeBase()
  try {
    const index = await new KnowledgeLoader({ rootDir: root }).load()
    assert.ok(index instanceof KnowledgeIndex)
    assert.equal(index.entities.get('segment:gpu')?.name, 'GPU')
    assert.deepEqual(index.moduleRegistry.get('segment:gpu'), ['module:gpu-products'])
    const access = new KnowledgeAccessSkill({ index })
    assert.equal(access.getComparison('segment:gpu', 'product-comparison')[0]?.id, 'module:gpu-products')
    assert.equal((parseYaml('enabled: true') as { enabled: boolean }).enabled, true)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
