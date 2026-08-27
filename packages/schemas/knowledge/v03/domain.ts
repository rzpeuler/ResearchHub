import { KNOWLEDGE_SCHEMA_V03 } from './executable-schema.ts'

export type LifecycleStatusV03 = (typeof KNOWLEDGE_SCHEMA_V03.lifecycle.values)[number]
export type EntityTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.entity.types)[number]
export type RelationTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.types)[number]
export type DirectionalityV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.directionalityValues)[number]
export type ClaimTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.claim.types)[number]
export type ClaimTemporalScopeTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.claim.temporalScopeTypes)[number]
export type ClaimComparatorV03 = (typeof KNOWLEDGE_SCHEMA_V03.claim.comparators)[number]
export type SourceTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.source.types)[number]
export type SourceReliabilityV03 = (typeof KNOWLEDGE_SCHEMA_V03.source.reliabilities)[number]
export type ModuleTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.module.types)[number]
export type ThemeExposureImportanceV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.theme_exposure.attributes.importance)[number]
export type ThemeExposureChainPositionV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.theme_exposure.attributes.chainPosition)[number]
export type BusinessExposureBasisV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure.attributes.exposureBasis)[number]
export type BusinessExposureRealizationStageV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure.attributes.realizationStage)[number]
export type BusinessExposureMaterialityV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure.attributes.materiality)[number]
export type OwnershipControlTypeV03 = (typeof KNOWLEDGE_SCHEMA_V03.relation.definitions.owns_stake_in.attributes.controlType)[number]

export type ThemeGroupRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.themeGroup}${string}`
export type EntityRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.entity}${string}`
export type RelationRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.relation}${string}`
export type ClaimRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.claim}${string}`
export type SourceRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.source}${string}`
export type ModuleRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.module}${string}`
export type RawRefV03 = `${typeof KNOWLEDGE_SCHEMA_V03.rawIdentity.namespace}${string}`

export type CanonicalKnowledgeRefV03 =
  | ThemeGroupRefV03
  | EntityRefV03
  | RelationRefV03
  | ClaimRefV03
  | SourceRefV03
  | ModuleRefV03
  | RawRefV03

export type KnowledgeJsonValueV03 =
  | string
  | number
  | boolean
  | null
  | KnowledgeJsonValueV03[]
  | { [key: string]: KnowledgeJsonValueV03 }

export type KnowledgeMetadataV03 = { [key: string]: KnowledgeJsonValueV03 }

export interface LifecycleV03 {
  status: LifecycleStatusV03
  validFrom?: string | null
  validUntil?: string | null
}

export interface KnowledgeThemeGroupV03 {
  id: ThemeGroupRefV03
  name: string
  aliases: string[]
  description?: string | null
  sortOrder?: number | null
  lifecycle: LifecycleV03
  metadata?: KnowledgeMetadataV03
}

interface KnowledgeEntityBaseV03<TType extends EntityTypeV03> {
  id: EntityRefV03
  type: TType
  name: string
  aliases?: string[]
  description?: string | null
  externalIds?: KnowledgeMetadataV03
  taxonomyRefs?: string[]
  metadata?: KnowledgeMetadataV03
  lifecycle: LifecycleV03
  createdAt?: string | null
  updatedAt?: string | null
}

export interface InvestmentThemeV03 extends KnowledgeEntityBaseV03<'investment_theme'> {
  themeGroupRef: ThemeGroupRefV03
  definition?: string | null
  inclusionCriteria?: string[]
  exclusionCriteria?: string[]
}

export interface IndustryV03 extends KnowledgeEntityBaseV03<'industry'> {}

export interface CompanyV03 extends KnowledgeEntityBaseV03<'company'> {
  ticker?: string | null
  exchange?: string | null
  legalName?: string | null
}

export interface ProductV03 extends KnowledgeEntityBaseV03<'product'> {}

export interface TechnologyV03 extends KnowledgeEntityBaseV03<'technology'> {}

export type KnowledgeEntityV03 =
  | InvestmentThemeV03
  | IndustryV03
  | CompanyV03
  | ProductV03
  | TechnologyV03

export interface ThemeExposureAttributesV03 {
  importance?: ThemeExposureImportanceV03
  chainPosition?: ThemeExposureChainPositionV03
}

export interface FinancialContributionV03 {
  period?: string | null
  revenueAmount?: number | null
  revenueShare?: number | null
  profitAmount?: number | null
  profitShare?: number | null
  currency?: string | null
  separatelyReported?: boolean | null
}

export interface BusinessExposureAttributesV03 {
  exposureBasis?: BusinessExposureBasisV03
  realizationStage?: BusinessExposureRealizationStageV03
  materiality?: BusinessExposureMaterialityV03
  financialContribution?: FinancialContributionV03
}

