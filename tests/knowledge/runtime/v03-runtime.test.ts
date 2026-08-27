import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveRaw, KnowledgeBaseLoader, KnowledgeBaseRegistry, hashKnowledgeObject, recoverKnowledgeBaseRoot } from '../../../packages/shared/knowledge-base/index.ts'
import { createKnowledgeAccessSession } from '../../../packages/skills/knowledge-access/index.ts'
import { createKnowledgeStagedStateValidator, KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { KnowledgeWriter } from '../../../packages/shared/knowledge-base/write/index.ts'
import type { KnowledgeChangeSetV03 } from '../../../packages/schemas/knowledge/v03/mutation.ts'

async function put(root: string, path: string, value: unknown): Promise<void> {
  const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-v03-runtime-'))
  await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-v03-runtime', name: 'v0.3 runtime fixture', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' })
  await put(root, 'entities/company.yaml', { id: 'entity:example-company', type: 'company', name: 'Example Company', lifecycle: { status: 'active' } })
  await put(root, 'entities/industry.yaml', { id: 'entity:semiconductor', type: 'industry', name: 'Semiconductor', lifecycle: { status: 'active' } })
  await put(root, 'sources/report.yaml', { id: 'source:report', title: 'Annual Report', sourceType: 'official_disclosure', lifecycle: { status: 'active' } })
  await put(root, 'relations/exposure.yaml', { id: 'relation:exposure', type: 'business_exposure', sourceRef: 'entity:example-company', targetRef: 'entity:semiconductor', lifecycle: { status: 'active' }, attributes: { exposureBasis: 'direct_operation', realizationStage: 'reported', materiality: 'core' }, sourceRefs: ['source:report'] })
  await put(root, 'claims/revenue.yaml', { id: 'claim:revenue', claimType: 'fact', statement: 'Example Company reports semiconductor revenue.', subjectRefs: ['relation:exposure'], sourceRefs: ['source:report'], lifecycle: { status: 'active' } })
  await put(root, 'registry/assets.yaml', {
    'entity:example-company': { type: 'entity', storageRef: 'entities/company.yaml' },
    'entity:semiconductor': { type: 'entity', storageRef: 'entities/industry.yaml' },
    'source:report': { type: 'source', storageRef: 'sources/report.yaml' },
    'relation:exposure': { type: 'relation', storageRef: 'relations/exposure.yaml' },
    'claim:revenue': { type: 'claim', storageRef: 'claims/revenue.yaml' },
  })
  await put(root, 'registry/raw.yaml', {})
  return root
}

function writableRegistry(): KnowledgeBaseRegistry {
  return new KnowledgeBaseRegistry()
}

