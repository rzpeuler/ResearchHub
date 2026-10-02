import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type {
  KnowledgeAssetV04,
  KnowledgeClaimV04,
  KnowledgeEntityV04,
  KnowledgeEventV04,
  KnowledgeInvestmentThemeV04,
  KnowledgeModuleV04,
  KnowledgeObservationV04,
  KnowledgeRelationV04,
  KnowledgeSourceV04,
} from '../../knowledge/schema/domain-v04.ts'
import type { ThemeScopeDecisionV04 } from '../../knowledge/governance/theme-scope-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, validateCompetitionModuleV1, type CompetitionModuleV1 } from '../../knowledge/schema/competition-module-v04.ts'
import { readThemeScopeLedgerV04, type ThemeScopeLedgerEntryV04 } from '../../knowledge/governance/theme-scope-ledger-v04.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { ApplicationServiceError } from './contracts.ts'
import type {
  ThemeWorkspaceCompanyProjection,
  ThemeWorkspaceCompanySummary,
  ThemeWorkspaceCompetitionTable,
  ThemeWorkspaceContentProjection,
  ThemeWorkspaceCoreViews,
  ThemeWorkspaceFact,
  ThemeWorkspaceIndustryEdge,
  ThemeWorkspaceIndustryNode,
  ThemeWorkspaceIndustryProjection,
  ThemeWorkspaceLimitView,
  ThemeWorkspaceProjection,
  ThemeWorkspaceProjectionInput,
  ThemeWorkspaceTimelineItem,
} from './theme-workspace-projection-contracts.ts'

const DEFAULT_NODE_LIMIT = 60
const HARD_NODE_LIMIT = 150
const DEFAULT_EDGE_LIMIT = 120
const HARD_EDGE_LIMIT = 300
const DEFAULT_ITEMS_PER_SECTION = 30
const HARD_ITEMS_PER_SECTION = 100
const DEFAULT_COMPANIES_PER_INDUSTRY = 40
const HARD_COMPANIES_PER_INDUSTRY = 100
const MAX_STRING_LENGTH = 2400
const ACTIVE = 'active'
const INCLUDE = 'include'
const HUMAN_CONFIRMED = 'human_confirmed'
const COMPARABILITY_NOTE = '口径不一致：不可直接比较；未进行换算。'

type Dict = Record<string, unknown>
type Context = {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly theme: KnowledgeInvestmentThemeV04
  readonly assets: ReadonlyMap<string, KnowledgeAssetV04>
  readonly entities: ReadonlyMap<string, KnowledgeEntityV04>
  readonly relations: readonly KnowledgeRelationV04[]
  readonly includedIndustryRefs: ReadonlySet<string>
  readonly currentDecisions: readonly ThemeScopeDecisionV04[]
  readonly importanceByIndustry: ReadonlyMap<string, ThemeWorkspaceIndustryNode['importance']>
  readonly pendingCount: number
  readonly excludedCount: number
  readonly ledgerRevision: number
  readonly relationsForCompanies: () => readonly KnowledgeRelationV04[]
}

function dict(value: unknown): Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Dict : {}
}
function str(value: unknown, max = MAX_STRING_LENGTH): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined
}
function stableCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function isActive(value: unknown): boolean { return dict(dict(value).lifecycle).status === ACTIVE }
function isActiveAsset(value: KnowledgeAssetV04): boolean {
  if (value.id.startsWith('module:')) return !str(dict(value).lifecycle ? dict(dict(value).lifecycle).status : undefined) || isActive(value)
  return isActive(value)
}
function isIndustry(value: KnowledgeEntityV04): boolean { return value.type === 'industry' }
function asLimit(value: number | undefined, fallback: number, hard: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new ApplicationServiceError('invalid_input', `${name} must be a positive integer`)
  return Math.min(value, hard)
}
function limitView(total: number, limit: number): ThemeWorkspaceLimitView { return { total, limit, truncated: total > limit } }
function scopeError(code: 'failed' | 'conflict' | 'not_found' | 'invalid_input' | 'no_kb_mounted', message: string): ApplicationServiceError {
  return new ApplicationServiceError(code, message)
}

