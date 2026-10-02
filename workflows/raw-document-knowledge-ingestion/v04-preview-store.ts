import { constants, type BigIntStats } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import type { KnowledgeSourceV04, RawRefV04 } from '../../knowledge/schema/domain-v04.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { StructuredDocument } from '../../plugins/document/contracts.ts'
import type { ClaimCandidate, EntityCandidate, RelationCandidate } from '../../skills/knowledge-curation/contracts.ts'
import type { ConsolidationReviewConstraint } from './contracts.ts'
import type { ConsolidatedCandidateSupport, ConsolidatedExtraction } from './extraction/consolidation.ts'
import type { RawDocumentV04ProposalMappingInput } from './v04-proposal-mapper.ts'
import { parseKnowledgeBaseManifest } from '../../knowledge/schema/manifest.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'

export const RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS = {
  maxSnapshotBytes: 8_000_000,
  maxCandidateGroups: 4_096,
  maxDocumentBlocks: 100_000,
  maxReviewConstraints: 8_192,
  maxSupportEntries: 4_096,
  maxEvidenceBlockRefsPerCandidate: 16_384,
  maxSupportUnitIds: 64,
  maxBlockIdLength: 256,
  maxCandidateIdLength: 200,
  maxDirectoryDepth: 4,
  maxManifestBytes: 1_000_000,
} as const

type CandidateGroup = ConsolidatedExtraction['groups'][number]

export interface RawDocumentV04PreviewBlockOrder {
  readonly blockId: string
  readonly order: number
}

export interface RawDocumentV04PreviewCandidateSupport {
  readonly candidateId: string
  readonly supportingCandidateCount: number
}

export interface RawDocumentV04CandidatePreviewSnapshot {
  readonly format: 'researchhub.raw-document-v04-candidate-preview'
  readonly version: 1
  readonly workflowRunId: string
  readonly knowledgeBaseId: string
  readonly sourceRef: string
  readonly rawRef: string
  /** Knowledge Base revision returned when the canonical Source/Raw receipt was verified. */
  readonly sourceRevision: number
  readonly documentId: string
  /** Only the block IDs and their original order are retained; no document text is stored. */
  readonly orderedBlocks: readonly RawDocumentV04PreviewBlockOrder[]
  readonly candidateGroups: readonly CandidateGroup[]
  readonly blockingReviewConstraints: readonly ConsolidationReviewConstraint[]
  readonly candidateSupport: readonly RawDocumentV04PreviewCandidateSupport[]
  readonly contentHash: string
}

export interface PersistRawDocumentV04PreviewInput {
  readonly workflowRunId: string
  readonly sourceRef: string
  readonly rawRef: string
  readonly sourceRevision: number
  readonly document: Pick<StructuredDocument, 'documentId' | 'blocks'>
  readonly candidateGroups: readonly CandidateGroup[]
  readonly reviewConstraints: readonly ConsolidationReviewConstraint[]
  readonly candidateSupport: ReadonlyMap<string, ConsolidatedCandidateSupport>
}

export type RawDocumentV04PreviewStoreErrorCode =
  | 'PREVIEW_INPUT_INVALID'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_CONFLICT'
  | 'PREVIEW_PATH_UNSAFE'
  | 'PREVIEW_SIZE_LIMIT'
  | 'PREVIEW_MALFORMED'
  | 'PREVIEW_CHECKSUM_INVALID'
  | 'KNOWLEDGE_BASE_INVALID'
  | 'KNOWLEDGE_BASE_IDENTITY_MISMATCH'
  | 'KNOWLEDGE_BASE_CHANGED_DURING_READ'
  | 'SOURCE_RAW_MISMATCH'
  | 'RAW_INTEGRITY_INVALID'

export class RawDocumentV04PreviewStoreError extends Error {
  constructor(readonly code: RawDocumentV04PreviewStoreErrorCode, message: string) {
    super(message)
    this.name = 'RawDocumentV04PreviewStoreError'
  }
}

type Dict = Record<string, unknown>
const FORMAT = 'researchhub.raw-document-v04-candidate-preview'
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u
const SOURCE_REF = /^source:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const RAW_REF = /^raw-sha256-[0-9a-f]{64}$/u
const CANDIDATE_ID = /^(?!entity:|relation:|claim:|source:|module:|theme-group:)[^\u0000-\u001f\u007f-\u009f]{1,200}$/iu
const REVIEW_CATEGORIES = new Set(['invalid_reference', 'invalid_semantics', 'relation_cardinality', 'schema_gap', 'theme_creation', 'theme_ambiguity', 'reconciliation_review', 'other'])
const TOP_LEVEL_KEYS = ['format', 'version', 'workflowRunId', 'knowledgeBaseId', 'sourceRef', 'rawRef', 'sourceRevision', 'documentId', 'orderedBlocks', 'candidateGroups', 'blockingReviewConstraints', 'candidateSupport', 'contentHash']
const GROUP_KEYS = ['candidateId', 'kind', 'candidate']
const SUPPORT_KEYS = ['candidateId', 'supportingCandidateCount']

function fail(code: RawDocumentV04PreviewStoreErrorCode, message: string): never {
  throw new RawDocumentV04PreviewStoreError(code, message)
}

function isRecord(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Dict, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('PREVIEW_MALFORMED', label + ' contains an unsupported field: ' + key)
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('PREVIEW_MALFORMED', label + ' is missing required field: ' + key)
  }
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.trim() === '') || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    fail('PREVIEW_MALFORMED', label + ' must be a bounded string')
  }
  return value
}

function safeDocumentIdentifier(value: unknown, label: string): string {
  // StructuredDocument identifiers are opaque labels, not filesystem paths.
  // Match the parser contract's nonempty string semantics while keeping the
  // preview's explicit length and control-character bounds.
  return boundedString(value, label, 256)
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail('PREVIEW_MALFORMED', label + ' must be a safe integer')
  return value as number
}

