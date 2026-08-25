import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'

const validRoot = fileURLToPath(new URL('../fixtures/valid/', import.meta.url))

test('Knowledge Access Skill supports supply-chain and company queries', async () => {
  const index = await new KnowledgeLoader({ rootDir: validRoot }).load()
  const skill = new KnowledgeAccessSkill({ index })

  assert.equal(skill.getEntity('industry:ai-hardware').name, 'AI Hardware')
  assert.ok(skill.searchEntities('PCB').some((entity) => entity.id === 'segment:pcb-material'))
  assert.ok(skill.getRelations('segment:server').some((relation) => relation.type === 'depends_on'))
  assert.ok(skill.getSupplyChain('segment:data-center', 2).some((entity) => entity.id === 'segment:gpu'))
  assert.deepEqual(skill.getRelatedCompanies('segment:gpu').map(({ company }) => company.id), ['company:amd', 'company:nvidia'])
  assert.equal(skill.getIntelligence('segment:server', 'forecast')[0]?.id, 'forecast:ai-server-market-size-2026')
  assert.equal(skill.getModules('segment:gpu')[0]?.id, 'module:gpu-products')
  assert.equal(skill.getComparison('segment:server', 'product-comparison')[0]?.id, 'module:server-products')
  assert.equal(skill.getSources('forecast:ai-server-market-size-2026')[0]?.id, 'source:fixture-market-outlook')
})
