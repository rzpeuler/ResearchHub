import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeMigrationRunner } from '../../../packages/shared/knowledge-base/migration/runner.ts'
import type { KnowledgeMigrationResult, KnowledgeMigrationInventory } from '../../../packages/shared/knowledge-base/migration/types.ts'
import { CanonicalV03KnowledgeLoader } from '../../../packages/shared/knowledge-base/canonical-v03-loader.ts'
import { parseYaml } from '../../../packages/shared/knowledge-base/yaml.ts'
import { KnowledgeValidationSkill, createKnowledgeMigrationStateValidator } from '../../../packages/skills/knowledge-validation/index.ts'
import type { KnowledgeAssetCollection } from '../../../packages/shared/knowledge-base/types.ts'

const SOURCE_ROOT = resolve(fileURLToPath(new URL('../../../examples/knowledge-bases/ai-hardware/', import.meta.url)))
const FIXED_MIGRATION_TIME = '2026-08-27T03:00:00.000Z'
const INVARIANT_NAMES = [
  'sourceRootUnchanged', 'rawIdentityPreserved', 'rawRegistryPreserved',
  'completeCanonicalIdMapping', 'targetCanonicalIdsUnique',
  'noLegacyCanonicalNamespaceInDeclaredRefs', 'declaredCanonicalRefsUseV03Namespaces',
  'declaredCanonicalRefsResolveToTarget', 'noMixedCanonicalSemanticRegistry',
  'registryNamespaceKindConsistent', 'taxonomyPreserved', 'viewsPreserved',
  'auxiliaryDeclaredRefsResolved', 'moduleDeclaredRefsResolved',
  'relationEndpointsCanonical', 'noOrphanDeduplicatedRelationFiles', 'canonicalRegistryRebuilt',
] as const
type ReviewClassification = 'DETERMINISTIC_POLICY_RESOLVED' | 'ROOT_SEMANTIC_REVIEW' | 'DEPENDENT_REFERENCE_BLOCKED' | 'UNEXPECTED_REVIEW'

interface FileSnapshot {
  fileCount: number
  files: Record<string, { bytes: number; sha256: string }>
  treeHash: string
}

interface ExampleInventory {
  taxonomyFiles: string[]
  taxonomyItemIds: string[]
  entityTypes: Record<string, number>
  relationTypes: Record<string, number>
  intelligenceTypes: Record<string, number>
  moduleIds: string[]
  sourceIds: string[]
  viewFiles: string[]
  registryIds: string[]
  rawRegistry: unknown
  counts: KnowledgeMigrationInventory['counts'] & { registry: number }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(relative(root, path).split(sep).join('/'))
    }
  }
  await visit(root)
  return files
}

async function snapshot(root: string): Promise<FileSnapshot> {
  const files: Record<string, { bytes: number; sha256: string }> = {}
  for (const path of await listFiles(root)) {
    const bytes = await readFile(join(root, path))
    files[path] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const treeHash = createHash('sha256')
    .update(Object.entries(files).map(([path, file]) => `${path}\0${file.sha256}\n`).join(''), 'utf8')
    .digest('hex')
  return { fileCount: Object.keys(files).length, files, treeHash }
}

function countBy(items: Array<{ value: Record<string, unknown> }>, field: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = item.value[field]
    if (typeof value === 'string') counts[value] = (counts[value] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function collectIds(value: unknown, ids: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) collectIds(item, ids)
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' && typeof child === 'string' && (child.startsWith('taxonomy:') || child.startsWith('sw:'))) ids.push(child)
      else collectIds(child, ids)
    }
  }
  return ids
}

