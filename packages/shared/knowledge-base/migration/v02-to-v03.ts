import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { KNOWLEDGE_SCHEMA_V03 } from '../../../schemas/knowledge/v03/executable-schema.ts'
import { CanonicalV02KnowledgeLoader } from '../canonical-v02-loader.ts'
import { canonicalSerialize } from '../canonical-hash.ts'
import { parseYaml } from '../yaml.ts'
import type { KnowledgeBaseHandle } from '../handle.ts'
import type { KnowledgeAssetCollection } from '../types.ts'
import type { KnowledgeIdMapping, MigrationReviewItem } from '../../../schemas/knowledge/migrations/types.ts'
import type {
  KnowledgeMigrationWarning,
  KnowledgeV03SourceInventory,
  KnowledgeV03TargetInventory,
  V02ToV03TransformResult,
} from './types.ts'

const MIGRATION_ID = 'knowledge-schema-0.2-to-0.3'
const ENTITY_PREFIXES = ['industry:', 'segment:', 'company:', 'product:', 'technology:'] as const
const CLAIM_TYPES = new Set(['fact', 'forecast', 'viewpoint', 'trend', 'risk'])
const SOURCE_TYPES = new Set<string>(KNOWLEDGE_SCHEMA_V03.source.types)
const SOURCE_RELIABILITIES = new Set<string>(KNOWLEDGE_SCHEMA_V03.source.reliabilities)
const LIFECYCLE_STATUSES = new Set<string>(KNOWLEDGE_SCHEMA_V03.lifecycle.values)
const MODULE_TYPES = new Set<string>(KNOWLEDGE_SCHEMA_V03.module.types)

type Dict = Record<string, unknown>
type EntityInfo = { oldType: string; targetType: string; targetId: string }
type RelationPlan = {
  oldId: string
  initialId: string
  targetId: string
  type: string
  sourceId: string
  targetIdLegacy: string
  normalizedSourceId: string
  normalizedTargetId: string
  legacyContextRefs?: unknown
  legacySupportingClaimRefs?: unknown
  legacySourceRefs?: unknown
  legacyAttributes?: Dict
  attributes?: Dict
  common: Dict
  dedupeSafe: boolean
  output: boolean
}

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function nonEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (isDict(value)) return Object.keys(value).length > 0
  return true
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sourceRelativePath(root: string, filePath: string): string {
  return relative(resolve(root), resolve(filePath)).replaceAll('\\', '/')
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

async function listFiles(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return []
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(path))
    else result.push(path)
  }
  return result.sort((left, right) => left.localeCompare(right))
}

function oldSuffix(id: string): string {
  const separator = id.indexOf(':')
  return separator >= 0 ? id.slice(separator + 1) : id
}

function targetId(prefix: string, id: string): string {
  return `${prefix}${oldSuffix(id)}`
}

function inventory(source: KnowledgeAssetCollection): KnowledgeV03SourceInventory {
  const entityIds = sortedUnique(source.entities.map((item) => item.value.id))
  const relationIds = sortedUnique(source.relations.map((item) => item.value.id))
  const intelligenceIds = sortedUnique(source.intelligence.map((item) => item.value.id))
  const moduleIds = sortedUnique(source.modules.map((item) => item.value.id))
  const sourceIds = sortedUnique(source.sources.map((item) => item.value.id))
  return {
    entityIds,
    relationIds,
    intelligenceIds,
    moduleIds,
    sourceIds,
    counts: {
      entities: entityIds.length,
      relations: relationIds.length,
      intelligence: intelligenceIds.length,
      modules: moduleIds.length,
      sources: sourceIds.length,
    },
  }
}

function targetInventory(input: {
  themeGroups: Dict[]
  entities: Dict[]
  relations: Dict[]
  claims: Dict[]
  modules: Dict[]
  sources: Dict[]
  taxonomyFiles: string[]
  taxonomyItemIds: string[]
  viewFiles: string[]
}): KnowledgeV03TargetInventory {
  const ids = (items: Dict[]) => sortedUnique(items.flatMap((item) => nonEmptyString(item.id) ? [item.id] : []))
  const themeGroupIds = ids(input.themeGroups)
  const entityIds = ids(input.entities)
  const relationIds = ids(input.relations)
  const claimIds = ids(input.claims)
  const moduleIds = ids(input.modules)
  const sourceIds = ids(input.sources)
  return {
    themeGroupIds,
    entityIds,
    relationIds,
    claimIds,
    moduleIds,
    sourceIds,
    auxiliary: {
      taxonomyFiles: [...input.taxonomyFiles].sort((left, right) => left.localeCompare(right)),
      taxonomyItemIds: sortedUnique(input.taxonomyItemIds),
      viewFiles: [...input.viewFiles].sort((left, right) => left.localeCompare(right)),
    },
    counts: {
      themeGroups: themeGroupIds.length,
      entities: entityIds.length,
      relations: relationIds.length,
      claims: claimIds.length,
      modules: moduleIds.length,
      sources: sourceIds.length,
    },
  }
}

function lifecycle(value: unknown): Dict | undefined {
  if (!isDict(value) || !LIFECYCLE_STATUSES.has(String(value.status))) return undefined
  const result: Dict = { status: value.status }
  if (value.validFrom === null || nonEmptyString(value.validFrom)) result.validFrom = value.validFrom
  if (value.validUntil === null || nonEmptyString(value.validUntil)) result.validUntil = value.validUntil
  return result
}

function scalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function addKnown(target: Dict, source: Dict, field: string, predicate: (value: unknown) => boolean = () => true): void {
  if (source[field] !== undefined && predicate(source[field])) target[field] = clone(source[field])
}

function inspectUnmappedFields(
  source: Dict,
  allowed: Set<string>,
  reviews: ReviewCollector,
  assetId: string,
  description: string,
): void {
  const unmapped = Object.keys(source).filter((field) => !allowed.has(field) && nonEmpty(source[field]))
  if (unmapped.length > 0) {
    reviews.add('legacy_semantic_field_unmapped', description, 'review_legacy_semantics', assetId, {
      fields: unmapped.sort((left, right) => left.localeCompare(right)),
    })
  }
}

function declaredRef(ref: unknown, mappings: Map<string, string>): string | undefined {
  return nonEmptyString(ref) ? mappings.get(ref) : undefined
}

function addWarning(
  warnings: KnowledgeMigrationWarning[],
  code: string,
  description: string,
  assetId?: string,
  details?: Dict,
): void {
  warnings.push({ code, description, ...(assetId ? { assetId } : {}), ...(details ? { details: clone(details) } : {}) })
}

function requiredLifecycle(
  value: unknown,
  assetId: string,
  kind: 'Entity' | 'Relation' | 'Intelligence',
  reviews: ReviewCollector,
  warnings: KnowledgeMigrationWarning[],
): Dict {
  const life = lifecycle(value)
  if (life) return life
  if (value === undefined) {
    addWarning(warnings, 'legacy_lifecycle_default_active', `Legacy ${kind} has no lifecycle; v0.3 defaults it to active.`, assetId, { targetKind: kind.toLowerCase() })
    return { status: 'active' }
  }
  reviews.add('lifecycle_invalid', `Legacy ${kind} lifecycle is not a legal v0.3 lifecycle and cannot be preserved.`, 'provide_valid_lifecycle', assetId, { lifecycle: value })
  return { status: 'active' }
}

function preserveLegacyMetadata(
  metadata: unknown,
  additions: Dict,
  reviews: ReviewCollector,
  warnings: KnowledgeMigrationWarning[],
  assetId: string,
): Dict | undefined {
  const result: Dict = isDict(metadata) ? clone(metadata) : {}
  if (Object.keys(additions).length === 0) return Object.keys(result).length > 0 ? result : undefined
  const existing = result.legacyV02
  if (existing !== undefined && !isDict(existing)) {
    reviews.add('legacy_metadata_collision', 'Legacy v0.02 metadata cannot be preserved because metadata.legacyV02 is not an object.', 'resolve_legacy_metadata_collision', assetId)
    return Object.keys(result).length > 0 ? result : undefined
  }
  const legacy = isDict(existing) ? clone(existing) : {}
  const collisions = Object.keys(additions).filter((field) => Object.prototype.hasOwnProperty.call(legacy, field))
  if (collisions.length > 0) {
    reviews.add('legacy_metadata_collision', 'Legacy v0.02 metadata field collides with an existing metadata.legacyV02 field.', 'resolve_legacy_metadata_collision', assetId, { fields: collisions.sort((left, right) => left.localeCompare(right)) })
  }
  for (const [field, value] of Object.entries(additions)) if (!Object.prototype.hasOwnProperty.call(legacy, field)) legacy[field] = clone(value)
  result.legacyV02 = legacy
  addWarning(warnings, 'legacy_metadata_preserved', 'Legacy fields were preserved under metadata.legacyV02.', assetId, { fields: Object.keys(additions).sort((left, right) => left.localeCompare(right)) })
  return result
}

