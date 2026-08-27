import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import type { ValidationDiagnostic } from './types.ts'

export type V03CanonicalKind = 'theme_group' | 'entity' | 'relation' | 'claim' | 'module' | 'source'
export type V03CanonicalObject = { kind: V03CanonicalKind; object: Record<string, unknown> }

export interface V03CanonicalValidationContext {
  objects: Map<string, V03CanonicalObject>
  rawRefs: Set<string>
  taxonomyRefs: Set<string>
}

export interface V03DiagnosticContext {
  operationId?: string
  assetId?: string
  filePath?: string
}

const namespaces: Record<V03CanonicalKind, string> = {
  theme_group: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.themeGroup,
  entity: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.entity,
  relation: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.relation,
  claim: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.claim,
  module: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.module,
  source: KNOWLEDGE_SCHEMA_V03.canonicalNamespaces.source,
}
const rawPattern = new RegExp(KNOWLEDGE_SCHEMA_V03.rawIdentity.pattern)
const logicalId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function arrayOfStrings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function dateLike(value: unknown): boolean { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(jsonValue)
  return isRecord(value) && Object.values(value).every(jsonValue)
}
function finiteNumberInRange(value: unknown, constraint: { minimum: number; maximum: number }): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= constraint.minimum && value <= constraint.maximum)
}
function add(diagnostics: ValidationDiagnostic[], code: string, message: string, context: V03DiagnosticContext): void {
  diagnostics.push({ code, severity: 'error', message, ...(context.assetId ? { assetId: context.assetId } : {}), ...(context.operationId ? { operationId: context.operationId } : {}), ...(context.filePath ? { filePath: context.filePath } : {}) })
}
function exactFields(value: Record<string, unknown>, fields: readonly string[], diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  const allowed = new Set(fields)
  for (const field of Object.keys(value)) if (!allowed.has(field)) add(diagnostics, 'V03_UNDECLARED_FIELD', `Field is not declared by Schema 0.3: ${field}`, context)
}
function requiredFields(value: Record<string, unknown>, fields: readonly string[], diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  for (const field of fields) if (!(field in value) || value[field] === undefined || value[field] === null || (typeof value[field] === 'string' && value[field].trim() === '')) add(diagnostics, 'V03_REQUIRED_FIELD_MISSING', `Required Schema 0.3 field is missing: ${field}`, context)
}
function validId(value: Record<string, unknown>, kind: V03CanonicalKind): boolean {
  return typeof value.id === 'string' && value.id.startsWith(namespaces[kind]) && logicalId.test(value.id.slice(namespaces[kind].length))
}
function validateId(value: Record<string, unknown>, kind: V03CanonicalKind, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (!validId(value, kind)) add(diagnostics, 'V03_ID_NAMESPACE', `ID must use the ${kind} namespace and a safe local identifier`, context)
}
function lifecycle(value: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (!isRecord(value) || !KNOWLEDGE_SCHEMA_V03.lifecycle.values.includes(value.status as never)) { add(diagnostics, 'V03_LIFECYCLE_INVALID', 'lifecycle.status is not a frozen Schema 0.3 value', context); return }
  for (const field of Object.keys(value)) if (!KNOWLEDGE_SCHEMA_V03.lifecycle.fields.includes(field as never)) add(diagnostics, 'V03_LIFECYCLE_FIELD_INVALID', `Lifecycle field is not declared: ${field}`, context)
  for (const field of ['validFrom', 'validUntil'] as const) if (value[field] !== undefined && value[field] !== null && !dateLike(value[field])) add(diagnostics, 'V03_LIFECYCLE_DATE_INVALID', `lifecycle.${field} must be a date string or null`, context)
}
function confidence(value: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (value !== undefined && !finiteNumberInRange(value, KNOWLEDGE_SCHEMA_V03.numericConstraints.confidence)) add(diagnostics, 'V03_NUMERIC_CONSTRAINT', 'confidence must be a finite number between 0 and 1 or null', context)
}
function objectId(value: unknown): string | undefined { return isRecord(value) && typeof value.id === 'string' ? value.id : undefined }
function entityType(id: unknown, objects: Map<string, V03CanonicalObject>): string | undefined {
  return typeof id === 'string' && objects.get(id)?.kind === 'entity' ? String(objects.get(id)?.object.type) : undefined
}
function sourceIds(context: V03CanonicalValidationContext): Set<string> { return new Set([...context.objects].filter(([, current]) => current.kind === 'source').map(([id]) => id)) }
function claimIds(context: V03CanonicalValidationContext): Set<string> { return new Set([...context.objects].filter(([, current]) => current.kind === 'claim').map(([id]) => id)) }
function ownsRaw(context: V03CanonicalValidationContext, sourceRef: string, rawRef: string): boolean {
  const source = context.objects.get(sourceRef)
  return source?.kind === 'source' && Array.isArray(source.object.rawRefs) && source.object.rawRefs.includes(rawRef)
}

