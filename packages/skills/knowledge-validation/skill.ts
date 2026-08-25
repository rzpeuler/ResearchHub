import { KnowledgeLoader } from '../knowledge-access/loader.ts'
import { ENTITY_TYPES, INTELLIGENCE_TYPES, LIFECYCLE_STATUSES, RELATION_TYPES } from '../knowledge-access/types.ts'
import type {
  KnowledgeAssetCollection,
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  LoadedAsset,
} from '../knowledge-access/types.ts'
import type { ValidationDiagnostic, ValidationReport, ValidationScope } from './types.ts'

const ID_PATTERN = /^(industry|segment|company|product|technology|relation|fact|forecast|viewpoint|trend|risk|source|module|view):[a-z0-9]+(?:-[a-z0-9]+)*$/
const RELATION_ENDPOINTS: Record<string, { source: string[]; target: string[] }> = {
  contains: { source: ['industry', 'segment'], target: ['segment', 'product', 'technology'] },
  upstream_of: { source: ['industry', 'segment', 'company', 'product'], target: ['industry', 'segment', 'company', 'product'] },
  downstream_of: { source: ['industry', 'segment', 'company', 'product'], target: ['industry', 'segment', 'company', 'product'] },
  depends_on: { source: ['segment', 'product', 'technology'], target: ['segment', 'product', 'technology'] },
  substitute_for: { source: ['product', 'technology'], target: ['product', 'technology'] },
  operates_in: { source: ['company'], target: ['industry', 'segment'] },
  supplies: { source: ['company', 'product'], target: ['company', 'product', 'segment'] },
  customer_of: { source: ['company'], target: ['company', 'product'] },
  competes_with: { source: ['company', 'product'], target: ['company', 'product'] },
  partner_of: { source: ['company'], target: ['company'] },
  owns_stake_in: { source: ['company'], target: ['company'] },
  investor_of: { source: ['company'], target: ['company'] },
  project_partner_of: { source: ['company'], target: ['company', 'segment'] },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export class KnowledgeValidationSkill {
  constructor(private readonly loader: KnowledgeLoader) {}

  async validateKnowledge(scope: ValidationScope = 'all'): Promise<ValidationReport> {
    let assets: KnowledgeAssetCollection
    try {
      assets = await this.loader.readAssets()
    } catch (error) {
      const diagnostic: ValidationDiagnostic = {
        code: 'PARSE_ERROR',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
      return this.report(scope, [diagnostic])
    }

    const diagnostics: ValidationDiagnostic[] = []
    const allIds = new Map<string, LoadedAsset>()
    const entities = new Map<string, KnowledgeEntity>()
    const sources = new Map<string, KnowledgeSource>()
    const assetGroups: Array<[ValidationScope, LoadedAsset[]]> = [
      ['entity', assets.entities],
      ['relation', assets.relations],
      ['intelligence', assets.intelligence],
      ['module', assets.modules],
      ['source', assets.sources],
    ]

    for (const [group, items] of assetGroups) {
      if (scope !== 'all' && scope !== group) continue
      for (const item of items) {
        const id = typeof item.value.id === 'string' ? item.value.id : undefined
        if (id && allIds.has(id)) this.add(diagnostics, 'DUPLICATE_ID', `Duplicate Knowledge ID: ${id}`, item, 'error')
        if (id) allIds.set(id, item)
        this.validateId(diagnostics, item)
        if (group === 'entity') {
          this.validateEntity(diagnostics, item as LoadedAsset<KnowledgeEntity>)
          if (id) entities.set(id, item.value as KnowledgeEntity)
        }
        if (group === 'relation') this.validateRelationSchema(diagnostics, item as LoadedAsset<KnowledgeRelation>)
        if (group === 'intelligence') this.validateIntelligence(diagnostics, item as LoadedAsset<KnowledgeIntelligence>)
        if (group === 'module') {
          this.validateModule(diagnostics, item as LoadedAsset<KnowledgeModule>)
        }
        if (group === 'source') {
          this.validateSource(diagnostics, item as LoadedAsset<KnowledgeSource>)
          if (id) sources.set(id, item.value as KnowledgeSource)
        }
      }
    }

    if (scope === 'all' || scope === 'relation') {
      for (const item of assets.relations) this.validateRelationReferences(diagnostics, item, entities)
    }
    if (scope === 'all' || scope === 'intelligence') {
      for (const item of assets.intelligence) this.validateReferences(diagnostics, item, entities, sources)
    }
    if (scope === 'all' || scope === 'module') {
      for (const item of assets.modules) {
        const target = item.value.targetEntity
        if (target && !entities.has(target)) this.add(diagnostics, 'UNKNOWN_MODULE_TARGET', `Module target does not exist: ${target}`, item, 'error')
      }
    }
    if (scope === 'all') this.validateRegistry(diagnostics, assets, allIds)
    return this.report(scope, diagnostics)
  }

  private validateId(diagnostics: ValidationDiagnostic[], item: LoadedAsset): void {
    const id = item.value.id
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) this.add(diagnostics, 'INVALID_ID', `Invalid Knowledge ID: ${String(id)}`, item, 'error')
  }

  private validateEntity(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeEntity>): void {
    if (typeof item.value.name !== 'string' || !item.value.name) this.add(diagnostics, 'SCHEMA_ENTITY_NAME', 'Entity name is required', item, 'error')
    if (typeof item.value.type !== 'string' || !ENTITY_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_ENTITY_TYPE', `Unsupported entity type: ${String(item.value.type)}`, item, 'error')
  }

  private validateRelationSchema(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeRelation>): void {
    if (typeof item.value.source !== 'string' || typeof item.value.target !== 'string') this.add(diagnostics, 'SCHEMA_RELATION_ENDPOINT', 'Relation source and target are required', item, 'error')
    if (typeof item.value.type !== 'string' || !RELATION_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_RELATION_TYPE', `Unsupported relation type: ${String(item.value.type)}`, item, 'error')
    this.validateLifecycle(diagnostics, item)
  }

  private validateRelationReferences(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeRelation>, entities: Map<string, KnowledgeEntity>): void {
    const source = entities.get(item.value.source)
    const target = entities.get(item.value.target)
    if (!source) this.add(diagnostics, 'MISSING_REFERENCE', `Relation source does not exist: ${item.value.source}`, item, 'error')
    if (!target) this.add(diagnostics, 'MISSING_REFERENCE', `Relation target does not exist: ${item.value.target}`, item, 'error')
    const rule = RELATION_ENDPOINTS[item.value.type]
    if (rule && source && target && (!rule.source.includes(source.type) || !rule.target.includes(target.type))) {
      this.add(diagnostics, 'INVALID_RELATION', `Relation endpoint types are invalid for ${item.value.type}`, item, 'error')
    }
  }

  private validateIntelligence(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeIntelligence>): void {
    if (typeof item.value.type !== 'string' || !INTELLIGENCE_TYPES.includes(item.value.type as never)) this.add(diagnostics, 'SCHEMA_INTELLIGENCE_TYPE', `Unsupported intelligence type: ${String(item.value.type)}`, item, 'error')
    if (!asStringArray(item.value.entityRefs) || item.value.entityRefs.length === 0) this.add(diagnostics, 'SCHEMA_ENTITY_REFS', 'Intelligence entityRefs must be a non-empty string array', item, 'error')
    if (['forecast', 'viewpoint', 'trend', 'risk'].includes(item.value.type) && !asStringArray(item.value.sourceRefs)) this.add(diagnostics, 'SOURCE_REQUIRED', 'Dynamic intelligence requires sourceRefs', item, 'error')
    this.validateLifecycle(diagnostics, item)
  }

  private validateReferences(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeIntelligence>, entities: Map<string, KnowledgeEntity>, sources: Map<string, KnowledgeSource>): void {
    for (const entityId of item.value.entityRefs ?? []) if (!entities.has(entityId)) this.add(diagnostics, 'MISSING_REFERENCE', `Intelligence entity does not exist: ${entityId}`, item, 'error')
    for (const sourceId of item.value.sourceRefs ?? []) if (!sources.has(sourceId)) this.add(diagnostics, 'MISSING_REFERENCE', `Source does not exist: ${sourceId}`, item, 'error')
  }

  private validateModule(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeModule>): void {
    if (item.value.type === 'comparison' && (!Array.isArray(item.value.columns) || !Array.isArray(item.value.rows))) this.add(diagnostics, 'MODULE_SCHEMA', 'Comparison module requires columns and rows arrays', item, 'error')
  }

  private validateSource(diagnostics: ValidationDiagnostic[], item: LoadedAsset<KnowledgeSource>): void {
    for (const field of ['title', 'publisher', 'publishedAt']) if (typeof item.value[field] !== 'string' || !item.value[field]) this.add(diagnostics, 'SOURCE_SCHEMA', `Source ${field} is required`, item, 'error')
  }

  private validateLifecycle(diagnostics: ValidationDiagnostic[], item: LoadedAsset): void {
    const lifecycle = item.value.lifecycle
    if (lifecycle === undefined) return
    if (!isRecord(lifecycle) || typeof lifecycle.status !== 'string' || !LIFECYCLE_STATUSES.includes(lifecycle.status as never)) this.add(diagnostics, 'INVALID_LIFECYCLE', 'Lifecycle status is invalid', item, 'error')
    if (isRecord(lifecycle) && lifecycle.validFrom && lifecycle.validUntil && String(lifecycle.validFrom) > String(lifecycle.validUntil)) this.add(diagnostics, 'INVALID_LIFECYCLE', 'Lifecycle validFrom must not be after validUntil', item, 'error')
  }

  private validateRegistry(diagnostics: ValidationDiagnostic[], assets: KnowledgeAssetCollection, allIds: Map<string, LoadedAsset>): void {
    for (const entry of assets.registry) {
      if (!allIds.has(entry.id)) diagnostics.push({ code: 'REGISTRY_MISSING_ASSET', severity: 'warning', message: `Registry entry is not loaded: ${entry.id}` })
    }
  }

  private add(diagnostics: ValidationDiagnostic[], code: string, message: string, item: LoadedAsset, severity: 'error' | 'warning' | 'info'): void {
    diagnostics.push({ code, severity, message, assetId: typeof item.value.id === 'string' ? item.value.id : undefined, filePath: item.filePath })
  }

  private report(scope: ValidationScope, diagnostics: ValidationDiagnostic[]): ValidationReport {
    return {
      status: diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'failed' : 'passed',
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
      info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info'),
      timestamp: new Date().toISOString(),
      scope,
    }
  }
}
