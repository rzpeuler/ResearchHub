import assert from 'node:assert/strict'
import { test } from 'node:test'
import { companyResearchWorkflowDefinition } from './definitions.ts'
import { WorkflowRegistry } from './index.ts'

test('WorkflowRegistry registers the company-research Workflow with the seven research modules', () => {
  const registry = new WorkflowRegistry()
  const definition = registry.register(companyResearchWorkflowDefinition)

  assert.equal(definition.id, 'company-research')
  assert.deepEqual(definition.steps.map((step) => step.id), [
    'business-understanding',
    'industry-position',
    'competitive-advantage',
    'growth-drivers',
    'financial-quality',
    'capital-allocation',
    'risk-analysis',
    'generate-company-thesis',
    'generate-company-prediction',
  ])
  assert.ok(definition.steps.every((step) => step.skill === 'company-research'))
  assert.deepEqual(registry.list(), ['company-research'])
})
