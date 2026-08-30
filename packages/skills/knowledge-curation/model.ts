import type { CurationOperation, JsonRecord } from './types.ts'
import type { CurationSchemaContext } from './schema-context-types.ts'

export interface StructuredOutputContract {
  format: 'json'
  root: 'object' | 'array'
  additionalProperties: false
  schema: JsonRecord
}

export interface KnowledgeCurationModelRequest {
  operation: CurationOperation
  instruction: string
  input: unknown
  // The external DSH composition adapter still transports legacy envelopes.
  // Active v0.3 callers use KnowledgeCurationModelV03Request below.
  schemaContext?: CurationSchemaContext
  outputContract?: StructuredOutputContract
  // Keep structural widening only for that existing external adapter boundary.
  [key: string]: unknown
}

export interface KnowledgeCurationModelV03Request {
  operation: CurationOperation
  instruction: string
  input: unknown
  schemaContext: CurationSchemaContext
  outputContract: StructuredOutputContract
  [key: string]: unknown
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
