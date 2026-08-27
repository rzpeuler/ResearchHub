import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { archiveRaw, verifyRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { KnowledgeMigrationRunner } from '../../../packages/shared/knowledge-base/migration/runner.ts'
import { recoverKnowledgeBaseRoot } from '../../../packages/shared/knowledge-base/root-transaction.ts'
import { KnowledgeValidationSkill, createKnowledgeMigrationStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import { CanonicalV03KnowledgeLoader } from '../../../packages/shared/knowledge-base/canonical-v03-loader.ts'
import { DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY } from '../../../packages/schemas/knowledge/index.ts'

async function put(root: string, path: string, value: unknown): Promise<void> {
  const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8')
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
  await visit(root); return result
}
async function assertNoTransactionResidue(root: string): Promise<void> {
  const leaf = root.split(/[\\/]/).pop()!
  const siblings = await readdir(dirname(root))
  assert.equal(siblings.some((name) => name === `${leaf}.recovery.json` || name.startsWith(`${leaf}.staging-`) || name.startsWith(`${leaf}.backup-`)), false)
}
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-b02-'))
  await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-b02', name: 'B2', schemaVersion: '0.2', storageFormatVersion: '1', revision: 2, status: 'active', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' })
  const assets: Array<{ id: string; type: string; path: string; value: Record<string, unknown> }> = [
    { id: 'industry:semiconductor', type: 'entity', path: 'entities/industry.yaml', value: { id: 'industry:semiconductor', type: 'industry', name: 'Semiconductor', lifecycle: { status: 'active' } } },
    { id: 'segment:hardware', type: 'entity', path: 'entities/segment.yaml', value: { id: 'segment:hardware', type: 'segment', name: 'Hardware', lifecycle: { status: 'active' } } },
    { id: 'company:nvidia', type: 'entity', path: 'entities/nvidia.yaml', value: { id: 'company:nvidia', type: 'company', name: 'NVIDIA', lifecycle: { status: 'active' } } },
    { id: 'source:official', type: 'source', path: 'sources/official.yaml', value: { id: 'source:official', type: 'official_disclosure', title: 'Official', publisher: 'NVIDIA', publishedAt: null, sourceType: 'official_disclosure', lifecycle: { status: 'active' } } },
    { id: 'fact:gpu', type: 'intelligence', path: 'intelligence/fact.yaml', value: { id: 'fact:gpu', type: 'fact', entityRefs: ['company:nvidia'], sourceRefs: ['source:official'], statement: 'GPU demand is strong.', lifecycle: { status: 'active' } } },
    { id: 'relation:exposure', type: 'relation', path: 'relations/exposure.yaml', value: { id: 'relation:exposure', type: 'operates_in', source: 'company:nvidia', target: 'segment:hardware', sourceRefs: ['source:official'], lifecycle: { status: 'active' } } },
    { id: 'module:overview', type: 'module', path: 'modules/overview.yaml', value: { id: 'module:overview', type: 'comparison', targetEntity: 'company:nvidia', sourceRefs: ['source:official'], schemaId: 'overview', columns: [], rows: [] } },
  ]
  const registry: Record<string, { type: string; storageRef: string }> = {}
  for (const asset of assets) { await put(root, asset.path, asset.value); registry[asset.id] = { type: asset.type, storageRef: asset.path } }
  await put(root, 'registry/assets.yaml', registry); await put(root, 'registry/raw.yaml', {}); return root
}
function runner(registry: KnowledgeBaseRegistry) {
  const loader = new KnowledgeBaseLoader({ registry }); const skill = new KnowledgeValidationSkill({ loader })
  return new KnowledgeMigrationRunner({ registry, migrationRegistry: DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY, validator: createKnowledgeMigrationStateValidator(skill), clock: () => '2026-08-27T01:00:00.000Z' })
}

