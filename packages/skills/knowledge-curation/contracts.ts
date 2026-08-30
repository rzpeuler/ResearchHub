import type { StructuredOutputContract } from './model.ts'

const nullableString = { type: ['string', 'null'] }
const stringArray = { type: 'array', items: { type: 'string' } }
const confidence = { type: 'number', minimum: 0, maximum: 1 }
const mention = {
  type: 'object', additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' }, entityType: { ...nullableString, canonicalEnumRef: 'schema.entity.types' }, existingRef: nullableString },
}
const sourceAssessment = {
  type: 'object', additionalProperties: false,
  required: ['sourceType', 'publisher', 'institution', 'author', 'publishedAt', 'primaryOrSecondary', 'sourceReliability', 'sourceIdentityConfidence', 'reasoning'],
  properties: {
    sourceType: { type: 'string', canonicalEnumRef: 'schema.source.types' }, publisher: nullableString, institution: nullableString, author: nullableString, publishedAt: nullableString,
    primaryOrSecondary: { type: 'string', enum: ['primary', 'secondary', 'unknown'] }, sourceReliability: { type: 'string', canonicalEnumRef: 'schema.source.reliabilities' }, sourceIdentityConfidence: confidence, reasoning: stringArray,
  },
}
const themeHypothesis = {
  type: 'object', additionalProperties: false, required: ['mention', 'disposition', 'existingThemeRefs', 'reason', 'evidenceChunkRefs'],
  properties: { mention: { type: 'string' }, disposition: { type: 'string', enum: ['resolved_existing', 'resolved_multiple', 'provisional_unresolved', 'proposed_new', 'ambiguous'] }, existingThemeRefs: stringArray, reason: { type: 'string' }, evidenceChunkRefs: stringArray },
}
const entityMention = {
  type: 'object', additionalProperties: false, required: ['mention', 'entityType', 'suggestedExistingRef', 'evidenceChunkRefs', 'reason'],
  properties: { mention: { type: 'string' }, entityType: { ...nullableString, canonicalEnumRef: 'schema.entity.types' }, suggestedExistingRef: nullableString, evidenceChunkRefs: stringArray, reason: { type: 'string' } },
}
const entityCandidate = {
  type: 'object', additionalProperties: false, required: ['entityType', 'name', 'aliases', 'description', 'suggestedExistingRef', 'semanticFields', 'evidenceChunkRefs', 'reason'],
  properties: { entityType: { type: 'string', canonicalEnumRef: 'schema.entity.types' }, name: { type: 'string' }, aliases: stringArray, description: nullableString, suggestedExistingRef: nullableString, semanticFields: { type: 'object' }, evidenceChunkRefs: stringArray, reason: { type: 'string' } },
}
const relationCandidate = {
  type: 'object', additionalProperties: false, required: ['relationType', 'sourceMention', 'targetMention', 'attributes', 'contextMentions', 'evidenceChunkRefs', 'reason'],
  properties: { relationType: { type: 'string', canonicalEnumRef: 'schema.relation.types' }, sourceMention: mention, targetMention: mention, attributes: { type: 'object' }, contextMentions: { type: 'array', items: mention }, evidenceChunkRefs: stringArray, reason: { type: 'string' } },
}
const temporal = { type: 'object', additionalProperties: false, required: ['asOf', 'scope'], properties: { asOf: nullableString, scope: { type: 'object', additionalProperties: false, required: ['type', 'start', 'end', 'label'], properties: { type: { type: 'string', canonicalEnumRef: 'schema.claim.temporalScopeTypes' }, start: nullableString, end: nullableString, label: nullableString } } } }
const structuredValue = { type: 'object', additionalProperties: false, required: ['metric', 'value', 'unit', 'comparator'], properties: { metric: { type: 'string' }, value: { type: ['string', 'number', 'boolean', 'null'] }, unit: nullableString, comparator: { type: ['string', 'null'], canonicalEnumRef: 'schema.claim.comparators' } } }
const claimCandidate = {
  type: 'object', additionalProperties: false, required: ['claimType', 'statement', 'subjectMentions', 'temporal', 'structuredValue', 'semanticConfidence', 'evidenceChunkRefs', 'reason'],
  properties: { claimType: { type: 'string', canonicalEnumRef: 'schema.claim.types' }, statement: { type: 'string' }, subjectMentions: { type: 'array', items: mention }, temporal: { ...temporal, type: ['object', 'null'] }, structuredValue: { ...structuredValue, type: ['object', 'null'] }, semanticConfidence: confidence, evidenceChunkRefs: stringArray, reason: { type: 'string' } },
}
const reconciliationDecision = {
  type: 'object', additionalProperties: false, required: ['candidateId', 'decision', 'classification', 'existingRefs', 'reason', 'requiresUserReview'],
  properties: { candidateId: { type: 'string' }, decision: { type: 'string', enum: ['create', 'duplicate', 'merge_source', 'update_state', 'supersede', 'keep_both', 'reject', 'user_review'] }, classification: { type: 'string', enum: ['duplicate', 'temporal_update', 'correction', 'fact_conflict', 'forecast_divergence', 'viewpoint_divergence', 'relation_state_change', 'relation_conflict', 'complementary'] }, existingRefs: stringArray, reason: { type: 'string' }, requiresUserReview: { type: 'boolean' } },
}
const schemaGap = {
  type: 'object', additionalProperties: false, required: ['candidateRefs', 'gapType', 'observedInformation', 'currentLimitation', 'suggestedDirection', 'affectedKnowledgeTypes', 'affectedIndustries', 'generality', 'frequency', 'recommendedAction'],
  properties: { candidateRefs: stringArray, gapType: { type: 'string', enum: ['vocabulary', 'schema', 'validation', 'access', 'projection'] }, observedInformation: { type: 'object', additionalProperties: false, required: ['description', 'examples'], properties: { description: { type: 'string' }, examples: stringArray } }, currentLimitation: { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } }, suggestedDirection: { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } }, affectedKnowledgeTypes: stringArray, affectedIndustries: stringArray, generality: { type: 'string', enum: ['local', 'cross_industry', 'universal'] }, frequency: { type: 'string', enum: ['first_seen', 'repeated'] }, recommendedAction: { type: 'string' } },
}