function legacyTemporal(source: Dict, type: string): Dict | undefined {
  const candidates: Array<{ value: unknown; precision?: unknown; kind: 'period' | 'occurredAt' }> = []
  if (nonEmpty(source.period)) candidates.push({ value: source.period, kind: 'period' })
  if (type === 'trend' && nonEmpty(source.timeHorizon)) candidates.push({ value: source.timeHorizon, kind: 'period' })
  if (nonEmpty(source.occurredAt)) candidates.push({ value: source.occurredAt, precision: source.datePrecision, kind: 'occurredAt' })
  const candidate = candidates.find((item) => nonEmptyString(item.value))
  if (!candidate) return undefined
  const label = String(candidate.value)
  if (candidate.kind === 'period') return { asOf: null, scope: { type: 'period', start: null, end: null, label } }
  const scopeType = candidate.precision === 'day' ? 'point' : ['year', 'month', 'quarter', 'period'].includes(String(candidate.precision)) ? 'period' : 'unknown'
  return { asOf: null, scope: { type: scopeType, start: null, end: null, label } }
}

function noteTemporalConflict(source: Dict, type: string, explicitTemporal: Dict | undefined, reviews: ReviewCollector, assetId: string): void {
  const legacy = legacyTemporal(source, type)
  if (!legacy || !explicitTemporal || !isDict(explicitTemporal.scope)) return
  const legacyLabel = legacy.scope && isDict(legacy.scope) ? legacy.scope.label : undefined
  const explicitLabel = explicitTemporal.scope.label
  if (nonEmptyString(legacyLabel) && explicitLabel !== null && explicitLabel !== legacyLabel) {
    reviews.add('temporal_semantic_conflict', 'Legacy temporal field conflicts with the explicit v0.3 temporal label.', 'review_claim_temporal', assetId, { legacyLabel, explicitLabel })
  }
}

class ReviewCollector {
  private sequence = 0
  readonly items: MigrationReviewItem[] = []

  constructor(private readonly runId: string, private readonly knowledgeBaseId: string) {}

  add(code: string, description: string, suggestedAction: string, assetId?: string, details?: Dict): void {
    this.sequence += 1
    this.items.push({
      reviewItemId: `review-${code}-${assetId ?? 'knowledge-base'}-${String(this.sequence).padStart(4, '0')}`,
      migrationRunId: this.runId,
      knowledgeBaseId: this.knowledgeBaseId,
      migrationId: MIGRATION_ID,
      code,
      ...(assetId ? { assetId } : {}),
      description,
      suggestedAction,
      ...(details ? { details: clone(details) } : {}),
    })
  }
}

function mapping(from: string, to: string, reason: string): KnowledgeIdMapping {
  return { from, to, reason }
}

function mapEntityType(type: unknown): string | undefined {
  if (type === 'industry') return 'investment_theme'
  if (type === 'segment') return 'industry'
  if (type === 'company' || type === 'product' || type === 'technology') return type
  return undefined
}

function mapEntityId(id: string): string | undefined {
  if (!ENTITY_PREFIXES.some((prefix) => id.startsWith(prefix))) return undefined
  return targetId('entity:', id)
}

function mapRelationId(id: string): string {
  return targetId('relation:', id)
}

function mapClaimId(id: string): string {
  return targetId('claim:', id)
}

function mapSourceId(id: string): string {
  return targetId('source:', id)
}

function mapModuleId(id: string): string {
  return targetId('module:', id)
}

function registerCollision(
  mappings: Map<string, string>,
  candidates: Map<string, string[]>,
  from: string,
  to: string,
): void {
  const values = candidates.get(to) ?? []
  values.push(from)
  candidates.set(to, values)
  if (!mappings.has(from)) mappings.set(from, to)
}

function mappingCollisions(
  candidates: Map<string, string[]>,
  reviews: ReviewCollector,
): Set<string> {
  const collided = new Set<string>()
  for (const [to, from] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const sources = sortedUnique(from)
    if (sources.length < 2) continue
    collided.add(to)
    reviews.add('target_id_collision', `Multiple legacy IDs map to the same target ID: ${to}.`, 'resolve_target_id_collision', undefined, { targetId: to, sourceIds: sources })
  }
  return collided
}

function mapArrayRefs(
  value: unknown,
  mappings: Map<string, string>,
  reviews: ReviewCollector,
  assetId: string,
  code: string,
): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const ref of value) {
    const mapped = declaredRef(ref, mappings)
    if (mapped) result.push(mapped)
    else if (nonEmptyString(ref)) reviews.add(code, `Declared canonical reference cannot be resolved: ${String(ref)}.`, 'resolve_declared_reference', assetId, { reference: ref })
  }
  return sortedUnique(result)
}

function mapOptionalRef(value: unknown, mappings: Map<string, string>, reviews: ReviewCollector, assetId: string, code: string): string | undefined {
  const mapped = declaredRef(value, mappings)
  if (mapped) return mapped
  if (nonEmptyString(value)) reviews.add(code, `Declared canonical reference cannot be resolved: ${String(value)}.`, 'resolve_declared_reference', assetId, { reference: value })
  return undefined
}

function commonRelationFields(
  source: Dict,
): Dict {
  const result: Dict = {}
  if (source.confidence === null || (typeof source.confidence === 'number' && source.confidence >= 0 && source.confidence <= 1)) result.confidence = source.confidence
  if (source.asOf === null || nonEmptyString(source.asOf)) result.asOf = source.asOf
  const life = lifecycle(source.lifecycle)
  if (life) result.lifecycle = life
  if (nonEmptyString(source.createdAt)) result.createdAt = source.createdAt
  if (nonEmptyString(source.updatedAt)) result.updatedAt = source.updatedAt
  return result
}

interface AuxiliaryInventory {
  taxonomyFiles: string[]
  taxonomyItemIds: string[]
  viewFiles: string[]
  parsedTaxonomy: Array<{ path: string; value: unknown }>
  parsedViews: Array<{ path: string; value: unknown }>
}

async function auxiliaryInventory(root: string): Promise<AuxiliaryInventory> {
  const taxonomyRoot = join(root, 'taxonomy')
  const viewsRoot = join(root, 'views')
  const taxonomyFiles = (await listFiles(taxonomyRoot)).map((path) => sourceRelativePath(root, path))
  const viewFiles = (await listFiles(viewsRoot)).map((path) => sourceRelativePath(root, path))
  const parsedTaxonomy: Array<{ path: string; value: unknown }> = []
  const parsedViews: Array<{ path: string; value: unknown }> = []
  for (const path of taxonomyFiles) {
    const absolute = join(root, path)
    try { parsedTaxonomy.push({ path, value: parseYaml(await readFile(absolute, 'utf8'), absolute) }) } catch { parsedTaxonomy.push({ path, value: undefined }) }
  }
  for (const path of viewFiles) {
    const absolute = join(root, path)
    try { parsedViews.push({ path, value: parseYaml(await readFile(absolute, 'utf8'), absolute) }) } catch { parsedViews.push({ path, value: undefined }) }
  }
  const taxonomyItemIds = parsedTaxonomy.flatMap(({ value }) => {
    const ids: string[] = []
    const visit = (candidate: unknown): void => {
      if (Array.isArray(candidate)) { candidate.forEach(visit); return }
      if (!isDict(candidate)) return
      if (nonEmptyString(candidate.id)) ids.push(candidate.id)
      Object.values(candidate).forEach(visit)
    }
    visit(value)
    return ids
  })
  return { taxonomyFiles, taxonomyItemIds: sortedUnique(taxonomyItemIds), viewFiles, parsedTaxonomy, parsedViews }
}

function rewriteAuxiliaryValue(
  value: unknown,
  field: 'graphRefs' | 'targetEntity',
  mappings: Map<string, string>,
  reviews: ReviewCollector,
  assetPath: string,
): { value: unknown; changed: boolean } {
  let changed = false
  const rewrite = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map((item) => rewrite(item))
    if (!isDict(candidate)) return candidate
    const result: Dict = {}
    for (const [key, child] of Object.entries(candidate)) {
      if (key === field) {
        if (Array.isArray(child)) {
          result[key] = child.map((ref) => {
            const mapped = declaredRef(ref, mappings)
            if (mapped) { changed = true; return mapped }
            if (nonEmptyString(ref)) reviews.add('unresolved_auxiliary_declared_ref', `Auxiliary declared reference cannot be resolved: ${String(ref)}.`, 'resolve_auxiliary_reference', assetPath, { field, reference: ref })
            return ref
          })
        } else {
          const mapped = declaredRef(child, mappings)
          if (mapped) { changed = true; result[key] = mapped }
          else {
            if (nonEmptyString(child)) reviews.add('unresolved_auxiliary_declared_ref', `Auxiliary declared reference cannot be resolved: ${String(child)}.`, 'resolve_auxiliary_reference', assetPath, { field, reference: child })
            result[key] = child
          }
        }
      } else {
        result[key] = rewrite(child)
      }
    }
    return result
  }
  return { value: rewrite(value), changed }
}

