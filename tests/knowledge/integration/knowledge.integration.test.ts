import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeLoader } from '../../../packages/skills/knowledge-access/loader.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import type { KnowledgeAccessSkill as AccessSkillType } from '../../../packages/skills/knowledge-access/index.ts'

const validRoot = fileURLToPath(new URL('../fixtures/valid/', import.meta.url))

interface KnowledgeWorkflowResult {
  industryName: string
  supplyChainIds: string[]
  companyIds: string[]
  intelligenceIds: string[]
  moduleIds: string[]
  sourceIds: string[]
}

function consumeKnowledge(skill: AccessSkillType): KnowledgeWorkflowResult {
  const industry = skill.getEntity('industry:ai-hardware')
  const forecast = skill.getIntelligence('segment:server', 'forecast')
  return {
    industryName: industry.name,
    supplyChainIds: skill.getSupplyChain(industry.id, 2).map((entity) => entity.id),
    companyIds: skill.getRelatedCompanies('segment:gpu').map(({ company }) => company.id),
    intelligenceIds: forecast.map((item) => item.id),
    moduleIds: skill.getModules('segment:gpu').map((module) => module.id),
    sourceIds: skill.getSources(forecast[0]?.id ?? '').map((source) => source.id),
  }
}

test('fixture to loader to validation to access skill to workflow consumer closes', async () => {
  const loader = new KnowledgeLoader({ rootDir: validRoot })
  const report = await new KnowledgeValidationSkill(loader).validateKnowledge()
  assert.equal(report.status, 'passed')

  const result = consumeKnowledge(new KnowledgeAccessSkill({ index: await loader.load() }))
  assert.equal(result.industryName, 'AI Hardware')
  assert.ok(result.supplyChainIds.includes('segment:gpu'))
  assert.deepEqual(result.companyIds, ['company:amd', 'company:nvidia'])
  assert.deepEqual(result.intelligenceIds, ['forecast:ai-server-market-size-2026'])
  assert.deepEqual(result.moduleIds, ['module:gpu-products'])
  assert.deepEqual(result.sourceIds, ['source:fixture-market-outlook'])
})