function sourceRefs(value: KnowledgeAssetV04): readonly string[] {
  if (value.id.startsWith('claim:')) return (value as KnowledgeClaimV04).sourceRefs ?? []
  if (value.id.startsWith('observation:')) {
    const item = value as KnowledgeObservationV04
    return [item.sourceRef].filter((ref): ref is NonNullable<typeof ref> => typeof ref === 'string')
  }
  if (value.id.startsWith('event:')) return (value as KnowledgeEventV04).sourceRefs ?? []
  if (value.id.startsWith('module:')) return (value as KnowledgeModuleV04).sourceRefs ?? []
  return []
}

function sourceIsReadable(source: KnowledgeSourceV04 | undefined, now: number): boolean {
  if (!source || !isActive(source)) return false
  if (!['public', 'authenticated'].includes(source.rights?.accessScope ?? 'unknown')) return false
  if (source.rights?.derivativeKnowledgeAllowed !== true || source.usagePolicy?.allowDerivedKnowledge !== true) return false
  const expires = source.rights?.expiresAt ? Date.parse(source.rights.expiresAt) : undefined
  return expires === undefined || (Number.isFinite(expires) && expires > now)
}

function itemReadable(value: KnowledgeAssetV04, assets: ReadonlyMap<string, KnowledgeAssetV04>, now: number): boolean {
  const refs = sourceRefs(value)
  if (refs.length === 0) return false
  return refs.every((ref) => sourceIsReadable(assets.get(ref) as KnowledgeSourceV04 | undefined, now))
}

function recordAt(value: KnowledgeAssetV04): string | undefined {
  const v = value as unknown as Dict
  return str(v.updatedAt) ?? str(v.createdAt) ?? str(v.recordedAt)
}

function toFact(value: KnowledgeAssetV04): ThemeWorkspaceFact {
  const refs = sourceRefs(value)
  if (value.id.startsWith('claim:')) {
    const claim = value as KnowledgeClaimV04
    return {
      ref: claim.id,
      kind: 'claim',
      semanticType: claim.claimType,
      title: claim.statement.slice(0, MAX_STRING_LENGTH),
      statement: claim.statement.slice(0, MAX_STRING_LENGTH),
      ...(claim.structuredValue?.value === undefined ? {} : { value: claim.structuredValue.value }),
      ...(str(claim.structuredValue?.unit) ? { unit: str(claim.structuredValue?.unit) } : {}),
      ...(str(claim.structuredValue?.period) ? { period: str(claim.structuredValue?.period) } : {}),
      ...(claim.confidence == null ? {} : { confidence: claim.confidence }),
      ...(claim.probability == null ? {} : { probability: claim.probability }),
      ...(claim.temporal ? { temporal: claim.temporal as unknown as Readonly<Record<string, unknown>> } : {}),
      sourceRefs: refs,
      ...(recordAt(claim) ? { recordedAt: recordAt(claim) } : {}),
    }
  }
  if (value.id.startsWith('observation:')) {
    const observation = value as KnowledgeObservationV04
    const metric = observation.observationType === 'metric' ? observation.value
      : observation.observationType === 'estimate' ? observation.estimateValue
        : observation.mean
    const unit = observation.observationType === 'estimate' ? observation.currency ?? observation.unit
      : observation.observationType === 'metric' ? observation.unit : undefined
    const period = observation.observationType === 'estimate' || observation.observationType === 'consensus'
      ? observation.fiscalPeriod
      : observation.period
    return {
      ref: observation.id,
      kind: 'observation',
      semanticType: observation.observationType,
      title: `${observation.metricRef}: ${String(metric ?? '—')}`.slice(0, MAX_STRING_LENGTH),
      value: metric,
      ...(unit ? { unit } : {}),
      ...(period ? { period } : {}),
      ...(observation.observationType === 'estimate' && observation.currency ? { currency: observation.currency } : {}),
      sourceRefs: refs,
      ...(recordAt(observation) ? { recordedAt: recordAt(observation) } : {}),
    }
  }
  const event = value as KnowledgeEventV04
  return {
    ref: event.id,
    kind: 'event',
    semanticType: event.eventType,
    title: event.title.slice(0, MAX_STRING_LENGTH),
    sourceRefs: refs,
    ...(recordAt(event) ? { recordedAt: recordAt(event) } : {}),
    temporal: event.temporal as unknown as Readonly<Record<string, unknown>>,
  }
}

