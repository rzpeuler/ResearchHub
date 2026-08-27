import type { KnowledgeSourceV03, KnowledgeWritableObjectV03 } from '../../../../packages/schemas/knowledge/v03/index.ts'
import type { KnowledgeAssetKindV03 } from '../v03-types.ts'
import { slugFromKnowledgeId } from './path-allocation.ts'

export function kindForWritableObjectV03(object: KnowledgeWritableObjectV03): Exclude<KnowledgeAssetKindV03, 'source'> {
  if (object.id.startsWith('theme-group:')) return 'theme_group'
  if (object.id.startsWith('entity:')) return 'entity'
  if (object.id.startsWith('relation:')) return 'relation'
  if (object.id.startsWith('claim:')) return 'claim'
  if (object.id.startsWith('module:')) return 'module'
  throw new Error(`Unsupported Schema 0.3 object ID: ${object.id}`)
}

export function allocateKnowledgeStorageRefV03(object: KnowledgeWritableObjectV03 | KnowledgeSourceV03): string {
  const slug = slugFromKnowledgeId(object.id)
  if (object.id.startsWith('source:')) return `sources/${slug}.yaml`
  const kind = kindForWritableObjectV03(object as KnowledgeWritableObjectV03)
  if (kind === 'theme_group') return `theme-groups/${slug}.yaml`
  if (kind === 'entity') return `entities/${(object as Extract<KnowledgeWritableObjectV03, { type: string }>).type}/${slug}.yaml`
  if (kind === 'relation') return `relations/${slug}.yaml`
  if (kind === 'claim') return `claims/${slug}.yaml`
  return `modules/${(object as Extract<KnowledgeWritableObjectV03, { type: string }>).type}/${slug}.yaml`
}
