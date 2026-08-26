import assert from 'node:assert/strict'
import test from 'node:test'
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
    assert.equal((parseYaml('enabled: true') as { enabled: boolean }).enabled, true)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