function itemBelongsTo(value: KnowledgeAssetV04, subjectRef: string): boolean {
  if (value.id.startsWith('claim:')) {
    const claim = value as KnowledgeClaimV04
    return claim.subjectRefs.includes(subjectRef as never) || claim.primarySubjectRef === subjectRef
  }
  if (value.id.startsWith('observation:')) {
    const item = value as KnowledgeObservationV04
    return item.observationType === 'metric' ? item.subjectRef === subjectRef : item.subjectRef === subjectRef
  }
  if (value.id.startsWith('event:')) return (value as KnowledgeEventV04).subjectRefs.includes(subjectRef as never)
  return false
}

function moduleBelongsTo(value: KnowledgeAssetV04, subjectRef: string): value is KnowledgeModuleV04 {
  return value.id.startsWith('module:') && (value as KnowledgeModuleV04).targetEntity === subjectRef
}

function projectModule(value: KnowledgeModuleV04): { readonly ref: string; readonly moduleType: string; readonly schemaId?: string; readonly targetRef: string } {
  return {
    ref: value.id,
    moduleType: value.type,
    ...(str(value.schemaId) ? { schemaId: str(value.schemaId) } : {}),
    targetRef: value.targetEntity ?? '',
  }
}

function compareFact(left: ThemeWorkspaceFact, right: ThemeWorkspaceFact): number {
  const leftConfidence = left.confidence ?? -1
  const rightConfidence = right.confidence ?? -1
  return rightConfidence - leftConfidence || (right.recordedAt ?? '').localeCompare(left.recordedAt ?? '') || stableCompare(left.ref, right.ref)
}

function isFutureDate(value: string | undefined, asOf: string): boolean {
  if (!value) return false
  const date = Date.parse(value)
  const reference = Date.parse(asOf)
  return Number.isFinite(date) && Number.isFinite(reference) && date > reference
}

function latestPublicationDate(refs: readonly string[], assets: ReadonlyMap<string, KnowledgeAssetV04>): string | undefined {
  return refs.map((ref) => (assets.get(ref) as KnowledgeSourceV04 | undefined)?.publishedAt)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => b.localeCompare(a))[0]
}

function timelineItem(value: KnowledgeAssetV04, sources: readonly string[], assets: ReadonlyMap<string, KnowledgeAssetV04>, future = false): ThemeWorkspaceTimelineItem {
  if (value.id.startsWith('event:')) {
    const event = value as KnowledgeEventV04
    const occurrence = event.temporal.occurredAt ?? event.temporal.start
    const expected = event.temporal.start ?? event.temporal.end
    if (future && expected) return { ref: event.id, title: event.title.slice(0, MAX_STRING_LENGTH), date: expected, dateBasis: 'expected', dateLabel: '预计日期', sourceRefs: sources }
    if (!future && occurrence) return { ref: event.id, title: event.title.slice(0, MAX_STRING_LENGTH), date: occurrence, dateBasis: 'occurrence', dateLabel: '发生日', sourceRefs: sources }
    const publication = latestPublicationDate(sources, assets)
    return publication
      ? { ref: event.id, title: event.title.slice(0, MAX_STRING_LENGTH), date: publication, dateBasis: 'publication', dateLabel: '资料发布日期', sourceRefs: sources }
      : { ref: event.id, title: event.title.slice(0, MAX_STRING_LENGTH), dateBasis: 'unknown', dateLabel: '日期未知', sourceRefs: sources }
  }
  const claim = value as KnowledgeClaimV04
  const temporal = claim.temporal
  const expected = temporal?.scope?.start ?? temporal?.scope?.end ?? undefined
  return {
    ref: claim.id,
    title: claim.statement.slice(0, MAX_STRING_LENGTH),
    ...(expected ? { date: expected } : {}),
    dateBasis: expected ? 'expected' : 'unknown',
    dateLabel: expected ? '预计日期' : '日期未知',
    sourceRefs: sources,
  }
}

