export interface KnowledgeSchemaVersionRef {
  schemaVersion: string
  storageFormatVersion: string
}

export interface KnowledgeSchemaRelease extends KnowledgeSchemaVersionRef {
  readable: boolean
  writable: boolean
  migrationSources: KnowledgeSchemaVersionRef[]
}

export const KNOWLEDGE_SCHEMA_RELEASES: readonly KnowledgeSchemaRelease[] = Object.freeze([
  { schemaVersion: '0.1', storageFormatVersion: '1', readable: true, writable: false, migrationSources: [] },
  { schemaVersion: '0.2', storageFormatVersion: '1', readable: true, writable: true, migrationSources: [{ schemaVersion: '0.1', storageFormatVersion: '1' }] },
  { schemaVersion: '0.3', storageFormatVersion: '1', readable: true, writable: false, migrationSources: [{ schemaVersion: '0.2', storageFormatVersion: '1' }] },
])

export function findKnowledgeSchemaRelease(version: KnowledgeSchemaVersionRef): KnowledgeSchemaRelease | undefined {
  return KNOWLEDGE_SCHEMA_RELEASES.find((release) => release.schemaVersion === version.schemaVersion && release.storageFormatVersion === version.storageFormatVersion)
}
