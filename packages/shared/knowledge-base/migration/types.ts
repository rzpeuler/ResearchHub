import type { KnowledgeBaseManifest, KnowledgeSchemaVersionRef, KnowledgeMigrationDefinition, KnowledgeIdMapping, MigrationReviewItem } from '../../../schemas/knowledge/index.ts'
import type { KnowledgeBaseHandle } from '../handle.ts'
import type { KnowledgeBaseRegistry } from '../registry.ts'

export type KnowledgeMigrationMode = 'dry_run' | 'commit'
export type KnowledgeMigrationStatus = 'dry_run_passed' | 'committed' | 'review_required' | 'already_current' | 'blocked' | 'failed'

export interface KnowledgeMigrationRequest {
  migrationRunId: string
  targetSchemaVersion: string
  targetStorageFormatVersion: string
  expectedBaseRevision: number
  mode: KnowledgeMigrationMode
}

export interface KnowledgeMigrationInventory {
  entityIds: string[]
  relationIds: string[]
  intelligenceIds: string[]
  moduleIds: string[]
  sourceIds: string[]
  counts: { entities: number; relations: number; intelligence: number; modules: number; sources: number }
}

export interface KnowledgeMigrationChanges {
  manifest: { schemaVersion: boolean; revisionIncrement: number; updatedAt: boolean }
  registry: { canonicalAssetsCreated: boolean; legacyIndexRemoved: boolean; legacyModulesRemoved: boolean; rawRegistryCreated: boolean }
  assets: { moduleTargetsDerived: string[] }
}

export interface KnowledgeMigrationValidationSummary {
  source: 'passed' | 'failed' | 'not_run'
  target: 'passed' | 'failed' | 'not_run'
  errors?: string[]
}

export interface KnowledgeMigrationResult {
  migrationRunId: string
  knowledgeBaseId: string
  mode: KnowledgeMigrationMode
  status: KnowledgeMigrationStatus
  migrationPath: KnowledgeMigrationDefinition[]
  source: KnowledgeSchemaVersionRef & { revision: number }
  target: KnowledgeSchemaVersionRef & { revision: number }
  inventory: { before: KnowledgeMigrationInventory; after?: KnowledgeMigrationInventory }
  idMappings: KnowledgeIdMapping[]
  reviewItems: MigrationReviewItem[]
  changes: KnowledgeMigrationChanges
  validation: KnowledgeMigrationValidationSummary
  migrationLogRef?: string
  committedHandle?: KnowledgeBaseHandle
  error?: { code: string; message: string }
}

export interface KnowledgeMigrationStateValidator {
  validateSource(handle: KnowledgeBaseHandle): Promise<void>
  validateTarget(rootRef: string, manifest: KnowledgeBaseManifest): Promise<void>
}

export interface KnowledgeMigrationRunnerOptions {
  registry?: KnowledgeBaseRegistry
  migrationRegistry?: import('../../../schemas/knowledge/index.ts').KnowledgeMigrationRegistry
  validator?: KnowledgeMigrationStateValidator
  clock?: () => string
  failpoint?: (point: 'before_switch' | 'during_switch' | 'after_switch') => void | Promise<void>
}
