import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY } from '../../../schemas/knowledge/migrations/registry.ts'
import type { KnowledgeMigrationDefinition } from '../../../schemas/knowledge/index.ts'
import { parseKnowledgeBaseManifest, type KnowledgeBaseManifest } from '../../../schemas/knowledge/index.ts'
import { loadKnowledgeBaseManifest } from '../manifest-loader.ts'
import { KnowledgeBaseRegistry } from '../registry.ts'
import { KnowledgeBaseHandle } from '../handle.ts'
import { withKnowledgeBaseMutationLock } from '../mutation-lock.ts'
import { recoverKnowledgeBaseRoot, runKnowledgeRootTransaction } from '../root-transaction.ts'
import { canonicalSerialize } from '../canonical-hash.ts'
import { parseYaml } from '../yaml.ts'
import { KnowledgeMigrationError } from './errors.ts'
import { transformV01ToV02 } from './v01-to-v02.ts'
import type { KnowledgeMigrationResult, KnowledgeMigrationRunnerOptions, KnowledgeMigrationRequest, KnowledgeMigrationStateValidator } from './types.ts'

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function emptyInventory() { return { entityIds: [], relationIds: [], intelligenceIds: [], moduleIds: [], sourceIds: [], counts: { entities: 0, relations: 0, intelligence: 0, modules: 0, sources: 0 } } }
function validRunId(value: unknown): value is string { return typeof value === 'string' && RUN_ID_PATTERN.test(value) && !value.includes('..') && !value.includes('/') && !value.includes('\\') }
function sameVersion(left: { schemaVersion: string; storageFormatVersion: string }, right: { schemaVersion: string; storageFormatVersion: string }): boolean { return left.schemaVersion === right.schemaVersion && left.storageFormatVersion === right.storageFormatVersion }
function errorValue(error: unknown): { code: string; message: string } { return { code: error instanceof KnowledgeMigrationError ? error.code : 'migration_failed', message: error instanceof Error ? error.message : String(error) } }
function baseResult(input: KnowledgeMigrationRequest, handle: KnowledgeBaseHandle, migrationPath: KnowledgeMigrationDefinition[], status: KnowledgeMigrationResult['status'], error?: { code: string; message: string }): KnowledgeMigrationResult { return { migrationRunId: input.migrationRunId, knowledgeBaseId: handle.knowledgeBaseId, mode: input.mode, status, migrationPath, source: { schemaVersion: handle.schemaVersion, storageFormatVersion: handle.storageFormatVersion, revision: handle.revision }, target: { schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: handle.revision }, inventory: { before: emptyInventory() }, idMappings: [], reviewItems: [], changes: { manifest: { schemaVersion: false, revisionIncrement: 0, updatedAt: false }, registry: { canonicalAssetsCreated: false, legacyIndexRemoved: false, legacyModulesRemoved: false, rawRegistryCreated: false }, assets: { moduleTargetsDerived: [] } }, validation: { source: 'not_run', target: 'not_run' }, ...(error ? { error } : {}) } }
async function writeManifest(path: string, manifest: KnowledgeBaseManifest): Promise<void> { await writeFile(path, `${canonicalSerialize(manifest)}\n`, 'utf8') }
async function stageCopy(root: string, runId: string): Promise<string> { const path = `${root}.migration-staging-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`; await rm(path, { recursive: true, force: true }); await cp(root, path, { recursive: true, errorOnExist: true }); return path }

export class KnowledgeMigrationRunner {
  readonly registry: KnowledgeBaseRegistry
  readonly migrationRegistry: typeof DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY
  private readonly validator?: KnowledgeMigrationStateValidator
  private readonly clock: () => string
  private readonly failpoint?: KnowledgeMigrationRunnerOptions['failpoint']

  constructor(options: KnowledgeMigrationRunnerOptions = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.migrationRegistry = options.migrationRegistry ?? DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY
    this.validator = options.validator
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.failpoint = options.failpoint
  }

