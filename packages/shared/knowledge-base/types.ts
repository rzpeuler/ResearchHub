import type {
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
} from '../../schemas/knowledge/index.ts'

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
} from '../../schemas/knowledge/index.ts'
export type {
  KnowledgeChangeSet,
  KnowledgeCreateOperation,
  KnowledgeIngestionContext,
  KnowledgeMergeSourceOperation,
  KnowledgeOperation,
  KnowledgeSourceCreateOperation,
  KnowledgeSourceMergeOperation,
  KnowledgeSourceOperation,
  KnowledgeSupersedeOperation,
  KnowledgeUpdateOperation,
  KnowledgeWritableObject,
  KnowledgeWriteOperationSummary,
  KnowledgeWriteErrorCode,
  KnowledgeWriteResult,
  KnowledgeWriteStatus,
  ValidatedKnowledgeChangeSet,
} from '../../schemas/knowledge/index.ts'

export type KnowledgeAssetKind = 'entity' | 'relation' | 'intelligence' | 'module' | 'source'

export interface RegistryEntry {
  id: string
  type: KnowledgeAssetKind
  path: string
  storageRef?: string
}

export interface KnowledgeRegistryAssetEntry {
  type: KnowledgeAssetKind
  storageRef: string
}

export interface ModuleRegistryBinding {
  entityId: string
  moduleIds: string[]
}

export interface LoadedAsset<T extends object = Record<string, unknown>> {
  kind: KnowledgeAssetKind
  value: T
  filePath: string
}

export interface KnowledgeAssetCollection {
  rootDir: string
  entities: LoadedAsset<KnowledgeEntity>[]
  relations: LoadedAsset<KnowledgeRelation>[]
  intelligence: LoadedAsset<KnowledgeIntelligence>[]
  modules: LoadedAsset<KnowledgeModule>[]
  sources: LoadedAsset<KnowledgeSource>[]
  registry: RegistryEntry[]
  moduleRegistry: ModuleRegistryBinding[]
}

export interface KnowledgeLoaderOptions {
  rootDir: string
}
