import { KnowledgeError } from './errors.ts'
import type {
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  RelationType,
} from '../../schemas/knowledge/index.ts'
import type { KnowledgeAssetCollection } from './types.ts'

const SUPPLY_CHAIN_RELATIONS = new Set(['contains', 'upstream_of', 'downstream_of', 'depends_on'])
const COMPANY_RELATIONS = new Set(['operates_in', 'supplier_of', 'customer_of', 'partner_of'])

export class KnowledgeIndex {
  readonly entities = new Map<string, KnowledgeEntity>()
  readonly relations = new Map<string, KnowledgeRelation>()
  readonly intelligence = new Map<string, KnowledgeIntelligence>()
  readonly modules = new Map<string, KnowledgeModule>()
  readonly sources = new Map<string, KnowledgeSource>()
  readonly registry = new Map<string, string>()
  readonly moduleRegistry = new Map<string, string[]>()
  private readonly relationsByEntity = new Map<string, KnowledgeRelation[]>()
  private readonly intelligenceByEntity = new Map<string, KnowledgeIntelligence[]>()

  static fromAssets(assets: KnowledgeAssetCollection): KnowledgeIndex {
    const index = new KnowledgeIndex()
    for (const item of assets.entities) index.addUnique(index.entities, item.value.id, item.value, item.filePath)
    for (const item of assets.relations) index.addUnique(index.relations, item.value.id, item.value, item.filePath)
    for (const item of assets.intelligence) index.addUnique(index.intelligence, item.value.id, item.value, item.filePath)
    for (const item of assets.modules) index.addUnique(index.modules, item.value.id, item.value, item.filePath)
    for (const item of assets.sources) index.addUnique(index.sources, item.value.id, item.value, item.filePath)
    for (const entry of assets.registry) index.registry.set(entry.id, entry.path)
    for (const binding of assets.moduleRegistry) index.moduleRegistry.set(binding.entityId, [...binding.moduleIds])

    for (const relation of index.relations.values()) {
      index.addReverse(index.relationsByEntity, relation.source, relation)
      index.addReverse(index.relationsByEntity, relation.target, relation)
    }
    for (const item of index.intelligence.values()) {
      for (const entityId of item.entityRefs) index.addReverse(index.intelligenceByEntity, entityId, item)
    }
    return index
  }

  private addUnique<T>(map: Map<string, T>, id: string, value: T, filePath: string): void {
    if (map.has(id)) throw new KnowledgeError('SchemaError', `Duplicate Knowledge ID: ${id}`, filePath)
    map.set(id, value)
  }

  private addReverse<T>(map: Map<string, T[]>, key: string, value: T): void {
    const values = map.get(key) ?? []
    values.push(value)
    map.set(key, values)
  }

  getRelationsFor(entityId: string, relationType?: RelationType | string): KnowledgeRelation[] {
    return (this.relationsByEntity.get(entityId) ?? [])
      .filter((relation) => relationType === undefined || relation.type === relationType)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  getIntelligenceFor(entityId: string, type?: string): KnowledgeIntelligence[] {
    return (this.intelligenceByEntity.get(entityId) ?? [])
      .filter((item) => type === undefined || item.type === type)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  getSupplyChain(entityId: string, depth = 1): KnowledgeEntity[] {
    const results: KnowledgeEntity[] = []
    const visited = new Set<string>([entityId])
    let frontier = [entityId]
    for (let level = 0; level < Math.max(0, depth); level += 1) {
      const next: string[] = []
      for (const current of frontier) {
        for (const relation of [...this.relations.values()].filter(
          (candidate) => candidate.source === current && SUPPLY_CHAIN_RELATIONS.has(candidate.type),
        )) {
          if (visited.has(relation.target)) continue
          visited.add(relation.target)
          next.push(relation.target)
          const entity = this.entities.get(relation.target)
          if (entity) results.push(entity)
        }
      }
      frontier = next
    }
    return results.sort((left, right) => left.id.localeCompare(right.id))
  }

  getRelatedCompanies(entityId: string, filters?: Record<string, unknown>): Array<{ company: KnowledgeEntity; relation: KnowledgeRelation }> {
    return this.getRelationsFor(entityId)
      .filter((relation) => COMPANY_RELATIONS.has(relation.type))
      .map((relation) => {
        const company = this.entities.get(relation.source)
        return company?.type === 'company' ? { company, relation } : undefined
      })
      .filter((result): result is { company: KnowledgeEntity; relation: KnowledgeRelation } => result !== undefined)
      .filter(({ company }) => Object.entries(filters ?? {}).every(([key, value]) => company[key] === value))
      .sort((left, right) => left.company.id.localeCompare(right.company.id))
  }

  getComparison(entityId: string, comparisonType?: string): KnowledgeModule[] {
    return (this.moduleRegistry.get(entityId) ?? [])
      .map((moduleId) => this.modules.get(moduleId))
      .filter((module): module is KnowledgeModule => module !== undefined && module.type === 'comparison')
      .filter((module) => comparisonType === undefined || module.schemaId === comparisonType || module.id === comparisonType)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  getSourcesFor(knowledgeItemId: string): KnowledgeSource[] {
    const item = this.entities.get(knowledgeItemId) ?? this.relations.get(knowledgeItemId) ?? this.intelligence.get(knowledgeItemId) ?? this.modules.get(knowledgeItemId)
    const sourceRefs = item && Array.isArray(item.sourceRefs) ? item.sourceRefs : []
    return sourceRefs
      .map((sourceId) => this.sources.get(String(sourceId)))
      .filter((source): source is KnowledgeSource => source !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}
