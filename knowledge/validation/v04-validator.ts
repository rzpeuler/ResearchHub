import { KNOWLEDGE_SCHEMA_V04 } from '../schema/executable-schema-v04.ts'
import { getMetricDefinitionV04 } from '../schema/metric-registry.ts'
import type { ClaimTypeV04, KillCriterionOriginV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEntityV04, KnowledgeEventV04, KnowledgeObservationV04, KnowledgeReasoningEdgeV04, KnowledgeRelationV04, KnowledgeSourceV04, KnowledgeThesisV04 } from '../schema/domain-v04.ts'
import { hashKillCriterionDefinitionV04, isBoundedSafeKillCriterionJsonV04, KILL_CRITERION_V04_LIMITS } from '../schema/kill-criterion-v04.ts'
import { COMPETITION_MODULE_V1_LIMITS, isSupportedBaseCurrencyCodeV1, validateCompetitionModuleV1 } from '../schema/competition-module-v04.ts'
import { validateRelationAttributesV03 } from './v03-validation-core.ts'

export interface KnowledgeV04Diagnostic { readonly code: string; readonly message: string; readonly assetId?: string }
export interface KnowledgeV04ValidationReport { readonly status: 'passed' | 'failed'; readonly errors: readonly KnowledgeV04Diagnostic[] }

const CLAIM_TYPES = new Set<ClaimTypeV04>(KNOWLEDGE_SCHEMA_V04.claim.types)
const SOURCE_TYPES = new Set(KNOWLEDGE_SCHEMA_V04.source.types)
const SOURCE_RELIABILITIES = new Set(KNOWLEDGE_SCHEMA_V04.source.reliabilities)
const ENTITY_TYPES = new Set(KNOWLEDGE_SCHEMA_V04.entity.types)
const EVENT_TYPES = new Set(KNOWLEDGE_SCHEMA_V04.event.types)
const OBSERVATION_TYPES = new Set(KNOWLEDGE_SCHEMA_V04.observation.types)
const THESIS_STATUSES = new Set(KNOWLEDGE_SCHEMA_V04.thesis.statuses)
const EDGE_TYPES = new Set(KNOWLEDGE_SCHEMA_V04.reasoningEdge.types)
const RAW_PATTERN = /^raw-sha256-[0-9a-f]{64}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
type Dict = Record<string, unknown>
const record = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value)
const date = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
const nullableDate = (value: unknown): boolean => value === undefined || value === null || date(value)
const inRange = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const ref = (value: unknown, prefix: string): value is string => typeof value === 'string' && value.startsWith(prefix) && SAFE_ID.test(value.slice(prefix.length))
const arrayOfRefs = (value: unknown, prefix: string): value is string[] => Array.isArray(value) && value.every((item) => ref(item, prefix)) && new Set(value).size === value.length
function add(errors: KnowledgeV04Diagnostic[], code: string, message: string, assetId?: string): void { errors.push({ code, message, ...(assetId === undefined ? {} : { assetId }) }) }

function validateExternalIdentifiers(value: unknown, sources: ReadonlySet<string>, errors: KnowledgeV04Diagnostic[], id: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) { add(errors, 'V04_EXTERNAL_IDENTIFIERS', 'externalIdentifiers must be an array', id); return }
  for (const item of value) { if (!record(item) || typeof item.namespace !== 'string' || item.namespace.trim() === '' || typeof item.value !== 'string' || item.value.trim() === '') { add(errors, 'V04_EXTERNAL_IDENTIFIERS', 'ExternalIdentifier requires namespace and value', id); continue } if (!nullableDate(item.validFrom) || !nullableDate(item.validUntil)) add(errors, 'V04_EXTERNAL_IDENTIFIERS', 'ExternalIdentifier validity dates are invalid', id); if (item.sourceRef !== undefined && item.sourceRef !== null && !sources.has(String(item.sourceRef))) add(errors, 'V04_EXTERNAL_IDENTIFIER_SOURCE', `ExternalIdentifier sourceRef does not resolve: ${String(item.sourceRef)}`, id); if (item.confidence !== undefined && item.confidence !== null && !inRange(item.confidence)) add(errors, 'V04_EXTERNAL_IDENTIFIERS', 'ExternalIdentifier confidence must be between 0 and 1', id) }
}

function validateSource(source: KnowledgeSourceV04, errors: KnowledgeV04Diagnostic[]): void {
  const id = source.id
  if (!ref(id, 'source:')) add(errors, 'V04_SOURCE_ID', 'Source id must use source: namespace', id)
  if (typeof source.title !== 'string' || source.title.trim() === '') add(errors, 'V04_REQUIRED_FIELD', 'Source title is required', id)
  if (!SOURCE_TYPES.has(source.sourceType)) add(errors, 'V04_SOURCE_TYPE', 'Source sourceType is not declared by Schema 0.4', id)
  if (source.sourceReliability !== undefined && !SOURCE_RELIABILITIES.has(source.sourceReliability)) add(errors, 'V04_SOURCE_RELIABILITY', 'Source reliability is invalid', id)
  if (!nullableDate(source.publishedAt) || !nullableDate(source.retrievedAt)) add(errors, 'V04_SOURCE_DATE', 'Source publishedAt/retrievedAt must be dates or null', id)
  if (source.canonicalUrl !== undefined && source.canonicalUrl !== null && typeof source.canonicalUrl !== 'string') add(errors, 'V04_CANONICAL_URL', 'canonicalUrl must be a string or null', id)
  if (source.contentHash !== undefined && source.contentHash !== null && (typeof source.contentHash !== 'string' || !HASH_PATTERN.test(source.contentHash))) add(errors, 'V04_CONTENT_HASH', 'contentHash must be a lowercase SHA-256 hex string or null', id)
  if (!record(source.rights)) add(errors, 'V04_SOURCE_RIGHTS', 'Source rights metadata is required', id)
  else { const rights = source.rights; if (!['public', 'authenticated', 'restricted', 'unknown'].includes(String(rights.accessScope))) add(errors, 'V04_SOURCE_RIGHTS', 'rights.accessScope is invalid', id); if (typeof rights.providerTermsKnown !== 'boolean') add(errors, 'V04_SOURCE_RIGHTS', 'rights.providerTermsKnown must be boolean', id); for (const field of ['retentionAllowed', 'aiProcessingAllowed', 'derivativeKnowledgeAllowed', 'redistributionAllowed']) { const item = rights[field]; if (item !== undefined && item !== null && typeof item !== 'boolean' && item !== 'conditional') add(errors, 'V04_SOURCE_RIGHTS', `rights.${field} must be boolean, conditional, or null`, id) } if (!nullableDate(rights.expiresAt)) add(errors, 'V04_SOURCE_RIGHTS', 'rights.expiresAt must be a date or null', id) }
  if (!record(source.usagePolicy)) add(errors, 'V04_USAGE_POLICY', 'Source usagePolicy metadata is required', id)
  else if (source.usagePolicy.mode !== 'personal_noncommercial_research' || typeof source.usagePolicy.retainRaw !== 'boolean' || typeof source.usagePolicy.allowAiProcessing !== 'boolean' || typeof source.usagePolicy.allowDerivedKnowledge !== 'boolean' || source.usagePolicy.redistributionAllowed !== false) add(errors, 'V04_USAGE_POLICY', 'usagePolicy contains invalid operational values', id)
  if (source.acquisition !== undefined && source.acquisition !== null && !record(source.acquisition)) add(errors, 'V04_ACQUISITION', 'acquisition must be an object or null', id)
  if (source.rawRefs !== undefined && (!Array.isArray(source.rawRefs) || source.rawRefs.some((item) => !RAW_PATTERN.test(item)))) add(errors, 'V04_RAW_REF', 'Source rawRefs must be valid RawRef values', id)
}

