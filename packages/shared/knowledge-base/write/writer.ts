import { createHash } from 'node:crypto'
import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseKnowledgeBaseManifest, type KnowledgeBaseManifest, type KnowledgeOperation, type KnowledgeSource, type KnowledgeSourceOperation, type KnowledgeWritableObject, type ValidatedKnowledgeChangeSet, type KnowledgeWriteOperationSummary, type KnowledgeWriteResult } from '../../../../packages/schemas/knowledge/index.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../canonical-hash.ts'
import { KnowledgeBaseHandle } from '../handle.ts'
import { KnowledgeBaseLoader } from '../knowledge-base-loader.ts'
import { KnowledgeBaseRegistry } from '../registry.ts'
import { loadKnowledgeBaseManifest } from '../manifest-loader.ts'
import { parseYaml } from '../yaml.ts'
import { allocateKnowledgeStorageRef, kindForWritableObject, resolveAllocatedPath } from './path-allocation.ts'

const LOGICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type KnowledgeStagedStateValidator = (rootRef: string, manifest: KnowledgeBaseManifest) => Promise<void>
export type KnowledgeWriteFailpoint = (point: 'before_switch' | 'during_switch' | 'after_switch') => void | Promise<void>

export interface KnowledgeWriterOptions {
  loader?: KnowledgeBaseLoader
  registry?: KnowledgeBaseRegistry
  clock?: () => string
  stagedStateValidator?: KnowledgeStagedStateValidator
  failpoint?: KnowledgeWriteFailpoint
}

interface StoredRegistryEntry {
  type: 'entity' | 'relation' | 'intelligence' | 'module' | 'source'
  storageRef: string
}

interface MutableState {
  manifest: KnowledgeBaseManifest
  registry: Record<string, StoredRegistryEntry>
  objects: Map<string, Record<string, unknown>>
  paths: Map<string, string>
}

interface Journal {
  transactionId: string
  knowledgeBaseId: string
  previousRevision: number
  nextRevision: number
  stagingPath: string
  backupPath: string
  rootPath: string
  status: 'staged' | 'switching' | 'committed'
}

const processLocks = new Map<string, Promise<void>>()

function recoveryMarkerPath(rootPath: string): string {
  return `${rootPath}.recovery.json`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function jsonYaml(value: unknown): string {
  return `${canonicalSerialize(value)}\n`
}

function safeLogName(workflowRunId: string): string {
  if (!LOGICAL_ID_PATTERN.test(workflowRunId) || workflowRunId.includes('..')) throw new Error(`Unsafe workflowRunId: ${workflowRunId}`)
  return `${workflowRunId}.yaml`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationSummary(): KnowledgeWriteOperationSummary {
  return { sourceCreated: [], sourceMerged: [], knowledgeCreated: [], knowledgeUpdated: [], knowledgeSuperseded: [], knowledgeSourceMerged: [] }
}

function objectKind(object: Record<string, unknown>): StoredRegistryEntry['type'] {
  return kindForWritableObject(object as KnowledgeWritableObject)
}

function objectId(object: Record<string, unknown>): string {
  if (typeof object.id !== 'string') throw new Error('Knowledge object id must be a string')
  return object.id
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function readJsonYaml(path: string): Promise<Record<string, unknown>> {
  const value = parseYaml(await readFile(path, 'utf8'), path)
  if (!isObject(value)) throw new Error(`Expected object YAML at ${path}`)
  return value
}

async function writeJsonYaml(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, jsonYaml(value), 'utf8')
}

async function withProcessLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease })
  const chain = previous.then(() => current)
  processLocks.set(key, chain)
  await previous
  try { return await task() } finally {
    release()
    if (processLocks.get(key) === chain) processLocks.delete(key)
  }
}

