import type { KnowledgeClaimV03, KnowledgeEntityV03, KnowledgeModuleV03, KnowledgeRelationV03, KnowledgeSourceV03, KnowledgeThemeGroupV03, KnowledgeMetadataV03, SourceTypeV03, SourceReliabilityV03, ClaimStructuredValueV03, InvestmentThemeV03, IndustryV03, CompanyV03, ProductV03, TechnologyV03 } from './domain.ts'

export type ClaimTypeV04 = 'fact' | 'forecast' | 'viewpoint' | 'trend' | 'risk' | 'assumption' | 'thesis' | 'catalyst'
export type ClaimRefV04 = `claim:${string}`
export type SourceRefV04 = `source:${string}`
export type RawRefV04 = `raw-sha256-${string}`
export type EntityRefV04 = `entity:${string}`
export type RelationRefV04 = `relation:${string}`
export type EventRefV04 = `event:${string}`
export type ObservationRefV04 = `observation:${string}`
export type ThesisRefV04 = `thesis:${string}`
export type ReasoningEdgeRefV04 = `reasoning-edge:${string}`
export type CanonicalKnowledgeRefV04 = `theme-group:${string}` | EntityRefV04 | RelationRefV04 | ClaimRefV04 | SourceRefV04 | `module:${string}` | RawRefV04 | EventRefV04 | ObservationRefV04 | ThesisRefV04 | ReasoningEdgeRefV04
export type ClaimStructuredValueV04 = ClaimStructuredValueV03 & { period?: string | null; fiscalPeriod?: string | null; semanticKey?: string | null }

export interface ExternalIdentifierV04 {
  namespace: string
  value: string
  validFrom?: string | null
  validUntil?: string | null
  sourceRef?: SourceRefV04 | null
  confidence?: number | null
}

export interface TemporalV04 {
  occurredAt?: string | null
  start?: string | null
  end?: string | null
  announcedAt?: string | null
  period?: string | null
  fiscalPeriod?: string | null
  asOf?: string | null
  recordedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  supersededAt?: string | null
}

export interface SourceRightsV04 {
  accessScope: 'public' | 'authenticated' | 'restricted' | 'unknown'
  providerTermsKnown: boolean
  redistributionAllowed?: boolean | 'conditional' | null
  retentionAllowed?: boolean | 'conditional' | null
  aiProcessingAllowed?: boolean | 'conditional' | null
  derivativeKnowledgeAllowed?: boolean | 'conditional' | null
  expiresAt?: string | null
  entitlementRef?: string | null
  policyBasis?: string | null
}

export interface SourceUsagePolicyV04 {
  mode: 'personal_noncommercial_research'
  retainRaw: boolean
  allowAiProcessing: boolean
  allowDerivedKnowledge: boolean
  redistributionAllowed: false
}

export interface SourceAcquisitionV04 {
  method: 'official' | 'structured_data' | 'news_search' | 'rss' | 'web_fetch' | 'manual' | 'unknown'
  discoveredAt?: string | null
  fetchedAt?: string | null
  extractor?: string | null
}

export interface KnowledgeClaimV04 extends Omit<KnowledgeClaimV03, 'claimType' | 'sourceRefs' | 'provenance' | 'confidence' | 'supersedes' | 'supersededBy' | 'structuredValue'> {
  claimType: ClaimTypeV04
  structuredValue?: ClaimStructuredValueV04 | null
  sourceRefs: SourceRefV04[]
  provenance?: Array<{ sourceRef: SourceRefV04; rawRef: RawRefV04; locator: string | null; chunkRef: string | null }>
  confidence?: number | null
  probability?: number | null
  supportsClaimRefs?: ClaimRefV04[]
  dependsOnClaimRefs?: ClaimRefV04[]
  contradictsClaimRefs?: ClaimRefV04[]
  supersedes?: ClaimRefV04[]
  supersededBy?: ClaimRefV04[]
}

export interface KnowledgeSourceV04 extends Omit<KnowledgeSourceV03, 'sourceType' | 'sourceReliability' | 'rawRefs' | 'metadata'> {
  sourceType: SourceTypeV03
  sourceReliability?: SourceReliabilityV03
  rawRefs?: RawRefV04[]
  provider?: string | null
  canonicalUrl?: string | null
  retrievedAt?: string | null
  contentHash?: string | null
  acquisition?: SourceAcquisitionV04 | null
  rights: SourceRightsV04
  usagePolicy: SourceUsagePolicyV04
  metadata?: KnowledgeMetadataV03
}

