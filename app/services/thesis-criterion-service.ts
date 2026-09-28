import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput } from '../../knowledge/production/contracts.ts'
import type { KillCriterionOriginV04, KillCriterionV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEntityV04, KnowledgeReasoningEdgeV04, KnowledgeSourceV04, KnowledgeThesisV04, NumericThresholdDefinitionV1 } from '../../knowledge/schema/domain-v04.ts'
import { hashKillCriterionDefinitionV04, isBoundedSafeKillCriterionJsonV04, KILL_CRITERION_V04_LIMITS } from '../../knowledge/schema/kill-criterion-v04.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import { ApplicationServiceError } from './contracts.ts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ACTIVE_CLAIM_STATES = new Set(['active'])
const ACTIVE_THESIS_STATES = new Set(['active', 'strengthening', 'weakening', 'challenged'])
const ENTITY_TYPES = new Set(['company', 'industry', 'product', 'technology', 'person', 'institution', 'security'])
const OPERATORS = new Set(['eq', 'gt', 'gte', 'lt', 'lte'])
const RECORD = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface ThesisCriterionPrepareInput {
  readonly thesisRef: string
  readonly conditionId: string
  readonly type?: string
  readonly definitionVersion?: number
  readonly definition: unknown
  readonly targetClaimRefs: readonly string[]
  readonly origin: unknown
}

export interface ThesisCriterionPreview {
  readonly knowledgeBaseId: string
  readonly expectedKnowledgeBaseRevision: number
  readonly thesisRef: string
  readonly conditionId: string
  readonly revision: number
  readonly type: 'numeric_threshold'
  readonly definitionVersion: 1
  readonly definition: NumericThresholdDefinitionV1
  readonly targetClaimRefs: readonly string[]
  readonly origin: KillCriterionOriginV04
  readonly definitionHash: string
  readonly previewHash: string
}

export interface ThesisCriterionConfirmInput {
  readonly preview: ThesisCriterionPreview
  readonly previewHash: string
  readonly expectedKnowledgeBaseRevision: number
  readonly workflowRunId: string
}

export interface ThesisCriterionConfirmResult {
  readonly status: 'confirmed' | 'replayed'
  readonly replay: boolean
  readonly thesisRef: string
  readonly conditionId: string
  readonly criterionRevision: number
  readonly definitionHash: string
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly committedRevision: number
  readonly writerRunId: string
}

interface Snapshot {
  readonly knowledgeBaseId: string
  readonly revision: number
  readonly objects: readonly { readonly kind: string; readonly value: KnowledgeAssetV04 }[]
}
interface WriterLog {
  readonly workflowRunId: string
  readonly knowledgeBaseId: string
  readonly status: string
  readonly writeStatus: string
  readonly committedRevision: number
  readonly changes?: { readonly createdIds?: readonly string[]; readonly updatedIds?: readonly string[] }
}

function fail(code: 'invalid_input' | 'not_found' | 'conflict' | 'failed', message: string): never { throw new ApplicationServiceError(code, message) }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]) }
function safeRunId(value: unknown): value is string { return typeof value === 'string' && value.length <= 128 && SAFE_ID.test(value) && !value.includes('..') }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  const datePart = value.slice(0, 10)
  try { return new Date(`${datePart}T00:00:00.000Z`).toISOString().slice(0, 10) === datePart } catch { return false }
}
function sortRefs(refs: readonly string[]): string[] { return [...new Set(refs)].sort((left, right) => left.localeCompare(right)) }
function previewHash(input: Omit<ThesisCriterionPreview, 'previewHash'>): string {
  // Hash the explicit confirmation intent, including the snapshot revision. A
  // caller cannot transplant a preview between Theses or Knowledge snapshots.
  return hashKnowledgeObject(input)
}