async function acquireFilesystemLock(rootPath: string): Promise<() => Promise<void>> {
  const lockPath = join(dirname(rootPath), `.${createHash('sha256').update(rootPath).digest('hex').slice(0, 24)}.knowledge-write-lock`)
  try {
    await mkdir(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('write_lock_failed: Knowledge Base lock already exists')
    throw error
  }
  await writeFile(join(lockPath, 'owner.json'), jsonYaml({ rootPath, acquiredAt: new Date().toISOString() }), 'utf8')
  return async () => { await rm(lockPath, { recursive: true, force: false }) }
}

async function loadState(rootPath: string, loader: KnowledgeBaseLoader, handle: KnowledgeBaseHandle): Promise<MutableState> {
  const manifest = await loadKnowledgeBaseManifest(rootPath)
  const registryValue = await readJsonYaml(join(rootPath, 'registry', 'assets.yaml'))
  const assets = await loader.readAssets(handle)
  const registry: Record<string, StoredRegistryEntry> = {}
  for (const [id, entry] of Object.entries(registryValue)) {
    if (!isObject(entry) || typeof entry.type !== 'string' || typeof entry.storageRef !== 'string') throw new Error(`Invalid Registry entry: ${id}`)
    registry[id] = { type: entry.type as StoredRegistryEntry['type'], storageRef: entry.storageRef }
  }
  const objects = new Map<string, Record<string, unknown>>()
  const paths = new Map<string, string>()
  for (const collection of [assets.entities, assets.relations, assets.intelligence, assets.modules, assets.sources]) {
    for (const asset of collection) {
      objects.set(asset.value.id, clone(asset.value as Record<string, unknown>))
      paths.set(asset.value.id, asset.filePath)
    }
  }
  return { manifest, registry, objects, paths }
}

function mergeRefs(current: unknown, additions: string[]): string[] {
  return [...new Set([...(Array.isArray(current) ? current.filter((value): value is string => typeof value === 'string') : []), ...additions])].sort()
}

function applySourceOperation(state: MutableState, operation: KnowledgeSourceOperation, summary: KnowledgeWriteOperationSummary, hashes: KnowledgeWriteResult['hashes']): boolean {
  if (operation.type === 'source_create') {
    const source = clone(operation.source as Record<string, unknown>)
    const id = objectId(source)
    const storageRef = allocateKnowledgeStorageRef(source as KnowledgeSource)
    if (state.registry[id]) throw new Error(`create_collision: ${id}`)
    state.registry[id] = { type: 'source', storageRef }
    state.objects.set(id, source)
    state.paths.set(id, storageRef)
    summary.sourceCreated.push(id)
    hashes.push({ knowledgeId: id, afterHash: hashKnowledgeObject(source) })
    return true
  }
  const current = state.objects.get(operation.sourceId)
  const entry = state.registry[operation.sourceId]
  if (!current || !entry) throw new Error(`missing_target: ${operation.sourceId}`)
  const beforeHash = hashKnowledgeObject(current)
  const next = clone(current)
  if (operation.addRawRefs) next.rawRefs = mergeRefs(next.rawRefs, operation.addRawRefs)
  Object.assign(next, clone(operation.metadataPatch ?? {}))
  const afterHash = hashKnowledgeObject(next)
  if (beforeHash === afterHash) return false
  state.objects.set(operation.sourceId, next)
  summary.sourceMerged.push(operation.sourceId)
  hashes.push({ knowledgeId: operation.sourceId, beforeHash, afterHash })
  return true
}

function applyKnowledgeOperation(state: MutableState, operation: KnowledgeOperation, summary: KnowledgeWriteOperationSummary, hashes: KnowledgeWriteResult['hashes']): boolean {
  if (operation.type === 'create') {
    const object = clone(operation.object as Record<string, unknown>)
    const id = objectId(object)
    if (state.registry[id]) throw new Error(`create_collision: ${id}`)
    const storageRef = allocateKnowledgeStorageRef(object as KnowledgeWritableObject)
    state.registry[id] = { type: objectKind(object), storageRef }
    state.objects.set(id, object)
    state.paths.set(id, storageRef)
    summary.knowledgeCreated.push(id)
    hashes.push({ knowledgeId: id, afterHash: hashKnowledgeObject(object) })
    return true
  }
  const current = state.objects.get(operation.knowledgeId)
  const entry = state.registry[operation.knowledgeId]
  if (!current || !entry) throw new Error(`missing_target: ${operation.knowledgeId}`)
  const beforeHash = hashKnowledgeObject(current)
  if (operation.type === 'update') {
    const next = clone(operation.object as Record<string, unknown>)
    if (objectId(next) !== operation.knowledgeId || objectKind(next) !== entry.type) throw new Error(`update_identity: ${operation.knowledgeId}`)
    const afterHash = hashKnowledgeObject(next)
    if (afterHash === beforeHash) return false
    state.objects.set(operation.knowledgeId, next)
    summary.knowledgeUpdated.push(operation.knowledgeId)
    hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash })
    return true
  }
  if (operation.type === 'supersede') {
    const replacement = clone(operation.replacement as Record<string, unknown>)
    const replacementId = objectId(replacement)
    if (replacementId === operation.knowledgeId || state.registry[replacementId]) throw new Error(`supersede_identity: ${replacementId}`)
    const oldNext = clone(current)
    const lifecycle = isObject(oldNext.lifecycle) ? clone(oldNext.lifecycle) : { status: 'active' }
    lifecycle.status = 'superseded'
    oldNext.lifecycle = lifecycle
    oldNext.supersededBy = mergeRefs(oldNext.supersededBy, [replacementId])
    replacement.supersedes = mergeRefs(replacement.supersedes, [operation.knowledgeId])
    const replacementRef = allocateKnowledgeStorageRef(replacement as KnowledgeWritableObject)
    state.objects.set(operation.knowledgeId, oldNext)
    state.objects.set(replacementId, replacement)
    state.registry[replacementId] = { type: objectKind(replacement), storageRef: replacementRef }
    state.paths.set(replacementId, replacementRef)
    summary.knowledgeSuperseded.push(operation.knowledgeId)
    hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash: hashKnowledgeObject(oldNext) })
    hashes.push({ knowledgeId: replacementId, afterHash: hashKnowledgeObject(replacement) })
    return true
  }
  const next = clone(current)
  next.sourceRefs = mergeRefs(next.sourceRefs, operation.addSourceRefs)
  const afterHash = hashKnowledgeObject(next)
  if (afterHash === beforeHash) return false
  state.objects.set(operation.knowledgeId, next)
  summary.knowledgeSourceMerged.push(operation.knowledgeId)
  hashes.push({ knowledgeId: operation.knowledgeId, beforeHash, afterHash })
  return true
}

