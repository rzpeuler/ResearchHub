import assert from 'node:assert/strict'
import test from 'node:test'
import { equityResearchWorkflowDefinition } from './definition.ts'
import { WorkflowRegistry } from '../registry.ts'

test('Equity Research Workflow defines the approved five-Skill composition and assembly step', () => {
  assert.deepEqual(equityResearchWorkflowDefinition.steps.map((step) => step.id), [
    'company-understanding',
    'industry-analysis',
    'financial-analysis',
    'earnings-review',
    'valuation-analysis',
    'investment-thesis-generation',
  ])
  assert.deepEqual(equityResearchWorkflowDefinition.steps.map((step) => step.skill), [
    'company-research',
    'industry-research',
    'equity-research',
    'earnings-review',
    'valuation',
    'workflow-assembly',
  ])
  assert.ok(equityResearchWorkflowDefinition.steps.every((step, index) => index === 0 || step.dependsOn[0] === equityResearchWorkflowDefinition.steps[index - 1]?.id))
})

test('WorkflowRegistry discovers the Equity Research Workflow definition', () => {
  const registry = new WorkflowRegistry()
  registry.register(equityResearchWorkflowDefinition)
  assert.equal(registry.get('equity-research').name, 'Equity Research Workflow')
  assert.deepEqual(registry.list(), ['equity-research'])
})