function buildContent(
  assets: ReadonlyMap<string, KnowledgeAssetV04>,
  subjectRef: string,
  options: { readonly asOf: string; readonly itemLimit: number; readonly relatedCompanyRefs?: ReadonlySet<string> },
): ThemeWorkspaceContentProjection {
  const candidates = [...assets.values()].filter((value) => value.id.startsWith('claim:') || value.id.startsWith('observation:') || value.id.startsWith('event:'))
    .filter((value) => isActiveAsset(value) && itemBelongsTo(value, subjectRef))
  const sourcesAllowed = new Map<string, boolean>()
  const isReadable = (value: KnowledgeAssetV04) => {
    const refs = sourceRefs(value)
    const now = Date.parse(options.asOf)
    const allowed = refs.length > 0 && refs.every((ref) => {
      if (!sourcesAllowed.has(ref)) sourcesAllowed.set(ref, sourceIsReadable(assets.get(ref) as KnowledgeSourceV04 | undefined, now))
      return sourcesAllowed.get(ref) === true
    })
    return allowed
  }
  const readable = candidates.filter(isReadable)
  const omittedRestrictedCount = candidates.length - readable.length
  const projectedFacts = readable.map((value) => toFact(value))
  const byType = new Map<string, ThemeWorkspaceFact[]>()
  for (const fact of projectedFacts) byType.set(fact.semanticType, [...(byType.get(fact.semanticType) ?? []), fact])
  const factsByType: Record<string, readonly ThemeWorkspaceFact[]> = Object.create(null) as Record<string, readonly ThemeWorkspaceFact[]>
  const limited: Record<string, ThemeWorkspaceLimitView> = Object.create(null) as Record<string, ThemeWorkspaceLimitView>
  for (const [kind, items] of [...byType].sort(([a], [b]) => stableCompare(a, b))) {
    const sorted = [...items].sort(compareFact)
    factsByType[kind] = sorted.slice(0, options.itemLimit)
    limited[kind] = limitView(sorted.length, options.itemLimit)
  }
  const viewTypes = new Set(['viewpoint', 'trend', 'risk', 'forecast', 'assumption', 'thesis'])
  const views = projectedFacts.filter((item) => item.kind === 'claim' && viewTypes.has(item.semanticType)).sort(compareFact)
  const coreViews: ThemeWorkspaceCoreViews = { items: views.slice(0, options.itemLimit), defaultCount: 3, total: views.length, truncated: views.length > options.itemLimit }
  const historicalEvents: ThemeWorkspaceTimelineItem[] = []
  const futureCatalysts: ThemeWorkspaceTimelineItem[] = []
  for (const value of readable) {
    if (value.id.startsWith('event:')) {
      const event = value as KnowledgeEventV04
      const eventDate = event.temporal.occurredAt ?? event.temporal.start
      if (isFutureDate(eventDate ?? undefined, options.asOf)) futureCatalysts.push(timelineItem(value, sourceRefs(value), assets, true))
      else historicalEvents.push(timelineItem(value, sourceRefs(value), assets))
    } else if (value.id.startsWith('claim:')) {
      const claim = value as KnowledgeClaimV04
      if (claim.claimType === 'catalyst') {
        const expected = claim.temporal?.scope?.start ?? claim.temporal?.scope?.end ?? undefined
        if (!expected || isFutureDate(expected, options.asOf)) futureCatalysts.push(timelineItem(value, sourceRefs(value), assets, true))
      }
    }
  }
  historicalEvents.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || stableCompare(a.ref, b.ref))
  futureCatalysts.sort((a, b) => (a.date ?? '\uffff').localeCompare(b.date ?? '\uffff') || stableCompare(a.ref, b.ref))

  const modules = [...assets.values()].filter((value): value is KnowledgeModuleV04 => moduleBelongsTo(value, subjectRef) && isActiveAsset(value))
    .filter((value) => itemReadable(value as unknown as KnowledgeAssetV04, assets, Date.parse(options.asOf)))
    .sort((a, b) => stableCompare(a.id, b.id))
  const canonicalModules = modules.slice(0, options.itemLimit).map(projectModule)
  const limitedModules = limitView(modules.length, options.itemLimit)
  const competition = modules.find((module) => module.type === 'competition' && module.schemaId === COMPETITION_MODULE_SCHEMA_ID_V1)
  const competitionTable = competition ? projectCompetition(competition, assets, options.relatedCompanyRefs ?? new Set()) : undefined
  const flattenedTimelineLimit = options.itemLimit
  return {
    factsByType,
    modules: canonicalModules,
    ...(competitionTable ? { competition: competitionTable } : {}),
    coreViews,
    timeline: {
      historicalEvents: historicalEvents.slice(0, flattenedTimelineLimit),
      futureCatalysts: futureCatalysts.slice(0, flattenedTimelineLimit),
      eventsLimit: limitView(historicalEvents.length, flattenedTimelineLimit),
      catalystsLimit: limitView(futureCatalysts.length, flattenedTimelineLimit),
    },
    limited: { ...limited, modules: limitedModules },
    omittedRestrictedCount,
  }
}

