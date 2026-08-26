import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { KnowledgeError, resolveKnowledgeBaseRoot } from '../../../packages/shared/knowledge-base/index.ts'

test('runtime data root resolves under knowledge-bases', () => {
  assert.equal(resolveKnowledgeBaseRoot({ rootDir: 'C:/researchhub-data' }, 'kb-example'), resolve('C:/researchhub-data/knowledge-bases/kb-example'))
})

test('runtime data root rejects path traversal and missing configuration', () => {
  assert.throws(() => resolveKnowledgeBaseRoot({ rootDir: 'C:/researchhub-data' }, '../outside'), (error: unknown) => error instanceof KnowledgeError && error.code === 'DataRootError')
  assert.throws(() => resolveKnowledgeBaseRoot({ rootDir: '' }, 'kb-example'), /rootDir/)
})
