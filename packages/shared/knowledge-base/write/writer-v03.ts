import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseKnowledgeBaseManifest, type KnowledgeWriteResult } from '../../../../packages/schemas/knowledge/index.ts'
import type { KnowledgeOperationV03, KnowledgeSourceOperationV03, ValidatedKnowledgeChangeSetV03 } from '../../../../packages/schemas/knowledge/v03/index.ts'
import { CanonicalV03KnowledgeLoader } from '../canonical-v03-loader.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../canonical-hash.ts'
import { loadKnowledgeBaseManifest } from '../manifest-loader.ts'
import { KnowledgeBaseRegistry } from '../registry.ts'
import { parseYaml } from '../yaml.ts'
import { withKnowledgeBaseMutationLock } from '../mutation-lock.ts'
import { recoverKnowledgeBaseRoot, runKnowledgeRootTransaction, type KnowledgeRootTransactionFailpoint } from '../root-transaction.ts'
import { KnowledgeWriteInternalError } from './errors.ts'
import { allocateKnowledgeStorageRefV03, kindForWritableObjectV03 } from './path-allocation-v03.ts'
import { isSafeStorageRef, resolveAllocatedPath } from './path-allocation.ts'
import type { KnowledgeBaseHandle } from '../handle.ts'

type Dict = Record<string, unknown>
type RegistryKind = 'theme_group' | 'entity' | 'relation' | 'claim' | 'module' | 'source'
interface V03State { manifest: ReturnType<typeof parseKnowledgeBaseManifest>; registry: Record<string, { type: RegistryKind; storageRef: string }>; objects: Map<string, Dict>; paths: Map<string, string> }
interface V03WriterOptions { receipt: ValidatedKnowledgeChangeSetV03; registry: KnowledgeBaseRegistry; clock: () => string; stagedStateValidator?: (rootRef: string, manifest: ReturnType<typeof parseKnowledgeBaseManifest>) => Promise<void>; failpoint?: KnowledgeRootTransactionFailpoint }

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function clone<T>(value: T): T { return structuredClone(value) }
function jsonYaml(value: unknown): string { return `${canonicalSerialize(value)}\n` }
function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }
function safeLogName(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) throw new Error(`Unsafe workflowRunId: ${value}`); return `${value}.yaml` }
function summary(): KnowledgeWriteResult['operations'] { return { sourceCreated: [], sourceMerged: [], knowledgeCreated: [], knowledgeUpdated: [], knowledgeSuperseded: [], knowledgeSourceMerged: [] } }
function objectId(value: Dict): string { if (typeof value.id !== 'string') throw new Error('Schema 0.3 object ID must be a string'); return value.id }
function mergeRefs(value: unknown, refs: string[]): string[] { return [...new Set([...(Array.isArray(value) ? value.filter((ref): ref is string => typeof ref === 'string') : []), ...refs])].sort() }

async function loadState(rootPath: string): Promise<V03State> {
  const manifest = await loadKnowledgeBaseManifest(rootPath)
  const registryPath = join(rootPath, 'registry', 'assets.yaml')
  const registryValue = parseYaml(await readFile(registryPath, 'utf8'), registryPath)
  if (!isRecord(registryValue)) throw new Error('Schema 0.3 Registry must be an object map')
  const assets = await new CanonicalV03KnowledgeLoader(rootPath).readAssets()
  const registry: V03State['registry'] = {}
  for (const [id, raw] of Object.entries(registryValue)) {
    if (!isRecord(raw) || typeof raw.type !== 'string' || typeof raw.storageRef !== 'string') throw new Error(`Invalid Schema 0.3 Registry entry: ${id}`)
    registry[id] = { type: raw.type as RegistryKind, storageRef: raw.storageRef }
  }
  const objects = new Map<string, Dict>(); const paths = new Map<string, string>()
  for (const collection of [assets.themeGroups, assets.entities, assets.relations, assets.claims, assets.modules, assets.sources]) for (const asset of collection) { objects.set(asset.value.id, clone(asset.value) as unknown as Dict); paths.set(asset.value.id, asset.storageRef) }
  return { manifest, registry, objects, paths }
}