function numericDefinition(value: unknown): NumericThresholdDefinitionV1 {
  if (!RECORD(value) || !isBoundedSafeKillCriterionJsonV04(value)) fail('invalid_input', 'Criterion definition must be bounded safe JSON object data')
  if (!exactKeys(value, ['metricRef', 'operator', 'threshold', 'unit', 'period']) || typeof value.metricRef !== 'string' || !value.metricRef.trim() || value.metricRef.length > 256 || typeof value.operator !== 'string' || !OPERATORS.has(value.operator) || typeof value.threshold !== 'number' || !Number.isFinite(value.threshold) || typeof value.unit !== 'string' || !value.unit.trim() || value.unit.length > 128 || typeof value.period !== 'string' || !value.period.trim() || value.period.length > 256) {
    // V1 authoring intentionally excludes deadline until the evaluator can
    // make a deterministic assessment from it.
    fail('invalid_input', 'numeric_threshold V1 requires metricRef, a supported operator, finite threshold, exact unit and period; deadline is not supported for authoring')
  }
  return { metricRef: value.metricRef, operator: value.operator as NumericThresholdDefinitionV1['operator'], threshold: value.threshold, unit: value.unit, period: value.period }
}

function criterionOrigin(value: unknown): KillCriterionOriginV04 {
  if (!RECORD(value) || typeof value.kind !== 'string') fail('invalid_input', 'Criterion origin must be human_rule or source_derived')
  if (value.kind === 'human_rule' && exactKeys(value, ['kind'])) return { kind: 'human_rule' }
  if (value.kind === 'source_derived' && exactKeys(value, ['kind', 'sourceRef', 'rawRef', 'locator', 'publishedAt']) && typeof value.sourceRef === 'string' && /^source:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.sourceRef) && typeof value.rawRef === 'string' && /^raw-sha256-[0-9a-f]{64}$/.test(value.rawRef) && typeof value.locator === 'string' && value.locator.trim() !== '' && value.locator.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value.locator) && validDate(value.publishedAt)) {
    return { kind: 'source_derived', sourceRef: value.sourceRef as `source:${string}`, rawRef: value.rawRef as `raw-sha256-${string}`, locator: value.locator, publishedAt: value.publishedAt }
  }
  fail('invalid_input', 'Criterion origin has missing, extra, or invalid fields')
}

function entityFor(thesis: KnowledgeThesisV04, objects: Snapshot['objects']): KnowledgeEntityV04 & { readonly type: KnowledgeProductionInput['entity']['entityType'] } {
  if (!Array.isArray(thesis.subjectRefs) || thesis.subjectRefs.length !== 1) return fail('conflict', `Thesis must have exactly one canonical subject: ${thesis.id}`)
  const loaded = objects.find((item) => item.kind === 'entity' && item.value.id === thesis.subjectRefs[0])
  if (!loaded) return fail('conflict', `Thesis subject is missing or is not an Entity: ${thesis.id}`)
  const entity = loaded.value as KnowledgeEntityV04
  if (!ENTITY_TYPES.has(entity.type) || entity.lifecycle?.status !== 'active' || !entity.name?.trim() || (entity.type === 'company' && (!('ticker' in entity) || typeof entity.ticker !== 'string' || !entity.ticker.trim()))) return fail('conflict', `Thesis subject is not a supported active Entity: ${thesis.id}`)
  return entity as KnowledgeEntityV04 & { readonly type: KnowledgeProductionInput['entity']['entityType'] }
}

