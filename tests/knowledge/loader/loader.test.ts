import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'

const validRoot = fileURLToPath(new URL('../fixtures/valid/', import.meta.url))

test('AI Hardware fixture loads entities, relations, intelligence, modules, and sources', async () => {
  const assets = await new KnowledgeLoader({ rootDir: validRoot }).readAssets()
  assert.ok(assets.entities.length >= 18)
  assert.ok(assets.relations.length >= 20)
  assert.equal(assets.intelligence.length, 5)
  assert.equal(assets.modules.length, 2)
  assert.equal(assets.sources.length, 2)
  assert.ok(assets.registry.length >= 10)
  for (const entityId of [
    'segment:gpu', 'segment:hbm', 'segment:pcb-material', 'segment:pcb-manufacturing',
    'segment:optical-module', 'segment:server', 'segment:data-center',
    'company:shengyi-technology', 'company:hudian', 'company:scc', 'company:nvidia',
    'company:amd', 'company:langchao', 'company:foxconn-industrial-internet',
    'company:sk-hynix', 'company:samsung', 'company:micron',
  ]) assert.ok(assets.entities.some((asset) => asset.value.id === entityId), entityId)
})

test('loader reload replaces the cached runtime index', async () => {
  const loader = new KnowledgeLoader({ rootDir: validRoot })
  const first = await loader.load()
  const second = await loader.reload()
  assert.notStrictEqual(first, second)
  assert.equal(second.entities.get('company:nvidia')?.name, 'NVIDIA')
})