function boundedJson(value: unknown, label: string, maxBytes = 1_000_000): void {
  let encoded: string
  try { encoded = JSON.stringify(value) } catch { return fail('PREVIEW_MALFORMED', label + ' is not JSON serializable') }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > maxBytes) fail('PREVIEW_SIZE_LIMIT', label + ' exceeds its JSON size bound')
  let nodes = 0
  const visit = (current: unknown, depth: number): void => {
    nodes += 1
    if (nodes > 100_000 || depth > 16) fail('PREVIEW_SIZE_LIMIT', label + ' exceeds its JSON complexity bound')
    if (current === null || typeof current === 'boolean') return
    if (typeof current === 'string') {
      if (current.length > 16_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(current)) fail('PREVIEW_MALFORMED', label + ' contains an unsupported string')
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail('PREVIEW_MALFORMED', label + ' contains a non-finite number')
      return
    }
    if (Array.isArray(current)) {
      if (current.length > 16_384) fail('PREVIEW_SIZE_LIMIT', label + ' contains an oversized array')
      for (const child of current) visit(child, depth + 1)
      return
    }
    if (!isRecord(current) || (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) || Object.getOwnPropertySymbols(current).length > 0) {
      fail('PREVIEW_MALFORMED', label + ' contains a non-plain JSON object')
    }
    const entries = Object.entries(current)
    if (entries.length > 4_096) fail('PREVIEW_SIZE_LIMIT', label + ' contains an oversized object')
    for (const [key, child] of entries) {
      boundedString(key, label + ' key', 512)
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
}

function validateCandidate(value: unknown, kind: CandidateGroup['kind'], label: string): EntityCandidate | RelationCandidate | ClaimCandidate {
  if (!isRecord(value)) fail('PREVIEW_MALFORMED', label + ' must be an object')
  exactKeys(value, ['candidateId', 'evidenceBlockRefs', 'reason', ...(kind === 'entity' ? ['entityType', 'name'] : kind === 'relation' ? ['relationType', 'source', 'target'] : ['claimType', 'statement', 'subjectRefs'])], kind === 'entity' ? ['aliases', 'description', 'semanticFields', 'confidence'] : kind === 'relation' ? ['attributes', 'confidence'] : ['temporal', 'structuredValue', 'confidence'], label)
  const candidateId = boundedString(value.candidateId, label + '.candidateId', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateIdLength)
  if (!CANDIDATE_ID.test(candidateId)) fail('PREVIEW_MALFORMED', label + '.candidateId is not a safe local candidate ID')
  boundedString(value.reason, label + '.reason', 2_000)
  if (!Array.isArray(value.evidenceBlockRefs) || value.evidenceBlockRefs.length < 1 || value.evidenceBlockRefs.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxEvidenceBlockRefsPerCandidate) {
    fail('PREVIEW_MALFORMED', label + '.evidenceBlockRefs has an unsupported length')
  }
  const evidenceBlockRefs = value.evidenceBlockRefs.map((ref, index) => boundedString(ref, label + '.evidenceBlockRefs[' + index + ']', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxBlockIdLength))
  if (new Set(evidenceBlockRefs).size !== evidenceBlockRefs.length) fail('PREVIEW_MALFORMED', label + '.evidenceBlockRefs contains duplicates')
  if (value.confidence !== undefined && (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) fail('PREVIEW_MALFORMED', label + '.confidence must be between zero and one')

  if (kind === 'entity') {
    boundedString(value.entityType, label + '.entityType', 80)
    boundedString(value.name, label + '.name', 512)
    if (value.aliases !== undefined) {
      if (!Array.isArray(value.aliases) || value.aliases.length > 256) fail('PREVIEW_MALFORMED', label + '.aliases has an unsupported shape')
      value.aliases.forEach((item, index) => boundedString(item, label + '.aliases[' + index + ']', 512))
    }
    if (value.description !== undefined && value.description !== null) boundedString(value.description, label + '.description', 4_000)
    if (value.semanticFields !== undefined) boundedJson(value.semanticFields, label + '.semanticFields', 256_000)
  } else if (kind === 'relation') {
    boundedString(value.relationType, label + '.relationType', 128)
    validateCandidateEntityRef(value.source, label + '.source')
    validateCandidateEntityRef(value.target, label + '.target')
    if (value.attributes !== undefined) boundedJson(value.attributes, label + '.attributes', 256_000)
  } else {
    boundedString(value.claimType, label + '.claimType', 80)
    boundedString(value.statement, label + '.statement', 8_000)
    if (!Array.isArray(value.subjectRefs) || value.subjectRefs.length < 1 || value.subjectRefs.length > 128) fail('PREVIEW_MALFORMED', label + '.subjectRefs has an unsupported shape')
    value.subjectRefs.forEach((item, index) => validateCandidateEntityRef(item, label + '.subjectRefs[' + index + ']'))
    if (value.temporal !== undefined && value.temporal !== null) boundedJson(value.temporal, label + '.temporal', 64_000)
    if (value.structuredValue !== undefined && value.structuredValue !== null) boundedJson(value.structuredValue, label + '.structuredValue', 256_000)
  }
  return value as unknown as EntityCandidate | RelationCandidate | ClaimCandidate
}

function validateCandidateEntityRef(value: unknown, label: string): void {
  if (!isRecord(value)) fail('PREVIEW_MALFORMED', label + ' must be an object')
  exactKeys(value, ['candidateRef', 'mention'], ['entityType'], label)
  boundedString(value.candidateRef, label + '.candidateRef', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateIdLength)
  boundedString(value.mention, label + '.mention', 512)
  if (value.entityType !== undefined) boundedString(value.entityType, label + '.entityType', 80)
}

function validateGroup(value: unknown, index: number): CandidateGroup {
  const label = 'candidateGroups[' + index + ']'
  if (!isRecord(value)) fail('PREVIEW_MALFORMED', label + ' must be an object')
  exactKeys(value, GROUP_KEYS, [], label)
  if (value.kind !== 'entity' && value.kind !== 'relation' && value.kind !== 'claim') fail('PREVIEW_MALFORMED', label + '.kind is invalid')
  const candidate = validateCandidate(value.candidate, value.kind, label + '.candidate')
  const candidateId = boundedString(value.candidateId, label + '.candidateId', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateIdLength)
  if (candidateId !== candidate.candidateId) fail('PREVIEW_MALFORMED', label + ' candidateId disagrees with its candidate')
  return { candidateId, kind: value.kind, candidate } as CandidateGroup
}

function validateConstraint(value: unknown, index: number): ConsolidationReviewConstraint {
  const label = 'blockingReviewConstraints[' + index + ']'
  if (!isRecord(value)) fail('PREVIEW_MALFORMED', label + ' must be an object')
  exactKeys(value, ['candidateId', 'reason', 'conflictingFields', 'blocking', 'category', 'reviewKey'], ['conflictValues'], label)
  boundedString(value.candidateId, label + '.candidateId', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateIdLength)
  boundedString(value.reason, label + '.reason', 4_000)
  if (value.blocking !== true) fail('PREVIEW_MALFORMED', label + '.blocking must be true')
  if (typeof value.category !== 'string' || !REVIEW_CATEGORIES.has(value.category)) fail('PREVIEW_MALFORMED', label + '.category is invalid')
  boundedString(value.reviewKey, label + '.reviewKey', 512)
  if (!Array.isArray(value.conflictingFields) || value.conflictingFields.length > 128) fail('PREVIEW_MALFORMED', label + '.conflictingFields has an unsupported shape')
  value.conflictingFields.forEach((field, fieldIndex) => boundedString(field, label + '.conflictingFields[' + fieldIndex + ']', 256))
  if (value.conflictValues !== undefined) {
    if (!isRecord(value.conflictValues)) fail('PREVIEW_MALFORMED', label + '.conflictValues must be an object')
    exactKeys(value.conflictValues, ['left', 'right'], [], label + '.conflictValues')
    boundedJson(value.conflictValues.left, label + '.conflictValues.left', 256_000)
    boundedJson(value.conflictValues.right, label + '.conflictValues.right', 256_000)
  }
  return value as unknown as ConsolidationReviewConstraint
}

function validateSnapshot(value: unknown, expectedRunId?: string): RawDocumentV04CandidatePreviewSnapshot {
  if (!isRecord(value)) fail('PREVIEW_MALFORMED', 'Preview snapshot must be an object')
  exactKeys(value, TOP_LEVEL_KEYS, [], 'Preview snapshot')
  if (value.format !== FORMAT || value.version !== 1) fail('PREVIEW_MALFORMED', 'Preview snapshot format or version is unsupported')
  const workflowRunId = boundedString(value.workflowRunId, 'workflowRunId', 80)
  if (!RUN_ID.test(workflowRunId) || workflowRunId.includes('..') || (expectedRunId !== undefined && workflowRunId !== expectedRunId)) fail('PREVIEW_MALFORMED', 'Preview workflowRunId is invalid or does not match the requested path')
  boundedString(value.knowledgeBaseId, 'knowledgeBaseId', 256)
  if (!SOURCE_REF.test(String(value.sourceRef))) fail('PREVIEW_MALFORMED', 'Preview sourceRef is invalid')
  if (!RAW_REF.test(String(value.rawRef))) fail('PREVIEW_MALFORMED', 'Preview rawRef is invalid')
  safeInteger(value.sourceRevision, 'sourceRevision', 1)
  safeDocumentIdentifier(value.documentId, 'documentId')
  if (!Array.isArray(value.orderedBlocks) || value.orderedBlocks.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxDocumentBlocks) fail('PREVIEW_MALFORMED', 'Preview orderedBlocks has an unsupported shape')
  const blockIds = new Set<string>()
  const orderedBlocks = value.orderedBlocks.map((rawBlock, index): RawDocumentV04PreviewBlockOrder => {
    const label = 'orderedBlocks[' + index + ']'
    if (!isRecord(rawBlock)) fail('PREVIEW_MALFORMED', label + ' must be an object')
    exactKeys(rawBlock, ['blockId', 'order'], [], label)
    const blockId = safeDocumentIdentifier(rawBlock.blockId, label + '.blockId')
    const order = safeInteger(rawBlock.order, label + '.order')
    if (blockIds.has(blockId)) fail('PREVIEW_MALFORMED', 'Preview orderedBlocks contains a duplicate block ID')
    blockIds.add(blockId)
    return { blockId, order }
  })
  if (new Set(orderedBlocks.map((block) => block.order)).size !== orderedBlocks.length) fail('PREVIEW_MALFORMED', 'Preview orderedBlocks contains duplicate order values')
  if (!Array.isArray(value.candidateGroups) || value.candidateGroups.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateGroups) fail('PREVIEW_MALFORMED', 'Preview candidateGroups has an unsupported shape')
  const candidateGroups = value.candidateGroups.map(validateGroup)
  const groupIds = new Set<string>()
  for (const group of candidateGroups) {
    if (groupIds.has(group.candidateId)) fail('PREVIEW_MALFORMED', 'Preview candidateGroups contains duplicate IDs')
    groupIds.add(group.candidateId)
  }
  if (!Array.isArray(value.blockingReviewConstraints) || value.blockingReviewConstraints.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxReviewConstraints) fail('PREVIEW_MALFORMED', 'Preview blockingReviewConstraints has an unsupported shape')
  const blockingReviewConstraints = value.blockingReviewConstraints.map(validateConstraint)
  const constraintKeys = new Set<string>()
  for (const constraint of blockingReviewConstraints) {
    if (!groupIds.has(constraint.candidateId)) fail('PREVIEW_MALFORMED', 'Preview review constraint refers to an unknown candidate')
    if (constraintKeys.has(constraint.reviewKey)) fail('PREVIEW_MALFORMED', 'Preview review constraints contain duplicate review keys')
    constraintKeys.add(constraint.reviewKey)
  }
  if (!Array.isArray(value.candidateSupport) || value.candidateSupport.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSupportEntries) fail('PREVIEW_MALFORMED', 'Preview candidateSupport has an unsupported shape')
  const candidateSupport = value.candidateSupport.map((rawSupport, index): RawDocumentV04PreviewCandidateSupport => {
    const label = 'candidateSupport[' + index + ']'
    if (!isRecord(rawSupport)) fail('PREVIEW_MALFORMED', label + ' must be an object')
    exactKeys(rawSupport, SUPPORT_KEYS, [], label)
    const candidateId = boundedString(rawSupport.candidateId, label + '.candidateId', RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateIdLength)
    const candidate = candidateGroups.find((group) => group.candidateId === candidateId)
    if (!candidate || candidate.kind !== 'entity') fail('PREVIEW_MALFORMED', label + ' must refer to an Entity candidate')
    const supportingCandidateCount = safeInteger(rawSupport.supportingCandidateCount, label + '.supportingCandidateCount', 1)
    return { candidateId, supportingCandidateCount }
  })
  if (new Set(candidateSupport.map((support) => support.candidateId)).size !== candidateSupport.length) fail('PREVIEW_MALFORMED', 'Preview candidateSupport contains duplicate IDs')
  const rawDigest = String(value.rawRef).slice('raw-sha256-'.length)
  const containsFullRawText = (current: unknown): boolean => {
    if (typeof current === 'string') return createHash('sha256').update(current, 'utf8').digest('hex') === rawDigest
    if (Array.isArray(current)) return current.some(containsFullRawText)
    if (isRecord(current)) return Object.values(current).some(containsFullRawText)
    return false
  }
  if (containsFullRawText(value)) fail('PREVIEW_MALFORMED', 'A serialized preview field contains the complete Raw text')
  const contentHash = boundedString(value.contentHash, 'contentHash', 71)
  if (!/^sha256:[0-9a-f]{64}$/u.test(contentHash)) fail('PREVIEW_MALFORMED', 'Preview contentHash is invalid')
  const snapshot = value as unknown as RawDocumentV04CandidatePreviewSnapshot
  const body: Dict = { ...snapshot }
  delete body.contentHash
  let actualHash: string
  try { actualHash = hashKnowledgeObject(body) } catch { return fail('PREVIEW_MALFORMED', 'Preview snapshot contains unsupported JSON values') }
  if (actualHash !== contentHash) fail('PREVIEW_CHECKSUM_INVALID', 'Preview snapshot content hash does not match its contents')
  return snapshot
}

function cloneJson<T>(value: T, label: string): T {
  let encoded: string
  try { encoded = canonicalSerialize(value) } catch {
    return fail('PREVIEW_INPUT_INVALID', label + ' is not JSON serializable')
  }
  if (Buffer.byteLength(encoded, 'utf8') > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes) fail('PREVIEW_SIZE_LIMIT', label + ' exceeds the snapshot byte limit')
  try { return JSON.parse(encoded) as T } catch { return fail('PREVIEW_INPUT_INVALID', label + ' could not be cloned as JSON') }
}

function makeSnapshot(handle: KnowledgeBaseHandle, input: PersistRawDocumentV04PreviewInput): RawDocumentV04CandidatePreviewSnapshot {
  if (!RUN_ID.test(input.workflowRunId) || input.workflowRunId.includes('..')) fail('PREVIEW_INPUT_INVALID', 'workflowRunId must be a safe bounded identifier')
  if (!SOURCE_REF.test(input.sourceRef) || !RAW_REF.test(input.rawRef)) fail('PREVIEW_INPUT_INVALID', 'sourceRef or rawRef is invalid')
  safeInteger(input.sourceRevision, 'sourceRevision', 1)
  safeDocumentIdentifier(input.document.documentId, 'documentId')
  if (!Array.isArray(input.document.blocks) || input.document.blocks.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxDocumentBlocks) fail('PREVIEW_SIZE_LIMIT', 'Document block order exceeds its bound')
  const orderedBlocks = input.document.blocks.map((block, index) => ({ blockId: safeDocumentIdentifier(block.blockId, 'document.blocks[' + index + '].blockId'), order: safeInteger(block.order, 'document.blocks[' + index + '].order') }))
  if (new Set(orderedBlocks.map((block) => block.blockId)).size !== orderedBlocks.length || new Set(orderedBlocks.map((block) => block.order)).size !== orderedBlocks.length) fail('PREVIEW_INPUT_INVALID', 'Document block IDs and order values must be unique')
  if (!Array.isArray(input.candidateGroups) || input.candidateGroups.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateGroups) fail('PREVIEW_SIZE_LIMIT', 'Candidate group count exceeds its bound')
  if (!Array.isArray(input.reviewConstraints) || input.reviewConstraints.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxReviewConstraints) fail('PREVIEW_SIZE_LIMIT', 'Review constraint count exceeds its bound')
  const groups = input.candidateGroups.map((group, index) => cloneJson(group, 'candidateGroups[' + index + ']'))
  const blocking = input.reviewConstraints.filter((constraint) => constraint.blocking).map((constraint, index) => cloneJson(constraint, 'blockingReviewConstraints[' + index + ']'))
  if (!(input.candidateSupport instanceof Map) || input.candidateSupport.size > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSupportEntries) fail('PREVIEW_INPUT_INVALID', 'candidateSupport must be a bounded Map')
  const candidateSupport = [...input.candidateSupport.entries()].map(([candidateId, support]) => ({ candidateId, supportingCandidateCount: support.supportingCandidateCount })).sort((left, right) => left.candidateId.localeCompare(right.candidateId))
  const body = {
    format: FORMAT as typeof FORMAT,
    version: 1 as const,
    workflowRunId: input.workflowRunId,
    knowledgeBaseId: handle.knowledgeBaseId,
    sourceRef: input.sourceRef,
    rawRef: input.rawRef,
    sourceRevision: input.sourceRevision,
    documentId: input.document.documentId,
    orderedBlocks,
    candidateGroups: groups,
    blockingReviewConstraints: blocking,
    candidateSupport,
  }
  const draft = cloneJson(body, 'preview snapshot')
  const snapshot = { ...draft, contentHash: hashKnowledgeObject(draft) } as RawDocumentV04CandidatePreviewSnapshot
  validateSnapshot(snapshot, input.workflowRunId)
  const byteLength = Buffer.byteLength(JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  if (byteLength > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes) fail('PREVIEW_SIZE_LIMIT', 'Preview snapshot exceeds the durable byte limit')
  return snapshot
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Dict)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function compareFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && (left.ino === 0n || right.ino === 0n
    ? left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
    : left.ino === right.ino)
}

function compareFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return compareFileIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

function relativeWithin(rootReal: string, candidateReal: string): boolean {
  const fromRoot = relative(rootReal, candidateReal)
  return fromRoot !== '' && !isAbsolute(fromRoot) && !fromRoot.split(/[\\/]/u).includes('..')
}

function lstatOptional(path: string): Promise<BigIntStats | undefined> {
  return lstat(path, { bigint: true }).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  })
}

