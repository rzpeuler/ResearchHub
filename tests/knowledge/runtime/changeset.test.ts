import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeChangeSet } from '../../../packages/schemas/knowledge/index.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

function baseChangeSet(knowledgeBaseId: string, knowledgeOperations: KnowledgeChangeSet['knowledgeOperations'] = [], sourceOperations: KnowledgeChangeSet['sourceOperations'] = []): KnowledgeChangeSet {
  return { changeSetId: 'changeset-validation', workflowRunId: 'workflow-validation', knowledgeBaseId, schemaVersion: '0.2', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations, knowledgeOperations }
}

test('ChangeSet validation returns an immutable receipt for valid same-ChangeSet references', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await loader.mount(root)
    const skill = new KnowledgeValidationSkill({ loader })
    const source = { id: 'source:planned', type: 'report', title: 'Planned', publisher: 'Test', publishedAt: '2026-08-26' }
    const request = baseChangeSet(handle.knowledgeBaseId, [{ operationId: 'create-product', type: 'create', object: { id: 'product:planned', type: 'product', name: 'Planned', sourceRefs: ['source:planned'] } }], [{ operationId: 'create-source', type: 'source_create', source }])
    const result = await skill.validateChangeSet(handle, request)
    assert.equal(result.report.status, 'passed', JSON.stringify(result.report.errors))
    assert.ok(result.validatedChangeSet)
    assert.equal(Object.isFrozen(result.validatedChangeSet), true)
    assert.equal(Object.isFrozen(result.validatedChangeSet?.changeSet), true)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('ChangeSet validation finds duplicate IDs, missing references, and schema mismatch', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await loader.mount(root)
    const skill = new KnowledgeValidationSkill({ loader })
    const request = baseChangeSet(handle.knowledgeBaseId, [
      { operationId: 'create-1', type: 'create', object: { id: 'product:duplicate', type: 'product', name: 'One' } },
      { operationId: 'create-2', type: 'create', object: { id: 'product:duplicate', type: 'product', name: 'Two' } },
      { operationId: 'relation-1', type: 'create', object: { id: 'relation:missing', type: 'depends_on', source: 'segment:missing', target: 'segment:gpu' } },
    ])
    request.schemaVersion = '0.1'
    const result = await skill.validateChangeSet(handle, request)
    assert.equal(result.report.status, 'failed')
    assert.equal(result.validatedChangeSet, undefined)
    assert.ok(result.report.errors.some((error) => error.code === 'CHANGESET_SCHEMA_MISMATCH'))
    assert.ok(result.report.errors.some((error) => error.code === 'CREATE_COLLISION'))
    assert.ok(result.report.errors.some((error) => error.code === 'MISSING_REFERENCE'))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
