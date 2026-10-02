import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { types as utilTypes } from 'node:util'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { parseYaml } from '../storage/yaml.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import { verifyRaw } from '../raw/raw-archive.ts'
import { kindForKnowledgeV04 } from '../writer/path-allocation-v04.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../storage/canonical-hash.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import type { KnowledgeAssetV04 } from '../schema/domain-v04.ts'
import { assertKnowledgeV04Objects } from './v04-validator.ts'
import type { ValidatedKnowledgeChangeSetV04, KnowledgeChangeSetV04, KnowledgeOperationV04 } from '../schema/mutation-v04.ts'
import { THEME_SCOPE_V04_LIMITS, validateThemeScopeDecisionBatchV04, type ThemeScopeDecisionV04 } from '../governance/theme-scope-v04.ts'
import { readThemeScopeLedgerV04 } from '../governance/theme-scope-ledger-v04.ts'

export interface V04ChangeSetValidationDiagnostic { readonly code: string; readonly message: string; readonly operationId?: string; readonly assetId?: string }
export interface V04ChangeSetValidationReport { readonly status: 'passed' | 'failed'; readonly errors: readonly V04ChangeSetValidationDiagnostic[] }
export interface V04ChangeSetValidationOptions { readonly mode?: 'commit' | 'dry_run'; readonly now?: () => string }
export interface V04ChangeSetValidationResult { readonly report: V04ChangeSetValidationReport; readonly validatedChangeSet?: ValidatedKnowledgeChangeSetV04 }

type Dict = Record<string, unknown>
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HASH = /^sha256:[0-9a-f]{64}$/
const RAW = /^raw-sha256-[0-9a-f]{64}$/
const record = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value)
const issuedReceipts = new WeakSet<object>()

export function isValidatorIssuedV04Receipt(value: unknown): value is ValidatedKnowledgeChangeSetV04 {
  return record(value) && issuedReceipts.has(value)
}

function add(errors: V04ChangeSetValidationDiagnostic[], code: string, message: string, operationId?: string, assetId?: string): void {
  errors.push({ code, message, ...(operationId === undefined ? {} : { operationId }), ...(assetId === undefined ? {} : { assetId }) })
}

function isJsonSafeIngestionContext(value: unknown): boolean {
  const ancestors = new Set<object>()
  let visitedNodes = 0
  let textCharacters = 0
  let textUtf8Bytes = 0
  const accountText = (text: string): boolean => {
    textCharacters += text.length
    textUtf8Bytes += Buffer.byteLength(text, 'utf8')
    return textCharacters <= THEME_SCOPE_V04_LIMITS.maxJsonCharacters
      && textUtf8Bytes <= THEME_SCOPE_V04_LIMITS.maxJsonUtf8Bytes
  }
  const visit = (item: unknown, depth: number): boolean => {
    visitedNodes += 1
    if (visitedNodes > 100_000 || depth > 64) return false
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'string') return accountText(item)
    if (typeof item === 'number') return Number.isFinite(item) && !Object.is(item, -0)
    if (typeof item !== 'object' || utilTypes.isProxy(item) || ancestors.has(item)) return false
    ancestors.add(item)
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length > 0 || item.length > 100_000) return false
        const names = Object.getOwnPropertyNames(item)
        if (names.length !== item.length + 1) return false
        const lengthDescriptor = Object.getOwnPropertyDescriptor(item, 'length')
        if (!lengthDescriptor || lengthDescriptor.enumerable || !('value' in lengthDescriptor)) return false
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
          if (!descriptor?.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false
        }
        return true
      }
      const prototype = Object.getPrototypeOf(item)
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(item).length > 0) return false
      const names = Object.getOwnPropertyNames(item)
      if (names.length > 100_000) return false
      for (const name of names) {
        if (name.length > THEME_SCOPE_V04_LIMITS.maxJsonObjectKeyLength || !accountText(name)) return false
        const descriptor = Object.getOwnPropertyDescriptor(item, name)
        if (!descriptor?.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false
      }
      return true
    } catch {
      return false
    } finally {
      ancestors.delete(item)
    }
  }
  if (!visit(value, 0)) return false
  try {
    const serialized = canonicalSerialize(value)
    return serialized.length <= THEME_SCOPE_V04_LIMITS.maxJsonCharacters
      && Buffer.byteLength(serialized, 'utf8') <= THEME_SCOPE_V04_LIMITS.maxJsonUtf8Bytes
  } catch {
    return false
  }
}