function previewDirectory(root: string): string {
  return join(root, 'logs', 'ingestion', 'v04-preview')
}

function previewFilePath(root: string, workflowRunId: string): string {
  return join(previewDirectory(root), workflowRunId + '.json')
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const parsed = parse(resolve(path))
  let current = parsed.root
  const remainder = resolve(path).slice(parsed.root.length).split(sep).filter(Boolean)
  for (const part of remainder) {
    current = join(current, part)
    const stat = await lstatOptional(current)
    if (stat?.isSymbolicLink()) fail('PREVIEW_PATH_UNSAFE', 'Preview path contains a symbolic-link or reparse-point ancestor')
  }
}

async function assertRoot(handle: KnowledgeBaseHandle): Promise<{ readonly root: string; readonly rootReal: string }> {
  if (!handle || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') fail('KNOWLEDGE_BASE_INVALID', 'Preview store requires an active Schema 0.4 / Storage Format 1 Knowledge Base')
  const root = resolve(handle.rootRef)
  await assertNoSymlinkAncestors(root)
  const stat = await lstatOptional(root)
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('KNOWLEDGE_BASE_INVALID', 'Knowledge Base root is missing, not a directory, or is a symlink')
  const rootReal = await realpath(root)
  return { root, rootReal }
}

async function ensurePreviewDirectory(root: string, rootReal: string, create: boolean): Promise<boolean> {
  let current = root
  const parts = ['logs', 'ingestion', 'v04-preview']
  if (parts.length !== RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxDirectoryDepth - 1) fail('PREVIEW_PATH_UNSAFE', 'Preview directory depth is invalid')
  for (const part of parts) {
    current = join(current, part)
    const before = await lstatOptional(current)
    if (!before) {
      if (!create) return false
      try { await mkdir(current) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new RawDocumentV04PreviewStoreError('PREVIEW_PATH_UNSAFE', 'Unable to create a safe preview directory')
      }
    }
    const stat = await lstatOptional(current)
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('PREVIEW_PATH_UNSAFE', 'Preview directory component is missing, not a directory, or is a symlink')
    const real = await realpath(current)
    if (!relativeWithin(rootReal, real)) fail('PREVIEW_PATH_UNSAFE', 'Preview directory resolves outside the mounted Knowledge Base')
    const after = await lstatOptional(current)
    if (!after || after.isSymbolicLink() || !compareFileIdentity(stat, after)) fail('PREVIEW_PATH_UNSAFE', 'Preview directory changed while its path was being validated')
  }
  return true
}

async function readBounded(file: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = []
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let total = 0
  while (true) {
    const length = Math.min(buffer.length, RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes + 1 - total)
    if (length <= 0) fail('PREVIEW_SIZE_LIMIT', 'Preview file grew beyond its byte limit while being read')
    const result = await file.read(buffer, 0, length, null)
    if (result.bytesRead === 0) break
    total += result.bytesRead
    if (total > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes) fail('PREVIEW_SIZE_LIMIT', 'Preview file grew beyond its byte limit while being read')
    chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)))
  }
  return Buffer.concat(chunks, total)
}

