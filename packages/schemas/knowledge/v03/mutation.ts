import type {
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeModuleV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  KnowledgeThemeGroupV03,
} from './domain.ts'

export type KnowledgeWritableObjectV03 = KnowledgeThemeGroupV03 | KnowledgeEntityV03 | KnowledgeRelationV03 | KnowledgeClaimV03 | KnowledgeModuleV03

export interface KnowledgeSourceCreateOperationV03 {
  operationId: string
  type: 'source_create'
  source: KnowledgeSourceV03
}

export interface KnowledgeSourceMergeOperationV03 {
  operationId: string
  type: 'source_merge'
  sourceId: string
  expectedBeforeHash: string
  addRawRefs?: string[]
  metadataPatch?: Pick<KnowledgeSourceV03, 'institution' | 'author' | 'publishedAt' | 'url' | 'sourceType' | 'sourceReliability'>
}

export type KnowledgeSourceOperationV03 = KnowledgeSourceCreateOperationV03 | KnowledgeSourceMergeOperationV03

export interface KnowledgeCreateOperationV03 {
  operationId: string
  type: 'create'
  object: KnowledgeWritableObjectV03
}

export interface KnowledgeUpdateOperationV03 {
  operationId: string
  type: 'update'
  knowledgeId: string
  expectedBeforeHash: string
  object: KnowledgeWritableObjectV03
}

export interface KnowledgeSupersedeOperationV03 {
  operationId: string
  type: 'supersede'
  knowledgeId: string
  expectedBeforeHash: string
  replacement: KnowledgeClaimV03
}

export interface KnowledgeMergeSourceOperationV03 {
  operationId: string
  type: 'merge_source'
  knowledgeId: string
  expectedBeforeHash: string
  addSourceRefs: string[]
}

export type KnowledgeOperationV03 = KnowledgeCreateOperationV03 | KnowledgeUpdateOperationV03 | KnowledgeSupersedeOperationV03 | KnowledgeMergeSourceOperationV03

export interface KnowledgeChangeSetV03 {
  changeSetId: string
  workflowRunId: string
  knowledgeBaseId: string
  schemaVersion: '0.3'
  storageFormatVersion: '1'
  expectedBaseRevision: number
  requiresRawProvenance: boolean
  sourceOperations: KnowledgeSourceOperationV03[]
  knowledgeOperations: KnowledgeOperationV03[]
  ingestionContext?: Record<string, unknown>
}

export interface ValidatedKnowledgeChangeSetV03 {
  readonly changeSet: KnowledgeChangeSetV03
  readonly knowledgeBaseId: string
  readonly schemaVersion: '0.3'
  readonly baseRevision: number
  readonly changeSetId: string
  readonly changeSetHash: string
  readonly validatedAt: string
}