export interface ThemeScopeContextProbeV04 {
  readonly present: boolean
  readonly value?: unknown
  readonly error?: string
}

/** Inspects scope presence without invoking accessors or accepting data that clone/hash would omit. */
export function inspectThemeScopeContextV04(changeSet: unknown): ThemeScopeContextProbeV04 {
  if (!record(changeSet)) return { present: false }
  if (utilTypes.isProxy(changeSet)) return { present: true, error: 'ChangeSet cannot be a Proxy when carrying Theme scope' }
  let contextDescriptor: PropertyDescriptor | undefined
  try {
    contextDescriptor = Object.getOwnPropertyDescriptor(changeSet, 'ingestionContext')
  } catch {
    return { present: true, error: 'ChangeSet ingestionContext descriptor could not be inspected' }
  }
  if (!contextDescriptor) return { present: false }
  if (!contextDescriptor.enumerable || !('value' in contextDescriptor)) {
    return { present: true, error: 'ChangeSet ingestionContext must be an enumerable data property' }
  }
  const context = contextDescriptor.value
  if ((typeof context !== 'object' || context === null) && typeof context !== 'function') return { present: false }
  if (utilTypes.isProxy(context)) return { present: true, error: 'Scope-bearing ingestionContext cannot be a Proxy' }
  let scopeDescriptor: PropertyDescriptor | undefined
  try {
    scopeDescriptor = Object.getOwnPropertyDescriptor(context, 'themeScope')
  } catch {
    return { present: true, error: 'Theme scope property descriptor could not be inspected' }
  }
  if (!scopeDescriptor) return { present: false }
  if (!scopeDescriptor.enumerable || !('value' in scopeDescriptor)) {
    return { present: true, error: 'ingestionContext.themeScope must be an enumerable data property' }
  }
  if (!isJsonSafeIngestionContext(context)) {
    return { present: true, error: 'Scope-bearing ingestionContext must contain JSON-safe enumerable data only' }
  }
  return { present: true, value: scopeDescriptor.value }
}

async function validateThemeScope(
  handle: KnowledgeBaseHandle,
  changeSet: KnowledgeChangeSetV04,
  manifestRevision: number,
  projectedObjects: ReadonlyMap<string, KnowledgeAssetV04>,
  errors: V04ChangeSetValidationDiagnostic[],
): Promise<void> {
  const scope = inspectThemeScopeContextV04(changeSet)
  if (!scope.present) return

  const ledger = await readThemeScopeLedgerV04(handle)
  if (ledger.status === 'failed') {
    add(errors, 'THEME_SCOPE_LEDGER_UNAVAILABLE', `Theme scope history is unavailable (${ledger.error.code}): ${ledger.error.message}`)
  }
  if (scope.error) {
    add(errors, 'THEME_SCOPE_CONTEXT_INVALID', scope.error)
    return
  }
  const previousDecisions: readonly ThemeScopeDecisionV04[] = ledger.status === 'available'
    ? ledger.themes.flatMap((theme) => theme.history.map((entry) => entry.decision))
    : []
  const validation = validateThemeScopeDecisionBatchV04(scope.value, { previousDecisions })
  if (!validation.valid) {
    add(errors, 'THEME_SCOPE_BATCH_INVALID', validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join('; '))
    return
  }

  const batch = scope.value as { readonly basedOnRevision: number; readonly themeRef: string; readonly decisions: readonly ThemeScopeDecisionV04[] }
  const ledgerRevision = ledger.status === 'available' ? ledger.knowledgeBaseRevision : undefined
  if (
    batch.basedOnRevision !== changeSet.expectedBaseRevision
    || batch.basedOnRevision !== manifestRevision
    || batch.basedOnRevision !== handle.revision
    || batch.basedOnRevision !== ledgerRevision
  ) {
    add(errors, 'THEME_SCOPE_BASE_REVISION_INVALID', 'Theme scope basedOnRevision must match the ChangeSet, mounted handle, current manifest, and readable ledger revision')
  }
  for (const decision of batch.decisions) {
    if (decision.review.status !== 'human_confirmed') {
      add(errors, 'THEME_SCOPE_REVIEW_NOT_CONFIRMED', `Theme scope decision must be human-confirmed before commit: ${decision.id}`, undefined, decision.id)
    }
  }
  const theme = projectedObjects.get(batch.themeRef) as unknown as Dict | undefined
  const lifecycle = theme && record(theme.lifecycle) ? theme.lifecycle : undefined
  if (!theme || theme.type !== 'investment_theme' || lifecycle?.status !== 'active') {
    add(errors, 'THEME_SCOPE_THEME_NOT_ACTIVE', `Theme scope batch must resolve to an active InvestmentTheme after ChangeSet operations: ${batch.themeRef}`, undefined, batch.themeRef)
  }
}

