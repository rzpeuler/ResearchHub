import { resolve } from 'node:path'
import { KnowledgeBaseHandle } from '../../packages/shared/knowledge-base/handle.ts'

export function createTestHandle(rootRef: string, knowledgeBaseId = 'test-knowledge-base', schemaVersion = '0.1'): KnowledgeBaseHandle {
  return new KnowledgeBaseHandle({
    knowledgeBaseId,
    rootRef: resolve(rootRef),
    schemaVersion,
    storageFormatVersion: '1',
    revision: 0,
    status: 'active',
  })
}
