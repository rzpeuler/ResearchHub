import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import type { KnowledgeChangeSetV03, ValidatedKnowledgeChangeSetV03 } from '../../schemas/knowledge/v03/mutation.ts'
import { CanonicalV03KnowledgeLoader } from '../../shared/knowledge-base/canonical-v03-loader.ts'
import type { KnowledgeBaseHandle } from '../../shared/knowledge-base/handle.ts'
import { hashKnowledgeObject } from '../../shared/knowledge-base/canonical-hash.ts'
import { parseYaml } from '../../shared/knowledge-base/yaml.ts'
import type { ChangeSetValidationOptions, ChangeSetValidationResultV03, ValidationDiagnostic, ValidationReport } from './types.ts'

type Dict = Record<string, unknown>
type Kind = 'theme_group' | 'entity' | 'relation' | 'claim' | 'module' | 'source'
type Current = { kind: Kind; object: Dict }

const namespaces: Record<Kind, string> = {
  theme_group: 'theme-group:', entity: 'entity:', relation: 'relation:', claim: 'claim:', module: 'module:', source: 'source:',
}
const canonicalFields: Record<Kind, readonly string[]> = {
  theme_group: KNOWLEDGE_SCHEMA_V03.themeGroup.fields,
  entity: KNOWLEDGE_SCHEMA_V03.entity.commonFields,
  relation: KNOWLEDGE_SCHEMA_V03.relation.commonFields,
  claim: KNOWLEDGE_SCHEMA_V03.claim.fields,
  module: KNOWLEDGE_SCHEMA_V03.module.fields,
  source: KNOWLEDGE_SCHEMA_V03.source.fields,
}
const logicalId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const rawPattern = /^raw-sha256-[0-9a-f]{64}$/

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function enumValue(value: unknown, values: readonly unknown[]): boolean { return values.includes(value) }
function mergeRefs(current: unknown, additions: string[]): string[] { return [...new Set([...(Array.isArray(current) ? current.filter((ref): ref is string => typeof ref === 'string') : []), ...additions])].sort() }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
function add(errors: ValidationDiagnostic[], code: string, message: string, operationId?: string, assetId?: string): void { errors.push({ code, severity: 'error', message, operationId, assetId }) }
function report(errors: ValidationDiagnostic[], scope: ValidationReport['scope'] = 'all'): ValidationReport { return { status: errors.length === 0 ? 'passed' : 'failed', errors, warnings: [], info: [], timestamp: new Date().toISOString(), scope } }
function kindOf(value: Dict): Kind | undefined {
  if (typeof value.id !== 'string') return undefined
  for (const kind of Object.keys(namespaces) as Kind[]) if (value.id.startsWith(namespaces[kind])) return kind
  return undefined
}
function entityFields(value: Dict): readonly string[] {
  const subtypeFields = value.type === 'investment_theme'
    ? [...KNOWLEDGE_SCHEMA_V03.entity.investmentTheme.fields]
    : value.type === 'company'
      ? [...KNOWLEDGE_SCHEMA_V03.entity.company.optionalFields]
      : []
  return [...canonicalFields.entity, ...subtypeFields]
}
function validId(value: Dict, kind: Kind): boolean {
  if (typeof value.id !== 'string' || !value.id.startsWith(namespaces[kind])) return false
  return logicalId.test(value.id.slice(namespaces[kind].length))
}
function validateId(value: Dict, kind: Kind, errors: ValidationDiagnostic[], operationId?: string): void {
  if (!validId(value, kind)) add(errors, 'V03_ID_NAMESPACE', `ID must use the ${kind} namespace and a safe local identifier`, operationId, typeof value.id === 'string' ? value.id : undefined)
}
function validateThemeGroup(value: Dict, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, canonicalFields.theme_group, errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.themeGroup.requiredFields, errors, operationId, id); validateId(value, 'theme_group', errors, operationId); lifecycle(value.lifecycle, errors, operationId, id)
  if (typeof value.name !== 'string' || value.name.trim() === '') add(errors, 'V03_FIELD_TYPE', 'ThemeGroup name must be non-empty', operationId, id)
  if (!Array.isArray(value.aliases) || value.aliases.some((entry) => typeof entry !== 'string')) add(errors, 'V03_FIELD_TYPE', 'ThemeGroup aliases must be a string array', operationId, id)
}
function objectMap(assets: Awaited<ReturnType<CanonicalV03KnowledgeLoader['readAssets']>>): Map<string, Current> {
  const entries: Array<[Kind, Array<{ value: object }>]> = [
    ['theme_group', assets.themeGroups], ['entity', assets.entities], ['relation', assets.relations], ['claim', assets.claims], ['module', assets.modules], ['source', assets.sources],
  ]
  return new Map(entries.flatMap(([kind, values]) => values.map((asset) => { const value = asset.value as Dict; return [String(value.id), { kind, object: value }] as [string, Current] })))
}
function requiredFields(value: Dict, fields: readonly string[], errors: ValidationDiagnostic[], operationId?: string, assetId?: string): void {
  for (const field of fields) if (!(field in value)) add(errors, 'V03_REQUIRED_FIELD_MISSING', `Required field is missing: ${field}`, operationId, assetId)
}
function exactFields(value: Dict, fields: readonly string[], errors: ValidationDiagnostic[], operationId?: string, assetId?: string): void {
  const allowed = new Set(fields)
  for (const field of Object.keys(value)) if (!allowed.has(field)) add(errors, 'V03_UNKNOWN_FIELD', `Field is not declared by Schema 0.3: ${field}`, operationId, assetId)
}
function lifecycle(value: unknown, errors: ValidationDiagnostic[], operationId?: string, assetId?: string): void {
  if (!isRecord(value) || !enumValue(value.status, KNOWLEDGE_SCHEMA_V03.lifecycle.values)) add(errors, 'V03_LIFECYCLE_INVALID', 'Lifecycle is invalid', operationId, assetId)
}
function sourceRefs(value: Dict, sources: Set<string>, errors: ValidationDiagnostic[], operationId?: string, assetId?: string): void {
  if (value.sourceRefs === undefined) return
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.some((ref) => typeof ref !== 'string' || !sources.has(ref))) add(errors, 'V03_SOURCE_REF_INVALID', 'sourceRefs must resolve to supplied Source objects', operationId, assetId)
}
function validateSource(value: Dict, rawRefs: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, canonicalFields.source, errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.source.requiredFields, errors, operationId, id)
  validateId(value, 'source', errors, operationId)
  if (!enumValue(value.sourceType, KNOWLEDGE_SCHEMA_V03.source.types)) add(errors, 'V03_ENUM_INVALID', 'Source sourceType is invalid', operationId, id)
  if (value.sourceReliability !== undefined && !enumValue(value.sourceReliability, KNOWLEDGE_SCHEMA_V03.source.reliabilities)) add(errors, 'V03_ENUM_INVALID', 'Source sourceReliability is invalid', operationId, id)
  if (value.rawRefs !== undefined && (!Array.isArray(value.rawRefs) || value.rawRefs.some((ref) => typeof ref !== 'string' || !rawRefs.has(ref)))) add(errors, 'V03_RAW_REF_INVALID', 'Source rawRefs must resolve through registry/raw.yaml', operationId, id)
}
function entityType(id: string, objects: Map<string, Current>): string | undefined { return objects.get(id)?.kind === 'entity' ? String(objects.get(id)?.object.type) : undefined }
function validateEntity(value: Dict, objects: Map<string, Current>, taxonomyRefs: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, entityFields(value), errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.entity.requiredFields, errors, operationId, id); validateId(value, 'entity', errors, operationId)
  if (!enumValue(value.type, KNOWLEDGE_SCHEMA_V03.entity.types)) add(errors, 'V03_ENUM_INVALID', 'Entity type is invalid', operationId, id)
  lifecycle(value.lifecycle, errors, operationId, id)
  if (value.taxonomyRefs !== undefined && (!Array.isArray(value.taxonomyRefs) || value.taxonomyRefs.some((ref) => typeof ref !== 'string' || !taxonomyRefs.has(ref)))) add(errors, 'V03_TAXONOMY_REF_INVALID', 'taxonomyRefs must resolve to supplied Reference Taxonomy items', operationId, id)
  if (value.type === 'investment_theme') {
    if (typeof value.themeGroupRef !== 'string' || objects.get(value.themeGroupRef)?.kind !== 'theme_group') add(errors, 'V03_THEME_GROUP_REF_INVALID', 'InvestmentTheme themeGroupRef must resolve to a ThemeGroup', operationId, id)
  }
}
function finite01(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
function validateAttributes(type: string, attributes: unknown, errors: ValidationDiagnostic[], operationId?: string, assetId?: string): void {
  const definition = (KNOWLEDGE_SCHEMA_V03.relation.definitions as Record<string, Dict>)[type]
  if (!definition) return
  const declared = isRecord(definition.attributes) ? definition.attributes : undefined
  if (attributes === undefined) return
  if (!isRecord(attributes)) { add(errors, 'V03_RELATION_ATTRIBUTE_INVALID', 'Relation attributes must be an object', operationId, assetId); return }
  if (!declared) { if (Object.keys(attributes).length > 0) add(errors, 'V03_RELATION_ATTRIBUTE_INVALID', 'Relation type does not declare attributes', operationId, assetId); return }
  for (const [field, value] of Object.entries(attributes)) {
    if (!(field in declared)) { add(errors, 'V03_RELATION_ATTRIBUTE_INVALID', `Undeclared relation attribute: ${field}`, operationId, assetId); continue }
    if (type === 'business_exposure' && field === 'financialContribution') {
      if (value !== null && (!isRecord(value) || Object.keys(value).some((child) => !['period', 'revenueAmount', 'revenueShare', 'profitAmount', 'profitShare', 'currency', 'separatelyReported'].includes(child)) || (value.revenueShare !== undefined && value.revenueShare !== null && !finite01(value.revenueShare)) || (value.profitShare !== undefined && value.profitShare !== null && !finite01(value.profitShare)))) add(errors, 'V03_RELATION_ATTRIBUTE_INVALID', 'Business Exposure financialContribution is invalid', operationId, assetId)
    } else if (Array.isArray(declared[field]) && !enumValue(value, declared[field] as unknown[])) add(errors, 'V03_ENUM_INVALID', `Relation attribute ${field} is invalid`, operationId, assetId)
    else if (type === 'owns_stake_in' && field === 'ownershipPct' && value !== null && !finite01(value)) add(errors, 'V03_NUMERIC_CONSTRAINT', 'ownershipPct must be between 0 and 1 or null', operationId, assetId)
  }
}
function validateRelation(value: Dict, objects: Map<string, Current>, sources: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, canonicalFields.relation, errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.relation.requiredFields, errors, operationId, id); validateId(value, 'relation', errors, operationId)
  const definition = (KNOWLEDGE_SCHEMA_V03.relation.definitions as Record<string, Dict>)[String(value.type)]
  if (!definition) add(errors, 'V03_ENUM_INVALID', 'Relation type is invalid', operationId, id)
  const sourceType = typeof value.sourceRef === 'string' ? entityType(value.sourceRef, objects) : undefined
  const targetType = typeof value.targetRef === 'string' ? entityType(value.targetRef, objects) : undefined
  if (!sourceType || !targetType || !isRecord(definition) || !(definition.sourceTypes as unknown[]).includes(sourceType) || !(definition.targetTypes as unknown[]).includes(targetType) || (definition.endpointConstraint === 'same_entity_type_on_both_sides' && sourceType !== targetType)) add(errors, 'V03_RELATION_ENDPOINT_INVALID', 'Relation endpoints do not satisfy the canonical endpoint rule', operationId, id)
  if (value.supportingClaimRefs !== undefined && (!Array.isArray(value.supportingClaimRefs) || value.supportingClaimRefs.some((ref) => typeof ref !== 'string' || objects.get(ref)?.kind !== 'claim'))) add(errors, 'V03_CLAIM_REF_INVALID', 'supportingClaimRefs must resolve to Claim objects', operationId, id)
  if (value.contextRefs !== undefined && (!Array.isArray(value.contextRefs) || value.contextRefs.some((ref) => typeof ref !== 'string' || (!objects.has(ref) && !rawPattern.test(ref))))) add(errors, 'V03_CONTEXT_REF_INVALID', 'contextRefs must resolve to canonical objects or Raw refs', operationId, id)
  validateAttributes(String(value.type), value.attributes, errors, operationId, id); sourceRefs(value, sources, errors, operationId, id)
}
function sourceOwnsRaw(objects: Map<string, Current>, sourceRef: string, rawRef: string): boolean {
  const source = objects.get(sourceRef)
  return source?.kind === 'source' && Array.isArray(source.object.rawRefs) && source.object.rawRefs.includes(rawRef)
}
function validateClaim(value: Dict, objects: Map<string, Current>, sources: Set<string>, rawRefs: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, canonicalFields.claim, errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.claim.requiredFields, errors, operationId, id); validateId(value, 'claim', errors, operationId)
  if (!enumValue(value.claimType, KNOWLEDGE_SCHEMA_V03.claim.types)) add(errors, 'V03_ENUM_INVALID', 'Claim claimType is invalid', operationId, id)
  if (typeof value.statement !== 'string' || value.statement.trim() === '') add(errors, 'V03_FIELD_TYPE', 'Claim statement must be non-empty', operationId, id)
  if (!Array.isArray(value.subjectRefs) || value.subjectRefs.some((ref) => typeof ref !== 'string' || !['entity', 'relation'].includes(objects.get(ref)?.kind ?? ''))) add(errors, 'V03_CLAIM_SUBJECT_INVALID', 'Claim subjectRefs must resolve to Entity or Relation objects', operationId, id)
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.some((ref) => typeof ref !== 'string' || !sources.has(ref))) add(errors, 'V03_SOURCE_REF_INVALID', 'Claim sourceRefs must resolve to Source objects', operationId, id)
  lifecycle(value.lifecycle, errors, operationId, id)
  if (value.confidence !== undefined && !finite01(value.confidence)) add(errors, 'V03_NUMERIC_CONSTRAINT', 'Claim confidence must be between 0 and 1', operationId, id)
  if (value.primarySubjectRef !== undefined && value.primarySubjectRef !== null && !['entity', 'relation'].includes(objects.get(String(value.primarySubjectRef))?.kind ?? '')) add(errors, 'V03_CLAIM_SUBJECT_INVALID', 'Claim primarySubjectRef must resolve to Entity or Relation', operationId, id)
  if (value.structuredValue !== undefined) {
    if (!isRecord(value.structuredValue) || typeof value.structuredValue.metric !== 'string' || !('value' in value.structuredValue) || !('unit' in value.structuredValue) || !('comparator' in value.structuredValue) || (value.structuredValue.comparator !== null && !enumValue(value.structuredValue.comparator, KNOWLEDGE_SCHEMA_V03.claim.comparators))) add(errors, 'V03_STRUCTURED_VALUE_INVALID', 'Claim structuredValue is invalid', operationId, id)
  }
  for (const field of ['supersedes', 'supersededBy'] as const) if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some((ref) => typeof ref !== 'string' || objects.get(ref)?.kind !== 'claim'))) add(errors, 'V03_CLAIM_REF_INVALID', `Claim ${field} must resolve to Claim objects`, operationId, id)
  if (value.provenance !== undefined && (!Array.isArray(value.provenance) || value.provenance.some((entry) => !isRecord(entry) || typeof entry.sourceRef !== 'string' || !sources.has(entry.sourceRef) || typeof entry.rawRef !== 'string' || !rawRefs.has(entry.rawRef) || !rawPattern.test(entry.rawRef) || !sourceOwnsRaw(objects, entry.sourceRef, entry.rawRef)))) add(errors, 'V03_PROVENANCE_INVALID', 'Claim provenance is invalid', operationId, id)
}
function validateModule(value: Dict, objects: Map<string, Current>, sources: Set<string>, errors: ValidationDiagnostic[], operationId?: string): void {
  const id = String(value.id); exactFields(value, canonicalFields.module, errors, operationId, id); requiredFields(value, KNOWLEDGE_SCHEMA_V03.module.requiredFields, errors, operationId, id); validateId(value, 'module', errors, operationId)
  if (!enumValue(value.type, KNOWLEDGE_SCHEMA_V03.module.types)) add(errors, 'V03_ENUM_INVALID', 'Module type is invalid', operationId, id)
  if (value.targetEntity !== undefined && value.targetEntity !== null && objects.get(String(value.targetEntity))?.kind !== 'entity') add(errors, 'V03_MODULE_TARGET_INVALID', 'Module targetEntity must resolve to an Entity', operationId, id)
  sourceRefs(value, sources, errors, operationId, id)
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

export async function validateKnowledgeChangeSetV03(handle: KnowledgeBaseHandle, changeSet: KnowledgeChangeSetV03, options: ChangeSetValidationOptions = {}): Promise<ChangeSetValidationResultV03> {
  const errors: ValidationDiagnostic[] = []; const mode = options.mode ?? 'commit'; const dryRun = mode === 'dry_run'
  if (handle.schemaVersion !== '0.3' || handle.storageFormatVersion !== '1') add(errors, 'WRITE_NOT_SUPPORTED', 'v0.3 ChangeSets require a Schema 0.3 / Storage 1 handle')
  if (!dryRun && (handle.status !== 'active' || !handle.writable)) add(errors, 'WRITE_NOT_SUPPORTED', 'Commit requires an active writable Schema 0.3 Knowledge Base')
  if (changeSet.schemaVersion !== '0.3' || changeSet.storageFormatVersion !== '1') add(errors, 'CHANGESET_SCHEMA_MISMATCH', 'ChangeSet schema must be 0.3 / Storage 1')
  if (changeSet.knowledgeBaseId !== handle.knowledgeBaseId) add(errors, 'CHANGESET_KB_MISMATCH', 'ChangeSet Knowledge Base does not match handle')
  if (!Number.isInteger(changeSet.expectedBaseRevision) || changeSet.expectedBaseRevision !== handle.revision) add(errors, 'STALE_BASE_REVISION', 'ChangeSet base revision does not match handle')
  if (!logicalId.test(changeSet.changeSetId) || changeSet.changeSetId.includes('..')) add(errors, 'CHANGESET_ID', 'ChangeSet ID is unsafe')
  if (!logicalId.test(changeSet.workflowRunId) || changeSet.workflowRunId.includes('..')) add(errors, 'WORKFLOW_RUN_ID', 'Workflow Run ID is unsafe')
  let assets: Awaited<ReturnType<CanonicalV03KnowledgeLoader['readAssets']>>
  try { assets = await new CanonicalV03KnowledgeLoader(handle.rootRef).readAssets() } catch (error) { add(errors, 'CHANGESET_BASE_READ_ERROR', error instanceof Error ? error.message : String(error)); return { report: report(errors) } }
  const objects = objectMap(assets); const sources = new Set<string>(assets.sources.map((asset) => String(asset.value.id))); const rawRefs = new Set<string>(options.virtualRawRefs ?? [])
  try { const raw = parseYaml(await readFile(join(handle.rootRef, 'registry', 'raw.yaml'), 'utf8'), join(handle.rootRef, 'registry', 'raw.yaml')); if (isRecord(raw)) for (const id of Object.keys(raw)) rawRefs.add(id) } catch { /* no raw records is valid until provenance is required */ }
  const taxonomyRefs = await readTaxonomyRefs(handle.rootRef)
  const operationIds = new Set<string>(); const sourceCreates = new Set<string>(); const objectCreates = new Set<string>(); const mutationTargets = new Set<string>()
  for (const operation of changeSet.sourceOperations ?? []) {
    if (!logicalId.test(operation.operationId) || operationIds.has(operation.operationId)) add(errors, 'OPERATION_ID', `Invalid or duplicate operation ID: ${operation.operationId}`, operation.operationId)
    operationIds.add(operation.operationId)
    if (operation.type === 'source_create') {
      const value = operation.source as unknown as Dict; const id = typeof value.id === 'string' ? value.id : ''
      if (sourceCreates.has(id) || objects.has(id)) add(errors, 'ID_COLLISION', `Source already exists: ${id}`, operation.operationId, id)
      sourceCreates.add(id); objects.set(id, { kind: 'source', object: value }); validateSource(value, rawRefs, errors, operation.operationId)
    } else {
      if (!/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, operation.sourceId)
      if (!sources.has(operation.sourceId) && !sourceCreates.has(operation.sourceId)) add(errors, 'MISSING_SOURCE', `Source does not exist: ${operation.sourceId}`, operation.operationId)
      if (!mutationTargets.has(operation.sourceId)) mutationTargets.add(operation.sourceId); else add(errors, 'DUPLICATE_TARGET_MUTATION', `Source is mutated more than once: ${operation.sourceId}`, operation.operationId)
      if (operation.addRawRefs?.some((ref) => !rawRefs.has(ref))) add(errors, 'V03_RAW_REF_INVALID', 'Source merge references an unknown Raw ref', operation.operationId, operation.sourceId)
      const current = objects.get(operation.sourceId)
      if (current?.kind === 'source') {
        if (/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash) && hashKnowledgeObject(current.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Source target hash does not match the validation snapshot: ${operation.sourceId}`, operation.operationId, operation.sourceId)
        const merged = structuredClone(current.object); if (operation.addRawRefs) merged.rawRefs = mergeRefs(merged.rawRefs, operation.addRawRefs); Object.assign(merged, operation.metadataPatch ?? {}); validateSource(merged, rawRefs, errors, operation.operationId); objects.set(operation.sourceId, { kind: 'source', object: merged })
      }
    }
  }
  for (const operation of changeSet.knowledgeOperations ?? []) {
    if (!logicalId.test(operation.operationId) || operationIds.has(operation.operationId)) add(errors, 'OPERATION_ID', `Invalid or duplicate operation ID: ${operation.operationId}`, operation.operationId)
    operationIds.add(operation.operationId)
    if (operation.type === 'create') {
      const value = operation.object as unknown as Dict; const id = typeof value.id === 'string' ? value.id : ''; const kind = kindOf(value)
      if (!kind || kind === 'source') add(errors, 'OBJECT_KIND_INVALID', 'Create object must be a non-Source canonical object', operation.operationId, id)
      if (objects.has(id) || objectCreates.has(id)) add(errors, 'ID_COLLISION', `Knowledge object already exists: ${id}`, operation.operationId, id)
      if (kind) { objectCreates.add(id); objects.set(id, { kind, object: value }); if (kind === 'theme_group') validateThemeGroup(value, errors, operation.operationId); if (kind === 'entity') validateEntity(value, objects, taxonomyRefs, errors, operation.operationId); if (kind === 'relation') validateRelation(value, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId); if (kind === 'claim') validateClaim(value, objects, new Set([...sources, ...sourceCreates]), rawRefs, errors, operation.operationId); if (kind === 'module') validateModule(value, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId) }
    } else {
      if (mutationTargets.has(operation.knowledgeId)) add(errors, 'DUPLICATE_TARGET_MUTATION', `Object is mutated more than once: ${operation.knowledgeId}`, operation.operationId)
      mutationTargets.add(operation.knowledgeId)
      if (operation.type === 'supersede') {
      if (!/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, operation.knowledgeId)
      const target = objects.get(operation.knowledgeId); const replacement = operation.replacement as unknown as Dict; const kind = kindOf(replacement)
      if (!target || target.kind !== 'claim' || kind !== 'claim') add(errors, 'ILLEGAL_SUPERSEDE', 'Only Claim supersession is supported in Schema 0.3', operation.operationId, operation.knowledgeId)
      else if (/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
      else { if (objects.has(String(replacement.id))) add(errors, 'ID_COLLISION', `Supersede replacement already exists: ${replacement.id}`, operation.operationId, String(replacement.id)); const oldClaim = structuredClone(target.object); oldClaim.lifecycle = { ...(isRecord(oldClaim.lifecycle) ? oldClaim.lifecycle : {}), status: 'superseded' }; oldClaim.supersededBy = mergeRefs(oldClaim.supersededBy, [String(replacement.id)]); const nextClaim = structuredClone(replacement); nextClaim.supersedes = mergeRefs(nextClaim.supersedes, [operation.knowledgeId]); objects.set(operation.knowledgeId, { kind: 'claim', object: oldClaim }); objects.set(String(replacement.id), { kind: 'claim', object: nextClaim }); validateClaim(oldClaim, objects, new Set([...sources, ...sourceCreates]), rawRefs, errors, operation.operationId); validateClaim(nextClaim, objects, new Set([...sources, ...sourceCreates]), rawRefs, errors, operation.operationId) }
      } else if (operation.type === 'update') {
      if (!/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, operation.knowledgeId)
      const target = objects.get(operation.knowledgeId); const replacement = operation.object as unknown as Dict; const kind = kindOf(replacement)
      if (!target || kind !== target.kind || replacement.id !== operation.knowledgeId) add(errors, 'UPDATE_KIND', 'Update must preserve canonical ID and object kind', operation.operationId, operation.knowledgeId)
      else if (/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
      else { objects.set(operation.knowledgeId, { kind: target.kind, object: replacement }); if (kind === 'theme_group') validateThemeGroup(replacement, errors, operation.operationId); if (kind === 'entity') validateEntity(replacement, objects, taxonomyRefs, errors, operation.operationId); if (kind === 'relation') validateRelation(replacement, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId); if (kind === 'claim') validateClaim(replacement, objects, new Set([...sources, ...sourceCreates]), rawRefs, errors, operation.operationId); if (kind === 'module') validateModule(replacement, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId) }
      } else {
      if (!/^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash)) add(errors, 'EXPECTED_BEFORE_HASH', 'Mutation expectedBeforeHash must be a canonical SHA-256 hash', operation.operationId, operation.knowledgeId)
      const target = objects.get(operation.knowledgeId)
      if (!target || !['relation', 'claim', 'module'].includes(target.kind)) add(errors, 'MERGE_SOURCE_UNSUPPORTED', 'merge_source requires a canonical object with declared sourceRefs', operation.operationId, operation.knowledgeId)
      if (target && /^sha256:[0-9a-f]{64}$/.test(operation.expectedBeforeHash) && hashKnowledgeObject(target.object) !== operation.expectedBeforeHash) add(errors, 'STALE_TARGET_STATE', `Knowledge target hash does not match the validation snapshot: ${operation.knowledgeId}`, operation.operationId, operation.knowledgeId)
      if (!Array.isArray(operation.addSourceRefs) || operation.addSourceRefs.length === 0 || operation.addSourceRefs.some((ref) => !sources.has(ref) && !sourceCreates.has(ref))) add(errors, 'V03_SOURCE_REF_INVALID', 'merge_source references unknown Source objects', operation.operationId, operation.knowledgeId)
      if (target && ['relation', 'claim', 'module'].includes(target.kind)) { const merged = structuredClone(target.object); merged.sourceRefs = mergeRefs(merged.sourceRefs, operation.addSourceRefs ?? []); objects.set(operation.knowledgeId, { kind: target.kind, object: merged }); if (target.kind === 'relation') validateRelation(merged, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId); if (target.kind === 'claim') validateClaim(merged, objects, new Set([...sources, ...sourceCreates]), rawRefs, errors, operation.operationId); if (target.kind === 'module') validateModule(merged, objects, new Set([...sources, ...sourceCreates]), errors, operation.operationId) }
      }
    }
  }
  const businessPairs = new Map<string, string[]>()
  for (const current of objects.values()) if (current.kind === 'relation' && current.object.type === 'business_exposure' && isRecord(current.object.lifecycle) && current.object.lifecycle.status === 'active') {
    const pair = `${current.object.sourceRef}\u0000${current.object.targetRef}`; const ids = businessPairs.get(pair) ?? []; ids.push(String(current.object.id)); businessPairs.set(pair, ids)
  }
  for (const ids of businessPairs.values()) if (ids.length > 1) for (const id of ids) add(errors, 'V03_RELATION_CARDINALITY', 'At most one active business_exposure is allowed per Company/Industry pair', undefined, id)
  const finalReport = report(errors)
  if (finalReport.status === 'failed') return { report: finalReport }
  const clonedChangeSet = structuredClone(changeSet)
  const validatedChangeSet: ValidatedKnowledgeChangeSetV03 = deepFreeze({ changeSet: clonedChangeSet, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.3', baseRevision: handle.revision, changeSetId: changeSet.changeSetId, changeSetHash: hashKnowledgeObject(clonedChangeSet), validatedAt: new Date().toISOString() })
  return { report: finalReport, validatedChangeSet }
}
