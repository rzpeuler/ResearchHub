import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { createKnowledgeBaseHandle, KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/handle.ts'
import type { KnowledgeBaseManifest } from '../../../packages/schemas/knowledge/index.ts'
import { readKnowledgeBaseYamlResource } from '../../../packages/shared/knowledge-base/resource-reader.ts'
import { ENTITY_TYPES, INTELLIGENCE_TYPES, LIFECYCLE_STATUSES, MODULE_TYPES, RELATION_TYPES, SOURCE_RELIABILITIES, SOURCE_TYPES } from '../../../packages/schemas/knowledge/index.ts'
import type {
  KnowledgeAssetCollection,
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  LoadedAsset,
} from '../../../packages/shared/knowledge-base/types.ts'
import { KnowledgeRuleConfigLoader } from './rules.ts'
import type { RelationRule } from './rules.ts'
import type {
  ChangeSetValidationResult,
  ChangeSetValidationOptions,
  ValidationDiagnostic,
  ValidationReport,
  ValidationScope,
} from './types.ts'
import type {
  KnowledgeChangeSet,
  KnowledgeSourceOperation,
  KnowledgeWritableObject,
  ValidatedKnowledgeChangeSet,
} from '../../../packages/schemas/knowledge/index.ts'
import { hashKnowledgeObject } from '../../../packages/shared/knowledge-base/canonical-hash.ts'
import { verifyRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { KnowledgeWriteInternalError } from '../../../packages/shared/knowledge-base/write/errors.ts'
import type { KnowledgeMigrationStateValidator } from '../../../packages/shared/knowledge-base/migration/types.ts'
import { validateKnowledgeBaseV03 } from './v03-validator.ts'

const ID_PATTERN = /^(industry|segment|company|product|technology|relation|fact|forecast|viewpoint|trend|risk|source|module|view):[a-z0-9]+(?:-[a-z0-9]+)*$/
const LOGICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export class KnowledgeValidationSkill {
  private readonly ruleLoader: KnowledgeRuleConfigLoader

  constructor(private readonly options: { loader: KnowledgeBaseLoader }) {
    this.ruleLoader = new KnowledgeRuleConfigLoader(fileURLToPath(new URL('./rules', import.meta.url)))
  }

  async validateKnowledgeBase(handle: KnowledgeBaseHandle, scope: ValidationScope = 'all'): Promise<ValidationReport> {
    if (handle.schemaVersion === '0.3' && handle.storageFormatVersion === '1') {
      try {
        return this.report(scope, await validateKnowledgeBaseV03(handle.rootRef, undefined, scope))
      } catch (error) {
        return this.report(scope, [{ code: 'PARSE_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error) }])
      }
    }
    let assets: KnowledgeAssetCollection
    let rules
    try {
      rules = await this.ruleLoader.load()
      if (scope === 'manifest') return this.report(scope, await this.validateManifest(handle))
      assets = await this.options.loader.readAssets(handle)
    } catch (error) {
      const diagnostic: ValidationDiagnostic = {
        code: 'PARSE_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error),
      }
      return this.report(scope, [diagnostic])
    }

    const diagnostics: ValidationDiagnostic[] = []
    if (scope === 'all') diagnostics.push(...await this.validateManifest(handle))
    const allIds = new Map<string, LoadedAsset>()
    const entities = new Map<string, KnowledgeEntity>()
    const sources = new Map<string, KnowledgeSource>()
    const modules = new Map<string, KnowledgeModule>()

    const allGroups: Array<[ValidationScope, LoadedAsset[]]> = [
      ['entity', assets.entities], ['relation', assets.relations], ['intelligence', assets.intelligence],
      ['module', assets.modules], ['source', assets.sources],
    ]
    for (const [group, items] of allGroups) {
      for (const item of items) {
        const id = typeof item.value.id === 'string' ? item.value.id : undefined
        if (id && allIds.has(id) && (scope === 'all' || scope === group)) this.add(diagnostics, 'DUPLICATE_ID', `Duplicate Knowledge ID: ${id}`, item, 'error')
        if (id) allIds.set(id, item)
        if (group === 'entity' && id) entities.set(id, item.value as KnowledgeEntity)
        if (group === 'source' && id) sources.set(id, item.value as KnowledgeSource)
        if (group === 'module' && id) modules.set(id, item.value as KnowledgeModule)
      }
    }

    for (const [group, items] of allGroups) {
      if (scope !== 'all' && scope !== group) continue
      for (const item of items) {
        this.validateId(diagnostics, item)
        if (group === 'entity') this.validateEntity(diagnostics, item as LoadedAsset<KnowledgeEntity>, rules.lifecycleStatuses)
        if (group === 'relation') this.validateRelationSchema(diagnostics, item as LoadedAsset<KnowledgeRelation>, rules.lifecycleStatuses)
        if (group === 'intelligence') this.validateIntelligence(diagnostics, item as LoadedAsset<KnowledgeIntelligence>, rules.intelligence, rules.lifecycleStatuses)
        if (group === 'module') this.validateModule(diagnostics, item as LoadedAsset<KnowledgeModule>, rules.lifecycleStatuses)
        if (group === 'source') this.validateSource(diagnostics, item as LoadedAsset<KnowledgeSource>, rules.lifecycleStatuses, handle.schemaVersion)
        if (group === 'entity' || group === 'relation' || group === 'module') this.validateSourceReferences(diagnostics, item, sources)
      }
    }

    if (scope === 'all' || scope === 'relation') for (const item of assets.relations) this.validateRelationReferences(diagnostics, item, entities, rules.relations)
    if (scope === 'all' || scope === 'intelligence') for (const item of assets.intelligence) this.validateReferences(diagnostics, item, entities, sources)
    if (scope === 'all' || scope === 'module') {
      for (const item of assets.modules) {
        const target = item.value.targetEntity
        if (target && !entities.has(target)) this.add(diagnostics, 'UNKNOWN_MODULE_TARGET', `Module target does not exist: ${target}`, item, 'error')
      }
      this.validateModuleRegistry(diagnostics, assets, entities, modules)
    }
    if (scope === 'all' || scope === 'registry') this.validateRegistry(diagnostics, assets, allIds)
    if (scope === 'all' || scope === 'raw') diagnostics.push(...await this.validateRaw(handle, assets.sources))
    return this.report(scope, diagnostics)
  }

  async validateChangeSet(handle: KnowledgeBaseHandle, changeSet: KnowledgeChangeSet, options: ChangeSetValidationOptions = {}): Promise<ChangeSetValidationResult> {
    const diagnostics: ValidationDiagnostic[] = []
    const mode = options.mode ?? 'commit'
    const dryRun = mode === 'dry_run'
    let assets: KnowledgeAssetCollection
    try {
      assets = await this.options.loader.readAssets(handle)
    } catch (error) {
      diagnostics.push({ code: 'CHANGESET_BASE_READ_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error) })
      return { report: this.report('all', diagnostics) }
    }

    if (handle.schemaVersion !== '0.2' || handle.storageFormatVersion !== '1' || (!dryRun && !handle.writable)) {
      diagnostics.push({ code: 'WRITE_NOT_SUPPORTED', severity: 'error', message: `Knowledge Base is not writable: ${handle.schemaVersion}/${handle.storageFormatVersion}/${handle.status}` })
    }
    if (changeSet.knowledgeBaseId !== handle.knowledgeBaseId) diagnostics.push({ code: 'CHANGESET_KB_MISMATCH', severity: 'error', message: 'ChangeSet knowledgeBaseId does not match handle' })
    if (changeSet.schemaVersion !== handle.schemaVersion) diagnostics.push({ code: 'CHANGESET_SCHEMA_MISMATCH', severity: 'error', message: 'ChangeSet schemaVersion does not match handle' })
    if (!Number.isInteger(changeSet.expectedBaseRevision) || changeSet.expectedBaseRevision < 0) diagnostics.push({ code: 'CHANGESET_REVISION', severity: 'error', message: 'expectedBaseRevision must be a non-negative integer' })
    if (changeSet.expectedBaseRevision !== handle.revision) diagnostics.push({ code: 'STALE_BASE_REVISION', severity: 'error', message: `ChangeSet expects revision ${changeSet.expectedBaseRevision}, handle is at ${handle.revision}` })
    this.validateLogicalId(diagnostics, changeSet.changeSetId, 'CHANGESET_ID')
    this.validateLogicalId(diagnostics, changeSet.workflowRunId, 'WORKFLOW_RUN_ID')
    if (typeof changeSet.requiresRawProvenance !== 'boolean') diagnostics.push({ code: 'CHANGESET_PROVENANCE_POLICY', severity: 'error', message: 'requiresRawProvenance must be boolean' })
    if (!Array.isArray(changeSet.sourceOperations) || !Array.isArray(changeSet.knowledgeOperations)) diagnostics.push({ code: 'CHANGESET_OPERATIONS', severity: 'error', message: 'ChangeSet operation lists must be arrays' })

    const existingById = new Map<string, { type: string; object: Record<string, unknown> }>()
    for (const asset of [...assets.entities, ...assets.relations, ...assets.intelligence, ...assets.modules, ...assets.sources]) existingById.set(asset.value.id, { type: asset.kind, object: asset.value as Record<string, unknown> })
    const sources = new Set(assets.sources.map((asset) => asset.value.id))
    const entities = new Set(assets.entities.map((asset) => asset.value.id))
    const sourceCreates = new Set<string>()
    const objectCreates = new Set<string>()
    const supersedeReplacements = new Set<string>()
    const mutationTargets = new Map<string, string>()
    const plannedObjects: Array<{ object: Record<string, unknown>; operationId: string }> = []
    const operationIds = new Set<string>()
    const rawRefs = await this.loadRawRefs(handle, diagnostics, options.virtualRawRefs)

    for (const operation of changeSet.sourceOperations ?? []) {
      this.validateOperationId(diagnostics, operation, operationIds)
      if (operation.type === 'source_create') {
        const source = operation.source
        this.validateSourceCreateOperation(diagnostics, source, existingById, sourceCreates, rawRefs, changeSet.requiresRawProvenance)
        if (typeof source?.id === 'string') {
          sources.add(source.id)
        }
      } else if (operation.type === 'source_merge') {
        this.validateSourceMergeOperation(diagnostics, operation, existingById, sources, rawRefs, changeSet.requiresRawProvenance, mutationTargets)
      } else {
        diagnostics.push({ code: 'UNSUPPORTED_SOURCE_OPERATION', severity: 'error', message: `Unsupported source operation: ${String((operation as { type?: unknown }).type)}` })
      }
    }

    for (const operation of changeSet.knowledgeOperations ?? []) {
      this.validateOperationId(diagnostics, operation, operationIds)
      if (operation.type === 'create') {
        this.validateKnowledgeCreateOperation(diagnostics, operation.object, existingById, objectCreates, supersedeReplacements, operation.operationId)
        if (typeof operation.object?.id === 'string') {
          if (this.assetKind(operation.object) === 'entity') entities.add(operation.object.id)
          plannedObjects.push({ object: operation.object as Record<string, unknown>, operationId: operation.operationId })
        }
      } else if (operation.type === 'update') {
        this.validateTargetOperation(diagnostics, operation.knowledgeId, operation.expectedBeforeHash, existingById, operation.object, true, mutationTargets, operation.operationId)
        plannedObjects.push({ object: operation.object as Record<string, unknown>, operationId: operation.operationId })
      } else if (operation.type === 'supersede') {
        this.validateTargetOperation(diagnostics, operation.knowledgeId, operation.expectedBeforeHash, existingById, operation.replacement, false, mutationTargets, operation.operationId)
        if (operation.replacement?.id === operation.knowledgeId) diagnostics.push({ code: 'SUPERSEDE_SAME_ID', severity: 'error', message: 'Supersede replacement must have a different ID', operationId: operation.operationId })
        if (typeof operation.replacement?.id === 'string') {
          if (existingById.has(operation.replacement.id) || sourceCreates.has(operation.replacement.id) || objectCreates.has(operation.replacement.id) || supersedeReplacements.has(operation.replacement.id)) diagnostics.push({ code: 'SUPERSEDE_COLLISION', severity: 'error', message: `Supersede replacement ID already exists: ${operation.replacement.id}`, operationId: operation.operationId })
          supersedeReplacements.add(operation.replacement.id)
          if (this.assetKind(operation.replacement) === 'entity') entities.add(operation.replacement.id)
          plannedObjects.push({ object: operation.replacement as Record<string, unknown>, operationId: operation.operationId })
        }
      } else if (operation.type === 'merge_source') {
        this.validateTargetOperation(diagnostics, operation.knowledgeId, operation.expectedBeforeHash, existingById, undefined, false, mutationTargets, operation.operationId)
        if (!Array.isArray(operation.addSourceRefs) || operation.addSourceRefs.length === 0) diagnostics.push({ code: 'SOURCE_MERGE_REFS', severity: 'error', message: 'merge_source requires a non-empty addSourceRefs array', operationId: operation.operationId })
        for (const sourceId of operation.addSourceRefs ?? []) if (!sources.has(sourceId)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Source does not exist in current or same ChangeSet: ${sourceId}`, operationId: operation.operationId })
      } else {
        diagnostics.push({ code: 'UNSUPPORTED_KNOWLEDGE_OPERATION', severity: 'error', message: `Unsupported Knowledge operation: ${String((operation as { type?: unknown }).type)}` })
      }
    }

    this.validatePlannedReferences(diagnostics, plannedObjects, entities, sources)
    const report = this.report('all', diagnostics)
    if (report.status === 'failed') return { report }
    if (dryRun) return { report }
    const changeSetHash = hashKnowledgeObject(changeSet)
    const validatedChangeSet: ValidatedKnowledgeChangeSet = deepFreeze({
      changeSet: deepFreeze(structuredClone(changeSet)),
      knowledgeBaseId: handle.knowledgeBaseId,
      schemaVersion: handle.schemaVersion,
      baseRevision: handle.revision,
      changeSetId: changeSet.changeSetId,
      changeSetHash,
      validatedAt: new Date().toISOString(),
    })
    return { report, validatedChangeSet }
  }

  private validateLogicalId(diagnostics: ValidationDiagnostic[], value: unknown, code: string): void {
    if (typeof value !== 'string' || !LOGICAL_ID_PATTERN.test(value) || value.includes('..')) diagnostics.push({ code, severity: 'error', message: 'Logical IDs must be path-safe and must not contain path separators or traversal' })
  }

  private validateOperationId(diagnostics: ValidationDiagnostic[], operation: { operationId?: unknown }, operationIds: Set<string>): void {
    this.validateLogicalId(diagnostics, operation.operationId, 'OPERATION_ID')
    if (typeof operation.operationId === 'string') {
      if (operationIds.has(operation.operationId)) diagnostics.push({ code: 'DUPLICATE_OPERATION_ID', severity: 'error', message: `Duplicate operation ID: ${operation.operationId}` })
      operationIds.add(operation.operationId)
    }
  }

  private validateSourceCreateOperation(
    diagnostics: ValidationDiagnostic[],
    source: KnowledgeSource,
    existingById: Map<string, { type: string; object: Record<string, unknown> }>,
    sourceCreates: Set<string>,
    rawRefs: Set<string>,
    requiresRawProvenance: boolean,
  ): void {
    if (!source || typeof source !== 'object') {
      diagnostics.push({ code: 'SOURCE_CREATE_SCHEMA', severity: 'error', message: 'source_create requires a Source object' })
      return
    }
    if (typeof source.id !== 'string' || !source.id.startsWith('source:') || !ID_PATTERN.test(source.id)) diagnostics.push({ code: 'SOURCE_CREATE_ID', severity: 'error', message: 'source_create requires a valid source: Knowledge ID' })
    if (typeof source.id === 'string') {
      if (existingById.has(source.id) || sourceCreates.has(source.id)) diagnostics.push({ code: 'CREATE_COLLISION', severity: 'error', message: `Source already exists: ${source.id}` })
      sourceCreates.add(source.id)
    }
    this.validateSourceObject(diagnostics, source, rawRefs, requiresRawProvenance)
  }

  private validateSourceMergeOperation(diagnostics: ValidationDiagnostic[], operation: Extract<KnowledgeSourceOperation, { type: 'source_merge' }>, existingById: Map<string, { type: string; object: Record<string, unknown> }>, sources: Set<string>, rawRefs: Set<string>, requiresRawProvenance: boolean, mutationTargets: Map<string, string>): void {
    if (!sources.has(operation.sourceId)) diagnostics.push({ code: 'MISSING_TARGET', severity: 'error', message: `Source does not exist: ${operation.sourceId}` })
    this.validateTargetHash(diagnostics, operation.sourceId, operation.expectedBeforeHash, existingById, operation.operationId)
    this.validateRawRefs(diagnostics, operation.addRawRefs, rawRefs)
    this.registerMutationTarget(diagnostics, mutationTargets, operation.sourceId, operation.operationId)
    if (operation.metadataPatch !== undefined && !isRecord(operation.metadataPatch)) diagnostics.push({ code: 'SOURCE_MERGE_SCHEMA', severity: 'error', message: 'Source merge metadataPatch must be an object' })
    const patch = isRecord(operation.metadataPatch) ? operation.metadataPatch : {}
    const allowed = new Set(['institution', 'author', 'publishedAt', 'url', 'sourceType', 'sourceReliability'])
    for (const key of Object.keys(patch)) if (!allowed.has(key)) diagnostics.push({ code: 'SOURCE_MERGE_FIELD', severity: 'error', message: `Source merge cannot patch field: ${key}` })
    const current = existingById.get(operation.sourceId)?.object
    if (current) {
      const merged = { ...current, ...patch, rawRefs: [...new Set([...(Array.isArray(current.rawRefs) ? current.rawRefs : []), ...(Array.isArray(operation.addRawRefs) ? operation.addRawRefs : [])])] }
      this.validateSourceObject(diagnostics, merged, rawRefs, requiresRawProvenance)
    }
  }

  private validateKnowledgeCreateOperation(diagnostics: ValidationDiagnostic[], object: KnowledgeWritableObject, existingById: Map<string, { type: string; object: Record<string, unknown> }>, objectCreates: Set<string>, supersedeReplacements: Set<string>, operationId: string): void {
    if (!object || typeof object !== 'object') {
      diagnostics.push({ code: 'CREATE_SCHEMA', severity: 'error', message: 'create requires a Knowledge object', operationId })
      return
    }
    if (typeof object.id !== 'string' || !ID_PATTERN.test(object.id) || object.id.startsWith('source:')) diagnostics.push({ code: 'CREATE_ID', severity: 'error', message: `Invalid create Knowledge ID: ${String(object.id)}`, operationId })
    if (typeof object.id === 'string') {
      if (existingById.has(object.id) || objectCreates.has(object.id) || supersedeReplacements.has(object.id)) diagnostics.push({ code: 'CREATE_COLLISION', severity: 'error', message: `Knowledge object already exists: ${object.id}`, operationId })
      objectCreates.add(object.id)
    }
    this.validateWritableObjectSchema(diagnostics, object, operationId)
  }

  private validateTargetOperation(diagnostics: ValidationDiagnostic[], knowledgeId: string, expectedBeforeHash: string, existingById: Map<string, { type: string; object: Record<string, unknown> }>, replacement?: KnowledgeWritableObject, requiresSameId = false, mutationTargets?: Map<string, string>, operationId = knowledgeId): void {
    const target = existingById.get(knowledgeId)
    if (!target) diagnostics.push({ code: 'MISSING_TARGET', severity: 'error', message: `Knowledge target does not exist: ${knowledgeId}`, operationId })
    this.validateTargetHash(diagnostics, knowledgeId, expectedBeforeHash, existingById, operationId)
    if (mutationTargets) this.registerMutationTarget(diagnostics, mutationTargets, knowledgeId, operationId)
    if (replacement && this.assetKind(replacement) === undefined) diagnostics.push({ code: 'UPDATE_KIND', severity: 'error', message: `Unsupported replacement Knowledge object: ${replacement.id}`, operationId })
    if (replacement) this.validateWritableObjectSchema(diagnostics, replacement, operationId)
    if (replacement && (typeof replacement.id !== 'string' || !ID_PATTERN.test(replacement.id) || replacement.id.startsWith('source:'))) diagnostics.push({ code: 'UPDATE_ID', severity: 'error', message: `Replacement object id is invalid: ${String(replacement?.id)}`, operationId })
    if (replacement && requiresSameId && replacement.id !== knowledgeId) diagnostics.push({ code: 'UPDATE_ID', severity: 'error', message: 'Update object id must match knowledgeId', operationId })
    if (replacement && target && this.assetKind(replacement) !== target.type) diagnostics.push({ code: 'UPDATE_KIND', severity: 'error', message: `Replacement kind must match target: ${knowledgeId}`, operationId })
  }

  private validateExpectedHash(diagnostics: ValidationDiagnostic[], hash: unknown, operationId?: string): void {
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) diagnostics.push({ code: 'EXPECTED_HASH', severity: 'error', message: 'expectedBeforeHash must be sha256:<64 lowercase hex>', operationId })
  }

  private validateTargetHash(diagnostics: ValidationDiagnostic[], targetId: string, expectedBeforeHash: unknown, existingById: Map<string, { type: string; object: Record<string, unknown> }>, operationId?: string): void {
    this.validateExpectedHash(diagnostics, expectedBeforeHash, operationId)
    const target = existingById.get(targetId)
    if (target && typeof expectedBeforeHash === 'string' && HASH_PATTERN.test(expectedBeforeHash) && hashKnowledgeObject(target.object) !== expectedBeforeHash) diagnostics.push({ code: 'STALE_TARGET_HASH', severity: 'error', message: `expectedBeforeHash does not match current target: ${targetId}`, operationId })
  }

  private registerMutationTarget(diagnostics: ValidationDiagnostic[], targets: Map<string, string>, targetId: string, operationId: string): void {
    const previous = targets.get(targetId)
    if (previous) diagnostics.push({ code: 'DUPLICATE_TARGET_MUTATION', severity: 'error', message: `Target receives multiple mutation operations: ${targetId} (${previous}, ${operationId})`, operationId })
    else targets.set(targetId, operationId)
  }

  private validateSourceRawRefs(diagnostics: ValidationDiagnostic[], value: unknown, rawRefs: Set<string>, required: boolean, sourceId?: string): void {
    if (required && (!Array.isArray(value) || value.length === 0)) diagnostics.push({ code: 'RAW_PROVENANCE_REQUIRED', severity: 'error', message: `Source requires at least one rawRef: ${sourceId ?? '<unknown>'}` })
    this.validateRawRefs(diagnostics, value, rawRefs)
  }

  private validateRawRefs(diagnostics: ValidationDiagnostic[], value: unknown, rawRefs: Set<string>): void {
    if (value === undefined) return
    if (!Array.isArray(value) || value.some((ref) => typeof ref !== 'string')) {
      diagnostics.push({ code: 'RAW_REFS_SCHEMA', severity: 'error', message: 'rawRefs must be a string array' })
      return
    }
    for (const ref of value) if (!rawRefs.has(ref)) diagnostics.push({ code: 'UNKNOWN_RAW_REF', severity: 'error', message: `Raw ref does not exist: ${ref}` })
  }

  private validateWritableObjectSchema(diagnostics: ValidationDiagnostic[], object: KnowledgeWritableObject, operationId?: string): void {
    const record = object as Record<string, unknown>
    if (typeof record.source === 'string' || typeof record.target === 'string') {
      if (typeof record.source !== 'string' || typeof record.target !== 'string') diagnostics.push({ code: 'RELATION_SCHEMA', severity: 'error', message: 'Relation source and target are required', operationId })
      if (typeof record.type !== 'string' || !RELATION_TYPES.includes(record.type as never)) diagnostics.push({ code: 'RELATION_SCHEMA', severity: 'error', message: `Unsupported relation type: ${String(record.type)}`, operationId })
    } else if (Array.isArray(record.entityRefs)) {
      if (typeof record.type !== 'string' || !INTELLIGENCE_TYPES.includes(record.type as never)) diagnostics.push({ code: 'INTELLIGENCE_SCHEMA', severity: 'error', message: `Unsupported intelligence type: ${String(record.type)}`, operationId })
      if (record.entityRefs.length === 0 || record.entityRefs.some((ref) => typeof ref !== 'string')) diagnostics.push({ code: 'INTELLIGENCE_SCHEMA', severity: 'error', message: 'Intelligence entityRefs must be a non-empty string array', operationId })
    } else if ('columns' in record || 'rows' in record || 'schemaId' in record) {
      if (typeof record.type !== 'string' || !MODULE_TYPES.includes(record.type as never)) diagnostics.push({ code: 'MODULE_SCHEMA', severity: 'error', message: `Unsupported module type: ${String(record.type)}`, operationId })
      if (record.type === 'comparison' && (!Array.isArray(record.columns) || !Array.isArray(record.rows))) diagnostics.push({ code: 'MODULE_SCHEMA', severity: 'error', message: 'Comparison module requires columns and rows arrays', operationId })
    } else {
      if (typeof record.type !== 'string' || !ENTITY_TYPES.includes(record.type as never)) diagnostics.push({ code: 'ENTITY_SCHEMA', severity: 'error', message: `Unsupported entity type: ${String(record.type)}`, operationId })
      if (typeof record.name !== 'string' || record.name.trim() === '') diagnostics.push({ code: 'ENTITY_SCHEMA', severity: 'error', message: 'Entity name is required', operationId })
    }
    if (record.sourceRefs !== undefined && (!Array.isArray(record.sourceRefs) || record.sourceRefs.some((ref) => typeof ref !== 'string'))) diagnostics.push({ code: 'SOURCE_REFS_SCHEMA', severity: 'error', message: 'sourceRefs must be a string array', operationId })
    if (record.lifecycle !== undefined && (!isRecord(record.lifecycle) || typeof record.lifecycle.status !== 'string' || !LIFECYCLE_STATUSES.includes(record.lifecycle.status as never))) diagnostics.push({ code: 'INVALID_LIFECYCLE', severity: 'error', message: `Lifecycle is invalid: ${String(record.id)}`, operationId })
  }

  private async loadRawRefs(handle: KnowledgeBaseHandle, diagnostics: ValidationDiagnostic[], virtualRawRefs: readonly string[] = []): Promise<Set<string>> {
    try {
      const value = await readKnowledgeBaseYamlResource(handle, 'registry/raw.yaml')
      if (!isRecord(value)) {
        diagnostics.push({ code: 'RAW_REGISTRY_SCHEMA', severity: 'error', message: 'Raw registry must be an object map' })
        return new Set()
      }
      const refs = new Set([...Object.keys(value), ...virtualRawRefs])
      for (const rawRef of refs) {
        if (virtualRawRefs.includes(rawRef) && value[rawRef] === undefined) continue
        try {
          const verified = await verifyRaw(handle, rawRef)
          const entry = value[rawRef]
          if (!isRecord(entry) || entry.contentHash !== verified.contentHash || entry.storageRef !== relative(resolve(handle.rootRef), resolve(verified.originalPath)).replaceAll('\\', '/')) diagnostics.push({ code: 'RAW_REGISTRY_INVALID', severity: 'error', message: `Raw registry entry does not match Raw bundle: ${rawRef}` })
        } catch (error) {
          diagnostics.push({ code: 'RAW_BUNDLE_INVALID', severity: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
      return refs
    } catch (error) {
      if (virtualRawRefs.length > 0 && (error as { code?: string }).code === 'StorageError') return new Set(virtualRawRefs)
      diagnostics.push({ code: 'RAW_REGISTRY_READ_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error) })
      return new Set()
    }
  }

  private validatePlannedReferences(diagnostics: ValidationDiagnostic[], plannedObjects: Array<{ object: Record<string, unknown>; operationId: string }>, entities: Set<string>, sources: Set<string>): void {
    for (const planned of plannedObjects) {
      const object = planned.object
      const operationId = planned.operationId
      const record = object as Record<string, unknown>
      if (typeof record.source === 'string' && typeof record.target === 'string') {
        if (!entities.has(record.source)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Relation source does not exist: ${record.source}`, operationId })
        if (!entities.has(record.target)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Relation target does not exist: ${record.target}`, operationId })
      }
      if (Array.isArray(record.entityRefs)) for (const ref of record.entityRefs) if (typeof ref === 'string' && !entities.has(ref)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Intelligence entity does not exist: ${ref}`, operationId })
      if (Array.isArray(record.sourceRefs)) for (const ref of record.sourceRefs) if (typeof ref === 'string' && !sources.has(ref)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Source does not exist: ${ref}`, operationId })
      if (typeof record.targetEntity === 'string' && !entities.has(record.targetEntity)) diagnostics.push({ code: 'MISSING_REFERENCE', severity: 'error', message: `Module target does not exist: ${record.targetEntity}`, operationId })
    }
  }

  private validateSourceObject(diagnostics: ValidationDiagnostic[], source: unknown, rawRefs: Set<string> | undefined, requiresRawProvenance: boolean): void {
    if (!isRecord(source)) {
      diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: 'Source must be an object' })
      return
    }
    if (typeof source.type !== 'string' || source.type.trim() === '') diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: 'Source type is required' })
    if (typeof source.title !== 'string' || source.title.trim() === '') diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: `Source title is required: ${String(source.id)}` })
    for (const field of ['publisher', 'institution', 'author', 'publishedAt', 'url'] as const) if (source[field] !== undefined && source[field] !== null && typeof source[field] !== 'string') diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: `Source ${field} must be string or null: ${String(source.id)}` })
    if (source.sourceType !== undefined && !SOURCE_TYPES.includes(source.sourceType as never)) diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: `Unsupported sourceType: ${String(source.sourceType)}` })
    if (source.sourceReliability !== undefined && !SOURCE_RELIABILITIES.includes(source.sourceReliability as never)) diagnostics.push({ code: 'SOURCE_SCHEMA', severity: 'error', message: `Unsupported sourceReliability: ${String(source.sourceReliability)}` })
    if (source.lifecycle !== undefined && (!isRecord(source.lifecycle) || typeof source.lifecycle.status !== 'string' || !LIFECYCLE_STATUSES.includes(source.lifecycle.status as never))) diagnostics.push({ code: 'INVALID_LIFECYCLE', severity: 'error', message: `Source lifecycle is invalid: ${String(source.id)}` })
    if (rawRefs) this.validateSourceRawRefs(diagnostics, source.rawRefs, rawRefs, requiresRawProvenance, typeof source.id === 'string' ? source.id : undefined)
    else if (source.rawRefs !== undefined && !asStringArray(source.rawRefs)) diagnostics.push({ code: 'SOURCE_RAW_REFS_SCHEMA', severity: 'error', message: `Source rawRefs must be a string array: ${String(source.id)}` })
  }

  private assetKind(object: KnowledgeWritableObject): 'entity' | 'relation' | 'intelligence' | 'module' | undefined {
    const record = object as Record<string, unknown>
    if (typeof record.source === 'string' && typeof record.target === 'string') return 'relation'
    if (Array.isArray(record.entityRefs)) return 'intelligence'
    if ('columns' in record || 'rows' in record || 'schemaId' in record) return 'module'
    if (typeof record.name === 'string') return 'entity'
    return undefined
  }

  private validateId(diagnostics: ValidationDiagnostic[], item: LoadedAsset): void {
    const id = item.value.id
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) this.add(diagnostics, 'INVALID_ID', `Invalid Knowledge ID: ${String(id)}`, item, 'error')
  }

  private validateEntity(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeEntity>, lifecycleStatuses: string[]): void {
    if (typeof item.value.name !== 'string' || !item.value.name) this.add(diagnostics, 'SCHEMA_ENTITY_NAME', 'Entity name is required', item, 'error')
    if (typeof item.value.type !== 'string' || !ENTITY_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_ENTITY_TYPE', `Unsupported entity type: ${String(item.value.type)}`, item, 'error')
    this.validateLifecycle(diagnostics, item, lifecycleStatuses)
  }

  private validateRelationSchema(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeRelation>, lifecycleStatuses: string[]): void {
    if (typeof item.value.source !== 'string' || typeof item.value.target !== 'string') this.add(diagnostics, 'SCHEMA_RELATION_ENDPOINT', 'Relation source and target are required', item, 'error')
    if (typeof item.value.type !== 'string' || !RELATION_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_RELATION_TYPE', `Unsupported relation type: ${String(item.value.type)}`, item, 'error')
    this.validateLifecycle(diagnostics, item, lifecycleStatuses)
  }

  private validateRelationReferences(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeRelation>, entities: Map<string, KnowledgeEntity>, relationRules: RelationRule[]): void {
    const source = entities.get(item.value.source)
    const target = entities.get(item.value.target)
    if (!source) this.add(diagnostics, 'MISSING_REFERENCE', `Relation source does not exist: ${item.value.source}`, item, 'error')
    if (!target) this.add(diagnostics, 'MISSING_REFERENCE', `Relation target does not exist: ${item.value.target}`, item, 'error')
    const rule = relationRules.find((candidate) => candidate.type === item.value.type)
    if (rule && source && target && (!rule.sourceTypes.includes(source.type) || !rule.targetTypes.includes(target.type))) {
      this.add(diagnostics, 'INVALID_RELATION', `Relation endpoint types are invalid for ${item.value.type}`, item, 'error')
    }
  }

  private validateIntelligence(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeIntelligence>, rules: Array<{ type: string; required: string[] }>, lifecycleStatuses: string[]): void {
    if (typeof item.value.type !== 'string' || !INTELLIGENCE_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_INTELLIGENCE_TYPE', `Unsupported intelligence type: ${String(item.value.type)}`, item, 'error')
    if (!asStringArray(item.value.entityRefs) || item.value.entityRefs.length === 0) this.add(diagnostics, 'SCHEMA_ENTITY_REFS', 'Intelligence entityRefs must be a non-empty string array', item, 'error')
    const rule = rules.find((candidate) => candidate.type === item.value.type)
    for (const field of rule?.required ?? []) if (!present(item.value[field])) this.add(diagnostics, 'INTELLIGENCE_REQUIRED_FIELD', `${item.value.type} requires ${field}`, item, 'error')
    this.validateLifecycle(diagnostics, item, lifecycleStatuses)
  }

  private validateReferences(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeIntelligence>, entities: Map<string, KnowledgeEntity>, sources: Map<string, KnowledgeSource>): void {
    for (const entityId of item.value.entityRefs ?? []) if (!entities.has(entityId)) this.add(diagnostics, 'MISSING_REFERENCE', `Intelligence entity does not exist: ${entityId}`, item, 'error')
    for (const sourceId of item.value.sourceRefs ?? []) if (!sources.has(sourceId)) this.add(diagnostics, 'MISSING_REFERENCE', `Source does not exist: ${sourceId}`, item, 'error')
  }

  private validateSourceReferences(diagnostics: ValidationDiagnostic[], item: LoadedAsset, sources: Map<string, KnowledgeSource>): void {
    const sourceRefs = item.value.sourceRefs
    if (sourceRefs === undefined) return
    if (!asStringArray(sourceRefs)) {
      this.add(diagnostics, 'SOURCE_REFS_SCHEMA', 'sourceRefs must be a string array', item, 'error')
      return
    }
    for (const sourceId of sourceRefs) if (!sources.has(sourceId)) this.add(diagnostics, 'MISSING_REFERENCE', `Source does not exist: ${sourceId}`, item, 'error')
  }

  private validateModule(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeModule>, lifecycleStatuses: string[]): void {
    if (!MODULE_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'MODULE_TYPE', `Unsupported module type: ${String(item.value.type)}`, item, 'error')
    if (item.value.type === 'comparison' && (!Array.isArray(item.value.columns) || !Array.isArray(item.value.rows))) this.add(diagnostics, 'MODULE_SCHEMA', 'Comparison module requires columns and rows arrays', item, 'error')
    this.validateLifecycle(diagnostics, item, lifecycleStatuses)
  }

  private validateModuleRegistry(diagnostics: ValidationDiagnostic[], assets: KnowledgeAssetCollection, entities: Map<string, KnowledgeEntity>, modules: Map<string, KnowledgeModule>): void {
    const boundModules = new Set<string>()
    const boundEntities = new Set<string>()
    for (const binding of assets.moduleRegistry) {
      if (!entities.has(binding.entityId)) diagnostics.push({ code: 'MODULE_REGISTRY_UNKNOWN_ENTITY', severity: 'error', message: `Module Registry entity does not exist: ${binding.entityId}` })
      if (boundEntities.has(binding.entityId)) diagnostics.push({ code: 'MODULE_REGISTRY_DUPLICATE_BINDING', severity: 'error', message: `Duplicate Module Registry binding: ${binding.entityId}` })
      boundEntities.add(binding.entityId)
      for (const moduleId of binding.moduleIds) {
        if (boundModules.has(`${binding.entityId}:${moduleId}`)) diagnostics.push({ code: 'MODULE_REGISTRY_DUPLICATE_BINDING', severity: 'error', message: `Duplicate Module Registry module binding: ${binding.entityId} -> ${moduleId}` })
        boundModules.add(`${binding.entityId}:${moduleId}`)
        const module = modules.get(moduleId)
        if (!module) {
          diagnostics.push({ code: 'MODULE_REGISTRY_UNKNOWN_MODULE', severity: 'error', message: `Module Registry module does not exist: ${moduleId}` })
        } else if (module.targetEntity !== undefined && module.targetEntity !== binding.entityId) {
          diagnostics.push({ code: 'MODULE_REGISTRY_TARGET_CONFLICT', severity: 'error', message: `Module target conflicts with Registry binding: ${moduleId}` })
        }
      }
    }
  }

  private validateSource(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeSource>, lifecycleStatuses: string[], schemaVersion: string): void {
    if (schemaVersion === '0.2') {
      const start = diagnostics.length
      this.validateSourceObject(diagnostics, item.value, undefined, false)
      for (const diagnostic of diagnostics.slice(start)) {
        diagnostic.assetId = item.value.id
        diagnostic.filePath = item.filePath
      }
    } else {
      for (const field of ['title', 'publisher', 'publishedAt']) if (typeof item.value[field] !== 'string' || !item.value[field]) this.add(diagnostics, 'SOURCE_SCHEMA', `Source ${field} is required`, item, 'error')
    }
    this.validateLifecycle(diagnostics, item, lifecycleStatuses)
  }

  private validateLifecycle(diagnostics: ValidationDiagnostic[], item: LoadedAsset, statuses: readonly string[] = LIFECYCLE_STATUSES): void {
    const lifecycle = item.value.lifecycle
    if (lifecycle === undefined) return
    if (!isRecord(lifecycle) || typeof lifecycle.status !== 'string' || !statuses.includes(lifecycle.status as never)) this.add(diagnostics, 'INVALID_LIFECYCLE', 'Lifecycle status is invalid', item, 'error')
    if (isRecord(lifecycle) && lifecycle.validFrom && lifecycle.validUntil && String(lifecycle.validFrom) > String(lifecycle.validUntil)) this.add(diagnostics, 'INVALID_LIFECYCLE', 'Lifecycle validFrom must not be after validUntil', item, 'error')
  }

  private validateRegistry(diagnostics: ValidationDiagnostic[], assets: KnowledgeAssetCollection, allIds: Map<string, LoadedAsset>): void {
    const ids = new Set<string>()
    const paths = new Map<string, string>()
    const loadedByPath = new Map<string, LoadedAsset>()
    for (const items of [assets.entities, assets.relations, assets.intelligence, assets.modules, assets.sources]) {
      for (const item of items) loadedByPath.set(relative(resolve(assets.rootDir), resolve(item.filePath)).replaceAll('\\', '/'), item)
    }
    for (const entry of assets.registry) {
      if (ids.has(entry.id)) diagnostics.push({ code: 'REGISTRY_DUPLICATE_ID', severity: 'error', message: `Duplicate Registry ID: ${entry.id}` })
      ids.add(entry.id)
      const storageRef = entry.storageRef ?? entry.path
      const previousId = paths.get(storageRef)
      if (previousId && previousId !== entry.id) diagnostics.push({ code: 'REGISTRY_CONFLICTING_PATH', severity: 'error', message: `Registry path is assigned to multiple IDs: ${storageRef}` })
      paths.set(storageRef, entry.id)
      const normalized = storageRef.replaceAll('\\', '/')
      const resolvedPath = resolve(assets.rootDir, storageRef)
      const relativePath = relative(resolve(assets.rootDir), resolvedPath)
      if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || normalized.startsWith('../') || normalized.includes('/../') || /^[A-Za-z]:[\\/]/.test(storageRef)) {
        diagnostics.push({ code: 'REGISTRY_UNSAFE_PATH', severity: 'error', message: `Registry path escapes Knowledge root: ${storageRef}` })
        continue
      }
      const loaded = loadedByPath.get(normalized)
      if (!loaded) {
        diagnostics.push({ code: 'REGISTRY_MISSING_ASSET', severity: 'error', message: `Registry asset is not loaded: ${entry.id}` })
        continue
      }
      if (loaded.value.id !== entry.id) diagnostics.push({ code: 'REGISTRY_ID_MISMATCH', severity: 'error', message: `Registry ID does not match loaded asset: ${entry.id}` })
      if (loaded.kind !== entry.type) diagnostics.push({ code: 'REGISTRY_TYPE_MISMATCH', severity: 'error', message: `Registry type does not match loaded asset: ${entry.id}` })
    }
    void allIds
  }

  private async validateManifest(handle: KnowledgeBaseHandle): Promise<ValidationDiagnostic[]> {
    const manifestPath = resolve(handle.rootRef, 'manifest.yaml')
    let value: unknown
    try {
      value = await readKnowledgeBaseYamlResource(handle, 'manifest.yaml')
    } catch (error) {
      if ((error as { code?: string }).code === 'StorageError' && handle.schemaVersion === '0.1') return []
      return [{ code: 'MANIFEST_PARSE_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error), filePath: manifestPath }]
    }
    if (!isRecord(value)) return [{ code: 'MANIFEST_SCHEMA', severity: 'error', message: 'Manifest must be an object', filePath: manifestPath }]
    const diagnostics: ValidationDiagnostic[] = []
    if (value.knowledgeBaseId !== handle.knowledgeBaseId) diagnostics.push({ code: 'MANIFEST_ID_MISMATCH', severity: 'error', message: 'Manifest knowledgeBaseId does not match mounted handle', filePath: manifestPath })
    if (value.schemaVersion !== handle.schemaVersion) diagnostics.push({ code: 'MANIFEST_SCHEMA_VERSION_MISMATCH', severity: 'error', message: 'Manifest schemaVersion does not match mounted handle', filePath: manifestPath })
    if (value.storageFormatVersion !== handle.storageFormatVersion) diagnostics.push({ code: 'MANIFEST_STORAGE_VERSION_MISMATCH', severity: 'error', message: 'Manifest storageFormatVersion does not match mounted handle', filePath: manifestPath })
    if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0) diagnostics.push({ code: 'MANIFEST_REVISION', severity: 'error', message: 'Manifest revision must be a non-negative integer', filePath: manifestPath })
    if (!['active', 'archived'].includes(String(value.status))) diagnostics.push({ code: 'MANIFEST_STATUS', severity: 'error', message: 'Manifest status is invalid', filePath: manifestPath })
    for (const field of ['createdAt', 'updatedAt']) if (typeof value[field] !== 'string' || Number.isNaN(Date.parse(value[field]))) diagnostics.push({ code: 'MANIFEST_TIMESTAMP', severity: 'error', message: `Manifest ${field} must be a valid ISO datetime`, filePath: manifestPath })
    return diagnostics
  }

  private async validateRaw(handle: KnowledgeBaseHandle, sources: LoadedAsset<KnowledgeSource>[]): Promise<ValidationDiagnostic[]> {
    if (handle.schemaVersion !== '0.2') return []
    const rawPath = resolve(handle.rootRef, 'registry/raw.yaml')
    let value: unknown
    try {
      value = await readKnowledgeBaseYamlResource(handle, 'registry/raw.yaml')
    } catch (error) {
      return [{ code: 'RAW_REGISTRY_PARSE_ERROR', severity: 'error', message: error instanceof Error ? error.message : String(error), filePath: rawPath }]
    }
    if (!isRecord(value)) return [{ code: 'RAW_REGISTRY_SCHEMA', severity: 'error', message: 'Raw registry must be an object map', filePath: rawPath }]
    const diagnostics: ValidationDiagnostic[] = []
    for (const [rawId, entry] of Object.entries(value)) {
      if (!isRecord(entry) || typeof entry.storageRef !== 'string' || entry.storageRef.trim() === '') {
        diagnostics.push({ code: 'RAW_REGISTRY_SCHEMA', severity: 'error', message: `Raw registry entry must contain storageRef: ${rawId}`, filePath: rawPath })
        continue
      }
      const storageRef = entry.storageRef
      const resolvedPath = resolve(handle.rootRef, storageRef)
      const relativePath = relative(resolve(handle.rootRef), resolvedPath).replaceAll('\\', '/')
      if (relativePath === '..' || relativePath.startsWith('../') || /^[A-Za-z]:[\\/]/.test(storageRef)) diagnostics.push({ code: 'RAW_REGISTRY_UNSAFE_PATH', severity: 'error', message: `Raw registry path escapes Knowledge root: ${storageRef}`, filePath: rawPath })
      if (typeof entry.contentHash !== 'string' || !HASH_PATTERN.test(entry.contentHash)) diagnostics.push({ code: 'RAW_REGISTRY_HASH', severity: 'error', message: `Raw registry contentHash is invalid: ${rawId}`, filePath: rawPath })
      try {
        const verified = await verifyRaw(handle, rawId)
        if (verified.manifest.contentHash !== entry.contentHash) diagnostics.push({ code: 'RAW_REGISTRY_HASH_MISMATCH', severity: 'error', message: `Raw registry hash does not match manifest: ${rawId}`, filePath: rawPath })
        if (relative(resolve(handle.rootRef), resolve(verified.originalPath)).replaceAll('\\', '/') !== storageRef) diagnostics.push({ code: 'RAW_REGISTRY_STORAGE_MISMATCH', severity: 'error', message: `Raw registry storageRef does not match bundle: ${rawId}`, filePath: rawPath })
      } catch (error) {
        diagnostics.push({ code: 'RAW_BUNDLE_INVALID', severity: 'error', message: error instanceof Error ? error.message : String(error), filePath: rawPath })
      }
    }
    const rawIds = new Set(Object.keys(value))
    for (const source of sources) {
      if (!source.value.rawRefs) continue
      if (!asStringArray(source.value.rawRefs)) {
        diagnostics.push({ code: 'SOURCE_RAW_REFS_SCHEMA', severity: 'error', message: 'rawRefs must be a string array', assetId: source.value.id, filePath: source.filePath })
        continue
      }
      for (const rawRef of source.value.rawRefs) if (!rawIds.has(rawRef)) diagnostics.push({ code: 'RAW_REF_MISSING', severity: 'error', message: `Source rawRef does not exist: ${rawRef}`, assetId: source.value.id, filePath: source.filePath })
    }
    return diagnostics
  }

  private add(diagnostics: ValidationDiagnostic[], code: string, message: string, item: LoadedAsset, severity: 'error' | 'warning' | 'info'): void {
    diagnostics.push({ code, severity, message, assetId: typeof item.value.id === 'string' ? item.value.id : undefined, filePath: item.filePath })
  }

  private report(scope: ValidationScope, diagnostics: ValidationDiagnostic[]): ValidationReport {
    return { status: diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'failed' : 'passed', errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'), info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info'), timestamp: new Date().toISOString(), scope }
  }
}

export function createKnowledgeStagedStateValidator(skill: KnowledgeValidationSkill): (rootRef: string, manifest: KnowledgeBaseManifest) => Promise<void> {
  return async (rootRef, manifest) => {
    const handle = createKnowledgeBaseHandle(manifest, rootRef, 'compatible')
    const report = await skill.validateKnowledgeBase(handle, 'all')
    if (report.status === 'failed') throw new KnowledgeWriteInternalError('reference_integrity_error', `Staged Knowledge validation failed: ${report.errors.map((error) => error.code).join(',')}`)
  }
}

export function createKnowledgeMigrationStateValidator(skill: KnowledgeValidationSkill): KnowledgeMigrationStateValidator {
  const migrationErrors = (handle: KnowledgeBaseHandle, report: ValidationReport): ValidationDiagnostic[] => {
    const errors = handle.status === 'readonly' ? report.errors.filter((error) => error.code !== 'MANIFEST_STATUS') : report.errors
    // A legacy v0.1 module may carry a targetEntity-like extension while the
    // legacy Module Registry carries the authoritative binding. The migration
    // transform must classify that conflict as review-required instead of
    // letting the source adapter discard the finding before transformation.
    return handle.schemaVersion === '0.1' ? errors.filter((error) => error.code !== 'MODULE_REGISTRY_TARGET_CONFLICT') : errors
  }
  return {
    async validateSource(handle) {
      const report = await skill.validateKnowledgeBase(handle, 'all')
      const errors = migrationErrors(handle, report)
      if (errors.length > 0) throw new Error(`Source Knowledge validation failed: ${errors.map((error) => error.code).join(',')}`)
    },
    async validateTarget(rootRef, manifest) {
      const handle = createKnowledgeBaseHandle(manifest, rootRef, manifest.schemaVersion === '0.3' ? 'read_only_compatible' : 'compatible')
      const report = await skill.validateKnowledgeBase(handle, 'all')
      const errors = migrationErrors(handle, report)
      if (errors.length > 0) throw new Error(`Target Knowledge validation failed: ${errors.map((error) => error.code).join(',')}`)
    },
  }
}
