import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventAnalysisWorkflowDefinition } from './definitions.ts'
import { WorkflowDuplicateError, WorkflowNotFoundError, WorkflowRegistry, WorkflowValidationError } from './index.ts'

test('WorkflowRegistry registers and snapshots event-analysis definition', () => {
  const registry = new WorkflowRegistry()
  const registered = registry.register(eventAnalysisWorkflowDefinition)
  assert.equal(registered.id, 'event-analysis')
  assert.equal(registered.steps.length, 5)
  assert.deepEqual(registry.list(), ['event-analysis'])

  const copy = registry.get('event-analysis')
  copy.steps[0]!.inputs.push('mutated')
  assert.deepEqual(registry.get('event-analysis').steps[0]!.inputs, ['symbol'])
})

test('WorkflowRegistry rejects duplicates, unknown dependencies, and missing definitions', () => {
  const registry = new WorkflowRegistry()
  registry.register(eventAnalysisWorkflowDefinition)
  assert.throws(() => registry.register(eventAnalysisWorkflowDefinition), WorkflowDuplicateError)
  assert.throws(() => registry.get('missing'), WorkflowNotFoundError)
  assert.throws(() => registry.register({
    ...eventAnalysisWorkflowDefinition,
    id: 'invalid',
    steps: [{ ...eventAnalysisWorkflowDefinition.steps[0]!, dependsOn: ['missing-step'] }],
  }), WorkflowValidationError)
})