test('B2 registers v0.3 as readable but non-writable and blocks multi-hop migration', async () => {
  const root = await fixture()
  try {
    await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-b02', name: 'B2', schemaVersion: '0.1', storageFormatVersion: '1', revision: 2, status: 'active', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' })
    const registry = new KnowledgeBaseRegistry(); const handle = await registry.mount(root)
    assert.equal(handle.compatibility, 'read_only_compatible'); assert.equal(handle.writable, false)
    assert.equal(registry.compatibilityResolver.resolve({ schemaVersion: '0.3', storageFormatVersion: '1', status: 'active' }).writable, false)
    const result = await runner(registry).migrate(handle, { migrationRunId: 'multi-hop', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'dry_run' })
    assert.equal(result.status, 'blocked'); assert.equal(result.error?.code, 'migration_requires_sequential_steps')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B2 dry-run leaves v0.2 unchanged and commit activates v0.3 through canonical reader', async () => {
  const root = await fixture()
  try {
    const registry = new KnowledgeBaseRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await registry.mount(root)
    const raw = await archiveRaw(handle, { bytes: new TextEncoder().encode('b02 raw bytes'), originalFilename: 'official.txt', mediaType: 'text/plain' })
    const sourcePath = join(root, 'sources/official.yaml'); const source = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>; source.rawRefs = [raw.manifest.rawRef]; await writeFile(sourcePath, `${JSON.stringify(source)}\n`, 'utf8')
    const rawBefore = { ref: raw.manifest.rawRef, bytes: await readFile(raw.originalPath), manifest: await readFile(raw.manifestPath), registry: await readFile(join(root, 'registry/raw.yaml')) }
    const before = await readFile(join(root, 'manifest.yaml'), 'utf8')
    const dry = await runner(registry).migrate(handle, { migrationRunId: 'b02-dry', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'dry_run' })
    assert.equal(dry.status, 'dry_run_passed', JSON.stringify(dry)); assert.deepEqual(await readFile(join(root, 'manifest.yaml'), 'utf8'), before)
    const committed = await runner(registry).migrate(handle, { migrationRunId: 'b02-commit', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'commit' })
    assert.equal(committed.status, 'committed', JSON.stringify(committed)); assert.equal(committed.target.revision, 3); assert.equal(committed.committedHandle?.schemaVersion, '0.3'); assert.equal(committed.committedHandle?.writable, false)
    const assets = await new CanonicalV03KnowledgeLoader(root).readAssets(); assert.equal(assets.claims.length, 1); assert.equal(assets.entities.length, 3); assert.equal(assets.relations.length, 1); assert.equal(assets.registry.some((entry) => entry.id.startsWith('taxonomy:')), false)
    const postValidation = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(committed.committedHandle!)
    assert.equal(postValidation.status, 'passed', JSON.stringify(postValidation.errors))
    assert.equal(assets.sources[0]?.value.rawRefs?.[0], rawBefore.ref); assert.deepEqual(await readFile(raw.originalPath), rawBefore.bytes); assert.deepEqual(await readFile(raw.manifestPath), rawBefore.manifest); assert.deepEqual(await readFile(join(root, 'registry/raw.yaml')), rawBefore.registry)
    const log = await readFile(join(root, 'logs/migrations/b02-commit.yaml'), 'utf8'); assert.match(log, /knowledge-schema-0\.2-to-0\.3/); assert.match(log, /warnings/)
    assert.equal((await readdir(join(root, 'registry'))).includes('index.yaml'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B2 0.2 to 0.3 ambiguous relation is review-required without switching or logging', async () => {
  const root = await fixture()
  try {
    await put(root, 'relations/partner.yaml', { id: 'relation:partner', type: 'partner_of', source: 'company:nvidia', target: 'company:nvidia', lifecycle: { status: 'active' } })
    const registryPath = join(root, 'registry/assets.yaml')
    const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, unknown>
    registry['relation:partner'] = { type: 'relation', storageRef: 'relations/partner.yaml' }
    await writeFile(registryPath, `${JSON.stringify(registry)}\n`, 'utf8')
    const before = await snapshot(root)
    const mounted = new KnowledgeBaseRegistry(); const handle = await mounted.mount(root)
    const result = await runner(mounted).migrate(handle, { migrationRunId: 'b02-review', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'commit' })
    assert.equal(result.status, 'review_required', JSON.stringify(result))
    assert.equal(result.reviewItems.some((item) => item.code === 'ambiguous_partner_relation'), true)
    assert.deepEqual(await snapshot(root), before)
    assert.equal((await readFile(join(root, 'manifest.yaml'), 'utf8')).includes('"schemaVersion":"0.2"'), true)
    await assert.rejects(readFile(join(root, 'logs/migrations/b02-review.yaml'), 'utf8'))
    await assertNoTransactionResidue(root)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B2 0.2 to 0.3 target validation failure blocks before switch', async () => {
  const root = await fixture()
  try {
    const before = await snapshot(root)
    const registry = new KnowledgeBaseRegistry(); const handle = await registry.mount(root)
    const targetFail = new KnowledgeMigrationRunner({
      registry,
      validator: { validateSource: async () => undefined, validateTarget: async () => { throw new Error('injected v0.3 target validation failure') } },
    })
    const result = await targetFail.migrate(handle, { migrationRunId: 'b02-target-fail', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'commit' })
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'target_validation_failed')
    assert.deepEqual(await snapshot(root), before)
    assert.equal((await readFile(join(root, 'manifest.yaml'), 'utf8')).includes('"schemaVersion":"0.2"'), true)
    await assertNoTransactionResidue(root)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B2 0.2 to 0.3 transaction recovery preserves one coherent state for every failpoint', async () => {
  for (const point of ['before_switch', 'during_switch', 'after_switch'] as const) {
    const root = await fixture()
    try {
      const registry = new KnowledgeBaseRegistry(); const loader = new KnowledgeBaseLoader({ registry }); const handle = await registry.mount(root)
      const raw = await archiveRaw(handle, { bytes: new TextEncoder().encode(`b02 recovery ${point}`), originalFilename: 'recovery.txt', mediaType: 'text/plain' })
      const sourcePath = join(root, 'sources/official.yaml')
      const source = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>
      source.rawRefs = [raw.manifest.rawRef]
      await writeFile(sourcePath, `${JSON.stringify(source)}\n`, 'utf8')
      const rawBefore = { ref: raw.manifest.rawRef, bytes: await readFile(raw.originalPath), manifest: await readFile(raw.manifestPath), registry: await readFile(join(root, 'registry/raw.yaml')) }
      const result = await new KnowledgeMigrationRunner({
        registry,
        validator: createKnowledgeMigrationStateValidator(new KnowledgeValidationSkill({ loader })),
        clock: () => '2026-08-27T02:00:00.000Z',
        failpoint: async (current) => { if (current === point) throw new Error(`injected ${point} failure`) },
      }).migrate(handle, { migrationRunId: `b02-recover-${point}`, targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'commit' })
      assert.equal(result.status, 'failed')
      assert.equal(result.error?.message, `injected ${point} failure`)
      assert.equal((await readdir(dirname(root))).some((name) => name === `${root.split(/[\\/]/).pop()}.recovery.json`), true)
      assert.equal(await recoverKnowledgeBaseRoot(root), 'recovered')
      const refreshed = await registry.refresh(root)
      if (point === 'before_switch') {
        assert.equal(refreshed.schemaVersion, '0.2')
        assert.equal(refreshed.revision, 2)
        assert.equal((await readFile(join(root, 'manifest.yaml'), 'utf8')).includes('"schemaVersion":"0.2"'), true)
      } else {
        assert.equal(refreshed.schemaVersion, '0.3')
        assert.equal(refreshed.revision, 3)
        assert.equal(refreshed.writable, false)
        const validation = await new KnowledgeValidationSkill({ loader }).validateKnowledgeBase(refreshed)
        assert.equal(validation.status, 'passed', JSON.stringify(validation.errors))
        const assets = await new CanonicalV03KnowledgeLoader(root).readAssets()
        assert.equal(assets.sources.some((item) => item.value.rawRefs?.includes(rawBefore.ref)), true)
      }
      assert.deepEqual(await readFile(raw.originalPath), rawBefore.bytes)
      assert.deepEqual(await readFile(raw.manifestPath), rawBefore.manifest)
      assert.deepEqual(await readFile(join(root, 'registry/raw.yaml')), rawBefore.registry)
      await verifyRaw(refreshed.schemaVersion === '0.3' ? refreshed : handle, rawBefore.ref)
      await assertNoTransactionResidue(root)
    } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}.recovery.json`, { force: true }) }
  }
})
