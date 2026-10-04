import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { allocateEntityId } from '../../knowledge/registry/id-allocation.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionOutcome, ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import {
  RawDocumentV04PreviewStoreError,
  rawDocumentV04PreviewToProposalMappingInput,
  readRawDocumentV04PreviewSnapshot,
  RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS,
  type RawDocumentV04CandidatePreviewSnapshot,
} from './v04-preview-store.ts'
import {
  mapRawDocumentExtractionToV04Proposals,
  type RawDocumentV04MappingDecision,
} from './v04-proposal-mapper.ts'

export type RawDocumentV04CandidateAcceptanceStatus =
  | KnowledgeProductionOutcome['status']
  | 'incompatible_schema'
  | 'stale_revision'

export interface RawDocumentV04CandidateAcceptanceError {
  readonly code: string
  readonly message: string
}

export interface RawDocumentV04CandidateAcceptanceInput {
  readonly handle: KnowledgeBaseHandle
  readonly previewWorkflowRunId: string
  readonly acceptedCandidateIds: readonly string[]
  readonly now?: () => string
}

export interface RawDocumentV04CandidateAcceptanceResult {
  readonly status: RawDocumentV04CandidateAcceptanceStatus
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly baseRevision: number
  readonly previewWorkflowRunId: string
  readonly previewSnapshotHash?: string
  readonly extractionCompleteness?: 'complete' | 'partial'
  readonly sourceRef?: string
  readonly rawRef?: string
  readonly producerRunId?: string
  readonly requestedCandidateIds: readonly string[]
  /** IDs are populated only when the whole submitted candidate set resolved and committed. */
  readonly acceptedCandidateIds: readonly string[]
  readonly canonicalRefsByCandidateId: Readonly<Record<string, string>>
  readonly mappingDecisions: readonly RawDocumentV04MappingDecision[]
  readonly resolutionIntents: readonly ResolutionIntentSummary[]
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly changeSetId?: string
  readonly errors: readonly RawDocumentV04CandidateAcceptanceError[]
}

const CANDIDATE_ID_MAX_LENGTH = 200
const MAX_WRITER_LOG_BYTES = 2_000_000
const ACCEPTED_STATUSES = new Set<KnowledgeProductionOutcome['status']>(['committed', 'already_committed', 'no_changes'])
type Dict = Record<string, unknown>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function baseResult(
  input: RawDocumentV04CandidateAcceptanceInput,
  overrides: Partial<RawDocumentV04CandidateAcceptanceResult> = {},
): RawDocumentV04CandidateAcceptanceResult {
  return {
    status: 'blocked',
    knowledgeBaseId: input.handle.knowledgeBaseId,
    knowledgeBaseRevision: input.handle.revision,
    baseRevision: input.handle.revision,
    previewWorkflowRunId: input.previewWorkflowRunId,
    requestedCandidateIds: Array.isArray(input.acceptedCandidateIds) ? input.acceptedCandidateIds.filter((value): value is string => typeof value === 'string') : [],
    acceptedCandidateIds: [],
    canonicalRefsByCandidateId: {},
    mappingDecisions: [],
    resolutionIntents: [],
    createdIds: [],
    updatedIds: [],
    errors: [],
    ...overrides,
  }
}

function errorResult(
  input: RawDocumentV04CandidateAcceptanceInput,
  code: string,
  message: string,
  overrides: Partial<RawDocumentV04CandidateAcceptanceResult> = {},
): RawDocumentV04CandidateAcceptanceResult {
  return baseResult(input, { errors: [{ code, message }], ...overrides })
}

function validateSelection(value: unknown): { readonly ids?: readonly string[]; readonly error?: RawDocumentV04CandidateAcceptanceError } {
  if (!Array.isArray(value) || value.length === 0) return { error: { code: 'ACCEPTED_CANDIDATES_REQUIRED', message: 'Select at least one candidate for canonical acceptance.' } }
  if (value.length > RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxCandidateGroups) return { error: { code: 'ACCEPTED_CANDIDATE_LIMIT', message: 'The accepted candidate set exceeds the durable preview limit.' } }
  if (value.some((item) => typeof item !== 'string' || item.trim() === '' || item.length > CANDIDATE_ID_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(item))) {
    return { error: { code: 'ACCEPTED_CANDIDATE_ID_INVALID', message: 'Each accepted candidate ID must be a bounded, non-empty string without control characters.' } }
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) return { error: { code: 'ACCEPTED_CANDIDATE_DUPLICATE', message: 'The accepted candidate list contains duplicate IDs.' } }
  return { ids: [...ids] }
}