async function readSafeKnowledgeBaseFile(path: string, rootReal: string, maxBytes: number, label: string): Promise<Buffer> {
  await assertNoSymlinkAncestors(path)
  const before = await lstatOptional(path)
  if (!before || before.isSymbolicLink() || !before.isFile()) fail('KNOWLEDGE_BASE_INVALID', label + ' is missing, not a regular file, or is a symlink')
  if (!Number.isSafeInteger(Number(before.size)) || Number(before.size) > maxBytes) fail('KNOWLEDGE_BASE_INVALID', label + ' exceeds its bounded read limit')
  const realBefore = await realpath(path)
  if (!relativeWithin(rootReal, realBefore)) fail('KNOWLEDGE_BASE_INVALID', label + ' resolves outside the mounted Knowledge Base')
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  let file: FileHandle
  try { file = await open(path, constants.O_RDONLY | noFollow) } catch {
    return fail('KNOWLEDGE_BASE_INVALID', 'Unable to open validated ' + label)
  }
  try {
    const opened = await file.stat({ bigint: true })
    if (!opened.isFile() || !compareFileSnapshot(before, opened)) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', label + ' changed while being opened')
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let total = 0
    while (true) {
      const length = Math.min(buffer.length, maxBytes + 1 - total)
      if (length <= 0) fail('KNOWLEDGE_BASE_INVALID', label + ' grew beyond its bounded read limit')
      const result = await file.read(buffer, 0, length, null)
      if (result.bytesRead === 0) break
      total += result.bytesRead
      if (total > maxBytes) fail('KNOWLEDGE_BASE_INVALID', label + ' grew beyond its bounded read limit')
      chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)))
    }
    const finished = await file.stat({ bigint: true })
    const after = await lstatOptional(path)
    let realAfter: string | undefined
    try { realAfter = await realpath(path) } catch { realAfter = undefined }
    if (!compareFileSnapshot(opened, finished) || Number(finished.size) !== total || !after || after.isSymbolicLink() || !after.isFile() || !compareFileSnapshot(finished, after) || realAfter !== realBefore) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', label + ' changed while being read')
    return Buffer.concat(chunks, total)
  } finally {
    await file.close().catch(() => undefined)
  }
}

