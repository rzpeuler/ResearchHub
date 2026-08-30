import type { ActiveCurationOperation, JsonRecord } from './types.ts'
import type { CurationSchemaContext } from './schema-context-types.ts'

export interface StructuredOutputContract {
  format: 'json'
  root: 'object' | 'array'
  additionalProperties: false
  schema: JsonRecord
}

export interface KnowledgeCurationModelRequest {
  operation: ActiveCurationOperation
  instruction: string
  input: unknown
  schemaContext: CurationSchemaContext
  outputContract: StructuredOutputContract
}

export interface KnowledgeCurationModel {
  invoke(request: KnowledgeCurationModelRequest): Promise<unknown>
}

export class KnowledgeCurationModelError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'KnowledgeCurationModelError'
    this.cause = cause
  }
}
