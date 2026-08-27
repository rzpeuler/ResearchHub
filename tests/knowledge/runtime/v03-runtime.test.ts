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
