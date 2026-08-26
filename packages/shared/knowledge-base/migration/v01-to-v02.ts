import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { CanonicalV02KnowledgeLoader } from '../canonical-v02-loader.ts'
import { KnowledgeLoader } from '../loader.ts'
import { parseYaml } from '../yaml.ts'
import { canonicalSerialize } from '../canonical-hash.ts'
import { type KnowledgeAssetCollection, type ModuleRegistryBinding } from '../types.ts'
import type { KnowledgeBaseHandle } from '../handle.ts'
import type { MigrationReviewItem, KnowledgeIdMapping } from '../../../schemas/knowledge/index.ts'
import { SOURCE_RELIABILITIES, SOURCE_TYPES } from '../../../schemas/knowledge/index.ts'
import type { KnowledgeMigrationChanges, KnowledgeMigrationInventory } from './types.ts'

interface TransformResult {
  before: KnowledgeMigrationInventory
  after: KnowledgeMigrationInventory
  idMappings: KnowledgeIdMapping[]
  reviewItems: MigrationReviewItem[]
  changes: KnowledgeMigrationChanges
  invariants: Record<string, boolean>
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function rel(root: string, path: string): string { return relative(resolve(root), resolve(path)).replaceAll('\\', '/') }
function hasPath(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }
function inventory(assets: KnowledgeAssetCollection): KnowledgeMigrationInventory {
  const groups = [assets.entities, assets.relations, assets.intelligence, assets.modules, assets.sources]
  const values = groups.map((items) => items.map((item) => item.value.id).sort((a, b) => a.localeCompare(b)))
  return { entityIds: values[0]!, relationIds: values[1]!, intelligenceIds: values[2]!, moduleIds: values[3]!, sourceIds: values[4]!, counts: { entities: values[0]!.length, relations: values[1]!.length, intelligence: values[2]!.length, modules: values[3]!.length, sources: values[4]!.length } }
}
function review(runId: string, kbId: string, code: string, description: string, suggestedAction: string, assetId?: string, details?: Record<string, unknown>): MigrationReviewItem {
  return { reviewItemId: `review-${code}-${assetId ?? 'knowledge-base'}`, migrationRunId: runId, knowledgeBaseId: kbId, migrationId: 'knowledge-schema-0.1-to-0.2', code, ...(assetId ? { assetId } : {}), description, suggestedAction, ...(details ? { details } : {}) }
}
async function registryFiles(root: string): Promise<string[]> {
  const directory = join(root, 'registry')
  if (!(await hasPath(directory))) return []
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
}
function reverseBindings(bindings: ModuleRegistryBinding[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const binding of bindings) for (const moduleId of new Set(binding.moduleIds)) (result.get(moduleId) ?? result.set(moduleId, new Set()).get(moduleId)!).add(binding.entityId)
  return result
}
async function rawReview(root: string, assets: KnowledgeAssetCollection, handle: KnowledgeBaseHandle, runId: string): Promise<MigrationReviewItem[]> {
  const rawRegistry = join(root, 'registry', 'raw.yaml')
  const rawDirectory = join(root, 'raw')
  await mkdir(dirname(rawRegistry), { recursive: true })
  const refs = assets.sources.flatMap((item) => Array.isArray(item.value.rawRefs) ? item.value.rawRefs.filter((ref): ref is string => typeof ref === 'string') : [])
  const registryExists = await hasPath(rawRegistry)
  const rawExists = await hasPath(rawDirectory)
  if (!registryExists && refs.length === 0 && !rawExists) {
    await writeFile(rawRegistry, '{}\n', 'utf8')
    return []
  }
  if (!registryExists) { await writeFile(rawRegistry, '{}\n', 'utf8'); return [review(runId, handle.knowledgeBaseId, 'raw_provenance_mapping_required', 'Legacy Raw content or Source.rawRefs cannot be mapped to a canonical Raw Registry deterministically.', 'review_raw_provenance')] }
  let value: unknown
  try { value = parseYaml(await readFile(rawRegistry, 'utf8'), rawRegistry) } catch { await writeFile(rawRegistry, '{}\n', 'utf8'); return [review(runId, handle.knowledgeBaseId, 'raw_provenance_mapping_required', 'The legacy Raw Registry cannot be parsed safely.', 'repair_raw_registry')] }
  if (!isObject(value)) { await writeFile(rawRegistry, '{}\n', 'utf8'); return [review(runId, handle.knowledgeBaseId, 'raw_provenance_mapping_required', 'The legacy Raw Registry is not an object map.', 'repair_raw_registry')] }
  const missing = refs.filter((ref) => !isObject(value[ref]))
  return missing.length > 0 ? [review(runId, handle.knowledgeBaseId, 'raw_provenance_mapping_required', 'Source.rawRefs do not resolve to proven Raw Registry entries.', 'review_raw_provenance', undefined, { missingRawRefs: [...new Set(missing)].sort() })] : []
}

export async function transformV01ToV02(sourceHandle: KnowledgeBaseHandle, stagingRoot: string, migrationRunId: string): Promise<TransformResult> {
  const sourceAssets = await new KnowledgeLoader({ rootDir: sourceHandle.rootRef }).readAssets()
  const before = inventory(sourceAssets)
  const reviewItems: MigrationReviewItem[] = []
  for (const item of sourceAssets.sources) {
    const source = item.value as Record<string, unknown>
    if (source.sourceType !== undefined && !SOURCE_TYPES.includes(source.sourceType as never)) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'source_semantic_mapping_required', 'Source sourceType cannot be mapped to the Schema 0.2 enum without guessing.', 'review_source_semantics', item.value.id, { sourceType: source.sourceType }))
    if (source.sourceReliability !== undefined && !SOURCE_RELIABILITIES.includes(source.sourceReliability as never)) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'source_semantic_mapping_required', 'Source sourceReliability cannot be mapped to the Schema 0.2 enum without guessing.', 'review_source_semantics', item.value.id, { sourceReliability: source.sourceReliability }))
  }
  const reverse = reverseBindings(sourceAssets.moduleRegistry)
  const derivedTargets: string[] = []
  for (const item of sourceAssets.modules) {
    const module = item.value as Record<string, unknown>
    const existingTarget = typeof module.targetEntity === 'string' && module.targetEntity.trim() !== '' ? module.targetEntity : undefined
    const bound = [...(reverse.get(item.value.id) ?? new Set<string>())].sort((a, b) => a.localeCompare(b))
    if (bound.length > 1) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'module_target_ambiguous', 'A legacy module is bound to multiple entities.', 'choose_module_target', item.value.id, { entityIds: bound }))
    else if (!existingTarget && bound.length === 1) { module.targetEntity = bound[0]; derivedTargets.push(item.value.id) }
    else if (!existingTarget && bound.length === 0) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'module_target_missing', 'A module has no targetEntity and no unique legacy binding.', 'choose_module_target', item.value.id))
    else if (existingTarget && bound.length === 1 && bound[0] !== existingTarget) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'module_target_conflict', 'Module targetEntity conflicts with its legacy binding.', 'choose_module_target', item.value.id, { targetEntity: existingTarget, entityIds: bound }))
  }
  reviewItems.push(...await rawReview(stagingRoot, sourceAssets, sourceHandle, migrationRunId))
  const files = await registryFiles(stagingRoot)
  for (const file of files) if (!['index.yaml', 'modules.yaml', 'raw.yaml', 'assets.yaml'].includes(file)) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'unexpected_registry_contract', `Registry file cannot be classified safely: ${file}`, 'classify_registry_file', undefined, { file }))

  const all = [
    ...sourceAssets.entities.map((item) => [item.value.id, 'entity', rel(sourceHandle.rootRef, item.filePath)] as const),
    ...sourceAssets.relations.map((item) => [item.value.id, 'relation', rel(sourceHandle.rootRef, item.filePath)] as const),
    ...sourceAssets.intelligence.map((item) => [item.value.id, 'intelligence', rel(sourceHandle.rootRef, item.filePath)] as const),
    ...sourceAssets.modules.map((item) => [item.value.id, 'module', rel(sourceHandle.rootRef, item.filePath)] as const),
    ...sourceAssets.sources.map((item) => [item.value.id, 'source', rel(sourceHandle.rootRef, item.filePath)] as const),
  ]
  const canonical = Object.fromEntries([...all].sort(([left], [right]) => left.localeCompare(right)).map(([id, type, storageRef]) => [id, { type, storageRef }]))
  await writeFile(join(stagingRoot, 'registry', 'assets.yaml'), `${canonicalSerialize(canonical)}\n`, 'utf8')
  for (const item of sourceAssets.modules) if (derivedTargets.includes(item.value.id)) await writeFile(join(stagingRoot, rel(sourceHandle.rootRef, item.filePath)), `${canonicalSerialize(item.value)}\n`, 'utf8')
  await rm(join(stagingRoot, 'registry', 'index.yaml'), { force: true })
  await rm(join(stagingRoot, 'registry', 'modules.yaml'), { force: true })
  const targetAssets = await new CanonicalV02KnowledgeLoader(stagingRoot).readAssets()
  const after = inventory(targetAssets)
  const removed = [...new Set([...before.entityIds, ...before.relationIds, ...before.intelligenceIds, ...before.moduleIds, ...before.sourceIds])].filter((id) => !new Set([...after.entityIds, ...after.relationIds, ...after.intelligenceIds, ...after.moduleIds, ...after.sourceIds]).has(id))
  const added = [...new Set([...after.entityIds, ...after.relationIds, ...after.intelligenceIds, ...after.moduleIds, ...after.sourceIds])].filter((id) => !new Set([...before.entityIds, ...before.relationIds, ...before.intelligenceIds, ...before.moduleIds, ...before.sourceIds]).has(id))
  const invariants = { knowledgeBaseIdPreserved: true, idsPreserved: removed.length === 0 && added.length === 0, countsPreserved: JSON.stringify(before.counts) === JSON.stringify(after.counts), registryCanonical: true, moduleBindingsPreserved: reviewItems.every((item) => !item.code.startsWith('module_target_')), rawProvenancePreserved: !reviewItems.some((item) => item.code === 'raw_provenance_mapping_required') }
  if (!invariants.idsPreserved) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'identity_change_required', 'Knowledge IDs changed during deterministic migration.', 'review_identity_mapping', undefined, { removed, added }))
  if (!invariants.countsPreserved) reviewItems.push(review(migrationRunId, sourceHandle.knowledgeBaseId, 'asset_count_mismatch', 'Knowledge asset counts changed during migration.', 'review_asset_inventory'))
  return { before, after, idMappings: [], reviewItems, changes: { manifest: { schemaVersion: true, revisionIncrement: 1, updatedAt: true }, registry: { canonicalAssetsCreated: true, legacyIndexRemoved: true, legacyModulesRemoved: true, rawRegistryCreated: !await hasPath(join(sourceHandle.rootRef, 'registry', 'raw.yaml')) }, assets: { moduleTargetsDerived: derivedTargets.sort((a, b) => a.localeCompare(b)) } }, invariants }
}
