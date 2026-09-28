import { KNOWLEDGE_SCHEMA_V03 } from './executable-schema.ts'

export const KNOWLEDGE_SCHEMA_V04 = {
  ...KNOWLEDGE_SCHEMA_V03,
  identity: { schemaVersion: '0.4', storageFormatVersion: '1' },
  canonicalObjectKinds: [...KNOWLEDGE_SCHEMA_V03.canonicalObjectKinds, 'Event', 'Observation', 'Thesis', 'ReasoningEdge'] as const,
  canonicalNamespaces: {
    ...KNOWLEDGE_SCHEMA_V03.canonicalNamespaces,
    event: 'event:',
    observation: 'observation:',
    thesis: 'thesis:',
    reasoningEdge: 'reasoning-edge:',
  },
  entity: {
    ...KNOWLEDGE_SCHEMA_V03.entity,
    types: [...KNOWLEDGE_SCHEMA_V03.entity.types, 'person', 'institution', 'security'] as const,
    commonFields: [...KNOWLEDGE_SCHEMA_V03.entity.commonFields, 'externalIdentifiers'] as const,
    person: { description: 'A financially relevant person such as an executive, analyst, expert, author, or fund manager.' },
    institution: { description: 'A broker, investment bank, fund, regulator, association, research institution, or media organization.' },
    security: { fields: ['ticker', 'exchange', 'securityType', 'currency', 'externalIdentifiers'] as const, requiredFields: ['ticker', 'exchange', 'securityType'] as const },
  },
  relation: {
    ...KNOWLEDGE_SCHEMA_V03.relation,
    definitions: {
      ...KNOWLEDGE_SCHEMA_V03.relation.definitions,
      belongs_to_industry: {
        ...KNOWLEDGE_SCHEMA_V03.relation.definitions.belongs_to_industry,
        sourceTypes: ['company', 'product', 'technology'] as const,
      },
    },
  },
  claim: {
    ...KNOWLEDGE_SCHEMA_V03.claim,
    // `thesis` remains a readable legacy ClaimType in the domain contract, but
    // new writes must use the first-class Thesis object below.
    types: [...KNOWLEDGE_SCHEMA_V03.claim.types, 'assumption', 'thesis', 'catalyst'] as const,
    fields: [...KNOWLEDGE_SCHEMA_V03.claim.fields, 'probability', 'supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs'] as const,
    structuredValueFields: ['metric', 'value', 'unit', 'comparator', 'period', 'fiscalPeriod', 'semanticKey'] as const,
    probability: { requiredFor: ['forecast'] as const, minimum: 0, maximum: 1 },
  },
  source: {
    ...KNOWLEDGE_SCHEMA_V03.source,
    fields: [...KNOWLEDGE_SCHEMA_V03.source.fields, 'provider', 'canonicalUrl', 'retrievedAt', 'contentHash', 'acquisition', 'rights', 'usagePolicy'] as const,
    rights: ['accessScope', 'providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed', 'expiresAt', 'entitlementRef', 'policyBasis'] as const,
    usagePolicy: ['mode', 'retainRaw', 'allowAiProcessing', 'allowDerivedKnowledge', 'redistributionAllowed'] as const,
  },
  event: {
    types: ['earnings_release', 'earnings_call', 'investor_relations_activity', 'guidance_update', 'product_launch', 'capacity_expansion', 'regulatory_action', 'management_change', 'merger_acquisition', 'financing', 'contract_award', 'policy_change', 'other'] as const,
    fields: ['id', 'eventType', 'title', 'subjectRefs', 'participantRefs', 'temporal', 'sourceRefs', 'externalIdentifiers', 'attributes', 'lifecycle', 'createdAt', 'updatedAt'] as const,
    requiredFields: ['id', 'eventType', 'title', 'subjectRefs', 'temporal', 'sourceRefs', 'lifecycle'] as const,
  },
  observation: {
    types: ['metric', 'estimate', 'consensus'] as const,
    fields: ['id', 'observationType', 'subjectRef', 'metricRef', 'value', 'unit', 'period', 'dimensions', 'sourceRef', 'provenance', 'observedAt', 'reportedAt', 'asOf', 'fiscalPeriod', 'estimateValue', 'currency', 'institutionRef', 'analystRef', 'publishedAt', 'estimateHorizon', 'revisionOf', 'mean', 'median', 'high', 'low', 'count', 'dispersion', 'contributingObservationRefs', 'recordedAt', 'lifecycle'] as const,
  },
  thesis: {
    statuses: ['active', 'strengthening', 'weakening', 'challenged', 'invalidated', 'archived'] as const,
    fields: ['id', 'subjectRefs', 'title', 'statement', 'status', 'createdAt', 'lastReviewedAt', 'lifecycle', 'updatedAt', 'killCriteria'] as const,
    requiredFields: ['id', 'subjectRefs', 'title', 'statement', 'status', 'createdAt', 'lifecycle'] as const,
    killCriteria: { types: ['numeric_threshold'] as const, numericThresholdDefinitionVersion: 1, maxRevisionsPerThesis: 100, maxTargetsPerCriterion: 32 } as const,
  },
  reasoningEdge: {
    types: ['supports', 'contradicts', 'depends_on', 'qualifies', 'invalidates', 'challenges'] as const,
    fields: ['id', 'type', 'sourceRef', 'targetRef', 'sourceRefs', 'confidence', 'asOf', 'lifecycle', 'createdAt', 'updatedAt'] as const,
    endpointRules: ['Observation->Claim', 'Observation->Thesis', 'Claim->Claim', 'Claim->Thesis'],
  },
} as const

export type KnowledgeSchemaV04 = typeof KNOWLEDGE_SCHEMA_V04