function selectedMappingError(
  mapping: ReturnType<typeof mapRawDocumentExtractionToV04Proposals>,
  selectedIds: readonly string[],
): RawDocumentV04CandidateAcceptanceError | undefined {
  const selected = new Set(selectedIds)
  const decisions = mapping.decisions.filter((item) => selected.has(item.candidateId))
  const byId = new Map(decisions.map((item) => [item.candidateId, item]))
  const unresolved = selectedIds.filter((id) => {
    const item = byId.get(id)
    return !item || (item.disposition !== 'root' && item.disposition !== 'mapped')
  })
  if (unresolved.length > 0) {
    return { code: 'ACCEPTED_CANDIDATE_REQUIRES_REVIEW', message: `Every selected candidate must map cleanly before any canonical write; review is required for: ${unresolved.join(', ')}.` }
  }
  const root = decisions.find((item) => item.disposition === 'root')
  if (!mapping.entity || !root || !selected.has(root.candidateId)) {
    return { code: 'MISSING_ROOT_ENTITY', message: 'The accepted candidate set must include a supported Entity that can serve as the Gateway root.' }
  }
  const proposalIds = new Set(mapping.proposals.map((item) => item.proposalId))
  if (decisions.some((item) => !item.proposalId || !proposalIds.has(item.proposalId)) || mapping.proposals.length !== selectedIds.length) {
    return { code: 'ACCEPTED_CANDIDATE_MAPPING_INCOMPLETE', message: 'The mapper did not produce exactly one proposal for each selected candidate.' }
  }
  return undefined
}

function canonicalRefsByCandidate(
  decisions: readonly RawDocumentV04MappingDecision[],
  selectedIds: readonly string[],
  outcome: KnowledgeProductionOutcome,
): Record<string, string> | undefined {
  const byId = new Map(decisions.map((item) => [item.candidateId, item]))
  const pairs: [string, string][] = []
  for (const candidateId of selectedIds) {
    const decision = byId.get(candidateId)
    if (!decision) return undefined
    let canonicalRef: string | undefined
    if (decision.kind === 'entity' && decision.localKey) canonicalRef = outcome.entityRefsByLocalKey[decision.localKey]
    else if (decision.kind === 'relation' && decision.proposalId) canonicalRef = outcome.relationRefsByProposalId[decision.proposalId]
    else if (decision.kind === 'claim' && decision.proposalId) canonicalRef = outcome.claimRefsByProposalId[decision.proposalId]
    if (!canonicalRef) return undefined
    pairs.push([candidateId, canonicalRef])
  }
  return Object.fromEntries(pairs)
}

function mapStoreError(error: unknown): RawDocumentV04CandidateAcceptanceError {
  if (error instanceof RawDocumentV04PreviewStoreError) return { code: error.code, message: error.message }
  return { code: 'PREVIEW_READ_FAILED', message: 'The durable preview could not be verified.' }
}

function record(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs
}

/**
 * Reads only the deterministic Writer receipt for this acceptance run. Its
 * created/updated IDs let a retry prove the exact Entity ref was written by
 * this preview+selection run before treating a non-Company identity as equal.
 */
