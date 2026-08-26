import type { KnowledgeSchemaVersionRef } from '../schema-release.ts'

export interface KnowledgeMigrationDefinition {
  id: string
  source: KnowledgeSchemaVersionRef
  target: KnowledgeSchemaVersionRef
}

export interface MigrationReviewItem {
  reviewItemId: string
  migrationRunId: string
  knowledgeBaseId: string
  migrationId: string
  code: string
  assetId?: string
  description: string
  suggestedAction: string
  details?: Record<string, unknown>
}

export interface KnowledgeIdMapping {
  from: string
  to: string
  reason: string
}