function writeStateFiles(rootPath: string, state: V03State): Promise<void[]> {
  const writes: Promise<void>[] = [writeJsonYaml(join(rootPath, 'manifest.yaml'), state.manifest), writeJsonYaml(join(rootPath, 'registry', 'assets.yaml'), state.registry)]
  for (const [id, object] of state.objects) {
    const entry = state.registry[id]
    if (!entry) throw new Error(`Missing Registry entry for ${id}`)
    if (!isSafeStorageRef(entry.storageRef)) throw new Error(`Unsafe Schema 0.3 Registry storageRef: ${entry.storageRef}`)
    writes.push(writeJsonYaml(resolveAllocatedPath(rootPath, entry.storageRef), object))
  }
  return Promise.all(writes)
}
async function writeJsonYaml(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, jsonYaml(value), 'utf8') }

function applySource(state: V03State, operation: KnowledgeSourceOperationV03, result: KnowledgeWriteResult['operations'], hashes: KnowledgeWriteResult['hashes']): boolean {
  if (operation.type === 'source_create') {
    const source = clone(operation.source) as unknown as Dict; const id = objectId(source)
    if (state.registry[id]) throw new KnowledgeWriteInternalError('id_conflict', `Source already exists: ${id}`)
    state.registry[id] = { type: 'source', storageRef: allocateKnowledgeStorageRefV03(operation.source) }; state.objects.set(id, source); result.sourceCreated.push(id); hashes.push({ knowledgeId: id, afterHash: hashKnowledgeObject(source) }); return true
  }
  const current = state.objects.get(operation.sourceId); if (!current || !state.registry[operation.sourceId]) throw new KnowledgeWriteInternalError('missing_source_reference', `Source target does not exist: ${operation.sourceId}`)
  const next = clone(current); if (operation.addRawRefs) next.rawRefs = mergeRefs(next.rawRefs, operation.addRawRefs); Object.assign(next, clone(operation.metadataPatch ?? {}))
  const beforeHash = hashKnowledgeObject(current); const afterHash = hashKnowledgeObject(next); if (beforeHash === afterHash) return false
  state.objects.set(operation.sourceId, next); result.sourceMerged.push(operation.sourceId); hashes.push({ knowledgeId: operation.sourceId, beforeHash, afterHash }); return true
}

function applyKnowledge(state: V03State, operation: KnowledgeOperationV03, result: KnowledgeWriteResult['operations'], hashes: KnowledgeWriteResult['hashes']): boolean {
  if (operation.type === 'create') {
    const object = clone(operation.object) as unknown as Dict; const id = objectId(object); if (state.registry[id]) throw new KnowledgeWriteInternalError('id_conflict', `Knowledge object already exists: ${id}`)
    state.registry[id] = { type: kindForWritableObjectV03(operation.object), storageRef: allocateKnowledgeStorageRefV03(operation.object) }; state.objects.set(id, object); result.knowledgeCreated.push(id); hashes.push({ knowledgeId: id, afterHash: hashKnowledgeObject(object) }); return true
  }
  const current = state.objects.get(operation.knowledgeId); const entry = state.registry[operation.knowledgeId]; if (!current || !entry) throw new KnowledgeWriteInternalError('reference_integrity_error', `Knowledge target does not exist: ${operation.knowledgeId}`)
  const beforeHash = hashKnowledgeObject(current)
  if (operation.type === 'update') { const next = clone(operation.object) as unknown as Dict; if (objectId(next) !== operation.knowledgeId || kindForWritableObjectV03(operation.object) !== entry.type) throw new KnowledgeWriteInternalError('invalid_change_set', `Update identity is invalid: ${operation.knowledgeId}`); const afterHash = hashKnowledgeObject(next); if (afterHash === beforeHash) return false; state.objects.set(operation.knowledgeId, next); result.knowledgeUpdated.push(operation.knowledgeId); hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash }); return true }
  if (operation.type === 'supersede') { if (entry.type !== 'claim') throw new KnowledgeWriteInternalError('invalid_change_set', 'Only Claims may be superseded in Schema 0.3'); const replacement = clone(operation.replacement) as unknown as Dict; const replacementId = objectId(replacement); if (state.registry[replacementId] || replacementId === operation.knowledgeId) throw new KnowledgeWriteInternalError('id_conflict', `Supersede replacement conflicts: ${replacementId}`); const oldNext = clone(current); const lifecycle = isRecord(oldNext.lifecycle) ? clone(oldNext.lifecycle) : { status: 'active' }; lifecycle.status = 'superseded'; oldNext.lifecycle = lifecycle; oldNext.supersededBy = mergeRefs(oldNext.supersededBy, [replacementId]); replacement.supersedes = mergeRefs(replacement.supersedes, [operation.knowledgeId]); state.objects.set(operation.knowledgeId, oldNext); state.registry[replacementId] = { type: 'claim', storageRef: allocateKnowledgeStorageRefV03(operation.replacement) }; state.objects.set(replacementId, replacement); result.knowledgeSuperseded.push(operation.knowledgeId); hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash: hashKnowledgeObject(oldNext) }, { knowledgeId: replacementId, afterHash: hashKnowledgeObject(replacement) }); return true }
  if (!('sourceRefs' in current)) throw new KnowledgeWriteInternalError('invalid_change_set', `Object does not declare sourceRefs: ${operation.knowledgeId}`)
  const next = clone(current); next.sourceRefs = mergeRefs(next.sourceRefs, operation.addSourceRefs); const afterHash = hashKnowledgeObject(next); if (afterHash === beforeHash) return false; state.objects.set(operation.knowledgeId, next); result.knowledgeSourceMerged.push(operation.knowledgeId); hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash }); return true
}