async function readSafePreviewFile(path: string, rootReal: string, runId: string): Promise<RawDocumentV04CandidatePreviewSnapshot | undefined> {
  const before = await lstatOptional(path)
  if (!before) return undefined
  if (before.isSymbolicLink() || !before.isFile()) fail('PREVIEW_PATH_UNSAFE', 'Preview snapshot is not a regular file or is a symlink')
  if (!Number.isSafeInteger(Number(before.size)) || Number(before.size) > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes) fail('PREVIEW_SIZE_LIMIT', 'Preview snapshot exceeds the byte limit')
  const pathRealBefore = await realpath(path)
  if (!relativeWithin(rootReal, pathRealBefore)) fail('PREVIEW_PATH_UNSAFE', 'Preview snapshot resolves outside the mounted Knowledge Base')
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  let file: FileHandle
  try { file = await open(path, constants.O_RDONLY | noFollow) } catch {
    return fail('PREVIEW_PATH_UNSAFE', 'Unable to open the validated preview snapshot without following a replaced path')
  }
  try {
    const opened = await file.stat({ bigint: true })
    if (!opened.isFile() || !compareFileIdentity(before, opened) || !compareFileSnapshot(before, opened)) fail('PREVIEW_PATH_UNSAFE', 'Preview snapshot changed between path validation and open')
    const openPathStat = await lstatOptional(path)
    const openPathReal = await realpath(path)
    if (!openPathStat || openPathStat.isSymbolicLink() || !openPathStat.isFile() || !compareFileSnapshot(opened, openPathStat) || openPathReal !== pathRealBefore || !relativeWithin(rootReal, openPathReal)) fail('PREVIEW_PATH_UNSAFE', 'Preview snapshot path changed while it was being opened')
    const bytes = await readBounded(file)
    const finished = await file.stat({ bigint: true })
    const finishedPath = await lstatOptional(path)
    let finishedReal: string | undefined
    try { finishedReal = await realpath(path) } catch { finishedReal = undefined }
    if (!compareFileSnapshot(opened, finished) || Number(finished.size) !== bytes.byteLength || !finishedPath || finishedPath.isSymbolicLink() || !finishedPath.isFile() || !compareFileSnapshot(finished, finishedPath) || finishedReal !== pathRealBefore) fail('PREVIEW_PATH_UNSAFE', 'Preview snapshot changed while its bounded file handle was being read')
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
      return fail('PREVIEW_MALFORMED', 'Preview snapshot is not valid UTF-8 JSON')
    }
    return deepFreeze(validateSnapshot(parsed, runId))
  } finally {
    await file.close().catch(() => undefined)
  }
}

