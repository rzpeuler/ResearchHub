export type CurationSchemaContextSlice =
  | 'report_understanding'
  | 'knowledge_extraction'
  | 'reconciliation'
  | 'schema_gap'

export interface CurationSchemaContext {
  schemaVersion: '0.3'
  storageFormatVersion: '1'
  slice: CurationSchemaContextSlice
  canonicalObjectKinds: readonly string[]
  schema: Record<string, unknown>
}

export interface CurationSchemaContextError extends Error {
  readonly code: 'invalid_schema_context_slice'
}