async function rawRefsInRegistry(root: string, errors: V04ChangeSetValidationDiagnostic[]): Promise<Set<string>> {
  const path = join(root, 'registry', 'raw.yaml')
  try {
    const value = parseYaml(await readFile(path, 'utf8'), path)
    if (!record(value)) { add(errors, 'V04_RAW_REGISTRY_INVALID', 'Raw registry must be an object map'); return new Set() }
    return new Set(Object.keys(value))
  } catch (error) {
    add(errors, 'V04_RAW_REGISTRY_UNREADABLE', error instanceof Error ? error.message : String(error))
    return new Set()
  }
}

function validateRawRef(ref: unknown, known: ReadonlySet<string>, errors: V04ChangeSetValidationDiagnostic[], assetId: string): void {
  if (typeof ref !== 'string' || !RAW.test(ref) || !known.has(ref)) add(errors, 'V04_RAW_REF_INVALID', `Raw reference does not resolve through the Raw registry: ${String(ref)}`, undefined, assetId)
}

function validateEvidence(objects: Iterable<KnowledgeAssetV04>, knownRawRefs: ReadonlySet<string>, errors: V04ChangeSetValidationDiagnostic[], evaluatedAt: number): void {
  const all = [...objects]
  const sourceObjects = new Map<string, Dict>(all.filter((object) => object.id.startsWith('source:')).map((object) => [object.id, object as unknown as Dict]))
  const sources = new Set<string>(sourceObjects.keys())
  const claims = new Map<string, Dict>(all.filter((object) => object.id.startsWith('claim:')).map((object) => [object.id, object as unknown as Dict]))
  const observations = new Map<string, Dict>(all.filter((object) => object.id.startsWith('observation:')).map((object) => [object.id, object as unknown as Dict]))
  const relations = new Map<string, Dict>(all.filter((object) => object.id.startsWith('relation:')).map((object) => [object.id, object as unknown as Dict]))
  const denied = new Set([...sourceObjects.entries()].filter(([, source]) => { const rights = source.rights; return record(rights) && rights.derivativeKnowledgeAllowed === false }).map(([id]) => id))
  const evidenceRefs = (value: Dict): Set<string> => {
    const refs = new Set<string>()
    if (Array.isArray(value.sourceRefs)) for (const ref of value.sourceRefs) if (typeof ref === 'string' && ref.startsWith('source:')) refs.add(ref)
    if (typeof value.sourceRef === 'string' && value.sourceRef.startsWith('source:')) refs.add(value.sourceRef)
    if (Array.isArray(value.provenance)) for (const item of value.provenance) if (record(item) && typeof item.sourceRef === 'string' && item.sourceRef.startsWith('source:')) refs.add(item.sourceRef)
    return refs
  }
  const relationAndClaimEvidence = (relation: Dict, refs: Set<string>): void => {
    const directRefs = evidenceRefs(relation)
    for (const ref of directRefs) refs.add(ref)
    const relationId = relation.id
    if (typeof relationId !== 'string') return
    const explicitSupportingRefs = Array.isArray(relation.supportingClaimRefs) ? relation.supportingClaimRefs : []
    for (const claimRef of explicitSupportingRefs) {
      const claim = typeof claimRef === 'string' ? claims.get(claimRef) : undefined
      if (claim) for (const ref of evidenceRefs(claim)) refs.add(ref)
    }
    if (directRefs.size === 0 && explicitSupportingRefs.length === 0) for (const claim of claims.values()) {
      if (Array.isArray(claim.subjectRefs) && claim.subjectRefs.includes(relationId)) for (const ref of evidenceRefs(claim)) refs.add(ref)
    }
  }
  const competitionModuleEvidenceRefs = (module: Dict): Set<string> => {
    const refs = evidenceRefs(module)
    const targetRef = module.targetEntity
    const rows = Array.isArray(module.rows) ? module.rows : []
    for (const rowValue of rows) {
      if (!record(rowValue)) continue
      const companyRef = rowValue.companyRef
      for (const relation of relations.values()) if (relation.type === 'business_exposure' && relation.sourceRef === companyRef && relation.targetRef === targetRef && record(relation.lifecycle) && relation.lifecycle.status === 'active') relationAndClaimEvidence(relation, refs)
      const cells = record(rowValue.cells) ? Object.values(rowValue.cells) : []
      for (const cell of cells) {
        if (!record(cell) || cell.status !== 'available' || !Array.isArray(cell.knowledgeRefs)) continue
        for (const knowledgeRef of cell.knowledgeRefs) {
          if (typeof knowledgeRef !== 'string') continue
          const claim = claims.get(knowledgeRef)
          if (claim) { for (const ref of evidenceRefs(claim)) refs.add(ref); continue }
          const observation = observations.get(knowledgeRef)
          if (observation) { for (const ref of evidenceRefs(observation)) refs.add(ref); continue }
          const relation = relations.get(knowledgeRef)
          if (relation) relationAndClaimEvidence(relation, refs)
        }
      }
    }
    return refs
  }
  for (const object of all) {
    const value = object as unknown as Dict
    if (object.id.startsWith('source:')) for (const ref of Array.isArray(value.rawRefs) ? value.rawRefs : []) validateRawRef(ref, knownRawRefs, errors, object.id)
    if (object.id.startsWith('claim:')) {
      if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) add(errors, 'V04_SOURCE_REFERENCE_REQUIRED', 'Claim must resolve at least one Source reference', undefined, object.id)
      else for (const ref of value.sourceRefs as unknown[]) if (typeof ref !== 'string' || !sources.has(ref as string)) add(errors, 'V04_SOURCE_REFERENCE_INVALID', `Claim sourceRef does not resolve: ${String(ref)}`, undefined, object.id)
      if (!Array.isArray(value.provenance) || value.provenance.length === 0) add(errors, 'V04_RAW_PROVENANCE_REQUIRED', 'Claim must contain Raw-backed provenance', undefined, object.id)
      else for (const item of value.provenance as unknown[]) if (!record(item)) add(errors, 'V04_PROVENANCE_INVALID', 'Claim provenance entry must be an object', undefined, object.id); else { if (typeof item.sourceRef !== 'string' || !sources.has(item.sourceRef as string)) add(errors, 'V04_PROVENANCE_SOURCE_INVALID', 'Claim provenance sourceRef does not resolve', undefined, object.id); validateRawRef(item.rawRef, knownRawRefs, errors, object.id) }
    }
    if (object.id.startsWith('event:')) { if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) add(errors, 'V04_SOURCE_REFERENCE_REQUIRED', 'Event must resolve at least one Source reference', undefined, object.id); else for (const ref of value.sourceRefs as unknown[]) if (typeof ref !== 'string' || !sources.has(ref)) add(errors, 'V04_SOURCE_REFERENCE_INVALID', `Event sourceRef does not resolve: ${String(ref)}`, undefined, object.id) }
    if (object.id.startsWith('observation:')) { const type = value.observationType; const sourceRef = value.sourceRef; if ((type === 'metric' || type === 'estimate') && (typeof sourceRef !== 'string' || !sources.has(sourceRef))) add(errors, 'V04_SOURCE_REFERENCE_INVALID', `Observation sourceRef does not resolve: ${String(sourceRef)}`, undefined, object.id); if (Array.isArray(value.provenance)) for (const item of value.provenance as unknown[]) if (record(item)) { if (typeof item.sourceRef !== 'string' || !sources.has(item.sourceRef)) add(errors, 'V04_PROVENANCE_SOURCE_INVALID', 'Observation provenance sourceRef does not resolve', undefined, object.id); validateRawRef(item.rawRef, knownRawRefs, errors, object.id) } }
    if (object.id.startsWith('reasoning-edge:') && Array.isArray(value.sourceRefs)) for (const ref of value.sourceRefs as unknown[]) if (typeof ref !== 'string' || !sources.has(ref)) add(errors, 'V04_SOURCE_REFERENCE_INVALID', `ReasoningEdge sourceRef does not resolve: ${String(ref)}`, undefined, object.id)
    if (object.id.startsWith('event:') || object.id.startsWith('observation:') || object.id.startsWith('claim:') || object.id.startsWith('thesis:') || object.id.startsWith('reasoning-edge:')) { const refs = [...(Array.isArray(value.sourceRefs) ? value.sourceRefs : []), ...(typeof value.sourceRef === 'string' ? [value.sourceRef] : [])]; if (refs.some((item) => denied.has(item))) add(errors, 'V04_DERIVATIVE_KNOWLEDGE_DENIED', 'Source rights prohibit derived canonical Knowledge', undefined, object.id) }
    if (object.id.startsWith('module:') && value.type === 'competition') {
      for (const ref of competitionModuleEvidenceRefs(value)) {
        const source = typeof ref === 'string' ? sourceObjects.get(ref) : undefined
        if (!source) {
          add(errors, 'V04_MODULE_SOURCE_REF_INVALID', `Competition Module Source reference does not resolve: ${String(ref)}`, undefined, object.id)
          continue
        }
        const lifecycle = source.lifecycle
        const rights = source.rights
        const usagePolicy = source.usagePolicy
        const validDate = (date: unknown, before: boolean): boolean => {
          if (date === undefined || date === null) return true
          if (typeof date !== 'string') return false
          const parsed = Date.parse(date)
          return Number.isFinite(parsed) && (before ? parsed <= evaluatedAt : parsed > evaluatedAt)
        }
        const active = record(lifecycle) && lifecycle.status === 'active'
          && Number.isFinite(evaluatedAt)
          && validDate(lifecycle.validFrom, true)
          && validDate(lifecycle.validUntil, false)
          && record(rights) && validDate(rights.expiresAt, false)
        const policyAllowsDerivedKnowledge = active
          && record(rights)
          && (rights.accessScope === 'public' || rights.accessScope === 'authenticated')
          && rights.retentionAllowed === true
          && rights.aiProcessingAllowed === true
          && rights.derivativeKnowledgeAllowed === true
          && record(usagePolicy)
          && usagePolicy.mode === 'personal_noncommercial_research'
          && usagePolicy.retainRaw === true
          && usagePolicy.allowAiProcessing === true
          && usagePolicy.allowDerivedKnowledge === true
        if (!policyAllowsDerivedKnowledge) add(errors, 'V04_MODULE_SOURCE_POLICY_INELIGIBLE', `Competition Module Source is inactive, expired, or does not permit derived knowledge: ${String(ref)}`, undefined, object.id)
        const rawRefs = source.rawRefs
        if (!Array.isArray(rawRefs) || rawRefs.length === 0) add(errors, 'V04_MODULE_SOURCE_RAW_REQUIRED', `Competition Module Source must resolve at least one registered Raw reference: ${String(ref)}`, undefined, object.id)
        else for (const rawRef of rawRefs) if (typeof rawRef !== 'string' || !RAW.test(rawRef) || !knownRawRefs.has(rawRef)) add(errors, 'V04_MODULE_SOURCE_RAW_INVALID', `Competition Module Source Raw reference does not resolve through the Raw registry: ${String(rawRef)}`, undefined, object.id)
      }
    }
  }
}