function validatePreview(value: ThesisCriterionPreview): Omit<ThesisCriterionPreview, 'previewHash'> {
  if (!RECORD(value) || !exactKeys(value, ['knowledgeBaseId', 'expectedKnowledgeBaseRevision', 'thesisRef', 'conditionId', 'revision', 'type', 'definitionVersion', 'definition', 'targetClaimRefs', 'origin', 'definitionHash', 'previewHash']) || value.type !== 'numeric_threshold' || value.definitionVersion !== 1 || !SAFE_ID.test(value.conditionId) || value.conditionId.length > 128 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.expectedKnowledgeBaseRevision) || value.expectedKnowledgeBaseRevision < 0 || typeof value.knowledgeBaseId !== 'string' || !value.knowledgeBaseId || typeof value.thesisRef !== 'string' || !/^thesis:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.thesisRef) || !Array.isArray(value.targetClaimRefs)) fail('invalid_input', 'Criterion preview identity is malformed')
  const definition = numericDefinition(value.definition)
  const origin = criterionOrigin(value.origin)
  if (value.targetClaimRefs.some((ref) => typeof ref !== 'string' || !/^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) fail('invalid_input', 'Criterion preview target Claim refs must be strings in exact canonical form')
  const targets = sortRefs(value.targetClaimRefs)
  if (targets.length === 0 || targets.length !== value.targetClaimRefs.length || targets.length > KILL_CRITERION_V04_LIMITS.targetsPerCriterion) fail('invalid_input', 'Criterion preview target Claim refs must be unique exact canonical refs')
  const expectedDefinitionHash = hashKillCriterionDefinitionV04({ type: value.type, definitionVersion: value.definitionVersion, definition: { ...definition }, targetClaimRefs: targets, origin })
  if (value.definitionHash !== expectedDefinitionHash) fail('invalid_input', 'Criterion preview definition hash does not match its immutable definition')
  const body = { knowledgeBaseId: value.knowledgeBaseId, expectedKnowledgeBaseRevision: value.expectedKnowledgeBaseRevision, thesisRef: value.thesisRef, conditionId: value.conditionId, revision: value.revision, type: value.type, definitionVersion: value.definitionVersion, definition, targetClaimRefs: targets, origin, definitionHash: expectedDefinitionHash }
  if (value.previewHash !== previewHash(body)) fail('invalid_input', 'Criterion preview hash does not match its contents')
  return body
}

export interface ThesisCriterionServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly gateway?: Pick<KnowledgeProductionGateway, 'submit'>
  readonly now?: () => string
}

export class ThesisCriterionService {
  private readonly gateway: Pick<KnowledgeProductionGateway, 'submit'>
  private readonly now: () => string