function validateEntity(entity: KnowledgeEntityV04, sources: ReadonlySet<string>, errors: KnowledgeV04Diagnostic[]): void {
  const id = entity.id
  if (!ref(id, 'entity:')) add(errors, 'V04_ENTITY_ID', 'Entity id must use entity: namespace', id)
  if (!ENTITY_TYPES.has(entity.type)) add(errors, 'V04_ENTITY_TYPE', 'Entity type is invalid', id)
  if (typeof entity.name !== 'string' || entity.name.trim() === '') add(errors, 'V04_REQUIRED_FIELD', 'Entity name is required', id)
  if (!record(entity.lifecycle) || typeof entity.lifecycle.status !== 'string') add(errors, 'V04_LIFECYCLE', 'Entity lifecycle is required', id)
  validateExternalIdentifiers((entity as unknown as Dict).externalIdentifiers, sources, errors, id)
  if (entity.type === 'security') { const security = entity as Extract<KnowledgeEntityV04, { type: 'security' }>; if (typeof security.ticker !== 'string' || security.ticker.trim() === '' || typeof security.exchange !== 'string' || security.exchange.trim() === '' || !['equity', 'bond', 'fund', 'adr', 'other'].includes(security.securityType)) add(errors, 'V04_SECURITY_IDENTITY', 'Security requires ticker, exchange, and securityType', id) }
  if (entity.type === 'institution' && (entity as Extract<KnowledgeEntityV04, { type: 'institution' }>).institutionType !== undefined && !['broker', 'investment_bank', 'fund', 'regulator', 'industry_association', 'research_institution', 'media_organization', 'other'].includes(String((entity as unknown as Dict).institutionType))) add(errors, 'V04_INSTITUTION_TYPE', 'Institution type is invalid', id)
}

function validateClaim(claim: KnowledgeClaimV04, sources: ReadonlySet<string>, claims: ReadonlySet<string>, errors: KnowledgeV04Diagnostic[]): void {
  const id = claim.id
  if (!ref(id, 'claim:')) add(errors, 'V04_CLAIM_ID', 'Claim id must use claim: namespace', id)
  if (!CLAIM_TYPES.has(claim.claimType)) add(errors, 'V04_CLAIM_TYPE', 'Claim type is invalid', id)
  if (typeof claim.statement !== 'string' || claim.statement.trim() === '') add(errors, 'V04_REQUIRED_FIELD', 'Claim statement is required', id)
  if (!Array.isArray(claim.subjectRefs) || claim.subjectRefs.length === 0 || claim.subjectRefs.some((item) => (!String(item).startsWith('entity:') && !String(item).startsWith('relation:')))) add(errors, 'V04_SUBJECT_REFS', 'Claim subjectRefs must use Entity or Relation references', id)
  if (!Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0) add(errors, 'V04_SOURCE_REFERENCE_REQUIRED', 'Claim must contain at least one Source reference', id)
  else for (const sourceRef of claim.sourceRefs) if (!sources.has(sourceRef)) add(errors, 'V04_MISSING_SOURCE_REF', `Claim sourceRef does not resolve: ${sourceRef}`, id)
  if (claim.confidence !== undefined && claim.confidence !== null && !inRange(claim.confidence)) add(errors, 'V04_CONFIDENCE', 'confidence must be between 0 and 1', id)
  if (claim.claimType === 'forecast' && !inRange(claim.probability)) add(errors, 'V04_PROBABILITY', 'Forecast probability is required and must be between 0 and 1', id)
  if (claim.claimType !== 'forecast' && claim.probability !== undefined && claim.probability !== null) add(errors, 'V04_PROBABILITY', 'probability is only valid for forecast claims', id)
  if (claim.provenance !== undefined) for (const item of claim.provenance) { if (!sources.has(item.sourceRef)) add(errors, 'V04_MISSING_PROVENANCE_SOURCE', `Provenance sourceRef does not resolve: ${item.sourceRef}`, id); if (!RAW_PATTERN.test(item.rawRef)) add(errors, 'V04_PROVENANCE_RAW_REF', 'Provenance rawRef is invalid', id) }
  if (claim.structuredValue !== undefined && claim.structuredValue !== null) { const structured = claim.structuredValue as unknown as Dict; if (Object.keys(structured).some((key) => !(KNOWLEDGE_SCHEMA_V04.claim.structuredValueFields as readonly string[]).includes(key)) || typeof structured.metric !== 'string' || structured.metric.trim() === '' || !('value' in structured) || !('unit' in structured) || (structured.unit !== null && typeof structured.unit !== 'string') || !('comparator' in structured) || (structured.comparator !== null && !KNOWLEDGE_SCHEMA_V04.claim.comparators.includes(structured.comparator as never)) || ['period', 'fiscalPeriod', 'semanticKey'].some((field) => structured[field] !== undefined && structured[field] !== null && typeof structured[field] !== 'string')) add(errors, 'V04_STRUCTURED_VALUE', 'Claim structuredValue is not valid for Schema 0.4', id) }
  for (const field of ['supportsClaimRefs', 'dependsOnClaimRefs', 'contradictsClaimRefs'] as const) for (const target of claim[field] ?? []) { if (!claims.has(target)) add(errors, 'V04_MISSING_CLAIM_REF', `${field} does not resolve: ${target}`, id); if (target === id) add(errors, 'V04_SELF_REFERENCE', `${field} cannot reference the same claim`, id) }
}