function validateNewThesisClaim(operation: KnowledgeOperationV04, errors: V04ChangeSetValidationDiagnostic[]): void {
  const object = operation.type === 'create' ? operation.object : operation.object
  if (!object || typeof object.id !== 'string') return
  if (object.id.startsWith('claim:') && (object as unknown as Dict).claimType === 'thesis') add(errors, 'V04_LEGACY_THESIS_CLAIM_WRITE', 'New writes must use first-class Thesis objects; legacy Thesis Claims are read/migration compatibility only', operation.operationId, object.id)
}

function applyOperation(objects: Map<string, KnowledgeAssetV04>, operation: KnowledgeOperationV04, errors: V04ChangeSetValidationDiagnostic[], seenOperationIds: Set<string>, mutationTargets: Set<string>): void {
  if (typeof operation.operationId !== 'string' || !SAFE_ID.test(operation.operationId) || seenOperationIds.has(operation.operationId)) add(errors, 'V04_OPERATION_ID_INVALID', `Operation id must be unique and safe: ${String(operation.operationId)}`, operation.operationId)
  else seenOperationIds.add(operation.operationId)
  if (operation.type === 'create') {
    if (!operation.object || typeof operation.object.id !== 'string') { add(errors, 'V04_CREATE_INVALID', 'Create operation must contain a canonical object', operation.operationId); return }
    if (objects.has(operation.object.id)) add(errors, 'V04_CREATE_CONFLICT', `Create conflicts with existing canonical object: ${operation.object.id}`, operation.operationId, operation.object.id)
    else objects.set(operation.object.id, structuredClone(operation.object))
    return
  }
  if (operation.type !== 'update' || typeof operation.knowledgeId !== 'string' || !HASH.test(operation.expectedBeforeHash)) { add(errors, 'V04_UPDATE_INVALID', 'Update operation requires a target and sha256 expected-before hash', operation.operationId); return }
  if (mutationTargets.has(operation.knowledgeId)) add(errors, 'V04_DUPLICATE_TARGET_MUTATION', `Canonical target is mutated more than once: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
  mutationTargets.add(operation.knowledgeId)
  const current = objects.get(operation.knowledgeId)
  if (!current) { add(errors, 'V04_UPDATE_TARGET_INVALID', `Update target does not exist: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId); return }
  if (hashKnowledgeObject(current) !== operation.expectedBeforeHash) add(errors, 'V04_EXPECTED_HASH_MISMATCH', `Expected-before hash does not match: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
  if (!operation.object || operation.object.id !== operation.knowledgeId || kindForKnowledgeV04(operation.object) !== kindForKnowledgeV04(current)) add(errors, 'V04_UPDATE_IDENTITY_INVALID', `Update object identity or kind does not match: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
  else objects.set(operation.knowledgeId, structuredClone(operation.object))
}

