import type { KnowledgeContext } from '../../skills/knowledge-curation/index.ts'
import type { KnowledgeBaseHandle } from '../../shared/knowledge-base/index.ts'
import type { KnowledgeIndexV03 } from '../../shared/knowledge-base/knowledge-index-v03.ts'

export function createKnowledgeScopeContext(handle: KnowledgeBaseHandle, index: KnowledgeIndexV03): KnowledgeContext {
  const all = [...index.themeGroups.keys(), ...index.entities.keys(), ...index.relations.keys(), ...index.claims.keys(), ...index.sources.keys(), ...index.modules.keys()]
  return {
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.3',
    existingRefs: all.sort(),
    themeGroups: [...index.themeGroups.values()].map(({ id, name, aliases }) => ({ id, name, aliases })),
    themes: [...index.entities.values()].filter((entity) => entity.type === 'investment_theme').map(({ id, name, aliases, themeGroupRef }) => ({ id, name, aliases: aliases ?? [], themeGroupRef })),
    entities: [...index.entities.values()].sort((left, right) => left.id.localeCompare(right.id)),
    relations: [...index.relations.values()].sort((left, right) => left.id.localeCompare(right.id)),
    claims: [...index.claims.values()].sort((left, right) => left.id.localeCompare(right.id)),
    sources: [...index.sources.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
}
