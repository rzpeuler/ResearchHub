import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { WorkflowRegistry } from '../../../packages/workflows/index.ts'
import type { WorkflowContext, WorkflowDefinition } from '../../../packages/workflows/index.ts'
import { createTestHandle } from '../test-handle.ts'

const validRoot = fileURLToPath(new URL('../fixtures/valid/', import.meta.url))

interface KnowledgeWorkflowResult {
  industryName: string
  supplyChainIds: string[]
  companyIds: string[]
  intelligenceIds: string[]
  moduleIds: string[]
  sourceIds: string[]
}

const knowledgeWorkflow: WorkflowDefinition = {
  id: 'knowledge-fixture-consumer',
  name: 'Knowledge Fixture Consumer',
  description: 'Consumes the AI Hardware fixture through the standard Workflow registry contract.',
  version: '0.1.0',
  purpose: 'Verify Workflow -> Knowledge Access Skill -> Loader/Index behavior.',
  inputSchema: {},
  outputSchema: {},
  steps: [{ id: 'consume-knowledge', skill: 'knowledge-access', inputs: [], outputs: ['result'], dependsOn: [] }],
}

async function executeKnowledgeWorkflow(workflow: WorkflowDefinition, context: WorkflowContext, loader: KnowledgeBaseLoader, handle: ReturnType<typeof createTestHandle>): Promise<KnowledgeWorkflowResult> {
  const registry = new WorkflowRegistry()
  registry.register(workflow)
  const definition = registry.get(String(context.workflowId))
  const step = definition.steps[0]
  if (!step || step.skill !== 'knowledge-access') throw new Error('Knowledge workflow step was not registered')
  const skill = new KnowledgeAccessSkill({ handle, index: await loader.load(handle) })
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
  const loader = new KnowledgeBaseLoader()
  const handle = createTestHandle(validRoot)
  const report = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(handle)
  assert.equal(report.status, 'passed')

  const result = await executeKnowledgeWorkflow(knowledgeWorkflow, { workflowId: knowledgeWorkflow.id }, loader, handle)
  assert.equal(result.industryName, 'AI Hardware')
  assert.ok(result.supplyChainIds.includes('segment:gpu'))
  assert.deepEqual(result.companyIds, ['company:amd', 'company:nvidia'])
  assert.deepEqual(result.intelligenceIds, ['forecast:ai-server-market-size-2026'])
  assert.deepEqual(result.moduleIds, ['module:gpu-products'])
  assert.deepEqual(result.sourceIds, ['source:fixture-market-outlook'])
})
