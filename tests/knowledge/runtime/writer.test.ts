import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeWriter, hashKnowledgeObject, putRaw } from '../../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeChangeSet, KnowledgeWritableObject, ValidatedKnowledgeChangeSet } from '../../../packages/schemas/knowledge/index.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from './helpers.ts'

function changeSet(handleId: string, revision: number, operations: KnowledgeChangeSet['knowledgeOperations'] = [], sourceOperations: KnowledgeChangeSet['sourceOperations'] = [], id = 'changeset-1'): KnowledgeChangeSet {
  return {
    changeSetId: id,
    workflowRunId: `workflow-${id}`,
    knowledgeBaseId: handleId,
    schemaVersion: '0.2',
    expectedBaseRevision: revision,
    requiresRawProvenance: false,
    sourceOperations,
    knowledgeOperations: operations,
    ingestionContext: { reason: 'runtime test' },
  }
}

async function prepare(root: string) {
  const registry = new KnowledgeBaseRegistry()
  const loader = new KnowledgeBaseLoader({ registry })
  const handle = await loader.mount(root)
  const validation = new KnowledgeValidationSkill({ loader })
  const writer = new KnowledgeWriter({ loader, registry, clock: () => '2026-08-26T01:00:00.000Z' })
  return { registry, loader, handle, validation, writer }
}

async function validate(validation: KnowledgeValidationSkill, handle: Awaited<ReturnType<KnowledgeBaseLoader['mount']>>, value: KnowledgeChangeSet): Promise<ValidatedKnowledgeChangeSet> {
  const result = await validation.validateChangeSet(handle, value)
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report.errors))
  assert.ok(result.validatedChangeSet)
  return result.validatedChangeSet
}

