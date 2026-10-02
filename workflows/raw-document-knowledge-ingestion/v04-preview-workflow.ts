import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'
import type { AcquiredDocumentInput, DocumentInputRef, StructuredDocument } from '../../plugins/document/contracts.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { deriveRawIdentity } from '../../knowledge/raw/raw-identity.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { RawDocumentGatewayV04Input, RawDocumentGatewayV04Result, RawDocumentMetadataV04, RawDocumentRightsV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { ConsolidatedExtraction } from './extraction/consolidation.ts'
import { consolidateExtractions } from './extraction/consolidation.ts'
import type { AcceptedExtractionPlan, AcceptedExtractionUnit, ConsolidationReviewConstraint, PlanAttemptSummary } from './contracts.ts'
import { ExtractionPlanValidationError, validateExtractionPlan } from './planning/plan-validation.ts'
import type { KnowledgeCurationSkill } from '../../skills/knowledge-curation/skill.ts'
import type { CandidateEntityRef, CandidateKind, CandidateValidationCode, ClaimCandidate, EntityCandidate, ExtractKnowledgeInput, RelationCandidate, UnderstandAndPlanInput, UnderstandAndPlanOutput, ValidatedExtractKnowledgeResult } from '../../skills/knowledge-curation/contracts.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../../knowledge/schema/executable-schema.ts'

const WORKFLOW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const DEFAULT_CONFIG = { maxExtractionUnits: 64, maxPlanAttempts: 2, maxConcurrency: 4 }
const MAX_CONFIG = { maxExtractionUnits: 64, maxPlanAttempts: 4, maxConcurrency: 8 }
const MAX_CANDIDATES_PER_UNIT = 256
const MAX_CANDIDATES_PER_PREVIEW = 4096
const MAX_EXTRACTION_OUTPUT_CHARS = 512_000
const SOURCE_REF_PATTERN = /^source:[A-Za-z0-9._-]{1,128}$/u
const RAW_REF_PATTERN = /^raw-sha256-[0-9a-f]{64}$/u
const CANDIDATE_ID_PATTERN = /^(?!entity:|relation:|claim:|source:|module:|theme-group:)[^\u0000-\u001f\u007f-\u009f]{1,200}$/iu
const CANDIDATE_VALIDATION_CODES = ['invalid_model_output', 'invalid_reference', 'invalid_semantics', 'invalid_confidence', 'ungrounded_candidate'] as const

export interface RawDocumentPreviewConfigV04 {
  readonly maxExtractionUnits?: number
  readonly maxPlanAttempts?: number
  readonly maxConcurrency?: number
  readonly maxContextTokens?: number
}

export interface RawDocumentPreviewSkillV04 {
  capabilities: KnowledgeCurationSkill['capabilities']
  understandAndPlan(input: UnderstandAndPlanInput & { readonly signal?: AbortSignal }): Promise<UnderstandAndPlanOutput>
  extractKnowledge(input: ExtractKnowledgeInput & { readonly signal?: AbortSignal }): Promise<ValidatedExtractKnowledgeResult>
}

export interface DocumentInputResolverV04 {
  acquire(input: DocumentInputRef, options?: { readonly signal?: AbortSignal }): Promise<AcquiredDocumentInput>
  parse(input: AcquiredDocumentInput, options?: { readonly signal?: AbortSignal }): Promise<StructuredDocument>
}

export interface RawDocumentGatewayV04Port {
  submit(input: RawDocumentGatewayV04Input, options?: { readonly signal?: AbortSignal }): Promise<RawDocumentGatewayV04Result>
}

export interface RawDocumentCandidateGroupV04 {
  readonly candidateId: string
  readonly kind: 'entity' | 'relation' | 'claim'
  readonly candidate: ConsolidatedExtraction['groups'][number]['candidate']
  readonly provenanceRefs: {
    readonly sourceRef: string
    readonly rawRef: string
    readonly evidenceBlockRefs: readonly string[]
  }
}

export interface RawDocumentPreviewUnitSummaryV04 {
  readonly unitId: string
  readonly proposedUnitId: string
  readonly attempts: number
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly candidateCounts: Readonly<Record<string, number>>
  readonly rejectedCount: number
  readonly error?: string
}

export type RawDocumentPreviewWorkflowStatusV04 = 'preview_ready' | 'preview_partial' | 'source_only' | 'blocked' | 'cancelled' | 'incompatible_schema'
export type RawDocumentPreviewStageStatusV04 = 'not_started' | 'completed' | 'partial' | 'blocked' | 'cancelled'
export type RawDocumentSourceStageStatusV04 = RawDocumentGatewayV04Result['status'] | 'not_started' | 'in_flight' | 'unknown'

export interface RawDocumentPreviewWorkflowResultV04 {
  readonly workflowRunId: string
  readonly knowledgeBaseId: string
  readonly status: RawDocumentPreviewWorkflowStatusV04
  readonly sourceRaw: {
    readonly status: RawDocumentSourceStageStatusV04
    readonly persisted: boolean
    readonly revision: number
    readonly sourceRef?: string
    readonly rawRef?: string
    readonly errors: readonly { readonly code: string; readonly message: string }[]
  }
  readonly extractionPreview: {
    readonly status: RawDocumentPreviewStageStatusV04
    readonly documentId?: string
    readonly acceptedPlan?: AcceptedExtractionPlan
    readonly planAttempts: readonly PlanAttemptSummary[]
    readonly unitSummaries: readonly RawDocumentPreviewUnitSummaryV04[]
    readonly candidateGroups: readonly RawDocumentCandidateGroupV04[]
    readonly candidateCounts: Readonly<Record<string, number>>
    readonly rejectedCandidates: readonly unknown[]
    readonly reviewConstraints: readonly ConsolidationReviewConstraint[]
    readonly errors: readonly string[]
  }
  readonly provenance?: {
    readonly sourceRef: string
    readonly rawRef: string
    readonly documentId?: string
    readonly sourceRevision: number
  }
  readonly compatibility?: { readonly requiredSchemaVersion: '0.4'; readonly actualSchemaVersion: string }
  readonly cancellation?: {
    readonly pendingOperation: 'document_acquire' | 'raw_gateway_submit' | 'source_receipt_verification' | 'document_parse' | 'understand_and_plan' | 'extract_knowledge'
    readonly pendingCallMayContinue: true
    readonly message: string
  }
}

export interface RawDocumentPreviewWorkflowInputV04 {
  readonly handle: KnowledgeBaseHandle
  readonly documentInput: DocumentInputRef
  readonly skill: RawDocumentPreviewSkillV04
  readonly workflowRunId: string
  readonly rights: RawDocumentRightsV04
  readonly sourceMetadata: RawDocumentMetadataV04
  readonly instructions?: string
  readonly config?: RawDocumentPreviewConfigV04
  readonly clock?: () => string
  readonly documentResolver?: DocumentInputResolverV04
  readonly gateway?: RawDocumentGatewayV04Port
  readonly signal?: AbortSignal
}

interface EffectiveConfig {
  readonly maxExtractionUnits: number
  readonly maxPlanAttempts: number
  readonly maxConcurrency: number
  readonly maxContextTokens?: number
}

interface ExtractionOutcome {
  readonly extractions: readonly { readonly unit: AcceptedExtractionUnit; readonly result: ValidatedExtractKnowledgeResult }[]
  readonly summaries: readonly RawDocumentPreviewUnitSummaryV04[]
  readonly errors: readonly string[]
  readonly peakConcurrency: number
  readonly pendingCallMayContinue: boolean
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function aborted(input: RawDocumentPreviewWorkflowInputV04): boolean { return input.signal?.aborted === true }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

type AbortableOutcome<T> = { readonly kind: 'completed'; readonly value: T } | { readonly kind: 'rejected'; readonly error: unknown } | { readonly kind: 'cancelled' }

/**
 * Stop waiting when cancelled, while attaching handlers to both outcomes so a
 * later non-abortable completion/rejection is observed and cannot mutate this
 * Workflow's result or become an unhandled rejection.
 */
function awaitAbortable<T>(operation: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<AbortableOutcome<T>> {
  if (signal?.aborted) return Promise.resolve({ kind: 'cancelled' })
  const pending = Promise.resolve().then(() => operation(signal))
  if (!signal) return pending.then((value) => ({ kind: 'completed', value }), (error: unknown) => ({ kind: 'rejected', error }))
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: AbortableOutcome<T>): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = (): void => finish({ kind: 'cancelled' })
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then((value) => finish({ kind: 'completed', value }), (error: unknown) => finish({ kind: 'rejected', error }))
    if (signal.aborted) onAbort()
  })
}