export async function validateKnowledgeChangeSetV04(handle: KnowledgeBaseHandle, changeSet: KnowledgeChangeSetV04, options: V04ChangeSetValidationOptions = {}): Promise<V04ChangeSetValidationResult> {
  const errors: V04ChangeSetValidationDiagnostic[] = []
  const mode = options.mode ?? 'commit'
  const validatedAt = options.now?.() ?? new Date().toISOString()
  if (!handle || handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1') add(errors, 'V04_HANDLE_VERSION_INVALID', 'ChangeSet validation requires a Schema 0.4 / Storage Format 1 handle')
  if (mode !== 'commit' && mode !== 'dry_run') add(errors, 'V04_MODE_INVALID', `Unknown validation mode: ${mode}`)
  if (mode === 'commit' && (!handle.writable || handle.status !== 'active')) add(errors, 'V04_HANDLE_NOT_WRITABLE', 'Commit validation requires an active writable Knowledge Base')
  if (!record(changeSet)) { add(errors, 'V04_CHANGESET_INVALID', 'ChangeSet must be an object'); return { report: { status: 'failed', errors } } }
  if (changeSet.schemaVersion !== '0.4' || changeSet.storageFormatVersion !== '1') add(errors, 'V04_VERSION_INVALID', 'ChangeSet must target Schema 0.4 / Storage 1')
  if (!SAFE_ID.test(changeSet.changeSetId) || !SAFE_ID.test(changeSet.workflowRunId)) add(errors, 'V04_ID_INVALID', 'ChangeSet and workflowRunId must use safe identifiers')
  let manifest
  try { manifest = await loadKnowledgeBaseManifest(handle.rootRef) } catch (error) { add(errors, 'V04_MANIFEST_INVALID', error instanceof Error ? error.message : String(error)); return { report: { status: 'failed', errors } } }
  if (manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1') add(errors, 'V04_MANIFEST_VERSION_INVALID', 'Mounted manifest is not Schema 0.4 / Storage 1')
  if (changeSet.knowledgeBaseId !== handle.knowledgeBaseId || changeSet.knowledgeBaseId !== manifest.knowledgeBaseId) add(errors, 'V04_KB_ID_INVALID', 'ChangeSet Knowledge Base identity does not match the mounted handle')
  if (changeSet.expectedBaseRevision !== handle.revision || changeSet.expectedBaseRevision !== manifest.revision) add(errors, 'V04_BASE_REVISION_INVALID', 'ChangeSet expectedBaseRevision does not match the mounted revision')
  if (!Array.isArray(changeSet.operations)) add(errors, 'V04_OPERATIONS_INVALID', 'ChangeSet operations must be an array')
  const knownRawRefs = await rawRefsInRegistry(handle.rootRef, errors)
  for (const rawRef of knownRawRefs) if (RAW.test(rawRef)) { try { await verifyRaw(handle, rawRef) } catch (error) { add(errors, 'V04_RAW_INTEGRITY_INVALID', error instanceof Error ? error.message : String(error), undefined, rawRef) } }
  let assets
  try { assets = await readCanonicalV04Assets(handle.rootRef) } catch (error) { add(errors, 'V04_CANONICAL_REGISTRY_INVALID', error instanceof Error ? error.message : String(error)); return { report: { status: 'failed', errors } } }
  const objects = new Map<string, KnowledgeAssetV04>(assets.objects.map((item) => [item.value.id, structuredClone(item.value)]))
  const seenOperationIds = new Set<string>()
  const mutationTargets = new Set<string>()
  for (const operation of Array.isArray(changeSet.operations) ? changeSet.operations : []) if (record(operation)) { validateNewThesisClaim(operation as KnowledgeOperationV04, errors); applyOperation(objects, operation as KnowledgeOperationV04, errors, seenOperationIds, mutationTargets) } else add(errors, 'V04_OPERATION_INVALID', 'Operation must be an object')
  try { assertKnowledgeV04Objects([...objects.values()]) } catch (error) { add(errors, 'V04_CANONICAL_INVALID', error instanceof Error ? error.message : String(error)) }
  validateEvidence(objects.values(), knownRawRefs, errors, Date.parse(validatedAt))
  await validateThemeScope(handle, changeSet, manifest.revision, objects, errors)
  const report = { status: errors.length === 0 ? 'passed' as const : 'failed' as const, errors }
  if (report.status === 'failed' || mode === 'dry_run') return { report }
  let changeSetSnapshot: KnowledgeChangeSetV04
  let changeSetHash: string
  try {
    changeSetSnapshot = structuredClone(changeSet)
    changeSetHash = hashKnowledgeObject(changeSetSnapshot)
  } catch (error) {
    add(errors, 'V04_CHANGESET_SERIALIZATION_INVALID', error instanceof Error ? error.message : String(error))
    return { report: { status: 'failed', errors } }
  }
  const validatedChangeSet = Object.freeze({ changeSet: changeSetSnapshot, knowledgeBaseId: changeSet.knowledgeBaseId, schemaVersion: '0.4' as const, baseRevision: changeSet.expectedBaseRevision, changeSetId: changeSet.changeSetId, changeSetHash, validatedAt })
  issuedReceipts.add(validatedChangeSet)
  return { report, validatedChangeSet }
}

export async function validateKnowledgeBaseV04State(rootRef: string): Promise<V04ChangeSetValidationReport> {
  const errors: V04ChangeSetValidationDiagnostic[] = []
  let handle: KnowledgeBaseHandle
  try {
    const { KnowledgeBaseRegistry } = await import('../registry/registry.ts')
    handle = await new KnowledgeBaseRegistry().mount(rootRef)
  } catch (error) {
    add(errors, 'V04_STATE_HANDLE_INVALID', error instanceof Error ? error.message : String(error))
    return { status: 'failed', errors }
  }
  const knownRawRefs = await rawRefsInRegistry(handle.rootRef, errors)
  for (const rawRef of knownRawRefs) if (RAW.test(rawRef)) { try { await verifyRaw(handle, rawRef) } catch (error) { add(errors, 'V04_RAW_INTEGRITY_INVALID', error instanceof Error ? error.message : String(error), undefined, rawRef) } }
  try {
    const assets = await readCanonicalV04Assets(handle.rootRef)
    try { assertKnowledgeV04Objects(assets.objects.map((item) => item.value)) } catch (error) { add(errors, 'V04_CANONICAL_INVALID', error instanceof Error ? error.message : String(error)) }
    validateEvidence(assets.objects.map((item) => item.value), knownRawRefs, errors, Date.now())
  } catch (error) {
    add(errors, 'V04_CANONICAL_REGISTRY_INVALID', error instanceof Error ? error.message : String(error))
  }
  return { status: errors.length === 0 ? 'passed' : 'failed', errors }
}
