import type {
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeModuleV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  KnowledgeThemeGroupV03,
} from '../../schemas/knowledge/v03/domain.ts'

export type {
  CanonicalKnowledgeRefV03,
  ClaimRefV03,
  EntityRefV03,
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeModuleV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  KnowledgeThemeGroupV03,
  ModuleRefV03,
  RawRefV03,
  RelationRefV03,
  SourceRefV03,
  ThemeGroupRefV03,
} from '../../schemas/knowledge/v03/domain.ts'

export type KnowledgeAssetKindV03 = 'theme_group' | 'entity' | 'relation' | 'claim' | 'module' | 'source'
export type KnowledgeAssetV03 = KnowledgeThemeGroupV03 | KnowledgeEntityV03 | KnowledgeRelationV03 | KnowledgeClaimV03 | KnowledgeModuleV03 | KnowledgeSourceV03

export interface KnowledgeRegistryEntryV03 {
  id: string
  type: KnowledgeAssetKindV03
  storageRef: string
}

export interface LoadedAssetV03<T extends object = Record<string, unknown>> {
  kind: KnowledgeAssetKindV03
  value: T
  filePath: string
  storageRef: string
}

export interface KnowledgeAssetCollectionV03 {
  rootDir: string
  themeGroups: LoadedAssetV03<KnowledgeThemeGroupV03>[]
  entities: LoadedAssetV03<KnowledgeEntityV03>[]
  relations: LoadedAssetV03<KnowledgeRelationV03>[]
  claims: LoadedAssetV03<KnowledgeClaimV03>[]
  modules: LoadedAssetV03<KnowledgeModuleV03>[]
  sources: LoadedAssetV03<KnowledgeSourceV03>[]
  registry: KnowledgeRegistryEntryV03[]
}
