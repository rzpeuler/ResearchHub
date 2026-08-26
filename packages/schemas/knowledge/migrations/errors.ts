import type { KnowledgeSchemaVersionRef } from '../schema-release.ts'
import type { KnowledgeMigrationDefinition } from './types.ts'

export class KnowledgeMigrationPathError extends Error {
  override readonly name = 'KnowledgeMigrationPathError'

  constructor(
    message: string,
    public readonly source: KnowledgeSchemaVersionRef,
    public readonly target: KnowledgeSchemaVersionRef,
    public readonly paths: KnowledgeMigrationDefinition[][],
  ) {
    super(message)
  }
}