function cancellationInfo(pendingOperation: NonNullable<RawDocumentPreviewWorkflowResultV04['cancellation']>['pendingOperation']): NonNullable<RawDocumentPreviewWorkflowResultV04['cancellation']> {
  const message = pendingOperation === 'raw_gateway_submit'
    ? 'Workflow stopped waiting after cancellation; the non-abortable Source/Raw Gateway call may still finish and persist data.'
    : pendingOperation === 'source_receipt_verification'
      ? 'Workflow stopped waiting after cancellation; Source/Raw persistence is not verified, and read-only verification may still finish.'
      : `Workflow stopped waiting for ${pendingOperation} after cancellation; the underlying non-abortable call may still continue.`
  return { pendingOperation, pendingCallMayContinue: true, message }
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error(`${label} must be a non-empty bounded string`)
  return value.trim()
}

function localCandidateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CANDIDATE_ID_PATTERN.test(value)) throw new Error(`${label} must be a bounded local candidate ID`)
  return value
}

function uniqueCandidateId(value: unknown, label: string, candidateIds: Set<string>): string {
  const candidateId = localCandidateId(value, label)
  if (candidateIds.has(candidateId)) throw new Error(`${label} duplicates candidateId ${candidateId}`)
  candidateIds.add(candidateId)
  return candidateId
}

function boundedRecord(value: unknown, label: string, maxChars = 64_000): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const encoded = JSON.stringify(value)
  if (typeof encoded !== 'string' || encoded.length > maxChars) throw new Error(`${label} exceeds the supported JSON size bound`)
  return value
}

function validateCandidateEvidence(value: unknown, label: string, unit: AcceptedExtractionUnit): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) throw new Error(`${label} must contain between 1 and 128 evidence block refs`)
  const refs = value.map((item, index) => boundedText(item, `${label}[${index}]`, 256))
  const allowed = new Set([...unit.primaryBlockIds, ...unit.contextBlockIds])
  if (refs.some((ref) => !allowed.has(ref))) throw new Error(`${label} contains a block ref that was not supplied to this extraction unit`)
  if (!refs.some((ref) => unit.primaryBlockIds.includes(ref))) throw new Error(`${label} must include primary-grounded evidence`)
  if (new Set(refs).size !== refs.length) throw new Error(`${label} contains duplicate block refs`)
  return refs
}

function validateCandidateConfidence(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`${label} must be between 0 and 1`)
}

function candidateEntityRef(value: unknown, label: string, entities: ReadonlyMap<string, EntityCandidate>): CandidateEntityRef {
  if (!isRecord(value)) throw new Error(`${label} must be an Entity candidate reference`)
  const candidateRef = localCandidateId(value.candidateRef, `${label}.candidateRef`)
  const entity = entities.get(candidateRef)
  if (!entity) throw new Error(`${label} refers to an Entity candidate absent from this unit`)
  const mention = boundedText(value.mention, `${label}.mention`, 512)
  if (value.entityType !== undefined && value.entityType !== entity.entityType) throw new Error(`${label}.entityType disagrees with its Entity candidate`)
  return { candidateRef, mention, ...(value.entityType === undefined ? {} : { entityType: entity.entityType }) }
}

