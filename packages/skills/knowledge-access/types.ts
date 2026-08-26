export {
  ENTITY_TYPES,
  INTELLIGENCE_TYPES,
  LIFECYCLE_STATUSES,
  MODULE_TYPES,
  RELATION_TYPES,
} from '../../../packages/schemas/knowledge/index.ts'
export type {
  EntityType,
  IntelligenceType,
  LifecycleStatus,
  RelationType,
  ModuleType,
  KnowledgeScalar,
  KnowledgeValue,
  Lifecycle,
  KnowledgeEntity,
  KnowledgeRelation,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeSource,
} from '../../../packages/schemas/knowledge/index.ts'
export type {
  KnowledgeAssetKind,
  RegistryEntry,
  ModuleRegistryBinding,
  LoadedAsset,
  KnowledgeAssetCollection,
  KnowledgeLoaderOptions,
} from '../../../packages/shared/knowledge-base/types.ts'

import type { KnowledgeEntity, KnowledgeRelation } from '../../../packages/schemas/knowledge/index.ts'

export interface EntitySearchResult extends KnowledgeEntity {
  relevance: number
}

export interface RelatedCompanyResult {
  company: KnowledgeEntity
  relation: KnowledgeRelation
}
