import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'

const productionRoot = fileURLToPath(new URL('../../../knowledge/', import.meta.url))

test('AI Hardware production dataset is registry-complete and validation-clean', async () => {
  const loader = new KnowledgeLoader({ rootDir: productionRoot })
  const assets = await loader.readAssets()
  assert.equal(assets.entities.length, 19)
  assert.equal(assets.relations.length, 23)
  assert.equal(assets.intelligence.length, 14)
  assert.equal(assets.modules.length, 4)
  assert.equal(assets.sources.length, 12)
  assert.equal(assets.registry.length, 72)
  assert.equal(assets.moduleRegistry.length, 4)

  const report = await new KnowledgeValidationSkill(loader).validateKnowledge()
  assert.equal(report.status, 'passed')
  assert.equal(report.errors.length, 0)
})

test('production dataset supports the frontend access queries', async () => {
  const skill = new KnowledgeAccessSkill({ index: await new KnowledgeLoader({ rootDir: productionRoot }).load() })
  assert.ok(skill.getSupplyChain('industry:ai-hardware', 2).some((entity) => entity.id === 'segment:data-center'))
  assert.deepEqual(skill.getRelatedCompanies('segment:gpu').map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.ok(skill.getIntelligence('segment:data-center').some((item) => item.type === 'forecast'))
  assert.deepEqual(skill.getModules('segment:gpu').map((module) => module.id), ['module:gpu-products'])
  assert.deepEqual(skill.getModules('segment:pcb-material').map((module) => module.id), ['module:pcb-material-products'])
  assert.equal(skill.getSources('fact:nvidia-total-revenue-fy2025')[0]?.id, 'source:nvidia-annual-report-2025')
})

test('production sources are traceable and contain no fixture or placeholder URLs', async () => {
  const assets = await new KnowledgeLoader({ rootDir: productionRoot }).readAssets()
  for (const source of assets.sources) {
    assert.ok(typeof source.value.url === 'string' && /^https?:\/\//.test(source.value.url))
    assert.ok(!source.value.url.includes('example.com'))
    assert.notEqual(source.value.quality, 'fixture')
    assert.notEqual(source.value.publisher, 'ResearchHub fixture')
  }
})