function projectCompetition(module: KnowledgeModuleV04, assets: ReadonlyMap<string, KnowledgeAssetV04>, relatedCompanyRefs: ReadonlySet<string>): ThemeWorkspaceCompetitionTable | undefined {
  const validation = validateCompetitionModuleV1(module)
  if (!validation.valid) return undefined
  const value = module as unknown as CompetitionModuleV1
  const comparableByColumn = new Map<string, boolean>()
  for (const column of value.columns) {
    if (!['market_cap', 'annual_revenue'].includes(column.role)) continue
    const available = value.rows.map((row) => row.cells[column.id]).filter((cell) => cell.status === 'available')
    const keys = new Set(available.map((cell) => {
      if (cell.status !== 'available') return ''
      const fields = cell as { readonly currency?: string; readonly unit?: string; readonly fiscalYear?: number }
      return column.role === 'market_cap'
        ? `${fields.currency}|${fields.unit}`
        : `${fields.currency}|${fields.unit}|${fields.fiscalYear}`
    }))
    comparableByColumn.set(column.id, keys.size <= 1)
  }
  const rows = value.rows.filter((row) => {
    const company = assets.get(row.companyRef)
    return relatedCompanyRefs.has(row.companyRef) && Boolean(company?.id.startsWith('entity:')) && (company as KnowledgeEntityV04).type === 'company' && isActive(company as KnowledgeEntityV04)
  })
    .map((row) => ({
      companyRef: row.companyRef,
      cells: value.columns.filter((column) => column.role !== 'company').map((column) => {
        const cell = row.cells[column.id]!
        const mismatch = cell.status === 'available' && comparableByColumn.get(column.id) === false
        return {
          columnId: column.id,
          value: cell,
          notComparable: mismatch,
          ...(mismatch ? { comparabilityNote: COMPARABILITY_NOTE } : {}),
        }
      }),
    }))
  return {
    ref: value.id,
    schemaId: value.schemaId,
    columns: value.columns,
    rows,
    ...(rows.length === 0 && value.rows.length > 0 ? { note: '竞争格局表中暂无与已确认行业公司关系相匹配的行。' } : {}),
  }
}

function relationImportance(relation: KnowledgeRelationV04): ThemeWorkspaceIndustryNode['importance'] | undefined {
  if (relation.type !== 'theme_exposure') return undefined
  const importance = relation.attributes?.importance
  return importance === 'core' || importance === 'material' || importance === 'adjacent' ? importance : undefined
}

function importanceOrder(value: ThemeWorkspaceIndustryNode['importance']): number {
  return value === 'core' ? 0 : value === 'material' ? 1 : value === 'adjacent' ? 2 : 3
}

export class ThemeWorkspaceProjectionService {
  private readonly registry = new KnowledgeBaseRegistry()

  constructor(private readonly mountedKnowledgeBaseRoot?: string, private readonly clock: () => string = () => new Date().toISOString()) {}

