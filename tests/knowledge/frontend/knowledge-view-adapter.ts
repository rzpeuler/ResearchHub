import { readFile } from 'node:fs/promises'
import { parseYaml } from '../../../packages/skills/knowledge-access/yaml.ts'
import type {
  KnowledgeEntity,
  KnowledgeIntelligence,
  KnowledgeModule,
  KnowledgeRelation,
  KnowledgeSource,
} from '../../../packages/skills/knowledge-access/types.ts'
import { KnowledgeAccessSkill } from '../../../packages/skills/knowledge-access/index.ts'

const SUPPLY_CHAIN_RELATIONS = new Set(['contains', 'upstream_of', 'downstream_of', 'depends_on'])

type TaxonomyItem = {
  id: string
  name: string
  graphRefs?: string[]
}

type TaxonomyAsset = {
  name?: string
  items?: TaxonomyItem[]
}

type ViewAsset = {
  sections?: string[]
}

export interface ProjectionNode {
  id: string
  type: string
  name: string
  hasChildren: boolean
}

export interface ProjectionRelation {
  id: string
  type: string
  source: string
  target: string
}

export interface IndustryDirectoryGraph {
  id: string
  name: string
}

export interface IndustryDirectoryItem {
  id: string
  name: string
  graphs: IndustryDirectoryGraph[]
}

export interface IndustryDirectoryProjection {
  classification: string
  industries: IndustryDirectoryItem[]
}

export interface GraphProjection {
  root: ProjectionNode
  children: ProjectionNode[]
  relations: ProjectionRelation[]
}

export interface CompanyScaleEntry {
  company: KnowledgeEntity
  revenue: number
  period: string
  unit: string
  sourceRefs: string[]
}

export interface CompanyScaleProjection {
  entityId: string
  entries: CompanyScaleEntry[]
}

export interface EventProjection {
  id: string
  occurredAt: string
  statement: string
  impact?: string
  affectedEntityRefs: string[]
  sourceRefs: string[]
}

export interface EntityDetailProjection {
  entity: KnowledgeEntity
  children: ProjectionNode[]
  relatedCompanies: Array<{ company: KnowledgeEntity; relation: ProjectionRelation }>
  facts: KnowledgeIntelligence[]
  forecasts: KnowledgeIntelligence[]
  viewpoints: KnowledgeIntelligence[]
  trends: KnowledgeIntelligence[]
  risks: KnowledgeIntelligence[]
  modules: KnowledgeModule[]
  events: EventProjection[]
  sources: KnowledgeSource[]
  companyScale?: CompanyScaleProjection
  viewSections: string[]
}

export interface KnowledgeViewAdapterOptions {
  access: KnowledgeAccessSkill
  taxonomyPath: string
  viewPath: string
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function projectionNode(entity: KnowledgeEntity, hasChildren: boolean): ProjectionNode {
  return { id: entity.id, type: entity.type, name: entity.name, hasChildren }
}

function isActiveFact(item: KnowledgeIntelligence): boolean {
  return asRecord(item.lifecycle).status === 'active'
}

function selectTotalRevenueFact(facts: KnowledgeIntelligence[]): KnowledgeIntelligence | undefined {
  return facts
    .filter((item) => {
      const value = item.value
      const period = item.period
      const unit = item.unit
      return item.type === 'fact'
        && item.category === 'financial_metric'
        && item.metric === 'total-revenue'
        && isActiveFact(item)
        && typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && typeof period === 'string'
        && period.trim().length > 0
        && typeof unit === 'string'
        && unit.trim().length > 0
    })
    .sort((left, right) => {
      const leftConfidence = typeof left.confidence === 'number' ? left.confidence : -Infinity
      const rightConfidence = typeof right.confidence === 'number' ? right.confidence : -Infinity
      return rightConfidence - leftConfidence
        || String(right.period).localeCompare(String(left.period))
        || left.id.localeCompare(right.id)
    })[0]
}

export function buildCompanyScaleProjection(
  entityId: string,
  relatedCompanies: Array<{ company: KnowledgeEntity; relation: KnowledgeRelation }>,
  getCompanyFacts: (companyId: string) => KnowledgeIntelligence[],
): CompanyScaleProjection | undefined {
  const entries = relatedCompanies.flatMap(({ company, relation }) => {
    if (relation.type !== 'operates_in') return []
    const fact = selectTotalRevenueFact(getCompanyFacts(company.id))
    if (!fact) return []
    return [{
      company,
      revenue: fact.value as number,
      period: fact.period as string,
      unit: fact.unit as string,
      sourceRefs: asStringArray(fact.sourceRefs),
    }]
  }).sort((left, right) => right.revenue - left.revenue || left.company.id.localeCompare(right.company.id))
  return entries.length ? { entityId, entries } : undefined
}

export class KnowledgeViewAdapter {
  private constructor(
    private readonly access: KnowledgeAccessSkill,
    private readonly taxonomy: TaxonomyAsset,
    private readonly view: ViewAsset,
  ) {}

