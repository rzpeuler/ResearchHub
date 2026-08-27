import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeCurationSkill } from '../../../packages/skills/knowledge-curation/index.ts'
import { createKnowledgeMigrationStateValidator, KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { archiveRaw, KnowledgeBaseLoader, KnowledgeBaseRegistry, KnowledgeMigrationRunner, KnowledgeWriter, DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY, hashKnowledgeObject, recoverKnowledgeBaseRoot } from '../../../packages/shared/knowledge-base/index.ts'
import { KnowledgeMigrationPathError, KnowledgeMigrationRegistry } from '../../../packages/schemas/knowledge/index.ts'
import type { KnowledgeChangeSet, ValidatedKnowledgeChangeSet } from '../../../packages/schemas/knowledge/index.ts'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'

async function put(root: string, path: string, text: string): Promise<void> { const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, text, 'utf8') }

async function createV01(options: { knowledgeBaseId?: string; bindings?: string; raw?: boolean; rawRefs?: string[]; rawRegistry?: string; invalidSource?: boolean; invalidReliability?: boolean; status?: string; scanOnly?: boolean; moduleTarget?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-migration-v01-'))
  await put(root, 'manifest.yaml', `knowledgeBaseId: ${options.knowledgeBaseId ?? 'kb-migration-test'}\nname: Migration Test Knowledge Base\nschemaVersion: "0.1"\nstorageFormatVersion: "1"\nrevision: 4\nstatus: ${options.status ?? 'active'}\ncreatedAt: 2026-08-20T00:00:00.000Z\nupdatedAt: 2026-08-25T00:00:00.000Z\n`)
  await put(root, 'entities/gpu.yaml', 'id: segment:gpu\ntype: segment\nname: GPU\ndescription: Compute hardware\n')
  await put(root, 'entities/nvidia.yaml', 'id: company:nvidia\ntype: company\nname: NVIDIA\n')
  await put(root, 'relations/nvidia-operates-in-gpu.yaml', 'id: relation:nvidia-operates-in-gpu\ntype: operates_in\nsource: company:nvidia\ntarget: segment:gpu\n')
  await put(root, 'intelligence/facts/gpu-role.yaml', 'id: fact:gpu-role\ntype: fact\nentityRefs: ["segment:gpu"]\nstatement: GPU provides AI compute capacity.\n')
  await put(root, 'modules/comparison/gpu-products.yaml', `id: module:gpu-products\ntype: comparison\nschemaId: product-comparison\n${options.scanOnly || options.moduleTarget ? `targetEntity: ${options.moduleTarget ?? 'segment:gpu'}\n` : ''}columns: ["product"]\nrows: []\n`)
  await put(root, 'sources/market-outlook.yaml', `id: source:market-outlook\ntype: research_report\ntitle: AI Hardware Outlook\npublisher: Research House\npublishedAt: 2026-08-25\n${options.rawRefs ? `rawRefs: [${options.rawRefs.map((ref) => `"${ref}"`).join(', ')}]\n` : ''}${options.invalidSource ? 'sourceType: impossible_type\n' : ''}${options.invalidReliability ? 'sourceReliability: impossible_reliability\n' : ''}`)
  if (!options.scanOnly) {
    await put(root, 'registry/index.yaml', `assets:\n  - id: segment:gpu\n    type: entity\n    path: entities/gpu.yaml\n  - id: company:nvidia\n    type: entity\n    path: entities/nvidia.yaml\n  - id: relation:nvidia-operates-in-gpu\n    type: relation\n    path: relations/nvidia-operates-in-gpu.yaml\n  - id: fact:gpu-role\n    type: intelligence\n    path: intelligence/facts/gpu-role.yaml\n  - id: module:gpu-products\n    type: module\n    path: modules/comparison/gpu-products.yaml\n  - id: source:market-outlook\n    type: source\n    path: sources/market-outlook.yaml\n`)
    if (options.bindings !== undefined) await put(root, 'registry/modules.yaml', options.bindings)
    else await put(root, 'registry/modules.yaml', 'bindings:\n  - entityId: segment:gpu\n    moduleIds: ["module:gpu-products"]\n')
  }
  if (options.rawRegistry !== undefined) await put(root, 'registry/raw.yaml', options.rawRegistry)
  if (options.raw) await put(root, 'raw/legacy.bin', 'legacy raw')
  return root
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result[path.slice(root.length + 1)] = (await readFile(path)).toString('base64')
    }
  }
  await visit(root)
  return result
}

