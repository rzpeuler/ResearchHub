import { createHmac, timingSafeEqual } from 'node:crypto'
import { KnowledgeIndexV04 } from '../../knowledge/query/index.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../../knowledge/schema/executable-schema.ts'
import type { KnowledgeAssetV04 } from '../../knowledge/schema/domain-v04.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { ApplicationServiceError } from './contracts.ts'
import type {
  KnowledgeTopicAssociationPath,
  KnowledgeTopicFilters,
  KnowledgeTopicItem,
  KnowledgeTopicItemPage,
  KnowledgeTopicKind,
  KnowledgeTopicLifecycleFilter,
  KnowledgeTopicPageInput,
  KnowledgeTopicPathHop,
  KnowledgeTopicScope,
  KnowledgeTopicSummary,
  KnowledgeTopicSummaryCount,
} from './knowledge-topic-contracts.ts'

const KINDS: readonly KnowledgeTopicKind[] = ['relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge']
const THEME_RELATION_TYPES = new Set(['theme_exposure', 'business_exposure', 'upstream_of'])
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 30
const MAX_RELATIONS_SCANNED = 10_000
const MAX_CONNECTED_ENTITIES = 5_000
const MAX_PATHS_PER_ITEM = 32
const MAX_SOURCE_BACKLINKS_PER_ITEM = 64
const MAX_FOCUS_REFS = 64
const MAX_TOPIC_RESPONSE_BYTES = 1024 * 1024
const CURSOR_VERSION = 1
const CURSOR_SECRET = 'knowledge-topic-projection-cursor-v1'
const CLAIM_TYPES = new Set(['fact', 'forecast', 'viewpoint', 'trend', 'risk', 'assumption', 'thesis', 'catalyst'])
const RELATION_TYPES = new Set<string>(KNOWLEDGE_SCHEMA_V03.relation.types)
const REF_PATTERN = /^(entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/
const THEME_GROUP_REF_PATTERN = /^theme-group:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/
const RAW_REF_PATTERN = /^raw-sha256-[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/
const HTTP_URL = /^https?:\/\//i

type Dict = Record<string, unknown>
type LoadedContext = { readonly knowledgeBaseId: string; readonly revision: number; readonly index: KnowledgeIndexV04 }
type Candidate = { readonly value: KnowledgeAssetV04; readonly paths: Map<string, KnowledgeTopicAssociationPath>; readonly referencedByRefs?: readonly string[] }
type Traversal = { readonly pathsByEntity: Map<string, readonly KnowledgeTopicAssociationPath[]>; readonly truncated: boolean; readonly focusRefs: readonly string[] }
type CursorPayload = { readonly v: 1; readonly kb: string; readonly revision: number; readonly theme: string; readonly scope: KnowledgeTopicScope; readonly kind: KnowledgeTopicKind; readonly depth: 1 | 2; readonly filters: NormalizedFilters; readonly after: string }
type NormalizedFilters = { readonly lifecycle: KnowledgeTopicLifecycleFilter; readonly observationType?: 'metric' | 'estimate' | 'consensus'; readonly claimType?: string; readonly relationType?: string }

const dict = (value: unknown): Dict => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Dict : {}
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value : undefined
const refs = (value: unknown): string[] => arr(value).filter((item): item is string => typeof item === 'string')
const statusOf = (value: KnowledgeAssetV04): string => safeText(dict(dict(value).lifecycle).status, 100) ?? 'unknown'
const active = (value: KnowledgeAssetV04): boolean => statusOf(value) === 'active' || (assetKind(value) === 'module' && string(dict(dict(value).lifecycle).status) === undefined)
const assetKind = (value: KnowledgeAssetV04): string => value.id.slice(0, value.id.indexOf(':'))
const orderText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const topicError = (code: ConstructorParameters<typeof ApplicationServiceError>[0], message: string): ApplicationServiceError => new ApplicationServiceError(code, message)

/** Read-only, bounded projection over the mounted Schema 0.4 canonical object index. */
export class KnowledgeTopicProjectionService {
  private readonly registry = new KnowledgeBaseRegistry()

  constructor(private readonly mountedKnowledgeBaseRoot?: string) {}

  async getSummary(themeRef: string, depth: 1 | 2 = 1): Promise<KnowledgeTopicSummary> {
    validateThemeRef(themeRef)
    validateDepth(depth)
    const context = await this.load()
    const theme = requireTheme(context.index, themeRef)
    const traversal = buildTraversal(context.index, themeRef, depth)
    const direct = collectCandidates(context.index, [themeRef], themeRef, 'direct', new Map())
    const connectedCandidates = collectCandidates(context.index, connectedContentAnchors(context.index, traversal), themeRef, 'connected', traversal.pathsByEntity)
    const connected = withoutDirectMembership(connectedCandidates, direct)
    const counts = {
      direct: countKinds(direct, false),
      connected: countKinds(connected, traversal.truncated),
    }
    const focus = focusRefProjection(traversal.focusRefs)
    const summary: KnowledgeTopicSummary = {
      knowledgeBaseId: context.knowledgeBaseId,
      schemaVersion: '0.4' as const,
      revision: context.revision,
      theme: themeSummary(theme),
      counts,
      overview: {
        direct: scopeOverview(direct, false),
        connected: scopeOverview(connected, traversal.truncated),
      },
      connected: { depth, totalExact: !traversal.truncated, truncated: traversal.truncated, ...focus },
    }
    assertTopicResponseSize(summary)
    return summary
  }

  async listItems(input: KnowledgeTopicPageInput): Promise<KnowledgeTopicItemPage> {
    if (!input || typeof input !== 'object') throw topicError('invalid_input', 'Topic page input is required')
    validateThemeRef(input.themeRef)
    if (!KINDS.includes(input.kind)) throw topicError('invalid_input', 'Unsupported topic item kind')
    const scope = input.scope ?? 'direct'
    if (scope !== 'direct' && scope !== 'connected') throw topicError('invalid_input', 'scope must be direct or connected')
    const depth = input.depth ?? 1
    validateDepth(depth)
    const limit = pageLimit(input.limit)
    const filters = normalizeFilters(input.filters)
    if (input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) throw topicError('invalid_input', 'expectedRevision must be a non-negative safe integer')
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    const context = await this.load()
    if (input.expectedRevision !== undefined && input.expectedRevision !== context.revision) throw topicError('conflict', 'Knowledge Base revision changed; reload the topic before paging')
    requireTheme(context.index, input.themeRef)
    const traversal = scope === 'connected' ? buildTraversal(context.index, input.themeRef, depth) : emptyTraversal()
    const anchors = scope === 'direct' ? [input.themeRef] : connectedContentAnchors(context.index, traversal)
    let candidates = collectCandidates(context.index, anchors, input.themeRef, scope, traversal.pathsByEntity, filters.lifecycle === 'all')
    if (scope === 'connected') {
      const directCandidates = collectCandidates(context.index, [input.themeRef], input.themeRef, 'direct', new Map(), filters.lifecycle === 'all')
      candidates = withoutDirectMembership(candidates, directCandidates)
    }
    const projected = [...candidates.values()]
      .filter(({ value }) => kindMatches(value, input.kind))
      .filter(({ value }) => filters.lifecycle === 'all' || active(value))
      .filter(({ value }) => matchesFilters(value, filters))
      .map(({ value, paths, referencedByRefs }) => projectItem(value, scope, paths, referencedByRefs))
      .sort(compareItems)
    const total = projected.length
    const binding = { kb: context.knowledgeBaseId, revision: context.revision, theme: input.themeRef, scope, kind: input.kind, depth, filters }
    let offset = 0
    if (cursor !== undefined) {
      const payload = cursor
      const expected = JSON.stringify(binding)
      const actual = JSON.stringify({ kb: payload.kb, revision: payload.revision, theme: payload.theme, scope: payload.scope, kind: payload.kind, depth: payload.depth, filters: payload.filters })
      if (actual !== expected || payload.v !== CURSOR_VERSION) throw topicError('conflict', 'Topic page cursor is stale or belongs to another request; reload the first page')
      offset = projected.findIndex((item) => item.ref === payload.after) + 1
      if (offset === 0) throw topicError('conflict', 'Topic page cursor no longer matches the current canonical page; reload the first page')
    }
    const candidatesForPage = projected.slice(offset, offset + limit)
    const focus = focusRefProjection(scope === 'connected' ? traversal.focusRefs : [])
    const base = {
      knowledgeBaseId: context.knowledgeBaseId,
      schemaVersion: '0.4' as const,
      revision: context.revision,
      themeRef: input.themeRef,
      kind: input.kind,
      scope,
      depth,
      filters,
      total,
      totalExact: scope === 'direct' || !traversal.truncated,
      limit,
      truncated: scope === 'connected' && traversal.truncated,
      ...focus,
    }
    const makePage = (items: readonly KnowledgeTopicItem[], responseBounded: boolean): KnowledgeTopicItemPage => {
      const nextCursor = offset + items.length < total && items.length > 0
        ? encodeCursor({ v: 1, ...binding, after: items.at(-1)!.ref })
        : undefined
      return { ...base, items, responseBounded, ...(nextCursor ? { nextCursor } : {}) }
    }
    const accepted: KnowledgeTopicItem[] = []
    for (const [index, item] of candidatesForPage.entries()) {
      // Reserve the final true flag whenever more candidates remain. If the next
      // item crosses the bound, the returned shorter page will keep that flag.
      const mayBeShortened = index + 1 < candidatesForPage.length
      const candidate = makePage([...accepted, item], mayBeShortened)
      if (serializedTopicResponseBytes(candidate) > MAX_TOPIC_RESPONSE_BYTES) {
        if (accepted.length === 0) throw topicError('failed', 'topic_response_too_large: one topic item exceeds the 1 MiB response bound')
        break
      }
      accepted.push(item)
    }
    const page = makePage(accepted, accepted.length < candidatesForPage.length)
    assertTopicResponseSize(page)
    return page
  }

  private async load(): Promise<LoadedContext> {
    if (!this.mountedKnowledgeBaseRoot) throw topicError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    try {
      const handle = await this.registry.refresh(this.mountedKnowledgeBaseRoot)
      if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1') throw topicError('invalid_input', 'schema_not_supported: topic projection requires Schema 0.4 / Storage Format 1')
      const assets = await readCanonicalV04Assets(handle.rootRef)
      return { knowledgeBaseId: handle.knowledgeBaseId, revision: handle.revision, index: KnowledgeIndexV04.fromAssets(assets) }
    } catch (error) {
      if (error instanceof ApplicationServiceError) throw error
      throw new ApplicationServiceError('failed', 'Unable to load the mounted Schema 0.4 Knowledge Base', { cause: error })
    }
  }
}

function validateThemeRef(ref: string): void {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref) || !ref.startsWith('entity:')) throw topicError('invalid_input', 'themeRef must be a canonical Entity reference')
}
function validateDepth(depth: unknown): asserts depth is 1 | 2 { if (depth !== 1 && depth !== 2) throw topicError('invalid_input', 'depth must be 1 or 2') }
function pageLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw topicError('invalid_input', `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  return value
}
function normalizeFilters(filters: KnowledgeTopicFilters | undefined): NormalizedFilters {
  if (filters === undefined) return { lifecycle: 'active' }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw topicError('invalid_input', 'filters must be an object')
  const allowedKeys = new Set(['lifecycle', 'observationType', 'claimType', 'relationType'])
  if (Object.keys(filters).some((key) => !allowedKeys.has(key))) throw topicError('invalid_input', 'filters contain an unsupported field')
  const lifecycle = filters.lifecycle ?? 'active'
  if (lifecycle !== 'active' && lifecycle !== 'all') throw topicError('invalid_input', 'lifecycle filter must be active or all')
  const result: NormalizedFilters = {
    lifecycle,
    ...(optionalFilter(filters.observationType, ['metric', 'estimate', 'consensus'], 'observationType')),
    ...(enumFilter(filters.claimType, CLAIM_TYPES, 'claimType')),
    ...(enumFilter(filters.relationType, RELATION_TYPES, 'relationType')),
  }
  return result
}
function optionalFilter(value: unknown, allowed: readonly string[], name: string): Dict {
  if (value === undefined) return {}
  if (typeof value !== 'string' || !allowed.includes(value)) throw topicError('invalid_input', `${name} is invalid`)
  return { [name]: value }
}
function enumFilter(value: unknown, allowed: ReadonlySet<string>, name: string): Dict {
  if (value === undefined) return {}
  if (typeof value !== 'string' || !allowed.has(value)) throw topicError('invalid_input', `${name} is invalid`)
  return { [name]: value }
}
function requireTheme(index: KnowledgeIndexV04, ref: string): KnowledgeAssetV04 {
  const value = index.objects.get(ref)
  if (!value) throw topicError('not_found', 'InvestmentTheme was not found in the mounted Knowledge Base')
  const raw = dict(value)
  if (assetKind(value) !== 'entity' || raw.type !== 'investment_theme') throw topicError('invalid_input', 'Topic root must be an InvestmentTheme Entity')
  if (!active(value)) throw topicError('not_found', 'InvestmentTheme is not active')
  return value
}

function themeSummary(theme: KnowledgeAssetV04): KnowledgeTopicSummary['theme'] {
  const raw = dict(theme)
  const simpleStrings = (value: unknown): string[] => arr(value).map((item) => safeText(item, 300)).filter((item): item is string => item !== undefined).slice(0, 40)
  const description = safeText(raw.description, 2_000)
  const definition = safeText(raw.definition, 2_000)
  return {
    ref: theme.id,
    name: safeText(raw.name, 300) ?? theme.id,
    aliases: simpleStrings(raw.aliases),
    ...(description ? { description } : {}),
    ...(definition ? { definition } : {}),
    ...(simpleStrings(raw.inclusionCriteria).length ? { inclusionCriteria: simpleStrings(raw.inclusionCriteria) } : {}),
    ...(simpleStrings(raw.exclusionCriteria).length ? { exclusionCriteria: simpleStrings(raw.exclusionCriteria) } : {}),
    ...(typeof raw.themeGroupRef === 'string' && THEME_GROUP_REF_PATTERN.test(raw.themeGroupRef) ? { themeGroupRef: raw.themeGroupRef } : {}),
    lifecycleStatus: statusOf(theme),
  }
}

function buildTraversal(index: KnowledgeIndexV04, themeRef: string, depth: 1 | 2): Traversal {
  const entities = [...(index.byKind.get('entity') ?? [])].filter(active).filter((entity) => {
    const type = dict(entity).type
    return ['investment_theme', 'industry', 'company', 'product', 'technology'].includes(String(type))
  })
  const entityRefs = new Set<string>(entities.map((entity) => entity.id))
  const allRelations = [...(index.byKind.get('relation') ?? [])]
    .filter(active)
    .filter((relation) => THEME_RELATION_TYPES.has(String(dict(relation).type)))
    .filter((relation) => entityRefs.has(String(dict(relation).sourceRef)) && entityRefs.has(String(dict(relation).targetRef)))
    .sort((a, b) => orderText(a.id, b.id))
  for (const relation of allRelations) {
    const raw = dict(relation)
    if (!REF_PATTERN.test(relation.id) || !REF_PATTERN.test(String(raw.sourceRef)) || !REF_PATTERN.test(String(raw.targetRef))) throw topicError('failed', 'broken_reference: graph relation contains a malformed canonical reference')
  }
  const truncatedByRelationLimit = allRelations.length > MAX_RELATIONS_SCANNED
  const relations = allRelations.slice(0, MAX_RELATIONS_SCANNED)
  const adjacency = new Map<string, { readonly relation: KnowledgeAssetV04; readonly neighborRef: string }[]>()
  for (const relation of relations) {
    const raw = dict(relation)
    const sourceRef = String(raw.sourceRef)
    const targetRef = String(raw.targetRef)
    adjacency.set(sourceRef, [...(adjacency.get(sourceRef) ?? []), { relation, neighborRef: targetRef }])
    adjacency.set(targetRef, [...(adjacency.get(targetRef) ?? []), { relation, neighborRef: sourceRef }])
  }
  const paths = new Map<string, KnowledgeTopicAssociationPath[]>([[themeRef, [{ entityRef: themeRef, hops: [] }]]])
  let frontier = [themeRef]
  let truncated = truncatedByRelationLimit
  const focusRefs = new Set<string>()
  for (let hop = 1; hop <= depth; hop += 1) {
    const next = new Set<string>()
    for (const current of frontier.sort(orderText)) {
      for (const { relation, neighborRef } of adjacency.get(current) ?? []) {
        const rel = dict(relation)
        const pathHop: KnowledgeTopicPathHop = { relationRef: relation.id, sourceRef: String(rel.sourceRef), targetRef: String(rel.targetRef) }
        if (!paths.has(neighborRef) && paths.size >= MAX_CONNECTED_ENTITIES) {
          truncated = true
          focusRefs.add(current)
          continue
        }
        const previousPaths = paths.get(current) ?? []
        const additions = previousPaths.filter((path) => path.hops.length === hop - 1).map((path) => ({ entityRef: neighborRef, hops: [...path.hops, pathHop] }))
        const currentPaths = paths.get(neighborRef) ?? []
        const allPaths = dedupePaths([...currentPaths, ...additions])
        if (allPaths.length > MAX_PATHS_PER_ITEM) { truncated = true; focusRefs.add(neighborRef) }
        const combined = allPaths.slice(0, MAX_PATHS_PER_ITEM)
        if (combined.length > currentPaths.length) paths.set(neighborRef, combined)
        if (neighborRef !== themeRef && hop < depth && !currentPaths.length) next.add(neighborRef)
      }
    }
    frontier = [...next]
  }
  if (truncatedByRelationLimit) for (const ref of paths.keys()) focusRefs.add(ref)
  paths.delete(themeRef)
  return { pathsByEntity: paths, truncated, focusRefs: [...focusRefs].sort(orderText) }
}

function emptyTraversal(): Traversal { return { pathsByEntity: new Map(), truncated: false, focusRefs: [] } }
function withoutDirectMembership(connected: Map<string, Candidate>, direct: ReadonlyMap<string, Candidate>): Map<string, Candidate> {
  const result = new Map(connected)
  for (const ref of direct.keys()) result.delete(ref)
  return result
}
function connectedContentAnchors(index: KnowledgeIndexV04, traversal: Traversal): string[] {
  return [...traversal.pathsByEntity.keys()].filter((ref) => dict(index.objects.get(ref)).type !== 'investment_theme')
}
function dedupePaths(paths: readonly KnowledgeTopicAssociationPath[]): KnowledgeTopicAssociationPath[] {
  const unique = new Map<string, KnowledgeTopicAssociationPath>()
  for (const path of paths) unique.set(path.hops.map((hop) => hop.relationRef).join('>'), path)
  return [...unique.values()].sort((a, b) => orderText(a.hops.map((hop) => hop.relationRef).join('>'), b.hops.map((hop) => hop.relationRef).join('>')))
}

function collectCandidates(index: KnowledgeIndexV04, anchors: readonly string[], themeRef: string, scope: KnowledgeTopicScope, pathsByEntity: ReadonlyMap<string, readonly KnowledgeTopicAssociationPath[]>, includeHistory = false): Map<string, Candidate> {
  const anchorSet = new Set(anchors)
  const result = new Map<string, Candidate>()
  const add = (value: KnowledgeAssetV04, anchor?: string): void => {
    if (scope === 'connected' && value.id === themeRef) return
    if (!REF_PATTERN.test(value.id)) throw topicError('failed', 'broken_reference: included object has a malformed canonical reference')
    const paths = new Map(result.get(value.id)?.paths ?? [])
    if (scope === 'connected' && anchor) for (const path of pathsByEntity.get(anchor) ?? []) paths.set(path.hops.map((hop) => hop.relationRef).join('>'), path)
    result.set(value.id, { value, paths })
  }
  const activeRecords = (kind: string): KnowledgeAssetV04[] => (index.byKind.get(kind as never) ?? []).filter((value) => includeHistory || active(value))
  const includedRecords = new Set<string>()
  for (const kind of ['claim', 'observation', 'event', 'thesis', 'module', 'relation']) {
    for (const value of activeRecords(kind)) {
      const raw = dict(value)
      const memberships: string[] = []
      if (kind === 'claim' || kind === 'event' || kind === 'thesis') {
        for (const ref of refs(raw.subjectRefs)) if (anchorSet.has(ref)) memberships.push(ref)
      } else if (kind === 'observation' && typeof raw.subjectRef === 'string' && anchorSet.has(raw.subjectRef)) memberships.push(raw.subjectRef)
      else if (kind === 'module' && typeof raw.targetEntity === 'string' && anchorSet.has(raw.targetEntity)) memberships.push(raw.targetEntity)
      else if (kind === 'relation') {
        for (const ref of [raw.sourceRef, raw.targetRef, ...refs(raw.contextRefs)]) if (typeof ref === 'string' && anchorSet.has(ref)) memberships.push(ref)
        const otherThemeEndpoint = [raw.sourceRef, raw.targetRef].some((ref) => typeof ref === 'string' && ref !== themeRef && dict(index.objects.get(ref)).type === 'investment_theme')
        if (scope === 'connected' && otherThemeEndpoint && !refs(raw.contextRefs).includes(themeRef)) continue
      }
      if (!memberships.length) continue
      validateRecordReferences(index, value)
      for (const anchor of memberships) add(value, anchor)
      includedRecords.add(value.id)
    }
  }
  for (const edge of activeRecords('reasoning_edge')) {
    const raw = dict(edge)
    if ([raw.sourceRef, raw.targetRef].some((ref) => typeof ref === 'string' && includedRecords.has(ref))) {
      validateRecordReferences(index, edge)
      const neighborAnchors = new Set<string>()
      for (const recordRef of [raw.sourceRef, raw.targetRef]) {
        if (typeof recordRef !== 'string' || !includedRecords.has(recordRef)) continue
        const record = index.objects.get(recordRef)
        if (!record) continue
        const recordRaw = dict(record)
        for (const ref of [...refs(recordRaw.subjectRefs), ...(typeof recordRaw.subjectRef === 'string' ? [recordRaw.subjectRef] : []), ...(typeof recordRaw.targetEntity === 'string' ? [recordRaw.targetEntity] : [])]) if (anchorSet.has(ref)) neighborAnchors.add(ref)
        const relationRaw = dict(record)
        if (assetKind(record) === 'relation') for (const ref of [relationRaw.sourceRef, relationRaw.targetRef, ...refs(relationRaw.contextRefs)]) if (typeof ref === 'string' && anchorSet.has(ref)) neighborAnchors.add(ref)
      }
      if (scope === 'direct') add(edge)
      else for (const anchor of neighborAnchors) add(edge, anchor)
      includedRecords.add(edge.id)
    }
  }
  const sourcePaths = new Map<string, Map<string, KnowledgeTopicAssociationPath>>()
  const sourceReferencedBy = new Map<string, Set<string>>()
  for (const recordId of [...includedRecords]) {
    const record = index.objects.get(recordId)
    if (!record) continue
    const raw = dict(record)
    for (const sourceRef of sourceRefsFor(raw)) {
      const source = index.objects.get(sourceRef)
      if (!source || assetKind(source) !== 'source') throw topicError('failed', 'broken_reference: included canonical object references a missing Source')
      const byPath = sourcePaths.get(sourceRef) ?? new Map<string, KnowledgeTopicAssociationPath>()
      for (const path of result.get(recordId)?.paths.values() ?? []) byPath.set(path.hops.map((hop) => hop.relationRef).join('>'), path)
      sourcePaths.set(sourceRef, byPath)
      const referencedBy = sourceReferencedBy.get(sourceRef) ?? new Set<string>()
      referencedBy.add(recordId)
      sourceReferencedBy.set(sourceRef, referencedBy)
    }
  }
  for (const [sourceRef, paths] of sourcePaths) {
    const source = index.objects.get(sourceRef)!
    if (!includeHistory && !active(source)) continue
    result.set(sourceRef, { value: source, paths, referencedByRefs: [...(sourceReferencedBy.get(sourceRef) ?? [])].sort(orderText) })
  }
  return result
}

function sourceRefsFor(raw: Dict): string[] {
  const result = [...refs(raw.sourceRefs)]
  if (typeof raw.sourceRef === 'string' && raw.sourceRef.startsWith('source:')) result.push(raw.sourceRef)
  for (const provenance of arr(raw.provenance)) if (typeof dict(provenance).sourceRef === 'string') result.push(dict(provenance).sourceRef as string)
  for (const criterion of arr(raw.killCriteria)) {
    const origin = dict(dict(criterion).authority).origin
    if (typeof dict(origin).sourceRef === 'string') result.push(dict(origin).sourceRef as string)
  }
  return [...new Set(result)]
}

function validateRecordReferences(index: KnowledgeIndexV04, value: KnowledgeAssetV04): void {
  const raw = dict(value)
  const check = (ref: unknown, expected: string): void => {
    if (typeof ref !== 'string' || !REF_PATTERN.test(ref) || !ref.startsWith(`${expected}:`) || !index.objects.has(ref)) throw topicError('failed', `broken_reference: ${value.id} has a missing or malformed ${expected} reference`)
  }
  const kind = assetKind(value)
  if (kind === 'claim' || kind === 'event' || kind === 'thesis') for (const ref of refs(raw.subjectRefs)) check(ref, 'entity')
  if (kind === 'claim') {
    for (const field of ['supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs', 'supersedes', 'supersededBy']) for (const ref of refs(raw[field])) check(ref, 'claim')
  }
  if (kind === 'observation') check(raw.subjectRef, 'entity')
  if (kind === 'observation' && raw.observationType === 'estimate') {
    check(raw.institutionRef, 'entity')
    if (raw.analystRef !== undefined && raw.analystRef !== null) check(raw.analystRef, 'entity')
    if (raw.revisionOf !== undefined && raw.revisionOf !== null) check(raw.revisionOf, 'observation')
  }
  if (kind === 'observation' && raw.observationType === 'consensus') for (const ref of refs(raw.contributingObservationRefs)) check(ref, 'observation')
  if (kind === 'event') for (const ref of refs(raw.participantRefs)) check(ref, 'entity')
  if (kind === 'module' && typeof raw.targetEntity === 'string') check(raw.targetEntity, 'entity')
  if (kind === 'relation') {
    check(raw.sourceRef, 'entity'); check(raw.targetRef, 'entity')
    for (const ref of refs(raw.contextRefs)) {
      if (RAW_REF_PATTERN.test(ref)) continue
      if (!REF_PATTERN.test(ref) || !index.objects.has(ref)) throw topicError('failed', `broken_reference: ${value.id} has a missing or malformed context reference`)
    }
  }
  for (const ref of sourceRefsFor(raw)) check(ref, 'source')
  if (kind === 'reasoning-edge') {
    for (const ref of [raw.sourceRef, raw.targetRef]) if (typeof ref === 'string') {
      const expected = ref.startsWith('observation:') ? 'observation' : ref.startsWith('claim:') ? 'claim' : 'thesis'
      check(ref, expected)
    }
  }
}

function kindMatches(value: KnowledgeAssetV04, kind: KnowledgeTopicKind): boolean {
  const type = assetKind(value)
  if (kind === 'reasoning_edge') return type === 'reasoning-edge'
  return type === kind
}
function matchesFilters(value: KnowledgeAssetV04, filters: NormalizedFilters): boolean {
  const raw = dict(value)
  if (filters.observationType !== undefined && raw.observationType !== filters.observationType) return false
  if (filters.claimType !== undefined && raw.claimType !== filters.claimType) return false
  if (filters.relationType !== undefined && raw.type !== filters.relationType) return false
  return true
}

function countKinds(candidates: Map<string, Candidate>, traversalTruncated: boolean): Record<KnowledgeTopicKind, KnowledgeTopicSummaryCount> {
  const entries = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<KnowledgeTopicKind, number>
  for (const { value } of candidates.values()) {
    const kind = assetKind(value) === 'reasoning-edge' ? 'reasoning_edge' : assetKind(value) as KnowledgeTopicKind
    if (kind in entries) entries[kind] += 1
  }
  return Object.fromEntries(KINDS.map((kind) => [kind, { total: entries[kind], totalExact: !traversalTruncated, truncated: traversalTruncated }])) as Record<KnowledgeTopicKind, KnowledgeTopicSummaryCount>
}

function scopeOverview(candidates: Map<string, Candidate>, truncated: boolean): KnowledgeTopicSummary['overview'][KnowledgeTopicScope] {
  const values = [...candidates.values()]
  const nonSourceRecords = values.filter(({ value }) => assetKind(value) !== 'source')
  const latest = values.map(({ value }) => ({ value, date: dateOf(value) }))
    .filter((item): item is { value: KnowledgeAssetV04; date: { field: string; value: string } } => item.date !== undefined)
    .sort((a, b) => compareDateValues(b.date.value, a.date.value) || orderText(a.value.id, b.value.id))[0]
  const unreferenced = nonSourceRecords.filter(({ value }) => sourceRefsFor(dict(value)).length === 0).length
  return {
    ...(latest ? { latestDatedRecord: { ref: latest.value.id, kind: (assetKind(latest.value) === 'reasoning-edge' ? 'reasoning_edge' : assetKind(latest.value)) as KnowledgeTopicKind, dateField: latest.date.field, dateValue: latest.date.value } } : {}),
    nonSourceRecordsWithoutExplicitSourceRef: unreferenced,
    totalExact: !truncated,
    truncated,
  }
}

function projectItem(value: KnowledgeAssetV04, scope: KnowledgeTopicScope, paths: Map<string, KnowledgeTopicAssociationPath>, referencedByRefs: readonly string[] = []): KnowledgeTopicItem {
  const raw = dict(value)
  const kind = assetKind(value) === 'reasoning-edge' ? 'reasoning_edge' : assetKind(value) as KnowledgeTopicKind
  const lifecycleStatus = statusOf(value)
  const fields: Record<string, string | number | boolean | null | readonly string[]> = {}
  let label = safeText(raw.name, 300) ?? safeText(raw.title, 300) ?? value.id
  let summary: string | undefined
  let date = dateOf(value)
  const put = (key: string, field: unknown): void => {
    if (typeof field === 'string') {
      const sanitized = safeText(field, 2_000)
      if (sanitized !== undefined) fields[key] = sanitized
    } else if (typeof field === 'number' || typeof field === 'boolean' || field === null) fields[key] = field
    else if (Array.isArray(field)) fields[key] = field.map((entry) => safeText(entry, 300)).filter((entry): entry is string => entry !== undefined).slice(0, 64)
  }
  switch (kind) {
    case 'relation':
      label = safeText(raw.type, 100) ?? label
      summary = `${String(raw.sourceRef)} → ${String(raw.targetRef)}`
      for (const key of ['type', 'sourceRef', 'targetRef', 'contextRefs', 'asOf']) put(key, raw[key])
      break
    case 'claim':
      label = safeText(raw.claimType, 100) ?? 'claim'
      summary = safeText(raw.statement, 600)
      for (const key of ['claimType', 'subjectRefs', 'confidence', 'probability', 'asOf']) put(key, raw[key])
      break
    case 'observation':
      label = safeText(raw.observationType, 100) ?? 'observation'
      summary = safeText(raw.metricRef, 240)
      for (const key of ['observationType', 'subjectRef', 'metricRef', 'sourceRef']) put(key, raw[key])
      if (raw.observationType === 'metric') {
        for (const key of ['value', 'unit', 'period', 'observedAt', 'reportedAt', 'asOf']) put(key, raw[key])
        const dimensions = projectDimensions(raw.dimensions)
        if (dimensions.length) fields.dimensions = dimensions
      } else if (raw.observationType === 'estimate') {
        for (const key of ['fiscalPeriod', 'estimateValue', 'unit', 'currency', 'institutionRef', 'analystRef', 'publishedAt', 'estimateHorizon', 'revisionOf']) put(key, raw[key])
      } else if (raw.observationType === 'consensus') {
        for (const key of ['fiscalPeriod', 'asOf', 'mean', 'median', 'high', 'low', 'count', 'dispersion', 'contributingObservationRefs']) put(key, raw[key])
      }
      break
    case 'event':
      label = safeText(raw.eventType, 100) ?? 'event'
      summary = safeText(raw.title, 600)
      for (const key of ['eventType', 'subjectRefs']) put(key, raw[key])
      date = firstDate([['occurredAt', dict(raw.temporal).occurredAt], ['announcedAt', dict(raw.temporal).announcedAt], ['recordedAt', dict(raw.temporal).recordedAt]])
      break
    case 'thesis':
      label = safeText(raw.title, 300) ?? 'Thesis'
      summary = safeText(raw.statement, 600)
      for (const key of ['status', 'subjectRefs', 'lastReviewedAt', 'updatedAt']) put(key, raw[key])
      break
    case 'module':
      label = safeText(raw.type, 100) ?? 'module'
      for (const key of ['type', 'targetEntity', 'schemaId', 'updatedAt']) put(key, raw[key])
      break
    case 'source': {
      label = safeText(raw.title, 300) ?? 'Source'
      summary = safeText(raw.publisher, 240)
      for (const key of ['sourceType', 'provider', 'publisher', 'publishedAt', 'retrievedAt', 'contentHash']) put(key, raw[key])
      const backlinks = [...new Set(referencedByRefs)].sort(orderText)
      fields.referencedByRefs = backlinks.slice(0, MAX_SOURCE_BACKLINKS_PER_ITEM)
      fields.referencedByTotal = backlinks.length
      fields.referencedByTruncated = backlinks.length > MAX_SOURCE_BACKLINKS_PER_ITEM
      const rights = dict(raw.rights)
      const usagePolicy = dict(raw.usagePolicy)
      for (const [field, source] of [
        ['rightsAccessScope', 'accessScope'],
        ['rightsProviderTermsKnown', 'providerTermsKnown'],
        ['rightsRedistributionAllowed', 'redistributionAllowed'],
        ['rightsRetentionAllowed', 'retentionAllowed'],
        ['rightsAiProcessingAllowed', 'aiProcessingAllowed'],
        ['rightsDerivativeKnowledgeAllowed', 'derivativeKnowledgeAllowed'],
        ['rightsExpiresAt', 'expiresAt'],
        ['rightsPolicyBasis', 'policyBasis'],
      ] as const) put(field, rights[source])
      for (const [field, source] of [
        ['usagePolicyMode', 'mode'],
        ['usagePolicyRetainRaw', 'retainRaw'],
        ['usagePolicyAllowAiProcessing', 'allowAiProcessing'],
        ['usagePolicyAllowDerivedKnowledge', 'allowDerivedKnowledge'],
        ['usagePolicyRedistributionAllowed', 'redistributionAllowed'],
      ] as const) put(field, usagePolicy[source])
      if (canExposeSourceUrl(raw) && isSafeHttpUrl(raw.canonicalUrl)) put('canonicalUrl', raw.canonicalUrl)
      break
    }
    case 'reasoning_edge':
      label = safeText(raw.type, 100) ?? 'reasoning edge'
      summary = `${String(raw.sourceRef)} → ${String(raw.targetRef)}`
      for (const key of ['type', 'sourceRef', 'targetRef', 'confidence', 'asOf']) put(key, raw[key])
      break
  }
  if (kind === 'thesis') fields.lifecycleStatus = lifecycleStatus
  return {
    ref: value.id,
    kind,
    scope,
    lifecycleStatus,
    label,
    ...(summary ? { summary } : {}),
    fields,
    ...(date ? { date } : {}),
    ...(scope === 'connected' ? { associationPaths: dedupePaths([...paths.values()]).slice(0, MAX_PATHS_PER_ITEM) } : {}),
  }
}

function projectDimensions(value: unknown): string[] {
  const dimensions = dict(value)
  return Object.entries(dimensions).sort(([a], [b]) => orderText(a, b)).flatMap(([key, raw]) => {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || !(typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) return []
    const safeValue = safeText(String(raw), 120)
    return safeValue === undefined ? [] : [`${key}=${safeValue}`]
  }).slice(0, 32)
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\b[A-Za-z]:[\\/][^\s<>"']+/g, '[local path omitted]')
    .replace(/\\\\[^\s<>"']+/g, '[local path omitted]')
    .replace(/file:\/\/[^\s<>"']+/gi, '[local path omitted]')
    .replace(/(^|[\s("'=])\/[^\s<>"']+/g, '$1[local path omitted]')
    .trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}
function canExposeSourceUrl(raw: Dict): boolean {
  const rights = dict(raw.rights)
  return rights.accessScope === 'public' && rights.providerTermsKnown === true
}
function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || !HTTP_URL.test(value)) return false
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password } catch { return false }
}
function dateOf(value: KnowledgeAssetV04): { field: string; value: string } | undefined {
  const raw = dict(value)
  const temporal = dict(raw.temporal)
  return firstDate([
    ['occurredAt', temporal.occurredAt], ['announcedAt', temporal.announcedAt], ['publishedAt', raw.publishedAt],
    ['reportedAt', raw.reportedAt], ['observedAt', raw.observedAt], ['asOf', raw.asOf ?? temporal.asOf],
    ['recordedAt', raw.recordedAt ?? temporal.recordedAt], ['lastReviewedAt', raw.lastReviewedAt], ['createdAt', raw.createdAt],
  ])
}
function firstDate(values: readonly (readonly [string, unknown])[]): { field: string; value: string } | undefined {
  for (const [field, raw] of values) if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) return { field, value: raw }
  return undefined
}
function compareItems(a: KnowledgeTopicItem, b: KnowledgeTopicItem): number {
  if (a.date && b.date) return compareDateValues(b.date.value, a.date.value) || orderText(a.ref, b.ref)
  if (a.date) return -1
  if (b.date) return 1
  return orderText(a.ref, b.ref)
}

function compareDateValues(a: string, b: string): number {
  const instantA = Date.parse(a)
  const instantB = Date.parse(b)
  if (instantA === instantB) return 0
  return instantA < instantB ? -1 : 1
}

function focusRefProjection(refs: readonly string[]): { readonly focusRefs: readonly string[]; readonly focusRefsTotal: number; readonly focusRefsTruncated: boolean } {
  return {
    focusRefs: refs.slice(0, MAX_FOCUS_REFS),
    focusRefsTotal: refs.length,
    focusRefsTruncated: refs.length > MAX_FOCUS_REFS,
  }
}

function serializedTopicResponseBytes(value: KnowledgeTopicSummary | KnowledgeTopicItemPage): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function assertTopicResponseSize(value: KnowledgeTopicSummary | KnowledgeTopicItemPage): void {
  if (serializedTopicResponseBytes(value) > MAX_TOPIC_RESPONSE_BYTES) throw topicError('failed', 'topic_response_too_large: topic response exceeds the 1 MiB bound')
}

function encodeCursor(payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', CURSOR_SECRET).update(body).digest('base64url')
  return `${body}.${signature}`
}
function decodeCursor(cursor: string): CursorPayload {
  if (typeof cursor !== 'string' || cursor.length > 4_096) throw topicError('invalid_input', 'Malformed topic page cursor')
  const [body, signature, extra] = cursor.split('.')
  if (!body || !signature || extra !== undefined) throw topicError('invalid_input', 'Malformed topic page cursor')
  const expected = createHmac('sha256', CURSOR_SECRET).update(body).digest()
  let supplied: Buffer
  try { supplied = Buffer.from(signature, 'base64url') } catch { throw topicError('invalid_input', 'Malformed topic page cursor') }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw topicError('invalid_input', 'Malformed topic page cursor')
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload
    if (!parsed || parsed.v !== 1 || typeof parsed.after !== 'string' || typeof parsed.kb !== 'string' || typeof parsed.theme !== 'string') throw new Error('shape')
    return parsed
  } catch { throw topicError('invalid_input', 'Malformed topic page cursor') }
}