function writeStateFiles(rootPath: string, state: MutableState): Promise<void[]> {
  const writes: Promise<void>[] = [writeJsonYaml(join(rootPath, 'manifest.yaml'), state.manifest), writeJsonYaml(join(rootPath, 'registry', 'assets.yaml'), state.registry)]
  for (const [id, object] of state.objects) {
    const entry = state.registry[id]
    if (!entry) throw new Error(`Missing Registry entry for ${id}`)
    writes.push(writeJsonYaml(resolveAllocatedPath(rootPath, entry.storageRef), object))
  }
  return Promise.all(writes)
}

async function readLogs(rootPath: string): Promise<Record<string, unknown>[]> {
  const logDir = join(rootPath, 'logs', 'ingestion')
  if (!(await exists(logDir))) return []
  const names = (await readdir(logDir)).filter((name) => name.endsWith('.yaml')).sort()
  const logs: Record<string, unknown>[] = []
  for (const name of names) {
    const value = parseYaml(await readFile(join(logDir, name), 'utf8'), name)
    if (isObject(value)) logs.push(value)
  }
  return logs
}

async function writeJournal(path: string, journal: Journal): Promise<void> { await writeFile(path, jsonYaml(journal), 'utf8') }

async function validateRecoveredRoot(rootPath: string, expectedRevision: number, expectedKnowledgeBaseId: string): Promise<void> {
  const manifest = await loadKnowledgeBaseManifest(rootPath)
  if (manifest.knowledgeBaseId !== expectedKnowledgeBaseId || manifest.schemaVersion !== '0.2' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active') throw new Error('Recovery manifest identity or write compatibility is invalid')
  if (manifest.revision !== expectedRevision) throw new Error(`Recovery revision mismatch: expected ${expectedRevision}, got ${manifest.revision}`)
  const registry = parseYaml(await readFile(join(rootPath, 'registry', 'assets.yaml'), 'utf8'), join(rootPath, 'registry', 'assets.yaml'))
  if (!isObject(registry)) throw new Error('Recovery Registry is not an object')
}

function validateJournal(rootPath: string, journal: Journal): void {
  if (!journal || typeof journal !== 'object' || journal.rootPath !== rootPath || typeof journal.knowledgeBaseId !== 'string' || journal.knowledgeBaseId.trim() === '') throw new Error('Recovery marker identity is invalid')
  if (!Number.isInteger(journal.previousRevision) || !Number.isInteger(journal.nextRevision) || journal.previousRevision < 0 || journal.nextRevision < journal.previousRevision) throw new Error('Recovery marker revision is invalid')
  if (!['staged', 'switching', 'committed'].includes(journal.status)) throw new Error('Recovery marker status is invalid')
  const siblingPattern = (prefix: string, value: unknown) => typeof value === 'string' && value.startsWith(`${rootPath}.${prefix}-`) && /^[0-9a-f]{16}$/.test(value.slice(`${rootPath}.${prefix}-`.length)) && dirname(resolve(value)) === dirname(rootPath)
  if (!siblingPattern('staging', journal.stagingPath) || !siblingPattern('backup', journal.backupPath)) throw new Error('Recovery marker paths are invalid')
}

export async function recoverKnowledgeBaseWrite(rootRef: string): Promise<'none' | 'recovered' | 'committed'> {
  const rootPath = resolve(rootRef)
  const markerPath = recoveryMarkerPath(rootPath)
  if (!(await exists(markerPath))) return 'none'
  const markerStat = await lstat(markerPath)
  if (markerStat.isSymbolicLink()) throw new Error('Recovery marker cannot be a symlink')
  const journal = JSON.parse(await readFile(markerPath, 'utf8')) as Journal
  validateJournal(rootPath, journal)
  for (const path of [journal.stagingPath, journal.backupPath]) {
    if (await exists(path) && (await lstat(path)).isSymbolicLink()) throw new Error(`Recovery transaction path cannot be a symlink: ${path}`)
  }
  const rootExists = await exists(journal.rootPath)
  const stagingExists = await exists(journal.stagingPath)
  const backupExists = await exists(journal.backupPath)
  if (!rootExists && stagingExists) {
    await rename(journal.stagingPath, journal.rootPath)
    try {
      await validateRecoveredRoot(journal.rootPath, journal.nextRevision, journal.knowledgeBaseId)
    } catch (error) {
      await rm(journal.rootPath, { recursive: true, force: true })
      if (backupExists) await rename(journal.backupPath, journal.rootPath)
      throw error
    }
  } else if (!rootExists && backupExists) await rename(journal.backupPath, journal.rootPath)
  else if (rootExists && stagingExists) await rm(journal.stagingPath, { recursive: true, force: true })
  if (await exists(journal.backupPath)) await rm(journal.backupPath, { recursive: true, force: true })
  if (await exists(journal.stagingPath)) await rm(journal.stagingPath, { recursive: true, force: true })
  await rm(markerPath, { force: true })
  return rootExists || stagingExists ? 'recovered' : 'committed'
}

export class KnowledgeWriter {
  readonly loader: KnowledgeBaseLoader
  readonly registry: KnowledgeBaseRegistry
  private readonly clock: () => string

  constructor(private readonly options: KnowledgeWriterOptions = {}) {
    this.loader = options.loader ?? new KnowledgeBaseLoader()
    this.registry = options.registry ?? this.loader.registry
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  async write(handle: KnowledgeBaseHandle, receipt: ValidatedKnowledgeChangeSet): Promise<KnowledgeWriteResult> {
    const changeSet = receipt.changeSet
    const baseResult = { knowledgeBaseId: handle.knowledgeBaseId, changeSetId: changeSet.changeSetId, baseRevision: handle.revision, committedRevision: handle.revision, operations: operationSummary(), hashes: [] as KnowledgeWriteResult['hashes'] }
    if (receipt.knowledgeBaseId !== handle.knowledgeBaseId || receipt.schemaVersion !== handle.schemaVersion || receipt.baseRevision !== changeSet.expectedBaseRevision || receipt.changeSetId !== changeSet.changeSetId || receipt.changeSetHash !== hashKnowledgeObject(changeSet)) return { ...baseResult, status: 'rejected', error: { code: 'invalid_validation_receipt', message: 'ValidatedChangeSet receipt does not match ChangeSet or Handle' } }
    try {
      return await withProcessLock(resolve(handle.rootRef), async () => {
        const releaseFilesystemLock = await acquireFilesystemLock(resolve(handle.rootRef))
        try {
          await recoverKnowledgeBaseWrite(resolve(handle.rootRef))
          return await this.writeLocked(handle, receipt)
        } finally {
          await releaseFilesystemLock()
        }
      })
    } catch (error) {
      return { ...baseResult, status: 'failed', error: { code: error instanceof Error && error.message.startsWith('write_lock_failed') ? 'write_lock_failed' : 'write_failed', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  apply(handle: KnowledgeBaseHandle, receipt: ValidatedKnowledgeChangeSet): Promise<KnowledgeWriteResult> { return this.write(handle, receipt) }

  private async writeLocked(handle: KnowledgeBaseHandle, receipt: ValidatedKnowledgeChangeSet): Promise<KnowledgeWriteResult> {
    const rootPath = resolve(handle.rootRef)
    const changeSet = receipt.changeSet
    const currentManifest = await loadKnowledgeBaseManifest(rootPath)
    const baseResult = { knowledgeBaseId: currentManifest.knowledgeBaseId, changeSetId: changeSet.changeSetId, baseRevision: currentManifest.revision, committedRevision: currentManifest.revision, operations: operationSummary(), hashes: [] as KnowledgeWriteResult['hashes'] }
    if (currentManifest.schemaVersion !== '0.2' || currentManifest.storageFormatVersion !== '1' || currentManifest.status !== 'active') return { ...baseResult, status: 'rejected', error: { code: 'write_not_supported', message: 'Only active Schema 0.2 / Storage 1 Knowledge Bases are writable' } }
    if (changeSet.knowledgeBaseId !== currentManifest.knowledgeBaseId) return { ...baseResult, status: 'rejected', error: { code: 'knowledge_base_mismatch', message: 'ChangeSet Knowledge Base does not match manifest' } }
    const payloadHash = hashKnowledgeObject(changeSet)
    const existingLog = (await readLogs(rootPath)).find((log) => log.knowledgeBaseId === currentManifest.knowledgeBaseId && log.changeSetId === changeSet.changeSetId)
    if (existingLog) {
      if (existingLog.changeSetHash !== payloadHash) return { ...baseResult, status: 'rejected', error: { code: 'idempotency_conflict', message: 'ChangeSet ID was already used with a different payload' } }
      if (existingLog.status === 'completed' || existingLog.status === 'completed_with_review') return { ...baseResult, status: 'already_committed', committedRevision: Number(existingLog.committedRevision ?? currentManifest.revision), ingestionLogRef: typeof existingLog.ingestionLogRef === 'string' ? existingLog.ingestionLogRef : undefined }
    }
    if (currentManifest.revision !== changeSet.expectedBaseRevision || currentManifest.revision !== receipt.baseRevision) return { ...baseResult, status: 'rejected', error: { code: 'stale_base_revision', message: `Expected ${changeSet.expectedBaseRevision}, current ${currentManifest.revision}` } }
    const state = await loadState(rootPath, this.loader, handle)
    for (const operation of changeSet.sourceOperations) {
      if (operation.type !== 'source_create') {
        const current = state.objects.get(operation.sourceId)
        if (!current || hashKnowledgeObject(current) !== operation.expectedBeforeHash) return { ...baseResult, status: 'rejected', error: { code: 'stale_target_state', message: `Source target changed: ${operation.sourceId}` } }
      }
    }
    for (const operation of changeSet.knowledgeOperations) {
      if (operation.type === 'update' || operation.type === 'supersede' || operation.type === 'merge_source') {
        const current = state.objects.get(operation.knowledgeId)
        if (!current || hashKnowledgeObject(current) !== operation.expectedBeforeHash) return { ...baseResult, status: 'rejected', error: { code: 'stale_target_state', message: `Knowledge target changed: ${operation.knowledgeId}` } }
      }
    }
    const summary = operationSummary()
    const hashes: KnowledgeWriteResult['hashes'] = []
    let changed = false
    for (const operation of changeSet.sourceOperations) changed = applySourceOperation(state, operation, summary, hashes) || changed
    for (const operation of changeSet.knowledgeOperations) changed = applyKnowledgeOperation(state, operation, summary, hashes) || changed
    const nextRevision = changed ? currentManifest.revision + 1 : currentManifest.revision
    state.manifest = { ...state.manifest, revision: nextRevision, updatedAt: changed ? this.clock() : currentManifest.updatedAt }
    const transactionId = `${changeSet.workflowRunId}-${changeSet.changeSetId}`
    const stagingPath = `${rootPath}.staging-${createHash('sha256').update(transactionId).digest('hex').slice(0, 16)}`
    const backupPath = `${rootPath}.backup-${createHash('sha256').update(transactionId).digest('hex').slice(0, 16)}`
    const markerPath = recoveryMarkerPath(rootPath)
    const logRef = `logs/ingestion/${safeLogName(changeSet.workflowRunId)}`
    const rawRefs = [...new Set(changeSet.sourceOperations.flatMap((operation) => operation.type === 'source_create' ? (operation.source.rawRefs ?? []) : (operation.addRawRefs ?? [])))].sort()
    const logValue = { workflowRunId: changeSet.workflowRunId, changeSetId: changeSet.changeSetId, changeSetHash: payloadHash, knowledgeBaseId: currentManifest.knowledgeBaseId, schemaVersionAtExecution: currentManifest.schemaVersion, startedAt: this.clock(), completedAt: this.clock(), rawArchive: { rawRefs, created: [], reused: [] }, changes: { ...summary, hashes }, status: 'completed', writeStatus: changed ? 'committed' : 'no_changes', committedRevision: nextRevision, ingestionLogRef: logRef, userReview: undefined, schemaGaps: undefined, errors: [] }
    await rm(stagingPath, { recursive: true, force: true })
    await cp(rootPath, stagingPath, { recursive: true, errorOnExist: true })
    await writeStateFiles(stagingPath, state)
    await writeJsonYaml(join(stagingPath, logRef), logValue)
    const stagedManifest = parseKnowledgeBaseManifest(await readJsonYaml(join(stagingPath, 'manifest.yaml')))
    if (this.options.stagedStateValidator) await this.options.stagedStateValidator(stagingPath, stagedManifest)
    else await this.loader.readAssets(new KnowledgeBaseHandle({ knowledgeBaseId: stagedManifest.knowledgeBaseId, rootRef: stagingPath, schemaVersion: stagedManifest.schemaVersion, storageFormatVersion: stagedManifest.storageFormatVersion, revision: stagedManifest.revision, status: stagedManifest.status, compatibility: 'compatible' }))
    const journal: Journal = { transactionId, knowledgeBaseId: currentManifest.knowledgeBaseId, previousRevision: currentManifest.revision, nextRevision, stagingPath, backupPath, rootPath, status: 'staged' }
    await writeJournal(markerPath, journal)
    await this.options.failpoint?.('before_switch')
    await rm(backupPath, { recursive: true, force: true })
    await rename(rootPath, backupPath)
    journal.status = 'switching'
    await writeJournal(markerPath, journal)
    await this.options.failpoint?.('during_switch')
    await rename(stagingPath, rootPath)
    journal.status = 'committed'
    await writeJournal(markerPath, journal)
    await this.options.failpoint?.('after_switch')
    await rm(backupPath, { recursive: true, force: true })
    await rm(markerPath, { force: true })
    const committedHandle = await this.registry.refresh(rootPath)
    return { ...baseResult, status: changed ? 'committed' : 'no_changes', committedRevision: nextRevision, operations: summary, hashes, ingestionLogRef: logRef, committedHandle }
  }
}
