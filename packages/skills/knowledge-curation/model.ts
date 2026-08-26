import type { CurationOperation } from './types.ts'

export interface KnowledgeCurationModelRequest {
  operation: CurationOperation
  instruction: string
  input: unknown
  expectedOutputContract: string
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