type EntityWithExternalIdentifiersV04<T extends KnowledgeEntityV03> = Omit<T, 'externalIds'> & {
  externalIds?: KnowledgeMetadataV03
  externalIdentifiers?: ExternalIdentifierV04[]
}

export type KnowledgeInvestmentThemeV04 = EntityWithExternalIdentifiersV04<InvestmentThemeV03>
export type KnowledgeIndustryV04 = EntityWithExternalIdentifiersV04<IndustryV03>
export type KnowledgeCompanyV04 = EntityWithExternalIdentifiersV04<CompanyV03>
export type KnowledgeProductV04 = EntityWithExternalIdentifiersV04<ProductV03>
export type KnowledgeTechnologyV04 = EntityWithExternalIdentifiersV04<TechnologyV03>

export interface KnowledgePersonV04 extends Omit<KnowledgeEntityV03, 'type' | 'externalIds'> {
  type: 'person'
  externalIds?: KnowledgeMetadataV03
  externalIdentifiers?: ExternalIdentifierV04[]
}

export interface KnowledgeInstitutionV04 extends Omit<KnowledgeEntityV03, 'type' | 'externalIds'> {
  type: 'institution'
  externalIds?: KnowledgeMetadataV03
  externalIdentifiers?: ExternalIdentifierV04[]
  institutionType?: 'broker' | 'investment_bank' | 'fund' | 'regulator' | 'industry_association' | 'research_institution' | 'media_organization' | 'other'
}

export interface KnowledgeSecurityV04 extends Omit<KnowledgeEntityV03, 'type' | 'externalIds'> {
  type: 'security'
  externalIds?: KnowledgeMetadataV03
  externalIdentifiers?: ExternalIdentifierV04[]
  ticker: string
  exchange: string
  securityType: 'equity' | 'bond' | 'fund' | 'adr' | 'other'
  currency?: string | null
}

export type KnowledgeEntityV04 = KnowledgeInvestmentThemeV04 | KnowledgeIndustryV04 | KnowledgeCompanyV04 | KnowledgeProductV04 | KnowledgeTechnologyV04 | KnowledgePersonV04 | KnowledgeInstitutionV04 | KnowledgeSecurityV04
export type KnowledgeRelationV04 = KnowledgeRelationV03
export type KnowledgeThemeGroupV04 = KnowledgeThemeGroupV03
export type KnowledgeModuleV04 = KnowledgeModuleV03

export type EventTypeV04 = 'earnings_release' | 'earnings_call' | 'investor_relations_activity' | 'guidance_update' | 'product_launch' | 'capacity_expansion' | 'regulatory_action' | 'management_change' | 'merger_acquisition' | 'financing' | 'contract_award' | 'policy_change' | 'other'
export interface KnowledgeEventV04 {
  id: EventRefV04
  eventType: EventTypeV04
  title: string
  subjectRefs: EntityRefV04[]
  participantRefs?: EntityRefV04[]
  temporal: TemporalV04
  sourceRefs: SourceRefV04[]
  externalIdentifiers?: ExternalIdentifierV04[]
  attributes?: KnowledgeMetadataV03
  lifecycle: KnowledgeEntityV04['lifecycle']
  createdAt?: string | null
  updatedAt?: string | null
}