  async getThemeProjection(input: ThemeWorkspaceProjectionInput): Promise<ThemeWorkspaceProjection> {
    validateInput(input)
    const nodeLimit = asLimit(input.maxNodes, DEFAULT_NODE_LIMIT, HARD_NODE_LIMIT, 'maxNodes')
    const edgeLimit = asLimit(input.maxEdges, DEFAULT_EDGE_LIMIT, HARD_EDGE_LIMIT, 'maxEdges')
    const context = await this.load(input.themeRef, input.expectedRevision)
    const includedIndustryRefs = [...context.includedIndustryRefs]
    const allNodes = includedIndustryRefs.map((ref) => {
      const industry = context.entities.get(ref)!
      return {
        ref,
        name: industry.name,
        ...(str(industry.description) ? { description: str(industry.description) } : {}),
        ...(context.importanceByIndustry.get(ref) ? { importance: context.importanceByIndustry.get(ref) } : {}),
      } satisfies ThemeWorkspaceIndustryNode
    }).sort((a, b) => importanceOrder(a.importance) - importanceOrder(b.importance) || stableCompare(a.ref, b.ref))
    const nodes = allNodes.slice(0, nodeLimit)
    const nodeRefs = new Set(nodes.map((node) => node.ref))
    const allEdges: ThemeWorkspaceIndustryEdge[] = context.relations
      .filter((relation) => nodeRefs.has(relation.sourceRef) && nodeRefs.has(relation.targetRef))
      .map((relation) => ({ ref: relation.id, relationType: relation.type as 'upstream_of' | 'depends_on', sourceRef: relation.sourceRef, targetRef: relation.targetRef }))
      .sort((a, b) => stableCompare(a.ref, b.ref))
    const edges = allEdges.slice(0, edgeLimit)
    return {
      status: 'available',
      knowledgeBaseId: context.knowledgeBaseId,
      schemaVersion: '0.4',
      revision: context.revision,
      theme: { ref: input.themeRef, name: context.theme.name, themeGroupRef: context.theme.themeGroupRef, ...(context.theme.definition ? { definition: context.theme.definition } : {}) },
      graph: {
        nodes,
        edges,
        nodeTotal: allNodes.length,
        edgeTotal: context.relations.length,
        nodeLimit,
        edgeLimit,
        truncated: allNodes.length > nodeLimit || context.relations.length > edgeLimit,
      },
      scope: {
        includedIndustryCount: allNodes.length,
        includedRelationCount: context.relations.length,
        pendingCount: context.pendingCount,
        excludedCount: context.excludedCount,
        basedOnRevision: context.ledgerRevision,
      },
    }
  }

  async getIndustryProjection(input: ThemeWorkspaceProjectionInput, industryRef: string): Promise<ThemeWorkspaceIndustryProjection> {
    validateInput(input)
    const context = await this.load(input.themeRef, input.expectedRevision)
    if (!context.includedIndustryRefs.has(industryRef)) throw scopeError('not_found', 'Industry is not in the confirmed Theme scope')
    const industry = context.entities.get(industryRef)!
    const exposureRelations = context.relationsForCompanies()
    const allCompanyRefs = [...new Set(exposureRelations.filter((relation) => relation.targetRef === industryRef).map((relation) => relation.sourceRef))]
      .filter((ref) => context.entities.get(ref)?.type === 'company')
      .sort(stableCompare)
    const companyLimit = asLimit(input.maxCompaniesPerIndustry, DEFAULT_COMPANIES_PER_INDUSTRY, HARD_COMPANIES_PER_INDUSTRY, 'maxCompaniesPerIndustry')
    const companyRefs = allCompanyRefs.slice(0, companyLimit)
    const companySet = new Set(companyRefs)
    const asOf = input.asOf ?? this.clock()
    const itemLimit = asLimit(input.maxItemsPerSection, DEFAULT_ITEMS_PER_SECTION, HARD_ITEMS_PER_SECTION, 'maxItemsPerSection')
    return {
      knowledgeBaseId: context.knowledgeBaseId,
      revision: context.revision,
      themeRef: input.themeRef,
      industry: {
        ref: industry.id,
        name: industry.name,
        ...(str(industry.description) ? { description: str(industry.description) } : {}),
        ...(context.importanceByIndustry.get(industryRef) ? { importance: context.importanceByIndustry.get(industryRef) } : {}),
      },
      sections: buildContent(context.assets, industryRef, { asOf, itemLimit, relatedCompanyRefs: companySet }),
      companies: companyRefs.map((ref) => companySummary(context.entities.get(ref)!)),
      companiesLimit: limitView(allCompanyRefs.length, companyLimit),
    }
  }