function validateThemeGroup(value: Record<string, unknown>, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  exactFields(value, KNOWLEDGE_SCHEMA_V03.themeGroup.fields, diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.themeGroup.requiredFields, diagnostics, context); validateId(value, 'theme_group', diagnostics, context)
  if (typeof value.name !== 'string' || value.name.trim() === '') add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup name must be a non-empty string', context)
  if (!arrayOfStrings(value.aliases)) add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup aliases must be a string array', context)
  if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup description must be a string or null', context)
  if (value.sortOrder !== undefined && value.sortOrder !== null && (typeof value.sortOrder !== 'number' || !Number.isFinite(value.sortOrder))) add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup sortOrder must be a number or null', context)
  if (value.metadata !== undefined && (!isRecord(value.metadata) || !jsonValue(value.metadata))) add(diagnostics, 'V03_FIELD_TYPE', 'ThemeGroup metadata must be a JSON object', context)
  lifecycle(value.lifecycle, diagnostics, context)
}

function validateEntity(value: Record<string, unknown>, objects: Map<string, V03CanonicalObject>, taxonomyRefs: Set<string>, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  const subtypeFields = value.type === 'investment_theme' ? KNOWLEDGE_SCHEMA_V03.entity.investmentTheme.fields : value.type === 'company' ? KNOWLEDGE_SCHEMA_V03.entity.company.optionalFields : []
  exactFields(value, [...KNOWLEDGE_SCHEMA_V03.entity.commonFields, ...subtypeFields], diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.entity.requiredFields, diagnostics, context); validateId(value, 'entity', diagnostics, context)
  if (!KNOWLEDGE_SCHEMA_V03.entity.types.includes(value.type as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Entity type is not in the frozen vocabulary', context)
  if (typeof value.name !== 'string' || value.name.trim() === '') add(diagnostics, 'V03_FIELD_TYPE', 'Entity name must be a non-empty string', context)
  if (value.aliases !== undefined && !arrayOfStrings(value.aliases)) add(diagnostics, 'V03_FIELD_TYPE', 'Entity aliases must be a string array', context)
  for (const field of ['description', 'ticker', 'exchange', 'legalName', 'definition'] as const) if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') add(diagnostics, 'V03_FIELD_TYPE', `${field} must be a string or null`, context)
  for (const field of ['externalIds', 'metadata'] as const) if (value[field] !== undefined && (!isRecord(value[field]) || !jsonValue(value[field]))) add(diagnostics, 'V03_FIELD_TYPE', `${field} must be a JSON object`, context)
  for (const field of ['createdAt', 'updatedAt'] as const) if (value[field] !== undefined && value[field] !== null && !dateLike(value[field])) add(diagnostics, 'V03_FIELD_TYPE', `${field} must be a datetime string or null`, context)
  if (value.taxonomyRefs !== undefined && (!arrayOfStrings(value.taxonomyRefs) || value.taxonomyRefs.some((ref) => !taxonomyRefs.has(ref)))) add(diagnostics, 'V03_TAXONOMY_REF_INVALID', 'Entity taxonomyRefs must resolve to auxiliary taxonomy item ids', context)
  if (value.type === 'investment_theme') {
    if (!('themeGroupRef' in value) || value.themeGroupRef === undefined) add(diagnostics, 'V03_REQUIRED_FIELD_MISSING', 'InvestmentTheme themeGroupRef is required', context)
    else if (typeof value.themeGroupRef !== 'string' || objects.get(value.themeGroupRef)?.kind !== 'theme_group') add(diagnostics, 'V03_THEME_GROUP_REF_INVALID', 'InvestmentTheme must reference exactly one registered ThemeGroup', context)
    for (const field of ['inclusionCriteria', 'exclusionCriteria'] as const) if (value[field] !== undefined && !arrayOfStrings(value[field])) add(diagnostics, 'V03_FIELD_TYPE', `${field} must be a string array`, context)
  }
}

function validateFinancialContribution(value: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (value === null) return
  if (!isRecord(value)) { add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', 'financialContribution must be an object or null', context); return }
  const fields = KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure.attributes.financialContribution.fields
  for (const field of Object.keys(value)) if (!fields.includes(field as never)) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `financialContribution field is not declared: ${field}`, context)
  for (const [field, child] of Object.entries(value)) {
    const validString = ['period', 'currency'].includes(field) && (child === null || typeof child === 'string')
    const validNumber = ['revenueAmount', 'profitAmount'].includes(field) && (child === null || (typeof child === 'number' && Number.isFinite(child)))
    const validShare = field === 'revenueShare' ? finiteNumberInRange(child, KNOWLEDGE_SCHEMA_V03.numericConstraints.revenueShare) : field === 'profitShare' ? finiteNumberInRange(child, KNOWLEDGE_SCHEMA_V03.numericConstraints.profitShare) : false
    const validBoolean = field === 'separatelyReported' && (child === null || typeof child === 'boolean')
    if (!validString && !validNumber && !validShare && !validBoolean) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `financialContribution field has an invalid type or range: ${field}`, context)
  }
}

function validateRelationAttributes(type: unknown, attributes: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (attributes === undefined) return
  if (!isRecord(attributes)) { add(diagnostics, 'V03_FIELD_TYPE', 'Relation attributes must be an object', context); return }
  const definition = typeof type === 'string' ? KNOWLEDGE_SCHEMA_V03.relation.definitions[type as keyof typeof KNOWLEDGE_SCHEMA_V03.relation.definitions] : undefined
  if (!definition || !('attributes' in definition)) { if (Object.keys(attributes).length > 0) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation type does not declare custom attributes: ${String(type)}`, context); return }
  const declared = definition.attributes
  for (const [field, child] of Object.entries(attributes)) {
    const rule = (declared as Record<string, unknown>)[field]
    if (rule === undefined) { add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation attribute is not declared for ${String(type)}: ${field}`, context); continue }
    if (Array.isArray(rule) && !rule.includes(child as never)) add(diagnostics, 'V03_RELATION_ATTRIBUTE_INVALID', `Relation attribute value is outside the frozen vocabulary: ${field}`, context)
    if (rule === 'number_0_to_1_or_null' && !finiteNumberInRange(child, KNOWLEDGE_SCHEMA_V03.numericConstraints.ownershipPct)) add(diagnostics, 'V03_NUMERIC_CONSTRAINT', `Relation attribute must be a finite number between 0 and 1 or null: ${field}`, context)
    if (isRecord(rule) && field === 'financialContribution') validateFinancialContribution(child, diagnostics, context)
  }
}