function validateEvent(event: KnowledgeEventV04, ids: ReadonlySet<string>, sources: ReadonlySet<string>, errors: KnowledgeV04Diagnostic[]): void {
  const id = event.id
  if (!ref(id, 'event:') || !EVENT_TYPES.has(event.eventType) || typeof event.title !== 'string' || event.title.trim() === '') add(errors, 'V04_EVENT', 'Event requires a valid id, eventType, and title', id)
  if (!arrayOfRefs(event.subjectRefs, 'entity:') || event.subjectRefs.some((item) => !ids.has(item))) add(errors, 'V04_EVENT_SUBJECT', 'Event subjectRefs must resolve to Entity objects', id)
  if (event.participantRefs !== undefined && (!arrayOfRefs(event.participantRefs, 'entity:') || event.participantRefs.some((item) => !ids.has(item)))) add(errors, 'V04_EVENT_PARTICIPANT', 'Event participantRefs must resolve to Entity objects', id)
  if (!record(event.temporal)) add(errors, 'V04_EVENT_TEMPORAL', 'Event temporal object is required', id)
  else for (const field of ['occurredAt', 'start', 'end', 'announcedAt'] as const) if (!nullableDate(event.temporal[field])) add(errors, 'V04_EVENT_TEMPORAL', `Event temporal.${field} is invalid`, id)
  if (!Array.isArray(event.sourceRefs) || event.sourceRefs.length === 0 || event.sourceRefs.some((item) => !sources.has(item))) add(errors, 'V04_EVENT_SOURCE', 'Event sourceRefs must resolve to Source objects', id)
  validateExternalIdentifiers(event.externalIdentifiers, sources, errors, id)
}

function validateObservation(observation: KnowledgeObservationV04, objects: ReadonlyMap<string, KnowledgeAssetV04>, ids: ReadonlySet<string>, sources: ReadonlySet<string>, observations: ReadonlyMap<string, KnowledgeObservationV04>, errors: KnowledgeV04Diagnostic[]): void {
  const id = observation.id
  if (!ref(id, 'observation:') || !OBSERVATION_TYPES.has(observation.observationType)) add(errors, 'V04_OBSERVATION', 'Observation id or observationType is invalid', id)
  if (!ids.has(observation.subjectRef) || !ref(observation.subjectRef, 'entity:')) add(errors, 'V04_OBSERVATION_SUBJECT', 'Observation subjectRef must resolve to an Entity', id)
  if (!getMetricDefinitionV04(observation.metricRef)) add(errors, 'V04_METRIC_REF', `Metric is not registered: ${String(observation.metricRef)}`, id)
  if (observation.observationType === 'metric') { if (!('value' in observation) || !observation.sourceRef || !sources.has(observation.sourceRef)) add(errors, 'V04_METRIC_OBSERVATION', 'MetricObservation requires value and Source', id); for (const field of ['observedAt', 'reportedAt', 'asOf'] as const) if (!nullableDate(observation[field])) add(errors, 'V04_OBSERVATION_TIME', `MetricObservation ${field} is invalid`, id) }
  else if (observation.observationType === 'estimate') {
    const institution = objects.get(observation.institutionRef)
    const analyst = observation.analystRef === undefined || observation.analystRef === null ? undefined : objects.get(observation.analystRef)
    if (!ids.has(observation.institutionRef) || !ref(observation.institutionRef, 'entity:') || institution?.id.startsWith('entity:') !== true || (institution as KnowledgeEntityV04 | undefined)?.type !== 'institution' || (observation.analystRef !== undefined && observation.analystRef !== null && (!ids.has(observation.analystRef) || !ref(observation.analystRef, 'entity:') || analyst?.id.startsWith('entity:') !== true || (analyst as KnowledgeEntityV04 | undefined)?.type !== 'person'))) add(errors, 'V04_ESTIMATE_PARTY', 'Estimate institutionRef/analystRef must resolve to Institution/Person Entity objects', id)
    if (!date(observation.publishedAt) || !observation.sourceRef || !sources.has(observation.sourceRef) || typeof observation.unit !== 'string' || observation.unit.trim() === '' || typeof observation.estimateValue !== 'number' || !Number.isFinite(observation.estimateValue)) add(errors, 'V04_ESTIMATE_OBSERVATION', 'EstimateObservation requires finite value, unit, publishedAt, and Source', id)
    if (observation.revisionOf !== undefined && observation.revisionOf !== null) {
      const target = observations.get(observation.revisionOf)
      if (!target || target.observationType !== 'estimate' || target.subjectRef !== observation.subjectRef || target.metricRef !== observation.metricRef || target.fiscalPeriod !== observation.fiscalPeriod || target.institutionRef !== observation.institutionRef || target.unit !== observation.unit || !date(target.publishedAt) || !date(observation.publishedAt) || Date.parse(target.publishedAt) >= Date.parse(observation.publishedAt)) add(errors, 'V04_ESTIMATE_REVISION', 'Estimate revisionOf must resolve to an older compatible Estimate Observation', id)
    }
  }
  else if (observation.observationType === 'consensus') {
    const contributors = Array.isArray(observation.contributingObservationRefs) ? observation.contributingObservationRefs.map((ref) => observations.get(ref)) : []
    const contributorEstimates = contributors.filter((item): item is Extract<KnowledgeObservationV04, { observationType: 'estimate' }> => item?.observationType === 'estimate')
    const numericFields = [observation.mean, observation.median, observation.high, observation.low, observation.dispersion]
    if (!Number.isInteger(observation.count) || observation.count < 2 || !Number.isFinite(observation.mean) || numericFields.some((value) => value !== undefined && value !== null && !Number.isFinite(value)) || !arrayOfRefs(observation.contributingObservationRefs, 'observation:') || observation.contributingObservationRefs.length !== observation.count || contributors.length !== observation.contributingObservationRefs.length || contributorEstimates.length !== contributors.length || !date(observation.asOf) || contributorEstimates.some((item) => item.subjectRef !== observation.subjectRef || item.metricRef !== observation.metricRef || item.fiscalPeriod !== observation.fiscalPeriod || typeof item.unit !== 'string' || item.unit.trim() === '' || contributorEstimates[0]?.unit !== item.unit || !date(item.publishedAt) || Date.parse(item.publishedAt) > Date.parse(observation.asOf))) add(errors, 'V04_CONSENSUS_OBSERVATION', 'ConsensusObservation requires finite statistics and homogeneous point-in-time Estimate contributors', id)
    if (observation.sourceRef !== undefined && observation.sourceRef !== null && !sources.has(observation.sourceRef)) add(errors, 'V04_CONSENSUS_SOURCE', 'Consensus sourceRef does not resolve', id)
  }
}

