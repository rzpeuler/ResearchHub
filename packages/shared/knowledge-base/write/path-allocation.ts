import { basename, relative, resolve, sep } from 'node:path'
import type { KnowledgeWritableObject, KnowledgeSource } from '../../../../packages/schemas/knowledge/index.ts'
import type { KnowledgeAssetKind } from '../types.ts'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugFromKnowledgeId(id: string): string {
  const slug = id.split(':')[1]
  if (!slug || !SLUG_PATTERN.test(slug)) throw new Error(`Knowledge ID cannot be allocated to a safe path: ${id}`)
  return slug
}

export function kindForWritableObject(object: KnowledgeWritableObject): KnowledgeAssetKind {
  const record = object as Record<string, unknown>
  if (typeof record.source === 'string' && typeof record.target === 'string') return 'relation'
  if (Array.isArray(record.entityRefs)) return 'intelligence'
  if ('columns' in record || 'rows' in record || 'schemaId' in record) return 'module'
  if ('name' in record && typeof record.name === 'string') return 'entity'
  throw new Error(`Unsupported Knowledge object shape: ${object.id}`)
}

export function allocateKnowledgeStorageRef(object: KnowledgeWritableObject | KnowledgeSource): string {
  const slug = slugFromKnowledgeId(object.id)
  if (object.id.startsWith('source:')) return `sources/${slug}.yaml`
  const kind = kindForWritableObject(object as KnowledgeWritableObject)
  if (kind === 'entity') {
    const entityType = object.type
    if (!['industry', 'segment', 'company', 'product', 'technology'].includes(entityType)) throw new Error(`Unsupported entity type for path allocation: ${entityType}`)
    const directory = entityType === 'industry' ? 'industries' : `${entityType}s`
    return `entities/${directory}/${slug}.yaml`
  }
  if (kind === 'relation') return `relations/${slug}.yaml`
  if (kind === 'intelligence') return `intelligence/${String(object.type)}s/${slug}.yaml`
  if (kind === 'module') return `modules/${String(object.type)}/${slug}.yaml`
  throw new Error(`Unsupported Knowledge path allocation: ${object.id}`)
}

export function resolveAllocatedPath(rootRef: string, storageRef: string): string {
  const root = resolve(rootRef)
  const resolved = resolve(root, storageRef)
  const relativePath = relative(root, resolved)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error(`Allocated path escapes Knowledge Base root: ${storageRef}`)
  return resolved
}

export function isSafeStorageRef(storageRef: string): boolean {
  return storageRef.length > 0 && !storageRef.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(storageRef) && !storageRef.split(/[\\/]+/).includes('..') && basename(storageRef) === storageRef.split(/[\\/]+/).at(-1)
}