async function readValidatedManifest(handle: KnowledgeBaseHandle, root: string, rootReal: string) {
  const path = join(root, 'manifest.yaml')
  await assertNoSymlinkAncestors(path)
  const before = await lstatOptional(path)
  if (!before || before.isSymbolicLink() || !before.isFile() || Number(before.size) > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxManifestBytes) fail('KNOWLEDGE_BASE_INVALID', 'Knowledge Base manifest is missing, unsafe, or oversized')
  const realBefore = await realpath(path)
  if (!relativeWithin(rootReal, realBefore)) fail('KNOWLEDGE_BASE_INVALID', 'Knowledge Base manifest resolves outside the mounted root')
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  let file: FileHandle
  try { file = await open(path, constants.O_RDONLY | noFollow) } catch { return fail('KNOWLEDGE_BASE_INVALID', 'Unable to open the validated Knowledge Base manifest') }
  try {
    const opened = await file.stat({ bigint: true })
    if (!opened.isFile() || !compareFileSnapshot(before, opened)) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Knowledge Base manifest changed while being opened')
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let total = 0
    while (true) {
      const result = await file.read(buffer, 0, Math.min(buffer.length, RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxManifestBytes + 1 - total), null)
      if (result.bytesRead === 0) break
      total += result.bytesRead
      if (total > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxManifestBytes) fail('KNOWLEDGE_BASE_INVALID', 'Knowledge Base manifest exceeds its byte limit')
      chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)))
    }
    const finished = await file.stat({ bigint: true })
    const after = await lstatOptional(path)
    let realAfter: string | undefined
    try { realAfter = await realpath(path) } catch { realAfter = undefined }
    if (!compareFileSnapshot(opened, finished) || Number(finished.size) !== total || !after || after.isSymbolicLink() || !compareFileSnapshot(finished, after) || realAfter !== realBefore) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Knowledge Base manifest changed while being read')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
    const manifest = parseKnowledgeBaseManifest(parseYaml(text, path))
    if (manifest.knowledgeBaseId !== handle.knowledgeBaseId || manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active') fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Current manifest does not match the mounted active Schema 0.4 Knowledge Base')
    if (manifest.revision < handle.revision) fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Current Knowledge Base revision is older than the mounted handle')
    return manifest
  } catch (error) {
    if (error instanceof RawDocumentV04PreviewStoreError) throw error
    fail('KNOWLEDGE_BASE_INVALID', 'Unable to parse the Knowledge Base manifest')
  } finally {
    await file.close().catch(() => undefined)
  }
}