function validateExtractionResult(output: unknown, unit: AcceptedExtractionUnit): ValidatedExtractKnowledgeResult {
  if (!isRecord(output)) throw new Error('ExtractKnowledge result must be an object')
  let encoded: string | undefined
  try { encoded = JSON.stringify(output) } catch (error) { throw new Error(`ExtractKnowledge result is not serializable: ${errorText(error)}`) }
  if (typeof encoded !== 'string' || encoded.length > MAX_EXTRACTION_OUTPUT_CHARS) throw new Error(`ExtractKnowledge result exceeds ${MAX_EXTRACTION_OUTPUT_CHARS} characters`)
  let snapshot: unknown
  try { snapshot = structuredClone(output) } catch (error) { throw new Error(`ExtractKnowledge result cannot be safely snapshotted: ${errorText(error)}`) }
  if (!isRecord(snapshot)) throw new Error('ExtractKnowledge snapshot must be an object')
  for (const key of ['entities', 'relations', 'claims', 'rejected']) if (!Array.isArray(snapshot[key])) throw new Error(`ExtractKnowledge result.${key} must be an array`)
  const entitiesRaw = snapshot.entities as unknown[]
  const relationsRaw = snapshot.relations as unknown[]
  const claimsRaw = snapshot.claims as unknown[]
  const rejectedRaw = snapshot.rejected as unknown[]
  const totalCandidates = entitiesRaw.length + relationsRaw.length + claimsRaw.length
  if (totalCandidates > MAX_CANDIDATES_PER_UNIT) throw new Error(`Extraction unit exceeds ${MAX_CANDIDATES_PER_UNIT} candidates`)
  if (rejectedRaw.length > MAX_CANDIDATES_PER_UNIT) throw new Error(`Extraction unit exceeds ${MAX_CANDIDATES_PER_UNIT} rejected candidate records`)

  const entities = new Map<string, EntityCandidate>()
  const candidateIds = new Set<string>()
  const entityRows: EntityCandidate[] = []
  for (const [index, raw] of entitiesRaw.entries()) {
    if (!isRecord(raw)) throw new Error(`entities[${index}] must be an object`)
    const candidateId = uniqueCandidateId(raw.candidateId, `entities[${index}].candidateId`, candidateIds)
    if (typeof raw.entityType !== 'string' || !KNOWLEDGE_SCHEMA_V03.entity.types.includes(raw.entityType as never)) throw new Error(`entities[${index}].entityType is unsupported`)
    const name = boundedText(raw.name, `entities[${index}].name`, 512)
    const reason = boundedText(raw.reason, `entities[${index}].reason`, 2_000)
    const evidenceBlockRefs = validateCandidateEvidence(raw.evidenceBlockRefs, `entities[${index}].evidenceBlockRefs`, unit)
    if (raw.aliases !== undefined) {
      if (!Array.isArray(raw.aliases) || raw.aliases.length > 64) throw new Error(`entities[${index}].aliases exceeds the supported shape`)
      raw.aliases.forEach((alias, aliasIndex) => { boundedText(alias, `entities[${index}].aliases[${aliasIndex}]`, 512) })
    }
    if (raw.description !== undefined && raw.description !== null) boundedText(raw.description, `entities[${index}].description`, 4_000)
    if (raw.semanticFields !== undefined) boundedRecord(raw.semanticFields, `entities[${index}].semanticFields`)
    validateCandidateConfidence(raw.confidence, `entities[${index}].confidence`)
    const candidate = raw as unknown as EntityCandidate
    entityRows.push({ ...candidate, candidateId, name, reason, evidenceBlockRefs })
    entities.set(candidateId, candidate)
  }

  const relations: RelationCandidate[] = []
  for (const [index, raw] of relationsRaw.entries()) {
    if (!isRecord(raw)) throw new Error(`relations[${index}] must be an object`)
    const candidateId = uniqueCandidateId(raw.candidateId, `relations[${index}].candidateId`, candidateIds)
    if (typeof raw.relationType !== 'string' || !KNOWLEDGE_SCHEMA_V03.relation.types.includes(raw.relationType as never)) throw new Error(`relations[${index}].relationType is unsupported`)
    const source = candidateEntityRef(raw.source, `relations[${index}].source`, entities)
    const target = candidateEntityRef(raw.target, `relations[${index}].target`, entities)
    const evidenceBlockRefs = validateCandidateEvidence(raw.evidenceBlockRefs, `relations[${index}].evidenceBlockRefs`, unit)
    const reason = boundedText(raw.reason, `relations[${index}].reason`, 2_000)
    if (raw.attributes !== undefined) boundedRecord(raw.attributes, `relations[${index}].attributes`)
    validateCandidateConfidence(raw.confidence, `relations[${index}].confidence`)
    relations.push({ ...(raw as unknown as RelationCandidate), candidateId, source, target, evidenceBlockRefs, reason })
  }

  const claims: ClaimCandidate[] = []
  for (const [index, raw] of claimsRaw.entries()) {
    if (!isRecord(raw)) throw new Error(`claims[${index}] must be an object`)
    const candidateId = uniqueCandidateId(raw.candidateId, `claims[${index}].candidateId`, candidateIds)
    if (typeof raw.claimType !== 'string' || !KNOWLEDGE_SCHEMA_V03.claim.types.includes(raw.claimType as never)) throw new Error(`claims[${index}].claimType is unsupported`)
    const statement = boundedText(raw.statement, `claims[${index}].statement`, 8_000)
    if (!Array.isArray(raw.subjectRefs) || raw.subjectRefs.length === 0 || raw.subjectRefs.length > 32) throw new Error(`claims[${index}].subjectRefs must contain between 1 and 32 Entity refs`)
    const subjectRefs = raw.subjectRefs.map((ref, refIndex) => candidateEntityRef(ref, `claims[${index}].subjectRefs[${refIndex}]`, entities))
    const evidenceBlockRefs = validateCandidateEvidence(raw.evidenceBlockRefs, `claims[${index}].evidenceBlockRefs`, unit)
    const reason = boundedText(raw.reason, `claims[${index}].reason`, 2_000)
    if (raw.temporal !== undefined && raw.temporal !== null) boundedRecord(raw.temporal, `claims[${index}].temporal`)
    if (raw.structuredValue !== undefined && raw.structuredValue !== null) boundedRecord(raw.structuredValue, `claims[${index}].structuredValue`)
    validateCandidateConfidence(raw.confidence, `claims[${index}].confidence`)
    claims.push({ ...(raw as unknown as ClaimCandidate), candidateId, statement, subjectRefs, evidenceBlockRefs, reason })
  }

  const summary = snapshot.summary
  if (!isRecord(summary)) throw new Error('ExtractKnowledge result.summary must be an object')
  const countKinds = ['entity', 'relation', 'claim'] as const
  const validateCounts = (value: unknown, label: string): Record<CandidateKind, number> => {
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    const result: Record<CandidateKind, number> = { entity: 0, relation: 0, claim: 0 }
    for (const kind of countKinds) {
      const count = value[kind]
      if (!Number.isSafeInteger(count) || (count as number) < 0) throw new Error(`${label}.${kind} must be a non-negative safe integer`)
      result[kind] = count as number
    }
    return result
  }
  const inputCounts = validateCounts(summary.inputCounts, 'summary.inputCounts')
  const acceptedCounts = validateCounts(summary.acceptedCounts, 'summary.acceptedCounts')
  const rejectedCounts = validateCounts(summary.rejectedCounts, 'summary.rejectedCounts')
  const acceptedByKind = { entity: entityRows.length, relation: relations.length, claim: claims.length }
  const rejectedByKind = { entity: 0, relation: 0, claim: 0 }
  const rejected = rejectedRaw.map((raw, index) => {
    if (!isRecord(raw) || !['entity', 'relation', 'claim'].includes(String(raw.kind)) || !CANDIDATE_VALIDATION_CODES.includes(raw.code as never)) throw new Error(`rejected[${index}] has an invalid kind or code`)
    const candidateId = raw.candidateId === undefined ? undefined : boundedText(raw.candidateId, `rejected[${index}].candidateId`, 200)
    const kind = raw.kind as keyof typeof rejectedByKind
    rejectedByKind[kind] += 1
    return { ...(candidateId === undefined ? {} : { candidateId }), kind, code: raw.code as CandidateValidationCode, message: boundedText(raw.message, `rejected[${index}].message`, 2_000) }
  })
  for (const kind of countKinds) {
    if (acceptedCounts[kind] !== acceptedByKind[kind] || rejectedCounts[kind] !== rejectedByKind[kind] || inputCounts[kind] !== acceptedByKind[kind] + rejectedByKind[kind]) throw new Error(`summary counts for ${kind} do not match the candidate arrays`)
  }
  if (!Array.isArray(summary.rejectionCodes) || summary.rejectionCodes.length > CANDIDATE_VALIDATION_CODES.length || summary.rejectionCodes.some((code) => !CANDIDATE_VALIDATION_CODES.includes(code as never))) throw new Error('summary.rejectionCodes has an invalid shape')
  const expectedCodes = [...new Set(rejected.map((item) => item.code))].sort()
  if ([...summary.rejectionCodes].sort().join('\u0000') !== expectedCodes.join('\u0000')) throw new Error('summary.rejectionCodes do not match rejected records')
  return { entities: entityRows, relations, claims, rejected, summary: { inputCounts, acceptedCounts, rejectedCounts, rejectionCodes: expectedCodes as ValidatedExtractKnowledgeResult['summary']['rejectionCodes'] } }
}