  constructor(private readonly options: ThesisCriterionServiceOptions) {
    this.gateway = options.gateway ?? new KnowledgeProductionGateway()
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private async snapshot(): Promise<Snapshot> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await loadKnowledgeBaseManifest(this.options.mountedKnowledgeBaseRoot)
      if (before.schemaVersion !== '0.4' || before.storageFormatVersion !== '1' || before.status !== 'active') fail('conflict', 'Criterion authoring requires an active Schema 0.4 / Storage Format 1 Knowledge Base')
      const collection = await readCanonicalV04Assets(this.options.mountedKnowledgeBaseRoot)
      const after = await loadKnowledgeBaseManifest(this.options.mountedKnowledgeBaseRoot)
      if (before.knowledgeBaseId === after.knowledgeBaseId && before.revision === after.revision) return { knowledgeBaseId: after.knowledgeBaseId, revision: after.revision, objects: collection.objects }
    }
    return fail('conflict', 'Knowledge Base changed while preparing the criterion snapshot')
  }

  private async buildPreview(snapshot: Snapshot, input: ThesisCriterionPrepareInput): Promise<ThesisCriterionPreview> {
    if (typeof input.thesisRef !== 'string' || !/^thesis:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.thesisRef)) fail('invalid_input', 'thesisRef must be an exact canonical Thesis ref')
    if (typeof input.conditionId !== 'string' || input.conditionId.length > 128 || !SAFE_ID.test(input.conditionId)) fail('invalid_input', 'conditionId must be a safe Thesis-local identifier')
    if (input.type !== undefined && input.type !== 'numeric_threshold') fail('invalid_input', `Unsupported criterion type for new writes: ${String(input.type)}`)
    if (input.definitionVersion !== undefined && input.definitionVersion !== 1) fail('invalid_input', 'Only numeric_threshold definitionVersion 1 can be authored')
    const definition = numericDefinition(input.definition)
    const origin = criterionOrigin(input.origin)
    if (!Array.isArray(input.targetClaimRefs)) fail('invalid_input', 'targetClaimRefs must be an array')
    if (input.targetClaimRefs.some((ref) => typeof ref !== 'string' || !/^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) fail('invalid_input', 'targetClaimRefs must contain only exact canonical Claim refs')
    const targetClaimRefs = sortRefs(input.targetClaimRefs)
    if (targetClaimRefs.length === 0 || targetClaimRefs.length !== input.targetClaimRefs.length || targetClaimRefs.length > KILL_CRITERION_V04_LIMITS.targetsPerCriterion) fail('invalid_input', 'targetClaimRefs must contain 1 to 32 unique exact canonical Claim refs')
    const indexed = new Map<string, (typeof snapshot.objects)[number]>(snapshot.objects.map((item) => [item.value.id, item]))
    const thesisItem = indexed.get(input.thesisRef)
    if (!thesisItem || thesisItem.kind !== 'thesis') fail('not_found', `Canonical Thesis not found: ${input.thesisRef}`)
    const thesis = thesisItem.value as KnowledgeThesisV04
    if (thesis.lifecycle?.status !== 'active' || !ACTIVE_THESIS_STATES.has(thesis.status)) fail('conflict', `Thesis is not active for criterion authoring: ${input.thesisRef}`)
    entityFor(thesis, snapshot.objects)
    const edges = snapshot.objects.filter((item) => item.kind === 'reasoning_edge').map((item) => item.value as KnowledgeReasoningEdgeV04)
    for (const ref of targetClaimRefs) {
      const target = indexed.get(ref)
      if (!target || target.kind !== 'claim') fail('conflict', `Criterion target is missing or is not a canonical Claim: ${ref}`)
      const claim = target.value as KnowledgeClaimV04
      if (!ACTIVE_CLAIM_STATES.has(claim.lifecycle?.status ?? '') || !edges.some((edge) => edge.id && edge.type === 'qualifies' && edge.sourceRef === ref && edge.targetRef === input.thesisRef && edge.lifecycle?.status === 'active')) fail('conflict', `Criterion targets must be active Claims with active qualifies membership in the Thesis: ${ref}`)
    }
    const criteria = thesis.killCriteria ?? []
    if (!Array.isArray(criteria) || criteria.length >= KILL_CRITERION_V04_LIMITS.revisionsPerThesis) fail('conflict', 'Thesis criterion revision limit has been reached or the canonical collection is malformed')
    const sameCondition = criteria.filter((item) => item.conditionId === input.conditionId)
    const revision = Math.max(0, ...sameCondition.map((item) => Number.isSafeInteger(item.revision) ? item.revision : 0)) + 1
    if (sameCondition.some((item) => !Number.isSafeInteger(item.revision) || item.revision < 1) || sameCondition.length > 0 && revision !== sameCondition.length + 1) fail('conflict', 'Thesis criterion history is not a contiguous revision sequence')
    const definitionHash = hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition: { ...definition }, targetClaimRefs, origin })
    if (origin.kind === 'source_derived') await this.validateSourceOrigin(snapshot, origin, this.now())
    const body = { knowledgeBaseId: snapshot.knowledgeBaseId, expectedKnowledgeBaseRevision: snapshot.revision, thesisRef: input.thesisRef, conditionId: input.conditionId, revision, type: 'numeric_threshold' as const, definitionVersion: 1 as const, definition, targetClaimRefs, origin, definitionHash }
    return { ...body, previewHash: previewHash(body) }
  }

  private async validateSourceOrigin(snapshot: Snapshot, origin: Extract<KillCriterionOriginV04, { kind: 'source_derived' }>, prospectiveConfirmedAt: string): Promise<void> {
    if (!validDate(prospectiveConfirmedAt)) fail('failed', 'Criterion authoring clock returned an invalid timestamp')
    if (!validDate(origin.publishedAt) || Date.parse(origin.publishedAt) > Date.parse(prospectiveConfirmedAt)) fail('invalid_input', 'Source-derived criterion publication must be a full ISO timestamp no later than confirmation')
    const sourceItem = snapshot.objects.find((item) => item.kind === 'source' && item.value.id === origin.sourceRef)
    if (!sourceItem) fail('invalid_input', 'Source-derived criterion origin must resolve to a canonical Source')
    const source = sourceItem.value as KnowledgeSourceV04
    const at = Date.parse(prospectiveConfirmedAt)
    const validFrom = source.lifecycle?.validFrom == null ? undefined : Date.parse(source.lifecycle.validFrom)
    const validUntil = source.lifecycle?.validUntil == null ? undefined : Date.parse(source.lifecycle.validUntil)
    const rightsExpiry = source.rights.expiresAt == null ? undefined : Date.parse(source.rights.expiresAt)
    const eligible = source.lifecycle?.status === 'active' && (validFrom === undefined || Number.isFinite(validFrom) && validFrom <= at) && (validUntil === undefined || Number.isFinite(validUntil) && validUntil > at) && (rightsExpiry === undefined || Number.isFinite(rightsExpiry) && rightsExpiry > at) && ['public', 'authenticated'].includes(source.rights.accessScope) && source.rights.retentionAllowed === true && source.rights.aiProcessingAllowed === true && source.rights.derivativeKnowledgeAllowed === true && source.usagePolicy?.retainRaw === true && source.usagePolicy.allowAiProcessing === true && source.usagePolicy.allowDerivedKnowledge === true && source.publishedAt === origin.publishedAt && Array.isArray(source.rawRefs) && source.rawRefs.includes(origin.rawRef)
    if (!eligible) fail('conflict', 'Source-derived criterion must resolve to an active, rights-eligible Source with the exact publishedAt and bound Raw')
    try { await verifyRaw(await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot), origin.rawRef) }
    catch { fail('conflict', 'Source-derived criterion Raw failed integrity verification during preparation') }
  }

  async prepare(input: ThesisCriterionPrepareInput): Promise<ThesisCriterionPreview> {
    if (!RECORD(input) || Object.keys(input).some((key) => !['thesisRef', 'conditionId', 'type', 'definitionVersion', 'definition', 'targetClaimRefs', 'origin'].includes(key))) fail('invalid_input', 'Criterion prepare input must contain only supported fields')
    return this.buildPreview(await this.snapshot(), input)
  }

  private async readWriterLog(workflowRunId: string): Promise<WriterLog | undefined> {
    const root = resolve(this.options.mountedKnowledgeBaseRoot)
    const directory = join(root, 'logs', 'research')
    const path = join(directory, `${workflowRunId}.yaml`)
    try {
      for (const checked of [join(root, 'logs'), directory]) {
        const stat = await lstat(checked)
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('conflict', 'Criterion Writer log path is unsafe')
      }
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile()) fail('conflict', 'Criterion Writer log is unsafe')
      const [rootReal, pathReal] = await Promise.all([realpath(root), realpath(path)])
      const rel = relative(rootReal, pathReal)
      if (!rel || rel.split(/[\\/]/).includes('..') || isAbsolute(rel)) fail('conflict', 'Criterion Writer log escapes the Knowledge Base')
      const value = parseYaml(await readFile(path, 'utf8'), path)
      if (!RECORD(value) || value.workflowRunId !== workflowRunId || typeof value.knowledgeBaseId !== 'string' || typeof value.status !== 'string' || typeof value.writeStatus !== 'string' || !Number.isSafeInteger(value.committedRevision)) fail('conflict', 'Criterion Writer log is malformed')
      return value as unknown as WriterLog
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private replayResult(snapshot: Snapshot, preview: Omit<ThesisCriterionPreview, 'previewHash'>, workflowRunId: string, log: WriterLog): ThesisCriterionConfirmResult | undefined {
    if (log.status !== 'completed' || log.writeStatus !== 'committed' || log.knowledgeBaseId !== snapshot.knowledgeBaseId || log.committedRevision !== preview.expectedKnowledgeBaseRevision + 1 || !log.changes?.updatedIds?.includes(preview.thesisRef)) return undefined
    const thesis = snapshot.objects.find((item) => item.kind === 'thesis' && item.value.id === preview.thesisRef)?.value as KnowledgeThesisV04 | undefined
    const criterion = thesis?.killCriteria?.find((item) => item.conditionId === preview.conditionId && item.revision === preview.revision && item.authority.workflowRunId === workflowRunId)
    if (!criterion || criterion.type !== preview.type || criterion.definitionVersion !== preview.definitionVersion || criterion.definitionHash !== preview.definitionHash || hashKnowledgeObject(criterion.definition) !== hashKnowledgeObject(preview.definition) || JSON.stringify(sortRefs(criterion.targetClaimRefs)) !== JSON.stringify(preview.targetClaimRefs) || hashKnowledgeObject(criterion.authority.origin) !== hashKnowledgeObject(preview.origin) || Date.parse(criterion.effectiveAt) < Date.parse(criterion.authority.confirmedAt)) return undefined
    return { status: 'replayed', replay: true, thesisRef: preview.thesisRef, conditionId: preview.conditionId, criterionRevision: preview.revision, definitionHash: preview.definitionHash, knowledgeBaseId: snapshot.knowledgeBaseId, knowledgeBaseRevision: snapshot.revision, committedRevision: log.committedRevision, writerRunId: workflowRunId }
  }

  async confirm(input: ThesisCriterionConfirmInput): Promise<ThesisCriterionConfirmResult> {
    if (!RECORD(input) || !exactKeys(input, ['preview', 'previewHash', 'expectedKnowledgeBaseRevision', 'workflowRunId']) || !safeRunId(input.workflowRunId)) fail('invalid_input', 'Confirm input must contain a safe workflowRunId and only supported fields')
    const preview = validatePreview(input.preview)
    if (input.previewHash !== input.preview.previewHash || input.expectedKnowledgeBaseRevision !== preview.expectedKnowledgeBaseRevision) fail('invalid_input', 'Explicit preview hash and expected Knowledge revision must match the submitted preview')
    const snapshot = await this.snapshot()
    if (snapshot.knowledgeBaseId !== preview.knowledgeBaseId) fail('conflict', 'Criterion preview belongs to a different Knowledge Base')

    // Writer logs and the canonical immutable revision jointly establish a
    // replay. The service does not trust an in-memory cache or return a replay
    // merely because the run ID exists.
    const existingLog = await this.readWriterLog(input.workflowRunId)
    if (existingLog) {
      const replay = this.replayResult(snapshot, preview, input.workflowRunId, existingLog)
      if (replay) return replay
      fail('conflict', 'workflowRunId is already bound to a different or unverifiable criterion confirmation')
    }
    if (snapshot.revision !== input.expectedKnowledgeBaseRevision) fail('conflict', 'Knowledge Base revision changed after criterion preparation')

    const freshPreview = await this.buildPreview(snapshot, { thesisRef: preview.thesisRef, conditionId: preview.conditionId, type: preview.type, definitionVersion: preview.definitionVersion, definition: preview.definition, targetClaimRefs: preview.targetClaimRefs, origin: preview.origin })
    if (freshPreview.previewHash !== input.previewHash || freshPreview.definitionHash !== preview.definitionHash || freshPreview.revision !== preview.revision) fail('conflict', 'Criterion definition, target membership, or next revision changed after preparation')

    const thesisItem = snapshot.objects.find((item) => item.kind === 'thesis' && item.value.id === preview.thesisRef)!
    const thesis = thesisItem.value as KnowledgeThesisV04
    const subject = entityFor(thesis, snapshot.objects)
    const companyFields = subject.type === 'company' ? { ticker: subject.ticker, ...(subject.exchange === undefined ? {} : { exchange: subject.exchange }) } : undefined
    const confirmedAt = this.now()
    if (!validDate(confirmedAt)) fail('failed', 'Criterion confirmation clock returned an invalid timestamp')
    const criterion: KillCriterionV04 = {
      conditionId: preview.conditionId,
      revision: preview.revision,
      state: 'active',
      type: preview.type,
      definitionVersion: preview.definitionVersion,
      definition: structuredClone(preview.definition),
      targetClaimRefs: [...preview.targetClaimRefs] as `claim:${string}`[],
      effectiveAt: new Date(confirmedAt).toISOString(),
      definitionHash: preview.definitionHash,
      authority: { workflowRunId: input.workflowRunId, confirmedAt: new Date(confirmedAt).toISOString(), origin: structuredClone(preview.origin) },
    }
    const existingEvidenceBindings = criterion.authority.origin.kind === 'source_derived'
      ? [{ sourceRef: criterion.authority.origin.sourceRef, rawRef: criterion.authority.origin.rawRef, locator: criterion.authority.origin.locator }]
      : undefined
    const productionEntity: KnowledgeProductionInput['entity'] = { localKey: 'thesis-subject', entityType: subject.type, name: subject.name, existingEntityRef: subject.id, ...(companyFields ? { semanticFields: companyFields } : {}) }
    const result = await this.gateway.submit({
      handle: await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot),
      producerType: 'thesis_criterion_confirmed', producerRunId: input.workflowRunId,
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: productionEntity,
      proposals: [{ proposalId: `criterion-confirm-${hashKnowledgeObject(input.workflowRunId).slice(7, 31)}`, kind: 'thesis', subjectKey: productionEntity.localKey, thesisTitle: thesis.title, thesisStatus: thesis.status, statement: thesis.statement, criterionRevision: criterion, ...(existingEvidenceBindings ? { existingEvidenceBindings } : {}) }],
      evidenceBindings: [], now: this.now,
    })
    if (!['committed', 'already_committed'].includes(result.status)) fail(result.status === 'failed' ? 'failed' : 'conflict', `Criterion confirmation was not committed through Knowledge Production Gateway: ${result.errors.join('; ') || result.status}`)

    const latest = await this.snapshot()
    const latestThesis = latest.objects.find((item) => item.kind === 'thesis' && item.value.id === preview.thesisRef)?.value as KnowledgeThesisV04 | undefined
    const persisted = latestThesis?.killCriteria?.find((item) => item.conditionId === preview.conditionId && item.revision === preview.revision)
    if (!persisted || persisted.definitionHash !== preview.definitionHash || persisted.authority.workflowRunId !== input.workflowRunId || latest.revision !== result.knowledgeBaseRevision || latest.revision <= snapshot.revision || latestThesis!.title !== thesis.title || latestThesis!.statement !== thesis.statement || latestThesis!.status !== thesis.status || JSON.stringify(latestThesis!.subjectRefs) !== JSON.stringify(thesis.subjectRefs)) fail('failed', 'Canonical Thesis reload did not prove the confirmed criterion and Writer revision')
    const writerLog = await this.readWriterLog(input.workflowRunId)
    if (!writerLog || writerLog.status !== 'completed' || writerLog.writeStatus !== 'committed' || writerLog.knowledgeBaseId !== snapshot.knowledgeBaseId || writerLog.committedRevision !== latest.revision || !writerLog.changes?.updatedIds?.includes(preview.thesisRef)) fail('failed', 'Writer execution log does not prove the confirmed Thesis revision commit')
    return { status: 'confirmed', replay: false, thesisRef: preview.thesisRef, conditionId: preview.conditionId, criterionRevision: preview.revision, definitionHash: preview.definitionHash, knowledgeBaseId: latest.knowledgeBaseId, knowledgeBaseRevision: latest.revision, committedRevision: writerLog.committedRevision, writerRunId: input.workflowRunId }
  }
}