  async migrate(handle: KnowledgeBaseHandle, input: KnowledgeMigrationRequest): Promise<KnowledgeMigrationResult> {
    if (!validRunId(input?.migrationRunId)) return baseResult(input, handle, [], 'blocked', { code: 'invalid_migration_run_id', message: 'migrationRunId must be path-safe and must not contain traversal or separators' })
    if (!Number.isInteger(input.expectedBaseRevision) || input.expectedBaseRevision < 0) return baseResult(input, handle, [], 'blocked', { code: 'invalid_expected_base_revision', message: 'expectedBaseRevision must be a non-negative integer' })
    if (!['dry_run', 'commit'].includes(input.mode)) return baseResult(input, handle, [], 'blocked', { code: 'invalid_migration_mode', message: 'mode must be dry_run or commit' })
    const source = { schemaVersion: handle.schemaVersion, storageFormatVersion: handle.storageFormatVersion }
    const target = { schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion }
    if (sameVersion(source, target)) return baseResult(input, handle, [], 'already_current')
    const path = this.migrationRegistry.resolvePath(source, target)
    if (path.length === 0) return baseResult(input, handle, [], 'blocked', { code: 'migration_path_not_found', message: `No migration path from ${source.schemaVersion}/${source.storageFormatVersion} to ${target.schemaVersion}/${target.storageFormatVersion}` })
    if (!this.validator) return baseResult(input, handle, path, 'blocked', { code: 'migration_validation_required', message: 'Migration Runner requires an injected source and target validator' })
    try {
      return await withKnowledgeBaseMutationLock(handle.rootRef, async () => this.migrateLocked(handle, input, path, this.validator!))
    } catch (error) {
      return baseResult(input, handle, path, 'failed', errorValue(error))
    }
  }