async function priorAcceptedEntityRefs(handle: KnowledgeBaseHandle, producerRunId: string): Promise<ReadonlySet<string>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(producerRunId) || producerRunId.includes('..')) return new Set()
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const root = resolve(handle.rootRef)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return new Set()
    const rootReal = await realpath(root)
    let directory = root
    const directoryStats: { readonly path: string; readonly stat: Awaited<ReturnType<typeof lstat>>; readonly real: string }[] = []
    for (const part of ['logs', 'research']) {
      directory = join(directory, part)
      const stat = await lstat(directory).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (!stat) return new Set()
      if (!stat.isDirectory() || stat.isSymbolicLink()) return new Set()
      const real = await realpath(directory)
      if (!contained(rootReal, real)) return new Set()
      directoryStats.push({ path: directory, stat, real })
    }
    const path = join(directory, `${producerRunId}.yaml`)
    const before = await lstat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!before || !before.isFile() || before.isSymbolicLink() || before.size > MAX_WRITER_LOG_BYTES) return new Set()
    const fileReal = await realpath(path)
    if (!contained(rootReal, fileReal)) return new Set()
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    file = await open(path, constants.O_RDONLY | noFollow)
    const opened = await file.stat()
    if (!opened.isFile() || !sameFile(before, opened) || opened.size > MAX_WRITER_LOG_BYTES) return new Set()
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let total = 0
    while (true) {
      const length = Math.min(buffer.length, MAX_WRITER_LOG_BYTES + 1 - total)
      if (length <= 0) return new Set()
      const read = await file.read(buffer, 0, length, null)
      if (read.bytesRead === 0) break
      total += read.bytesRead
      if (total > MAX_WRITER_LOG_BYTES) return new Set()
      chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)))
    }
    await file.close()
    file = undefined
    const after = await lstat(path)
    if (!sameFile(before, after) || await realpath(path) !== fileReal) return new Set()
    for (const item of directoryStats) {
      const current = await lstat(item.path)
      if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(item.stat, current) || await realpath(item.path) !== item.real) return new Set()
    }
    const parsed: unknown = parseYaml(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)), path)
    if (!record(parsed) || parsed.workflowRunId !== producerRunId || parsed.knowledgeBaseId !== handle.knowledgeBaseId || parsed.schemaVersionAtExecution !== '0.4' || parsed.status !== 'completed' || parsed.writeStatus !== 'committed' || typeof parsed.changeSetHash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(parsed.changeSetHash) || !Number.isSafeInteger(parsed.committedRevision) || Number(parsed.committedRevision) > handle.revision) return new Set()
    const context = parsed.ingestionContext
    if (!record(context) || context.producerType !== 'raw_document_candidate_acceptance' || context.producerRunId !== producerRunId) return new Set()
    const changes = parsed.changes
    if (!record(changes) || !Array.isArray(changes.createdIds) || !Array.isArray(changes.updatedIds)) return new Set()
    const ids = [...changes.createdIds, ...changes.updatedIds]
    if (ids.some((id) => typeof id !== 'string')) return new Set()
    return new Set(ids as string[])
  } catch {
    return new Set()
  } finally {
    await file?.close().catch(() => undefined)
  }
}

function isSuccessfulGatewayOutcome(outcome: KnowledgeProductionOutcome): boolean {
  return ACCEPTED_STATUSES.has(outcome.status)
}

/**
 * Accepts an explicitly selected subset of one verified durable preview. The
 * Gateway remains the only canonical mutation path; any selected mapper or
 * Gateway resolution issue blocks the whole set.
 */
