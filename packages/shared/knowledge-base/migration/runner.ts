import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_KNOWLEDGE_MIGRATION_REGISTRY } from '../../../schemas/knowledge/migrations/registry.ts'
import { KnowledgeMigrationPathError } from '../../../schemas/knowledge/migrations/errors.ts'
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
import { transformV02ToV03 } from './v02-to-v03.ts'
import type { KnowledgeMigrationResult, KnowledgeMigrationRunnerOptions, KnowledgeMigrationRequest, KnowledgeMigrationStateValidator } from './types.ts'

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
type Transformation = Awaited<ReturnType<typeof transformV01ToV02>> | Awaited<ReturnType<typeof transformV02ToV03>>

function emptyInventory() { return { entityIds: [], relationIds: [], intelligenceIds: [], moduleIds: [], sourceIds: [], counts: { entities: 0, relations: 0, intelligence: 0, modules: 0, sources: 0 } } }
function emptyTransformation(): Transformation { return { before: emptyInventory(), after: emptyInventory(), idMappings: [], reviewItems: [], warnings: [], changes: { manifest: { schemaVersion: false, revisionIncrement: 0, updatedAt: false }, registry: { canonicalAssetsCreated: false, legacyIndexRemoved: false, legacyModulesRemoved: false, rawRegistryCreated: false }, assets: { moduleTargetsDerived: [] } }, invariants: {} } }
function validRunId(value: unknown): value is string { return typeof value === 'string' && RUN_ID_PATTERN.test(value) && !value.includes('..') && !value.includes('/') && !value.includes('\\') }
function validVersion(value: unknown): value is string { return typeof value === 'string' && value.trim() !== '' }
function sameVersion(left: { schemaVersion: string; storageFormatVersion: string }, right: { schemaVersion: string; storageFormatVersion: string }): boolean { return left.schemaVersion === right.schemaVersion && left.storageFormatVersion === right.storageFormatVersion }
function hasReviewCondition(transformation: Transformation): boolean { return transformation.reviewItems.length > 0 || Object.values(transformation.invariants).some((value) => !value) }
async function transformFor(definition: KnowledgeMigrationDefinition, handle: KnowledgeBaseHandle, staging: string, runId: string): Promise<Transformation> {
  if (definition.id === 'knowledge-schema-0.1-to-0.2') return transformV01ToV02(handle, staging, runId)
  if (definition.id === 'knowledge-schema-0.2-to-0.3') return transformV02ToV03(handle, staging, runId)
  throw new KnowledgeMigrationError('migration_not_implemented', `Migration implementation is not available: ${definition.id}`)
}
function signature(transformation: Transformation): string { return JSON.stringify({ before: transformation.before, after: transformation.after, idMappings: transformation.idMappings, reviewItems: transformation.reviewItems, warnings: 'warnings' in transformation ? transformation.warnings : [], changes: transformation.changes, invariants: transformation.invariants }) }
function errorValue(error: unknown): { code: string; message: string } { return { code: error instanceof KnowledgeMigrationError ? error.code : 'migration_failed', message: error instanceof Error ? error.message : String(error) } }
function baseResult(input: KnowledgeMigrationRequest, handle: KnowledgeBaseHandle, migrationPath: KnowledgeMigrationDefinition[], status: KnowledgeMigrationResult['status'], error?: { code: string; message: string }): KnowledgeMigrationResult { return { migrationRunId: input.migrationRunId, knowledgeBaseId: handle.knowledgeBaseId, mode: input.mode, status, migrationPath, source: { schemaVersion: handle.schemaVersion, storageFormatVersion: handle.storageFormatVersion, revision: handle.revision }, target: { schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: handle.revision }, inventory: { before: emptyInventory() }, idMappings: [], reviewItems: [], changes: { manifest: { schemaVersion: false, revisionIncrement: 0, updatedAt: false }, registry: { canonicalAssetsCreated: false, legacyIndexRemoved: false, legacyModulesRemoved: false, rawRegistryCreated: false }, assets: { moduleTargetsDerived: [] } }, warnings: [], validation: { source: 'not_run', target: 'not_run' }, ...(error ? { error } : {}) } }
async function writeManifest(path: string, manifest: KnowledgeBaseManifest): Promise<void> { await writeFile(path, `${canonicalSerialize(manifest)}\n`, 'utf8') }
async function stageCopy(root: string, runId: string): Promise<string> { const path = `${root}.migration-staging-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`; await rm(path, { recursive: true, force: true }); await cp(root, path, { recursive: true, errorOnExist: true }); return path }