export const STRUCTURED_OUTPUT_CONTRACTS: Record<'understandReport' | 'extractKnowledge' | 'reconcileKnowledge' | 'analyzeSchemaGaps', StructuredOutputContract> = {
  understandReport: { format: 'json', root: 'object', additionalProperties: false, schema: { type: 'object', additionalProperties: false, required: ['sourceAssessment', 'researchScope', 'majorTopics', 'majorEntityMentions', 'themeHypotheses', 'uncertainty'], properties: { sourceAssessment, researchScope: stringArray, majorTopics: stringArray, majorEntityMentions: { type: 'array', items: entityMention }, themeHypotheses: { type: 'array', items: themeHypothesis }, newThemeProposal: { type: ['object', 'null'], additionalProperties: false, required: ['name', 'definition', 'reason'], properties: { name: { type: 'string' }, definition: { type: 'string' }, reason: { type: 'string' } } }, uncertainty: stringArray } } },
  extractKnowledge: { format: 'json', root: 'object', additionalProperties: false, schema: { type: 'object', additionalProperties: false, required: ['entities', 'relations', 'claims'], properties: { entities: { type: 'array', items: entityCandidate }, relations: { type: 'array', items: relationCandidate }, claims: { type: 'array', items: claimCandidate } } } },
  reconcileKnowledge: { format: 'json', root: 'object', additionalProperties: false, schema: { type: 'object', additionalProperties: false, required: ['decisions'], properties: { decisions: { type: 'array', items: reconciliationDecision } } } },
  analyzeSchemaGaps: { format: 'json', root: 'object', additionalProperties: false, schema: { type: 'object', additionalProperties: false, required: ['gaps'], properties: { gaps: { type: 'array', items: schemaGap } } } },
}
