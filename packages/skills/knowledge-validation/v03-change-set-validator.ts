import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeChangeSetV03, ValidatedKnowledgeChangeSetV03 } from '../../schemas/knowledge/v03/mutation.ts'
import { CanonicalV03KnowledgeLoader } from '../../shared/knowledge-base/canonical-v03-loader.ts'
import type { KnowledgeBaseHandle } from '../../shared/knowledge-base/handle.ts'
import { hashKnowledgeObject } from '../../shared/knowledge-base/canonical-hash.ts'
import { parseYaml } from '../../shared/knowledge-base/yaml.ts'
import { kindForV03Id, validateV03CanonicalObject, validateV03CanonicalObjects, validateV03GlobalInvariants, type V03CanonicalKind, type V03CanonicalObject } from './v03-validation-core.ts'
import type { ChangeSetValidationOptions, ChangeSetValidationResultV03, ValidationDiagnostic, ValidationReport } from './types.ts'

type Dict = Record<string, unknown>
const hashPattern = /^sha256:[0-9a-f]{64}$/

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
function add(errors: ValidationDiagnostic[], code: string, message: string, operationId?: string, assetId?: string): void { errors.push({ code, severity: 'error', message, operationId, assetId }) }
function report(errors: ValidationDiagnostic[], scope: ValidationReport['scope'] = 'all'): ValidationReport { return { status: errors.length === 0 ? 'passed' : 'failed', errors, warnings: [], info: [], timestamp: new Date().toISOString(), scope } }
function objectMap(assets: Awaited<ReturnType<CanonicalV03KnowledgeLoader['readAssets']>>): Map<string, V03CanonicalObject> {
  const entries: Array<[V03CanonicalKind, Array<{ value: object }>]> = [
    ['theme_group', assets.themeGroups], ['entity', assets.entities], ['relation', assets.relations], ['claim', assets.claims], ['module', assets.modules], ['source', assets.sources],
  ]
  return new Map(entries.flatMap(([kind, values]) => values.map((asset) => { const value = asset.value as Dict; return [String(value.id), { kind, object: value }] as [string, V03CanonicalObject] })))
}
async function listYamlFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true }); const files: string[] = []
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) files.push(...await listYamlFiles(path))
      else if (/\.(yaml|yml|json)$/i.test(entry.name)) files.push(path)
    }
    return files
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
async function readTaxonomyRefs(root: string): Promise<Set<string>> {
  const refs = new Set<string>()
  for (const path of await listYamlFiles(join(root, 'taxonomy'))) {
    try {
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(visit); return }
        if (!isRecord(value)) return
        if (typeof value.id === 'string') refs.add(value.id)
        Object.values(value).forEach(visit)
      }
      visit(parseYaml(await readFile(path, 'utf8'), path))
    } catch { /* Full V03 validation reports auxiliary parse failures separately. */ }
  }
  return refs
}
function validatePlanned(current: V03CanonicalObject, objects: Map<string, V03CanonicalObject>, rawRefs: Set<string>, taxonomyRefs: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  validateV03CanonicalObject(current, { objects, rawRefs, taxonomyRefs }, errors, { operationId, assetId: typeof current.object.id === 'string' ? current.object.id : undefined })
}
function validateRequiredSourceProvenance(source: V03CanonicalObject, required: boolean, errors: ValidationDiagnostic[], operationId?: string): void {
  if (required && (!Array.isArray(source.object.rawRefs) || source.object.rawRefs.length === 0)) add(errors, 'V03_RAW_PROVENANCE_REQUIRED', 'requiresRawProvenance=true requires every affected Source to contain at least one valid RawRef', operationId, String(source.object.id))
}