async function rewriteAuxiliaryFiles(
  stagingRoot: string,
  auxiliary: AuxiliaryInventory,
  mappings: Map<string, string>,
  reviews: ReviewCollector,
): Promise<string[]> {
  const changedFiles: string[] = []
  for (const entry of auxiliary.parsedTaxonomy) {
    if (entry.value === undefined) continue
    const rewritten = rewriteAuxiliaryValue(entry.value, 'graphRefs', mappings, reviews, entry.path)
    if (rewritten.changed) {
      await writeFile(join(stagingRoot, entry.path), `${canonicalSerialize(rewritten.value)}\n`, 'utf8')
      changedFiles.push(entry.path)
    }
  }
  for (const entry of auxiliary.parsedViews) {
    if (entry.value === undefined) continue
    const rewritten = rewriteAuxiliaryValue(entry.value, 'targetEntity', mappings, reviews, entry.path)
    if (rewritten.changed) {
      await writeFile(join(stagingRoot, entry.path), `${canonicalSerialize(rewritten.value)}\n`, 'utf8')
      changedFiles.push(entry.path)
    }
  }
  return changedFiles.sort((left, right) => left.localeCompare(right))
}

function transformEntity(
  source: Dict,
  info: EntityInfo,
  taxonomyIds: Set<string>,
  mappings: Map<string, string>,
  reviews: ReviewCollector,
  warnings: KnowledgeMigrationWarning[],
): Dict {
  const result: Dict = { id: info.targetId, type: info.targetType }
  if (nonEmptyString(source.name)) result.name = source.name
  else reviews.add('required_field_missing', 'Legacy Entity has no deterministic name for the required v0.3 Entity name field.', 'provide_entity_name', String(source.id))
  addKnown(result, source, 'aliases', Array.isArray)
  addKnown(result, source, 'description', (value) => value === null || typeof value === 'string')
  addKnown(result, source, 'externalIds', isDict)
  if (Array.isArray(source.taxonomyRefs)) {
    const resolved: string[] = []
    for (const ref of source.taxonomyRefs) {
      if (nonEmptyString(ref) && taxonomyIds.has(ref)) resolved.push(ref)
      else if (nonEmptyString(ref)) reviews.add('unresolved_auxiliary_declared_ref', `Entity taxonomy reference cannot be resolved: ${ref}.`, 'resolve_taxonomy_reference', String(source.id), { field: 'taxonomyRefs', reference: ref })
    }
    if (resolved.length > 0) result.taxonomyRefs = sortedUnique(resolved)
  }
  const legacyMetadata: Dict = {}
  if (nonEmpty(source.listingStatus)) legacyMetadata.listingStatus = clone(source.listingStatus)
  if (Array.isArray(source.tags) && source.tags.length > 0) legacyMetadata.tags = clone(source.tags)
  if (Array.isArray(source.sourceRefs)) {
    legacyMetadata.sourceRefs = mapArrayRefs(source.sourceRefs, mappings, reviews, String(source.id), 'unresolved_entity_source_ref')
  } else if (source.sourceRefs !== undefined && nonEmpty(source.sourceRefs)) {
    reviews.add('unresolved_entity_source_ref', 'Legacy Entity sourceRefs must be an array to map deterministically.', 'review_entity_sources', String(source.id))
  }
  const metadata = preserveLegacyMetadata(source.metadata, legacyMetadata, reviews, warnings, String(source.id))
  if (metadata) result.metadata = metadata
  result.lifecycle = requiredLifecycle(source.lifecycle, String(source.id), 'Entity', reviews, warnings)
  addKnown(result, source, 'createdAt', nonEmptyString)
  addKnown(result, source, 'updatedAt', nonEmptyString)
  if (info.targetType === 'company') {
    addKnown(result, source, 'ticker', (value) => value === null || typeof value === 'string')
    addKnown(result, source, 'exchange', (value) => value === null || typeof value === 'string')
    addKnown(result, source, 'legalName', (value) => value === null || typeof value === 'string')
  }
  if (info.oldType === 'industry') {
    result.themeGroupRef = 'theme-group:unclassified'
  }
  inspectUnmappedFields(source, new Set([
    'id', 'type', 'name', 'aliases', 'description', 'externalIds', 'taxonomyRefs', 'metadata',
    'lifecycle', 'createdAt', 'updatedAt', 'ticker', 'exchange', 'legalName', 'listingStatus', 'tags', 'sourceRefs',
  ]), reviews, String(source.id), 'Legacy Entity contains non-empty fields without a deterministic v0.3 destination.')
  return result
}

function transformSource(source: Dict, mappedId: string, reviews: ReviewCollector, warnings: KnowledgeMigrationWarning[]): Dict {
  const result: Dict = { id: mappedId }
  if (nonEmptyString(source.title)) result.title = source.title
  else reviews.add('required_field_missing', 'Legacy Source has no deterministic title for the required v0.3 Source title field.', 'provide_source_title', String(source.id))
  let sourceType: string | undefined
  if (SOURCE_TYPES.has(String(source.sourceType))) sourceType = String(source.sourceType)
  else {
    sourceType = 'unknown'
    addWarning(warnings, 'legacy_source_type_unknown', 'Legacy Source sourceType is absent or unsupported; v0.3 uses unknown while preserving the legacy top-level type.', String(source.id), {
      ...(source.type !== undefined ? { type: source.type } : {}),
      ...(source.sourceType !== undefined ? { sourceType: source.sourceType } : {}),
    })
  }
  result.sourceType = sourceType
  addKnown(result, source, 'type', (value) => value === null || typeof value === 'string')
  for (const field of ['publisher', 'institution', 'author', 'publishedAt', 'url']) addKnown(result, source, field, (value) => value === null || typeof value === 'string')
  addKnown(result, source, 'quality', (value) => scalar(value) || isDict(value) || Array.isArray(value))
  if (SOURCE_RELIABILITIES.has(String(source.sourceReliability))) result.sourceReliability = source.sourceReliability
  else if (source.sourceReliability !== undefined) reviews.add('unsupported_custom_legacy_reliability', 'Legacy Source reliability cannot be mapped to the canonical v0.3 reliability enum.', 'review_source_semantics', String(source.id), { sourceReliability: source.sourceReliability })
  addKnown(result, source, 'rawRefs', (value) => Array.isArray(value) && value.every(nonEmptyString))
  const legacyMetadata: Dict = {}
  if (nonEmpty(source.documentType)) legacyMetadata.documentType = clone(source.documentType)
  const metadata = preserveLegacyMetadata(source.metadata, legacyMetadata, reviews, warnings, String(source.id))
  if (metadata) result.metadata = metadata
  const life = lifecycle(source.lifecycle)
  if (life) result.lifecycle = life
  addKnown(result, source, 'createdAt', nonEmptyString)
  addKnown(result, source, 'updatedAt', nonEmptyString)
  inspectUnmappedFields(source, new Set([
    'id', 'type', 'title', 'sourceType', 'publisher', 'institution', 'author', 'publishedAt', 'url',
    'quality', 'sourceReliability', 'rawRefs', 'metadata', 'documentType', 'lifecycle', 'createdAt', 'updatedAt',
  ]), reviews, String(source.id), 'Legacy Source contains non-empty fields without a deterministic v0.3 destination.')
  return result
}

function claimStatement(source: Dict, type: string): string | undefined {
  if (nonEmptyString(source.statement)) return source.statement
  if ((type === 'trend' || type === 'risk') && nonEmptyString(source.description)) return source.description
  return undefined
}