async function sourceInventory(root: string, assets: KnowledgeAssetCollection): Promise<ExampleInventory> {
  const taxonomyFiles = (await listFiles(join(root, 'taxonomy'))).map((path) => `taxonomy/${path}`)
  const viewFiles = (await listFiles(join(root, 'views'))).map((path) => `views/${path}`)
  const taxonomyItemIds: string[] = []
  for (const path of taxonomyFiles.filter((item) => item.endsWith('.yaml'))) {
    taxonomyItemIds.push(...collectIds(parseYaml(await readFile(join(root, path), 'utf8'), join(root, path))))
  }
  const rawRegistry = parseYaml(await readFile(join(root, 'registry/raw.yaml'), 'utf8'), join(root, 'registry/raw.yaml'))
  return {
    taxonomyFiles,
    taxonomyItemIds: [...new Set(taxonomyItemIds)].sort(),
    entityTypes: countBy(assets.entities, 'type'),
    relationTypes: countBy(assets.relations, 'type'),
    intelligenceTypes: countBy(assets.intelligence, 'type'),
    moduleIds: assets.modules.map((item) => item.value.id).sort(),
    sourceIds: assets.sources.map((item) => item.value.id).sort(),
    viewFiles,
    registryIds: assets.registry.map((item) => item.id).sort(),
    rawRegistry,
    counts: {
      entities: assets.entities.length,
      relations: assets.relations.length,
      intelligence: assets.intelligence.length,
      modules: assets.modules.length,
      sources: assets.sources.length,
      registry: assets.registry.length,
    },
  }
}

async function copyFromSource(parent: string, name: string): Promise<string> {
  const destination = join(parent, name)
  await cp(SOURCE_ROOT, destination, { recursive: true })
  return destination
}

function createRunner(registry: KnowledgeBaseRegistry, loader: KnowledgeBaseLoader): KnowledgeMigrationRunner {
  const skill = new KnowledgeValidationSkill({ loader })
  return new KnowledgeMigrationRunner({
    registry,
    validator: createKnowledgeMigrationStateValidator(skill),
    clock: () => FIXED_MIGRATION_TIME,
  })
}

function semanticResult(result: KnowledgeMigrationResult): unknown {
  return {
    knowledgeBaseId: result.knowledgeBaseId,
    mode: result.mode,
    status: result.status,
    migrationPath: result.migrationPath,
    source: result.source,
    target: result.target,
    inventory: result.inventory,
    idMappings: result.idMappings,
    reviewItems: result.reviewItems.map(({ migrationRunId: _run, reviewItemId: _item, ...review }) => review),
    changes: result.changes,
    warnings: result.warnings,
    validation: result.validation,
    error: result.error,
  }
}

function inferredInvariants(result: KnowledgeMigrationResult): Record<string, boolean> {
  const failed = new Set(result.reviewItems.map((item) => item.code))
  return Object.fromEntries(INVARIANT_NAMES.map((name) => [name, !failed.has(name)]))
}

function classifyReview(item: { code: string; assetId?: string; details?: Record<string, unknown> }): ReviewClassification {
  if (item.code === 'completeCanonicalIdMapping' || item.code === 'declaredCanonicalRefsResolveToTarget') return 'DEPENDENT_REFERENCE_BLOCKED'
  if (item.code === 'ambiguous_contains_semantics' && item.assetId?.startsWith('relation:')) return 'ROOT_SEMANTIC_REVIEW'
  if (item.code === 'event_impact_requires_decomposition' && item.assetId?.startsWith('fact:')) return 'ROOT_SEMANTIC_REVIEW'
  if (item.code === 'temporal_semantic_conflict' && item.assetId) return 'ROOT_SEMANTIC_REVIEW'
  if (item.code === 'claim_statement_missing' && (item.assetId?.startsWith('forecast:') || item.assetId?.startsWith('viewpoint:'))) return 'ROOT_SEMANTIC_REVIEW'
  if (item.code === 'legacy_semantic_field_unmapped') {
    const fields = new Set(Array.isArray(item.details?.fields) ? item.details.fields.map(String) : [])
    const expected = item.assetId?.startsWith('forecast:') ? ['values', 'assumptions']
      : item.assetId?.startsWith('viewpoint:') ? ['bullishPoints', 'bearishPoints', 'keyVariables']
        : item.assetId?.startsWith('trend:') ? ['direction', 'drivers']
          : item.assetId?.startsWith('risk:') ? ['trigger', 'impact', 'probability'] : []
    if (expected.length > 0 && fields.size > 0 && [...fields].every((field) => expected.includes(field))) return 'ROOT_SEMANTIC_REVIEW'
  }
  if (['lifecycle_missing', 'unsupported_custom_legacy_type', 'legacy_metadata_collision', 'legacy_temporal_invalid'].includes(item.code)) return 'DETERMINISTIC_POLICY_RESOLVED'
  return 'UNEXPECTED_REVIEW'
}