function runner(registry: KnowledgeBaseRegistry, clock = () => '2026-08-26T00:00:00.000Z') {
  const loader = new KnowledgeBaseLoader({ registry })
  const validation = new KnowledgeValidationSkill({ loader })
  return new KnowledgeMigrationRunner({ registry, validator: createKnowledgeMigrationStateValidator(validation), clock })
}

test('migration registry resolves 0.1 to 0.2 and default compatibility exposes migrationAvailable', async () => {
  assert.equal(DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY.resolvePath({ schemaVersion: '0.1', storageFormatVersion: '1' }, { schemaVersion: '0.2', storageFormatVersion: '1' })[0]?.id, 'knowledge-schema-0.1-to-0.2')
  assert.equal(DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY.resolvePath({ schemaVersion: '0.2', storageFormatVersion: '1' }, { schemaVersion: '0.3', storageFormatVersion: '1' })[0]?.id, 'knowledge-schema-0.2-to-0.3')
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const before = await snapshot(root)
    const handle = await registry.mount(root)
    const compatibility = registry.compatibilityResolver.resolve({ schemaVersion: '0.1', storageFormatVersion: '1', status: 'active' })
    assert.equal(handle.compatibility, 'read_only_compatible')
    assert.equal(compatibility.migrationAvailable, true)
    assert.equal(compatibility.readable, true)
    assert.equal(compatibility.writable, false)
    assert.ok((await new KnowledgeBaseLoader({ registry }).load(handle)).entities.has('segment:gpu'))
    const index = await new KnowledgeBaseLoader({ registry }).load(handle)
    assert.equal(new KnowledgeAccessSkill({ handle, index }).getEntity('segment:gpu').name, 'GPU')
    assert.deepEqual(await snapshot(root), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('valid v0.1 migration dry-run is deterministic and leaves the canonical tree unchanged', async () => {
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const before = await snapshot(root)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'dry-run-valid', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(result.status, 'dry_run_passed', JSON.stringify(result))
    assert.deepEqual(result.inventory.before.counts, result.inventory.after?.counts)
    assert.deepEqual(result.idMappings, [])
    assert.equal(result.reviewItems.length, 0)
    assert.equal(result.validation.source, 'passed')
    assert.equal(result.validation.target, 'passed')
    assert.deepEqual(await snapshot(root), before)
    assert.equal((await readdir(dirname(root))).some((name) => name.startsWith(`${basename(root)}.migration-staging-`)), false)
    assert.equal(result.migrationLogRef, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('commit converts the full v0.1 KB, preserves identity, refreshes Handle, and writes migration log', async () => {
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const oldHandle = await registry.mount(root)
    const oldIndex = await loader.load(oldHandle)
    const oldAccess = new KnowledgeAccessSkill({ handle: oldHandle, index: oldIndex })
    const result = await runner(registry).migrate(oldHandle, { migrationRunId: 'commit-valid', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(result.status, 'committed', JSON.stringify(result))
    assert.equal(result.target.revision, 5)
    assert.equal(result.committedHandle?.schemaVersion, '0.2')
    assert.equal(result.committedHandle?.writable, true)
    assert.equal(oldHandle.schemaVersion, '0.1')
    assert.equal(oldAccess.getEntity('segment:gpu').name, 'GPU')
    const manifest = await readFile(join(root, 'manifest.yaml'), 'utf8')
    assert.match(manifest, /"schemaVersion":"0\.2"/)
    assert.match(manifest, /"revision":5/)
    assert.match(manifest, /"knowledgeBaseId":"kb-migration-test"/)
    assert.match(manifest, /"status":"active"/)
    assert.match(await readFile(join(root, 'modules/comparison/gpu-products.yaml'), 'utf8'), /"targetEntity":"segment:gpu"/)
    assert.equal((await readFile(join(root, 'registry/raw.yaml'), 'utf8')).trim(), '{}')
    await assert.rejects(readFile(join(root, 'registry/index.yaml'), 'utf8'))
    await assert.rejects(readFile(join(root, 'registry/modules.yaml'), 'utf8'))
    assert.equal((await readFile(join(root, 'logs/migrations/commit-valid.yaml'), 'utf8')).includes('knowledge-schema-0.1-to-0.2'), true)
    const fresh = await loader.load(result.committedHandle!)
    assert.deepEqual([...fresh.entities.keys()].sort(), ['company:nvidia', 'segment:gpu'])
    assert.equal(fresh.getRelationsFor('company:nvidia')[0]?.target, 'segment:gpu')
    assert.deepEqual(fresh.moduleRegistry.get('segment:gpu'), ['module:gpu-products'])
    const alreadyCurrent = await runner(registry).migrate(result.committedHandle!, { migrationRunId: 'already-current', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 5, mode: 'dry_run' })
    assert.equal(alreadyCurrent.status, 'already_current')
    assert.equal(alreadyCurrent.target.revision, 5)
    await assert.rejects(readFile(join(root, 'logs/migrations/already-current.yaml'), 'utf8'))
    const staleRevision = await runner(registry).migrate(result.committedHandle!, { migrationRunId: 'already-current-stale', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(staleRevision.status, 'blocked')
    assert.equal(staleRevision.error?.code, 'stale_base_revision')
    const staleHandle = await runner(registry).migrate(oldHandle, { migrationRunId: 'stale-handle', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 5, mode: 'dry_run' })
    assert.equal(staleHandle.status, 'blocked')
    assert.equal(staleHandle.error?.code, 'stale_handle')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('successful migration preserves taxonomy, views, historical ingestion logs, and auxiliary files byte-for-byte', async () => {
  const root = await createV01()
  try {
    await put(root, 'taxonomy/sw-level-1.yaml', 'id: taxonomy:sw-level-1\nname: Industry\n')
    await put(root, 'views/industry-overview.yaml', 'view: industry-overview\n')
    await put(root, 'logs/ingestion/historical.yaml', 'workflowRunId: historical\nstatus: completed\n')
    await put(root, 'README.md', 'legacy auxiliary note\n')
    const before = await snapshot(root)
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'preserve-non-migration', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(result.status, 'committed', JSON.stringify(result))
    const after = await snapshot(root)
    for (const path of ['taxonomy/sw-level-1.yaml', 'views/industry-overview.yaml', 'logs/ingestion/historical.yaml', 'README.md']) assert.equal(after[path], before[path], path)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('review-required migration never switches the root or writes a migration log', async () => {
  const root = await createV01({ bindings: 'bindings: []\n' })
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const before = await snapshot(root)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'review-module', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(result.status, 'review_required')
    assert.equal(result.reviewItems[0]?.code, 'module_target_missing')
    assert.deepEqual(await snapshot(root), before)
    await assert.rejects(readFile(join(root, 'logs/migrations/review-module.yaml'), 'utf8'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source semantic ambiguity survives target validation and remains review-required', async () => {
  for (const [name, option, code] of [
    ['source-type', { invalidSource: true }, 'source_semantic_mapping_required'],
    ['source-reliability', { invalidReliability: true }, 'source_semantic_mapping_required'],
  ] as const) {
    const root = await createV01(option)
    try {
      const registry = new KnowledgeBaseRegistry()
      const handle = await registry.mount(root)
      const before = await snapshot(root)
      const result = await runner(registry).migrate(handle, { migrationRunId: `review-${name}`, targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
      assert.equal(result.status, 'review_required', JSON.stringify(result))
      assert.equal(result.reviewItems.some((item) => item.code === code), true)
      assert.equal(result.validation.target, 'failed')
      assert.deepEqual(await snapshot(root), before)
      await assert.rejects(readFile(join(root, `logs/migrations/review-${name}.yaml`), 'utf8'))
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Raw provenance ambiguity covers missing registry, missing reference, and legacy content', async () => {
  for (const [name, option] of [
    ['missing-registry', { rawRefs: ['raw-sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }],
    ['missing-reference', { rawRefs: ['raw-sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], rawRegistry: '{}\n' }],
    ['legacy-content', { raw: true }],
  ] as const) {
    const root = await createV01(option)
    try {
      const registry = new KnowledgeBaseRegistry()
      const handle = await registry.mount(root)
      const before = await snapshot(root)
      const result = await runner(registry).migrate(handle, { migrationRunId: `review-raw-${name}`, targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
      assert.equal(result.status, 'review_required', JSON.stringify(result))
      assert.equal(result.reviewItems.some((item) => item.code === 'raw_provenance_mapping_required'), true)
      assert.deepEqual(await snapshot(root), before)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('module target matrix is review-required and never commits', async () => {
  const cases = [
    ['module-missing', { bindings: 'bindings: []\n' }, 'module_target_missing'],
    ['module-ambiguous', { bindings: 'bindings:\n  - entityId: segment:gpu\n    moduleIds: ["module:gpu-products"]\n  - entityId: company:nvidia\n    moduleIds: ["module:gpu-products"]\n' }, 'module_target_ambiguous'],
    ['module-conflict', { moduleTarget: 'company:nvidia' }, 'module_target_conflict'],
  ] as const
  for (const [name, option, code] of cases) {
    const root = await createV01(option)
    try {
      const registry = new KnowledgeBaseRegistry()
      const handle = await registry.mount(root)
      const before = await snapshot(root)
      const result = await runner(registry).migrate(handle, { migrationRunId: name, targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
      assert.equal(result.status, 'review_required', JSON.stringify(result))
      assert.equal(result.reviewItems.some((item) => item.code === code), true)
      assert.deepEqual(await snapshot(root), before)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('migration path resolution rejects equally short alternatives and Runner reports stable ambiguity', async () => {
  const migrationRegistry = new KnowledgeMigrationRegistry()
    .register({ id: 'v01-to-a', source: { schemaVersion: '0.1', storageFormatVersion: '1' }, target: { schemaVersion: 'A', storageFormatVersion: '1' } })
    .register({ id: 'a-to-v03', source: { schemaVersion: 'A', storageFormatVersion: '1' }, target: { schemaVersion: '0.3', storageFormatVersion: '1' } })
    .register({ id: 'v01-to-b', source: { schemaVersion: '0.1', storageFormatVersion: '1' }, target: { schemaVersion: 'B', storageFormatVersion: '1' } })
    .register({ id: 'b-to-v03', source: { schemaVersion: 'B', storageFormatVersion: '1' }, target: { schemaVersion: '0.3', storageFormatVersion: '1' } })
  assert.throws(() => migrationRegistry.resolvePath({ schemaVersion: '0.1', storageFormatVersion: '1' }, { schemaVersion: '0.3', storageFormatVersion: '1' }), KnowledgeMigrationPathError)
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const result = await new KnowledgeMigrationRunner({ registry, migrationRegistry, validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader({ registry }) })) }).migrate(handle, { migrationRunId: 'path-ambiguous', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'migration_path_ambiguous')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('migration failpoint leaves a recoverable marker and recovery activates the complete target', async () => {
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const migrationRunner = new KnowledgeMigrationRunner({
      registry,
      validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader({ registry }) })),
      clock: () => '2026-08-26T00:00:00.000Z',
      failpoint: async (point) => { if (point === 'during_switch') throw new Error('injected migration switch failure') },
    })
    const result = await migrationRunner.migrate(handle, { migrationRunId: 'failpoint-switch', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.message, 'injected migration switch failure')
    assert.equal((await readdir(dirname(root))).some((name) => name.includes('.recovery.json')), true)
    assert.equal(await recoverKnowledgeBaseRoot(root), 'recovered')
    const refreshed = await registry.refresh(root)
    assert.equal(refreshed.schemaVersion, '0.2')
    assert.equal(refreshed.revision, 5)
    await assert.rejects(readFile(`${root}.recovery.json`, 'utf8'))
  } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}.recovery.json`, { force: true }); await rm(`${root}.backup-${'x'.repeat(16)}`, { recursive: true, force: true }) }
})

test('before-switch and after-switch failures recover to one coherent source or target state', async () => {
  for (const point of ['before_switch', 'after_switch'] as const) {
    const root = await createV01()
    try {
      const registry = new KnowledgeBaseRegistry()
      const handle = await registry.mount(root)
      const migrationRunner = new KnowledgeMigrationRunner({
        registry,
        validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader({ registry }) })),
        clock: () => '2026-08-26T00:00:00.000Z',
        failpoint: async (current) => { if (current === point) throw new Error(`injected ${point} failure`) },
      })
      const result = await migrationRunner.migrate(handle, { migrationRunId: `recover-${point}`, targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
      assert.equal(result.status, 'failed')
      assert.equal(await recoverKnowledgeBaseRoot(root), 'recovered')
      const manifest = await readFile(join(root, 'manifest.yaml'), 'utf8')
      assert.equal(manifest.includes('"schemaVersion":"0.2"'), point === 'after_switch')
      assert.equal(manifest.includes('schemaVersion: "0.1"'), point === 'before_switch')
      const leaf = root.split(/[\\/]/).pop()!
      const siblings = await readdir(dirname(root))
      assert.equal(siblings.some((name) => name === `${leaf}.recovery.json` || name.startsWith(`${leaf}.staging-`) || name.startsWith(`${leaf}.backup-`)), false)
    } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}.recovery.json`, { force: true }) }
  }
})

test('migration serializes with Writer and Raw on one KB, while different KBs remain independent', async () => {
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const handle = await registry.mount(root)
    let releaseGate!: () => void
    let enteredMigrationSwitch!: () => void
    const switchEntered = new Promise<void>((resolve) => { enteredMigrationSwitch = resolve })
    const switchReleased = new Promise<void>((resolve) => { releaseGate = resolve })
    const migrationRunner = new KnowledgeMigrationRunner({
      registry,
      validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader })),
      clock: () => '2026-08-26T00:00:00.000Z',
      failpoint: async (point) => { if (point === 'before_switch') { enteredMigrationSwitch(); await switchReleased } },
    })
    const migrationPromise = migrationRunner.migrate(handle, { migrationRunId: 'lock-migration', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    await switchEntered
    const changeSet: KnowledgeChangeSet = { changeSetId: 'queued-writer', workflowRunId: 'queued-writer', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.1', expectedBaseRevision: 4, requiresRawProvenance: false, sourceOperations: [], knowledgeOperations: [] }
    const receipt: ValidatedKnowledgeChangeSet = { changeSet, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.1', baseRevision: 4, changeSetId: changeSet.changeSetId, changeSetHash: hashKnowledgeObject(changeSet), validatedAt: '2026-08-26T00:00:00.000Z' }
    const writer = new KnowledgeWriter({ loader, registry, stagedStateValidator: async () => undefined })
    let writerSettled = false
    let rawSettled = false
    const writerPromise = writer.write(handle, receipt).finally(() => { writerSettled = true })
    const rawPromise = archiveRaw(handle, { bytes: Buffer.from('queued-raw') }).then(() => undefined, () => undefined).finally(() => { rawSettled = true })
    await Promise.resolve()
    assert.equal(writerSettled, false)
    assert.equal(rawSettled, false)
    releaseGate()
    assert.equal((await migrationPromise).status, 'committed')
    await writerPromise
    await rawPromise
    assert.equal(writerSettled, true)
    assert.equal(rawSettled, true)
  } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}.recovery.json`, { force: true }) }

  const rootA = await createV01({ knowledgeBaseId: 'kb-migration-a' })
  const rootB = await createV01({ knowledgeBaseId: 'kb-migration-b' })
  try {
    const registry = new KnowledgeBaseRegistry()
    const loader = new KnowledgeBaseLoader({ registry })
    const [handleA, handleB] = await Promise.all([registry.mount(rootA), registry.mount(rootB)])
    const migrationRunner = new KnowledgeMigrationRunner({ registry, validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader })), clock: () => '2026-08-26T00:00:00.000Z' })
    const [resultA, resultB] = await Promise.all([
      migrationRunner.migrate(handleA, { migrationRunId: 'independent-a', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' }),
      migrationRunner.migrate(handleB, { migrationRunId: 'independent-b', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' }),
    ])
    assert.equal(resultA.status, 'committed')
    assert.equal(resultB.status, 'committed')
  } finally { await rm(rootA, { recursive: true, force: true }); await rm(rootB, { recursive: true, force: true }); await rm(`${rootA}.recovery.json`, { force: true }); await rm(`${rootB}.recovery.json`, { force: true }) }
})

test('source validation and target validation failures block without activating a target', async () => {
  const root = await createV01()
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const before = await snapshot(root)
    const sourceFail = new KnowledgeMigrationRunner({ registry, validator: { validateSource: async () => { throw new Error('source invalid') }, validateTarget: async () => undefined } })
    assert.equal((await sourceFail.migrate(handle, { migrationRunId: 'source-fail', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })).status, 'blocked')
    assert.deepEqual(await snapshot(root), before)
    const targetFail = new KnowledgeMigrationRunner({ registry, validator: { validateSource: async () => undefined, validateTarget: async () => { throw new Error('target invalid') } } })
    const result = await targetFail.migrate(handle, { migrationRunId: 'target-fail', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'target_validation_failed')
    assert.deepEqual(await snapshot(root), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('readonly dry-run is allowed while readonly commit is blocked', async () => {
  const root = await createV01({ status: 'readonly' })
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const migrationRunner = runner(registry)
    const dryRun = await migrationRunner.migrate(handle, { migrationRunId: 'readonly-dry-run', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(dryRun.status, 'dry_run_passed', JSON.stringify(dryRun))
    const commit = await migrationRunner.migrate(handle, { migrationRunId: 'readonly-commit', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(commit.status, 'blocked')
    assert.equal(commit.error?.code, 'knowledge_base_not_writable')
  } finally { await rm(root, { recursive: true, force: true }) }

  const archivedRoot = await createV01({ status: 'archived' })
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(archivedRoot)
    const migrationRunner = runner(registry)
    const dryRun = await migrationRunner.migrate(handle, { migrationRunId: 'archived-dry-run', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(dryRun.status, 'dry_run_passed', JSON.stringify(dryRun))
    const commit = await migrationRunner.migrate(handle, { migrationRunId: 'archived-commit', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'commit' })
    assert.equal(commit.status, 'blocked')
    assert.equal(commit.error?.code, 'knowledge_base_not_writable')
  } finally { await rm(archivedRoot, { recursive: true, force: true }) }
})

test('ambiguous Raw provenance is review-required and scan-only KBs can migrate when provable', async () => {
  const root = await createV01({ raw: true })
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'review-raw', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(result.status, 'review_required')
    assert.equal(result.reviewItems[0]?.code, 'raw_provenance_mapping_required')
  } finally { await rm(root, { recursive: true, force: true }) }

  const scanOnlyRoot = await createV01({ scanOnly: true })
  try {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(scanOnlyRoot)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'scan-only-valid', targetSchemaVersion: '0.2', targetStorageFormatVersion: '1', expectedBaseRevision: 4, mode: 'dry_run' })
    assert.equal(result.status, 'dry_run_passed', JSON.stringify(result))
    assert.equal(result.reviewItems.length, 0)
    await assert.rejects(readdir(join(scanOnlyRoot, 'registry')))
  } finally { await rm(scanOnlyRoot, { recursive: true, force: true }) }
})
