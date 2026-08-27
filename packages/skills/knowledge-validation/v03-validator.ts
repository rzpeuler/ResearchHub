import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import { parseKnowledgeBaseManifest, type KnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'
import { CanonicalV03KnowledgeLoader } from '../../shared/knowledge-base/canonical-v03-loader.ts'
import { parseYaml } from '../../shared/knowledge-base/yaml.ts'
import type { ValidationDiagnostic, ValidationScope } from './types.ts'
import type { KnowledgeAssetCollectionV03 } from '../../shared/knowledge-base/v03-types.ts'

type Dict = Record<string, unknown>
const canonicalKinds = ['theme_group', 'entity', 'relation', 'claim', 'module', 'source'] as const
const kindNamespaces: Record<(typeof canonicalKinds)[number], string> = {
  theme_group: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.themeGroup,
  entity: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.entity,
  relation: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.relation,
  claim: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.claim,
  module: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.module,
  source: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.source,
}

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function arrayOfStrings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function error(code: string, message: string, assetId?: string, filePath?: string): ValidationDiagnostic { return { code, severity: 'error', message, ...(assetId ? { assetId } : {}), ...(filePath ? { filePath } : {}) } }
function add(diagnostics: ValidationDiagnostic[], code: string, message: string, item?: { value: Dict; filePath: string }): void { diagnostics.push(error(code, message, typeof item?.value.id === 'string' ? item.value.id : undefined, item?.filePath)) }
function nonEmpty(value: unknown): boolean { return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null }
function dateLike(value: unknown): boolean { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
function exactFields(value: Dict, allowed: readonly string[], diagnostics: ValidationDiagnostic[], item: { value: Dict; filePath: string }): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) add(diagnostics, 'V03_UNDECLARED_FIELD', `Field is not declared by Schema 0.3: ${key}`, item)
}
function requiredFields(value: Dict, fields: readonly string[], diagnostics: ValidationDiagnostic[], item: { value: Dict; filePath: string }): void {
  for (const field of fields) if (!nonEmpty(value[field])) add(diagnostics, 'V03_REQUIRED_FIELD_MISSING', `Required Schema 0.3 field is missing: ${field}`, item)
}
function lifecycle(value: unknown, diagnostics: ValidationDiagnostic[], item: { value: Dict; filePath: string }): void {
  if (!isRecord(value) || !(KNOWLEDGE_SCHEMA_V03.lifecycle.values as readonly unknown[]).includes(value.status)) { add(diagnostics, 'V03_LIFECYCLE_INVALID', 'lifecycle.status is not a frozen Schema 0.3 value', item); return }
  if (value.validFrom !== undefined && value.validFrom !== null && !dateLike(value.validFrom)) add(diagnostics, 'V03_LIFECYCLE_DATE_INVALID', 'lifecycle.validFrom must be a date string or null', item)
  if (value.validUntil !== undefined && value.validUntil !== null && !dateLike(value.validUntil)) add(diagnostics, 'V03_LIFECYCLE_DATE_INVALID', 'lifecycle.validUntil must be a date string or null', item)
}
function confidence(value: unknown, diagnostics: ValidationDiagnostic[], item: { value: Dict; filePath: string }): void {
  if (value !== undefined && value !== null && (typeof value !== 'number' || value < 0 || value > 1)) add(diagnostics, 'V03_NUMERIC_CONSTRAINT', 'confidence must be between 0 and 1', item)
}
function refSet(collection: KnowledgeAssetCollectionV03): Map<string, string> {
  return new Map(collection.registry.map((entry) => [entry.id, entry.type]))
}
function validateEntity(item: { value: Dict; filePath: string }, diagnostics: ValidationDiagnostic[], ids: Map<string, string>, taxonomyIds: Set<string>): void {
  const value = item.value
  exactFields(value, [...KNOWLEDGE_SCHEMA_V03.entity.commonFields, 'themeGroupRef', 'definition', 'inclusionCriteria', 'exclusionCriteria'], diagnostics, item)
  requiredFields(value, KNOWLEDGE_SCHEMA_V03.entity.requiredFields, diagnostics, item)
  if (typeof value.id !== 'string' || !value.id.startsWith(kindNamespaces.entity)) add(diagnostics, 'V03_ID_NAMESPACE', 'Entity id must use entity: namespace', item)
  if (!(KNOWLEDGE_SCHEMA_V03.entity.types as readonly unknown[]).includes(value.type)) add(diagnostics, 'V03_ENUM_INVALID', 'Entity type is not in the frozen vocabulary', item)
  lifecycle(value.lifecycle, diagnostics, item)
  if (value.aliases !== undefined && !arrayOfStrings(value.aliases)) add(diagnostics, 'V03_FIELD_TYPE', 'Entity aliases must be a string array', item)
  if (value.taxonomyRefs !== undefined && (!arrayOfStrings(value.taxonomyRefs) || value.taxonomyRefs.some((ref) => !taxonomyIds.has(ref)))) add(diagnostics, 'V03_TAXONOMY_REF_INVALID', 'Entity taxonomyRefs must resolve to auxiliary taxonomy item ids', item)
  if (value.type === 'investment_theme') {
    if (typeof value.themeGroupRef !== 'string' || ids.get(value.themeGroupRef) !== 'theme_group') add(diagnostics, 'V03_THEME_GROUP_REF_INVALID', 'InvestmentTheme must reference exactly one registered ThemeGroup', item)
  } else if (value.themeGroupRef !== undefined) add(diagnostics, 'V03_FORBIDDEN_FIELD', 'Only investment_theme may declare themeGroupRef', item)
}
function validateRelation(item: { value: Dict; filePath: string }, diagnostics: ValidationDiagnostic[], ids: Map<string, string>, entityTypes: Map<string, string>, sourceIds: Set<string>, claimIds: Set<string>): void {
  const value = item.value
  exactFields(value, KNOWLEDGE_SCHEMA_V03.relation.commonFields, diagnostics, item)
  requiredFields(value, KNOWLEDGE_SCHEMA_V03.relation.requiredFields, diagnostics, item)
  if (!(KNOWLEDGE_SCHEMA_V03.relation.types as readonly unknown[]).includes(value.type)) add(diagnostics, 'V03_ENUM_INVALID', 'Relation type is not in the frozen vocabulary', item)
  if (typeof value.id !== 'string' || !value.id.startsWith(kindNamespaces.relation)) add(diagnostics, 'V03_ID_NAMESPACE', 'Relation id must use relation: namespace', item)
  if (ids.get(value.sourceRef as string) !== 'entity' || ids.get(value.targetRef as string) !== 'entity') add(diagnostics, 'V03_RELATION_ENDPOINT_INVALID', 'Relation endpoints must resolve to registered Entity objects', item)
  const definition = isRecord(value.type) ? undefined : KNOWLEDGE_SCHEMA_V03.relation.definitions[value.type as keyof typeof KNOWLEDGE_SCHEMA_V03.relation.definitions]
  if (definition && entityTypes.has(value.sourceRef as string) && entityTypes.has(value.targetRef as string)) {
    if (!(definition.sourceTypes as readonly string[]).includes(entityTypes.get(value.sourceRef as string)! ) || !(definition.targetTypes as readonly string[]).includes(entityTypes.get(value.targetRef as string)!)) add(diagnostics, 'V03_RELATION_SEMANTICS', 'Relation endpoint types violate the frozen semantic definition', item)
    if ('endpointConstraint' in definition && definition.endpointConstraint === 'same_entity_type_on_both_sides' && entityTypes.get(value.sourceRef as string) !== entityTypes.get(value.targetRef as string)) add(diagnostics, 'V03_RELATION_SEMANTICS', 'Relation endpoints must have the same entity type', item)
  }
  lifecycle(value.lifecycle, diagnostics, item); confidence(value.confidence, diagnostics, item)
  if (value.sourceRefs !== undefined && (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sourceIds.has(ref)))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Relation sourceRefs must resolve to Source objects', item)
  if (value.supportingClaimRefs !== undefined && (!arrayOfStrings(value.supportingClaimRefs) || value.supportingClaimRefs.some((ref) => !claimIds.has(ref)))) add(diagnostics, 'V03_CLAIM_REF_INVALID', 'Relation supportingClaimRefs must resolve to Claim objects', item)
  if (value.contextRefs !== undefined && !arrayOfStrings(value.contextRefs)) add(diagnostics, 'V03_FIELD_TYPE', 'Relation contextRefs must be a string array', item)
  if (value.attributes !== undefined && !isRecord(value.attributes)) add(diagnostics, 'V03_FIELD_TYPE', 'Relation attributes must be an object', item)
  if (isRecord(value.attributes) && definition && 'attributes' in definition) {
    const declared = definition.attributes
    for (const [field, fieldValue] of Object.entries(value.attributes)) {
      const rule = (declared as Record<string, unknown>)[field]
      if (rule === undefined) { add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation attribute is not declared for ${String(value.type)}: ${field}`, item); continue }
      if (Array.isArray(rule) && !rule.includes(fieldValue as never)) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation attribute value is outside the frozen vocabulary: ${field}`, item)
      if (rule === 'number_0_to_1_or_null' && fieldValue !== null && (typeof fieldValue !== 'number' || fieldValue < 0 || fieldValue > 1)) add(diagnostics, 'V03_NUMERIC_CONSTRAINT', `Relation attribute must be between 0 and 1 or null: ${field}`, item)
      if (isRecord(rule) && field === 'financialContribution' && fieldValue !== null) {
        if (!isRecord(fieldValue)) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', 'financialContribution must be an object or null', item)
        else for (const child of Object.keys(fieldValue)) if (!(rule.fields as readonly string[]).includes(child)) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `financialContribution field is not declared: ${child}`, item)
      }
    }
  } else if (isRecord(value.attributes) && Object.keys(value.attributes).length > 0) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation type does not declare custom attributes: ${String(value.type)}`, item)
}
function validateClaim(item: { value: Dict; filePath: string }, diagnostics: ValidationDiagnostic[], ids: Map<string, string>, sourceIds: Set<string>, rawIds: Set<string>): void {
  const value = item.value
  exactFields(value, KNOWLEDGE_SCHEMA_V03.claim.fields, diagnostics, item); requiredFields(value, KNOWLEDGE_SCHEMA_V03.claim.requiredFields, diagnostics, item)
  if (typeof value.id !== 'string' || !value.id.startsWith(kindNamespaces.claim)) add(diagnostics, 'V03_ID_NAMESPACE', 'Claim id must use claim: namespace', item)
  if (!(KNOWLEDGE_SCHEMA_V03.claim.types as readonly unknown[]).includes(value.claimType)) add(diagnostics, 'V03_ENUM_INVALID', 'Claim claimType is not in the frozen vocabulary', item)
  if (typeof value.statement !== 'string' || value.statement.trim() === '') add(diagnostics, 'V03_REQUIRED_FIELD_MISSING', 'Claim statement must be a non-empty string', item)
  if (!arrayOfStrings(value.subjectRefs) || value.subjectRefs.some((ref) => !['entity', 'relation'].includes(ids.get(ref) ?? ''))) add(diagnostics, 'V03_CLAIM_SUBJECT_INVALID', 'Claim subjectRefs must resolve to Entity or Relation objects', item)
  if (value.primarySubjectRef !== undefined && value.primarySubjectRef !== null && (!['entity', 'relation'].includes(ids.get(value.primarySubjectRef as string) ?? '') || !(Array.isArray(value.subjectRefs) && value.subjectRefs.includes(value.primarySubjectRef)))) add(diagnostics, 'V03_CLAIM_SUBJECT_INVALID', 'Claim primarySubjectRef must be one of subjectRefs', item)
  if (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sourceIds.has(ref))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Claim sourceRefs must resolve to Source objects', item)
  lifecycle(value.lifecycle, diagnostics, item); confidence(value.confidence, diagnostics, item)
  if (value.temporal !== undefined) {
    const temporal = value.temporal; const scope = isRecord(temporal) ? temporal.scope : undefined
    if (!isRecord(temporal) || (temporal.asOf !== null && !dateLike(temporal.asOf)) || !isRecord(scope) || !(KNOWLEDGE_SCHEMA_V03.claim.temporalScopeTypes as readonly unknown[]).includes(scope.type) || !['start', 'end', 'label'].every((field) => scope[field] === null || typeof scope[field] === 'string')) add(diagnostics, 'V03_TEMPORAL_INVALID', 'Claim temporal scope is not valid', item)
  }
  if (value.structuredValue !== undefined) {
    const structured = value.structuredValue
    if (!isRecord(structured) || typeof structured.metric !== 'string' || structured.metric.trim() === '' || !['string', 'number', 'boolean'].includes(structured.value === null ? 'string' : typeof structured.value) || (structured.unit !== null && typeof structured.unit !== 'string') || (structured.comparator !== null && !(KNOWLEDGE_SCHEMA_V03.claim.comparators as readonly unknown[]).includes(structured.comparator))) add(diagnostics, 'V03_STRUCTURED_VALUE_INVALID', 'Claim structuredValue is not valid', item)
  }
  for (const field of ['supersedes', 'supersededBy'] as const) if (value[field] !== undefined && (!arrayOfStrings(value[field]) || value[field].some((ref) => ids.get(ref) !== 'claim'))) add(diagnostics, 'V03_CLAIM_REF_INVALID', `Claim ${field} must resolve to Claim objects`, item)
  if (value.provenance !== undefined && (!Array.isArray(value.provenance) || value.provenance.some((entry) => !isRecord(entry) || typeof entry.sourceRef !== 'string' || typeof entry.rawRef !== 'string' || !sourceIds.has(entry.sourceRef) || !rawIds.has(entry.rawRef)))) add(diagnostics, 'V03_PROVENANCE_INVALID', 'Claim provenance sourceRef/rawRef must resolve', item)
}
function validateSource(item: { value: Dict; filePath: string }, diagnostics: ValidationDiagnostic[]): void {
  const value = item.value
  exactFields(value, KNOWLEDGE_SCHEMA_V03.source.fields, diagnostics, item); requiredFields(value, KNOWLEDGE_SCHEMA_V03.source.requiredFields, diagnostics, item)
  if (typeof value.id !== 'string' || !value.id.startsWith(kindNamespaces.source)) add(diagnostics, 'V03_ID_NAMESPACE', 'Source id must use source: namespace', item)
  if (!(KNOWLEDGE_SCHEMA_V03.source.types as readonly unknown[]).includes(value.sourceType)) add(diagnostics, 'V03_ENUM_INVALID', 'Source sourceType is not in the frozen vocabulary', item)
  if (value.sourceReliability !== undefined && !(KNOWLEDGE_SCHEMA_V03.source.reliabilities as readonly unknown[]).includes(value.sourceReliability)) add(diagnostics, 'V03_ENUM_INVALID', 'Source sourceReliability is not in the frozen vocabulary', item)
  if (value.rawRefs !== undefined && !arrayOfStrings(value.rawRefs)) add(diagnostics, 'V03_FIELD_TYPE', 'Source rawRefs must be a string array', item)
  if (value.lifecycle !== undefined) lifecycle(value.lifecycle, diagnostics, item)
}
function validateModule(item: { value: Dict; filePath: string }, diagnostics: ValidationDiagnostic[], ids: Map<string, string>, sourceIds: Set<string>): void {
  const value = item.value
  exactFields(value, KNOWLEDGE_SCHEMA_V03.module.fields, diagnostics, item); requiredFields(value, KNOWLEDGE_SCHEMA_V03.module.requiredFields, diagnostics, item)
  if (typeof value.id !== 'string' || !value.id.startsWith(kindNamespaces.module)) add(diagnostics, 'V03_ID_NAMESPACE', 'Module id must use module: namespace', item)
  if (!(KNOWLEDGE_SCHEMA_V03.module.types as readonly unknown[]).includes(value.type)) add(diagnostics, 'V03_ENUM_INVALID', 'Module type is not in the frozen vocabulary', item)
  if (value.targetEntity !== undefined && value.targetEntity !== null && ids.get(value.targetEntity as string) !== 'entity') add(diagnostics, 'V03_MODULE_TARGET_INVALID', 'Module targetEntity must resolve to an Entity', item)
  if (value.sourceRefs !== undefined && (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sourceIds.has(ref)))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Module sourceRefs must resolve to Source objects', item)
  if (value.columns !== undefined && !Array.isArray(value.columns)) add(diagnostics, 'V03_FIELD_TYPE', 'Module columns must be an array', item)
  if (value.rows !== undefined && !Array.isArray(value.rows)) add(diagnostics, 'V03_FIELD_TYPE', 'Module rows must be an array', item)
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true }); const result: string[] = []
    for (const entry of entries) { const path = join(root, entry.name); if (entry.isDirectory()) result.push(...await listFiles(path)); else if (/\.(yaml|yml|json)$/i.test(entry.name)) result.push(path) }
    return result
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

export async function validateKnowledgeBaseV03(rootRef: string, manifest?: KnowledgeBaseManifest, scope: ValidationScope = 'all'): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = []; const root = resolve(rootRef)
  let actualManifest = manifest
  try { actualManifest ??= parseKnowledgeBaseManifest(parseYaml(await readFile(join(root, 'manifest.yaml'), 'utf8'), join(root, 'manifest.yaml'))) } catch (caught) { return [error('V03_MANIFEST_INVALID', caught instanceof Error ? caught.message : String(caught))] }
  if (actualManifest.schemaVersion !== KNOWLEDGE_SCHEMA_V03.identity.schemaVersion || actualManifest.storageFormatVersion !== KNOWLEDGE_SCHEMA_V03.identity.storageFormatVersion) return [error('V03_MANIFEST_VERSION', 'Manifest is not Schema 0.3 / Storage Format 1')]
  if (scope === 'manifest') return diagnostics
  let assets: KnowledgeAssetCollectionV03
  try { assets = await new CanonicalV03KnowledgeLoader(root).readAssets() } catch (caught) { return [error('V03_REGISTRY_INVALID', caught instanceof Error ? caught.message : String(caught))] }
  const ids = refSet(assets); const taxonomyIds = new Set<string>(); const rawIds = new Set<string>(); const sourceIds = new Set(assets.sources.map((item) => item.value.id)); const claimIds = new Set(assets.claims.map((item) => item.value.id)); const entityTypes = new Map(assets.entities.map((item) => [item.value.id, item.value.type]))
  for (const file of await listFiles(join(root, 'taxonomy'))) { try { const value = parseYaml(await readFile(file, 'utf8'), file); if (isRecord(value) && typeof value.id === 'string') taxonomyIds.add(value.id) } catch { diagnostics.push(error('V03_AUXILIARY_PARSE_ERROR', `Unable to parse taxonomy file: ${relative(root, file)}`, undefined, file)) } }
  try { const raw = parseYaml(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8')); if (isRecord(raw)) for (const id of Object.keys(raw)) rawIds.add(id) } catch (caught) { if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(error('V03_RAW_REGISTRY_INVALID', caught instanceof Error ? caught.message : String(caught))) }
  const all = [...assets.themeGroups, ...assets.entities, ...assets.relations, ...assets.claims, ...assets.modules, ...assets.sources]
  for (const item of all) {
    if (scope !== 'all' && !((scope === 'entity' && item.kind === 'entity') || (scope === 'relation' && item.kind === 'relation') || (scope === 'module' && item.kind === 'module') || (scope === 'source' && item.kind === 'source'))) continue
    if (item.kind === 'theme_group') { exactFields(item.value as unknown as Dict, KNOWLEDGE_SCHEMA_V03.themeGroup.fields, diagnostics, item as never); requiredFields(item.value as unknown as Dict, KNOWLEDGE_SCHEMA_V03.themeGroup.requiredFields, diagnostics, item as never); lifecycle((item.value as unknown as Dict).lifecycle, diagnostics, item as never); if (!arrayOfStrings((item.value as unknown as Dict).aliases)) add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup aliases must be a string array', item as never) }
    if (item.kind === 'entity') validateEntity(item as never, diagnostics, ids, taxonomyIds)
    if (item.kind === 'relation') validateRelation(item as never, diagnostics, ids, entityTypes, sourceIds, claimIds)
    if (item.kind === 'claim') validateClaim(item as never, diagnostics, ids, sourceIds, rawIds)
    if (item.kind === 'source') validateSource(item as never, diagnostics)
    if (item.kind === 'module') validateModule(item as never, diagnostics, ids, sourceIds)
  }
  for (const entry of assets.registry) if (entry.id.startsWith('raw:') || entry.type === 'theme_group' && entry.id.startsWith('entity:')) diagnostics.push(error('V03_REGISTRY_KIND_INVALID', `Registry entry is not a canonical v0.3 namespace-kind pairing: ${entry.id}`))
  for (const file of [...await listFiles(join(root, 'entities')), ...await listFiles(join(root, 'relations')), ...await listFiles(join(root, 'intelligence')), ...await listFiles(join(root, 'modules')), ...await listFiles(join(root, 'sources')), ...await listFiles(join(root, 'theme-groups'))]) {
    try { const value = parseYaml(await readFile(file, 'utf8'), file); if (isRecord(value) && typeof value.id === 'string' && !ids.has(value.id)) diagnostics.push(error('V03_ORPHAN_CANONICAL_ASSET', `Canonical asset is not registered: ${value.id}`, value.id, file)) } catch { /* loader reports registered parse failures */ }
  }
  for (const source of assets.sources) for (const rawRef of source.value.rawRefs ?? []) {
    if (!/^raw:[A-Za-z0-9._-]+$/.test(rawRef) || !rawIds.has(rawRef)) diagnostics.push(error('V03_RAW_REF_MISSING', `Source rawRef does not resolve through registry/raw.yaml: ${rawRef}`, source.value.id, source.filePath))
  }
  const activeBusinessPairs = new Set<string>()
  for (const relation of assets.relations) if (relation.value.type === 'business_exposure' && relation.value.lifecycle.status === 'active') {
    const pair = `${relation.value.sourceRef}\u0000${relation.value.targetRef}`
    if (activeBusinessPairs.has(pair)) diagnostics.push(error('V03_RELATION_CARDINALITY', 'At most one active business_exposure is allowed per company/industry pair', relation.value.id, relation.filePath))
    activeBusinessPairs.add(pair)
  }
  for (const claim of assets.claims) for (const provenance of claim.value.provenance ?? []) {
    const source = assets.sources.find((item) => item.value.id === provenance.sourceRef)
    if (!source || !source.value.rawRefs?.includes(provenance.rawRef)) diagnostics.push(error('V03_PROVENANCE_INVALID', 'Claim provenance rawRef must belong to the referenced Source.rawRefs', claim.value.id, claim.filePath))
  }
  for (const file of await listFiles(join(root, 'taxonomy'))) {
    try {
      const value = parseYaml(await readFile(file, 'utf8'), file); if (!isRecord(value)) continue
      const graphRefs = value.graphRefs
      if (graphRefs !== undefined && (!arrayOfStrings(graphRefs) || graphRefs.some((ref) => !ids.has(ref)))) diagnostics.push(error('V03_AUXILIARY_REF_INVALID', 'Taxonomy graphRefs must use resolvable v0.3 canonical references', undefined, file))
    } catch { /* taxonomy parse errors are reported during inventory */ }
  }
  for (const file of await listFiles(join(root, 'views'))) {
    try {
      const value = parseYaml(await readFile(file, 'utf8'), file); const refs: Array<{ field: string; value: string }> = []
      const visit = (node: unknown): void => { if (Array.isArray(node)) { for (const child of node) visit(child); return }; if (!isRecord(node)) return; for (const [key, child] of Object.entries(node)) { if (key === 'targetEntity' && typeof child === 'string') refs.push({ field: key, value: child }); if (key === 'graphRefs' && Array.isArray(child)) for (const ref of child) if (typeof ref === 'string') refs.push({ field: key, value: ref }); visit(child) } }
      visit(value); for (const ref of refs) if (ids.get(ref.value) !== 'entity' && ids.get(ref.value) !== 'relation') diagnostics.push(error('V03_VIEW_REF_INVALID', `View ${ref.field} does not resolve to a canonical graph object: ${ref.value}`, undefined, file))
    } catch { diagnostics.push(error('V03_AUXILIARY_PARSE_ERROR', `Unable to parse view file: ${relative(root, file)}`, undefined, file)) }
  }
  return diagnostics
}
