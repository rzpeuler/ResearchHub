import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import type { KnowledgeSourceV04, SourceRightsV04 } from '../schema/domain-v04.ts'
import type { SourceTypeV03, SourceReliabilityV03 } from '../schema/domain.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import { archiveRaw } from '../raw/raw-archive.ts'
import { validateKnowledgeChangeSetV04 } from '../validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../writer/writer.ts'

const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024
const WORKFLOW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const MEDIA_TYPE = /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/i
const SOURCE_TYPES = new Set<SourceTypeV03>([
  'official_disclosure', 'company_official', 'sell_side_research', 'industry_database',
  'professional_media', 'general_media', 'community', 'unknown',
])
const SOURCE_RELIABILITIES = new Set<SourceReliabilityV03>(['high', 'medium', 'low', 'unknown'])

export interface RawDocumentMetadataV04 {
  readonly title?: string | null
  readonly sourceType?: SourceTypeV03
  readonly sourceReliability?: SourceReliabilityV03
  readonly publisher?: string | null
  readonly institution?: string | null
  readonly author?: string | null
  readonly publishedAt?: string | null
  readonly canonicalUrl?: string | null
}

/** Rights are caller supplied. A local upload alone does not establish processing rights. */
export interface RawDocumentRightsV04 {
  readonly accessScope: SourceRightsV04['accessScope']
  readonly providerTermsKnown: boolean
  readonly retentionAllowed: boolean
  readonly aiProcessingAllowed: boolean
  readonly derivativeKnowledgeAllowed: boolean
  readonly redistributionAllowed: boolean
  readonly policyBasis: string
  readonly expiresAt?: string | null
  readonly entitlementRef?: string | null
}

export interface RawDocumentGatewayV04Input {
  readonly handle: KnowledgeBaseHandle
  readonly workflowRunId: string
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mediaType: string
  readonly source?: RawDocumentMetadataV04
  readonly rights: RawDocumentRightsV04
}

export type RawDocumentGatewayV04Status = 'committed' | 'already_committed' | 'no_changes' | 'blocked' | 'failed'