async function assertCanonicalSourceAndRaw(handle: KnowledgeBaseHandle, snapshot: RawDocumentV04CandidatePreviewSnapshot): Promise<void> {
  const { root, rootReal } = await assertRoot(handle)
  const manifest = await readValidatedManifest(handle, root, rootReal)
  if (manifest.knowledgeBaseId !== snapshot.knowledgeBaseId || snapshot.knowledgeBaseId !== handle.knowledgeBaseId) fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Preview snapshot belongs to a different Knowledge Base')
  if (snapshot.sourceRevision > manifest.revision) fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Preview source revision is newer than the current Knowledge Base')
  const readCanonicalSource = async (): Promise<KnowledgeSourceV04> => {
    const registryPath = join(root, 'registry', 'assets.yaml')
    let registry: unknown
    try { registry = parseYaml(new TextDecoder('utf-8', { fatal: true }).decode(await readSafeKnowledgeBaseFile(registryPath, rootReal, 8_000_000, 'canonical asset registry')), registryPath) } catch (error) {
      if (error instanceof RawDocumentV04PreviewStoreError) throw error
      return fail('KNOWLEDGE_BASE_INVALID', 'Unable to parse the canonical asset registry')
    }
    if (!isRecord(registry)) fail('KNOWLEDGE_BASE_INVALID', 'Canonical asset registry must be an object map')
    const entry = registry[snapshot.sourceRef]
    if (!isRecord(entry) || entry.type !== 'source' || typeof entry.storageRef !== 'string') fail('SOURCE_RAW_MISMATCH', 'Preview Source is missing from the canonical asset registry')
    const storageRef = entry.storageRef
    if (isAbsolute(storageRef) || storageRef.trim() === '' || storageRef.split(/[\\/]+/u).includes('..')) fail('KNOWLEDGE_BASE_INVALID', 'Canonical Source storage reference is unsafe')
    const sourcePath = resolve(root, storageRef)
    const sourceRelative = relative(root, sourcePath)
    if (sourceRelative === '' || isAbsolute(sourceRelative) || sourceRelative.split(/[\\/]+/u).includes('..')) fail('KNOWLEDGE_BASE_INVALID', 'Canonical Source path escapes the mounted Knowledge Base')
    let sourceValue: unknown
    try { sourceValue = parseYaml(new TextDecoder('utf-8', { fatal: true }).decode(await readSafeKnowledgeBaseFile(sourcePath, rootReal, 2_000_000, 'canonical Source asset')), sourcePath) } catch (error) {
      if (error instanceof RawDocumentV04PreviewStoreError) throw error
      return fail('KNOWLEDGE_BASE_INVALID', 'Unable to parse the canonical Source asset')
    }
    if (!isRecord(sourceValue) || sourceValue.id !== snapshot.sourceRef) fail('SOURCE_RAW_MISMATCH', 'Canonical Source ID does not match the requested ref')
    return sourceValue as unknown as KnowledgeSourceV04
  }
  const source = await readCanonicalSource()
  if (!Array.isArray(source.rawRefs) || !source.rawRefs.includes(snapshot.rawRef as RawRefV04)) fail('SOURCE_RAW_MISMATCH', 'Canonical Source does not reference the preview Raw object')
  let verified: Awaited<ReturnType<typeof verifyRaw>>
  try { verified = await verifyRaw(handle, snapshot.rawRef) } catch {
    return fail('RAW_INTEGRITY_INVALID', 'Preview Raw object is missing or failed integrity verification')
  }
  if (source.contentHash !== verified.contentHash.slice('sha256:'.length)) fail('SOURCE_RAW_MISMATCH', 'Canonical Source content hash does not match its Raw object')
  const currentSource = await readCanonicalSource()
  if (canonicalSerialize(currentSource) !== canonicalSerialize(source)) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Canonical Source changed while its Raw integrity was being checked')
  const latest = await readValidatedManifest(handle, root, rootReal)
  if (latest.revision !== manifest.revision || latest.knowledgeBaseId !== manifest.knowledgeBaseId) fail('KNOWLEDGE_BASE_CHANGED_DURING_READ', 'Knowledge Base changed while canonical Source and Raw integrity were being checked')
}

function normalizedBody(handle: KnowledgeBaseHandle, input: PersistRawDocumentV04PreviewInput): RawDocumentV04CandidatePreviewSnapshot {
  const draft = makeSnapshot(handle, input)
  return draft
}

async function persistBytes(path: string, directory: string, bytes: Buffer, rootReal: string): Promise<void> {
  const temporaryPath = join(directory, '.' + randomUUID() + '.tmp')
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  let file: FileHandle | undefined
  try {
    file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)
    const stat = await file.stat({ bigint: true })
    if (!stat.isFile()) fail('PREVIEW_PATH_UNSAFE', 'Temporary preview file is not a regular file')
    await file.writeFile(bytes)
    await file.sync()
    const afterWrite = await file.stat({ bigint: true })
    if (!afterWrite.isFile() || Number(afterWrite.size) !== bytes.byteLength) fail('PREVIEW_PATH_UNSAFE', 'Temporary preview file changed while being written')
    await file.close()
    file = undefined
    const tempStat = await lstatOptional(temporaryPath)
    const tempReal = await realpath(temporaryPath)
    if (!tempStat || tempStat.isSymbolicLink() || !tempStat.isFile() || !compareFileSnapshot(afterWrite, tempStat) || !relativeWithin(rootReal, tempReal) || Number(tempStat.size) !== bytes.byteLength) fail('PREVIEW_PATH_UNSAFE', 'Temporary preview path is unsafe')
    await assertNoSymlinkAncestors(directory)
    const directoryStat = await lstatOptional(directory)
    const directoryReal = await realpath(directory)
    if (!directoryStat || directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || !relativeWithin(rootReal, directoryReal) || resolve(directoryReal, tempReal.slice(tempReal.lastIndexOf(sep) + 1)) !== tempReal) fail('PREVIEW_PATH_UNSAFE', 'Preview directory changed before the atomic create')
    await link(temporaryPath, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error
    if (error instanceof RawDocumentV04PreviewStoreError) throw error
    fail('PREVIEW_PATH_UNSAFE', 'Unable to atomically create the immutable preview snapshot')
  } finally {
    await file?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
  }
}