function transformClaim(
  source: Dict,
  mappedId: string,
  mappings: Map<string, string>,
  reviews: ReviewCollector,
  warnings: KnowledgeMigrationWarning[],
): Dict {
  const type = String(source.type)
  const statement = claimStatement(source, type)
  if (!statement) reviews.add('claim_statement_missing', 'Legacy Intelligence has no deterministic non-empty Claim statement source.', 'provide_claim_statement', String(source.id), { type })
  const subjectRefs = mapArrayRefs(
    [...(Array.isArray(source.entityRefs) ? source.entityRefs : []), ...(Array.isArray(source.affectedEntityRefs) ? source.affectedEntityRefs : [])],
    mappings,
    reviews,
    String(source.id),
    'unresolved_claim_subject_ref',
  )
  const result: Dict = {
    id: mappedId,
    claimType: type,
    statement: statement ?? '',
    subjectRefs,
    sourceRefs: mapArrayRefs(source.sourceRefs, mappings, reviews, String(source.id), 'unresolved_claim_source_ref'),
  }
  if (source.entityRefs !== undefined && !Array.isArray(source.entityRefs)) reviews.add('unresolved_claim_subject_ref', 'Legacy Intelligence entityRefs must be an array to map deterministically.', 'review_claim_subjects', String(source.id))
  if (source.affectedEntityRefs !== undefined && !Array.isArray(source.affectedEntityRefs)) reviews.add('unresolved_claim_subject_ref', 'Legacy Intelligence affectedEntityRefs must be an array to map deterministically.', 'review_claim_subjects', String(source.id))
  if (source.entityRefs === undefined && source.affectedEntityRefs === undefined) reviews.add('claim_subject_refs_missing', 'Legacy Intelligence has no entityRefs or affectedEntityRefs for the required v0.3 Claim subjectRefs.', 'provide_claim_subjects', String(source.id))
  if (source.sourceRefs !== undefined && !Array.isArray(source.sourceRefs)) reviews.add('unresolved_claim_source_ref', 'Legacy Intelligence sourceRefs must be an array to map deterministically.', 'review_claim_sources', String(source.id))
  if (source.sourceRefs === undefined) reviews.add('claim_source_refs_missing', 'Legacy Intelligence has no sourceRefs for the required v0.3 Claim sourceRefs.', 'provide_claim_sources', String(source.id))
  const primary = mapOptionalRef(source.primarySubjectRef, mappings, reviews, String(source.id), 'unresolved_claim_subject_ref')
  if (primary) result.primarySubjectRef = primary
  const explicitTemporal = isDict(source.temporal) ? clone(source.temporal) : undefined
  if (explicitTemporal) result.temporal = explicitTemporal
  else {
    const temporal = legacyTemporal(source, type)
    if (temporal) result.temporal = temporal
  }
  noteTemporalConflict(source, type, explicitTemporal, reviews, String(source.id))
  const explicitStructuredValue = isDict(source.structuredValue)
  if (explicitStructuredValue) result.structuredValue = clone(source.structuredValue)
  if (!explicitStructuredValue && type === 'forecast' && nonEmptyString(source.metric) && !scalar(source.value)) {
    result.structuredValue = { metric: source.metric, value: null, unit: nonEmptyString(source.unit) ? source.unit : null, comparator: null }
  } else if (!explicitStructuredValue && nonEmptyString(source.metric) && scalar(source.value)) {
    const structuredValue: Dict = { metric: source.metric, value: source.value, unit: nonEmptyString(source.unit) ? source.unit : null, comparator: null }
    if (source.comparator === undefined || ['eq', 'gt', 'gte', 'lt', 'lte', 'approx'].includes(String(source.comparator))) structuredValue.comparator = source.comparator ?? null
    else reviews.add('legacy_semantic_field_unmapped', 'Legacy Claim comparator is not in the frozen v0.3 comparator vocabulary.', 'review_claim_structured_value', String(source.id), { fields: ['comparator'] })
    result.structuredValue = structuredValue
  }
  if (Array.isArray(source.provenance)) {
    result.provenance = source.provenance.flatMap((item) => {
      if (!isDict(item)) return []
      const mappedSource = mapOptionalRef(item.sourceRef, mappings, reviews, String(source.id), 'unresolved_claim_source_ref')
      if (!mappedSource || !nonEmptyString(item.rawRef)) return []
      return [{ sourceRef: mappedSource, rawRef: item.rawRef, locator: item.locator ?? null, chunkRef: item.chunkRef ?? null }]
    })
  }
  if (source.confidence === null || (typeof source.confidence === 'number' && source.confidence >= 0 && source.confidence <= 1)) result.confidence = source.confidence
  result.lifecycle = requiredLifecycle(source.lifecycle, String(source.id), 'Intelligence', reviews, warnings)
  if (!CLAIM_TYPES.has(type)) reviews.add('unsupported_legacy_intelligence_type', 'Legacy Intelligence type is not in the frozen v0.3 Claim vocabulary.', 'review_claim_type', String(source.id), { type })
  if (nonEmpty(source.category)) addWarning(warnings, 'legacy_claim_category_discarded', 'Legacy Intelligence category has no v0.3 Claim field and was discarded after explicit policy review.', String(source.id), { category: source.category })
  if (type === 'fact' && nonEmpty(source.impact)) reviews.add('event_impact_requires_decomposition', 'Legacy event fact impact cannot be represented losslessly as a single v0.3 Claim field.', 'decompose_event_impact', String(source.id), { fields: ['impact'] })
  for (const field of ['supersedes', 'supersededBy']) {
    if (Array.isArray(source[field])) result[field] = mapArrayRefs(source[field], mappings, reviews, String(source.id), 'unresolved_claim_reference')
  }
  addKnown(result, source, 'createdAt', nonEmptyString)
  addKnown(result, source, 'updatedAt', nonEmptyString)

  const reviewFields = new Set<string>()
  const reviewIfNonEmpty = (field: string): void => { if (nonEmpty(source[field])) reviewFields.add(field) }
  if (explicitStructuredValue) {
    for (const field of ['metric', 'value', 'unit', 'comparator']) reviewIfNonEmpty(field)
  } else if (type !== 'forecast' && (nonEmpty(source.metric) || nonEmpty(source.value) || nonEmpty(source.unit))) {
    if (!(nonEmptyString(source.metric) && scalar(source.value))) {
      for (const field of ['metric', 'value', 'unit']) reviewIfNonEmpty(field)
    }
  }
  if (type === 'forecast') for (const field of ['values', 'assumptions']) reviewIfNonEmpty(field)
  if (type === 'viewpoint') for (const field of ['bullishPoints', 'bearishPoints', 'keyVariables']) reviewIfNonEmpty(field)
  if (type === 'trend') for (const field of ['direction', 'drivers']) reviewIfNonEmpty(field)
  if (type === 'risk') for (const field of ['trigger', 'impact', 'probability']) reviewIfNonEmpty(field)
  if (type === 'fact' && nonEmpty(source.description)) reviewFields.add('description')
  if ((type === 'trend' || type === 'risk') && nonEmpty(source.description) && nonEmptyString(source.statement)) reviewFields.add('description')
  if (reviewFields.size > 0) reviews.add('legacy_semantic_field_unmapped', 'Legacy Intelligence contains semantic fields that cannot be represented losslessly by the v0.3 Claim contract.', 'review_legacy_claim_semantics', String(source.id), { fields: [...reviewFields].sort((left, right) => left.localeCompare(right)) })
  inspectUnmappedFields(source, new Set([
    'id', 'type', 'entityRefs', 'affectedEntityRefs', 'sourceRefs', 'statement', 'description', 'primarySubjectRef',
    'temporal', 'occurredAt', 'datePrecision', 'structuredValue', 'metric', 'value', 'unit', 'comparator', 'category', 'period',
    'provenance', 'confidence', 'lifecycle', 'supersedes', 'supersededBy', 'createdAt', 'updatedAt',
    'values', 'assumptions', 'bullishPoints', 'bearishPoints', 'keyVariables', 'direction',
    'drivers', 'timeHorizon', 'trigger', 'impact', 'probability',
  ]), reviews, String(source.id), 'Legacy Intelligence contains non-empty fields without an explicit v0.3 disposition.')
  return result
}

function transformModule(source: Dict, mappedId: string, mappings: Map<string, string>, reviews: ReviewCollector): Dict {
  const result: Dict = { id: mappedId, type: String(source.type) }
  if (!MODULE_TYPES.has(String(source.type))) reviews.add('unsupported_module_type', 'Legacy Module type is not in the frozen v0.3 Module vocabulary.', 'review_module_type', String(source.id), { type: source.type })
  if (source.targetEntity !== undefined) {
    const target = mapOptionalRef(source.targetEntity, mappings, reviews, String(source.id), 'opaque_module_reference_unresolved')
    if (target) result.targetEntity = target
  }
  if (Array.isArray(source.sourceRefs)) result.sourceRefs = mapArrayRefs(source.sourceRefs, mappings, reviews, String(source.id), 'opaque_module_reference_unresolved')
  if (source.schemaId !== undefined && (source.schemaId === null || nonEmptyString(source.schemaId))) result.schemaId = source.schemaId
  if (Array.isArray(source.columns)) result.columns = clone(source.columns)
  if (Array.isArray(source.rows)) result.rows = clone(source.rows)
  inspectUnmappedFields(source, new Set(['id', 'type', 'targetEntity', 'sourceRefs', 'schemaId', 'columns', 'rows']), reviews, String(source.id), 'Legacy Module contains non-empty fields without a deterministic v0.3 destination.')
  return result
}

function endpointType(oldId: unknown, entities: Map<string, EntityInfo>): string | undefined {
  return nonEmptyString(oldId) ? entities.get(oldId)?.targetType : undefined
}

const THEME_IMPORTANCE = new Set<string>(KNOWLEDGE_SCHEMA_V03.relation.definitions.theme_exposure.attributes.importance)
const THEME_CHAIN_POSITION = new Set<string>(KNOWLEDGE_SCHEMA_V03.relation.definitions.theme_exposure.attributes.chainPosition)
const OWNERSHIP_CONTROL_TYPES = new Set<string>(KNOWLEDGE_SCHEMA_V03.relation.definitions.owns_stake_in.attributes.controlType)

function filteredRelationAttributes(
  source: Dict,
  allowed: string[],
  reviews: ReviewCollector,
  assetId: string,
  validators: Record<string, (value: unknown) => boolean> = {},
): Dict | undefined {
  const attributes = source.attributes
  if (!isDict(attributes)) return undefined
  const result: Dict = {}
  for (const field of allowed) {
    if (attributes[field] === undefined) continue
    const validator = validators[field]
    if (!validator || validator(attributes[field])) result[field] = clone(attributes[field])
    else reviews.add('invalid_relation_attribute', `Legacy relation attribute is invalid for the target v0.3 relation contract: ${field}.`, 'review_relation_attribute', assetId, { field, value: attributes[field] })
  }
  const unmapped = Object.keys(attributes).filter((field) => !allowed.includes(field) && nonEmpty(attributes[field]))
  if (unmapped.length > 0) reviews.add('legacy_semantic_field_unmapped', 'Legacy relation attributes cannot be represented by the selected v0.3 relation contract.', 'review_relation_attributes', assetId, { fields: unmapped.sort((left, right) => left.localeCompare(right)) })
  return Object.keys(result).length > 0 ? result : undefined
}