function validateConfig(config: RawDocumentPreviewConfigV04 | undefined): { readonly effective?: EffectiveConfig; readonly errors: readonly string[] } {
  const allowed = new Set(['maxExtractionUnits', 'maxPlanAttempts', 'maxConcurrency', 'maxContextTokens'])
  const errors: string[] = []
  for (const [key, value] of Object.entries(config ?? {})) {
    const maximum = MAX_CONFIG[key as keyof typeof MAX_CONFIG]
    if (!allowed.has(key) || !Number.isSafeInteger(value) || (value as number) <= 0 || (maximum !== undefined && (value as number) > maximum)) errors.push(`${key} is outside the supported positive integer bounds`)
  }
  if (errors.length > 0) return { errors }
  return {
    effective: {
      maxExtractionUnits: config?.maxExtractionUnits ?? DEFAULT_CONFIG.maxExtractionUnits,
      maxPlanAttempts: config?.maxPlanAttempts ?? DEFAULT_CONFIG.maxPlanAttempts,
      maxConcurrency: config?.maxConcurrency ?? DEFAULT_CONFIG.maxConcurrency,
      ...(config?.maxContextTokens === undefined ? {} : { maxContextTokens: config.maxContextTokens }),
    },
    errors,
  }
}

function initialSourceStage(handle: KnowledgeBaseHandle): RawDocumentPreviewWorkflowResultV04['sourceRaw'] {
  return { status: 'not_started', persisted: false, revision: handle.revision, errors: [] }
}

