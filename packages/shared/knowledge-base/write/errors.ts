import type { KnowledgeWriteErrorCode } from '../../../../packages/schemas/knowledge/index.ts'

export class KnowledgeWriteInternalError extends Error {
  constructor(public readonly publicCode: KnowledgeWriteErrorCode, message: string) {
    super(message)
    this.name = 'KnowledgeWriteInternalError'
  }
}