export class KnowledgeMigrationRunner {
  readonly registry: KnowledgeBaseRegistry
  readonly migrationRegistry: KnowledgeMigrationRunnerOptions['migrationRegistry']
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
    const request = input ?? ({} as KnowledgeMigrationRequest)
    if (!validRunId(request.migrationRunId)) return baseResult(request, handle, [], 'blocked', { code: 'invalid_migration_run_id', message: 'migrationRunId must be path-safe and must not contain traversal or separators' })
    if (!Number.isInteger(request.expectedBaseRevision) || request.expectedBaseRevision < 0) return baseResult(request, handle, [], 'blocked', { code: 'invalid_expected_base_revision', message: 'expectedBaseRevision must be a non-negative integer' })
    if (!['dry_run', 'commit'].includes(request.mode)) return baseResult(request, handle, [], 'blocked', { code: 'invalid_migration_mode', message: 'mode must be dry_run or commit' })
    if (!validVersion(request.targetSchemaVersion) || !validVersion(request.targetStorageFormatVersion)) return baseResult(request, handle, [], 'blocked', { code: 'invalid_migration_target', message: 'target schema and storage versions must be non-empty strings' })
    if (!this.validator) return baseResult(request, handle, [], 'blocked', { code: 'migration_validation_required', message: 'Migration Runner requires an injected source and target validator' })
    try {
      return await withKnowledgeBaseMutationLock(handle.rootRef, async () => this.migrateLocked(handle, request, this.validator!))
    } catch (error) {
      return baseResult(request, handle, [], 'failed', errorValue(error))
    }
  }

  private async migrateLocked(handle: KnowledgeBaseHandle, input: KnowledgeMigrationRequest, validator: KnowledgeMigrationStateValidator): Promise<KnowledgeMigrationResult> {
    const root = resolve(handle.rootRef)
    try { await recoverKnowledgeBaseRoot(root) } catch (error) { return baseResult(input, handle, [], 'blocked', { code: 'recovery_required', message: error instanceof Error ? error.message : String(error) }) }
    let manifest: KnowledgeBaseManifest
    try { manifest = await loadKnowledgeBaseManifest(root) } catch (error) { return baseResult(input, handle, [], 'blocked', errorValue(error)) }

    const result = baseResult(input, handle, [], 'failed')
    result.source = { schemaVersion: manifest.schemaVersion, storageFormatVersion: manifest.storageFormatVersion, revision: manifest.revision }
    result.target.revision = manifest.revision
    if (manifest.knowledgeBaseId !== handle.knowledgeBaseId) return { ...result, status: 'blocked', error: { code: 'knowledge_base_identity_mismatch', message: 'Mounted Handle does not match manifest identity' } }
    if (!sameVersion(manifest, handle) || handle.revision !== manifest.revision || handle.status !== manifest.status) return { ...result, status: 'blocked', error: { code: 'stale_handle', message: 'Mounted Handle does not match the current manifest' } }
    if (manifest.revision !== input.expectedBaseRevision) return { ...result, status: 'blocked', error: { code: 'stale_base_revision', message: `Expected ${input.expectedBaseRevision}, current ${manifest.revision}` } }

    const target = { schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion }
    if (sameVersion(manifest, target)) return { ...result, status: 'already_current', target: { ...target, revision: manifest.revision } }
    let path: KnowledgeMigrationDefinition[]
    try { path = this.migrationRegistry!.resolvePath(manifest, target) } catch (error) {
      if (error instanceof KnowledgeMigrationPathError) return { ...result, status: 'blocked', error: { code: 'migration_path_ambiguous', message: error.message } }
      return { ...result, status: 'failed', error: errorValue(error) }
    }
    result.migrationPath = path
    if (path.length === 0) return { ...result, status: 'blocked', error: { code: 'migration_path_not_found', message: `No migration path from ${manifest.schemaVersion}/${manifest.storageFormatVersion} to ${target.schemaVersion}/${target.storageFormatVersion}` } }
    result.target.revision = manifest.revision + 1
    if (input.mode === 'commit' && manifest.status !== 'active') return { ...result, status: 'blocked', error: { code: 'knowledge_base_not_writable', message: `Migration commit requires an active Knowledge Base, got ${manifest.status}` } }
    if (path.length > 1) return { ...result, status: 'blocked', error: { code: 'migration_requires_sequential_steps', message: 'Migration must be executed one version step at a time' } }
    if (path.length !== 1 || !['knowledge-schema-0.1-to-0.2', 'knowledge-schema-0.2-to-0.3'].includes(path[0]?.id ?? '')) return { ...result, status: 'blocked', error: { code: 'migration_not_implemented', message: `Migration implementation is not available: ${path[0]?.id ?? 'unknown'}` } }
    try { await validator.validateSource(handle); result.validation.source = 'passed' } catch (error) { result.validation.source = 'failed'; result.validation.errors = [error instanceof Error ? error.message : String(error)]; return { ...result, status: 'blocked', error: { code: 'source_validation_failed', message: result.validation.errors[0]! } } }

    const preflight = await this.prepareAndValidate(root, handle, manifest, input, path[0]!, validator)
    result.inventory.before = preflight.transformation.before
    result.inventory.after = preflight.transformation.after
    result.idMappings = preflight.transformation.idMappings
    result.reviewItems = preflight.transformation.reviewItems
    result.warnings = 'warnings' in preflight.transformation ? preflight.transformation.warnings : []
    result.changes = preflight.transformation.changes
    result.validation.target = preflight.targetValidation
    if (preflight.targetValidation === 'failed' && preflight.targetValidationError) result.validation.errors = [preflight.targetValidationError.message]
    if (hasReviewCondition(preflight.transformation)) return { ...result, status: 'review_required' }
    if (preflight.targetValidation === 'failed' && preflight.targetValidationError) return { ...result, status: 'blocked', error: preflight.targetValidationError }
    if (input.mode === 'dry_run') return { ...result, status: 'dry_run_passed' }

    const targetManifest = { ...manifest, schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: manifest.revision + 1, updatedAt: this.clock() }
    const logRef = `logs/migrations/${input.migrationRunId}.yaml`
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
        prepare: async (stagingPath) => {
          const commitTransformation = await transformFor(path[0]!, handle, stagingPath, input.migrationRunId)
          if (hasReviewCondition(commitTransformation)) throw new KnowledgeMigrationError('migration_transform_drift', 'Commit-time transformation produced review items or failed invariants')
          if (signature(commitTransformation) !== signature(preflight.transformation)) throw new KnowledgeMigrationError('migration_transform_drift', 'Commit-time transformation differs from the validated preflight transformation')
          await writeManifest(join(stagingPath, 'manifest.yaml'), targetManifest)
          await mkdir(dirname(join(stagingPath, logRef)), { recursive: true })
          await writeFile(join(stagingPath, logRef), `${canonicalSerialize({ migrationRunId: input.migrationRunId, migrationId: path[0]!.id, knowledgeBaseId: manifest.knowledgeBaseId, startedAt: this.clock(), completedAt: this.clock(), source: { schemaVersion: manifest.schemaVersion, storageFormatVersion: manifest.storageFormatVersion, revision: manifest.revision }, target: { schemaVersion: targetManifest.schemaVersion, storageFormatVersion: targetManifest.storageFormatVersion, revision: targetManifest.revision }, migrationPath: path, inventory: { before: commitTransformation.before, after: commitTransformation.after }, idMappings: commitTransformation.idMappings, reviewItems: commitTransformation.reviewItems, warnings: 'warnings' in commitTransformation ? commitTransformation.warnings : [], changes: commitTransformation.changes, invariants: commitTransformation.invariants, validation: { source: 'passed', target: 'passed' }, status: 'completed' })}\n`, 'utf8')
        },
        validate: async (stagingPath) => { const stagedManifest = parseKnowledgeBaseManifest(parseYaml(await readFile(join(stagingPath, 'manifest.yaml'), 'utf8'))); await validator.validateTarget(stagingPath, stagedManifest) },
        failpoint: this.failpoint,
      })
    } catch (error) {
      const mapped = errorValue(error)
      return { ...result, status: mapped.code === 'migration_transform_drift' ? 'blocked' : 'failed', error: mapped }
    }
    const committedHandle = await this.registry.refresh(root)
    result.status = 'committed'; result.target.revision = committedHandle.revision; result.migrationLogRef = logRef; result.committedHandle = committedHandle; return result
  }

  private async prepareAndValidate(root: string, handle: KnowledgeBaseHandle, manifest: KnowledgeBaseManifest, input: KnowledgeMigrationRequest, definition: KnowledgeMigrationDefinition, validator: KnowledgeMigrationStateValidator): Promise<{ transformation: Transformation; targetValidation: 'passed' | 'failed'; targetValidationError?: { code: string; message: string } }> {
    const staging = await stageCopy(root, `preflight-${input.migrationRunId}`)
    try {
      let transformation: Transformation
      try { transformation = await transformFor(definition, handle, staging, input.migrationRunId) } catch (error) {
        return { transformation: emptyTransformation(), targetValidation: 'failed', targetValidationError: { code: 'migration_transform_failed', message: error instanceof Error ? error.message : String(error) } }
      }
      const targetManifest = { ...manifest, schemaVersion: input.targetSchemaVersion, storageFormatVersion: input.targetStorageFormatVersion, revision: manifest.revision + 1, updatedAt: this.clock() }
      await writeManifest(join(staging, 'manifest.yaml'), targetManifest)
      try {
        await validator.validateTarget(staging, targetManifest)
        return { transformation, targetValidation: 'passed' }
      } catch (error) {
        return { transformation, targetValidation: 'failed', targetValidationError: { code: 'target_validation_failed', message: error instanceof Error ? error.message : String(error) } }
      }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}