  static async create(options: KnowledgeViewAdapterOptions): Promise<KnowledgeViewAdapter> {
    const [taxonomyText, viewText] = await Promise.all([
      readFile(options.taxonomyPath, 'utf8'),
      readFile(options.viewPath, 'utf8'),
    ])
    const taxonomy = parseYaml(taxonomyText, options.taxonomyPath)
    const view = parseYaml(viewText, options.viewPath)
    return new KnowledgeViewAdapter(
      options.access,
      taxonomy && typeof taxonomy === 'object' ? taxonomy as TaxonomyAsset : {},
      view && typeof view === 'object' ? view as ViewAsset : {},
    )
  }

  getIndustryDirectoryProjection(): IndustryDirectoryProjection {
    const industries = (this.taxonomy.items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      graphs: (item.graphRefs ?? []).flatMap((graphId) => {
        try {
          const graph = this.access.getEntity(graphId)
          return [{ id: graph.id, name: graph.name }]
        } catch {
          return []
        }
      }),
    }))
    return {
      classification: this.taxonomy.name ?? 'SW Level-1 Industry',
      industries,
    }
  }

  getGraphProjection(entityId: string): GraphProjection {
    const rootEntity = this.access.getEntity(entityId)
    const relations = this.access.getRelations(entityId)
    const childIds = relations
      .filter((relation) => relation.source === entityId && SUPPLY_CHAIN_RELATIONS.has(relation.type))
      .map((relation) => relation.target)
    const children = [...new Set(childIds)].flatMap((childId) => {
      try {
        const child = this.access.getEntity(childId)
        return [projectionNode(child, this.access.getSupplyChain(child.id, 1).length > 0)]
      } catch {
        return []
      }
    }).sort((left, right) => left.id.localeCompare(right.id))
    return {
      root: projectionNode(rootEntity, children.length > 0),
      children,
      relations: relations.map((relation) => this.projectRelation(relation)),
    }
  }

  getEntityDetailProjection(entityId: string): EntityDetailProjection {
    const entity = this.access.getEntity(entityId)
    const intelligence = this.getRelevantIntelligence(entityId)
    const facts = intelligence.filter((item) => item.type === 'fact')
    const relatedCompanyResults = this.access.getRelatedCompanies(entityId)
    const relatedCompanies = relatedCompanyResults.map(({ company, relation }) => ({
      company,
      relation: this.projectRelation(relation),
    }))
    const modules = this.access.getModules(entityId)
    const children = this.getGraphProjection(entityId).children
    const sources = this.collectSources(entityId, [...intelligence, ...modules, ...relatedCompanies.map(({ company }) => company)])
    const events = facts
      .filter((item) => item.category === 'event')
      .map((item) => ({
        id: item.id,
        occurredAt: String(item.occurredAt ?? ''),
        statement: String(item.statement ?? ''),
        impact: typeof item.impact === 'string' ? item.impact : undefined,
        affectedEntityRefs: asStringArray(item.affectedEntityRefs),
        sourceRefs: asStringArray(item.sourceRefs),
      }))
      .filter((event) => event.occurredAt && event.statement)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    return {
      entity,
      children,
      relatedCompanies,
      facts,
      forecasts: intelligence.filter((item) => item.type === 'forecast'),
      viewpoints: intelligence.filter((item) => item.type === 'viewpoint'),
      trends: intelligence.filter((item) => item.type === 'trend'),
      risks: intelligence.filter((item) => item.type === 'risk'),
      modules,
      events,
      sources,
      companyScale: buildCompanyScaleProjection(entityId, relatedCompanyResults, (companyId) => this.access.getIntelligence(companyId)),
      viewSections: [...(this.view.sections ?? [])],
    }
  }

  private projectRelation(relation: KnowledgeRelation): ProjectionRelation {
    return { id: relation.id, type: relation.type, source: relation.source, target: relation.target }
  }

  private getRelevantIntelligence(entityId: string): KnowledgeIntelligence[] {
    const entity = this.access.getEntity(entityId)
    const entityIds = [entityId]
    if (entity.type === 'industry') entityIds.push(...this.getGraphProjection(entityId).children.map((child) => child.id))
    const intelligence = new Map<string, KnowledgeIntelligence>()
    for (const relatedEntityId of entityIds) {
      for (const item of this.access.getIntelligence(relatedEntityId)) intelligence.set(item.id, item)
    }
    return [...intelligence.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  private collectSources(entityId: string, relatedItems: Array<KnowledgeEntity | KnowledgeIntelligence | KnowledgeModule>): KnowledgeSource[] {
    const sources = new Map<string, KnowledgeSource>()
    const itemIds = [entityId, ...relatedItems.map((item) => item.id)]
    for (const itemId of itemIds) {
      for (const source of this.access.getSources(itemId)) sources.set(source.id, source)
    }
    return [...sources.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

}
