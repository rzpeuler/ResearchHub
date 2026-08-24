export const RELATION_TYPES = [
  'contains',
  'upstream_of',
  'downstream_of',
  'operates_in',
  'owns_stake_in',
  'project_partner_of',
  'project_investor_of',
] as const

export type RelationType = (typeof RELATION_TYPES)[number]
export type EntityType = 'industry' | 'segment' | 'company'
export type ListingStatus = 'listed' | 'private'

export interface CompanyProfile {
  productTypes: string[]
  customerSegments: string[]
  technologyMoats: string[]
  customerCertifications: string[]
}

export interface MarketForecastPoint {
  year: string
  value: number
  unit: string
}

export interface ProductComparison {
  product: string
  useCase: string
  differentiator: string
}

export interface IndustryImage {
  src: string
  caption: string
  source?: string
}

export interface IndustryKnowledge {
  description?: string
  marketForecast?: MarketForecastPoint[]
  productComparison?: ProductComparison[]
  glossary?: { term: string; definition: string }[]
  images?: IndustryImage[]
}

export interface CoreView {
  bullish?: string[]
  bearish?: string[]
  contradictions?: string[]
  logic?: string[]
}

export interface Entity {
  id: string
  type: EntityType
  name: string
  marketSize?: number
  marketSizeUnit?: 'mock-index'
  listingStatus?: ListingStatus
  ticker?: string
  exchange?: string
  financials?: {
    totalRevenue: number
    currency: string
    period: string
  }
  profile?: CompanyProfile
  knowledge?: IndustryKnowledge
  coreView?: CoreView
}

export interface Relation {
  id: string
  fromEntityId: string
  toEntityId: string
  type: RelationType
  segmentRevenue?: number
  ownershipPercent?: number
  projectName?: string
  period?: string
  segmentEntityId?: string
}

export interface Event {
  id: string
  title: string
  occurredAt: string
  startedAt?: string
  endedAt?: string
  summary: string
  affectedEntityIds: string[]
  impact: 'positive' | 'negative' | 'mixed' | 'neutral'
}

export interface Research {
  id: string
  title: string
  type: 'industry' | 'company' | 'technology'
  summary: string
  publishedAt: string
  entityIds: string[]
  url?: string
  documentPath?: string
}

export interface IndustryGraphDataset {
  entities: Entity[]
  relations: Relation[]
  events: Event[]
  research: Research[]
}

export interface MarketShareEntry {
  company: Entity
  relation: Relation
  segmentRevenue: number
  marketShare: number
  totalRevenue?: number
}

export interface ListedCompanyAssociation {
  company: Entity
  relation: Relation
}

export function getEntity(dataset: IndustryGraphDataset, entityId: string): Entity | undefined {
  return dataset.entities.find((entity) => entity.id === entityId)
}

export function getRelationsFrom(
  dataset: IndustryGraphDataset,
  entityId: string,
  type?: RelationType,
): Relation[] {
  return dataset.relations.filter(
    (relation) => relation.fromEntityId === entityId && (type === undefined || relation.type === type),
  )
}

export function getRelationsTo(
  dataset: IndustryGraphDataset,
  entityId: string,
  type?: RelationType,
): Relation[] {
  return dataset.relations.filter(
    (relation) => relation.toEntityId === entityId && (type === undefined || relation.type === type),
  )
}

export function getContainedEntities(dataset: IndustryGraphDataset, entityId: string): Entity[] {
  return getRelationsFrom(dataset, entityId, 'contains')
    .map((relation) => getEntity(dataset, relation.toEntityId))
    .filter((entity): entity is Entity => entity !== undefined)
}

export function getNestedPath(dataset: IndustryGraphDataset, entityId: string): Entity[] {
  const path: Entity[] = []
  let current = getEntity(dataset, entityId)
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    path.unshift(current)
    visited.add(current.id)
    const parentRelation = dataset.relations.find(
      (relation) => relation.type === 'contains' && relation.toEntityId === current?.id,
    )
    current = parentRelation ? getEntity(dataset, parentRelation.fromEntityId) : undefined
  }

  return path
}

export function getCompaniesForSegment(dataset: IndustryGraphDataset, segmentId: string): Entity[] {
  return getRelationsTo(dataset, segmentId, 'operates_in')
    .map((relation) => getEntity(dataset, relation.fromEntityId))
    .filter((entity): entity is Entity => entity?.type === 'company')
}

export function calculateMarketShare(dataset: IndustryGraphDataset, segmentId: string): MarketShareEntry[] {
  const entries: MarketShareEntry[] = getRelationsTo(dataset, segmentId, 'operates_in').flatMap((relation) => {
    const company = getEntity(dataset, relation.fromEntityId)
    if (!company || relation.segmentRevenue === undefined) return []
    return [{
      company,
      relation,
      segmentRevenue: relation.segmentRevenue,
      marketShare: 0,
      totalRevenue: company.financials?.totalRevenue,
    }]
  })

  const totalSegmentRevenue = entries.reduce((sum, entry) => sum + entry.segmentRevenue, 0)
  return entries
    .map((entry) => ({
      ...entry,
      marketShare: totalSegmentRevenue === 0 ? 0 : entry.segmentRevenue / totalSegmentRevenue,
    }))
    .sort((left, right) => right.segmentRevenue - left.segmentRevenue)
}

export function getResearchForEntity(dataset: IndustryGraphDataset, entityId: string): Research[] {
  return dataset.research.filter((item) => item.entityIds.includes(entityId))
}

export function getEventsForEntity(dataset: IndustryGraphDataset, entityId: string): Event[] {
  return dataset.events
    .filter((event) => event.affectedEntityIds.includes(entityId))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

export function getListedCompanyAssociations(
  dataset: IndustryGraphDataset,
  companyId: string,
  segmentId?: string,
): ListedCompanyAssociation[] {
  return dataset.relations
    .filter((relation) =>
      ['owns_stake_in', 'project_partner_of', 'project_investor_of'].includes(relation.type) &&
      (relation.fromEntityId === companyId || relation.toEntityId === companyId) &&
      (segmentId === undefined || relation.segmentEntityId === segmentId),
    )
    .map((relation) => {
      const linkedEntityId = relation.fromEntityId === companyId ? relation.toEntityId : relation.fromEntityId
      const company = getEntity(dataset, linkedEntityId)
      return company?.listingStatus === 'listed' ? { company, relation } : undefined
    })
    .filter((association): association is ListedCompanyAssociation => association !== undefined)
}

export function validateGraphDataset(dataset: IndustryGraphDataset): string[] {
  const errors: string[] = []
  const entityIds = new Set(dataset.entities.map((entity) => entity.id))

  for (const relation of dataset.relations) {
    if (!entityIds.has(relation.fromEntityId) || !entityIds.has(relation.toEntityId)) {
      errors.push(`Relation ${relation.id} references a missing entity`)
    }
  }

  for (const event of dataset.events) {
    for (const entityId of event.affectedEntityIds) {
      if (!entityIds.has(entityId)) errors.push(`Event ${event.id} references a missing entity`)
    }
  }

  for (const item of dataset.research) {
    for (const entityId of item.entityIds) {
      if (!entityIds.has(entityId)) errors.push(`Research ${item.id} references a missing entity`)
    }
  }

  return errors
}