export async function acceptRawDocumentV04Candidates(
  input: RawDocumentV04CandidateAcceptanceInput,
): Promise<RawDocumentV04CandidateAcceptanceResult> {
  const selection = validateSelection(input.acceptedCandidateIds)
  if (selection.error) return errorResult(input, selection.error.code, selection.error.message)
  // Snapshot caller-owned identifiers before any asynchronous store operation.
  const requestedIds = selection.ids!
  const selectedIds = [...requestedIds].sort(compareText)

  if (!input.handle || input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1' || input.handle.status !== 'active') {
    return errorResult(input, 'INCOMPATIBLE_SCHEMA', 'Candidate acceptance requires an active Schema 0.4 / Storage Format 1 Knowledge Base.', { status: 'incompatible_schema' })
  }

  const registry = new KnowledgeBaseRegistry()
  let currentHandle: KnowledgeBaseHandle
  try {
    currentHandle = await registry.mount(input.handle.rootRef)
  } catch {
    return errorResult(input, 'KNOWLEDGE_BASE_UNAVAILABLE', 'The supplied Knowledge Base could not be mounted for acceptance.', { status: 'failed' })
  }
  if (currentHandle.knowledgeBaseId !== input.handle.knowledgeBaseId) {
    return errorResult(input, 'KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'The supplied handle does not identify the mounted Knowledge Base.', { knowledgeBaseId: currentHandle.knowledgeBaseId })
  }
  if (currentHandle.schemaVersion !== '0.4' || currentHandle.storageFormatVersion !== '1' || currentHandle.status !== 'active' || !currentHandle.writable) {
    return errorResult(input, 'INCOMPATIBLE_SCHEMA', 'Candidate acceptance requires an active Schema 0.4 / Storage Format 1 Knowledge Base.', { status: 'incompatible_schema', knowledgeBaseId: currentHandle.knowledgeBaseId, knowledgeBaseRevision: currentHandle.revision })
  }
  if (currentHandle.revision !== input.handle.revision) {
    return errorResult(input, 'STALE_HANDLE_REVISION', `The supplied handle is at revision ${input.handle.revision}; the current Knowledge Base is at revision ${currentHandle.revision}.`, { status: 'stale_revision', knowledgeBaseId: currentHandle.knowledgeBaseId, knowledgeBaseRevision: currentHandle.revision })
  }

  let snapshot: RawDocumentV04CandidatePreviewSnapshot | undefined
  try {
    snapshot = await readRawDocumentV04PreviewSnapshot(currentHandle, input.previewWorkflowRunId)
  } catch (error) {
    const mapped = mapStoreError(error)
    return errorResult(input, mapped.code, mapped.message, { knowledgeBaseId: currentHandle.knowledgeBaseId, knowledgeBaseRevision: currentHandle.revision })
  }
  if (!snapshot) return errorResult(input, 'PREVIEW_NOT_FOUND', 'No durable candidate preview exists for the requested workflow run.', { knowledgeBaseId: currentHandle.knowledgeBaseId, knowledgeBaseRevision: currentHandle.revision })
  const snapshotResult = {
    knowledgeBaseId: currentHandle.knowledgeBaseId,
    knowledgeBaseRevision: currentHandle.revision,
    baseRevision: currentHandle.revision,
    previewSnapshotHash: snapshot.contentHash,
    ...(snapshot.extractionCompleteness === undefined ? {} : { extractionCompleteness: snapshot.extractionCompleteness }),
    sourceRef: snapshot.sourceRef,
    rawRef: snapshot.rawRef,
  }
  if (snapshot.knowledgeBaseId !== currentHandle.knowledgeBaseId) {
    return errorResult(input, 'KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'The durable preview belongs to a different Knowledge Base.', snapshotResult)
  }
  if (snapshot.version !== 2 || (snapshot.extractionCompleteness !== 'complete' && snapshot.extractionCompleteness !== 'partial')) {
    return errorResult(input, 'PREVIEW_COMPLETENESS_UNKNOWN', 'This preview predates completeness tracking and cannot be accepted safely.', snapshotResult)
  }
  const groupsById = new Set(snapshot.candidateGroups.map((group) => group.candidateId))
  const unknownIds = selectedIds.filter((candidateId) => !groupsById.has(candidateId))
  if (unknownIds.length > 0) {
    return errorResult(input, 'ACCEPTED_CANDIDATE_UNKNOWN', `Selected candidate IDs are absent from the durable preview: ${unknownIds.join(', ')}.`, snapshotResult)
  }

  // Re-read the current manifest after sidecar and Source/Raw verification.
  // Writer also checks this revision under its mutation lock to close the final race.
  try {
    currentHandle = await registry.refresh(input.handle.rootRef)
  } catch {
    return errorResult(input, 'KNOWLEDGE_BASE_UNAVAILABLE', 'The Knowledge Base changed or became unavailable during preview verification.', { ...snapshotResult, status: 'failed' })
  }
  if (currentHandle.knowledgeBaseId !== snapshot.knowledgeBaseId) {
    return errorResult(input, 'KNOWLEDGE_BASE_IDENTITY_MISMATCH', 'The Knowledge Base identity changed during preview verification.', snapshotResult)
  }
  if (currentHandle.revision !== input.handle.revision) {
    return errorResult(input, 'STALE_HANDLE_REVISION', `The Knowledge Base advanced from revision ${input.handle.revision} to ${currentHandle.revision} during preview verification.`, { ...snapshotResult, knowledgeBaseRevision: currentHandle.revision, status: 'stale_revision' })
  }

  const mapping = mapRawDocumentExtractionToV04Proposals({
    ...rawDocumentV04PreviewToProposalMappingInput(snapshot),
    approvedCandidateIds: selectedIds,
  })
  const mappingFailure = selectedMappingError(mapping, selectedIds)
  if (mappingFailure) return errorResult(input, mappingFailure.code, mappingFailure.message, { ...snapshotResult, mappingDecisions: mapping.decisions })

  const producerRunId = `rawdoc-accept-${hashKnowledgeObject({ snapshotHash: snapshot.contentHash, acceptedCandidateIds: selectedIds }).slice(7, 39)}`
  const priorEntityRefs = await priorAcceptedEntityRefs(currentHandle, producerRunId)
  const outcome = await new KnowledgeProductionGateway(registry).submit({
    handle: currentHandle,
    producerType: 'raw_document_candidate_acceptance',
    producerRunId,
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: mapping.entity!,
    proposals: mapping.proposals,
    evidenceBindings: [],
    // Exact allocator identity is deterministic for replay; fuzzy/alias matches
    // remain unresolved and continue to require a separate semantic decision.
    semanticResolver: ({ proposal, existing }) => {
      if (proposal.kind !== 'entity' || !proposal.entityType || !proposal.entityName || existing.length !== 1) return { outcome: 'uncertain', reason: 'Candidate is not an exact single canonical identity match.' }
      const exactId = allocateEntityId(proposal.entityType, proposal.entityName)
      const match = existing[0]
      return match?.canonicalRef === exactId && match.type === proposal.entityType && priorEntityRefs.has(exactId)
        ? { outcome: 'equivalent', reason: 'Exact canonical Entity identity was created or updated by this acceptance run.' }
        : { outcome: 'uncertain', reason: 'A same-name canonical Entity is not proven to be from this acceptance run.' }
    },
    ...(input.now === undefined ? {} : { now: input.now }),
    requireAllResolved: true,
  })

  if (!isSuccessfulGatewayOutcome(outcome)) {
    return baseResult(input, {
      ...snapshotResult,
      status: outcome.status,
      knowledgeBaseRevision: outcome.knowledgeBaseRevision,
      baseRevision: outcome.baseRevision,
      producerRunId,
      requestedCandidateIds: [...requestedIds],
      mappingDecisions: mapping.decisions,
      resolutionIntents: outcome.resolutionIntents,
      createdIds: outcome.createdIds,
      updatedIds: outcome.updatedIds,
      ...(outcome.changeSetId === undefined ? {} : { changeSetId: outcome.changeSetId }),
      errors: outcome.errors.map((message) => ({ code: outcome.status === 'blocked' ? 'GATEWAY_BLOCKED' : 'GATEWAY_FAILED', message })),
    })
  }

  if (outcome.status === 'no_changes') {
    let latestHandle: KnowledgeBaseHandle
    try {
      latestHandle = await registry.refresh(input.handle.rootRef)
    } catch {
      return baseResult(input, { ...snapshotResult, status: 'failed', knowledgeBaseRevision: outcome.knowledgeBaseRevision, baseRevision: outcome.baseRevision, producerRunId, mappingDecisions: mapping.decisions, resolutionIntents: outcome.resolutionIntents, errors: [{ code: 'KNOWLEDGE_BASE_UNAVAILABLE', message: 'The Knowledge Base could not be rechecked after an unchanged acceptance outcome.' }] })
    }
    if (latestHandle.revision !== currentHandle.revision || latestHandle.knowledgeBaseId !== currentHandle.knowledgeBaseId) {
      return baseResult(input, { ...snapshotResult, status: 'stale_revision', knowledgeBaseRevision: latestHandle.revision, baseRevision: currentHandle.revision, producerRunId, mappingDecisions: mapping.decisions, resolutionIntents: outcome.resolutionIntents, errors: [{ code: 'KNOWLEDGE_BASE_CHANGED_DURING_ACCEPTANCE', message: 'The Knowledge Base changed while the Gateway resolved an unchanged acceptance set.' }] })
    }
  }

  const canonicalRefs = canonicalRefsByCandidate(mapping.decisions, selectedIds, outcome)
  if (!canonicalRefs) {
    return baseResult(input, {
      ...snapshotResult,
      status: 'failed',
      knowledgeBaseRevision: outcome.knowledgeBaseRevision,
      baseRevision: outcome.baseRevision,
      producerRunId,
      mappingDecisions: mapping.decisions,
      resolutionIntents: outcome.resolutionIntents,
      createdIds: outcome.createdIds,
      updatedIds: outcome.updatedIds,
      ...(outcome.changeSetId === undefined ? {} : { changeSetId: outcome.changeSetId }),
      errors: [{ code: 'GATEWAY_CANONICAL_MAPPING_INCOMPLETE', message: 'Gateway reported success without a canonical reference for every accepted candidate.' }],
    })
  }

  return baseResult(input, {
    ...snapshotResult,
    status: outcome.status,
    knowledgeBaseRevision: outcome.knowledgeBaseRevision,
    baseRevision: outcome.baseRevision,
    producerRunId,
    requestedCandidateIds: [...requestedIds],
    acceptedCandidateIds: [...requestedIds],
    canonicalRefsByCandidateId: canonicalRefs,
    mappingDecisions: mapping.decisions,
    resolutionIntents: outcome.resolutionIntents,
    createdIds: outcome.createdIds,
    updatedIds: outcome.updatedIds,
    ...(outcome.changeSetId === undefined ? {} : { changeSetId: outcome.changeSetId }),
    errors: outcome.errors.map((message) => ({ code: 'GATEWAY_ERROR', message })),
  })
}