export interface RawDocumentGatewayV04Result {
  readonly status: RawDocumentGatewayV04Status
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly knowledgeBaseRevision: number
  readonly sourceRef?: `source:${string}`
  readonly rawRef?: `raw-sha256-${string}`
  readonly changeSetId?: string
  readonly rawReused?: boolean
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export interface RawDocumentGatewayV04Options {
  readonly registry?: KnowledgeBaseRegistry
  readonly clock?: () => string
  readonly writer?: typeof writeKnowledgeBase
}

interface CleanRequest {
  readonly workflowRunId: string
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mediaType: string
  readonly title: string
  readonly sourceType: SourceTypeV03
  readonly sourceReliability?: SourceReliabilityV03
  readonly publisher: string | null
  readonly institution: string | null
  readonly author: string | null
  readonly publishedAt: string | null
  readonly canonicalUrl: string | null
  readonly rights: RawDocumentRightsV04
}

interface PriorExecution {
  readonly changeSetId?: unknown
  readonly changeSetHash?: unknown
  readonly committedRevision?: unknown
  readonly changes?: { readonly createdIds?: unknown; readonly updatedIds?: unknown }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function baseResult(handle: KnowledgeBaseHandle, knowledgeBaseRevision = handle.revision): Pick<RawDocumentGatewayV04Result, 'knowledgeBaseId' | 'baseRevision' | 'knowledgeBaseRevision' | 'createdIds' | 'updatedIds' | 'errors'> {
  return { knowledgeBaseId: handle.knowledgeBaseId, baseRevision: handle.revision, knowledgeBaseRevision, createdIds: [], updatedIds: [], errors: [] }
}

function blocked(handle: KnowledgeBaseHandle, code: string, message: string, knowledgeBaseRevision = handle.revision): RawDocumentGatewayV04Result {
  return { status: 'blocked', ...baseResult(handle, knowledgeBaseRevision), errors: [{ code, message }] }
}

function failed(handle: KnowledgeBaseHandle, code: string, message: string, knowledgeBaseRevision = handle.revision): RawDocumentGatewayV04Result {
  return { status: 'failed', ...baseResult(handle, knowledgeBaseRevision), errors: [{ code, message }] }
}

function stringField(value: unknown, label: string, maxLength: number, nullable = true): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null && nullable) return null
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters${nullable ? ' or null' : ''}`)
  }
  return value.trim()
}

function cleanFilename(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('filename must be a non-empty string without control characters')
  const basename = value.normalize('NFC').split(/[\\/]/u).filter(Boolean).at(-1)?.trim()
  if (!basename || basename === '.' || basename === '..' || basename.length > 255) throw new Error('filename must have a safe basename of at most 255 characters')
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(basename)) throw new Error('filename uses a reserved device name')
  return basename
}

function cleanUrl(value: unknown): string | null | undefined {
  const raw = stringField(value, 'source.canonicalUrl', 2048)
  if (raw === undefined || raw === null) return raw
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error('source.canonicalUrl must be an absolute HTTP(S) URL') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('source.canonicalUrl must be an absolute HTTP(S) URL without embedded credentials')
  return parsed.toString()
}

function validateRights(value: unknown, now: number): RawDocumentRightsV04 {
  if (!record(value)) throw new Error('rights must be supplied explicitly')
  const required = ['accessScope', 'providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed', 'policyBasis']
  if (required.some((key) => !Object.hasOwn(value, key))) throw new Error('rights must explicitly state access scope, terms, retention, AI processing, derived knowledge, redistribution, and policy basis')
  const allowed = new Set([...required, 'expiresAt', 'entitlementRef'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('rights contains invalid fields')
  if (!['public', 'authenticated', 'restricted', 'unknown'].includes(String(value.accessScope))) throw new Error('rights.accessScope is invalid')
  for (const field of ['providerTermsKnown', 'retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed'] as const) {
    if (typeof value[field] !== 'boolean') throw new Error(`rights.${field} must be an explicit boolean`)
  }
  const policyBasis = stringField(value.policyBasis, 'rights.policyBasis', 512, false)
  const expiresAt = stringField(value.expiresAt, 'rights.expiresAt', 80)
  if (expiresAt !== undefined && expiresAt !== null && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now)) throw new Error('rights.expiresAt must be a valid future date when supplied')
  const entitlementRef = stringField(value.entitlementRef, 'rights.entitlementRef', 256)
  return {
    accessScope: value.accessScope as RawDocumentRightsV04['accessScope'],
    providerTermsKnown: value.providerTermsKnown as boolean,
    retentionAllowed: value.retentionAllowed as boolean,
    aiProcessingAllowed: value.aiProcessingAllowed as boolean,
    derivativeKnowledgeAllowed: value.derivativeKnowledgeAllowed as boolean,
    redistributionAllowed: value.redistributionAllowed as boolean,
    policyBasis: policyBasis as string,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(entitlementRef === undefined ? {} : { entitlementRef }),
  }
}

function cleanInput(input: unknown, now: number): CleanRequest {
  if (!record(input)) throw new Error('input must be an object')
  const incomingBytes = input.bytes
  if (!(incomingBytes instanceof Uint8Array) || incomingBytes.byteLength < 1 || incomingBytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error(`bytes must be a non-empty Uint8Array of at most ${MAX_DOCUMENT_BYTES} bytes`)
  const bytes = new Uint8Array(incomingBytes)
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error(`bytes must be a non-empty Uint8Array of at most ${MAX_DOCUMENT_BYTES} bytes`)
  const filename = cleanFilename(input.filename)
  if (typeof input.mediaType !== 'string' || !MEDIA_TYPE.test(input.mediaType.trim())) throw new Error('mediaType must be a valid MIME type')
  if (typeof input.workflowRunId !== 'string' || !WORKFLOW_RUN_ID.test(input.workflowRunId)) throw new Error('workflowRunId must be 1-80 safe letters, digits, underscores, or hyphens')
  if (input.source !== undefined && (!record(input.source) || Object.keys(input.source).some((key) => !['title', 'sourceType', 'sourceReliability', 'publisher', 'institution', 'author', 'publishedAt', 'canonicalUrl'].includes(key)))) throw new Error('source metadata contains invalid fields')
  const source = record(input.source) ? input.source : {}
  const title = stringField(source.title, 'source.title', 512) ?? filename
  const sourceType = source.sourceType ?? 'unknown'
  if (typeof sourceType !== 'string' || !SOURCE_TYPES.has(sourceType as SourceTypeV03)) throw new Error('source.sourceType is invalid')
  const reliability = source.sourceReliability
  if (reliability !== undefined && (typeof reliability !== 'string' || !SOURCE_RELIABILITIES.has(reliability as SourceReliabilityV03))) throw new Error('source.sourceReliability is invalid')
  const publisher = stringField(source.publisher, 'source.publisher', 512)
  const institution = stringField(source.institution, 'source.institution', 512)
  const author = stringField(source.author, 'source.author', 512)
  const publishedAt = stringField(source.publishedAt, 'source.publishedAt', 80)
  if (publishedAt !== undefined && publishedAt !== null && !Number.isFinite(Date.parse(publishedAt))) throw new Error('source.publishedAt must be a valid date or null')
  const canonicalUrl = cleanUrl(source.canonicalUrl)
  const rights = validateRights(input.rights, now)
  if (!['public', 'authenticated'].includes(rights.accessScope) || rights.retentionAllowed !== true || rights.aiProcessingAllowed !== true || rights.derivativeKnowledgeAllowed !== true) {
    throw Object.assign(new Error('Source rights do not permit retained Raw, AI processing, and derived Knowledge'), { code: 'RAW_DOCUMENT_RIGHTS_INELIGIBLE' })
  }
  return {
    workflowRunId: input.workflowRunId,
    bytes,
    filename,
    mediaType: input.mediaType.trim().toLowerCase(),
    title,
    sourceType: sourceType as SourceTypeV03,
    ...(reliability === undefined ? {} : { sourceReliability: reliability as SourceReliabilityV03 }),
    publisher: publisher ?? null,
    institution: institution ?? null,
    author: author ?? null,
    publishedAt: publishedAt ?? null,
    canonicalUrl: canonicalUrl ?? null,
    rights,
  }
}

function changeSetFor(handle: KnowledgeBaseHandle, request: CleanRequest, source: KnowledgeSourceV04): KnowledgeChangeSetV04 {
  const operation: KnowledgeOperationV04 = { operationId: 'create-source', type: 'create', object: source }
  const digest = hashKnowledgeObject({ knowledgeBaseId: handle.knowledgeBaseId, workflowRunId: request.workflowRunId }).slice('sha256:'.length, 'sha256:'.length + 24)
  return {
    changeSetId: `raw-document-${digest}`,
    workflowRunId: request.workflowRunId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: [operation],
    ingestionContext: { producerType: 'raw_document_source_gateway', workflowRunId: request.workflowRunId },
  }
}

function priorHash(changeSet: KnowledgeChangeSetV04): string {
  const { expectedBaseRevision: _expectedBaseRevision, ...stable } = changeSet
  return hashKnowledgeObject(stable)
}

async function priorExecution(root: string, workflowRunId: string): Promise<PriorExecution | undefined> {
  const path = join(root, 'logs', 'research', `${workflowRunId}.yaml`)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Existing Writer execution record is not a regular file')
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!record(parsed) || parsed.workflowRunId !== workflowRunId) throw new Error('Existing Writer execution record is invalid')
    return parsed as PriorExecution
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function sourceIdentity(handle: KnowledgeBaseHandle, request: CleanRequest, rawRef: string): string {
  return hashKnowledgeObject({
    knowledgeBaseId: handle.knowledgeBaseId,
    rawRef,
    filename: request.filename,
    mediaType: request.mediaType,
    title: request.title,
    sourceType: request.sourceType,
    sourceReliability: request.sourceReliability ?? null,
    publisher: request.publisher,
    institution: request.institution,
    author: request.author,
    publishedAt: request.publishedAt,
    canonicalUrl: request.canonicalUrl,
    rights: request.rights,
  })
}

function sourceFor(request: CleanRequest, raw: Awaited<ReturnType<typeof archiveRaw>>, identity: string): KnowledgeSourceV04 {
  const recordedAt = raw.manifest.receivedAt
  const rawRef = raw.manifest.rawRef as `raw-sha256-${string}`
  const sourceId = `source:manual-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}` as `source:${string}`
  return {
    id: sourceId,
    title: request.title,
    sourceType: request.sourceType,
    ...(request.sourceReliability === undefined ? {} : { sourceReliability: request.sourceReliability }),
    publisher: request.publisher,
    institution: request.institution,
    author: request.author,
    publishedAt: request.publishedAt,
    url: request.canonicalUrl,
    rawRefs: [rawRef],
    provider: 'manual_upload',
    canonicalUrl: request.canonicalUrl,
    retrievedAt: recordedAt,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length),
    metadata: { originalFilename: request.filename, mediaType: request.mediaType, rawDocumentIdentity: identity },
    acquisition: { method: 'manual', discoveredAt: null, fetchedAt: recordedAt, extractor: null },
    rights: {
      accessScope: request.rights.accessScope,
      providerTermsKnown: request.rights.providerTermsKnown,
      retentionAllowed: request.rights.retentionAllowed,
      aiProcessingAllowed: request.rights.aiProcessingAllowed,
      derivativeKnowledgeAllowed: request.rights.derivativeKnowledgeAllowed,
      redistributionAllowed: request.rights.redistributionAllowed,
      ...(request.rights.expiresAt === undefined ? {} : { expiresAt: request.rights.expiresAt }),
      ...(request.rights.entitlementRef === undefined ? {} : { entitlementRef: request.rights.entitlementRef }),
      policyBasis: request.rights.policyBasis,
    },
    usagePolicy: {
      mode: 'personal_noncommercial_research',
      retainRaw: true,
      allowAiProcessing: true,
      allowDerivedKnowledge: true,
      redistributionAllowed: false,
    },
    lifecycle: { status: 'active' },
    createdAt: recordedAt,
    updatedAt: recordedAt,
  }
}

export class RawDocumentKnowledgeGatewayV04 {
  private readonly registry: KnowledgeBaseRegistry
  private readonly clock: () => string
  private readonly writer: typeof writeKnowledgeBase

  constructor(options: RawDocumentGatewayV04Options = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.writer = options.writer ?? writeKnowledgeBase
  }

  async submit(input: RawDocumentGatewayV04Input): Promise<RawDocumentGatewayV04Result> {
    let now: string
    let request: CleanRequest
    try {
      now = this.clock()
      if (!Number.isFinite(Date.parse(now))) return blocked(input.handle, 'RAW_DOCUMENT_CLOCK_INVALID', 'Gateway clock must return a valid date')
      request = cleanInput(input, Date.parse(now))
    } catch (error) {
      const code = record(error) && typeof error.code === 'string' ? error.code : 'RAW_DOCUMENT_INPUT_INVALID'
      return blocked(input.handle, code, error instanceof Error ? error.message : String(error))
    }
    try {
      const handle = input.handle
      if (!handle || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || !handle.writable || handle.status !== 'active') return blocked(handle, 'RAW_DOCUMENT_VERSION_OR_HANDLE_INVALID', 'Raw document production requires an active writable Schema 0.4 / Storage Format 1 Knowledge Base')

      const manifest = await loadKnowledgeBaseManifest(handle.rootRef)
      if (manifest.knowledgeBaseId !== handle.knowledgeBaseId || manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active') return blocked(handle, 'RAW_DOCUMENT_HANDLE_MISMATCH', 'Knowledge Base manifest identity or writable state does not match the supplied handle', manifest.revision)
      const prior = manifest.revision === handle.revision ? undefined : await priorExecution(handle.rootRef, request.workflowRunId)
      if (manifest.revision !== handle.revision && !prior) return blocked(handle, 'RAW_DOCUMENT_STALE_REVISION', `Mounted handle revision ${handle.revision} is stale; current Knowledge Base revision is ${manifest.revision}`, manifest.revision)
      const currentHandle = manifest.revision === handle.revision ? handle : await this.registry.refresh(handle.rootRef)

      if (!['public', 'authenticated'].includes(request.rights.accessScope) || request.rights.retentionAllowed !== true || request.rights.aiProcessingAllowed !== true || request.rights.derivativeKnowledgeAllowed !== true) return blocked(handle, 'RAW_DOCUMENT_RIGHTS_INELIGIBLE', 'Source rights do not permit retained Raw, AI processing, and derived Knowledge', manifest.revision)

      const raw = await archiveRaw(currentHandle, {
        bytes: request.bytes,
        originalFilename: request.filename,
        mediaType: request.mediaType,
        suppliedMetadata: { title: request.title, institution: request.institution ?? request.publisher, author: request.author, publishedAt: request.publishedAt, sourceUrl: request.canonicalUrl },
      }, { clock: this.clock })
      const identity = sourceIdentity(currentHandle, request, raw.manifest.rawRef)
      const source = sourceFor(request, raw, identity)
      const changeSet = changeSetFor(currentHandle, request, source)
      const execution = prior ?? await priorExecution(currentHandle.rootRef, request.workflowRunId)
      const assets = await readCanonicalV04Assets(currentHandle.rootRef)
      const existing = assets.objects.find((asset) => asset.value.id === source.id)?.value as KnowledgeSourceV04 | undefined
      if (existing && existing.metadata?.rawDocumentIdentity !== identity) return { ...blocked(currentHandle, 'RAW_DOCUMENT_SOURCE_ID_CONFLICT', `Canonical Source identity conflicts with existing object ${source.id}`), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused }

      if (execution) {
        const expectedHash = priorHash(changeSet)
        if (execution.changeSetId !== changeSet.changeSetId || execution.changeSetHash !== expectedHash) return { ...blocked(currentHandle, 'RAW_DOCUMENT_IDEMPOTENCY_CONFLICT', 'workflowRunId was already used for a different Source/Raw request'), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused }
        if (!existing) return { ...blocked(currentHandle, 'RAW_DOCUMENT_REPLAY_SOURCE_MISSING', 'The prior Writer record exists but its canonical Source is missing'), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused }
        const committedRevision = Number.isSafeInteger(execution.committedRevision) ? Number(execution.committedRevision) : manifest.revision
        const createdIds = Array.isArray(execution.changes?.createdIds) ? execution.changes.createdIds.filter((id): id is string => typeof id === 'string') : [source.id]
        const updatedIds = Array.isArray(execution.changes?.updatedIds) ? execution.changes.updatedIds.filter((id): id is string => typeof id === 'string') : []
        return { status: 'already_committed', ...baseResult(currentHandle, committedRevision), baseRevision: Math.max(0, committedRevision - 1), sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, changeSetId: changeSet.changeSetId, rawReused: raw.reused, createdIds, updatedIds }
      }

      if (existing) return { status: 'no_changes', ...baseResult(currentHandle, manifest.revision), sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused }

      const validation = await validateKnowledgeChangeSetV04(currentHandle, changeSet, { mode: 'commit', now: this.clock })
      if (!validation.validatedChangeSet) return { ...blocked(currentHandle, 'RAW_DOCUMENT_VALIDATION_FAILED', validation.report.errors.map((error) => `${error.code}: ${error.message}`).join('; '), manifest.revision), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused, changeSetId: changeSet.changeSetId }
      let write: KnowledgeWriteResultV04
      try { write = await this.writer(currentHandle, validation.validatedChangeSet, { registry: this.registry, clock: this.clock }) as KnowledgeWriteResultV04 }
      catch (error) { return { ...failed(currentHandle, 'RAW_DOCUMENT_WRITER_FAILED', error instanceof Error ? error.message : String(error)), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused, changeSetId: changeSet.changeSetId } }
      if (write.status === 'failed' || write.status === 'rejected') {
        const code = write.error?.code ?? 'RAW_DOCUMENT_WRITER_REJECTED'
        const message = write.error?.message ?? 'Shared Writer rejected the validated Source ChangeSet'
        if (code === 'stale_revision' || code === 'idempotency_conflict') {
          let currentRevision = write.committedRevision
          try {
            const latest = await loadKnowledgeBaseManifest(currentHandle.rootRef)
            if (latest.knowledgeBaseId === currentHandle.knowledgeBaseId) currentRevision = latest.revision
          } catch { /* Preserve the best revision available from Writer. */ }
          const conflictCode = code === 'stale_revision' ? 'RAW_DOCUMENT_STALE_REVISION' : 'RAW_DOCUMENT_IDEMPOTENCY_CONFLICT'
          return { ...blocked(currentHandle, conflictCode, message, currentRevision), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused, changeSetId: changeSet.changeSetId }
        }
        return { ...failed(currentHandle, code, message, write.committedRevision), rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, rawReused: raw.reused, changeSetId: changeSet.changeSetId }
      }
      return { status: write.status, knowledgeBaseId: write.knowledgeBaseId, baseRevision: write.baseRevision, knowledgeBaseRevision: write.committedRevision, sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, changeSetId: write.changeSetId, rawReused: raw.reused, createdIds: write.createdIds, updatedIds: write.updatedIds, errors: [] }
    } catch (error) {
      const code = record(error) && typeof error.code === 'string' ? error.code : undefined
      const handle = input?.handle
      if (code === 'RAW_DOCUMENT_RIGHTS_INELIGIBLE' && handle) return blocked(handle, code, error instanceof Error ? error.message : String(error))
      if (handle) return failed(handle, code ?? 'RAW_DOCUMENT_SUBMISSION_FAILED', error instanceof Error ? error.message : String(error))
      return { status: 'failed', knowledgeBaseId: '', baseRevision: 0, knowledgeBaseRevision: 0, createdIds: [], updatedIds: [], errors: [{ code: code ?? 'RAW_DOCUMENT_SUBMISSION_FAILED', message: error instanceof Error ? error.message : String(error) }] }
    }
  }
}
