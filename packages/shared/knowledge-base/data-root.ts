import { relative, resolve, sep } from 'node:path'
import { KnowledgeError } from './errors.ts'

export interface KnowledgeDataRootConfig {
  rootDir: string
}

function assertKnowledgeBaseId(knowledgeBaseId: string): void {
  if (typeof knowledgeBaseId !== 'string' || knowledgeBaseId.trim() === '') {
    throw new KnowledgeError('DataRootError', 'knowledgeBaseId must be a non-empty string')
  }
  if (knowledgeBaseId === '.' || knowledgeBaseId === '..' || knowledgeBaseId.includes('/') || knowledgeBaseId.includes('\\')) {
    throw new KnowledgeError('DataRootError', `Invalid Knowledge Base ID for runtime data root: ${knowledgeBaseId}`)
  }
}

export function resolveKnowledgeBaseRoot(config: KnowledgeDataRootConfig, knowledgeBaseId: string): string {
  if (!config || typeof config.rootDir !== 'string' || config.rootDir.trim() === '') {
    throw new KnowledgeError('DataRootError', 'Knowledge data root configuration requires a non-empty rootDir')
  }
  assertKnowledgeBaseId(knowledgeBaseId)
  const dataRoot = resolve(config.rootDir)
  const knowledgeBasesRoot = resolve(dataRoot, 'knowledge-bases')
  const candidate = resolve(knowledgeBasesRoot, knowledgeBaseId)
  const escape = relative(knowledgeBasesRoot, candidate)
  if (escape === '..' || escape.startsWith(`..${sep}`) || escape.includes(sep + '..' + sep)) {
    throw new KnowledgeError('DataRootError', `Knowledge Base root escapes configured data root: ${knowledgeBaseId}`)
  }
  return candidate
}
