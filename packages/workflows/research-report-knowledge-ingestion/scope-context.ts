import { ENTITY_TYPES, INTELLIGENCE_TYPES, MODULE_TYPES, RELATION_TYPES } from '../../../packages/schemas/knowledge/index.ts'
import type { KnowledgeScopeContext } from '../../../packages/skills/knowledge-curation/index.ts'
import type { KnowledgeBaseHandle } from '../../../packages/shared/knowledge-base/index.ts'

export function createKnowledgeScopeContext(handle: KnowledgeBaseHandle): KnowledgeScopeContext {
  return {
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: handle.schemaVersion,
    taxonomySummary: [],
    supportedEntityTypes: [...ENTITY_TYPES],
    supportedIntelligenceTypes: [...INTELLIGENCE_TYPES],
    supportedRelationTypes: [...RELATION_TYPES],
    supportedModuleTypes: [...MODULE_TYPES],
  }
}