  private async migrateLocked(handle: KnowledgeBaseHandle, input: KnowledgeMigrationRequest, path: KnowledgeMigrationDefinition[], validator: KnowledgeMigrationStateValidator): Promise<KnowledgeMigrationResult> {
    const root = resolve(handle.rootRef)
    try { await recoverKnowledgeBaseRoot(root) } catch (error) { return baseResult(input, handle, path, 'blocked', { code: 'recovery_required', message: error instanceof Error ? error.message : String(error) }) }
    let manifest: KnowledgeBaseManifest
    try { manifest = await loadKnowledgeBaseManifest(root) } catch (error) { return baseResult(input, handle, path, 'blocked', errorValue(error)) }
    const result = baseResult(input, handle, path, 'failed')
    result.source = { schemaVersion: manifest.schemaVersion, storageFormatVersion: manifest.storageFormatVersion, revision: manifest.revision }
    result.target.revision = manifest.revision + 1
    if (manifest.knowledgeBaseId !== handle.knowledgeBaseId) return { ...result, status: 'blocked', error: { code: 'knowledge_base_identity_mismatch', message: 'Mounted Handle does not match manifest identity' } }
    if (!sameVersion(manifest, { schemaVersion: handle.schemaVersion, storageFormatVersion: handle.storageFormatVersion })) return { ...result, status: 'blocked', error: { code: 'stale_handle', message: 'Mounted Handle schema does not match the current manifest' } }
    if (manifest.revision !== input.expectedBaseRevision) return { ...result, status: 'blocked', error: { code: 'stale_base_revision', message: `Expected ${input.expectedBaseRevision}, current ${manifest.revision}` } }
    if (input.mode === 'commit' && manifest.status !== 'active') return { ...result, status: 'blocked', error: { code: 'knowledge_base_not_writable', message: `Migration commit requires an active Knowledge Base, got ${manifest.status}` } }
    if (path.length !== 1 || path[0]?.id !== 'knowledge-schema-0.1-to-0.2') return { ...result, status: 'blocked', error: { code: 'migration_not_implemented', message: 'Only the concrete Schema 0.1 to 0.2 migration is implemented' } }
    try { await validator.validateSource(handle); result.validation.source = 'passed' } catch (error) { result.validation.source = 'failed'; result.validation.errors = [error instanceof Error ? error.message : String(error)]; return { ...result, status: 'blocked', error: { code: 'source_validation_failed', message: result.validation.errors[0]! } } }

    const preflight = await this.prepareAndValidate(root, handle, manifest, input, validator)
    result.inventory.before = preflight.transformation.before
    result.inventory.after = preflight.transformation.after
    result.idMappings = preflight.transformation.idMappings
    result.reviewItems = preflight.transformation.reviewItems
    result.changes = preflight.transformation.changes
    result.validation.target = preflight.targetValidation
    if (preflight.error && result.reviewItems.length === 0) return { ...result, status: 'blocked', error: preflight.error }
    if (result.reviewItems.length > 0 || Object.values(preflight.transformation.invariants).some((value) => !value)) return { ...result, status: 'review_required' }
    if (input.mode === 'dry_run') return { ...result, status: 'dry_run_passed' }

    const targetManifest = { ...manifest, schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: manifest.revision + 1, updatedAt: this.clock() }
    const logRef = `logs/migrations/${input.migrationRunId}.yaml`
    let transformation = preflight.transformation
    try {
      await runKnowledgeRootTransaction({
        rootRef: root,
        transactionId: `migration-${input.migrationRunId}`,
        transactionKind: 'migration',
        knowledgeBaseId: manifest.knowledgeBaseId,
        previousRevision: manifest.revision,
        nextRevision: manifest.revision + 1,
        targetSchemaVersion: input.targetSchemaVersion,
        targetStorageFormatVersion: input.targetStorageFormatVersion,
        targetStatus: manifest.status,
        prepare: async (stagingPath) => { transformation = await transformV01ToV02(handle, stagingPath, input.migrationRunId); await writeManifest(join(stagingPath, 'manifest.yaml'), targetManifest); await mkdir(dirname(join(stagingPath, logRef)), { recursive: true }); await writeFile(join(stagingPath, logRef), `${canonicalSerialize({ migrationRunId: input.migrationRunId, migrationId: path[0]!.id, knowledgeBaseId: manifest.knowledgeBaseId, startedAt: this.clock(), completedAt: this.clock(), source: { schemaVersion: manifest.schemaVersion, storageFormatVersion: manifest.storageFormatVersion, revision: manifest.revision }, target: { schemaVersion: targetManifest.schemaVersion, storageFormatVersion: targetManifest.storageFormatVersion, revision: targetManifest.revision }, migrationPath: path, inventory: { before: transformation.before, after: transformation.after }, idMappings: transformation.idMappings, reviewItems: [], invariants: transformation.invariants, status: 'completed' })}\n`, 'utf8') },
        validate: async (stagingPath) => { const stagedManifest = parseKnowledgeBaseManifest(parseYaml(await readFile(join(stagingPath, 'manifest.yaml'), 'utf8'))); await validator.validateTarget(stagingPath, stagedManifest) },
        failpoint: this.failpoint,
      })
    } catch (error) { return { ...result, status: 'failed', error: errorValue(error) } }
    const committedHandle = await this.registry.refresh(root)
    result.status = 'committed'; result.target.revision = committedHandle.revision; result.migrationLogRef = logRef; result.committedHandle = committedHandle; return result
  }

  private async prepareAndValidate(root: string, handle: KnowledgeBaseHandle, manifest: KnowledgeBaseManifest, input: KnowledgeMigrationRequest, validator: KnowledgeMigrationStateValidator): Promise<{ transformation: Awaited<ReturnType<typeof transformV01ToV02>>; targetValidation: 'passed' | 'failed'; error?: { code: string; message: string } }> {
    const staging = await stageCopy(root, `preflight-${input.migrationRunId}`)
    try {
      const transformation = await transformV01ToV02(handle, staging, input.migrationRunId)
      const targetManifest = { ...manifest, schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: manifest.revision + 1, updatedAt: this.clock() }
      await writeManifest(join(staging, 'manifest.yaml'), targetManifest)
      await validator.validateTarget(staging, targetManifest)
      return { transformation, targetValidation: 'passed' }
    } catch (error) {
      return { transformation: { before: emptyInventory(), after: emptyInventory(), idMappings: [], reviewItems: [], changes: { manifest: { schemaVersion: false, revisionIncrement: 0, updatedAt: false }, registry: { canonicalAssetsCreated: false, legacyIndexRemoved: false, legacyModulesRemoved: false, rawRegistryCreated: false }, assets: { moduleTargetsDerived: [] } }, invariants: {} }, targetValidation: 'failed', error: { code: 'target_validation_failed', message: error instanceof Error ? error.message : String(error) } }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}