function initialPreviewStage(status: RawDocumentPreviewStageStatusV04 = 'not_started', errors: readonly string[] = []): RawDocumentPreviewWorkflowResultV04['extractionPreview'] {
  return { status, planAttempts: [], unitSummaries: [], candidateGroups: [], candidateCounts: {}, rejectedCandidates: [], reviewConstraints: [], errors }
}

function isRawGatewayResult(value: unknown): value is RawDocumentGatewayV04Result {
  return isRecord(value)
    && ['committed', 'already_committed', 'no_changes', 'blocked', 'failed'].includes(String(value.status))
    && typeof value.knowledgeBaseId === 'string'
    && typeof value.baseRevision === 'number'
    && typeof value.knowledgeBaseRevision === 'number'
    && Array.isArray(value.createdIds) && value.createdIds.every((id) => typeof id === 'string')
    && Array.isArray(value.updatedIds) && value.updatedIds.every((id) => typeof id === 'string')
    && Array.isArray(value.errors) && value.errors.every((item) => isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string')
    && (value.sourceRef === undefined || typeof value.sourceRef === 'string')
    && (value.rawRef === undefined || typeof value.rawRef === 'string')
}

function result(input: RawDocumentPreviewWorkflowInputV04, status: RawDocumentPreviewWorkflowStatusV04, sourceRaw: RawDocumentPreviewWorkflowResultV04['sourceRaw'], extractionPreview: RawDocumentPreviewWorkflowResultV04['extractionPreview'], extra: Partial<Pick<RawDocumentPreviewWorkflowResultV04, 'provenance' | 'compatibility' | 'cancellation'>> = {}): RawDocumentPreviewWorkflowResultV04 {
  return { workflowRunId: input.workflowRunId, knowledgeBaseId: input.handle.knowledgeBaseId, status, sourceRaw, extractionPreview, ...extra }
}

function sourceStageFromGateway(value: RawDocumentGatewayV04Result): RawDocumentPreviewWorkflowResultV04['sourceRaw'] {
  const claimsSuccess = value.status === 'committed' || value.status === 'already_committed' || value.status === 'no_changes'
  const errors = value.errors.length > 0 ? value.errors : claimsSuccess ? [{ code: 'RAW_DOCUMENT_PERSISTENCE_UNVERIFIED', message: 'Gateway receipt has not been verified against canonical Source and Raw storage.' }] : []
  return {
    status: value.status,
    persisted: false,
    revision: value.knowledgeBaseRevision,
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
    ...(value.rawRef === undefined ? {} : { rawRef: value.rawRef }),
    errors,
  }
}

function failedReceipt(stage: RawDocumentPreviewWorkflowResultV04['sourceRaw'], code: string, message: string): RawDocumentPreviewWorkflowResultV04['sourceRaw'] {
  return { ...stage, status: 'failed', persisted: false, errors: [...stage.errors, { code, message }] }
}

async function verifySourceRawReceipt(handle: KnowledgeBaseHandle, receipt: RawDocumentGatewayV04Result, stage: RawDocumentPreviewWorkflowResultV04['sourceRaw'], expectedRawRef: string): Promise<RawDocumentPreviewWorkflowResultV04['sourceRaw']> {
  if (!['committed', 'already_committed', 'no_changes'].includes(receipt.status)) return stage
  if (receipt.knowledgeBaseId !== handle.knowledgeBaseId) return failedReceipt(stage, 'RAW_DOCUMENT_RECEIPT_KB_MISMATCH', 'Gateway receipt belongs to a different Knowledge Base.')
  if (!Number.isSafeInteger(receipt.baseRevision) || receipt.baseRevision < 0 || !Number.isSafeInteger(receipt.knowledgeBaseRevision) || receipt.knowledgeBaseRevision < 0) return failedReceipt(stage, 'RAW_DOCUMENT_RECEIPT_REVISION_INVALID', 'Gateway receipt contains an invalid Knowledge Base revision.')
  const validCommitRevision = receipt.status === 'no_changes'
    ? receipt.knowledgeBaseRevision === receipt.baseRevision
    : receipt.knowledgeBaseRevision === receipt.baseRevision + 1
  if (!validCommitRevision) return failedReceipt(stage, 'RAW_DOCUMENT_RECEIPT_REVISION_INVALID', 'Gateway receipt revision does not match its committed status.')
  if (typeof receipt.sourceRef !== 'string' || !SOURCE_REF_PATTERN.test(receipt.sourceRef) || typeof receipt.rawRef !== 'string' || !RAW_REF_PATTERN.test(receipt.rawRef)) return failedReceipt(stage, 'RAW_DOCUMENT_RECEIPT_REF_INVALID', 'Gateway receipt Source or Raw ref does not match the canonical reference format.')
  try {
    const registry = new KnowledgeBaseRegistry()
    const currentHandle = await registry.mount(handle.rootRef)
    if (currentHandle.knowledgeBaseId !== receipt.knowledgeBaseId || currentHandle.schemaVersion !== '0.4' || currentHandle.storageFormatVersion !== '1' || currentHandle.status !== 'active') throw new Error('Mounted Knowledge Base identity, schema, or writable state does not match the receipt.')
    if (currentHandle.revision < receipt.knowledgeBaseRevision) throw new Error('Mounted Knowledge Base revision is older than the Gateway receipt.')
    const assets = await readCanonicalV04Assets(currentHandle.rootRef)
    const sourceAsset = assets.objects.filter((asset) => asset.kind === 'source').map((asset) => asset.value as unknown).find((value) => isRecord(value) && value.id === receipt.sourceRef)
    if (!isRecord(sourceAsset) || sourceAsset.id !== receipt.sourceRef || !Array.isArray(sourceAsset.rawRefs) || !sourceAsset.rawRefs.includes(receipt.rawRef)) throw new Error('Canonical Source does not exist or does not reference the receipt Raw object.')
    const raw = await verifyRaw(currentHandle, receipt.rawRef)
    if (raw.rawRef !== receipt.rawRef || receipt.rawRef !== expectedRawRef || sourceAsset.contentHash !== raw.contentHash.slice('sha256:'.length)) throw new Error('Raw archive identity, bytes, or Source content hash does not match this document intake.')
    return { ...stage, status: receipt.status, persisted: true, revision: receipt.knowledgeBaseRevision, sourceRef: receipt.sourceRef, rawRef: receipt.rawRef, errors: [] }
  } catch (error) {
    return failedReceipt(stage, 'RAW_DOCUMENT_RECEIPT_STORAGE_UNVERIFIED', errorText(error))
  }
}

function themePreviewConstraints(groups: ConsolidatedExtraction['groups']): ConsolidationReviewConstraint[] {
  return groups.flatMap((group) => {
    if (group.kind !== 'entity' || (group.candidate as EntityCandidate).entityType !== 'investment_theme') return []
    return [{
      candidateId: group.candidateId,
      reason: 'InvestmentTheme candidates require the Theme Framework workflow and are not created by raw document preview.',
      conflictingFields: [],
      blocking: true,
      category: 'theme_creation' as const,
      reviewKey: `theme-framework-required:${group.candidateId}`,
    }]
  })
}

async function extractBounded(input: RawDocumentPreviewWorkflowInputV04, document: StructuredDocument, reportMap: Parameters<RawDocumentPreviewSkillV04['extractKnowledge']>[0]['reportMap'], units: readonly AcceptedExtractionUnit[], maxConcurrency: number): Promise<ExtractionOutcome> {
  const results: Array<{ unit: AcceptedExtractionUnit; result: ValidatedExtractKnowledgeResult } | undefined> = new Array(units.length)
  const summaries: Array<RawDocumentPreviewUnitSummaryV04 | undefined> = new Array(units.length)
  const errors: string[] = []
  let next = 0
  let active = 0
  let peakConcurrency = 0
  let pendingCallMayContinue = false
  async function worker(): Promise<void> {
    while (true) {
      if (aborted(input)) return
      const index = next++
      if (index >= units.length) return
      const unit = units[index]!
      active += 1
      peakConcurrency = Math.max(peakConcurrency, active)
      try {
        const outcome = await awaitAbortable((signal) => input.skill.extractKnowledge({ document, reportMap, unit, instructions: input.instructions, signal }), input.signal)
        if (outcome.kind === 'cancelled') {
          pendingCallMayContinue = true
          summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 0, status: 'cancelled', candidateCounts: {}, rejectedCount: 0, error: 'Workflow cancelled while extraction was pending.' }
          return
        }
        if (aborted(input)) {
          summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 0, status: 'cancelled', candidateCounts: {}, rejectedCount: 0, error: 'Workflow cancelled while extraction was pending.' }
          return
        }
        if (outcome.kind === 'rejected') throw outcome.error
        const extracted = validateExtractionResult(outcome.value, unit)
        results[index] = { unit, result: extracted }
        summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 1, status: 'completed', candidateCounts: { entity: extracted.entities.length, relation: extracted.relations.length, claim: extracted.claims.length }, rejectedCount: extracted.rejected.length }
      } catch (error) {
        const message = errorText(error)
        errors.push(`Extraction unit ${unit.unitId} failed: ${message}`)
        summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 1, status: aborted(input) ? 'cancelled' : 'failed', candidateCounts: {}, rejectedCount: 0, error: message }
      } finally {
        active -= 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, units.length) }, () => worker()))
  for (let index = 0; index < units.length; index += 1) {
    if (summaries[index] !== undefined) continue
    const unit = units[index]!
    const cancelled = aborted(input)
    summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 0, status: cancelled ? 'cancelled' : 'failed', candidateCounts: {}, rejectedCount: 0, error: cancelled ? 'Workflow cancelled before extraction began.' : 'Extraction did not complete.' }
    if (!cancelled) errors.push(`Extraction unit ${unit.unitId} did not complete`)
  }
  let totalCandidates = 0
  for (let index = 0; index < results.length; index += 1) {
    const current = results[index]
    if (!current) continue
    const candidateCount = current.result.entities.length + current.result.relations.length + current.result.claims.length
    if (totalCandidates + candidateCount > MAX_CANDIDATES_PER_PREVIEW) {
      results[index] = undefined
      const unit = units[index]!
      const message = `Preview candidate total exceeds ${MAX_CANDIDATES_PER_PREVIEW}; this extraction unit was withheld.`
      errors.push(`Extraction unit ${unit.unitId} failed: ${message}`)
      summaries[index] = { unitId: unit.unitId, proposedUnitId: unit.proposedUnitId, attempts: 1, status: 'failed', candidateCounts: {}, rejectedCount: 0, error: message }
      continue
    }
    totalCandidates += candidateCount
  }
  return { extractions: results.filter((item): item is { unit: AcceptedExtractionUnit; result: ValidatedExtractKnowledgeResult } => item !== undefined), summaries: summaries.filter((item): item is RawDocumentPreviewUnitSummaryV04 => item !== undefined), errors, peakConcurrency, pendingCallMayContinue }
}