test('Schema 0.3 uses the native adapter/index/access chain without exposing legacy Intelligence', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const state = await loader.loadRuntimeState(handle)
    assert.equal(handle.compatibility, 'compatible'); assert.equal(handle.writable, true); assert.equal(state.schemaVersion, '0.3'); assert.equal(state.index.constructor.name, 'KnowledgeIndexV03')
    const access = createKnowledgeAccessSession(handle, state.index)
    assert.equal(access.getEntity('entity:example-company').name, 'Example Company')
    assert.equal(access.getRelations('entity:example-company')[0]?.id, 'relation:exposure')
    assert.equal(access.getClaims('relation:exposure')[0]?.id, 'claim:revenue')
    assert.throws(() => access.getIntelligence('entity:example-company'), /Schema 0.3/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Schema 0.3 ChangeSet validation and the unified Writer commit atomically', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root)
    const source = { id: 'source:new-report', title: 'New Report', sourceType: 'professional_media' as const }
    const entity = { id: 'entity:new-company', type: 'company' as const, name: 'New Company', lifecycle: { status: 'active' as const } }
    const changeSet: KnowledgeChangeSetV03 = { changeSetId: 'changeset-v03-runtime', workflowRunId: 'workflow-v03-runtime', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: handle.revision, requiresRawProvenance: false, sourceOperations: [{ operationId: 'create-source', type: 'source_create', source }], knowledgeOperations: [{ operationId: 'create-entity', type: 'create', object: entity }] }
    const validation = await new KnowledgeValidationSkill({ loader }).validateChangeSet(handle, changeSet)
    assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); assert.ok(validation.validatedChangeSet)
    const validationSkill = new KnowledgeValidationSkill({ loader })
    const writer = new KnowledgeWriter({ loader, registry, clock: () => '2026-08-28T01:00:00.000Z', stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) })
    const result = await writer.write(handle, validation.validatedChangeSet!)
    assert.equal(result.status, 'committed'); assert.equal(result.committedRevision, 1)
    const committed = await loader.mount(root); const state = await loader.loadRuntimeState(committed)
    assert.equal(state.index.getEntity('entity:new-company').name, 'New Company'); assert.equal(state.index.getSource('source:new-report').title, 'New Report')
    assert.equal((await readFile(join(root, 'logs/ingestion/workflow-v03-runtime.yaml'), 'utf8')).includes('schemaVersionAtExecution'), true)
    assert.equal((await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(committed)).status, 'passed')
    assert.equal(hashKnowledgeObject(changeSet), validation.validatedChangeSet!.changeSetHash)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Raw Archive uses the same active writable v0.3 root contract', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const handle = await new KnowledgeBaseLoader({ registry }).mount(root)
    const record = await archiveRaw(handle, { bytes: Buffer.from('v03-raw'), originalFilename: 'report.txt' }, { clock: () => '2026-08-28T02:00:00.000Z' })
    assert.equal(record.manifest.rawRef.startsWith('raw-sha256-'), true)
    assert.equal((await new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader({ registry }) }).validateKnowledgeBase(handle)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source_merge planned state enables dependent Claim provenance in one ChangeSet', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root)
    const raw = await archiveRaw(handle, { bytes: Buffer.from('source-merge-raw'), originalFilename: 'report.txt' })
    const source = (await loader.loadRuntimeState(handle)).index instanceof Object ? (await loader.loadRuntimeState(handle)).index : undefined
    const sourceValue = source && 'getSource' in source ? source.getSource('source:report') : undefined
    assert.ok(sourceValue)
    const changeSet: KnowledgeChangeSetV03 = { changeSetId: 'changeset-source-merge-claim', workflowRunId: 'workflow-source-merge-claim', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: true, sourceOperations: [{ operationId: 'merge-source-raw', type: 'source_merge', sourceId: 'source:report', expectedBeforeHash: hashKnowledgeObject(sourceValue), addRawRefs: [raw.manifest.rawRef] }], knowledgeOperations: [{ operationId: 'create-dependent-claim', type: 'create', object: { id: 'claim:source-merge-dependent', claimType: 'fact', statement: 'The merged source supports this claim.', subjectRefs: ['entity:example-company'], sourceRefs: ['source:report'], provenance: [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: null, chunkRef: null }], lifecycle: { status: 'active' } } }] }
    const validationSkill = new KnowledgeValidationSkill({ loader }); const validation = await validationSkill.validateChangeSet(handle, changeSet)
    assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); assert.ok(validation.validatedChangeSet)
    const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, validation.validatedChangeSet!)
    assert.equal(result.status, 'committed'); assert.equal(result.committedRevision, 1)
    const reloaded = await loader.mount(root); const state = await loader.loadRuntimeState(reloaded); const loadedSource = state.index instanceof Object && 'getSource' in state.index ? state.index.getSource('source:report') : undefined
    assert.ok(loadedSource?.rawRefs?.includes(raw.manifest.rawRef)); assert.equal(state.index.getClaims('entity:example-company').some((claim) => claim.id === 'claim:source-merge-dependent'), true)
    assert.equal((await validationSkill.validateKnowledgeBase(reloaded)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('validated Schema 0.3 receipts are deeply immutable clones', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const original: KnowledgeChangeSetV03 = { changeSetId: 'changeset-deep-freeze', workflowRunId: 'workflow-deep-freeze', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: 'create-frozen-entity', type: 'create', object: { id: 'entity:frozen-company', type: 'company', name: 'Frozen Company', aliases: ['Frozen'], metadata: { nested: { value: true } }, lifecycle: { status: 'active' } } }], ingestionContext: { nested: { state: 'unchanged' } } }
    const result = await new KnowledgeValidationSkill({ loader }).validateChangeSet(handle, original); assert.ok(result.validatedChangeSet); const receipt = result.validatedChangeSet!
    assert.notEqual(receipt.changeSet, original); assert.equal(Object.isFrozen(receipt.changeSet), true); assert.equal(Object.isFrozen(receipt.changeSet.knowledgeOperations), true); assert.equal(Object.isFrozen(receipt.changeSet.knowledgeOperations[0]), true); assert.equal(Object.isFrozen(receipt.changeSet.knowledgeOperations[0].object), true); assert.equal(Object.isFrozen((receipt.changeSet.knowledgeOperations[0].object as { metadata: { nested: object } }).metadata.nested), true); assert.equal(Object.isFrozen(receipt.changeSet.ingestionContext), true)
    const beforeHash = receipt.changeSetHash; assert.throws(() => { (receipt.changeSet.knowledgeOperations[0].object as { name: string }).name = 'mutated' }); assert.throws(() => { (receipt.changeSet.ingestionContext as { nested: { state: string } }).nested.state = 'mutated' }); assert.equal(original.knowledgeOperations[0]!.object.name, 'Frozen Company'); assert.equal(hashKnowledgeObject(receipt.changeSet), beforeHash)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('representative v0.3 ChangeSet creates ThemeGroup, Entity, Relation, and Claim', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const changeSet: KnowledgeChangeSetV03 = { changeSetId: 'changeset-representative-v03', workflowRunId: 'workflow-representative-v03', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [{ operationId: 'create-representative-source', type: 'source_create', source: { id: 'source:representative', title: 'Representative Report', sourceType: 'professional_media' } }], knowledgeOperations: [{ operationId: 'create-theme-group', type: 'create', object: { id: 'theme-group:representative', name: 'Representative', aliases: [], lifecycle: { status: 'active' } } }, { operationId: 'create-theme', type: 'create', object: { id: 'entity:representative-theme', type: 'investment_theme', name: 'Representative Theme', themeGroupRef: 'theme-group:representative', lifecycle: { status: 'active' } } }, { operationId: 'create-industry', type: 'create', object: { id: 'entity:representative-industry', type: 'industry', name: 'Representative Industry', lifecycle: { status: 'active' } } }, { operationId: 'create-company', type: 'create', object: { id: 'entity:representative-company', type: 'company', name: 'Representative Company', lifecycle: { status: 'active' } } }, { operationId: 'create-exposure', type: 'create', object: { id: 'relation:representative-exposure', type: 'business_exposure', sourceRef: 'entity:representative-company', targetRef: 'entity:representative-industry', attributes: { exposureBasis: 'direct_operation', realizationStage: 'commercialized', materiality: 'material' }, sourceRefs: ['source:representative'], lifecycle: { status: 'active' } } }, { operationId: 'create-claim', type: 'create', object: { id: 'claim:representative', claimType: 'fact', statement: 'Representative Company operates in Representative Industry.', subjectRefs: ['relation:representative-exposure'], sourceRefs: ['source:representative'], lifecycle: { status: 'active' } } }] }
    const validation = await validationSkill.validateChangeSet(handle, changeSet); assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, validation.validatedChangeSet!)
    assert.equal(result.status, 'committed'); assert.equal(result.committedRevision, 1); const reloaded = await loader.mount(root); const state = await loader.loadRuntimeState(reloaded); assert.equal(state.index.getThemeGroup('theme-group:representative').name, 'Representative'); assert.equal(state.index.getClaims('relation:representative-exposure')[0]?.id, 'claim:representative'); assert.equal(state.index.getSource('source:representative').title, 'Representative Report'); assert.equal((await validationSkill.validateKnowledgeBase(reloaded)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 Relation update preserves ID/storageRef and Business Exposure uniqueness', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const state = await loader.loadRuntimeState(handle); const relation = state.index.getRelations('entity:example-company')[0]!; const beforeStorage = (await loader.readRuntimeAssets(handle)).relations.find((asset) => asset.value.id === relation.id)?.storageRef
    const updated = { ...relation, attributes: { exposureBasis: 'direct_operation' as const, realizationStage: 'commercialized' as const, materiality: 'material' as const } }; const update: KnowledgeChangeSetV03 = { changeSetId: 'changeset-relation-update', workflowRunId: 'workflow-relation-update', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: 'update-exposure', type: 'update', knowledgeId: relation.id, expectedBeforeHash: hashKnowledgeObject(relation), object: updated }] }
    const validation = await validationSkill.validateChangeSet(handle, update); assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, validation.validatedChangeSet!); assert.equal(result.status, 'committed'); assert.equal(result.committedRevision, 1); const reloaded = await loader.mount(root); const afterStorage = (await loader.readRuntimeAssets(reloaded)).relations.find((asset) => asset.value.id === relation.id)?.storageRef; assert.equal(afterStorage, beforeStorage); assert.equal((await validationSkill.validateKnowledgeBase(reloaded)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 Writer rechecks stale target hash after validation', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const assets = await loader.readRuntimeAssets(handle); const relationAsset = assets.relations.find((asset) => asset.value.id === 'relation:exposure')!; const relation = relationAsset.value
    const update: KnowledgeChangeSetV03 = { changeSetId: 'changeset-v03-stale-target', workflowRunId: 'workflow-v03-stale-target', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: 'update-stale-target', type: 'update', knowledgeId: relation.id, expectedBeforeHash: hashKnowledgeObject(relation), object: { ...relation, attributes: { ...relation.attributes, materiality: 'material' } } }] }
    const receipt = (await validationSkill.validateChangeSet(handle, update)).validatedChangeSet!; await writeFile(join(root, relationAsset.storageRef), `${JSON.stringify({ ...relation, attributes: { ...relation.attributes, materiality: 'immaterial' } })}\n`, 'utf8')
    const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, receipt)
    assert.equal(result.status, 'rejected'); assert.equal(result.error?.code, 'stale_target_state')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 Claim supersede and merge_source preserve planned and committed semantics', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const state = await loader.loadRuntimeState(handle); const oldClaim = state.index.getClaims('relation:exposure')[0]!; const replacement = { id: 'claim:revenue-revised', claimType: 'fact' as const, statement: 'Example Company reports revised semiconductor revenue.', subjectRefs: ['relation:exposure'] as ['relation:exposure'], sourceRefs: ['source:report'] as ['source:report'], lifecycle: { status: 'active' as const } }; const changeSet: KnowledgeChangeSetV03 = { changeSetId: 'changeset-claim-supersede', workflowRunId: 'workflow-claim-supersede', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: 'supersede-revenue', type: 'supersede', knowledgeId: oldClaim.id, expectedBeforeHash: hashKnowledgeObject(oldClaim), replacement }] }
    const validation = await validationSkill.validateChangeSet(handle, changeSet); assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, validation.validatedChangeSet!); assert.equal(result.status, 'committed'); const reloaded = await loader.mount(root); const nextState = await loader.loadRuntimeState(reloaded); const old = nextState.index.getClaims('relation:exposure').find((claim) => claim.id === oldClaim.id)!; const next = nextState.index.getClaims('relation:exposure').find((claim) => claim.id === replacement.id)!; assert.equal(old.lifecycle.status, 'superseded'); assert.equal(old.supersededBy?.includes(replacement.id), true); assert.equal(next.supersedes?.includes(oldClaim.id), true); assert.equal((await validationSkill.validateKnowledgeBase(reloaded)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 merge_source unions declared refs and rejects Entity targets', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const state = await loader.loadRuntimeState(handle); const claim = state.index.getClaims('relation:exposure')[0]!; const illegal: KnowledgeChangeSetV03 = { changeSetId: 'changeset-illegal-merge-source', workflowRunId: 'workflow-illegal-merge-source', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: 'merge-entity-source', type: 'merge_source', knowledgeId: 'entity:example-company', expectedBeforeHash: hashKnowledgeObject(state.index.getEntity('entity:example-company')), addSourceRefs: ['source:other'] }] }
    const illegalResult = await validationSkill.validateChangeSet(handle, illegal); assert.equal(illegalResult.report.errors.some((error) => error.code === 'MERGE_SOURCE_UNSUPPORTED'), true)
    const changeSet: KnowledgeChangeSetV03 = { changeSetId: 'changeset-merge-source', workflowRunId: 'workflow-merge-source', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [{ operationId: 'create-merge-source', type: 'source_create', source: { id: 'source:other', title: 'Other Source', sourceType: 'community' } }], knowledgeOperations: [{ operationId: 'merge-claim-source', type: 'merge_source', knowledgeId: claim.id, expectedBeforeHash: hashKnowledgeObject(claim), addSourceRefs: ['source:other', 'source:report'] }] }
    const validation = await validationSkill.validateChangeSet(handle, changeSet); assert.equal(validation.report.status, 'passed', JSON.stringify(validation.report.errors)); const result = await new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }).write(handle, validation.validatedChangeSet!); assert.equal(result.status, 'committed'); const reloaded = await loader.mount(root); const next = (await loader.loadRuntimeState(reloaded)).index.getClaims('relation:exposure')[0]!; assert.deepEqual(next.sourceRefs, ['source:other', 'source:report'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 no-op, replay, idempotency conflict, and validation-time stale target are deterministic', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader }); const source = (await loader.loadRuntimeState(handle)).index.getSource('source:report'); const noOp: KnowledgeChangeSetV03 = { changeSetId: 'changeset-no-op-v03', workflowRunId: 'workflow-no-op-v03', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [{ operationId: 'merge-no-op', type: 'source_merge', sourceId: source.id, expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: {} }], knowledgeOperations: [] }
    const noOpValidation = await validationSkill.validateChangeSet(handle, noOp); assert.equal(noOpValidation.report.status, 'passed'); const writer = new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill) }); const noOpResult = await writer.write(handle, noOpValidation.validatedChangeSet!); assert.equal(noOpResult.status, 'no_changes'); assert.equal(noOpResult.committedRevision, 0)
    const created: KnowledgeChangeSetV03 = { ...noOp, changeSetId: 'changeset-idempotent-v03', workflowRunId: 'workflow-idempotent-v03', sourceOperations: [{ operationId: 'create-idempotent-source', type: 'source_create', source: { id: 'source:idempotent', title: 'Idempotent', sourceType: 'community' } }] }; const createdValidation = await validationSkill.validateChangeSet(handle, created); const committed = await writer.write(handle, createdValidation.validatedChangeSet!); assert.equal(committed.status, 'committed'); assert.equal((await writer.write(handle, createdValidation.validatedChangeSet!)).status, 'already_committed')
    const conflict = { ...created, expectedBaseRevision: 1, sourceOperations: [{ operationId: 'merge-conflict-source', type: 'source_merge' as const, sourceId: 'source:report', expectedBeforeHash: hashKnowledgeObject(source), metadataPatch: { author: 'different' } }] }; const conflictValidation = await validationSkill.validateChangeSet(await loader.mount(root), conflict); assert.equal(conflictValidation.report.status, 'passed'); assert.equal((await writer.write(await loader.mount(root), conflictValidation.validatedChangeSet!)).error?.code, 'idempotency_conflict')
    const stale: KnowledgeChangeSetV03 = { ...noOp, changeSetId: 'changeset-stale-v03', workflowRunId: 'workflow-stale-v03', sourceOperations: [{ operationId: 'stale-source', type: 'source_merge', sourceId: source.id, expectedBeforeHash: `sha256:${'0'.repeat(64)}`, metadataPatch: { author: 'stale' } }] }; const staleResult = await validationSkill.validateChangeSet(handle, stale); assert.equal(staleResult.report.errors.some((error) => error.code === 'STALE_TARGET_STATE'), true); assert.equal(staleResult.validatedChangeSet, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 ChangeSet invalid matrix rejects canonical and semantic violations', async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader })
    const base = (suffix: string): KnowledgeChangeSetV03 => ({ changeSetId: `changeset-invalid-${suffix}`, workflowRunId: `workflow-invalid-${suffix}`, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [] })
    const cases: Array<{ name: string; changeSet: KnowledgeChangeSetV03; code: string }> = [
      { name: 'schema or storage', changeSet: { ...base('schema'), storageFormatVersion: '2' as never }, code: 'CHANGESET_SCHEMA_MISMATCH' },
      { name: 'base revision', changeSet: { ...base('base'), expectedBaseRevision: 1 }, code: 'STALE_BASE_REVISION' },
      { name: 'duplicate operation', changeSet: { ...base('operation'), sourceOperations: [{ operationId: 'duplicate-operation', type: 'source_create', source: { id: 'source:matrix-one', title: 'Matrix One', sourceType: 'community' } }, { operationId: 'duplicate-operation', type: 'source_create', source: { id: 'source:matrix-two', title: 'Matrix Two', sourceType: 'community' } }] }, code: 'OPERATION_ID' },
      { name: 'namespace', changeSet: { ...base('namespace'), knowledgeOperations: [{ operationId: 'invalid-namespace', type: 'create', object: { id: 'entity:bad/id', type: 'company', name: 'Bad ID', lifecycle: { status: 'active' } } as never }] }, code: 'V03_ID_NAMESPACE' },
      { name: 'theme group reference', changeSet: { ...base('theme'), knowledgeOperations: [{ operationId: 'invalid-theme-group', type: 'create', object: { id: 'entity:matrix-theme', type: 'investment_theme', name: 'Invalid Theme', themeGroupRef: 'theme-group:missing', lifecycle: { status: 'active' } } as never }] }, code: 'V03_THEME_GROUP_REF_INVALID' },
      { name: 'relation endpoint', changeSet: { ...base('endpoint'), knowledgeOperations: [{ operationId: 'invalid-endpoint', type: 'create', object: { id: 'relation:invalid-endpoint', type: 'business_exposure', sourceRef: 'entity:missing', targetRef: 'entity:semiconductor', sourceRefs: ['source:report'], lifecycle: { status: 'active' }, attributes: {} } as never }] }, code: 'V03_RELATION_ENDPOINT_INVALID' },
      { name: 'relation attribute', changeSet: { ...base('attribute'), knowledgeOperations: [{ operationId: 'invalid-attribute', type: 'create', object: { id: 'relation:invalid-attribute', type: 'business_exposure', sourceRef: 'entity:example-company', targetRef: 'entity:semiconductor', sourceRefs: ['source:report'], lifecycle: { status: 'active' }, attributes: { materiality: 'invalid' } } as never }] }, code: 'V03_ENUM_INVALID' },
      { name: 'duplicate business exposure', changeSet: { ...base('cardinality'), knowledgeOperations: [{ operationId: 'duplicate-exposure', type: 'create', object: { id: 'relation:duplicate-exposure', type: 'business_exposure', sourceRef: 'entity:example-company', targetRef: 'entity:semiconductor', sourceRefs: ['source:report'], lifecycle: { status: 'active' }, attributes: {} } as never }] }, code: 'V03_RELATION_CARDINALITY' },
      { name: 'claim comparator', changeSet: { ...base('claim'), knowledgeOperations: [{ operationId: 'invalid-claim', type: 'create', object: { id: 'claim:invalid-claim', claimType: 'fact', statement: 'Invalid claim', subjectRefs: ['entity:example-company'], sourceRefs: ['source:report'], structuredValue: { metric: 'revenue', value: 1, unit: 'USD', comparator: 'invalid' }, confidence: 2, lifecycle: { status: 'active' } } as never }] }, code: 'V03_STRUCTURED_VALUE_INVALID' },
      { name: 'missing source', changeSet: { ...base('source'), knowledgeOperations: [{ operationId: 'missing-source', type: 'create', object: { id: 'claim:missing-source', claimType: 'fact', statement: 'Missing source claim', subjectRefs: ['entity:example-company'], sourceRefs: ['source:missing'], lifecycle: { status: 'active' } } as never }] }, code: 'V03_SOURCE_REF_INVALID' },
      { name: 'provenance', changeSet: { ...base('provenance'), knowledgeOperations: [{ operationId: 'invalid-provenance', type: 'create', object: { id: 'claim:invalid-provenance', claimType: 'fact', statement: 'Invalid provenance claim', subjectRefs: ['entity:example-company'], sourceRefs: ['source:report'], provenance: [{ sourceRef: 'source:report', rawRef: 'raw-sha256-invalid', locator: null, chunkRef: null }], lifecycle: { status: 'active' } } as never }] }, code: 'V03_PROVENANCE_INVALID' },
      { name: 'illegal supersede', changeSet: { ...base('supersede'), knowledgeOperations: [{ operationId: 'illegal-supersede', type: 'supersede', knowledgeId: 'entity:example-company', expectedBeforeHash: hashKnowledgeObject({ id: 'entity:example-company' }), replacement: { id: 'claim:replacement', claimType: 'fact', statement: 'Replacement', subjectRefs: ['entity:example-company'], sourceRefs: ['source:report'], lifecycle: { status: 'active' } } }] }, code: 'ILLEGAL_SUPERSEDE' },
      { name: 'illegal merge source', changeSet: { ...base('merge-source'), knowledgeOperations: [{ operationId: 'illegal-merge-source', type: 'merge_source', knowledgeId: 'entity:example-company', expectedBeforeHash: hashKnowledgeObject({ id: 'entity:example-company' }), addSourceRefs: ['source:report'] }] }, code: 'MERGE_SOURCE_UNSUPPORTED' },
    ]
    for (const entry of cases) {
      const result = await validationSkill.validateChangeSet(handle, entry.changeSet)
      assert.equal(result.report.status, 'failed', entry.name)
      assert.equal(result.report.errors.some((error) => error.code === entry.code), true, `${entry.name}: ${JSON.stringify(result.report.errors)}`)
      assert.equal(result.validatedChangeSet, undefined, entry.name)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const point of ['before_switch', 'during_switch', 'after_switch'] as const) test(`Schema 0.3 Writer recovers the ${point} root transaction`, async () => {
  const root = await createRoot()
  try {
    const registry = writableRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await loader.mount(root); const validationSkill = new KnowledgeValidationSkill({ loader })
    const object = { id: `entity:recovery-${point.replace('_', '-')}`, type: 'company' as const, name: `Recovery ${point}`, lifecycle: { status: 'active' as const } }
    const changeSet: KnowledgeChangeSetV03 = { changeSetId: `changeset-recovery-${point}`, workflowRunId: `workflow-recovery-${point}`, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', storageFormatVersion: '1', expectedBaseRevision: 0, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [{ operationId: `create-${point}`, type: 'create', object }] }
    const validated = (await validationSkill.validateChangeSet(handle, changeSet)).validatedChangeSet!
    const writer = new KnowledgeWriter({ loader, registry, stagedStateValidator: createKnowledgeStagedStateValidator(validationSkill), failpoint: (current) => { if (current === point) throw new Error(`injected ${point}`) } })
    const failed = await writer.write(handle, validated); assert.equal(failed.status, 'failed')
    await recoverKnowledgeBaseRoot(root)
    const recovered = await registry.refresh(root); const state = await loader.loadRuntimeState(recovered)
    if (point === 'during_switch' || point === 'after_switch') assert.equal(state.index.getEntity(object.id).name, object.name)
    else assert.throws(() => state.index.getEntity(object.id), /Entity not found/)
    assert.equal((await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(recovered)).status, 'passed')
  } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}.recovery.json`, { force: true }) }
})