async function assertNoTransactionResidue(root: string): Promise<void> {
  const leaf = root.split(/[\\/]/).pop()!
  const siblings = await readdir(dirname(root))
  assert.equal(siblings.some((name) => name === `${leaf}.recovery.json` || name.startsWith(`${leaf}.migration-staging-`) || name.startsWith(`${leaf}.backup-`)), false)
}

async function assertV02Source(root: string): Promise<{ handle: Awaited<ReturnType<KnowledgeBaseRegistry['mount']>>; assets: KnowledgeAssetCollection; inventory: ExampleInventory; sourceValidation: Awaited<ReturnType<KnowledgeValidationSkill['validateKnowledgeBase']>>; registry: KnowledgeBaseRegistry; loader: KnowledgeBaseLoader }> {
  const registry = new KnowledgeBaseRegistry()
  const handle = await registry.mount(root)
  const loader = new KnowledgeBaseLoader({ registry })
  const skill = new KnowledgeValidationSkill({ loader })
  const assets = await loader.readAssets(handle)
  const sourceValidation = await skill.validateKnowledgeBase(handle)
  assert.equal(handle.schemaVersion, '0.2')
  assert.equal(handle.storageFormatVersion, '1')
  assert.equal(handle.revision, 0)
  assert.equal(handle.status, 'active')
  assert.equal(sourceValidation.status, 'passed', JSON.stringify(sourceValidation.errors))
  return { handle, assets, inventory: await sourceInventory(root, assets), sourceValidation, registry, loader }
}