function validateRelation(value: Record<string, unknown>, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  exactFields(value, KNOWLEDGE_SCHEMA_V03.relation.commonFields, diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.relation.requiredFields, diagnostics, context); validateId(value, 'relation', diagnostics, context)
  const definition = typeof value.type === 'string' ? KNOWLEDGE_SCHEMA_V03.relation.definitions[value.type as keyof typeof KNOWLEDGE_SCHEMA_V03.relation.definitions] : undefined
  if (!KNOWLEDGE_SCHEMA_V03.relation.types.includes(value.type as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Relation type is not in the frozen vocabulary', context)
  const sourceType = entityType(value.sourceRef, contextData.objects); const targetType = entityType(value.targetRef, contextData.objects)
  if (typeof value.sourceRef !== 'string' || typeof value.targetRef !== 'string' || contextData.objects.get(value.sourceRef)?.kind !== 'entity' || contextData.objects.get(value.targetRef)?.kind !== 'entity') add(diagnostics, 'V03_RELATION_ENDPOINT_INVALID', 'Relation endpoints must resolve to Entity objects', context)
  if (definition && sourceType && targetType && (!(definition.sourceTypes as readonly string[]).includes(sourceType) || !(definition.targetTypes as readonly string[]).includes(targetType) || ('endpointConstraint' in definition && definition.endpointConstraint === 'same_entity_type_on_both_sides' && sourceType !== targetType))) add(diagnostics, 'V03_RELATION_SEMANTICS', 'Relation endpoint types violate the frozen semantic definition', context)
  lifecycle(value.lifecycle, diagnostics, context); confidence(value.confidence, diagnostics, context)
  for (const field of ['asOf', 'createdAt', 'updatedAt'] as const) if (value[field] !== undefined && value[field] !== null && !dateLike(value[field])) add(diagnostics, 'V03_FIELD_TYPE', `${field} must be a datetime string or null`, context)
  const sources = sourceIds(contextData); const claims = claimIds(contextData)
  if (value.sourceRefs !== undefined && (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sources.has(ref)))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Relation sourceRefs must resolve to Source objects', context)
  if (value.supportingClaimRefs !== undefined && (!arrayOfStrings(value.supportingClaimRefs) || value.supportingClaimRefs.some((ref) => !claims.has(ref)))) add(diagnostics, 'V03_CLAIM_REF_INVALID', 'Relation supportingClaimRefs must resolve to Claim objects', context)
  if (value.contextRefs !== undefined && (!arrayOfStrings(value.contextRefs) || value.contextRefs.some((ref) => !(contextData.objects.has(ref) || (rawPattern.test(ref) && contextData.rawRefs.has(ref)))))) add(diagnostics, 'V03_CONTEXT_REF_INVALID', 'Relation contextRefs must resolve to canonical assets or existing Raw identities', context)
  validateRelationAttributes(value.type, value.attributes, diagnostics, context)
}

function validNullableDate(value: unknown): boolean { return value === null || (typeof value === 'string' && dateLike(value)) }
function validateClaimTemporal(value: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (!isRecord(value) || Object.keys(value).some((field) => !['asOf', 'scope'].includes(field)) || !('asOf' in value) || !validNullableDate(value.asOf) || !isRecord(value.scope) || Object.keys(value.scope).some((field) => !['type', 'start', 'end', 'label'].includes(field)) || !('type' in value.scope) || !('start' in value.scope) || !('end' in value.scope) || !('label' in value.scope) || !KNOWLEDGE_SCHEMA_V03.claim.temporalScopeTypes.includes(value.scope.type as never) || !validNullableDate(value.scope.start) || !validNullableDate(value.scope.end) || (value.scope.label !== null && typeof value.scope.label !== 'string')) add(diagnostics, 'V03_TEMPORAL_INVALID', 'Claim temporal scope is not valid', context)
}
function validateStructuredValue(value: unknown, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  if (!isRecord(value) || Object.keys(value).some((field) => !['metric', 'value', 'unit', 'comparator'].includes(field)) || typeof value.metric !== 'string' || value.metric.trim() === '' || !('value' in value) || !jsonValue(value.value) || isRecord(value.value) || Array.isArray(value.value) || !('unit' in value) || (value.unit !== null && typeof value.unit !== 'string') || !('comparator' in value) || (value.comparator !== null && !KNOWLEDGE_SCHEMA_V03.claim.comparators.includes(value.comparator as never))) add(diagnostics, 'V03_STRUCTURED_VALUE_INVALID', 'Claim structuredValue is not valid', context)
}
function validateClaim(value: Record<string, unknown>, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  exactFields(value, KNOWLEDGE_SCHEMA_V03.claim.fields, diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.claim.requiredFields, diagnostics, context); validateId(value, 'claim', diagnostics, context)
  if (!KNOWLEDGE_SCHEMA_V03.claim.types.includes(value.claimType as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Claim claimType is not in the frozen vocabulary', context)
  if (typeof value.statement !== 'string' || value.statement.trim() === '') add(diagnostics, 'V03_FIELD_TYPE', 'Claim statement must be a non-empty string', context)
  if (!arrayOfStrings(value.subjectRefs) || value.subjectRefs.length === 0 || value.subjectRefs.some((ref) => !['entity', 'relation'].includes(contextData.objects.get(ref)?.kind ?? ''))) add(diagnostics, 'V03_CLAIM_SUBJECT_INVALID', 'Claim subjectRefs must resolve to non-empty Entity or Relation objects', context)
  if (value.primarySubjectRef !== undefined && value.primarySubjectRef !== null && !['entity', 'relation'].includes(contextData.objects.get(String(value.primarySubjectRef))?.kind ?? '')) add(diagnostics, 'V03_CLAIM_SUBJECT_INVALID', 'Claim primarySubjectRef must resolve to an Entity or Relation', context)
  const sources = sourceIds(contextData); const claims = claimIds(contextData)
  if (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sources.has(ref))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Claim sourceRefs must resolve to Source objects', context)
  lifecycle(value.lifecycle, diagnostics, context); confidence(value.confidence, diagnostics, context)
  if (value.temporal !== undefined) validateClaimTemporal(value.temporal, diagnostics, context)
  if (value.structuredValue !== undefined) validateStructuredValue(value.structuredValue, diagnostics, context)
  for (const field of ['supersedes', 'supersededBy'] as const) if (value[field] !== undefined && (!arrayOfStrings(value[field]) || value[field].some((ref) => !claims.has(ref)))) add(diagnostics, 'V03_CLAIM_REF_INVALID', `Claim ${field} must resolve to Claim objects`, context)
  if (value.provenance !== undefined && (!Array.isArray(value.provenance) || value.provenance.some((entry) => !isRecord(entry) || Object.keys(entry).some((field) => !['sourceRef', 'rawRef', 'locator', 'chunkRef'].includes(field)) || typeof entry.sourceRef !== 'string' || typeof entry.rawRef !== 'string' || !sources.has(entry.sourceRef) || !rawPattern.test(entry.rawRef) || !contextData.rawRefs.has(entry.rawRef) || !ownsRaw(contextData, entry.sourceRef, entry.rawRef) || (entry.locator !== null && typeof entry.locator !== 'string') || (entry.chunkRef !== null && typeof entry.chunkRef !== 'string')))) add(diagnostics, 'V03_PROVENANCE_INVALID', 'Claim provenance sourceRef/rawRef must resolve and use the exact declared shape', context)
}

function validateSource(value: Record<string, unknown>, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  exactFields(value, KNOWLEDGE_SCHEMA_V03.source.fields, diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.source.requiredFields, diagnostics, context); validateId(value, 'source', diagnostics, context)
  if (typeof value.title !== 'string' || value.title.trim() === '') add(diagnostics, 'V03_FIELD_TYPE', 'Source title must be a non-empty string', context)
  if (!KNOWLEDGE_SCHEMA_V03.source.types.includes(value.sourceType as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Source sourceType is not in the frozen vocabulary', context)
  for (const field of ['type', 'publisher', 'institution', 'author', 'publishedAt', 'url'] as const) if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') add(diagnostics, 'V03_FIELD_TYPE', `Source ${field} must be a string or null`, context)
  if (value.quality !== undefined && !jsonValue(value.quality)) add(diagnostics, 'V03_FIELD_TYPE', 'Source quality must be JSON data', context)
  if (value.sourceReliability !== undefined && !KNOWLEDGE_SCHEMA_V03.source.reliabilities.includes(value.sourceReliability as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Source sourceReliability is not in the frozen vocabulary', context)
  if (value.rawRefs !== undefined && (!arrayOfStrings(value.rawRefs) || value.rawRefs.some((ref) => !rawPattern.test(ref) || !contextData.rawRefs.has(ref)))) add(diagnostics, 'V03_RAW_REF_INVALID', 'Source rawRefs must resolve through registry/raw.yaml or the supplied validation context', context)
  if (value.metadata !== undefined && (!isRecord(value.metadata) || !jsonValue(value.metadata))) add(diagnostics, 'V03_FIELD_TYPE', 'Source metadata must be a JSON object', context)
  if (value.lifecycle !== undefined) lifecycle(value.lifecycle, diagnostics, context)
  for (const field of ['createdAt', 'updatedAt'] as const) if (value[field] !== undefined && value[field] !== null && !dateLike(value[field])) add(diagnostics, 'V03_FIELD_TYPE', `Source ${field} must be a datetime string or null`, context)
}

function validateModule(value: Record<string, unknown>, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], context: V03DiagnosticContext): void {
  exactFields(value, KNOWLEDGE_SCHEMA_V03.module.fields, diagnostics, context); requiredFields(value, KNOWLEDGE_SCHEMA_V03.module.requiredFields, diagnostics, context); validateId(value, 'module', diagnostics, context)
  if (!KNOWLEDGE_SCHEMA_V03.module.types.includes(value.type as never)) add(diagnostics, 'V03_ENUM_INVALID', 'Module type is not in the frozen vocabulary', context)
  if (value.targetEntity !== undefined && value.targetEntity !== null && (typeof value.targetEntity !== 'string' || contextData.objects.get(value.targetEntity)?.kind !== 'entity')) add(diagnostics, 'V03_MODULE_TARGET_INVALID', 'Module targetEntity must resolve to an Entity', context)
  if (value.sourceRefs !== undefined && (!arrayOfStrings(value.sourceRefs) || value.sourceRefs.some((ref) => !sourceIds(contextData).has(ref)))) add(diagnostics, 'V03_SOURCE_REF_INVALID', 'Module sourceRefs must resolve to Source objects', context)
  if (value.schemaId !== undefined && value.schemaId !== null && typeof value.schemaId !== 'string') add(diagnostics, 'V03_FIELD_TYPE', 'Module schemaId must be a string or null', context)
  if (value.columns !== undefined && (!Array.isArray(value.columns) || !value.columns.every(jsonValue))) add(diagnostics, 'V03_FIELD_TYPE', 'Module columns must be an array of JSON values', context)
  if (value.rows !== undefined && (!Array.isArray(value.rows) || !value.rows.every(jsonValue))) add(diagnostics, 'V03_FIELD_TYPE', 'Module rows must be an array of JSON values', context)
}

export function validateV03CanonicalObject(item: V03CanonicalObject, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], diagnosticContext: V03DiagnosticContext = {}): void {
  const context = { assetId: diagnosticContext.assetId ?? objectId(item.object), ...diagnosticContext }
  if (!isRecord(item.object)) { add(diagnostics, 'V03_OBJECT_INVALID', 'Canonical object must be a JSON object', context); return }
  if (item.kind === 'theme_group') validateThemeGroup(item.object, diagnostics, context)
  if (item.kind === 'entity') validateEntity(item.object, contextData.objects, contextData.taxonomyRefs, diagnostics, context)
  if (item.kind === 'relation') validateRelation(item.object, contextData, diagnostics, context)
  if (item.kind === 'claim') validateClaim(item.object, contextData, diagnostics, context)
  if (item.kind === 'source') validateSource(item.object, contextData, diagnostics, context)
  if (item.kind === 'module') validateModule(item.object, contextData, diagnostics, context)
}

export function validateV03CanonicalObjects(items: Iterable<V03CanonicalObject>, contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], diagnosticContext?: (item: V03CanonicalObject) => V03DiagnosticContext): void {
  for (const item of items) validateV03CanonicalObject(item, contextData, diagnostics, diagnosticContext?.(item))
}

export function validateV03GlobalInvariants(contextData: V03CanonicalValidationContext, diagnostics: ValidationDiagnostic[], diagnosticContext: (id: string) => V03DiagnosticContext = (assetId) => ({ assetId })): void {
  const activeBusinessPairs = new Map<string, string[]>()
  for (const [id, current] of contextData.objects) if (current.kind === 'relation' && current.object.type === 'business_exposure' && isRecord(current.object.lifecycle) && current.object.lifecycle.status === 'active') {
    const pair = `${current.object.sourceRef}\u0000${current.object.targetRef}`; const ids = activeBusinessPairs.get(pair) ?? []; ids.push(id); activeBusinessPairs.set(pair, ids)
  }
  for (const ids of activeBusinessPairs.values()) if (ids.length > 1) for (const id of ids) add(diagnostics, 'V03_RELATION_CARDINALITY', 'At most one active business_exposure is allowed per Company/Industry pair', diagnosticContext(id))
}

export function isValidRawRef(value: unknown): value is string { return typeof value === 'string' && rawPattern.test(value) }
export function isJsonValue(value: unknown): boolean { return jsonValue(value) }
export function kindForV03Id(value: unknown): V03CanonicalKind | undefined {
  if (typeof value !== 'string') return undefined
  return (Object.entries(namespaces) as Array<[V03CanonicalKind, string]>).find(([, namespace]) => value.startsWith(namespace))?.[0]
}
