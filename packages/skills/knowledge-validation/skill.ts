import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import type { KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/handle.ts'
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
import type { ValidationDiagnostic, ValidationReport, ValidationScope } from './types.ts'

const ID_PATTERN = /^(industry|segment|company|product|technology|relation|fact|forecast|viewpoint|trend|risk|source|module|view):[a-z0-9]+(?:-[a-z0-9]+)*$/

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

export class KnowledgeValidationSkill {
  private readonly ruleLoader: KnowledgeRuleConfigLoader

  constructor(private readonly options: { loader: KnowledgeBaseLoader }) {
    this.ruleLoader = new KnowledgeRuleConfigLoader(fileURLToPath(new URL('./rules', import.meta.url)))
  }

  async validateKnowledgeBase(handle: KnowledgeBaseHandle, scope: ValidationScope = 'all'): Promise<ValidationReport> {
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
      if (typeof item.value.title !== 'string' || item.value.title.trim() === '') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source title is required', item, 'error')
      if (item.value.publisher !== null && item.value.publisher !== undefined && typeof item.value.publisher !== 'string') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source publisher must be string or null', item, 'error')
      if (item.value.institution !== null && item.value.institution !== undefined && typeof item.value.institution !== 'string') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source institution must be string or null', item, 'error')
      if (item.value.author !== null && item.value.author !== undefined && typeof item.value.author !== 'string') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source author must be string or null', item, 'error')
      if (item.value.publishedAt !== null && typeof item.value.publishedAt !== 'string') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source publishedAt must be string or null', item, 'error')
      if (item.value.url !== null && item.value.url !== undefined && typeof item.value.url !== 'string') this.add(diagnostics, 'SOURCE_SCHEMA', 'Source url must be string or null', item, 'error')
      if (item.value.sourceType !== undefined && !SOURCE_TYPES.includes(item.value.sourceType as never)) this.add(diagnostics, 'SOURCE_SCHEMA', `Unsupported sourceType: ${String(item.value.sourceType)}`, item, 'error')
      if (item.value.sourceReliability !== undefined && !SOURCE_RELIABILITIES.includes(item.value.sourceReliability as never)) this.add(diagnostics, 'SOURCE_SCHEMA', `Unsupported sourceReliability: ${String(item.value.sourceReliability)}`, item, 'error')
      if (item.value.rawRefs !== undefined && !asStringArray(item.value.rawRefs)) this.add(diagnostics, 'SOURCE_RAW_REFS_SCHEMA', 'rawRefs must be a string array', item, 'error')
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
