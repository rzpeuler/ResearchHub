import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeMigrationRunner } from '../../../packages/shared/knowledge-base/migration/runner.ts'
import { KnowledgeValidationSkill, createKnowledgeMigrationStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import { CanonicalV03KnowledgeLoader } from '../../../packages/shared/knowledge-base/canonical-v03-loader.ts'
import { DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY } from '../../../packages/schemas/knowledge/index.ts'

async function put(root: string, path: string, value: unknown): Promise<void> {
  const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8')
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
    const registry = new KnowledgeBaseRegistry(); const handle = await registry.mount(root); const before = await readFile(join(root, 'manifest.yaml'), 'utf8')
    const dry = await runner(registry).migrate(handle, { migrationRunId: 'b02-dry', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'dry_run' })
    assert.equal(dry.status, 'dry_run_passed', JSON.stringify(dry)); assert.deepEqual(await readFile(join(root, 'manifest.yaml'), 'utf8'), before)
    const committed = await runner(registry).migrate(handle, { migrationRunId: 'b02-commit', targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', expectedBaseRevision: 2, mode: 'commit' })
    assert.equal(committed.status, 'committed', JSON.stringify(committed)); assert.equal(committed.target.revision, 3); assert.equal(committed.committedHandle?.schemaVersion, '0.3'); assert.equal(committed.committedHandle?.writable, false)
    const assets = await new CanonicalV03KnowledgeLoader(root).readAssets(); assert.equal(assets.claims.length, 1); assert.equal(assets.entities.length, 3); assert.equal(assets.relations.length, 1); assert.equal(assets.registry.some((entry) => entry.id.startsWith('taxonomy:')), false)
    const log = await readFile(join(root, 'logs/migrations/b02-commit.yaml'), 'utf8'); assert.match(log, /knowledge-schema-0\.2-to-0\.3/); assert.match(log, /warnings/)
    assert.equal((await readdir(join(root, 'registry'))).includes('index.yaml'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