export async function validateKnowledgeChangeSetV03(handle: KnowledgeBaseHandle, changeSet: KnowledgeChangeSetV03, options: ChangeSetValidationOptions = {}): Promise<ChangeSetValidationResultV03> {
  const errors: ValidationDiagnostic[] = []; const mode = options.mode ?? 'commit'; const dryRun = mode === 'dry_run'
  if (handle.schemaVersion !== '0.3' || handle.storageFormatVersion !== '1') add(errors, 'WRITE_NOT_SUPPORTED', 'v0.3 ChangeSets require a Schema 0.3 / Storage 1 handle')
  if (!dryRun && (handle.status !== 'active' || !handle.writable)) add(errors, 'WRITE_NOT_SUPPORTED', 'Commit requires an active writable Schema 0.3 Knowledge Base')
  if (changeSet.schemaVersion !== '0.3' || changeSet.storageFormatVersion !== '1') add(errors, 'CHANGESET_SCHEMA_MISMATCH', 'ChangeSet schema must be 0.3 / Storage 1')
  if (changeSet.knowledgeBaseId !== handle.knowledgeBaseId) add(errors, 'CHANGESET_KB_MISMATCH', 'ChangeSet Knowledge Base does not match handle')
  if (!Number.isInteger(changeSet.expectedBaseRevision) || changeSet.expectedBaseRevision !== handle.revision) add(errors, 'STALE_BASE_REVISION', 'ChangeSet base revision does not match handle')
  if (typeof changeSet.requiresRawProvenance !== 'boolean') add(errors, 'CHANGESET_PROVENANCE_POLICY', 'requiresRawProvenance must be boolean')
  if (!Array.isArray(changeSet.sourceOperations) || !Array.isArray(changeSet.knowledgeOperations)) add(errors, 'CHANGESET_OPERATIONS', 'ChangeSet operation lists must be arrays')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeSet.changeSetId) || changeSet.changeSetId.includes('..')) add(errors, 'CHANGESET_ID', 'ChangeSet ID is unsafe')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeSet.workflowRunId) || changeSet.workflowRunId.includes('..')) add(errors, 'WORKFLOW_RUN_ID', 'Workflow Run ID is unsafe')
  let assets: Awaited<ReturnType<CanonicalV03KnowledgeLoader['readAssets']>>
  try { assets = await new CanonicalV03KnowledgeLoader(handle.rootRef).readAssets() } catch (error) { add(errors, 'CHANGESET_BASE_READ_ERROR', error instanceof Error ? error.message : String(error)); return { report: report(errors) } }
  const objects = objectMap(assets); const rawRefs = new Set<string>(options.virtualRawRefs ?? [])
  try { const raw = parseYaml(await readFile(join(handle.rootRef, 'registry', 'raw.yaml'), 'utf8'), join(handle.rootRef, 'registry', 'raw.yaml')); if (isRecord(raw)) for (const id of Object.keys(raw)) rawRefs.add(id) } catch { /* no raw records is valid until provenance is required */ }
  const taxonomyRefs = await readTaxonomyRefs(handle.rootRef); const operationIds = new Set<string>(); const mutationTargets = new Set<string>(); const requiresRawProvenance = changeSet.requiresRawProvenance === true
  const sourceOperations = Array.isArray(changeSet.sourceOperations) ? changeSet.sourceOperations : []; const knowledgeOperations = Array.isArray(changeSet.knowledgeOperations) ? changeSet.knowledgeOperations : []
  for (const operation of sourceOperations) {
    if (!isRecord(operation) || typeof operation.operationId !== 'string') { add(errors, 'OPERATION_ID', 'Operation must have a valid operationId'); continue }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(operation.operationId) || operationIds.has(operation.operationId)) add(errors, 'OPERATION_ID', `Invalid or duplicate operation ID: ${operation.operationId}`, operation.operationId)
    operationIds.add(operation.operationId)
    if (operation.type === 'source_create') {
      const value = operation.source as unknown as Dict; const id = typeof value?.id === 'string' ? value.id : ''
      if (objects.has(id)) add(errors, 'ID_COLLISION', `Source already exists: ${id}`, operation.operationId, id)
      const current: V03CanonicalObject = { kind: 'source', object: value }; objects.set(id, current); validatePlanned(current, objects, rawRefs, taxonomyRefs, errors, operation.operationId); validateRequiredSourceProvenance(current, requiresRawProvenance, errors, operation.operationId)
    } else if (operation.type === 'source_merge') {
      if (!hashPattern.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, operation.sourceId)
      if (mutationTargets.has(operation.sourceId)) add(errors, 'DUPLICATE_TARGET_MUTATION', `Source is mutated more than once: ${operation.sourceId}`, operation.operationId)
      mutationTargets.add(operation.sourceId)
      const target = objects.get(operation.sourceId)
      if (!target || target.kind !== 'source') add(errors, 'MISSING_SOURCE', `Source does not exist: ${operation.sourceId}`, operation.operationId)
      else {
        if (hashPattern.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Source target hash does not match the validation snapshot: ${operation.sourceId}`, operation.operationId, operation.sourceId)
        if (operation.addRawRefs?.some((ref) => !rawRefs.has(ref))) add(errors, 'V03_RAW_REF_INVALID', 'Source merge references an unknown Raw ref', operation.operationId, operation.sourceId)
        const merged = structuredClone(target.object); if (operation.addRawRefs) merged.rawRefs = [...new Set([...(Array.isArray(merged.rawRefs) ? merged.rawRefs.filter((ref): ref is string => typeof ref === 'string') : []), ...operation.addRawRefs])].sort(); Object.assign(merged, operation.metadataPatch ?? {})
        const current: V03CanonicalObject = { kind: 'source', object: merged }; objects.set(operation.sourceId, current); validatePlanned(current, objects, rawRefs, taxonomyRefs, errors, operation.operationId); validateRequiredSourceProvenance(current, requiresRawProvenance, errors, operation.operationId)
      }
    } else add(errors, 'OPERATION_TYPE', 'Unknown Source operation type', operation.operationId)
  }
  for (const operation of knowledgeOperations) {
    if (!isRecord(operation) || typeof operation.operationId !== 'string') { add(errors, 'OPERATION_ID', 'Operation must have a valid operationId'); continue }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(operation.operationId) || operationIds.has(operation.operationId)) add(errors, 'OPERATION_ID', `Invalid or duplicate operation ID: ${operation.operationId}`, operation.operationId)
    operationIds.add(operation.operationId)
    if (operation.type === 'create') {
      const value = operation.object as unknown as Dict; const id = typeof value?.id === 'string' ? value.id : ''; const kind = kindForV03Id(id)
      if (!kind || kind === 'source') add(errors, 'OBJECT_KIND_INVALID', 'Create object must be a non-Source canonical object', operation.operationId, id)
      if (objects.has(id)) add(errors, 'ID_COLLISION', `Knowledge object already exists: ${id}`, operation.operationId, id)
      if (kind && kind !== 'source') { const current: V03CanonicalObject = { kind, object: value }; objects.set(id, current); validatePlanned(current, objects, rawRefs, taxonomyRefs, errors, operation.operationId) }
    } else {
      const knowledgeId = typeof operation.knowledgeId === 'string' ? operation.knowledgeId : ''
      if (mutationTargets.has(knowledgeId)) add(errors, 'DUPLICATE_TARGET_MUTATION', `Object is mutated more than once: ${knowledgeId}`, operation.operationId)
      mutationTargets.add(knowledgeId)
      const target = objects.get(knowledgeId)
      if (operation.type === 'supersede') {
        if (!hashPattern.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, knowledgeId)
        const replacement = operation.replacement as unknown as Dict; const replacementKind = kindForV03Id(replacement?.id)
        if (!target || target.kind !== 'claim' || replacementKind !== 'claim') add(errors, 'ILLEGAL_SUPERSEDE', 'Only Claim supersession is supported in Schema 0.3', operation.operationId, knowledgeId)
        else if (hashPattern.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${knowledgeId}`, operation.operationId, knowledgeId)
        else {
          if (objects.has(String(replacement.id))) add(errors, 'ID_COLLISION', `Supersede replacement already exists: ${replacement.id}`, operation.operationId, String(replacement.id))
          const oldClaim = structuredClone(target.object); oldClaim.lifecycle = { ...(isRecord(oldClaim.lifecycle) ? oldClaim.lifecycle : {}), status: 'superseded' }; oldClaim.supersededBy = [...new Set([...(Array.isArray(oldClaim.supersededBy) ? oldClaim.supersededBy : []), String(replacement.id)])].sort()
          const nextClaim = structuredClone(replacement); nextClaim.supersedes = [...new Set([...(Array.isArray(nextClaim.supersedes) ? nextClaim.supersedes : []), knowledgeId])].sort()
          const oldCurrent: V03CanonicalObject = { kind: 'claim', object: oldClaim }; const nextCurrent: V03CanonicalObject = { kind: 'claim', object: nextClaim }; objects.set(knowledgeId, oldCurrent); objects.set(String(replacement.id), nextCurrent); validatePlanned(oldCurrent, objects, rawRefs, taxonomyRefs, errors, operation.operationId); validatePlanned(nextCurrent, objects, rawRefs, taxonomyRefs, errors, operation.operationId)
        }
      } else if (operation.type === 'update') {
        if (!hashPattern.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, knowledgeId)
        const replacement = operation.object as unknown as Dict; const replacementKind = kindForV03Id(replacement?.id)
        if (!target || replacementKind !== target.kind || replacement.id !== knowledgeId) add(errors, 'UPDATE_KIND', 'Update must preserve canonical ID and object kind', operation.operationId, knowledgeId)
        else if (/^[^:]+:[0-9a-f]{64}$/.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${knowledgeId}`, operation.operationId, knowledgeId)
        else { const current: V03CanonicalObject = { kind: target.kind, object: replacement }; objects.set(knowledgeId, current); validatePlanned(current, objects, rawRefs, taxonomyRefs, errors, operation.operationId) }
      } else if (operation.type === 'merge_source') {
        if (!/^[^:]+:[0-9a-f]{64}$/.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, knowledgeId)
        if (!target || !['relation', 'claim', 'module'].includes(target.kind)) add(errors, 'MERGE_SOURCE_UNSUPPORTED', 'merge_source requires a canonical object with declared sourceRefs', operation.operationId, knowledgeId)
        if (target && hashPattern.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${knowledgeId}`, operation.operationId, knowledgeId)
        if (!Array.isArray(operation.addSourceRefs) || operation.addSourceRefs.length === 0 || operation.addSourceRefs.some((ref) => !objects.has(ref) || objects.get(ref)?.kind !== 'source')) add(errors, 'V03_SOURCE_REF_INVALID', 'merge_source references unknown Source objects', operation.operationId, knowledgeId)
        if (target && ['relation', 'claim', 'module'].includes(target.kind)) { const merged = structuredClone(target.object); merged.sourceRefs = [...new Set([...(Array.isArray(merged.sourceRefs) ? merged.sourceRefs.filter((ref): ref is string => typeof ref === 'string') : []), ...(operation.addSourceRefs ?? [])])].sort(); const current: V03CanonicalObject = { kind: target.kind, object: merged }; objects.set(knowledgeId, current); validatePlanned(current, objects, rawRefs, taxonomyRefs, errors, operation.operationId) }
      } else add(errors, 'OPERATION_TYPE', 'Unknown Knowledge operation type', operation.operationId)
    }
  }
  const finalContext = { objects, rawRefs, taxonomyRefs }
  validateV03CanonicalObjects(objects.values(), finalContext, errors, (item) => ({ assetId: typeof item.object.id === 'string' ? item.object.id : undefined }))
  validateV03GlobalInvariants(finalContext, errors)
  const finalReport = report(errors)
  if (finalReport.status === 'failed') return { report: finalReport }
  if (dryRun) return { report: finalReport }
  const clonedChangeSet = structuredClone(changeSet)
  const validatedChangeSet: ValidatedKnowledgeChangeSetV03 = deepFreeze({ changeSet: clonedChangeSet, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', baseRevision: handle.revision, changeSetId: changeSet.changeSetId, changeSetHash: hashKnowledgeObject(clonedChangeSet), validatedAt: new Date().toISOString() })
  return { report: finalReport, validatedChangeSet }
}