/** Atomically creates an immutable JSON sidecar. Replays with the same content hash are idempotent. */
export async function persistRawDocumentV04PreviewSnapshot(
  handle: KnowledgeBaseHandle,
  input: PersistRawDocumentV04PreviewInput,
): Promise<{ readonly status: 'persisted' | 'already_present'; readonly snapshot: RawDocumentV04CandidatePreviewSnapshot }> {
  const { root, rootReal } = await assertRoot(handle)
  const snapshot = normalizedBody(handle, input)
  const manifest = await readValidatedManifest(handle, root, rootReal)
  if (snapshot.sourceRevision > manifest.revision) fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Preview source revision is newer than the current Knowledge Base')
  await assertCanonicalSourceAndRaw(handle, snapshot)
  const exists = await ensurePreviewDirectory(root, rootReal, true)
  if (!exists) fail('PREVIEW_PATH_UNSAFE', 'Unable to establish the preview sidecar directory')
  const path = previewFilePath(root, input.workflowRunId)
  const current = await readSafePreviewFile(path, rootReal, input.workflowRunId)
  if (current) {
    await assertCanonicalSourceAndRaw(handle, current)
    if (current.contentHash === snapshot.contentHash) return { status: 'already_present', snapshot: current }
    fail('PREVIEW_CONFLICT', 'workflowRunId already has an immutable preview with different content')
  }
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  if (bytes.byteLength > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes) fail('PREVIEW_SIZE_LIMIT', 'Preview snapshot exceeds the durable byte limit')
  try {
    await persistBytes(path, previewDirectory(root), bytes, rootReal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const raced = await readSafePreviewFile(path, rootReal, input.workflowRunId)
    if (!raced) fail('PREVIEW_PATH_UNSAFE', 'Preview target appeared but could not be safely read')
    await assertCanonicalSourceAndRaw(handle, raced)
    if (raced.contentHash === snapshot.contentHash) return { status: 'already_present', snapshot: raced }
    fail('PREVIEW_CONFLICT', 'workflowRunId was concurrently persisted with different preview content')
  }
  const persisted = await readSafePreviewFile(path, rootReal, input.workflowRunId)
  if (!persisted || persisted.contentHash !== snapshot.contentHash) fail('PREVIEW_CHECKSUM_INVALID', 'Durable preview did not match the persisted candidate snapshot')
  await assertCanonicalSourceAndRaw(handle, persisted)
  return { status: 'persisted', snapshot: persisted }
}

/** Reads a bounded preview only after path, checksum, KB, canonical Source, and Raw checks pass. */
export async function readRawDocumentV04PreviewSnapshot(
  handle: KnowledgeBaseHandle,
  workflowRunId: string,
): Promise<RawDocumentV04CandidatePreviewSnapshot | undefined> {
  if (!RUN_ID.test(workflowRunId) || workflowRunId.includes('..')) fail('PREVIEW_INPUT_INVALID', 'workflowRunId must be a safe bounded identifier')
  const { root, rootReal } = await assertRoot(handle)
  const manifest = await readValidatedManifest(handle, root, rootReal)
  const directoryExists = await ensurePreviewDirectory(root, rootReal, false)
  if (!directoryExists) return undefined
  const snapshot = await readSafePreviewFile(previewFilePath(root, workflowRunId), rootReal, workflowRunId)
  if (!snapshot) return undefined
  if (snapshot.knowledgeBaseId !== manifest.knowledgeBaseId) fail('KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'Preview snapshot belongs to a different Knowledge Base')
  await assertCanonicalSourceAndRaw(handle, snapshot)
  return snapshot
}

/** Reconstructs the mapper's pure input without retaining document text or unused extraction telemetry. */
export function rawDocumentV04PreviewToProposalMappingInput(
  snapshot: RawDocumentV04CandidatePreviewSnapshot,
): RawDocumentV04ProposalMappingInput {
  const candidateSupport = new Map<string, ConsolidatedCandidateSupport>()
  for (const support of snapshot.candidateSupport) {
    const group = snapshot.candidateGroups.find((item) => item.candidateId === support.candidateId)!
    const candidate = group.candidate
    candidateSupport.set(support.candidateId, {
      supportingCandidateCount: support.supportingCandidateCount,
      supportingUnitIds: [],
      evidenceBlockRefs: [...candidate.evidenceBlockRefs],
    })
  }
  const entities = snapshot.candidateGroups.filter((group) => group.kind === 'entity').map((group) => [group.candidateId, group.candidate as EntityCandidate] as const)
  const counts = {
    entity: snapshot.candidateGroups.filter((group) => group.kind === 'entity').length,
    relation: snapshot.candidateGroups.filter((group) => group.kind === 'relation').length,
    claim: snapshot.candidateGroups.filter((group) => group.kind === 'claim').length,
    consolidated: snapshot.candidateGroups.length,
    rejected: 0,
  }
  const consolidated: ConsolidatedExtraction = {
    groups: snapshot.candidateGroups,
    reviewConstraints: snapshot.blockingReviewConstraints,
    rejected: [],
    candidateCounts: counts,
    candidateAliases: new Map(),
    entityCandidates: new Map(entities),
    candidateSupport,
  }
  const document = {
    documentId: snapshot.documentId,
    blocks: snapshot.orderedBlocks.map(({ blockId, order }) => ({ blockId, order })),
  } as unknown as StructuredDocument
  return { consolidated, document, sourceRef: snapshot.sourceRef as RawDocumentV04ProposalMappingInput['sourceRef'], rawRef: snapshot.rawRef as RawDocumentV04ProposalMappingInput['rawRef'] }
}
