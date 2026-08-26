import type {
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
  SourceReliability,
  SourceType,
} from './domain.ts'

export type KnowledgeWritableObject = KnowledgeEntity | KnowledgeRelation | KnowledgeIntelligence | KnowledgeModule

export interface KnowledgeSourceCreateOperation {
  operationId: string
  type: 'source_create'
  source: KnowledgeSource
}

export interface KnowledgeSourceMergeOperation {
  operationId: string
  type: 'source_merge'
  sourceId: string
  expectedBeforeHash: string
  addRawRefs?: string[]
  metadataPatch?: {
    institution?: string | null
    author?: string | null
    publishedAt?: string | null
    url?: string | null
    sourceType?: SourceType
    sourceReliability?: SourceReliability
  }
}

export type KnowledgeSourceOperation = KnowledgeSourceCreateOperation | KnowledgeSourceMergeOperation

export interface KnowledgeCreateOperation {
  operationId: string
  type: 'create'
  object: KnowledgeWritableObject
}

export interface KnowledgeUpdateOperation {
  operationId: string
  type: 'update'
  knowledgeId: string
  expectedBeforeHash: string
  object: KnowledgeWritableObject
}

export interface KnowledgeSupersedeOperation {
  operationId: string
  type: 'supersede'
  knowledgeId: string
  expectedBeforeHash: string
  replacement: KnowledgeWritableObject
}

export interface KnowledgeMergeSourceOperation {
  operationId: string
  type: 'merge_source'
  knowledgeId: string
  expectedBeforeHash: string
  addSourceRefs: string[]
}

export type KnowledgeOperation = KnowledgeCreateOperation | KnowledgeUpdateOperation | KnowledgeSupersedeOperation | KnowledgeMergeSourceOperation

export interface KnowledgeIngestionContext {
  actor?: string
  reason?: string
  sourceLabel?: string
  [key: string]: unknown
}

export interface KnowledgeChangeSet {
  changeSetId: string
  workflowRunId: string
  knowledgeBaseId: string
  schemaVersion: string
  expectedBaseRevision: number
  requiresRawProvenance: boolean
  sourceOperations: KnowledgeSourceOperation[]
  knowledgeOperations: KnowledgeOperation[]
  ingestionContext?: KnowledgeIngestionContext
}

export interface ValidatedKnowledgeChangeSet {
  readonly changeSet: KnowledgeChangeSet
  readonly knowledgeBaseId: string
  readonly schemaVersion: string
  readonly baseRevision: number
  readonly changeSetId: string
  readonly changeSetHash: string
  readonly validatedAt: string
}

export type KnowledgeWriteStatus = 'committed' | 'no_changes' | 'already_committed' | 'rejected' | 'failed'

export interface KnowledgeWriteOperationSummary {
  sourceCreated: string[]
  sourceMerged: string[]
  knowledgeCreated: string[]
  knowledgeUpdated: string[]
  knowledgeSuperseded: string[]
  knowledgeSourceMerged: string[]
}

export interface KnowledgeWriteResult {
  status: KnowledgeWriteStatus
  knowledgeBaseId: string
  changeSetId: string
  baseRevision: number
  committedRevision: number
  operations: KnowledgeWriteOperationSummary
  hashes: Array<{ knowledgeId: string; beforeHash?: string; afterHash?: string }>
  ingestionLogRef?: string
  committedHandle?: unknown
  error?: { code: string; message: string }
}