test('B3 exact AI Hardware example is accepted only up to deterministic semantic review', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'researchhub-b03-example-'))
  try {
    const sourceBefore = await snapshot(SOURCE_ROOT)
    const [dryRoot, commitRoot, repeatRoot] = await Promise.all([
      copyFromSource(parent, 'B3-dry-run'),
      copyFromSource(parent, 'B3-commit'),
      copyFromSource(parent, 'B3-repeat'),
    ])
    assert.deepEqual(await snapshot(dryRoot), sourceBefore)
    assert.deepEqual(await snapshot(commitRoot), sourceBefore)
    assert.deepEqual(await snapshot(repeatRoot), sourceBefore)

    const sourceCheck = await assertV02Source(dryRoot)
    const dry = await createRunner(sourceCheck.registry, sourceCheck.loader).migrate(sourceCheck.handle, {
      migrationRunId: 'b03-ai-hardware-dry-run',
      targetSchemaVersion: '0.3',
      targetStorageFormatVersion: '1',
      expectedBaseRevision: 0,
      mode: 'dry_run',
    })
    assert.ok(['dry_run_passed', 'review_required'].includes(dry.status), JSON.stringify(dry))
    assert.deepEqual(await snapshot(dryRoot), sourceBefore)
    assert.equal((await readdir(dryRoot)).includes('logs'), false)
    await assertNoTransactionResidue(dryRoot)

    const reviewReport = dry.reviewItems.map((item) => ({
      reviewItemId: item.reviewItemId,
      code: item.code,
      assetId: item.assetId,
      sourcePath: item.assetId ? sourceCheck.assets.entities.concat(sourceCheck.assets.relations, sourceCheck.assets.intelligence, sourceCheck.assets.modules, sourceCheck.assets.sources).find((asset) => asset.value.id === item.assetId)?.filePath : undefined,
      classification: classifyReview(item),
      frozenRule: 'Schema 0.3 migration must preserve frozen semantics deterministically and must not guess missing or incompatible meaning.',
      reason: item.description,
      recommendedNextAction: item.suggestedAction,
    }))
    assert.equal(reviewReport.every((item) => !item.assetId || item.sourcePath !== undefined), true)
    if (dry.status === 'review_required') {
      assert.ok(dry.reviewItems.length > 0)
      assert.equal(reviewReport.some((item) => item.classification === 'UNEXPECTED_REVIEW'), false, JSON.stringify(reviewReport))
      assert.deepEqual(reviewReport.filter((item) => item.classification === 'DETERMINISTIC_POLICY_RESOLVED').map((item) => item.code), ['legacy_temporal_invalid', 'legacy_temporal_invalid'])
      assert.deepEqual(new Set(reviewReport.filter((item) => item.classification === 'ROOT_SEMANTIC_REVIEW').map((item) => item.assetId)), new Set([
        'relation:data-center-contains-liquid-cooling',
        'relation:data-center-contains-server',
        'relation:server-contains-liquid-cooling',
        'fact:ai-server-architecture-upgrade-2024',
        'fact:nvidia-rubin-release-2026',
        'forecast:data-center-electricity-demand-2030',
        'viewpoint:ai-hardware-2026',
        'trend:accelerated-server-electricity-growth',
        'risk:data-center-grid-bottleneck',
      ]))
      assert.equal(dry.validation.source, 'passed')
      assert.equal(dry.validation.target, 'failed')
      assert.deepEqual(inferredInvariants(dry), {
        sourceRootUnchanged: true,
        rawIdentityPreserved: true,
        rawRegistryPreserved: true,
        completeCanonicalIdMapping: false,
        targetCanonicalIdsUnique: true,
        noLegacyCanonicalNamespaceInDeclaredRefs: true,
        declaredCanonicalRefsUseV03Namespaces: true,
        declaredCanonicalRefsResolveToTarget: false,
        noMixedCanonicalSemanticRegistry: true,
        registryNamespaceKindConsistent: true,
        taxonomyPreserved: true,
        viewsPreserved: true,
        auxiliaryDeclaredRefsResolved: true,
        moduleDeclaredRefsResolved: true,
        relationEndpointsCanonical: true,
        noOrphanDeduplicatedRelationFiles: true,
        canonicalRegistryRebuilt: true,
      })
    } else {
      assert.equal(dry.reviewItems.length, 0, JSON.stringify(dry.reviewItems))
      assert.equal(Object.values(inferredInvariants(dry)).every(Boolean), true)
      assert.equal(dry.validation.source, 'passed')
      assert.equal(dry.validation.target, 'passed')
    }

    const repeatCheck = await assertV02Source(repeatRoot)
    const repeat = await createRunner(repeatCheck.registry, repeatCheck.loader).migrate(repeatCheck.handle, {
      migrationRunId: 'b03-ai-hardware-dry-run-repeat',
      targetSchemaVersion: '0.3',
      targetStorageFormatVersion: '1',
      expectedBaseRevision: 0,
      mode: 'dry_run',
    })
    assert.deepEqual(semanticResult(repeat), semanticResult(dry))
    assert.deepEqual(await snapshot(repeatRoot), sourceBefore)
    await assertNoTransactionResidue(repeatRoot)

    if (dry.status === 'review_required') {
      const commitCheck = await assertV02Source(commitRoot)
      assert.deepEqual(await snapshot(commitRoot), sourceBefore)
      assert.equal(reviewReport.some((item) => item.classification === 'UNEXPECTED_REVIEW'), false)
      assert.equal(commitCheck.handle.schemaVersion, '0.2')
      assert.equal(commitCheck.handle.revision, 0)
      return
    }

    const commitCheck = await assertV02Source(commitRoot)
    const committed = await createRunner(commitCheck.registry, commitCheck.loader).migrate(commitCheck.handle, {
      migrationRunId: 'b03-ai-hardware-commit',
      targetSchemaVersion: '0.3',
      targetStorageFormatVersion: '1',
      expectedBaseRevision: 0,
      mode: 'commit',
    })
    assert.equal(committed.status, 'committed', JSON.stringify(committed))
    assert.equal(committed.target.revision, 1)
    assert.equal(committed.committedHandle?.schemaVersion, '0.3')
    assert.equal(committed.committedHandle?.storageFormatVersion, '1')
    assert.equal(committed.committedHandle?.revision, 1)
    assert.equal(committed.committedHandle?.compatibility, 'read_only_compatible')
    assert.equal(committed.committedHandle?.writable, false)
    const targetValidation = await new KnowledgeValidationSkill({ loader: commitCheck.loader }).validateKnowledgeBase(committed.committedHandle!)
    assert.equal(targetValidation.status, 'passed', JSON.stringify(targetValidation.errors))
    await new CanonicalV03KnowledgeLoader(commitRoot).readAssets()
    assert.deepEqual(await snapshot(SOURCE_ROOT), sourceBefore)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