function hasExactKeys(value: Dict, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function validateKillCriterionOrigin(value: unknown, confirmedAt: string, sources: ReadonlyMap<string, KnowledgeSourceV04>, id: string, errors: KnowledgeV04Diagnostic[]): value is KillCriterionOriginV04 {
  if (!record(value)) { add(errors, 'V04_KILL_CRITERION_AUTHORITY', 'Kill criterion authority origin must be an object', id); return false }
  if (value.kind === 'human_rule') {
    if (!hasExactKeys(value, ['kind'])) { add(errors, 'V04_KILL_CRITERION_AUTHORITY', 'human_rule origin may contain only kind', id); return false }
    return true
  }
  if (value.kind !== 'source_derived') { add(errors, 'V04_KILL_CRITERION_AUTHORITY', 'Kill criterion origin kind must be human_rule or source_derived', id); return false }
  if (!hasExactKeys(value, ['kind', 'sourceRef', 'rawRef', 'locator', 'publishedAt'])) { add(errors, 'V04_KILL_CRITERION_AUTHORITY', 'source_derived origin has missing or unsupported fields', id); return false }
  const sourceRef = value.sourceRef
  const rawRef = value.rawRef
  const source = typeof sourceRef === 'string' ? sources.get(sourceRef) : undefined
  if (!ref(sourceRef, 'source:') || !source || typeof rawRef !== 'string' || !RAW_PATTERN.test(rawRef) || !Array.isArray(source.rawRefs) || !source.rawRefs.includes(rawRef as `raw-sha256-${string}`) || typeof value.locator !== 'string' || value.locator.trim() === '' || value.locator.length > 2048 || !date(value.publishedAt) || !date(source.publishedAt) || source.publishedAt !== value.publishedAt || Date.parse(String(value.publishedAt)) > Date.parse(confirmedAt)) {
    add(errors, 'V04_KILL_CRITERION_ORIGIN_SOURCE', 'Source-derived origin requires a resolving Source with the bound RawRef, exact locator, and matching publishedAt', id)
    return false
  }
  return true
}

function validateKillCriterionDefinition(criterion: Record<string, unknown>, id: string, errors: KnowledgeV04Diagnostic[]): boolean {
  if (!isBoundedSafeKillCriterionJsonV04(criterion.definition)) { add(errors, 'V04_KILL_CRITERION_DEFINITION', 'Kill criterion definition must be bounded safe JSON object data', id); return false }
  if (criterion.type !== 'numeric_threshold') return true
  const definition = criterion.definition
  const keys = Object.keys(definition)
  const allowed = new Set(['metricRef', 'operator', 'threshold', 'unit', 'period', 'deadline'])
  if (criterion.definitionVersion !== 1 || keys.some((key) => !allowed.has(key)) || typeof definition.metricRef !== 'string' || definition.metricRef.trim() === '' || definition.metricRef.length > 256 || !['eq', 'gt', 'gte', 'lt', 'lte'].includes(String(definition.operator)) || typeof definition.threshold !== 'number' || !Number.isFinite(definition.threshold) || typeof definition.unit !== 'string' || definition.unit.trim() === '' || definition.unit.length > 128 || typeof definition.period !== 'string' || definition.period.trim() === '' || definition.period.length > 256 || (definition.deadline !== undefined && !date(definition.deadline))) {
    add(errors, 'V04_KILL_CRITERION_NUMERIC_THRESHOLD', 'numeric_threshold V1 requires metricRef, a supported operator, finite threshold, exact unit and period, and an optional valid deadline', id)
    return false
  }
  return true
}

function validateKillCriteria(thesis: KnowledgeThesisV04, claims: ReadonlyMap<string, KnowledgeClaimV04>, sources: ReadonlyMap<string, KnowledgeSourceV04>, edges: ReadonlyMap<string, KnowledgeReasoningEdgeV04>, errors: KnowledgeV04Diagnostic[]): void {
  const id = thesis.id
  const criteria = (thesis as unknown as Dict).killCriteria
  if (criteria === undefined) return
  if (!Array.isArray(criteria) || criteria.length > KILL_CRITERION_V04_LIMITS.revisionsPerThesis) { add(errors, 'V04_KILL_CRITERIA_LIMIT', `killCriteria must be an array with at most ${KILL_CRITERION_V04_LIMITS.revisionsPerThesis} revisions`, id); return }
  const byCondition = new Map<string, Array<{ revision: number; state: unknown }>>()
  const pairs = new Set<string>()
  for (const raw of criteria) {
    if (!record(raw)) { add(errors, 'V04_KILL_CRITERION', 'Kill criterion revision must be an object', id); continue }
    const conditionId = raw.conditionId
    const revision = raw.revision
    if (typeof conditionId !== 'string' || conditionId.length > 128 || !SAFE_ID.test(conditionId) || !Number.isSafeInteger(revision) || Number(revision) <= 0 || !['active', 'superseded'].includes(String(raw.state))) {
      add(errors, 'V04_KILL_CRITERION_IDENTITY', 'Kill criterion requires a safe conditionId, positive revision, and active/superseded state', id)
      continue
    }
    const key = `${conditionId}@${revision}`
    if (pairs.has(key)) add(errors, 'V04_KILL_CRITERION_DUPLICATE_REVISION', `Duplicate kill criterion revision ${key}`, id)
    pairs.add(key)
    const revisions = byCondition.get(conditionId) ?? []
    revisions.push({ revision: Number(revision), state: raw.state })
    byCondition.set(conditionId, revisions)

    if (typeof raw.type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(raw.type) || !Number.isSafeInteger(raw.definitionVersion) || Number(raw.definitionVersion) <= 0) add(errors, 'V04_KILL_CRITERION_TYPE', 'Kill criterion requires a stable type and positive definitionVersion', id)
    const typed = validateKillCriterionDefinition(raw, id, errors)
    if (!Array.isArray(raw.targetClaimRefs) || raw.targetClaimRefs.length === 0 || raw.targetClaimRefs.length > KILL_CRITERION_V04_LIMITS.targetsPerCriterion || !arrayOfRefs(raw.targetClaimRefs, 'claim:')) add(errors, 'V04_KILL_CRITERION_TARGETS', `targetClaimRefs must contain 1 to ${KILL_CRITERION_V04_LIMITS.targetsPerCriterion} unique Claim refs`, id)
    else for (const targetRef of raw.targetClaimRefs) {
      const target = claims.get(targetRef)
      const qualifies = [...edges.values()].some((edge) => edge.type === 'qualifies' && edge.sourceRef === targetRef && edge.targetRef === id && edge.lifecycle?.status === 'active')
      if (!target) add(errors, 'V04_KILL_CRITERION_TARGET_REF', `Target Claim does not resolve: ${targetRef}`, id)
      else if (raw.state === 'active' && (target.lifecycle?.status !== 'active' || !qualifies)) add(errors, 'V04_KILL_CRITERION_TARGET_MEMBERSHIP', `Active criterion targets must be active Claims with active qualifies membership in the Thesis: ${targetRef}`, id)
    }
    if (!date(raw.effectiveAt) || String(raw.effectiveAt).length > 128) add(errors, 'V04_KILL_CRITERION_EFFECTIVE_AT', 'effectiveAt must be a valid date', id)
    const authority = raw.authority
    let origin: KillCriterionOriginV04 | undefined
    if (!record(authority) || !hasExactKeys(authority, ['workflowRunId', 'confirmedAt', 'origin']) || typeof authority.workflowRunId !== 'string' || authority.workflowRunId.length > 128 || !SAFE_ID.test(authority.workflowRunId) || !date(authority.confirmedAt) || String(authority.confirmedAt).length > 128) add(errors, 'V04_KILL_CRITERION_AUTHORITY', 'Authority requires only workflowRunId, confirmedAt, and origin', id)
    else {
      if (date(raw.effectiveAt) && Date.parse(String(raw.effectiveAt)) < Date.parse(String(authority.confirmedAt))) add(errors, 'V04_KILL_CRITERION_TIME', 'effectiveAt must not predate authority.confirmedAt', id)
      if (validateKillCriterionOrigin(authority.origin, String(authority.confirmedAt), sources, id, errors)) origin = authority.origin
    }
    if (typeof raw.definitionHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(raw.definitionHash)) add(errors, 'V04_KILL_CRITERION_HASH', 'definitionHash must be a canonical sha256 hash', id)
    else if (typed && origin && Array.isArray(raw.targetClaimRefs) && raw.type && Number.isSafeInteger(raw.definitionVersion)) {
      try {
        const expected = hashKillCriterionDefinitionV04({ type: raw.type as string, definitionVersion: Number(raw.definitionVersion), definition: raw.definition as Record<string, unknown>, targetClaimRefs: raw.targetClaimRefs as string[], origin })
        if (raw.definitionHash !== expected) add(errors, 'V04_KILL_CRITERION_HASH', 'definitionHash does not match immutable criterion meaning', id)
      } catch { add(errors, 'V04_KILL_CRITERION_HASH', 'definitionHash cannot be computed from criterion meaning', id) }
    }
  }
  for (const [conditionId, revisions] of byCondition) {
    revisions.sort((left, right) => left.revision - right.revision)
    const active = revisions.filter((revision) => revision.state === 'active')
    if (active.length > 1) add(errors, 'V04_KILL_CRITERION_ACTIVE_REVISION', `conditionId ${conditionId} has more than one active revision`, id)
    if (revisions.some((revision, index) => revision.revision !== index + 1 || (index < revisions.length - 1 && revision.state !== 'superseded') || (revision.state === 'active' && index !== revisions.length - 1))) add(errors, 'V04_KILL_CRITERION_REVISION_ORDER', `conditionId ${conditionId} revisions must be contiguous, increasing, and superseded before the latest revision`, id)
  }
}

function validateThesis(thesis: KnowledgeThesisV04, ids: ReadonlySet<string>, claims: ReadonlyMap<string, KnowledgeClaimV04>, sources: ReadonlyMap<string, KnowledgeSourceV04>, edges: ReadonlyMap<string, KnowledgeReasoningEdgeV04>, errors: KnowledgeV04Diagnostic[]): void { const id = thesis.id; if (!ref(id, 'thesis:') || !Array.isArray(thesis.subjectRefs) || thesis.subjectRefs.length === 0 || thesis.subjectRefs.some((item) => !ids.has(item) || !ref(item, 'entity:')) || typeof thesis.title !== 'string' || thesis.title.trim() === '' || typeof thesis.statement !== 'string' || thesis.statement.trim() === '' || !THESIS_STATUSES.has(thesis.status) || !date(thesis.createdAt)) add(errors, 'V04_THESIS', 'Thesis requires valid identity, subject, title, statement, status, and createdAt', id); validateKillCriteria(thesis, claims, sources, edges, errors) }

function validateReasoningEdge(edge: KnowledgeReasoningEdgeV04, objects: ReadonlyMap<string, KnowledgeAssetV04>, sources: ReadonlySet<string>, errors: KnowledgeV04Diagnostic[]): void { const id = edge.id; const source = objects.get(edge.sourceRef); const target = objects.get(edge.targetRef); const sourceKind = source?.id.split(':', 1)[0]; const targetKind = target?.id.split(':', 1)[0]; if (!ref(id, 'reasoning-edge:') || !EDGE_TYPES.has(edge.type) || !source || !target) add(errors, 'V04_REASONING_EDGE', 'ReasoningEdge requires resolvable endpoints', id); if (!((sourceKind === 'observation' || sourceKind === 'claim') && (targetKind === 'claim' || targetKind === 'thesis'))) add(errors, 'V04_REASONING_ENDPOINT', 'ReasoningEdge endpoints must be Observation/Claim to Claim/Thesis', id); if (edge.sourceRef === edge.targetRef || sourceKind === 'source' || sourceKind === 'raw-sha256-' || sourceKind === 'theme-group') add(errors, 'V04_REASONING_ENDPOINT', 'ReasoningEdge endpoint is not an admissible research dependency', id); if (edge.sourceRefs?.some((item) => !sources.has(item))) add(errors, 'V04_REASONING_SOURCE', 'ReasoningEdge sourceRefs must resolve to Source objects', id); if (edge.confidence !== undefined && edge.confidence !== null && !inRange(edge.confidence)) add(errors, 'V04_CONFIDENCE', 'ReasoningEdge confidence must be between 0 and 1', id); if (!nullableDate(edge.asOf)) add(errors, 'V04_REASONING_TIME', 'ReasoningEdge asOf must be a date or null', id) }

function validateCycles(claims: ReadonlyMap<string, KnowledgeClaimV04>, errors: KnowledgeV04Diagnostic[]): void { const indegree = new Map([...claims.keys()].map((id) => [id, 0])); const outgoing = new Map([...claims.keys()].map((id) => [id, [] as string[]])); for (const [id, claim] of claims) for (const target of [...claim.supportsClaimRefs ?? [], ...claim.dependsOnClaimRefs ?? [], ...claim.contradictsClaimRefs ?? []]) if (claims.has(target)) { outgoing.get(target)!.push(id); indegree.set(id, indegree.get(id)! + 1) } const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort(); let visited = 0; while (queue.length) { const id = queue.shift()!; visited += 1; for (const next of outgoing.get(id)!.sort()) { const degree = indegree.get(next)! - 1; indegree.set(next, degree); if (degree === 0) queue.push(next) } } if (visited !== claims.size) add(errors, 'V04_DEPENDENCY_CYCLE', 'Claim dependency graph contains a deterministic cycle') }

function active(value: unknown): boolean {
  return record(value) && record(value.lifecycle) && value.lifecycle.status === 'active'
}

function competitionKnowledgeRelevant(value: Dict, kind: string, companyRef: string, relations: ReadonlyMap<string, KnowledgeRelationV04>): boolean {
  if (kind === 'claim') {
    if (!Array.isArray(value.subjectRefs)) return false
    return value.subjectRefs.some((subjectRef) => {
      if (subjectRef === companyRef) return true
      if (typeof subjectRef !== 'string' || !subjectRef.startsWith('relation:')) return false
      const relation = relations.get(subjectRef)
      return relation?.sourceRef === companyRef || relation?.targetRef === companyRef
    })
  }
  if (kind === 'observation') return value.subjectRef === companyRef
  if (kind === 'relation') return value.sourceRef === companyRef || value.targetRef === companyRef
  return false
}

function hasVerifiableRelationEvidence(
  relation: KnowledgeRelationV04,
  sources: ReadonlySet<string>,
  claims: ReadonlyMap<string, KnowledgeClaimV04>,
): boolean {
  const hasSource = Array.isArray(relation.sourceRefs)
    && relation.sourceRefs.some((sourceRef) => typeof sourceRef === 'string' && sources.has(sourceRef))
  if (hasSource) return true
  return Array.isArray(relation.supportingClaimRefs)
    && relation.supportingClaimRefs.some((claimRef) => {
      const claim = claims.get(claimRef)
      return claim !== undefined
        && Array.isArray(claim.subjectRefs)
        && claim.subjectRefs.includes(relation.id)
        && Array.isArray(claim.sourceRefs)
        && claim.sourceRefs.some((sourceRef) => typeof sourceRef === 'string' && sources.has(sourceRef))
    })
}

interface CompetitionNumericFact {
  readonly ref: string
  readonly value: unknown
  readonly unit: unknown
  readonly exactAmount?: boolean
  readonly asOf?: unknown
  readonly fiscalPeriod?: unknown
}

function isCanonicalCompetitionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function annualFiscalYear(period: unknown): number | undefined {
  if (typeof period !== 'string' || !/^FY\d{4}$/.test(period)) return undefined
  const year = Number(period.slice(2))
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : undefined
}

function validateCompetitionNumericCell(
  cell: Dict,
  role: 'market_cap' | 'annual_revenue',
  knowledgeRefs: readonly unknown[],
  claims: ReadonlyMap<string, KnowledgeClaimV04>,
  observations: ReadonlyMap<string, KnowledgeObservationV04>,
  moduleId: string,
  rowIndex: number,
  cellId: string,
  errors: KnowledgeV04Diagnostic[],
): void {
  const metricRef = role === 'market_cap' ? 'metric:market_cap' : 'metric:revenue'
  const facts: CompetitionNumericFact[] = []
  for (const refValue of knowledgeRefs) {
    if (typeof refValue !== 'string') continue
    if (refValue.startsWith('claim:')) {
      const claim = claims.get(refValue)
      const structured = claim && record(claim.structuredValue) ? claim.structuredValue as unknown as Dict : undefined
      if (structured?.metric !== metricRef) continue
      facts.push({
        ref: refValue,
        value: structured.value,
        unit: structured.unit,
        exactAmount: claim?.claimType === 'fact' && structured.comparator === 'eq',
        ...(role === 'market_cap' ? { asOf: record(claim?.temporal) ? claim.temporal.asOf : undefined } : { fiscalPeriod: structured.fiscalPeriod }),
      })
      continue
    }
    if (!refValue.startsWith('observation:')) continue
    const observation = observations.get(refValue)
    if (observation?.observationType !== 'metric' || observation.metricRef !== metricRef) continue
    facts.push({
      ref: refValue,
      value: observation.value,
      unit: observation.unit,
      ...(role === 'market_cap' ? { asOf: observation.asOf } : { fiscalPeriod: observation.period }),
    })
  }

  const location = `Competition row ${rowIndex} ${cellId} cell`
  if (facts.length === 0) {
    add(errors, 'V04_COMPETITION_MODULE_NUMERIC_FACT_REQUIRED', `${location} requires a matching numeric ${metricRef} Claim or metric Observation`, moduleId)
    return
  }

  const factsWithValues = facts.filter((fact) => typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.exactAmount !== false)
  if (factsWithValues.length !== facts.length) {
    add(errors, 'V04_COMPETITION_MODULE_NUMERIC_FACT_INVALID', `${location} references a matching ${metricRef} fact that is not an exact finite numeric fact`, moduleId)
  }

  const displayValue = cell.displayValue
  const cellUnit = cell.unit
  const cellCurrency = cell.currency
  if (!isSupportedBaseCurrencyCodeV1(cellUnit) || cellCurrency !== cellUnit) {
    add(errors, 'V04_COMPETITION_MODULE_NUMERIC_UNIT', `${location} unit and currency must both be a supported base ISO currency code`, moduleId)
  }

  for (const fact of facts) {
    if (!isSupportedBaseCurrencyCodeV1(fact.unit)) {
      add(errors, 'V04_COMPETITION_MODULE_NUMERIC_UNIT', `${location} reference ${fact.ref} must store its value in a supported base ISO currency unit`, moduleId)
    } else if (fact.unit !== cellUnit || fact.unit !== cellCurrency) {
      add(errors, 'V04_COMPETITION_MODULE_NUMERIC_UNIT', `${location} unit and currency must match the cited fact unit ${fact.unit}`, moduleId)
    }

    if (role === 'market_cap') {
      if (!isCanonicalCompetitionDate(fact.asOf)) {
        add(errors, 'V04_COMPETITION_MODULE_NUMERIC_AS_OF', `${location} reference ${fact.ref} must have an explicit YYYY-MM-DD asOf`, moduleId)
      } else if (fact.asOf !== cell.asOf) {
        add(errors, 'V04_COMPETITION_MODULE_NUMERIC_AS_OF', `${location} asOf must match the cited fact asOf ${fact.asOf}`, moduleId)
      }
    } else {
      const year = annualFiscalYear(fact.fiscalPeriod)
      if (year === undefined) {
        add(errors, 'V04_COMPETITION_MODULE_NUMERIC_FISCAL_PERIOD', `${location} reference ${fact.ref} must have an explicit annual FYyyyy fiscal period`, moduleId)
      } else if (year !== cell.fiscalYear) {
        add(errors, 'V04_COMPETITION_MODULE_NUMERIC_FISCAL_PERIOD', `${location} fiscalYear must match the cited fact fiscal period ${fact.fiscalPeriod}`, moduleId)
      }
    }
  }

  const first = factsWithValues[0]
  if (first && typeof displayValue === 'string' && displayValue !== String(first.value)) {
    add(errors, 'V04_COMPETITION_MODULE_NUMERIC_DISPLAY', `${location} displayValue must equal String(${String(first.value)}) from cited numeric fact ${first.ref}`, moduleId)
  }
  if (first && factsWithValues.some((fact) => fact.value !== first.value || fact.unit !== first.unit
    || (role === 'market_cap' ? fact.asOf !== first.asOf : fact.fiscalPeriod !== first.fiscalPeriod))) {
    add(errors, 'V04_COMPETITION_MODULE_NUMERIC_FACT_CONFLICT', `${location} matching numeric fact references must agree on value, currency unit, and period`, moduleId)
  }
}

function validateCompetitionModule(
  module: Dict,
  moduleId: string,
  entities: ReadonlyMap<string, Dict>,
  sources: ReadonlySet<string>,
  claims: ReadonlyMap<string, KnowledgeClaimV04>,
  observations: ReadonlyMap<string, KnowledgeObservationV04>,
  relations: ReadonlyMap<string, KnowledgeRelationV04>,
  businessExposurePairs: ReadonlySet<string>,
  errors: KnowledgeV04Diagnostic[],
): void {
  const structural = validateCompetitionModuleV1(module)
  for (const issue of structural.issues) {
    add(errors, 'V04_COMPETITION_MODULE_SCHEMA', `${issue.path}: ${issue.message} (${issue.code})`, moduleId)
  }

  const targetEntity = typeof module.targetEntity === 'string' ? entities.get(module.targetEntity) : undefined
  const targetIsIndustry = targetEntity?.type === 'industry' && active(targetEntity)
  if (!targetIsIndustry) {
    add(errors, 'V04_COMPETITION_MODULE_TARGET', 'Competition targetEntity must resolve to an active Industry Entity', moduleId)
  }

  if (Array.isArray(module.sourceRefs)) {
    const inspectedSourceRefs = Math.min(module.sourceRefs.length, COMPETITION_MODULE_V1_LIMITS.maxSourceRefs)
    for (let index = 0; index < inspectedSourceRefs; index += 1) {
      const sourceRef = module.sourceRefs[index]
      if (typeof sourceRef === 'string' && !sources.has(sourceRef)) {
        add(errors, 'V04_COMPETITION_MODULE_SOURCE_REF', `Competition sourceRef does not resolve to a Source: ${sourceRef}`, moduleId)
      }
    }
  }

  if (!Array.isArray(module.rows)) return
  const inspectedRows = Math.min(module.rows.length, COMPETITION_MODULE_V1_LIMITS.maxRows)
  const cellColumns: Array<{ id: string; role: string }> = []
  if (Array.isArray(module.columns)) {
    const inspectedColumns = Math.min(module.columns.length, COMPETITION_MODULE_V1_LIMITS.maxColumns)
    for (let columnIndex = 0; columnIndex < inspectedColumns; columnIndex += 1) {
      const column = module.columns[columnIndex]
      if (record(column) && column.role !== 'company' && typeof column.id === 'string' && typeof column.role === 'string') cellColumns.push({ id: column.id, role: column.role })
    }
  }
  for (let rowIndex = 0; rowIndex < inspectedRows; rowIndex += 1) {
    const rowValue = module.rows[rowIndex]
    if (!record(rowValue)) continue
    const companyRef = typeof rowValue.companyRef === 'string' ? rowValue.companyRef : undefined
    const company = companyRef === undefined ? undefined : entities.get(companyRef)
    const companyIsActive = company?.type === 'company' && active(company)
    if (!companyIsActive) {
      add(errors, 'V04_COMPETITION_MODULE_COMPANY', `Competition row ${rowIndex} companyRef must resolve to an active Company Entity`, moduleId)
    }

    if (companyIsActive && targetIsIndustry) {
      const hasBusinessExposure = businessExposurePairs.has(`${companyRef}\u0000${String(module.targetEntity)}`)
      if (!hasBusinessExposure) {
        add(errors, 'V04_COMPETITION_MODULE_BUSINESS_EXPOSURE', `Competition row ${rowIndex} requires an active, evidence-backed business_exposure Relation from its Company to the target Industry`, moduleId)
      }
    }

    if (!record(rowValue.cells)) continue
    for (const { id: cellId, role } of cellColumns) {
      const cellValue = rowValue.cells[cellId]
      if (!record(cellValue) || cellValue.status !== 'available' || !Array.isArray(cellValue.knowledgeRefs)) continue
      const inspectedKnowledgeRefs = Math.min(cellValue.knowledgeRefs.length, COMPETITION_MODULE_V1_LIMITS.maxCellKnowledgeRefs)
      for (let index = 0; index < inspectedKnowledgeRefs; index += 1) {
        const knowledgeRef = cellValue.knowledgeRefs[index]
        if (typeof knowledgeRef !== 'string') continue
        const [kind] = knowledgeRef.split(':', 1)
        const resolved = kind === 'claim' ? claims.get(knowledgeRef)
          : kind === 'observation' ? observations.get(knowledgeRef)
            : kind === 'relation' ? relations.get(knowledgeRef)
              : undefined
        if (!resolved) {
          add(errors, 'V04_COMPETITION_MODULE_KNOWLEDGE_REF', `Competition cell knowledgeRef does not resolve to a Claim, Observation, or Relation: ${knowledgeRef}`, moduleId)
          continue
        }
        if (companyIsActive && !competitionKnowledgeRelevant(resolved as unknown as Dict, kind, companyRef!, relations)) {
          add(errors, 'V04_COMPETITION_MODULE_KNOWLEDGE_RELEVANCE', `Competition cell knowledgeRef is not relevant to row Company ${companyRef}: ${knowledgeRef}`, moduleId)
        }
      }
      if (role === 'market_cap' || role === 'annual_revenue') {
        validateCompetitionNumericCell(cellValue, role, cellValue.knowledgeRefs, claims, observations, moduleId, rowIndex, cellId, errors)
      }
    }
  }
}

export function validateKnowledgeV04Objects(objects: readonly KnowledgeAssetV04[]): KnowledgeV04ValidationReport {
  const errors: KnowledgeV04Diagnostic[] = []
  const candidates: readonly unknown[] = Array.isArray(objects) ? objects : []
  if (!Array.isArray(objects)) add(errors, 'V04_OBJECTS', 'Canonical objects must be an array')

  const ids = new Set<string>()
  const sources = new Map<string, KnowledgeSourceV04>()
  const claims = new Map<string, KnowledgeClaimV04>()
  const relations = new Map<string, KnowledgeRelationV04>()
  const entities = new Map<string, string>()
  const entityObjects = new Map<string, Dict>()
  const modules = new Map<string, Dict>()
  const events = new Map<string, KnowledgeEventV04>()
  const observations = new Map<string, KnowledgeObservationV04>()
  const theses = new Map<string, KnowledgeThesisV04>()
  const edges = new Map<string, KnowledgeReasoningEdgeV04>()
  const objectMap = new Map<string, KnowledgeAssetV04>()

  for (const object of candidates) {
    if (!record(object) || typeof object.id !== 'string') {
      add(errors, 'V04_OBJECT', 'Canonical object must have a string id')
      continue
    }
    const id = object.id
    if (ids.has(id)) add(errors, 'V04_DUPLICATE_ID', `Duplicate canonical id: ${id}`, id)
    ids.add(id)
    objectMap.set(id, object as unknown as KnowledgeAssetV04)
    if (id.startsWith('source:')) sources.set(id, object as unknown as KnowledgeSourceV04)
    else if (id.startsWith('claim:')) claims.set(id, object as unknown as KnowledgeClaimV04)
    else if (id.startsWith('relation:')) relations.set(id, object as unknown as KnowledgeRelationV04)
    else if (id.startsWith('entity:')) {
      entities.set(id, String(object.type))
      entityObjects.set(id, object)
    } else if (id.startsWith('module:')) modules.set(id, object)
    else if (id.startsWith('event:')) events.set(id, object as unknown as KnowledgeEventV04)
    else if (id.startsWith('observation:')) observations.set(id, object as unknown as KnowledgeObservationV04)
    else if (id.startsWith('thesis:')) theses.set(id, object as unknown as KnowledgeThesisV04)
    else if (id.startsWith('reasoning-edge:')) edges.set(id, object as unknown as KnowledgeReasoningEdgeV04)
  }

  const sourceIds = new Set(sources.keys())
  const claimIds = new Set(claims.keys())
  for (const object of candidates) {
    if (!record(object) || typeof object.id !== 'string') continue
    if (object.id.startsWith('entity:')) validateEntity(object as unknown as KnowledgeEntityV04, sourceIds, errors)
  }
  for (const source of sources.values()) validateSource(source, errors)
  for (const claim of claims.values()) validateClaim(claim, sourceIds, claimIds, errors)
  for (const relation of relations.values()) {
    const definition = typeof relation.type === 'string' ? KNOWLEDGE_SCHEMA_V04.relation.definitions[relation.type as keyof typeof KNOWLEDGE_SCHEMA_V04.relation.definitions] : undefined
    const sourceType = entities.get(relation.sourceRef)
    const targetType = entities.get(relation.targetRef)
    if (!definition || !KNOWLEDGE_SCHEMA_V04.relation.types.includes(relation.type as never)) add(errors, 'V04_RELATION_TYPE', 'Relation type is not declared by Schema 0.4', relation.id)
    if (!sourceType || !targetType) add(errors, 'V04_RELATION_ENDPOINT', 'Relation endpoints must resolve to Entity objects', relation.id)
    if (definition && sourceType && targetType && (!(definition.sourceTypes as readonly string[]).includes(sourceType) || !(definition.targetTypes as readonly string[]).includes(targetType) || ('endpointConstraint' in definition && definition.endpointConstraint === 'same_entity_type_on_both_sides' && sourceType !== targetType))) add(errors, 'V04_RELATION_SEMANTICS', 'Relation endpoint types violate the Schema 0.4 semantic definition', relation.id)
    if (relation.sourceRefs?.some((item) => !sourceIds.has(item))) add(errors, 'V04_RELATION_SOURCE_REF', 'Relation sourceRefs must resolve to Source objects', relation.id)
    if (relation.supportingClaimRefs?.some((item) => !claimIds.has(item))) add(errors, 'V04_RELATION_CLAIM_REF', 'Relation supportingClaimRefs must resolve to Claim objects', relation.id)
    if (!validateRelationAttributesV03(relation.type, relation.attributes).valid) add(errors, 'V04_RELATION_ATTRIBUTES', 'Relation attributes are not admissible for Schema 0.4', relation.id)
  }
  const businessExposurePairs = new Set<string>()
  for (const relation of relations.values()) {
    if (relation.type !== 'business_exposure' || !active(relation) || !hasVerifiableRelationEvidence(relation, sourceIds, claims)) continue
    if (typeof relation.sourceRef !== 'string' || typeof relation.targetRef !== 'string') continue
    businessExposurePairs.add(`${relation.sourceRef}\u0000${relation.targetRef}`)
  }
  for (const event of events.values()) validateEvent(event, ids, sourceIds, errors)
  for (const observation of observations.values()) validateObservation(observation, objectMap, ids, sourceIds, observations, errors)
  for (const thesis of theses.values()) validateThesis(thesis, ids, claims, sources, edges, errors)
  for (const edge of edges.values()) validateReasoningEdge(edge, objectMap, sourceIds, errors)
  for (const [id, module] of modules) if (module.type === 'competition') {
    validateCompetitionModule(module, id, entityObjects, sourceIds, claims, observations, relations, businessExposurePairs, errors)
  }
  validateCycles(claims, errors)
  return { status: errors.length === 0 ? 'passed' : 'failed', errors }
}
export function assertKnowledgeV04Objects(objects: readonly KnowledgeAssetV04[]): void { const report = validateKnowledgeV04Objects(objects); if (report.status === 'failed') throw new Error(report.errors.map((error) => `${error.code}: ${error.message}`).join('; ')) }
export function isKnowledgeV04RawRef(value: unknown): value is string { return typeof value === 'string' && RAW_PATTERN.test(value) }