async function readLogs(rootPath: string): Promise<Dict[]> { const dir = join(rootPath, 'logs', 'ingestion'); if (!(await exists(dir))) return []; return Promise.all((await readdir(dir)).filter((name) => name.endsWith('.yaml')).sort().map(async (name) => { const value = parseYaml(await readFile(join(dir, name), 'utf8'), name); return isRecord(value) ? value : {} })) }

export async function writeKnowledgeBaseV03(handle: KnowledgeBaseHandle, options: V03WriterOptions): Promise<KnowledgeWriteResult> {
  const changeSet = options.receipt.changeSet; const base = { knowledgeBaseId: handle.knowledgeBaseId, changeSetId: changeSet.changeSetId, baseRevision: handle.revision, committedRevision: handle.revision, operations: summary(), hashes: [] as KnowledgeWriteResult['hashes'] }
  if (!options.stagedStateValidator) return { ...base, status: 'rejected', error: { code: 'validation_required', message: 'Schema 0.3 Writer requires a full staged-state validator before semantic commit' } }
  if (options.receipt.knowledgeBaseId !== handle.knowledgeBaseId || options.receipt.schemaVersion !== handle.schemaVersion || options.receipt.baseRevision !== changeSet.expectedBaseRevision || options.receipt.changeSetId !== changeSet.changeSetId || options.receipt.changeSetHash !== hashKnowledgeObject(changeSet)) return { ...base, status: 'rejected', error: { code: 'validation_required', message: 'Validated v0.3 receipt does not match ChangeSet or Handle' } }
  try {
    return await withKnowledgeBaseMutationLock(resolve(handle.rootRef), async () => {
      await recoverKnowledgeBaseRoot(handle.rootRef)
      const rootPath = resolve(handle.rootRef); const currentManifest = await loadKnowledgeBaseManifest(rootPath)
      if (currentManifest.schemaVersion !== '0.3' || currentManifest.storageFormatVersion !== '1') return { ...base, status: 'rejected', error: { code: 'schema_version_mismatch', message: 'Only Schema 0.3 / Storage 1 Knowledge Bases are writable' } }
      if (currentManifest.status !== 'active' || !handle.writable) return { ...base, status: 'rejected', error: { code: 'knowledge_base_not_writable', message: 'Knowledge Base is not active and writable' } }
      const payloadHash = hashKnowledgeObject(changeSet); const existingLog = (await readLogs(rootPath)).find((log) => log.knowledgeBaseId === currentManifest.knowledgeBaseId && log.changeSetId === changeSet.changeSetId)
      if (existingLog) { if (existingLog.changeSetHash !== payloadHash) return { ...base, status: 'rejected', error: { code: 'idempotency_conflict', message: 'ChangeSet ID was already used with a different payload' } }; if (existingLog.status === 'completed' || existingLog.status === 'completed_with_review') return { ...base, status: 'already_committed', committedRevision: Number(existingLog.committedRevision ?? currentManifest.revision), ingestionLogRef: typeof existingLog.ingestionLogRef === 'string' ? existingLog.ingestionLogRef : undefined } }
      if (currentManifest.revision !== changeSet.expectedBaseRevision) return { ...base, status: 'rejected', error: { code: 'stale_base_revision', message: `Expected ${changeSet.expectedBaseRevision}, current ${currentManifest.revision}` } }
      const state = await loadState(rootPath); const result = summary(); const hashes: KnowledgeWriteResult['hashes'] = []; let changed = false
      for (const operation of changeSet.sourceOperations) { if (operation.type !== 'source_create') { const current = state.objects.get(operation.sourceId); if (!current || hashKnowledgeObject(current) !== operation.expectedBeforeHash) return { ...base, status: 'rejected', error: { code: 'stale_target_state', message: `Source target changed: ${operation.sourceId}` } } } changed = applySource(state, operation, result, hashes) || changed }
      for (const operation of changeSet.knowledgeOperations) { if (operation.type !== 'create') { const current = state.objects.get(operation.knowledgeId); if (!current || hashKnowledgeObject(current) !== operation.expectedBeforeHash) return { ...base, status: 'rejected', error: { code: 'stale_target_state', message: `Knowledge target changed: ${operation.knowledgeId}` } } } changed = applyKnowledge(state, operation, result, hashes) || changed }
      const nextRevision = changed ? currentManifest.revision + 1 : currentManifest.revision; state.manifest = { ...state.manifest, revision: nextRevision, updatedAt: changed ? options.clock() : currentManifest.updatedAt }
      const logRef = `logs/ingestion/${safeLogName(changeSet.workflowRunId)}`; const logValue = { workflowRunId: changeSet.workflowRunId, changeSetId: changeSet.changeSetId, changeSetHash: payloadHash, knowledgeBaseId: currentManifest.knowledgeBaseId, schemaVersionAtExecution: '0.3', startedAt: options.clock(), completedAt: options.clock(), changes: { ...result, hashes }, status: 'completed', writeStatus: changed ? 'committed' : 'no_changes', committedRevision: nextRevision, ingestionLogRef: logRef, ingestionContext: changeSet.ingestionContext, errors: [] }
      await runKnowledgeRootTransaction({ rootRef: rootPath, transactionId: `${changeSet.workflowRunId}-${changeSet.changeSetId}`, transactionKind: 'write', knowledgeBaseId: currentManifest.knowledgeBaseId, previousRevision: currentManifest.revision, nextRevision, targetSchemaVersion: '0.3', targetStorageFormatVersion: '1', targetStatus: 'active', prepare: async (stagingPath) => { await writeStateFiles(stagingPath, state); await writeJsonYaml(join(stagingPath, logRef), logValue) }, validate: async (stagingPath) => { try { await new CanonicalV03KnowledgeLoader(stagingPath).readAssets(); if (options.stagedStateValidator) await options.stagedStateValidator(stagingPath, parseKnowledgeBaseManifest(parseYaml(await readFile(join(stagingPath, 'manifest.yaml'), 'utf8'), join(stagingPath, 'manifest.yaml')))) } catch (error) { if (error instanceof KnowledgeWriteInternalError) throw error; throw new KnowledgeWriteInternalError('reference_integrity_error', error instanceof Error ? error.message : String(error)) } }, failpoint: options.failpoint })
      const committedHandle = await options.registry.refresh(rootPath); return { ...base, status: changed ? 'committed' : 'no_changes', committedRevision: nextRevision, operations: result, hashes, ingestionLogRef: logRef, committedHandle }
    })
  } catch (error) { const code = error instanceof KnowledgeWriteInternalError ? error.publicCode : 'commit_failed'; return { ...base, status: 'failed', error: { code, message: error instanceof Error ? error.message : String(error) } } }
}