function candidateGroups(groups: ConsolidatedExtraction['groups'], sourceRef: string, rawRef: string): RawDocumentCandidateGroupV04[] {
  return groups.map((group) => ({
    ...group,
    provenanceRefs: { sourceRef, rawRef, evidenceBlockRefs: [...group.candidate.evidenceBlockRefs] },
  }))
}

function emptyConsolidated(): ConsolidatedExtraction {
  return { groups: [], reviewConstraints: [], rejected: [], candidateCounts: { entity: 0, relation: 0, claim: 0, consolidated: 0, rejected: 0 }, candidateAliases: new Map(), entityCandidates: new Map(), candidateSupport: new Map() }
}

export async function runRawDocumentKnowledgePreviewV04(input: RawDocumentPreviewWorkflowInputV04): Promise<RawDocumentPreviewWorkflowResultV04> {
  let sourceRaw = initialSourceStage(input.handle)
  let extractionPreview = initialPreviewStage()
  let provenance: RawDocumentPreviewWorkflowResultV04['provenance']
  if (!WORKFLOW_RUN_ID.test(input.workflowRunId)) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', ['workflowRunId must be a safe deterministic identifier']))
  if (input.handle.schemaVersion !== '0.4') return result(input, 'incompatible_schema', sourceRaw, initialPreviewStage('blocked', ['Raw document preview requires Schema 0.4; Schema 0.3 must be explicitly re-ingested into a new Schema 0.4 Knowledge Base.']), { compatibility: { requiredSchemaVersion: '0.4', actualSchemaVersion: input.handle.schemaVersion } })
  if (input.handle.storageFormatVersion !== '1' || input.handle.status !== 'active' || !input.handle.writable) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', ['Raw document preview requires an active writable Schema 0.4 / Storage Format 1 Knowledge Base.']))
  const configured = validateConfig(input.config)
  if (!configured.effective) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', configured.errors))
  const config = configured.effective
  if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before document intake.']))

  try {
    const resolver = input.documentResolver ?? new DocumentInputResolver()
    const acquisition = await awaitAbortable((signal) => resolver.acquire(input.documentInput, { signal }), input.signal)
    if (acquisition.kind === 'cancelled') return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before Source and Raw persistence.']), { cancellation: cancellationInfo('document_acquire') })
    if (acquisition.kind === 'rejected') throw acquisition.error
    const acquired = { ...acquisition.value, bytes: Uint8Array.from(acquisition.value.bytes) }
    const expectedRawRef = deriveRawIdentity(acquired.bytes).rawRef
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before Source and Raw persistence.']))

    const rawGateway: RawDocumentGatewayV04Port = input.gateway ?? new RawDocumentKnowledgeGatewayV04({ ...(input.clock === undefined ? {} : { clock: input.clock }) })
    sourceRaw = { status: 'in_flight', persisted: false, revision: input.handle.revision, errors: [] }
    const gatewayCall = await awaitAbortable(
      (signal) => rawGateway.submit({ handle: input.handle, workflowRunId: input.workflowRunId, bytes: Uint8Array.from(acquired.bytes), filename: acquired.filename, mediaType: acquired.mediaType, source: input.sourceMetadata, rights: input.rights }, { signal }),
      input.signal,
    )
    if (gatewayCall.kind === 'cancelled') {
      sourceRaw = { status: 'unknown', persisted: false, revision: input.handle.revision, errors: [{ code: 'RAW_DOCUMENT_SUBMISSION_OUTCOME_UNKNOWN', message: 'Gateway did not settle before Workflow cancellation; Source/Raw may still be persisted.' }] }
      return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Source/Raw receipt is unknown because the Gateway call remained pending.']), { cancellation: cancellationInfo('raw_gateway_submit') })
    }
    if (gatewayCall.kind === 'rejected') {
      sourceRaw = { status: 'failed', persisted: false, revision: input.handle.revision, errors: [{ code: 'RAW_DOCUMENT_SUBMISSION_FAILED', message: errorText(gatewayCall.error) }] }
      return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', sourceRaw.errors.map((item) => `${item.code}: ${item.message}`)))
    }
    if (!isRawGatewayResult(gatewayCall.value)) {
      sourceRaw = failedReceipt(sourceRaw, 'RAW_DOCUMENT_RECEIPT_INVALID', 'Raw document Gateway returned a malformed Source/Raw receipt.')
      return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', sourceRaw.errors.map((item) => `${item.code}: ${item.message}`)))
    }
    const rawResult = gatewayCall.value
    sourceRaw = sourceStageFromGateway(rawResult)
    const verification = await awaitAbortable(() => verifySourceRawReceipt(input.handle, rawResult, sourceRaw, expectedRawRef), input.signal)
    if (verification.kind === 'cancelled') {
      sourceRaw = { ...sourceRaw, status: 'unknown', persisted: false, errors: [...sourceRaw.errors, { code: 'RAW_DOCUMENT_RECEIPT_VERIFICATION_PENDING', message: 'Source/Raw receipt has not been verified against canonical storage.' }] }
      return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Workflow cancelled before Source/Raw receipt verification completed.']), { cancellation: cancellationInfo('source_receipt_verification') })
    }
    if (verification.kind === 'rejected') throw verification.error
    sourceRaw = verification.value
    if (!sourceRaw.persisted || !sourceRaw.sourceRef || !sourceRaw.rawRef) return result(input, 'blocked', sourceRaw, initialPreviewStage('blocked', sourceRaw.errors.map((item) => `${item.code}: ${item.message}`)))
    provenance = { sourceRef: sourceRaw.sourceRef, rawRef: sourceRaw.rawRef, sourceRevision: sourceRaw.revision }
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before parsing.']), { provenance })

    const parsing = await awaitAbortable((signal) => resolver.parse(acquired, { signal }), input.signal)
    if (parsing.kind === 'cancelled') return result(input, 'cancelled', sourceRaw, initialPreviewStage('cancelled', ['Source and Raw are verified; Workflow cancelled while parsing was pending.']), { provenance, cancellation: cancellationInfo('document_parse') })
    if (parsing.kind === 'rejected') throw parsing.error
    const document = parsing.value
    provenance = { ...provenance, documentId: document.documentId }
    if (aborted(input)) return result(input, 'cancelled', sourceRaw, { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before semantic planning.']), documentId: document.documentId }, { provenance })

    const capabilities = input.skill.capabilities()
    let planned: Awaited<ReturnType<RawDocumentPreviewSkillV04['understandAndPlan']>> | undefined
    let acceptedPlan: AcceptedExtractionPlan | undefined
    let planRepair: Parameters<RawDocumentPreviewSkillV04['understandAndPlan']>[0]['planRepair'] | undefined
    const planAttempts: PlanAttemptSummary[] = []
    for (let attempt = 1; attempt <= config.maxPlanAttempts; attempt += 1) {
      if (aborted(input)) {
        extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled during semantic planning.']), documentId: document.documentId, planAttempts }
        return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
      }
      planAttempts.push({ attempt, status: 'proposed' })
      const planning = await awaitAbortable((signal) => input.skill.understandAndPlan({ document, instructions: input.instructions, ...(planRepair === undefined ? {} : { planRepair }), signal }), input.signal)
      if (planning.kind === 'cancelled') {
        extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; Workflow cancelled while semantic planning was pending.']), documentId: document.documentId, planAttempts }
        return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance, cancellation: cancellationInfo('understand_and_plan') })
      }
      if (planning.kind === 'rejected') throw planning.error
      const proposal = planning.value
      planned = proposal
      if (aborted(input)) {
        extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled while semantic planning was in progress.']), documentId: document.documentId, planAttempts }
        return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
      }
      try {
        acceptedPlan = validateExtractionPlan(proposal, document, capabilities, { maxExtractionUnits: config.maxExtractionUnits, ...(config.maxContextTokens === undefined ? {} : { maxContextTokens: config.maxContextTokens }) }, input.instructions)
        planAttempts[planAttempts.length - 1] = { attempt, status: 'accepted' }
        break
      } catch (error) {
        if (!(error instanceof ExtractionPlanValidationError)) throw error
        const terminal = !error.repairable || attempt >= config.maxPlanAttempts
        planAttempts[planAttempts.length - 1] = { attempt, status: terminal ? 'terminal_invalid' : 'repairable_invalid', validationCode: error.code, uncoveredCount: error.feedback.uncoveredRefs?.length, overlapCount: error.feedback.overlapRefs?.length, affectedUnitId: error.feedback.affectedUnitId, estimatedTokens: error.feedback.estimatedTokens, allowedTokens: error.feedback.allowedTokens, unitCount: error.feedback.unitCount, maxUnits: error.feedback.maxUnits }
        if (terminal) {
          const errors = [error.message]
          extractionPreview = { ...initialPreviewStage('blocked', errors), documentId: document.documentId, planAttempts }
          return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
        }
        planRepair = { previousOutput: proposal, feedback: error.feedback, attempt: attempt + 1 }
      }
    }
    if (!planned || !acceptedPlan) {
      extractionPreview = { ...initialPreviewStage('blocked', ['No accepted extraction plan was produced.']), documentId: document.documentId, planAttempts }
      return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
    }
    if (aborted(input)) {
      extractionPreview = { ...initialPreviewStage('cancelled', ['Source and Raw are persisted; workflow cancelled before candidate extraction.']), documentId: document.documentId, acceptedPlan, planAttempts }
      return result(input, 'cancelled', sourceRaw, extractionPreview, { provenance })
    }

    const concurrency = Math.min(config.maxConcurrency, capabilities.maxConcurrency, acceptedPlan.units.length)
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
      extractionPreview = { ...initialPreviewStage('blocked', ['Reasoning executor has no available extraction concurrency.']), documentId: document.documentId, acceptedPlan, planAttempts }
      return result(input, 'source_only', sourceRaw, extractionPreview, { provenance })
    }
    const extracted = await extractBounded(input, document, planned.reportMap, acceptedPlan.units, concurrency)
    const consolidated = extracted.extractions.length > 0 ? consolidateExtractions(extracted.extractions) : emptyConsolidated()
    const constraints = [...consolidated.reviewConstraints, ...themePreviewConstraints(consolidated.groups)].sort((left, right) => left.reviewKey.localeCompare(right.reviewKey))
    const groups = candidateGroups(consolidated.groups, sourceRaw.sourceRef, sourceRaw.rawRef)
    const cancelled = aborted(input)
    const incomplete = cancelled || extracted.errors.length > 0 || extracted.extractions.length !== acceptedPlan.units.length
    const stageStatus: RawDocumentPreviewStageStatusV04 = cancelled ? 'cancelled' : extracted.extractions.length === 0 && extracted.errors.length > 0 ? 'blocked' : incomplete ? 'partial' : 'completed'
    extractionPreview = {
      status: stageStatus,
      documentId: document.documentId,
      acceptedPlan,
      planAttempts,
      unitSummaries: extracted.summaries,
      candidateGroups: groups,
      candidateCounts: consolidated.candidateCounts,
      rejectedCandidates: consolidated.rejected,
      reviewConstraints: constraints,
      errors: [...extracted.errors, ...(cancelled ? ['Workflow cancelled during candidate extraction.'] : [])],
    }
    const workflowStatus: RawDocumentPreviewWorkflowStatusV04 = cancelled ? 'cancelled' : stageStatus === 'completed' ? 'preview_ready' : groups.length > 0 ? 'preview_partial' : 'source_only'
    return result(input, workflowStatus, sourceRaw, extractionPreview, { provenance, ...(extracted.pendingCallMayContinue ? { cancellation: cancellationInfo('extract_knowledge') } : {}) })
  } catch (error) {
    const message = errorText(error)
    const cancelled = aborted(input)
    extractionPreview = initialPreviewStage(cancelled ? 'cancelled' : 'blocked', [message])
    return result(input, cancelled ? 'cancelled' : sourceRaw.persisted ? 'source_only' : 'blocked', sourceRaw, extractionPreview, { ...(provenance === undefined ? {} : { provenance }) })
  }
}
