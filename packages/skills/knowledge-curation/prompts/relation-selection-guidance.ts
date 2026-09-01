import { KNOWLEDGE_SCHEMA_V03 } from '../../../schemas/knowledge/v03/executable-schema.ts'

type RelationDefinition = {
  sourceTypes: readonly string[]
  targetTypes: readonly string[]
  semanticDescription: string
  endpointConstraint?: string
}

const relationDefinitions = KNOWLEDGE_SCHEMA_V03.relation.definitions as Record<string, RelationDefinition>

function relationEntry(relationType: string): string {
  const definition = relationDefinitions[relationType]
  if (!definition) throw new Error(`Missing executable relation definition for ${relationType}`)
  const constraint = definition.endpointConstraint ? `; endpointConstraint=${definition.endpointConstraint}` : ''
  return `- ${relationType}: ${definition.sourceTypes.join('|')} -> ${definition.targetTypes.join('|')}; semanticDescription=${JSON.stringify(definition.semanticDescription)}${constraint}`
}

export function buildRelationSelectionGuidance(): string {
  const entries = KNOWLEDGE_SCHEMA_V03.relation.types.map((relationType) => relationEntry(relationType)).join('\n')
  return `Relation selection rules:\n- Determine endpoint types first: identify the semantic Entity type of both relation endpoints.\n- Consider only Relation definitions whose sourceTypes and targetTypes allow those endpoint types.\n- Among endpoint-compatible definitions, select a relation only when its semanticDescription matches the evidence.\n- If no canonical Relation matches both endpoint types and meaning, do not emit a RelationCandidate for that assertion.\n- If the evidence does not fit any canonical Relation definition, do not force a Relation merely to preserve every relational phrase.\n- Never change or coerce an endpoint Entity type to make a preferred relationType legal.\n- Do not select a Relation type solely because report wording resembles its name (for example upstream, supplier, belongs, depends, component, or substitute).\n- Relation attributes must follow the supplied Structured Output Contract.\n\nCanonical relation compatibility (Schema-derived, stable relation.types order):\n${entries}`
}

export const RELATION_SELECTION_GUIDANCE = buildRelationSelectionGuidance()
