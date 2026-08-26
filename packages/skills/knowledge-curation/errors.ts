export type KnowledgeCurationErrorCode =
  | 'model_error'
  | 'invalid_model_output'
  | 'ungrounded_candidate'
  | 'invalid_reference'
  | 'invalid_confidence'
  | 'unsupported_mapping'

export class KnowledgeCurationError extends Error {
  override readonly cause: unknown

  constructor(public readonly code: KnowledgeCurationErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'KnowledgeCurationError'
    this.cause = cause
  }
}