  async getCompanyProjection(input: ThemeWorkspaceProjectionInput, industryRef: string, companyRef: string): Promise<ThemeWorkspaceCompanyProjection> {
    validateInput(input)
    const context = await this.load(input.themeRef, input.expectedRevision)
    if (!context.includedIndustryRefs.has(industryRef)) throw scopeError('not_found', 'Industry is not in the confirmed Theme scope')
    const company = context.entities.get(companyRef)
    if (!company || company.type !== 'company' || !context.relationsForCompanies().some((relation) => relation.sourceRef === companyRef && relation.targetRef === industryRef)) {
      throw scopeError('not_found', 'Company has no canonical business exposure to this confirmed Industry')
    }
    const asOf = input.asOf ?? this.clock()
    const itemLimit = asLimit(input.maxItemsPerSection, DEFAULT_ITEMS_PER_SECTION, HARD_ITEMS_PER_SECTION, 'maxItemsPerSection')
    return {
      knowledgeBaseId: context.knowledgeBaseId,
      revision: context.revision,
      themeRef: input.themeRef,
      industryRef,
      company: companySummary(company),
      sections: buildContent(context.assets, companyRef, { asOf, itemLimit }),
    }
  }

  private async load(themeRef: string, expectedRevision?: number): Promise<Context> {
    if (!this.mountedKnowledgeBaseRoot) throw scopeError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    const handle = await this.registry.refresh(this.mountedKnowledgeBaseRoot)
    if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') {
      throw scopeError('failed', 'schema_not_supported: Theme Workspace requires active Schema 0.4 / Storage Format 1')
    }
    if (expectedRevision !== undefined && expectedRevision !== handle.revision) throw scopeError('conflict', 'Knowledge Base revision changed; reload Theme Workspace projection')
    const assetsCollection = await readCanonicalV04Assets(handle.rootRef)
    const assets = new Map<string, KnowledgeAssetV04>(assetsCollection.objects.map((entry) => [entry.value.id, entry.value]))
    const entities = new Map<string, KnowledgeEntityV04>(assetsCollection.objects.filter((entry) => entry.kind === 'entity').map((entry) => [entry.value.id, entry.value as KnowledgeEntityV04]))
    const themeValue = entities.get(themeRef)
    if (!themeValue || themeValue.type !== 'investment_theme' || !isActive(themeValue)) throw scopeError('not_found', 'Active canonical InvestmentTheme was not found')
    const theme = themeValue
    const ledger = await readThemeScopeLedgerV04(handle)
    if (ledger.status !== 'available') throw scopeError('failed', `theme_scope_ledger_unavailable:${ledger.error.code}`)
    if (ledger.knowledgeBaseId !== handle.knowledgeBaseId || ledger.knowledgeBaseRevision !== handle.revision) {
      throw scopeError('conflict', 'Theme scope ledger revision does not match canonical Knowledge Base revision')
    }
    const latest = await this.registry.refresh(this.mountedKnowledgeBaseRoot)
    if (latest.knowledgeBaseId !== handle.knowledgeBaseId || latest.revision !== handle.revision) throw scopeError('conflict', 'Knowledge Base changed while Theme Workspace projection was loading')
    const ledgerTheme = ledger.themes.find((entry) => entry.themeRef === themeRef)
    const latestByFingerprint = ledgerTheme?.currentByCandidateFingerprint ?? {}
    const currentDecisions = Object.values(latestByFingerprint).map((entry) => entry.decision)
    const includedIndustryRefs = new Set<string>()
    const fingerprintToIndustry = new Map<string, string>()
    const importanceByIndustry = new Map<string, ThemeWorkspaceIndustryNode['importance']>()
    const themeExposureRelations = assetsCollection.objects.filter((entry) => entry.kind === 'relation').map((entry) => entry.value as KnowledgeRelationV04)
      .filter((relation) => relation.type === 'theme_exposure' && relation.sourceRef === themeRef && isActive(relation))
    for (const decision of currentDecisions) {
      if (decision.decision !== INCLUDE || decision.review.status !== HUMAN_CONFIRMED || decision.candidate.kind !== 'industry') continue
      const ref = decision.candidate.canonicalRef
      const industry = ref ? entities.get(ref) : undefined
      if (!ref || !industry || !isIndustry(industry) || !isActive(industry)) throw scopeError('failed', 'Confirmed Theme scope references a missing or inactive canonical Industry')
      includedIndustryRefs.add(ref)
      fingerprintToIndustry.set(decision.candidateFingerprint, ref)
      const exposure = themeExposureRelations.find((relation) => relation.targetRef === ref)
      const importance = exposure ? relationImportance(exposure) : undefined
      if (importance) importanceByIndustry.set(ref, importance)
    }
    const includedRelations: KnowledgeRelationV04[] = []
    for (const decision of currentDecisions) {
      if (decision.decision !== INCLUDE || decision.review.status !== HUMAN_CONFIRMED || decision.candidate.kind !== 'relation') continue
      const candidate = decision.candidate
      const ref = candidate.canonicalRef
      const relation = ref ? assets.get(ref) : undefined
      const sourceRef = fingerprintToIndustry.get(candidate.sourceFingerprint)
      const targetRef = fingerprintToIndustry.get(candidate.targetFingerprint)
      if (!ref || !relation || !relation.id.startsWith('relation:') || !sourceRef || !targetRef) {
        throw scopeError('failed', 'Confirmed Theme relation lacks an included canonical relation or included endpoint')
      }
      const canonical = relation as KnowledgeRelationV04
      if (!isActive(canonical) || canonical.type !== candidate.relationType || canonical.sourceRef !== sourceRef || canonical.targetRef !== targetRef) {
        throw scopeError('failed', 'Confirmed Theme relation does not match canonical relation direction or endpoints')
      }
      includedRelations.push(canonical)
    }
    const distinctRelations = [...new Map(includedRelations.map((relation) => [relation.id, relation])).values()].sort((a, b) => stableCompare(a.id, b.id))
    const counts = decisionCounts(ledgerTheme?.history ?? [])
    return {
      knowledgeBaseId: handle.knowledgeBaseId,
      revision: handle.revision,
      theme,
      assets,
      entities,
      relations: distinctRelations,
      includedIndustryRefs,
      currentDecisions,
      importanceByIndustry,
      pendingCount: counts.pendingCount,
      excludedCount: counts.excludedCount,
      ledgerRevision: ledger.knowledgeBaseRevision,
      relationsForCompanies: () => assetsCollection.objects.filter((entry) => entry.kind === 'relation').map((entry) => entry.value as KnowledgeRelationV04)
        .filter((relation) => relation.type === 'business_exposure' && isActive(relation) && includedIndustryRefs.has(relation.targetRef)),
    }
  }
}

