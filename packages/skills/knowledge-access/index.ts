import { KnowledgeError } from './errors.ts'
import { KnowledgeIndex } from '../../../packages/shared/knowledge-base/knowledge-index.ts'
import type {
  EntitySearchResult,
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  RelatedCompanyResult,
  RelationType,
} from './types.ts'

export { KnowledgeIndex } from '../../../packages/shared/knowledge-base/knowledge-index.ts'

export interface KnowledgeAccessSkillOptions {
  index: KnowledgeIndex
}

export class KnowledgeAccessSkill {
  constructor(private readonly options: KnowledgeAccessSkillOptions) {}

  getEntity(entityId: string): KnowledgeEntity {
    const entity = this.options.index.entities.get(entityId)
    if (!entity) throw new KnowledgeError('NotFound', `Entity not found: ${entityId}`)
    return entity
  }

  searchEntities(query: string, type?: string): EntitySearchResult[] {
    const normalized = query.trim().toLocaleLowerCase()
    return [...this.options.index.entities.values()]
      .filter((entity) => type === undefined || entity.type === type)
      .map((entity) => {
        const haystack = [entity.id, entity.name, ...(entity.tags ?? [])].join(' ').toLocaleLowerCase()
        const relevance = normalized === '' ? 0 : haystack.includes(normalized) ? (entity.name.toLocaleLowerCase().includes(normalized) ? 2 : 1) : -1
        return { ...entity, relevance }
      })
      .filter((entity) => normalized === '' || entity.relevance >= 0)
      .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id))
  }

  getRelations(entityId: string, relationType?: RelationType | string): KnowledgeRelation[] {
    this.getEntity(entityId)
    return this.options.index.getRelationsFor(entityId, relationType)
  }

  getSupplyChain(entityId: string, depth = 1): KnowledgeEntity[] {
    this.getEntity(entityId)
    return this.options.index.getSupplyChain(entityId, depth)
  }

  getRelatedCompanies(entityId: string, filters?: Record<string, unknown>): RelatedCompanyResult[] {
    this.getEntity(entityId)
    return this.options.index.getRelatedCompanies(entityId, filters)
  }

  getIntelligence(entityId: string, type?: string): KnowledgeIntelligence[] {
    this.getEntity(entityId)
    return this.options.index.getIntelligenceFor(entityId, type)
  }

  getModules(entityId: string): KnowledgeModule[] {
    this.getEntity(entityId)
    return (this.options.index.moduleRegistry.get(entityId) ?? [])
      .map((moduleId) => this.options.index.modules.get(moduleId))
      .filter((module): module is KnowledgeModule => module !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  getComparison(entityId: string, comparisonType?: string): KnowledgeModule[] {
    this.getEntity(entityId)
    return this.options.index.getComparison(entityId, comparisonType)
  }

  getSources(knowledgeItemId: string): KnowledgeSource[] {
    if (!this.options.index.entities.has(knowledgeItemId) && !this.options.index.relations.has(knowledgeItemId) && !this.options.index.intelligence.has(knowledgeItemId) && !this.options.index.modules.has(knowledgeItemId)) {
      throw new KnowledgeError('NotFound', `Knowledge item not found: ${knowledgeItemId}`)
    }
    return this.options.index.getSourcesFor(knowledgeItemId)
  }
}
