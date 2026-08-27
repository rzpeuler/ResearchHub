import { KnowledgeError } from './errors.ts'
import { KnowledgeIndex } from '../../../packages/shared/knowledge-base/knowledge-index.ts'
import { KnowledgeIndexV03 } from '../../../packages/shared/knowledge-base/knowledge-index-v03.ts'
import type { KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/handle.ts'
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
import type { EntityTypeV03, ClaimTypeV03, KnowledgeClaimV03, KnowledgeEntityV03, KnowledgeModuleV03, KnowledgeRelationV03, KnowledgeSourceV03, RelationTypeV03 } from '../../../packages/schemas/knowledge/v03/domain.ts'

export { KnowledgeIndex } from '../../../packages/shared/knowledge-base/knowledge-index.ts'
export { KnowledgeIndexV03 } from '../../../packages/shared/knowledge-base/knowledge-index-v03.ts'

export type KnowledgeRuntimeIndex = KnowledgeIndex | KnowledgeIndexV03

export interface KnowledgeAccessSkillOptions<TIndex extends KnowledgeRuntimeIndex = KnowledgeIndex> {
  handle: KnowledgeBaseHandle
  index: TIndex
}

type EntityFor<TIndex> = TIndex extends KnowledgeIndexV03 ? KnowledgeEntityV03 : KnowledgeEntity
type RelationFor<TIndex> = TIndex extends KnowledgeIndexV03 ? KnowledgeRelationV03 : KnowledgeRelation
type SourceFor<TIndex> = TIndex extends KnowledgeIndexV03 ? KnowledgeSourceV03 : KnowledgeSource
type ModuleFor<TIndex> = TIndex extends KnowledgeIndexV03 ? KnowledgeModuleV03 : KnowledgeModule

export class KnowledgeAccessSkill<TIndex extends KnowledgeRuntimeIndex = KnowledgeIndex> {
  constructor(private readonly options: KnowledgeAccessSkillOptions<TIndex>) {}

  get handle(): KnowledgeBaseHandle {
    return this.options.handle
  }

  get knowledgeBaseId(): string {
    return this.options.handle.knowledgeBaseId
  }

  getEntity(entityId: string): EntityFor<TIndex> {
    if (this.options.index instanceof KnowledgeIndexV03) return this.options.index.getEntity(entityId) as EntityFor<TIndex>
    const entity = this.options.index.entities.get(entityId)
    if (!entity) throw new KnowledgeError('NotFound', `Entity not found: ${entityId}`)
    return entity as EntityFor<TIndex>
  }

  searchEntities(query: string, type?: string): TIndex extends KnowledgeIndexV03 ? KnowledgeEntityV03[] : EntitySearchResult[] {
    if (this.options.index instanceof KnowledgeIndexV03) return this.options.index.searchEntities(query, type as EntityTypeV03 | undefined) as TIndex extends KnowledgeIndexV03 ? KnowledgeEntityV03[] : EntitySearchResult[]
    const normalized = query.trim().toLocaleLowerCase()
    return [...this.options.index.entities.values()]
      .filter((entity) => type === undefined || entity.type === type)
      .map((entity) => {
        const haystack = [entity.id, entity.name, ...(entity.tags ?? [])].join(' ').toLocaleLowerCase()
        const relevance = normalized === '' ? 0 : haystack.includes(normalized) ? (entity.name.toLocaleLowerCase().includes(normalized) ? 2 : 1) : -1
        return { ...entity, relevance }
      })
      .filter((entity) => normalized === '' || entity.relevance >= 0)
      .sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id)) as TIndex extends KnowledgeIndexV03 ? KnowledgeEntityV03[] : EntitySearchResult[]
  }

  getRelations(entityId: string, relationType?: RelationType | RelationTypeV03 | string): Array<RelationFor<TIndex>> {
    if (this.options.index instanceof KnowledgeIndexV03) return this.options.index.getRelations(entityId, relationType as RelationTypeV03 | undefined) as Array<RelationFor<TIndex>>
    this.getEntity(entityId)
    return this.options.index.getRelationsFor(entityId, relationType) as Array<RelationFor<TIndex>>
  }

  getClaims(subjectRef: string, claimType?: ClaimTypeV03): KnowledgeClaimV03[] {
    if (!(this.options.index instanceof KnowledgeIndexV03)) throw new KnowledgeError('UnsupportedSchema', 'Claims are only available on Schema 0.3 runtime state')
    return this.options.index.getClaims(subjectRef, claimType)
  }

  getThemeGroup(themeGroupRef: string) {
    if (!(this.options.index instanceof KnowledgeIndexV03)) throw new KnowledgeError('UnsupportedSchema', 'ThemeGroups are only available on Schema 0.3 runtime state')
    return this.options.index.getThemeGroup(themeGroupRef)
  }

  getSupplyChain(entityId: string, depth = 1): KnowledgeEntity[] {
    if (!(this.options.index instanceof KnowledgeIndex)) throw new KnowledgeError('UnsupportedSchema', 'Supply-chain traversal is only available on the Schema 0.2 runtime index')
    this.getEntity(entityId)
    return this.options.index.getSupplyChain(entityId, depth)
  }

  getRelatedCompanies(entityId: string, filters?: Record<string, unknown>): RelatedCompanyResult[] {
    if (!(this.options.index instanceof KnowledgeIndex)) throw new KnowledgeError('UnsupportedSchema', 'Related-company traversal is only available on the Schema 0.2 runtime index')
    this.getEntity(entityId)
    return this.options.index.getRelatedCompanies(entityId, filters)
  }

  getIntelligence(entityId: string, type?: string): KnowledgeIntelligence[] {
    if (!(this.options.index instanceof KnowledgeIndex)) throw new KnowledgeError('UnsupportedSchema', 'Intelligence is not a Schema 0.3 runtime concept')
    this.getEntity(entityId)
    return this.options.index.getIntelligenceFor(entityId, type)
  }

  getModules(entityId: string): Array<ModuleFor<TIndex>> {
    if (this.options.index instanceof KnowledgeIndexV03) {
      return [...this.options.index.modules.values()].filter((module) => module.targetEntity === entityId).sort((left, right) => left.id.localeCompare(right.id)) as Array<ModuleFor<TIndex>>
    }
    this.getEntity(entityId)
    return (this.options.index.moduleRegistry.get(entityId) ?? [])
      .map((moduleId) => this.options.index.modules.get(moduleId))
      .filter((module): module is KnowledgeModule => module !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id)) as Array<ModuleFor<TIndex>>
  }

  getComparison(entityId: string, comparisonType?: string): KnowledgeModule[] {
    if (!(this.options.index instanceof KnowledgeIndex)) throw new KnowledgeError('UnsupportedSchema', 'Comparison modules use the Schema 0.2 runtime index')
    this.getEntity(entityId)
    return this.options.index.getComparison(entityId, comparisonType)
  }

  getSources(knowledgeItemId: string): Array<SourceFor<TIndex>> {
    if (this.options.index instanceof KnowledgeIndexV03) return this.options.index.getSourcesFor(knowledgeItemId) as Array<SourceFor<TIndex>>
    if (!this.options.index.entities.has(knowledgeItemId) && !this.options.index.relations.has(knowledgeItemId) && !this.options.index.intelligence.has(knowledgeItemId) && !this.options.index.modules.has(knowledgeItemId)) {
      throw new KnowledgeError('NotFound', `Knowledge item not found: ${knowledgeItemId}`)
    }
    return this.options.index.getSourcesFor(knowledgeItemId) as Array<SourceFor<TIndex>>
  }
}

export function createKnowledgeAccessSession<TIndex extends KnowledgeRuntimeIndex>(handle: KnowledgeBaseHandle, index: TIndex): KnowledgeAccessSkill<TIndex> {
  return new KnowledgeAccessSkill({ handle, index })
}