export type ObservationTypeV04 = 'metric' | 'estimate' | 'consensus'
export interface KnowledgeMetricObservationV04 {
  id: ObservationRefV04
  observationType: 'metric'
  subjectRef: EntityRefV04
  metricRef: string
  value: string | number | boolean | null
  unit?: string | null
  period?: string | null
  dimensions?: KnowledgeMetadataV03
  sourceRef: SourceRefV04
  provenance?: Array<{ sourceRef: SourceRefV04; rawRef: RawRefV04; locator?: string | null; chunkRef?: string | null }>
  observedAt?: string | null
  reportedAt?: string | null
  asOf?: string | null
  recordedAt?: string | null
  lifecycle: KnowledgeEntityV04['lifecycle']
}
export interface KnowledgeEstimateObservationV04 {
  id: ObservationRefV04
  observationType: 'estimate'
  subjectRef: EntityRefV04
  metricRef: string
  fiscalPeriod: string
  estimateValue: string | number | boolean | null
  unit?: string | null
  currency?: string | null
  institutionRef: EntityRefV04
  analystRef?: EntityRefV04 | null
  publishedAt: string
  estimateHorizon?: string | null
  revisionOf?: ObservationRefV04 | null
  sourceRef: SourceRefV04
  provenance?: Array<{ sourceRef: SourceRefV04; rawRef: RawRefV04; locator?: string | null; chunkRef?: string | null }>
  recordedAt?: string | null
  lifecycle: KnowledgeEntityV04['lifecycle']
}
export interface KnowledgeConsensusObservationV04 {
  id: ObservationRefV04
  observationType: 'consensus'
  subjectRef: EntityRefV04
  metricRef: string
  fiscalPeriod: string
  asOf: string
  mean: number
  median?: number | null
  high?: number | null
  low?: number | null
  count: number
  dispersion?: number | null
  contributingObservationRefs: ObservationRefV04[]
  sourceRef?: SourceRefV04 | null
  provenance?: Array<{ sourceRef: SourceRefV04; rawRef: RawRefV04; locator?: string | null; chunkRef?: string | null }>
  recordedAt?: string | null
  lifecycle: KnowledgeEntityV04['lifecycle']
}
export type KnowledgeObservationV04 = KnowledgeMetricObservationV04 | KnowledgeEstimateObservationV04 | KnowledgeConsensusObservationV04

export type ThesisStatusV04 = 'active' | 'strengthening' | 'weakening' | 'challenged' | 'invalidated' | 'archived'
export type KillCriterionOperatorV04 = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
export interface NumericThresholdDefinitionV1 {
  metricRef: string
  operator: KillCriterionOperatorV04
  threshold: number
  unit: string
  period: string
  deadline?: string
}
export interface KillCriterionHumanRuleOriginV04 { kind: 'human_rule' }
export interface KillCriterionSourceOriginV04 {
  kind: 'source_derived'
  sourceRef: SourceRefV04
  rawRef: RawRefV04
  locator: string
  publishedAt: string
}
export type KillCriterionOriginV04 = KillCriterionHumanRuleOriginV04 | KillCriterionSourceOriginV04
export interface KillCriterionAuthorityV04 {
  workflowRunId: string
  confirmedAt: string
  origin: KillCriterionOriginV04
}
export interface KillCriterionV04 {
  conditionId: string
  revision: number
  state: 'active' | 'superseded'
  type: string
  definitionVersion: number
  /** Known V1 definitions are typed; future definitions remain bounded JSON. */
  definition: NumericThresholdDefinitionV1 | Record<string, unknown>
  targetClaimRefs: ClaimRefV04[]
  effectiveAt: string
  definitionHash: string
  authority: KillCriterionAuthorityV04
}
export interface KnowledgeThesisV04 {
  id: ThesisRefV04
  subjectRefs: EntityRefV04[]
  title: string
  statement: string
  status: ThesisStatusV04
  createdAt: string
  lastReviewedAt?: string | null
  lifecycle: KnowledgeEntityV04['lifecycle']
  updatedAt?: string | null
  killCriteria?: KillCriterionV04[]
}

export type ReasoningEdgeTypeV04 = 'supports' | 'contradicts' | 'depends_on' | 'qualifies' | 'invalidates' | 'challenges'
export interface KnowledgeReasoningEdgeV04 {
  id: ReasoningEdgeRefV04
  type: ReasoningEdgeTypeV04
  sourceRef: ObservationRefV04 | ClaimRefV04
  targetRef: ClaimRefV04 | ThesisRefV04
  sourceRefs?: SourceRefV04[]
  confidence?: number | null
  asOf?: string | null
  lifecycle: KnowledgeEntityV04['lifecycle']
  createdAt?: string | null
  updatedAt?: string | null
}

export type KnowledgeAssetV04 = KnowledgeThemeGroupV04 | KnowledgeEntityV04 | KnowledgeRelationV04 | KnowledgeClaimV04 | KnowledgeSourceV04 | KnowledgeModuleV04 | KnowledgeEventV04 | KnowledgeObservationV04 | KnowledgeThesisV04 | KnowledgeReasoningEdgeV04
export type KnowledgeAssetKindV04 = 'theme_group' | 'entity' | 'relation' | 'claim' | 'source' | 'module' | 'event' | 'observation' | 'thesis' | 'reasoning_edge'
