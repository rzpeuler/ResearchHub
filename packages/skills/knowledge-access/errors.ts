export type KnowledgeErrorCode =
  | 'NotFound'
  | 'ParseError'
  | 'SchemaError'
  | 'InvalidReference'
  | 'InvalidRelation'
  | 'InvalidLifecycle'
  | 'UnknownModule'

export class KnowledgeError extends Error {
  constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
    public readonly filePath?: string,
  ) {
    super(message)
    this.name = `Knowledge${code}Error`
  }
}