function inspectRelationAttributes(source: Dict, reviews: ReviewCollector, assetId: string): void {
  if (isDict(source.attributes) && nonEmpty(source.attributes)) {
    reviews.add('legacy_semantic_field_unmapped', 'Legacy relation attributes have no deterministic destination in the selected v0.3 relation contract.', 'review_relation_attributes', assetId, {
      fields: Object.keys(source.attributes).sort((left, right) => left.localeCompare(right)),
    })
  }
}

function normalizeRelationPlan(
  source: Dict,
  initialId: string,
  entities: Map<string, EntityInfo>,
  mappings: Map<string, string>,
  reviews: ReviewCollector,
  warnings: KnowledgeMigrationWarning[],
): RelationPlan {
  const oldId = String(source.id)
  const sourceId = nonEmptyString(source.source) ? source.source : ''
  const targetId = nonEmptyString(source.target) ? source.target : ''
  const sourceRef = declaredRef(sourceId, mappings)
  const targetRef = declaredRef(targetId, mappings)
  const sourceType = endpointType(sourceId, entities)
  const targetType = endpointType(targetId, entities)
  const type = String(source.type)
  const common = commonRelationFields(source)
  const legacyAttributes = isDict(source.attributes) ? source.attributes : undefined
  common.lifecycle = requiredLifecycle(source.lifecycle, oldId, 'Relation', reviews, warnings)
  const plan: RelationPlan = {
    oldId,
    initialId,
    targetId: initialId,
    type,
    sourceId,
    targetIdLegacy: targetId,
    normalizedSourceId: sourceRef ?? '',
    normalizedTargetId: targetRef ?? '',
    legacyContextRefs: source.contextRefs,
    legacySupportingClaimRefs: source.supportingClaimRefs,
    legacySourceRefs: source.sourceRefs,
    legacyAttributes: legacyAttributes ? clone(legacyAttributes) : undefined,
    common,
    dedupeSafe: true,
    output: false,
  }
  if (source.attributes !== undefined && !legacyAttributes && nonEmpty(source.attributes)) {
    reviews.add('legacy_semantic_field_unmapped', 'Legacy Relation attributes are not an object and cannot be migrated deterministically.', 'review_relation_attributes', oldId)
    plan.dedupeSafe = false
  }
  inspectUnmappedFields(source, new Set([
    'id', 'type', 'source', 'target', 'attributes', 'contextRefs', 'supportingClaimRefs', 'sourceRefs',
    'confidence', 'asOf', 'lifecycle', 'createdAt', 'updatedAt', 'supersedes', 'supersededBy',
  ]), reviews, oldId, 'Legacy Relation contains non-empty fields without a deterministic v0.3 destination.')
  if (nonEmpty(source.supersedes) || nonEmpty(source.supersededBy)) {
    reviews.add('legacy_semantic_field_unmapped', 'Legacy Relation supersession metadata has no deterministic v0.3 destination.', 'review_relation_metadata', oldId, { fields: ['supersededBy', 'supersedes'].filter((field) => nonEmpty(source[field])) })
    plan.dedupeSafe = false
  }
  if (!sourceRef || !targetRef || !sourceType || !targetType) {
    reviews.add('invalid_legacy_relation_endpoints', 'Legacy relation endpoints cannot be resolved to canonical entities.', 'review_relation_endpoints', oldId, { source: sourceId, target: targetId })
    return plan
  }
  if (type === 'contains') {
    if (sourceType === 'investment_theme' && targetType === 'industry') {
      plan.type = 'theme_exposure'
      plan.attributes = filteredRelationAttributes(source, ['importance', 'chainPosition'], reviews, oldId, {
        importance: (value) => typeof value === 'string' && THEME_IMPORTANCE.has(value),
        chainPosition: (value) => typeof value === 'string' && THEME_CHAIN_POSITION.has(value),
      })
      plan.dedupeSafe = !legacyAttributes || Object.keys(legacyAttributes).every((field) =>
        ['importance', 'chainPosition'].includes(field) && (field === 'importance' ? THEME_IMPORTANCE.has(String(legacyAttributes[field])) : THEME_CHAIN_POSITION.has(String(legacyAttributes[field]))))
      plan.output = true
    } else {
      reviews.add('ambiguous_contains_semantics', 'Legacy contains relation does not have one frozen v0.3 semantic target.', 'review_contains_semantics', oldId, { sourceType, targetType })
    }
  } else if (type === 'operates_in') {
    if (sourceType === 'company' && targetType === 'industry') {
      plan.type = 'business_exposure'
      plan.attributes = {
        exposureBasis: 'unknown',
        realizationStage: 'unknown',
        materiality: 'unknown',
        financialContribution: null,
      }
      plan.common.asOf = null
      if (isDict(source.attributes) && nonEmpty(source.attributes)) {
        reviews.add('legacy_semantic_field_unmapped', 'Legacy operates_in attributes cannot be represented by the frozen deterministic business_exposure mapping.', 'review_business_exposure_attributes', oldId, { fields: Object.keys(source.attributes).sort((left, right) => left.localeCompare(right)) })
        plan.dedupeSafe = false
      }
      plan.output = true
      addWarning(warnings, 'business_exposure_basis_unknown', 'Legacy operates_in has no deterministic exposure basis.', oldId)
      addWarning(warnings, 'business_exposure_stage_unknown', 'Legacy operates_in has no deterministic realization stage.', oldId)
      addWarning(warnings, 'business_exposure_materiality_unknown', 'Legacy operates_in has no deterministic materiality.', oldId)
    } else if (sourceType === 'company' && targetType === 'investment_theme') {
      reviews.add('operates_in_theme_target', 'Legacy operates_in targets a migrated InvestmentTheme and cannot become business_exposure.', 'review_operates_in_theme_target', oldId)
    } else {
      reviews.add('invalid_legacy_relation_endpoints', 'Legacy operates_in endpoints do not match the deterministic Company to Industry rule.', 'review_relation_endpoints', oldId, { sourceType, targetType })
    }
  } else if (type === 'upstream_of' || type === 'downstream_of') {
    if (sourceType === 'industry' && targetType === 'industry') {
      plan.type = 'upstream_of'
      if (type === 'downstream_of') [plan.normalizedSourceId, plan.normalizedTargetId] = [plan.normalizedTargetId, plan.normalizedSourceId]
      plan.output = true
    } else reviews.add('invalid_legacy_relation_endpoints', 'Legacy upstream/downstream endpoints are not Industry to Industry.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'supplier_of' || type === 'customer_of') {
    if (sourceType === 'company' && targetType === 'company') {
      plan.type = 'supplier_of'
      if (type === 'customer_of') [plan.normalizedSourceId, plan.normalizedTargetId] = [plan.normalizedTargetId, plan.normalizedSourceId]
      plan.output = true
    } else reviews.add('invalid_legacy_relation_endpoints', 'Legacy supplier/customer endpoints are not Company to Company.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'competes_with') {
    if (sourceType === 'company' && targetType === 'company') { plan.type = type; plan.output = true }
    else reviews.add('invalid_legacy_relation_endpoints', 'Legacy competes_with endpoints are not Company to Company.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'substitute_for') {
    if ((sourceType === 'product' && targetType === 'product') || (sourceType === 'technology' && targetType === 'technology')) { plan.type = 'substitutes_for'; plan.output = true }
    else reviews.add('invalid_legacy_relation_endpoints', 'Legacy substitute_for endpoints are not same-type Product or Technology.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'depends_on') {
    const allowed = new Set(['industry', 'product', 'technology'])
    if (allowed.has(sourceType) && allowed.has(targetType)) { plan.type = type; plan.output = true }
    else reviews.add('invalid_legacy_relation_endpoints', 'Legacy depends_on endpoints include an unsupported semantic type.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'owns_stake_in') {
    if (sourceType === 'company' && targetType === 'company') {
      const attributes = filteredRelationAttributes(source, ['ownershipPct', 'controlType'], reviews, oldId, {
        ownershipPct: (value) => value === null || (typeof value === 'number' && value >= 0 && value <= 1),
        controlType: (value) => typeof value === 'string' && OWNERSHIP_CONTROL_TYPES.has(value),
      }) ?? {}
      if (legacyAttributes && legacyAttributes.ownershipPct !== undefined && !(legacyAttributes.ownershipPct === null || (typeof legacyAttributes.ownershipPct === 'number' && legacyAttributes.ownershipPct >= 0 && legacyAttributes.ownershipPct <= 1))) {
        delete attributes.ownershipPct
        plan.dedupeSafe = false
      }
      if (legacyAttributes && legacyAttributes.controlType !== undefined && !(typeof legacyAttributes.controlType === 'string' && OWNERSHIP_CONTROL_TYPES.has(legacyAttributes.controlType))) {
        delete attributes.controlType
        plan.dedupeSafe = false
      }
      if (attributes.ownershipPct === undefined) attributes.ownershipPct = null
      if (attributes.controlType === undefined) attributes.controlType = 'unknown'
      if (legacyAttributes && Object.keys(legacyAttributes).some((field) => !['ownershipPct', 'controlType'].includes(field) && nonEmpty(legacyAttributes[field]))) plan.dedupeSafe = false
      plan.type = type
      plan.attributes = attributes
      plan.output = true
    } else reviews.add('invalid_legacy_relation_endpoints', 'Legacy owns_stake_in endpoints are not Company to Company.', 'review_relation_endpoints', oldId, { sourceType, targetType })
  } else if (type === 'invested_in') {
    reviews.add('ambiguous_investment_state', 'Legacy invested_in does not deterministically prove current ownership.', 'review_investment_state', oldId)
  } else if (type === 'partner_of') {
    reviews.add('ambiguous_partner_relation', 'Legacy partner_of has no frozen deterministic v0.3 mapping.', 'review_partner_relation', oldId)
  } else {
    reviews.add('invalid_legacy_relation_endpoints', `Legacy relation type is not supported by the frozen v0.3 migration matrix: ${type}.`, 'review_relation_semantics', oldId, { type })
  }
  if (plan.output && plan.type !== 'business_exposure' && plan.type !== 'owns_stake_in' && nonEmpty(plan.attributes)) reviews.add('legacy_semantic_field_unmapped', 'Legacy relation attributes cannot be represented by the selected v0.3 relation contract.', 'review_relation_attributes', oldId)
  if (plan.output && !['theme_exposure', 'business_exposure', 'owns_stake_in'].includes(plan.type) && isDict(source.attributes) && nonEmpty(source.attributes)) {
    inspectRelationAttributes(source, reviews, oldId)
    plan.dedupeSafe = false
  }
  if (plan.output && ['competes_with', 'substitutes_for'].includes(plan.type) && plan.normalizedSourceId.localeCompare(plan.normalizedTargetId) > 0) [plan.normalizedSourceId, plan.normalizedTargetId] = [plan.normalizedTargetId, plan.normalizedSourceId]
  return plan
}

function relationGroupKey(plan: RelationPlan): string {
  return canonicalSerialize({ type: plan.type, sourceRef: plan.normalizedSourceId, targetRef: plan.normalizedTargetId })
}

function relationSemanticKey(plan: RelationPlan): string {
  return canonicalSerialize({
    type: plan.type,
    sourceRef: plan.normalizedSourceId,
    targetRef: plan.normalizedTargetId,
    attributes: plan.attributes ?? null,
    legacyAttributes: plan.legacyAttributes ?? null,
    contextRefs: plan.legacyContextRefs ?? null,
    supportingClaimRefs: plan.legacySupportingClaimRefs ?? null,
    sourceRefs: plan.legacySourceRefs ?? null,
    common: plan.common,
  })
}

function deduplicateRelations(
  plans: RelationPlan[],
  relationMappings: Map<string, string>,
  reviews: ReviewCollector,
): RelationPlan[] {
  const outputPlans = plans.filter((plan) => plan.output)
  const groups = new Map<string, RelationPlan[]>()
  for (const plan of outputPlans) (groups.get(relationGroupKey(plan)) ?? groups.set(relationGroupKey(plan), []).get(relationGroupKey(plan))!).push(plan)
  for (const group of groups.values()) {
    const semanticGroups = new Map<string, RelationPlan[]>()
    for (const plan of group) (semanticGroups.get(relationSemanticKey(plan)) ?? semanticGroups.set(relationSemanticKey(plan), []).get(relationSemanticKey(plan))!).push(plan)
    if (semanticGroups.size > 1) {
      for (const plan of group) reviews.add('relation_semantic_conflict', 'Normalized relations have conflicting attributes and cannot be deduplicated safely.', 'review_relation_conflict', plan.oldId, { relationType: plan.type, sourceRef: plan.normalizedSourceId, targetRef: plan.normalizedTargetId })
      continue
    }
    if (group.some((plan) => !plan.dedupeSafe)) continue
    const survivor = [...group].sort((left, right) => left.initialId.localeCompare(right.initialId))[0]!
    for (const plan of group) {
      relationMappings.set(plan.oldId, survivor.initialId)
      plan.targetId = survivor.initialId
    }
  }
  return outputPlans.filter((plan) => plan.targetId === plan.initialId)
}

function sortedMappings(mappings: Map<string, string>): KnowledgeIdMapping[] {
  return [...mappings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([from, to]) => mapping(from, to, from === to ? 'preserve-object-kind-namespace' : 'migrate-to-v0.3-canonical-namespace'))
}

async function writeAsset(stagingRoot: string, storageRef: string, value: Dict): Promise<void> {
  const path = join(stagingRoot, storageRef)
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${canonicalSerialize(value)}\n`, 'utf8')
}

function relationObject(plan: RelationPlan, allMappings: Map<string, string>, reviews: ReviewCollector): Dict {
  const result: Dict = {
    id: plan.targetId,
    type: plan.type,
    sourceRef: plan.normalizedSourceId,
    targetRef: plan.normalizedTargetId,
    ...clone(plan.common),
  }
  for (const [field, value, code] of [
    ['contextRefs', plan.legacyContextRefs, 'unresolved_relation_reference'],
    ['supportingClaimRefs', plan.legacySupportingClaimRefs, 'unresolved_relation_reference'],
    ['sourceRefs', plan.legacySourceRefs, 'unresolved_relation_source_ref'],
  ] as const) {
    if (value === undefined) continue
    if (Array.isArray(value)) result[field] = mapArrayRefs(value, allMappings, reviews, plan.oldId, code)
    else if (nonEmpty(value)) reviews.add(code, `Legacy Relation ${field} must be an array to map deterministically.`, 'review_relation_references', plan.oldId)
  }
  if (plan.attributes !== undefined) result.attributes = clone(plan.attributes)
  return result
}

function sortWarnings(warnings: KnowledgeMigrationWarning[]): KnowledgeMigrationWarning[] {
  return [...warnings].sort((left, right) => `${left.code}\u0000${left.assetId ?? ''}\u0000${JSON.stringify(left.details ?? {})}`.localeCompare(`${right.code}\u0000${right.assetId ?? ''}\u0000${JSON.stringify(right.details ?? {})}`))
}

function sortReviews(reviews: MigrationReviewItem[]): MigrationReviewItem[] {
  return [...reviews].sort((left, right) => `${left.code}\u0000${left.assetId ?? ''}\u0000${JSON.stringify(left.details ?? {})}`.localeCompare(`${right.code}\u0000${right.assetId ?? ''}\u0000${JSON.stringify(right.details ?? {})}`))
}

const LEGACY_REF_PREFIXES = ['industry:', 'segment:', 'company:', 'product:', 'technology:', 'fact:', 'forecast:', 'viewpoint:', 'trend:', 'risk:']
const TARGET_REGISTRY_KINDS: Record<string, string> = {
  'theme-group:': 'theme_group',
  'entity:': 'entity',
  'relation:': 'relation',
  'claim:': 'claim',
  'source:': 'source',
  'module:': 'module',
}

async function fileSnapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const filePath of await listFiles(root)) result[sourceRelativePath(root, filePath)] = (await readFile(filePath)).toString('base64')
  return result
}

function registryKind(id: string): string | undefined {
  return Object.entries(TARGET_REGISTRY_KINDS).find(([prefix]) => id.startsWith(prefix))?.[1]
}

async function declaredRefIntegrity(
  stagingRoot: string,
  registry: Record<string, { type: string; storageRef: string }>,
  entities: Dict[],
  claims: Dict[],
  sources: Dict[],
  modules: Dict[],
  relations: Dict[],
  taxonomyIds: Set<string>,
): Promise<{ useV03Namespaces: boolean; resolveToTarget: boolean; registryNamespaceKindConsistent: boolean }> {
  let useV03Namespaces = true
  let resolveToTarget = true
  const checkCanonical = (value: unknown, expected: string | 'canonical'): void => {
    if (!nonEmptyString(value)) { useV03Namespaces = false; resolveToTarget = false; return }
    if (LEGACY_REF_PREFIXES.some((prefix) => value.startsWith(prefix))) useV03Namespaces = false
    const entry = registry[value]
    if (!entry || (expected !== 'canonical' && entry.type !== expected)) resolveToTarget = false
  }
  const checkArray = (value: unknown, expected: string | 'canonical'): void => {
    if (!Array.isArray(value)) { if (nonEmpty(value)) { useV03Namespaces = false; resolveToTarget = false }; return }
    value.forEach((item) => checkCanonical(item, expected))
  }
  for (const entity of entities) {
    if (entity.themeGroupRef !== undefined) checkCanonical(entity.themeGroupRef, 'theme_group')
    if (Array.isArray(entity.taxonomyRefs)) for (const ref of entity.taxonomyRefs) if (!taxonomyIds.has(String(ref))) resolveToTarget = false
  }
  const rawRegistry = new Set<string>()
  const rawRegistryPath = join(stagingRoot, 'registry', 'raw.yaml')
  if (await pathExists(rawRegistryPath)) {
    try {
      const value = parseYaml(await readFile(rawRegistryPath, 'utf8'), rawRegistryPath)
      if (isDict(value)) Object.keys(value).forEach((id) => rawRegistry.add(id))
    } catch { resolveToTarget = false }
  }
  for (const source of sources) {
    if (Array.isArray(source.rawRefs)) for (const ref of source.rawRefs) {
      if (nonEmptyString(ref) && LEGACY_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) useV03Namespaces = false
      if (!nonEmptyString(ref) || !rawRegistry.has(ref)) resolveToTarget = false
    }
  }
  for (const claim of claims) {
    checkArray(claim.subjectRefs, 'canonical')
    if (claim.primarySubjectRef !== undefined) checkCanonical(claim.primarySubjectRef, 'canonical')
    checkArray(claim.sourceRefs, 'source')
    checkArray(claim.supersedes, 'claim')
    checkArray(claim.supersededBy, 'claim')
    if (Array.isArray(claim.provenance)) for (const item of claim.provenance) if (isDict(item)) {
      checkCanonical(item.sourceRef, 'source')
      if (!nonEmptyString(item.rawRef) || !rawRegistry.has(item.rawRef)) resolveToTarget = false
    }
  }
  for (const module of modules) {
    if (module.targetEntity !== undefined) checkCanonical(module.targetEntity, 'entity')
    checkArray(module.sourceRefs, 'source')
  }
  for (const relation of relations) {
    checkCanonical(relation.sourceRef, 'entity')
    checkCanonical(relation.targetRef, 'entity')
    checkArray(relation.contextRefs, 'canonical')
    checkArray(relation.supportingClaimRefs, 'claim')
    checkArray(relation.sourceRefs, 'source')
  }
  for (const path of await listFiles(join(stagingRoot, 'taxonomy'))) {
    try {
      const value = parseYaml(await readFile(path, 'utf8'), path)
      const visit = (candidate: unknown): void => {
        if (Array.isArray(candidate)) { candidate.forEach(visit); return }
        if (!isDict(candidate)) return
        if (candidate.graphRefs !== undefined) checkArray(candidate.graphRefs, 'canonical')
        Object.values(candidate).forEach(visit)
      }
      visit(value)
    } catch { resolveToTarget = false }
  }
  for (const path of await listFiles(join(stagingRoot, 'views'))) {
    try {
      const value = parseYaml(await readFile(path, 'utf8'), path)
      const visit = (candidate: unknown): void => {
        if (Array.isArray(candidate)) { candidate.forEach(visit); return }
        if (!isDict(candidate)) return
        if (candidate.targetEntity !== undefined) checkCanonical(candidate.targetEntity, 'entity')
        Object.values(candidate).forEach(visit)
      }
      visit(value)
    } catch { resolveToTarget = false }
  }
  const registryNamespaceKindConsistent = Object.entries(registry).every(([id, entry]) => registryKind(id) === entry.type)
  return { useV03Namespaces, resolveToTarget, registryNamespaceKindConsistent }
}

export async function transformV02ToV03(
  sourceHandle: KnowledgeBaseHandle,
  stagingRoot: string,
  migrationRunId: string,
): Promise<V02ToV03TransformResult> {
  if (isWithin(sourceHandle.rootRef, stagingRoot) || isWithin(stagingRoot, sourceHandle.rootRef)) {
    throw new Error('v0.2 to v0.3 transformation requires a non-nested staging root')
  }
  const sourceSnapshotBefore = await fileSnapshot(sourceHandle.rootRef)
  const sourceAssets = await new CanonicalV02KnowledgeLoader(sourceHandle.rootRef).readAssets()
  const before = inventory(sourceAssets)
  const reviews = new ReviewCollector(migrationRunId, sourceHandle.knowledgeBaseId)
  const warnings: KnowledgeMigrationWarning[] = []
  const auxiliary = await auxiliaryInventory(sourceHandle.rootRef)
  const taxonomyIds = new Set(auxiliary.taxonomyItemIds)

  const entityMappings = new Map<string, string>()
  const entityCandidates = new Map<string, string[]>()
  const entityInfo = new Map<string, EntityInfo>()
  for (const item of [...sourceAssets.entities].sort((left, right) => left.value.id.localeCompare(right.value.id))) {
    const source = item.value as Dict
    const oldType = String(source.type)
    const targetType = mapEntityType(source.type)
    const mappedId = mapEntityId(item.value.id)
    if (!targetType || !mappedId) {
      reviews.add('unsupported_legacy_entity_type', 'Legacy Entity cannot be mapped to a frozen v0.3 semantic subtype.', 'review_entity_semantics', item.value.id, { type: source.type })
      continue
    }
    entityInfo.set(item.value.id, { oldType, targetType, targetId: mappedId })
    registerCollision(entityMappings, entityCandidates, item.value.id, mappedId)
  }
  const collidedEntityIds = mappingCollisions(entityCandidates, reviews)
  for (const [from, to] of entityMappings) if (collidedEntityIds.has(to)) entityMappings.delete(from)
  for (const oldId of entityInfo.keys()) if (!entityMappings.has(oldId)) entityInfo.delete(oldId)

  const claimMappings = new Map<string, string>()
  const claimCandidates = new Map<string, string[]>()
  for (const item of [...sourceAssets.intelligence].sort((left, right) => left.value.id.localeCompare(right.value.id))) registerCollision(claimMappings, claimCandidates, item.value.id, mapClaimId(item.value.id))
  const collidedClaimIds = mappingCollisions(claimCandidates, reviews)
  for (const [from, to] of claimMappings) if (collidedClaimIds.has(to)) claimMappings.delete(from)

  const sourceMappings = new Map<string, string>()
  const sourceCandidates = new Map<string, string[]>()
  for (const item of [...sourceAssets.sources].sort((left, right) => left.value.id.localeCompare(right.value.id))) registerCollision(sourceMappings, sourceCandidates, item.value.id, mapSourceId(item.value.id))
  const collidedSourceIds = mappingCollisions(sourceCandidates, reviews)
  for (const [from, to] of sourceMappings) if (collidedSourceIds.has(to)) sourceMappings.delete(from)

  const moduleMappings = new Map<string, string>()
  const moduleCandidates = new Map<string, string[]>()
  for (const item of [...sourceAssets.modules].sort((left, right) => left.value.id.localeCompare(right.value.id))) registerCollision(moduleMappings, moduleCandidates, item.value.id, mapModuleId(item.value.id))
  const collidedModuleIds = mappingCollisions(moduleCandidates, reviews)
  for (const [from, to] of moduleMappings) if (collidedModuleIds.has(to)) moduleMappings.delete(from)

  const relationMappings = new Map<string, string>()
  const relationCandidates = new Map<string, string[]>()
  for (const item of [...sourceAssets.relations].sort((left, right) => left.value.id.localeCompare(right.value.id))) registerCollision(relationMappings, relationCandidates, item.value.id, mapRelationId(item.value.id))
  const collidedRelationIds = mappingCollisions(relationCandidates, reviews)
  for (const [from, to] of relationMappings) if (collidedRelationIds.has(to)) relationMappings.delete(from)

  const relationPlans = [...sourceAssets.relations]
    .sort((left, right) => left.value.id.localeCompare(right.value.id))
    .map((item) => normalizeRelationPlan(item.value as Dict, relationMappings.get(item.value.id) ?? mapRelationId(item.value.id), entityInfo, new Map([...entityMappings, ...claimMappings, ...sourceMappings, ...relationMappings]), reviews, warnings))
  for (const plan of relationPlans) if (!plan.output) relationMappings.delete(plan.oldId)
  const transformedRelations = deduplicateRelations(relationPlans, relationMappings, reviews)
  const allMappings = new Map<string, string>([
    ...entityMappings,
    ...claimMappings,
    ...sourceMappings,
    ...moduleMappings,
    ...relationMappings,
  ])

  let fallbackThemeGroupCreated = false
  const themeGroups: Dict[] = []
  if ([...sourceAssets.entities].some((item) => entityInfo.get(item.value.id)?.oldType === 'industry' && entityMappings.has(item.value.id))) {
    fallbackThemeGroupCreated = true
    themeGroups.push({ id: 'theme-group:unclassified', name: 'Unclassified', aliases: ['未分类'], lifecycle: { status: 'active' } })
  }
  const transformedEntities: Dict[] = []
  for (const item of sourceAssets.entities) {
    const info = entityInfo.get(item.value.id)
    if (!info || !entityMappings.has(item.value.id)) continue
    const entity = transformEntity(item.value as Dict, info, taxonomyIds, allMappings, reviews, warnings)
    transformedEntities.push(entity)
    if (info.oldType === 'industry') {
      addWarning(warnings, 'theme_group_unclassified', 'Migrated industry has no deterministic ThemeGroup and uses the stable Unclassified fallback.', item.value.id)
    }
    await writeAsset(stagingRoot, sourceRelativePath(sourceHandle.rootRef, item.filePath), entity)
  }

  const transformedClaims: Dict[] = []
  for (const item of sourceAssets.intelligence) {
    const mappedId = claimMappings.get(item.value.id)
    if (!mappedId) continue
    const claim = transformClaim(item.value as Dict, mappedId, allMappings, reviews, warnings)
    transformedClaims.push(claim)
    await writeAsset(stagingRoot, sourceRelativePath(sourceHandle.rootRef, item.filePath), claim)
  }

  const transformedSources: Dict[] = []
  for (const item of sourceAssets.sources) {
    const mappedId = sourceMappings.get(item.value.id)
    if (!mappedId) continue
    const source = transformSource(item.value as Dict, mappedId, reviews, warnings)
    transformedSources.push(source)
    await writeAsset(stagingRoot, sourceRelativePath(sourceHandle.rootRef, item.filePath), source)
  }

  const transformedModules: Dict[] = []
  for (const item of sourceAssets.modules) {
    const mappedId = moduleMappings.get(item.value.id)
    if (!mappedId) continue
    const module = transformModule(item.value as Dict, mappedId, allMappings, reviews)
    transformedModules.push(module)
    await writeAsset(stagingRoot, sourceRelativePath(sourceHandle.rootRef, item.filePath), module)
  }

  const transformedRelationObjects: Dict[] = []
  const removedStagingCanonicalFiles: string[] = []
  for (const plan of transformedRelations) {
    const relation = relationObject(plan, allMappings, reviews)
    transformedRelationObjects.push(relation)
    const sourceItem = sourceAssets.relations.find((item) => item.value.id === plan.oldId)
    if (sourceItem) await writeAsset(stagingRoot, sourceRelativePath(sourceHandle.rootRef, sourceItem.filePath), relation)
  }
  const survivorPaths = new Set(transformedRelations.flatMap((plan) => sourceAssets.relations.find((item) => item.value.id === plan.oldId)?.filePath ?? []).map((filePath) => sourceRelativePath(sourceHandle.rootRef, filePath)))
  for (const plan of relationPlans.filter((candidate) => candidate.output && candidate.dedupeSafe && candidate.targetId !== candidate.initialId)) {
    const sourceItem = sourceAssets.relations.find((item) => item.value.id === plan.oldId)
    if (!sourceItem) continue
    const relativePath = sourceRelativePath(sourceHandle.rootRef, sourceItem.filePath)
    if (survivorPaths.has(relativePath)) continue
    await rm(join(stagingRoot, relativePath), { force: true })
    removedStagingCanonicalFiles.push(relativePath)
  }
  await rewriteAuxiliaryFiles(stagingRoot, auxiliary, allMappings, reviews)
  const registry: Record<string, { type: string; storageRef: string }> = {}
  if (fallbackThemeGroupCreated) await writeAsset(stagingRoot, 'theme-groups/unclassified.yaml', themeGroups[0]!)
  if (fallbackThemeGroupCreated) registry['theme-group:unclassified'] = { type: 'theme_group', storageRef: 'theme-groups/unclassified.yaml' }
  const register = (items: Dict[], type: string, storageRefs: Map<string, string>): void => {
    for (const item of items) if (nonEmptyString(item.id) && storageRefs.has(item.id)) registry[item.id] = { type, storageRef: storageRefs.get(item.id)! }
  }
  const entityStorageRefs = new Map<string, string>()
  for (const item of sourceAssets.entities) {
    const mapped = entityMappings.get(item.value.id)
    if (mapped) entityStorageRefs.set(mapped, sourceRelativePath(sourceHandle.rootRef, item.filePath))
  }
  const claimStorageRefs = new Map(sourceAssets.intelligence.flatMap((item) => claimMappings.has(item.value.id) ? [[claimMappings.get(item.value.id)!, sourceRelativePath(sourceHandle.rootRef, item.filePath)] as const] : []))
  const sourceStorageRefs = new Map(sourceAssets.sources.flatMap((item) => sourceMappings.has(item.value.id) ? [[sourceMappings.get(item.value.id)!, sourceRelativePath(sourceHandle.rootRef, item.filePath)] as const] : []))
  const moduleStorageRefs = new Map(sourceAssets.modules.flatMap((item) => moduleMappings.has(item.value.id) ? [[moduleMappings.get(item.value.id)!, sourceRelativePath(sourceHandle.rootRef, item.filePath)] as const] : []))
  const relationStorageRefs = new Map<string, string>()
  for (const plan of transformedRelations) {
    const sourceItem = sourceAssets.relations.find((item) => item.value.id === plan.oldId)
    if (sourceItem) relationStorageRefs.set(relationMappings.get(plan.oldId) ?? plan.targetId, sourceRelativePath(sourceHandle.rootRef, sourceItem.filePath))
  }
  register(transformedEntities, 'entity', entityStorageRefs)
  register(transformedClaims, 'claim', claimStorageRefs)
  register(transformedSources, 'source', sourceStorageRefs)
  register(transformedModules, 'module', moduleStorageRefs)
  register(transformedRelationObjects, 'relation', relationStorageRefs)
  const registryPath = join(stagingRoot, 'registry', 'assets.yaml')
  await mkdir(join(stagingRoot, 'registry'), { recursive: true })
  await writeFile(registryPath, `${canonicalSerialize(Object.fromEntries(Object.entries(registry).sort(([left], [right]) => left.localeCompare(right))))}\n`, 'utf8')
  await rm(join(stagingRoot, 'registry', 'index.yaml'), { force: true })
  await rm(join(stagingRoot, 'registry', 'modules.yaml'), { force: true })

  const after = targetInventory({ themeGroups, entities: transformedEntities, relations: transformedRelationObjects, claims: transformedClaims, modules: transformedModules, sources: transformedSources, taxonomyFiles: auxiliary.taxonomyFiles, taxonomyItemIds: auxiliary.taxonomyItemIds, viewFiles: auxiliary.viewFiles })
  const canonicalSourceIds = [...before.entityIds, ...before.relationIds, ...before.intelligenceIds, ...before.moduleIds, ...before.sourceIds]
  const sourceSnapshotAfter = await fileSnapshot(sourceHandle.rootRef)
  const stagingSnapshot = await fileSnapshot(stagingRoot)
  const rawPaths = sortedUnique(Object.keys(sourceSnapshotBefore).filter((path) => path.startsWith('raw/')))
  const rawIdentityPreserved = rawPaths.every((path) => sourceSnapshotBefore[path] === stagingSnapshot[path])
  const rawRegistryPreserved = sourceSnapshotBefore['registry/raw.yaml'] === stagingSnapshot['registry/raw.yaml']
  const declaredIntegrity = await declaredRefIntegrity(stagingRoot, registry, transformedEntities, transformedClaims, transformedSources, transformedModules, transformedRelationObjects, taxonomyIds)
  const targetIds = [
    ...after.themeGroupIds,
    ...after.entityIds,
    ...after.relationIds,
    ...after.claimIds,
    ...after.moduleIds,
    ...after.sourceIds,
  ]
  const invariants: Record<string, boolean> = {
    sourceRootUnchanged: JSON.stringify(sourceSnapshotBefore) === JSON.stringify(sourceSnapshotAfter),
    rawIdentityPreserved,
    rawRegistryPreserved,
    completeCanonicalIdMapping: canonicalSourceIds.every((id) => allMappings.has(id)),
    targetCanonicalIdsUnique: targetIds.length === new Set(targetIds).size && targetIds.every((id) => registry[id] !== undefined),
    noLegacyCanonicalNamespaceInDeclaredRefs: declaredIntegrity.useV03Namespaces,
    declaredCanonicalRefsUseV03Namespaces: declaredIntegrity.useV03Namespaces,
    declaredCanonicalRefsResolveToTarget: declaredIntegrity.resolveToTarget,
    noMixedCanonicalSemanticRegistry: declaredIntegrity.registryNamespaceKindConsistent,
    registryNamespaceKindConsistent: declaredIntegrity.registryNamespaceKindConsistent,
    taxonomyPreserved: auxiliary.taxonomyFiles.every((path) => pathExists(join(stagingRoot, path))),
    viewsPreserved: auxiliary.viewFiles.every((path) => pathExists(join(stagingRoot, path))),
    auxiliaryDeclaredRefsResolved: !reviews.items.some((item) => item.code === 'unresolved_auxiliary_declared_ref'),
    moduleDeclaredRefsResolved: !reviews.items.some((item) => item.code === 'opaque_module_reference_unresolved'),
    relationEndpointsCanonical: transformedRelationObjects.every((relation) => String(relation.sourceRef).startsWith('entity:') && String(relation.targetRef).startsWith('entity:')),
    noOrphanDeduplicatedRelationFiles: removedStagingCanonicalFiles.every((path) => !Object.prototype.hasOwnProperty.call(stagingSnapshot, path)),
    canonicalRegistryRebuilt: await pathExists(registryPath),
  }
  for (const [name, valid] of Object.entries(invariants)) if (!valid && !reviews.items.some((item) => item.code === name)) reviews.add(name, `Migration invariant failed: ${name}.`, 'review_migration_invariant')
  const transformedAssetIds = [...transformedSources, ...transformedClaims, ...transformedRelationObjects, ...transformedModules].flatMap((item) => nonEmptyString(item.id) ? [item.id] : [])
  transformedAssetIds.push(...sourceAssets.entities.flatMap((item) => entityMappings.get(item.value.id) ?? []))
  return {
    before,
    after,
    idMappings: sortedMappings(allMappings),
    warnings: sortWarnings(warnings),
    reviewItems: sortReviews(reviews.items),
    changes: {
      canonicalRegistryRebuilt: true,
      fallbackThemeGroupCreated,
      transformedAssetIds: sortedUnique(transformedAssetIds),
      preservedAuxiliaryFiles: [...auxiliary.taxonomyFiles, ...auxiliary.viewFiles].sort((left, right) => left.localeCompare(right)),
      removedStagingCanonicalFiles: removedStagingCanonicalFiles.sort((left, right) => left.localeCompare(right)),
    },
    invariants,
  }
}