test('Knowledge Writer commits create, refreshes handles, preserves old snapshots, and is idempotent', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const { loader, handle, validation, writer } = await prepare(root)
    const oldIndex = await loader.load(handle)
    const object: KnowledgeWritableObject = { id: 'product:liquid-cooling', type: 'product', name: 'Liquid Cooling' }
    const request = changeSet(handle.knowledgeBaseId, 0, [{ operationId: 'create-liquid-cooling', type: 'create', object }])
    const receipt = await validate(validation, handle, request)
    const committed = await writer.write(handle, receipt)
    assert.equal(committed.status, 'committed')
    assert.equal(committed.committedRevision, 1)
    assert.equal(handle.revision, 0)
    assert.equal((committed.committedHandle as { revision: number }).revision, 1)
    assert.equal(oldIndex.entities.has(object.id), false)
    const fresh = await loader.mount(root)
    assert.equal(fresh.revision, 1)
    assert.equal((await loader.readAssets(fresh)).entities.some((asset) => asset.value.id === object.id), true)
    const retry = await writer.write(handle, receipt)
    assert.equal(retry.status, 'already_committed')
    assert.equal(retry.committedRevision, 1)
    const log = await readFile(`${root}/logs/ingestion/workflow-changeset-1.yaml`, 'utf8')
    assert.match(log, /committedRevision/)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('Knowledge Writer applies update, supersede, merge_source, and source provenance', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const { loader, handle, validation, writer } = await prepare(root)
    const raw = await putRaw({ rawRoot: root, bytes: Buffer.from('research'), originalFilename: 'research.pdf', contentType: 'application/pdf', capturedAt: '2026-08-26T00:00:00.000Z' })
    const source: KnowledgeChangeSet['sourceOperations'][number] = { operationId: 'source-create', type: 'source_create', source: { id: 'source:research', type: 'report', title: 'Research', publisher: 'Test', publishedAt: '2026-08-26', rawRefs: [raw.manifest.rawRef] } }
    const createSource = changeSet(handle.knowledgeBaseId, 0, [], [source], 'changeset-source')
    createSource.requiresRawProvenance = true
    const sourceReceipt = await validate(validation, handle, createSource)
    const sourceResult = await writer.write(handle, sourceReceipt)
    assert.equal(sourceResult.status, 'committed')
    const first = await loader.mount(root)
    const current = (await loader.readAssets(first)).entities.find((asset) => asset.value.id === 'segment:gpu')
    assert.ok(current)
    const updated: KnowledgeWritableObject = { ...current.value, description: 'Updated' }
    const updateRequest = changeSet(first.knowledgeBaseId, 1, [{ operationId: 'update-gpu', type: 'update', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject(current.value), object: updated }], [], 'changeset-update')
    const updateResult = await writer.write(first, await validate(validation, first, updateRequest))
    assert.equal(updateResult.status, 'committed')
    const second = await loader.mount(root)
    const updatedAsset = (await loader.readAssets(second)).entities.find((asset) => asset.value.id === 'segment:gpu')
    assert.equal(updatedAsset?.value.description, 'Updated')
    const replacement: KnowledgeWritableObject = { id: 'segment:gpu-v2', type: 'segment', name: 'GPU v2' }
    const supersedeRequest = changeSet(second.knowledgeBaseId, 2, [{ operationId: 'supersede-gpu', type: 'supersede', knowledgeId: 'segment:gpu', expectedBeforeHash: hashKnowledgeObject(updatedAsset?.value), replacement }], [], 'changeset-supersede')
    const supersedeResult = await writer.write(second, await validate(validation, second, supersedeRequest))
    assert.equal(supersedeResult.status, 'committed')
    const third = await loader.mount(root)
    const assets = await loader.readAssets(third)
    const old = assets.entities.find((asset) => asset.value.id === 'segment:gpu')
    assert.equal((old?.value.lifecycle as { status?: string })?.status, 'superseded')
    assert.deepEqual(old?.value.supersededBy, ['segment:gpu-v2'])
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('stale target and receipt are rejected without changing the KB', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const { handle, validation, writer } = await prepare(root)
    const object = { id: 'product:stale', type: 'product', name: 'Stale' } as KnowledgeWritableObject
    const request = changeSet(handle.knowledgeBaseId, 0, [{ operationId: 'create-stale', type: 'create', object }], [], 'changeset-stale')
    const receipt = await validate(validation, handle, request)
    const forged = { ...receipt, changeSetHash: hashKnowledgeObject({ different: true }) } as ValidatedKnowledgeChangeSet
    const rejected = await writer.write(handle, forged)
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.error?.code, 'invalid_validation_receipt')
    await writeFile(`${root}/manifest.yaml`, (await readFile(`${root}/manifest.yaml`, 'utf8')).replace('revision: 0', 'revision: 1'), 'utf8')
    const stale = await writer.write(handle, receipt)
    assert.equal(stale.status, 'rejected')
    assert.equal(stale.error?.code, 'stale_base_revision')
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('recovery completes staged switch after injected failure', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const { handle, validation, loader, registry } = await prepare(root)
    const object = { id: 'product:recovery', type: 'product', name: 'Recovery' } as KnowledgeWritableObject
    const request = changeSet(handle.knowledgeBaseId, 0, [{ operationId: 'create-recovery', type: 'create', object }], [], 'changeset-recovery')
    const receipt = await validate(validation, handle, request)
    const writer = new KnowledgeWriter({ loader, registry, failpoint: (point) => { if (point === 'during_switch') throw new Error('injected switch failure') } })
    const failed = await writer.write(handle, receipt)
    assert.equal(failed.status, 'failed')
    const { recoverKnowledgeBaseWrite } = await import('../../../packages/shared/knowledge-base/index.ts')
    assert.equal(await recoverKnowledgeBaseWrite(root), 'recovered')
    const fresh = await registry.refresh(root)
    assert.equal(fresh.revision, 1)
    assert.equal((await loader.readAssets(fresh)).entities.some((asset) => asset.value.id === object.id), true)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})

test('same Knowledge Base writers serialize and conflicting ChangeSet payloads are rejected', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const { handle, validation, loader, registry } = await prepare(root)
    const firstObject = { id: 'product:concurrent-a', type: 'product', name: 'A' } as KnowledgeWritableObject
    const firstRequest = changeSet(handle.knowledgeBaseId, 0, [{ operationId: 'create-concurrent-a', type: 'create', object: firstObject }], [], 'changeset-concurrent')
    const firstReceipt = await validate(validation, handle, firstRequest)
    const secondObject = { id: 'product:concurrent-b', type: 'product', name: 'B' } as KnowledgeWritableObject
    const secondRequest = { ...firstRequest, knowledgeOperations: [{ operationId: 'create-concurrent-b', type: 'create', object: secondObject }] }
    const secondReceipt = await validate(validation, handle, secondRequest)
    const writerA = new KnowledgeWriter({ loader, registry })
    const writerB = new KnowledgeWriter({ loader, registry })
    const [first, second] = await Promise.all([writerA.write(handle, firstReceipt), writerB.write(handle, secondReceipt)])
    assert.equal(first.status, 'committed')
    assert.equal(second.status, 'rejected')
    assert.equal(second.error?.code, 'idempotency_conflict')
    assert.equal((await registry.refresh(root)).revision, 1)
  } finally {
    await removeRuntimeKnowledgeBase(root)
  }
})