export interface OwnershipAttributesV03 {
  ownershipPct?: number | null
  controlType?: OwnershipControlTypeV03
}

interface KnowledgeRelationBaseV03<TType extends RelationTypeV03> {
  id: RelationRefV03
  type: TType
  sourceRef: EntityRefV03
  targetRef: EntityRefV03
  contextRefs?: CanonicalKnowledgeRefV03[]
  supportingClaimRefs?: ClaimRefV03[]
  sourceRefs?: SourceRefV03[]
  confidence?: number | null
  asOf?: string | null
  lifecycle: LifecycleV03
  createdAt?: string | null
  updatedAt?: string | null
}

export interface ThemeExposureRelationV03 extends KnowledgeRelationBaseV03<'theme_exposure'> {
  attributes?: ThemeExposureAttributesV03
}

export interface BusinessExposureRelationV03 extends KnowledgeRelationBaseV03<'business_exposure'> {
  attributes?: BusinessExposureAttributesV03
}

export interface OwnsStakeInRelationV03 extends KnowledgeRelationBaseV03<'owns_stake_in'> {
  attributes?: OwnershipAttributesV03
}

type RelationWithoutCustomAttributesV03<TType extends Exclude<RelationTypeV03, 'theme_exposure' | 'business_exposure' | 'owns_stake_in'>> =
  KnowledgeRelationBaseV03<TType> & { attributes?: never }

export type KnowledgeRelationV03 =
  | ThemeExposureRelationV03
  | BusinessExposureRelationV03
  | OwnsStakeInRelationV03
  | RelationWithoutCustomAttributesV03<'upstream_of'>
  | RelationWithoutCustomAttributesV03<'supplier_of'>
  | RelationWithoutCustomAttributesV03<'competes_with'>
  | RelationWithoutCustomAttributesV03<'offers_product'>
  | RelationWithoutCustomAttributesV03<'belongs_to_industry'>
  | RelationWithoutCustomAttributesV03<'component_of'>
  | RelationWithoutCustomAttributesV03<'develops_technology'>
  | RelationWithoutCustomAttributesV03<'uses_technology'>
  | RelationWithoutCustomAttributesV03<'applied_in'>
  | RelationWithoutCustomAttributesV03<'depends_on'>
  | RelationWithoutCustomAttributesV03<'substitutes_for'>

export interface ClaimTemporalV03 {
  asOf: string | null
  scope: {
    type: ClaimTemporalScopeTypeV03
    start: string | null
    end: string | null
    label: string | null
  }
}

export interface ClaimStructuredValueV03 {
  metric: string
  value: string | number | boolean | null
  unit: string | null
  comparator: ClaimComparatorV03 | null
}

export interface ClaimProvenanceV03 {
  sourceRef: SourceRefV03
  rawRef: RawRefV03
  locator: string | null
  chunkRef: string | null
}

export interface KnowledgeClaimV03 {
  id: ClaimRefV03
  claimType: ClaimTypeV03
  statement: string
  subjectRefs: Array<EntityRefV03 | RelationRefV03>
  primarySubjectRef?: EntityRefV03 | RelationRefV03 | null
  temporal?: ClaimTemporalV03
  structuredValue?: ClaimStructuredValueV03
  sourceRefs: SourceRefV03[]
  provenance?: ClaimProvenanceV03[]
  confidence?: number | null
  lifecycle: LifecycleV03
  supersedes?: ClaimRefV03[]
  supersededBy?: ClaimRefV03[]
  createdAt?: string | null
  updatedAt?: string | null
}

export interface KnowledgeSourceV03 {
  id: SourceRefV03
  title: string
  sourceType: SourceTypeV03
  /** Legacy v0.2-compatible source field retained as an explicitly declared optional field. */
  type?: string | null
  publisher?: string | null
  institution?: string | null
  author?: string | null
  publishedAt?: string | null
  url?: string | null
  /** Legacy v0.2-compatible quality field retained as an explicitly declared optional field. */
  quality?: KnowledgeJsonValueV03
  sourceReliability?: SourceReliabilityV03
  rawRefs?: RawRefV03[]
  metadata?: KnowledgeMetadataV03
  lifecycle?: LifecycleV03
  createdAt?: string | null
  updatedAt?: string | null
}

export interface KnowledgeModuleV03 {
  id: ModuleRefV03
  type: ModuleTypeV03
  /** Existing v0.2-compatible module shape; targetEntity conversion belongs to Stage B. */
  targetEntity?: EntityRefV03 | null
  sourceRefs?: SourceRefV03[]
  schemaId?: string | null
  columns?: KnowledgeJsonValueV03[]
  rows?: KnowledgeJsonValueV03[]
}
