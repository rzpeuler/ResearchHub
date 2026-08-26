import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { hashKnowledgeObject, KnowledgeBaseHandle, KnowledgeBaseLoader, KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/index.ts'
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

test('dry-run accepts virtual Raw provenance on a readonly handle and never creates a receipt', async () => {
  const root = await createRuntimeKnowledgeBase({ status: 'readonly' })
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const mounted = await loader.mount(root)
    const readonlyHandle = new KnowledgeBaseHandle({ knowledgeBaseId: mounted.knowledgeBaseId, rootRef: mounted.rootRef, schemaVersion: mounted.schemaVersion, storageFormatVersion: mounted.storageFormatVersion, revision: mounted.revision, status: 'readonly' })
    const skill = new KnowledgeValidationSkill({ loader })
    const virtualRawRef = `raw-sha256-${'a'.repeat(64)}`
    await unlink(join(root, 'registry', 'raw.yaml'))
    const request = baseChangeSet(readonlyHandle.knowledgeBaseId, [{ operationId: 'create-product', type: 'create', object: { id: 'product:virtual', type: 'product', name: 'Virtual', rawRefs: [virtualRawRef] } }])
    request.requiresRawProvenance = true
    const result = await skill.validateChangeSet(readonlyHandle, request, { mode: 'dry_run', virtualRawRefs: [virtualRawRef] })
    assert.equal(result.report.status, 'passed', JSON.stringify(result.report.errors))
    assert.equal(result.validatedChangeSet, undefined)
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

test('ChangeSet validates full Source v0.2 contracts for create and merge', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await loader.mount(root)
    const skill = new KnowledgeValidationSkill({ loader })
    const invalidType = baseChangeSet(handle.knowledgeBaseId, [], [{ operationId: 'source-invalid-type', type: 'source_create', source: { id: 'source:invalid-type', type: 'report', title: 'Invalid', publisher: null, publishedAt: null, sourceType: 'bad' as never } }])
    const typeResult = await skill.validateChangeSet(handle, invalidType)
    assert.equal(typeResult.report.status, 'failed')
    assert.ok(typeResult.report.errors.some((error) => error.message.includes('sourceType')))
    const invalidReliability = baseChangeSet(handle.knowledgeBaseId, [], [{ operationId: 'source-invalid-reliability', type: 'source_create', source: { id: 'source:invalid-reliability', type: 'report', title: 'Invalid', publisher: null, publishedAt: null, sourceReliability: 'bad' as never } }])
    const reliabilityResult = await skill.validateChangeSet(handle, invalidReliability)
    assert.equal(reliabilityResult.report.status, 'failed')
    assert.ok(reliabilityResult.report.errors.some((error) => error.message.includes('sourceReliability')))

    await mkdir(join(root, 'sources'), { recursive: true })
    const source = { id: 'source:existing', type: 'report', title: 'Existing', publisher: null, publishedAt: null, institution: null, author: null, url: null, sourceType: 'sell_side_research', sourceReliability: 'medium' }
    await writeFile(join(root, 'sources', 'existing.yaml'), `${JSON.stringify(source)}\n`)
    const registryText = await readFile(join(root, 'registry', 'assets.yaml'), 'utf8')
    await writeFile(join(root, 'registry', 'assets.yaml'), `${registryText}source:existing:\n  type: source\n  storageRef: sources/existing.yaml\n`)
    const validMerge = baseChangeSet(handle.knowledgeBaseId, [], [{ operationId: 'source-merge', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { institution: 'Institution', sourceReliability: 'high' } }])
    const validMergeResult = await skill.validateChangeSet(handle, validMerge)
    assert.equal(validMergeResult.report.status, 'passed', JSON.stringify(validMergeResult.report.errors))
    const invalidMerge = baseChangeSet(handle.knowledgeBaseId, [], [{ operationId: 'source-merge-invalid', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { sourceType: 'bad' as never, title: 'forbidden' } as never }])
    const invalidMergeResult = await skill.validateChangeSet(handle, invalidMerge)
    assert.equal(invalidMergeResult.report.status, 'failed')
    assert.ok(invalidMergeResult.report.errors.some((error) => error.code === 'SOURCE_MERGE_FIELD'))
    assert.ok(invalidMergeResult.report.errors.some((error) => error.message.includes('sourceType')))
    const invalidFieldType = baseChangeSet(handle.knowledgeBaseId, [], [{ operationId: 'source-merge-type', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { institution: 42 } as never }])
    const invalidFieldTypeResult = await skill.validateChangeSet(handle, invalidFieldType)
    assert.equal(invalidFieldTypeResult.report.status, 'failed')
    assert.ok(invalidFieldTypeResult.report.errors.some((error) => error.message.includes('institution')))
    const duplicateSourceTarget = baseChangeSet(handle.knowledgeBaseId, [], [
      { operationId: 'source-merge-a', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { author: 'A' } },
      { operationId: 'source-merge-b', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { author: 'B' } },
    ])
    const duplicateSourceTargetResult = await skill.validateChangeSet(handle, duplicateSourceTarget)
    assert.equal(duplicateSourceTargetResult.report.status, 'failed')
    assert.ok(duplicateSourceTargetResult.report.errors.some((error) => error.code === 'DUPLICATE_TARGET_MUTATION'))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('ChangeSet planned state exposes supersede replacements and rejects collisions and duplicate targets', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await loader.mount(root)
    const skill = new KnowledgeValidationSkill({ loader })
    const replacement = { id: 'segment:gpu-v2', type: 'segment', name: 'GPU v2' }
    const valid = baseChangeSet(handle.knowledgeBaseId, [
      { operationId: 'supersede-gpu', type: 'supersede', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'GPU' }), replacement },
      { operationId: 'relation-new', type: 'create', object: { id: 'relation:new-gpu', type: 'depends_on', source: 'segment:gpu-v2', target: 'segment:gpu' } },
    ])
    const validResult = await skill.validateChangeSet(handle, valid)
    assert.equal(validResult.report.status, 'passed', JSON.stringify(validResult.report.errors))

    const duplicate = baseChangeSet(handle.knowledgeBaseId, [
      { operationId: 'update-a', type: 'update', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'GPU' }), object: { id: 'segment:gpu', type: 'segment', name: 'GPU A' } },
      { operationId: 'update-b', type: 'update', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'GPU' }), object: { id: 'segment:gpu', type: 'segment', name: 'GPU B' } },
    ])
    const duplicateResult = await skill.validateChangeSet(handle, duplicate)
    assert.equal(duplicateResult.report.status, 'failed')
    assert.ok(duplicateResult.report.errors.some((error) => error.code === 'DUPLICATE_TARGET_MUTATION'))

    const stale = baseChangeSet(handle.knowledgeBaseId, [{ operationId: 'stale-update', type: 'update', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'changed' }), object: { id: 'segment:gpu', type: 'segment', name: 'GPU' } }])
    const staleResult = await skill.validateChangeSet(handle, stale)
    assert.equal(staleResult.report.status, 'failed')
    assert.ok(staleResult.report.errors.some((error) => error.code === 'STALE_TARGET_HASH'))

    const collision = baseChangeSet(handle.knowledgeBaseId, [
      { operationId: 'supersede-a', type: 'supersede', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'GPU' }), replacement: { id: 'segment:duplicate', type: 'segment', name: 'A' } },
      { operationId: 'supersede-b', type: 'supersede', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject({ id: 'segment:gpu', type: 'segment', name: 'GPU' }), replacement: { id: 'segment:duplicate', type: 'segment', name: 'B' } },
      { operationId: 'create-collision', type: 'create', object: { id: 'segment:duplicate', type: 'segment', name: 'C' } },
    ])
    const collisionResult = await skill.validateChangeSet(handle, collision)
    assert.equal(collisionResult.report.status, 'failed')
    assert.ok(collisionResult.report.errors.some((error) => error.code === 'SUPERSEDE_COLLISION'))
    assert.ok(collisionResult.report.errors.some((error) => error.code === 'CREATE_COLLISION'))
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
