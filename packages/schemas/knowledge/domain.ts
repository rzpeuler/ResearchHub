export const ENTITY_TYPES = ['industry', 'segment', 'company', 'product', 'technology'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const INTELLIGENCE_TYPES = ['fact', 'forecast', 'viewpoint', 'trend', 'risk'] as const
export type IntelligenceType = (typeof INTELLIGENCE_TYPES)[number]

export const LIFECYCLE_STATUSES = ['active', 'expired', 'superseded', 'archived'] as const
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

export const RELATION_TYPES = [
  'contains',
  'upstream_of',
  'downstream_of',
  'depends_on',
  'substitute_for',
  'operates_in',
  'supplier_of',
  'customer_of',
  'competes_with',
  'partner_of',
  'owns_stake_in',
  'invested_in',
] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export const MODULE_TYPES = ['comparison', 'roadmap', 'market', 'competition', 'capacity', 'supply-chain'] as const
export type ModuleType = (typeof MODULE_TYPES)[number]

export const SOURCE_TYPES = [
  'official_disclosure',
  'company_official',
  'sell_side_research',
  'industry_database',
  'professional_media',
  'general_media',
  'community',
  'unknown',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SOURCE_RELIABILITIES = ['high', 'medium', 'low', 'unknown'] as const
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number]

export type KnowledgeScalar = string | number | boolean | null
export type KnowledgeValue = KnowledgeScalar | KnowledgeValue[] | { [key: string]: KnowledgeValue }

export interface Lifecycle {
  status: LifecycleStatus | string
  validFrom?: string
  validUntil?: string
}

export interface KnowledgeCommonMetadata {
  createdAt?: string
  updatedAt?: string
  sourceRefs?: string[]
  confidence?: number | Record<string, KnowledgeValue> | null
  lifecycle?: Lifecycle | Record<string, KnowledgeValue> | null
  supersedes?: string[]
  supersededBy?: string[]
}

export interface KnowledgeEntity {
  id: string
  type: EntityType | string
  name: string
  description?: string
  tags?: string[]
  taxonomyRefs?: string[]
  metadata?: Record<string, KnowledgeValue>
  [key: string]: unknown
}

export interface KnowledgeRelation {
  id: string
  type: RelationType | string
  source: string
  target: string
  attributes?: Record<string, KnowledgeValue>
  confidence?: number
  sourceRefs?: string[]
  lifecycle?: Lifecycle
  [key: string]: unknown
}

export interface KnowledgeIntelligence {
  id: string
  type: IntelligenceType | string
  entityRefs: string[]
  sourceRefs?: string[]
  confidence?: number
  lifecycle?: Lifecycle
  [key: string]: unknown
}

export interface KnowledgeModule {
  id: string
  type: ModuleType | string
  targetEntity?: string
  sourceRefs?: string[]
  schemaId?: string
  columns?: unknown[]
  rows?: unknown[]
  [key: string]: unknown
}

export interface KnowledgeSource {
  id: string
  type: string
  title: string
  publisher: string | null
  institution?: string | null
  author?: string | null
  publishedAt: string | null
  url?: string | null
  sourceType?: SourceType | string
  quality?: string | number | Record<string, KnowledgeValue> | null
  sourceReliability?: SourceReliability | string
  rawRefs?: string[]
  metadata?: Record<string, KnowledgeValue> | null
  lifecycle?: Lifecycle | Record<string, KnowledgeValue> | null
  [key: string]: unknown
}