function validateInput(input: ThemeWorkspaceProjectionInput): void {
  if (!input || typeof input !== 'object' || typeof input.themeRef !== 'string' || !/^entity:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/u.test(input.themeRef)) {
    throw scopeError('invalid_input', 'themeRef must be a canonical InvestmentTheme ref')
  }
  if (input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) throw scopeError('invalid_input', 'expectedRevision must be a non-negative safe integer')
  if (input.asOf !== undefined && (!Number.isFinite(Date.parse(input.asOf)) || input.asOf.length > 80)) throw scopeError('invalid_input', 'asOf must be a parseable timestamp')
}

function decisionCounts(history: readonly ThemeScopeLedgerEntryV04[]): { readonly pendingCount: number; readonly excludedCount: number } {
  const current = new Map<string, ThemeScopeLedgerEntryV04>()
  for (const entry of history) current.set(entry.decision.candidateFingerprint, entry)
  const decisions = [...current.values()].map((entry) => entry.decision)
  return {
    pendingCount: decisions.filter((decision) => decision.decision === 'pending').length,
    excludedCount: decisions.filter((decision) => decision.decision === 'exclude').length,
  }
}

function companySummary(value: KnowledgeEntityV04): ThemeWorkspaceCompanySummary {
  return {
    ref: value.id,
    name: value.name,
    ...(value.type === 'company' && value.ticker ? { ticker: value.ticker } : {}),
    ...(value.type === 'company' && value.exchange ? { exchange: value.exchange } : {}),
  }
}
