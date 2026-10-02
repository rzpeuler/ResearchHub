import { archiveRaw, verifyRaw } from '../raw/raw-archive.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { allocateEntityId, allocateKnowledgeId, normalizeSemanticText } from '../registry/id-allocation.ts'
import { normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import type { EntityRefV04, ExternalIdentifierV04, KillCriterionV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEntityV04, KnowledgeEventV04, KnowledgeModuleV04, KnowledgeObservationV04, KnowledgeReasoningEdgeV04, KnowledgeRelationV04, KnowledgeSourceV04, KnowledgeThesisV04 } from '../schema/domain-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, validateCompetitionModuleV1 } from '../schema/competition-module-v04.ts'
import type { CompetitionCellKnowledgeRefV1, CompetitionModuleV1, CompetitionRowV1 } from '../schema/competition-module-v04.ts'
import { getMetricDefinitionV04 } from '../schema/metric-registry.ts'
import { KNOWLEDGE_SCHEMA_V04 } from '../schema/executable-schema-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import { validateRelationAttributesV03 } from '../validation/v03-validation-core.ts'
import { validateKnowledgeChangeSetV04 } from '../validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../writer/writer.ts'
import { validateUsableAcquisitionPayload } from '../../plugins/research-acquisition/payload-validation.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { isBoundedSafeKillCriterionJsonV04 } from '../schema/kill-criterion-v04.ts'
import { persistReviewCases } from '../review/store.ts'
import type { ReviewCase } from '../review/contracts.ts'
import type { CompetitionModuleKnowledgeSelectorV1, CompetitionModuleProductionProposal, KnowledgeProductionInput, KnowledgeProductionOutcome, ResolutionIntentSummary, SemanticProductionInputProposal, SemanticProductionProposal, SemanticResolver } from './contracts.ts'

type Dict = Record<string, unknown>
type AssetMap = Map<string, KnowledgeAssetV04>
type EntityType = 'company' | 'industry' | 'product' | 'technology' | 'person' | 'institution' | 'security'
type RawRef = `raw-sha256-${string}`
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const relationTypes = new Set<string>(KNOWLEDGE_SCHEMA_V04.relation.types)
const reasoningEdgeTypes = new Set<string>(KNOWLEDGE_SCHEMA_V04.reasoningEdge.types)
const claimTypes = new Set(['fact', 'forecast', 'viewpoint', 'trend', 'risk', 'assumption', 'thesis', 'catalyst'])
const record = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const ident = (v: unknown) => normalizeSemanticText(String(v ?? ''))
const intent = (intentId: string, disposition: ResolutionIntentSummary['disposition'], reason: string, fields: Partial<ResolutionIntentSummary> = {}): ResolutionIntentSummary => ({ intentId, disposition, reason, ...fields })

function exactRecord(value: unknown, fields: readonly string[], required: readonly string[] = fields): value is Dict {
  return record(value) && Object.keys(value).every((key) => fields.includes(key)) && required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
function validEntitySelector(value: unknown): boolean {
  return record(value) && Object.keys(value).length === 1
    && ((typeof value.localKey === 'string' && safeId.test(value.localKey))
      || (typeof value.existingRef === 'string' && /^entity:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.existingRef)))
}
function validRelationSelector(value: unknown): boolean {
  return record(value) && Object.keys(value).length === 1
    && ((typeof value.proposalId === 'string' && safeId.test(value.proposalId))
      || (typeof value.existingRef === 'string' && /^relation:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.existingRef)))
}
function createOutcome(input: KnowledgeProductionInput, status: 'blocked' | 'failed', errors: readonly string[], intents: readonly ResolutionIntentSummary[] = [], entities: Readonly<Record<string, string>> = {}, relations: Readonly<Record<string, string>> = {}, sources: Readonly<Record<string, string>> = {}, claims: Readonly<Record<string, string>> = {}, modules: Readonly<Record<string, string>> = {}): KnowledgeProductionOutcome {
  return { status, knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: sources, claimRefsByProposalId: claims, entityRefsByLocalKey: entities, relationRefsByProposalId: relations, moduleRefsByProposalId: modules, resolutionIntents: intents, errors }
}
function companyFields(input: KnowledgeProductionInput) { const f = input.entity.semanticFields ?? {}; return { ...(text(f.ticker) ? { ticker: text(f.ticker) } : {}), ...(text(f.exchange) ? { exchange: normalizeExchange(text(f.exchange)) } : {}), ...(input.entity.externalIdentifiers === undefined ? {} : { externalIdentifiers: input.entity.externalIdentifiers }) } }
function companyMatch(o: KnowledgeAssetV04, f: { ticker?: string; exchange?: string }) { const v = o as KnowledgeEntityV04 & Dict; const existingExchange = text(v.exchange); const requestedExchange = text(f.exchange); return o.id.startsWith('entity:') && v.type === 'company' && f.ticker !== undefined && ident(v.ticker) === ident(f.ticker) && (!requestedExchange || (Boolean(existingExchange) && ident(normalizeExchange(existingExchange)) === ident(normalizeExchange(requestedExchange)))) }
function nonRootCompanyIdentity(semanticFields: Readonly<Record<string, unknown>> | undefined): { ticker: string; exchange: string } | undefined {
  const ticker = text(semanticFields?.ticker)
  const exchange = text(semanticFields?.exchange)
  return ticker && exchange ? { ticker, exchange: normalizeExchange(exchange) } : undefined
}
function normalizeNonRootCompanyFields(entityType: EntityType, semanticFields: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!record(semanticFields) || entityType !== 'company') return record(semanticFields) ? semanticFields : undefined
  return {
    ...semanticFields,
    ...(typeof semanticFields.ticker === 'string' && text(semanticFields.ticker) ? { ticker: text(semanticFields.ticker) } : {}),
    ...(typeof semanticFields.exchange === 'string' && text(semanticFields.exchange) ? { exchange: normalizeExchange(text(semanticFields.exchange)) } : {}),
  }
}
function entityProposalAliases(value: unknown): readonly string[] {
  if (!record(value) || !Array.isArray(value.aliases)) return []
  return uniqueSorted(value.aliases.filter((alias): alias is string => typeof alias === 'string' && Boolean(text(alias))).map(text))
}
function nameMatch(o: KnowledgeAssetV04, type: EntityType, name: string, aliases: readonly string[]) { if (!o.id.startsWith('entity:')) return false; const v = o as KnowledgeEntityV04; const names = [v.name, ...(v.aliases ?? [])].map(ident); return v.type === type && (names.includes(ident(name)) || aliases.some((a) => names.includes(ident(a)))) }
function mergeEntity(e: KnowledgeEntityV04, i: { aliases: readonly string[]; semanticFields?: Readonly<Record<string, unknown>>; externalIdentifiers?: readonly ExternalIdentifierV04[]; allowDescription?: boolean }) { const v = e as unknown as Dict; const merged: Dict = { ...v, aliases: [...new Set([...(e.aliases ?? []), ...i.aliases])].sort() }; for (const k of ['ticker', 'exchange', 'legalName']) if (typeof i.semanticFields?.[k] === 'string' && !merged[k]) merged[k] = i.semanticFields[k]; if (i.allowDescription && typeof i.semanticFields?.description === 'string' && !text(merged.description)) merged.description = text(i.semanticFields.description); const identifiers = [...(Array.isArray((e as unknown as Dict).externalIdentifiers) ? (e as unknown as Dict).externalIdentifiers as ExternalIdentifierV04[] : []), ...(i.externalIdentifiers ?? [])]; if (identifiers.length) merged.externalIdentifiers = [...new Map(identifiers.map((item) => [`${item.namespace}|${item.value}|${item.validFrom ?? ''}|${item.validUntil ?? ''}`, item])).values()]; return merged as unknown as KnowledgeEntityV04 }
function validExternalIdentifiers(value: unknown): value is readonly ExternalIdentifierV04[] { return value === undefined || (Array.isArray(value) && value.every((item) => record(item) && typeof item.namespace === 'string' && item.namespace.trim() !== '' && typeof item.value === 'string' && item.value.trim() !== '' && (item.validFrom === undefined || item.validFrom === null || (typeof item.validFrom === 'string' && !Number.isNaN(Date.parse(item.validFrom)))) && (item.validUntil === undefined || item.validUntil === null || (typeof item.validUntil === 'string' && !Number.isNaN(Date.parse(item.validUntil)))) && (item.confidence === undefined || item.confidence === null || (typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1)))) }
function validStructured(v: unknown): Dict | undefined { return record(v) && typeof v.metric === 'string' && Boolean(v.metric.trim()) && 'value' in v && 'unit' in v && 'comparator' in v ? v : undefined }
function claimIdentity(p: SemanticProductionProposal, subjectRef: string) { return { claimType: p.claimType, statement: ident(p.statement), subjectRefs: [subjectRef], temporal: p.temporal ?? null, structuredValue: validStructured(p.structuredValue) ?? null } }
function exactClaim(o: KnowledgeAssetV04, id: Dict) { if (!o.id.startsWith('claim:')) return false; const c = o as KnowledgeClaimV04; return hashKnowledgeObject({ claimType: c.claimType, statement: ident(c.statement), subjectRefs: c.subjectRefs, temporal: c.temporal ?? null, structuredValue: c.structuredValue ?? null }) === hashKnowledgeObject(id) }
function frozenClaimFields(c: KnowledgeClaimV04, p: SemanticProductionProposal, subjectRef: string) { const incoming = validStructured(p.structuredValue); const prior = validStructured(c.structuredValue); if (!incoming || !prior) return false; return c.claimType === p.claimType && ident(c.statement) === ident(p.statement) && hashKnowledgeObject(c.subjectRefs) === hashKnowledgeObject([subjectRef]) && hashKnowledgeObject(c.temporal ?? null) === hashKnowledgeObject(p.temporal ?? null) && incoming.metric === prior.metric && incoming.unit === prior.unit && incoming.comparator === prior.comparator && incoming.period === prior.period && incoming.fiscalPeriod === prior.fiscalPeriod }
type EvidenceRef = { sourceRef: `source:${string}`; rawRef: RawRef; locator?: string }
function mergeClaimEvidence(c: KnowledgeClaimV04, ev: readonly EvidenceRef[]) { const provenance = ev.map((x) => ({ sourceRef: x.sourceRef, rawRef: x.rawRef, locator: x.locator ?? null, chunkRef: null })); return { ...c, sourceRefs: [...new Set([...(c.sourceRefs ?? []), ...ev.map((x) => x.sourceRef)])], provenance: [...new Map([...(c.provenance ?? []), ...provenance].map((x) => [`${x.sourceRef}|${x.rawRef}|${x.locator ?? ''}`, x])).values()] } as KnowledgeClaimV04 }
function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort() }
function canonicalSourceRefs(ev: readonly { sourceRef: `source:${string}`; rawRef: RawRef }[]): readonly `source:${string}`[] { return uniqueSorted(ev.map((item) => item.sourceRef)) as `source:${string}`[] }
function canonicalProvenance(ev: readonly EvidenceRef[]) { return [...new Map(ev.map((item) => [`${item.sourceRef}|${item.rawRef}|${item.locator ?? ''}`, { sourceRef: item.sourceRef, rawRef: item.rawRef, locator: item.locator ?? null, chunkRef: null }])).values()].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef) || left.rawRef.localeCompare(right.rawRef) || String(left.locator ?? '').localeCompare(String(right.locator ?? ''))) }
function validLocator(value: unknown): value is string { return typeof value === 'string' && value.trim() !== '' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) }
function validConfirmedCriterion(value: unknown, producerRunId: string): value is KillCriterionV04 {
  if (!record(value) || Object.keys(value).some((key) => !['conditionId', 'revision', 'state', 'type', 'definitionVersion', 'definition', 'targetClaimRefs', 'effectiveAt', 'definitionHash', 'authority'].includes(key)) || Object.keys(value).length !== 10) return false
  if (value.state !== 'active' || value.type !== 'numeric_threshold' || value.definitionVersion !== 1 || !record(value.definition) || !isBoundedSafeKillCriterionJsonV04(value.definition)) return false
  const authority = value.authority
  if (!record(authority) || authority.workflowRunId !== producerRunId || Object.keys(authority).length !== 3 || Object.keys(authority).some((key) => !['workflowRunId', 'confirmedAt', 'origin'].includes(key))) return false
  const origin = authority.origin
  if (!record(origin)) return false
  if (origin.kind === 'human_rule') return Object.keys(origin).length === 1
  return origin.kind === 'source_derived' && Object.keys(origin).length === 5 && ['kind', 'sourceRef', 'rawRef', 'locator', 'publishedAt'].every((key) => key in origin)
}
function sourceIdentity(s: KnowledgeProductionInput['evidenceBindings'][number]['source'], f: { ticker?: string }) { const m = s.candidate.metadata ?? {}; return { provider: ident(s.candidate.provider), kind: s.candidate.kind, dataset: m.dataset ?? m.dataKind ?? s.candidate.kind, company: m.companySymbol ?? f.ticker ?? null, query: m.query ?? m.period ?? m.startDate ?? null, url: s.canonicalUrl ?? s.candidate.url ?? null, publishedAt: s.candidate.publishedAt ?? null, title: s.title, metadata: Object.fromEntries(Object.entries(m).filter(([k]) => !['retrievedAt', 'requestId'].includes(k)).sort()) } }
function sourceObject(s: KnowledgeProductionInput['evidenceBindings'][number]['source'], id: string, rawRef: RawRef, f: { ticker?: string }): KnowledgeSourceV04 { const kind = s.candidate.kind; return { id: id as `source:${string}`, title: s.title, sourceType: kind === 'official_disclosure' ? 'official_disclosure' : kind === 'structured_data' ? 'industry_database' : 'general_media', publisher: s.publisher, publishedAt: s.candidate.publishedAt ?? null, url: s.canonicalUrl ?? s.candidate.url ?? null, rawRefs: [rawRef], provider: s.candidate.provider, canonicalUrl: s.canonicalUrl ?? s.candidate.url ?? null, retrievedAt: s.retrievedAt, contentHash: s.contentHash, metadata: { ...(s.candidate.metadata ?? {}), researchSourceIdentity: hashKnowledgeObject(sourceIdentity(s, f)) }, acquisition: { method: kind === 'official_disclosure' ? 'official' : kind === 'structured_data' ? 'structured_data' : kind === 'rss' ? 'rss' : 'news_search', discoveredAt: null, fetchedAt: s.retrievedAt, extractor: 'research-acquisition-normalizer' }, rights: { accessScope: s.rights.accessScope, providerTermsKnown: false, retentionAllowed: s.rights.retentionAllowed, aiProcessingAllowed: s.rights.aiProcessingAllowed, derivativeKnowledgeAllowed: s.rights.derivativeKnowledgeAllowed, redistributionAllowed: s.rights.redistributionAllowed, ...(s.rights.policyBasis ? { policyBasis: s.rights.policyBasis } : {}) }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: s.rights.retentionAllowed, allowAiProcessing: s.rights.aiProcessingAllowed, allowDerivedKnowledge: s.rights.derivativeKnowledgeAllowed, redistributionAllowed: false }, lifecycle: { status: 'active' } } }
function mergeSource(existing: KnowledgeSourceV04, incoming: KnowledgeSourceV04): KnowledgeSourceV04 {
  const restrictive = (prior: boolean | 'conditional' | null | undefined, next: boolean | 'conditional' | null | undefined) => prior === false || next === false ? false : next
  const accessRank = { public: 0, authenticated: 1, restricted: 2, unknown: 3 } as const
  const accessScope = accessRank[existing.rights.accessScope] >= accessRank[incoming.rights.accessScope] ? existing.rights.accessScope : incoming.rights.accessScope
  const expiryDates = [existing.rights.expiresAt, incoming.rights.expiresAt].filter((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
  const expiresAt = expiryDates.sort((left, right) => Date.parse(left) - Date.parse(right))[0]
  const retentionAllowed = restrictive(existing.rights.retentionAllowed, incoming.rights.retentionAllowed)
  const aiProcessingAllowed = restrictive(existing.rights.aiProcessingAllowed, incoming.rights.aiProcessingAllowed)
  const derivativeKnowledgeAllowed = restrictive(existing.rights.derivativeKnowledgeAllowed, incoming.rights.derivativeKnowledgeAllowed)
  const redistributionAllowed = restrictive(existing.rights.redistributionAllowed === true, incoming.rights.redistributionAllowed === true)
  return {
    ...existing,
    rawRefs: [...new Set([...(existing.rawRefs ?? []), ...(incoming.rawRefs ?? [])])],
    rights: { ...existing.rights, ...incoming.rights, accessScope, retentionAllowed, aiProcessingAllowed, derivativeKnowledgeAllowed, redistributionAllowed, ...(expiresAt ? { expiresAt } : {}), policyBasis: incoming.rights.policyBasis ?? existing.rights.policyBasis },
    usagePolicy: {
      ...existing.usagePolicy,
      retainRaw: existing.usagePolicy.retainRaw && incoming.usagePolicy.retainRaw && retentionAllowed === true,
      allowAiProcessing: existing.usagePolicy.allowAiProcessing && incoming.usagePolicy.allowAiProcessing && aiProcessingAllowed === true,
      allowDerivedKnowledge: existing.usagePolicy.allowDerivedKnowledge && incoming.usagePolicy.allowDerivedKnowledge && derivativeKnowledgeAllowed === true,
      redistributionAllowed: false
    }
  }
}

function competitionModuleProposalErrors(p: Dict): string[] {
  const errors: string[] = []
  const id = String(p.proposalId)
  if (!exactRecord(p, ['proposalId', 'kind', 'targetIndustry', 'schemaId', 'columns', 'rows', 'sourceCandidateIds', 'existingEvidenceBindings'], ['proposalId', 'kind', 'targetIndustry', 'schemaId', 'columns', 'rows']) || p.kind !== 'module') errors.push(`Competition Module proposal has undeclared or missing fields: ${id}`)
  if (!validEntitySelector(p.targetIndustry)) errors.push(`Competition Module targetIndustry selector is invalid: ${id}`)
  if (p.schemaId !== COMPETITION_MODULE_SCHEMA_ID_V1) errors.push(`Competition Module schemaId is unsupported: ${id}`)
  if (!Array.isArray(p.columns)) errors.push(`Competition Module columns must be an array: ${id}`)
  else if (p.columns.length < 4 || p.columns.length > 7) errors.push(`Competition Module column count is outside the 4-7 schema bound: ${id}`)
  if (!Array.isArray(p.rows)) errors.push(`Competition Module rows must be an array: ${id}`)
  else if (p.rows.length > 40) errors.push(`Competition Module row count exceeds the 40-row schema bound: ${id}`)
  if (p.sourceCandidateIds !== undefined && (!Array.isArray(p.sourceCandidateIds) || p.sourceCandidateIds.length > 40 || p.sourceCandidateIds.some((candidateId) => typeof candidateId !== 'string' || !safeId.test(candidateId)))) errors.push(`Competition Module sourceCandidateIds must be at most 40 local IDs: ${id}`)
  if (p.existingEvidenceBindings !== undefined && (!Array.isArray(p.existingEvidenceBindings) || p.existingEvidenceBindings.length > 40 || p.existingEvidenceBindings.some((binding) => !exactRecord(binding, ['sourceRef', 'rawRef', 'locator'], ['sourceRef', 'rawRef']) || typeof binding.sourceRef !== 'string' || !binding.sourceRef.startsWith('source:') || typeof binding.rawRef !== 'string' || !/^raw-sha256-[0-9a-f]{64}$/.test(binding.rawRef) || (binding.locator !== undefined && !validLocator(binding.locator))))) errors.push(`Competition Module existing evidence bindings are invalid: ${id}`)
  for (const [rowIndex, row] of (Array.isArray(p.rows) ? p.rows.slice(0, 40) : []).entries()) {
    if (!exactRecord(row, ['company', 'businessExposure', 'cells'])) { errors.push(`Competition Module row shape is invalid: ${id}[${rowIndex}]`); continue }
    if (!validEntitySelector(row.company)) errors.push(`Competition Module row Company selector is invalid: ${id}[${rowIndex}]`)
    if (!validRelationSelector(row.businessExposure)) errors.push(`Competition Module business_exposure selector is invalid: ${id}[${rowIndex}]`)
    if (!record(row.cells)) { errors.push(`Competition Module row cells must be keyed by column ID: ${id}[${rowIndex}]`); continue }
    const cellEntries = Object.entries(row.cells)
    if (cellEntries.length > 6) errors.push(`Competition Module row has more cells than the schema allows: ${id}[${rowIndex}]`)
    for (const [columnId, cell] of cellEntries.slice(0, 6)) {
      if (!safeId.test(columnId) || !record(cell)) { errors.push(`Competition Module cell is malformed: ${id}[${rowIndex}].${columnId}`); continue }
      if (cell.status === 'available') {
        const fields = ['status', 'displayValue', 'knowledgeRefs', 'asOf', 'unit', 'currency', 'fiscalYear']
        if (!exactRecord(cell, fields, ['status', 'displayValue', 'knowledgeRefs']) || typeof cell.displayValue !== 'string' || !Array.isArray(cell.knowledgeRefs) || cell.knowledgeRefs.length === 0 || cell.knowledgeRefs.length > 16 || cell.knowledgeRefs.some((ref) => !exactRecord(ref, ['proposalId', 'existingRef'], []) || Object.keys(ref).length !== 1 || !((typeof ref.proposalId === 'string' && safeId.test(ref.proposalId)) || (typeof ref.existingRef === 'string' && /^(claim|observation|relation):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref.existingRef))))) errors.push(`Competition Module available cell selectors or fields are invalid: ${id}[${rowIndex}].${columnId}`)
      } else if (!exactRecord(cell, ['status', 'reason']) || !['unavailable', 'not_comparable'].includes(String(cell.status)) || typeof cell.reason !== 'string') errors.push(`Competition Module unavailable cell is invalid: ${id}[${rowIndex}].${columnId}`)
    }
  }
  return errors
}

function localErrors(input: KnowledgeProductionInput): string[] {
  const errors: string[] = []; const ids = new Set<string>()
  if (!safeId.test(input.entity.localKey) || !input.entity.name.trim() || !validExternalIdentifiers(input.entity.externalIdentifiers)) errors.push('Root Entity localKey/name/externalIdentifiers are invalid')
  for (const raw of input.proposals as readonly unknown[]) {
    if (!record(raw)) { errors.push('Proposal must be an object'); continue }
    const proposalId = raw.proposalId
    if (typeof proposalId !== 'string' || !safeId.test(proposalId) || ids.has(proposalId)) errors.push(`Proposal ID is not unique and local: ${String(proposalId)}`); if (typeof proposalId === 'string') ids.add(proposalId)
    if (raw.kind === 'module') { errors.push(...competitionModuleProposalErrors(raw)); continue }
    const p = raw as unknown as SemanticProductionInputProposal
    if (p.kind !== 'reasoning_edge' && (typeof p.subjectKey !== 'string' || !safeId.test(p.subjectKey))) errors.push(`Proposal subjectKey is not safe: ${String(p.subjectKey)}`)
    if (!['entity', 'claim', 'relation', 'source', 'event', 'observation', 'thesis', 'reasoning_edge'].includes(p.kind)) errors.push(`Unsupported proposal kind: ${String(p.kind)}`)
    if (p.kind === 'entity' && (!['company', 'industry', 'product', 'technology', 'person', 'institution', 'security'].includes(p.entityType ?? '') || !text(p.entityName) || !validExternalIdentifiers(p.externalIdentifiers))) errors.push(`Entity proposal is invalid: ${p.proposalId}`)
    if (p.kind === 'entity' && p.structuredValue !== undefined && (!record(p.structuredValue) || (Object.prototype.hasOwnProperty.call(p.structuredValue, 'aliases') && (!Array.isArray(p.structuredValue.aliases) || p.structuredValue.aliases.some((alias) => typeof alias !== 'string' || !text(alias)))))) errors.push(`Entity proposal structured fields or aliases are invalid: ${p.proposalId}`)
    if (p.kind === 'claim' && (p.claimType === 'thesis' || !claimTypes.has(p.claimType ?? '') || !text(p.statement))) errors.push(`Claim proposal is invalid or uses legacy Thesis Claim semantics: ${p.proposalId}`)
    if (p.kind === 'relation' && (!text(p.relationType) || !text(p.targetKey))) errors.push(`Relation proposal is invalid: ${p.proposalId}`)
    if (p.kind === 'event' && (!text(p.eventType) || !text(p.statement) || !text(p.subjectKey))) errors.push(`Event proposal is invalid: ${p.proposalId}`)
    if (p.kind === 'observation' && (!text(p.observationType) || !text(p.metricRef) || !getMetricDefinitionV04(p.metricRef!))) errors.push(`Observation proposal has an invalid metric/type: ${p.proposalId}`)
    if (p.kind === 'thesis' && (!text(p.thesisTitle) || !text(p.statement) || !text(p.thesisStatus))) errors.push(`Thesis proposal is invalid: ${p.proposalId}`)
    if (p.existingEvidenceBindings !== undefined && (!Array.isArray(p.existingEvidenceBindings) || p.existingEvidenceBindings.some((binding) => !record(binding) || Object.keys(binding).some((key) => !['sourceRef', 'rawRef', 'locator'].includes(key)) || typeof binding.sourceRef !== 'string' || typeof binding.rawRef !== 'string' || (binding.locator !== undefined && !validLocator(binding.locator))))) errors.push(`Existing evidence bindings are invalid: ${p.proposalId}`)
    if (p.criterionRevision !== undefined && (p.kind !== 'thesis' || !record(p.criterionRevision) || !isBoundedSafeKillCriterionJsonV04(p.criterionRevision))) errors.push(`Thesis criterion revision is malformed: ${p.proposalId}`)
    if (p.kind === 'reasoning_edge') {
      const localSource = p.sourceProposalId ?? p.subjectKey
      const sourceSelectors = Number(Boolean(text(localSource))) + Number(Boolean(text(p.existingSourceRef)))
      const targetSelectors = Number(Boolean(text(p.targetKey))) + Number(Boolean(text(p.existingTargetRef)))
      if ((p.sourceProposalId !== undefined && p.subjectKey !== undefined && p.sourceProposalId !== p.subjectKey) || sourceSelectors !== 1 || targetSelectors !== 1 || !reasoningEdgeTypes.has(p.edgeType ?? '')) errors.push(`ReasoningEdge proposal has invalid selectors or edge type: ${p.proposalId}`)
    }
    if (p.resolution !== undefined && !['update', 'supersede', 'contradict', 'review'].includes(p.resolution)) errors.push(`Unsupported proposal resolution: ${p.proposalId}`)
  }
  for (const raw of input.proposals as readonly unknown[]) if (record(raw)) for (const key of ['supportsProposalIds', 'dependsOnProposalIds', 'contradictsProposalIds'] as const) { const links = raw[key]; if (links !== undefined && (!Array.isArray(links) || links.some((id) => typeof id !== 'string'))) errors.push(`Proposal links must be string arrays: ${String(raw.proposalId)}`); for (const id of Array.isArray(links) ? links : []) if (!ids.has(id)) errors.push(`Proposal link does not resolve locally: ${id}`) }
  return errors
}
function reviewCase(input: KnowledgeProductionInput, p: SemanticProductionProposal, rawRef: RawRef): ReviewCase { const claimType = claimTypes.has(p.claimType ?? '') ? p.claimType as 'fact' | 'forecast' | 'viewpoint' | 'trend' | 'risk' : 'fact'; return { version: '0.1', reviewCaseId: `review-case-${hashKnowledgeObject({ kb: input.handle.knowledgeBaseId, run: input.producerRunId, proposal: p.proposalId, reason: 'review' }).slice(7)}`, knowledgeBaseId: input.handle.knowledgeBaseId, producerType: input.reviewProducerType ?? input.producerType, producerRunId: input.producerRunId, createdAt: (input.now ?? (() => new Date().toISOString()))(), classification: { category: 'reconciliation_review', actionability: 'knowledge_decision', origin: 'semantic_case', stage: 'knowledge_resolution', rationale: 'Producer marked semantic resolution for review' }, rootProposal: { proposalId: p.proposalId, proposalKind: 'claim', semanticType: claimType, semanticPayload: { candidateId: p.proposalId, claimType, statement: p.statement ?? '', subjectRefs: [{ candidateRef: p.subjectKey, mention: p.subjectKey }], evidenceBlockRefs: [`source-${p.proposalId}`], reason: 'review' } as never, evidenceBindings: [{ kind: 'raw_document_block', rawRef, documentId: p.proposalId, blockId: `source-${p.proposalId}` }], dependencyRefs: [] }, suspendedProposalBundle: { dependentProposals: [] }, resolutionContext: { existingKnowledgeProjections: [], schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: input.handle.revision }, impact: { dependentProposalCount: 0, affectedProposalRefs: [] }, state: { status: 'open' } } }

export class KnowledgeProductionGateway {
  constructor(private readonly registry = new KnowledgeBaseRegistry(), private readonly resolver?: SemanticResolver) {}
  async projectExistingKnowledge(handle: KnowledgeBaseHandle, entity: { name?: string; symbol: string; exchange?: string }): Promise<readonly Dict[]> { const objects = (await readCanonicalV04Assets(handle.rootRef)).objects.map((x) => x.value); const f = { ticker: entity.symbol, ...(entity.exchange ? { exchange: normalizeExchange(entity.exchange) } : {}) }; const ids = new Set(objects.filter((o) => companyMatch(o, f) || nameMatch(o, 'company', entity.name ?? entity.symbol, [entity.symbol])).map((o) => o.id)); for (const r of objects.filter((o) => o.id.startsWith('relation:')) as KnowledgeRelationV04[]) if (ids.has(r.sourceRef) || ids.has(r.targetRef)) { ids.add(r.id); ids.add(r.sourceRef); ids.add(r.targetRef) } for (const c of objects.filter((o) => o.id.startsWith('claim:')) as KnowledgeClaimV04[]) if (c.subjectRefs.some((r) => ids.has(r))) ids.add(c.id); return objects.filter((o) => ids.has(o.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 80).map((o) => { const v = o as unknown as Dict; return { canonicalRef: o.id, kind: o.id.split(':', 1)[0], name: v.name ?? v.statement ?? null, aliases: Array.isArray(v.aliases) ? v.aliases.slice(0, 10) : [], ...v } }) }
  async submit(input: KnowledgeProductionInput): Promise<KnowledgeProductionOutcome> {
    const now = input.now ?? (() => new Date().toISOString()); const intents: ResolutionIntentSummary[] = []; const relationRefs: Record<string, string> = {}; const entityRefs: Record<string, string> = {}; const claimRefs: Record<string, string> = {}; const sourceRefs: Record<string, string> = {}; const eventRefs: Record<string, string> = {}; const observationRefs: Record<string, string> = {}; const thesisRefs: Record<string, string> = {}; const reasoningEdgeRefs: Record<string, string> = {}
    const moduleRefs: Record<string, string> = {}
    const terminalOutcome = (status: 'blocked' | 'failed', errors: readonly string[], terminalIntents: readonly ResolutionIntentSummary[] = intents, entities: Readonly<Record<string, string>> = entityRefs, relations: Readonly<Record<string, string>> = relationRefs, sources: Readonly<Record<string, string>> = sourceRefs, claims: Readonly<Record<string, string>> = claimRefs): KnowledgeProductionOutcome => createOutcome(input, status, errors, terminalIntents, entities, relations, sources, claims, moduleRefs)
    try {
      const errors = localErrors(input); const criterionProposals = input.proposals.filter((proposal) => (proposal as unknown as Dict).criterionRevision !== undefined); if (criterionProposals.length && (input.producerType !== 'thesis_criterion_confirmed' || input.proposals.length !== 1 || criterionProposals.length !== 1 || criterionProposals[0]?.kind !== 'thesis')) errors.push('Confirmed criterion revisions require one Thesis proposal from thesis_criterion_confirmed'); if (input.evidenceBindings.some((binding) => binding.locator !== undefined && !validLocator(binding.locator))) errors.push('Evidence binding locator is invalid'); if (input.evidenceBindings.some((binding) => !['public', 'authenticated'].includes(binding.source.rights.accessScope) || binding.source.rights.retentionAllowed !== true || binding.source.rights.aiProcessingAllowed !== true || binding.source.rights.derivativeKnowledgeAllowed !== true)) errors.push('Source access scope or rights do not permit raw retention, AI processing, and derived canonical Knowledge'); if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') errors.push('Knowledge Production Gateway requires Schema 0.4 / Storage Format 1'); if (errors.length) return terminalOutcome('blocked', errors, intents, entityRefs, relationRefs, sourceRefs, claimRefs)
      const proposals = input.proposals.filter((proposal): proposal is SemanticProductionInputProposal => proposal.kind !== 'module') as readonly SemanticProductionProposal[]
      const assets = await readCanonicalV04Assets(input.handle.rootRef); const canonicalObjects: AssetMap = new Map(assets.objects.map((x) => [x.value.id, structuredClone(x.value)])); const objects: AssetMap = new Map(assets.objects.map((x) => [x.value.id, structuredClone(x.value)])); const operations: KnowledgeOperationV04[] = []; const createdIds: string[] = []; const updatedIds: string[] = []; const rawBySource = new Map<string, RawRef>(); const f = companyFields(input)
      const existingEvidenceByProposal = new Map<string, EvidenceRef[]>()
      const existingEvidenceErrors: string[] = []
      const evidenceEvaluatedAt = Date.parse(now())
      for (const proposal of input.proposals) {
        const bindings = proposal.existingEvidenceBindings
        if (!Array.isArray(bindings) || bindings.length === 0) continue
        const accepted: EvidenceRef[] = []
        for (const binding of bindings) {
          if (!record(binding) || typeof binding.sourceRef !== 'string' || !binding.sourceRef.startsWith('source:') || typeof binding.rawRef !== 'string' || !/^raw-sha256-[0-9a-f]{64}$/.test(binding.rawRef)) {
            existingEvidenceErrors.push(`Proposal ${proposal.proposalId} has a malformed existing evidence binding`)
            continue
          }
          const source = canonicalObjects.get(binding.sourceRef) as KnowledgeSourceV04 | undefined
          const lifecycle = source?.lifecycle
          const validFrom = lifecycle?.validFrom == null ? undefined : Date.parse(lifecycle.validFrom)
          const validUntil = lifecycle?.validUntil == null ? undefined : Date.parse(lifecycle.validUntil)
          const rightsExpiresAt = source?.rights.expiresAt == null ? undefined : Date.parse(source.rights.expiresAt)
          const lifecycleValid = Boolean(source && lifecycle?.status === 'active' && Number.isFinite(evidenceEvaluatedAt) && (validFrom === undefined || (Number.isFinite(validFrom) && validFrom <= evidenceEvaluatedAt)) && (validUntil === undefined || (Number.isFinite(validUntil) && validUntil > evidenceEvaluatedAt)) && (rightsExpiresAt === undefined || (Number.isFinite(rightsExpiresAt) && rightsExpiresAt > evidenceEvaluatedAt)))
          const usagePolicy = source?.usagePolicy
          if (!source || !lifecycleValid || !['public', 'authenticated'].includes(source.rights.accessScope) || !source.rawRefs?.includes(binding.rawRef as RawRef) || source.rights.retentionAllowed !== true || source.rights.aiProcessingAllowed !== true || source.rights.derivativeKnowledgeAllowed !== true || usagePolicy?.retainRaw !== true || usagePolicy.allowDerivedKnowledge !== true || usagePolicy.allowAiProcessing !== true) {
            existingEvidenceErrors.push(`Proposal ${proposal.proposalId} references an unavailable, inactive, or policy-ineligible Source/Raw pair`)
            continue
          }
          try { await verifyRaw(input.handle, binding.rawRef) } catch { existingEvidenceErrors.push(`Proposal ${proposal.proposalId} references Raw evidence that failed integrity verification`); continue }
            accepted.push({ sourceRef: binding.sourceRef as `source:${string}`, rawRef: binding.rawRef as RawRef, ...(binding.locator === undefined ? {} : { locator: binding.locator as string }) })
        }
        existingEvidenceByProposal.set(proposal.proposalId, accepted)
      }
      if (existingEvidenceErrors.length) return terminalOutcome('blocked', existingEvidenceErrors, intents, entityRefs, relationRefs, sourceRefs, claimRefs)
      const evidencedRootFields: Dict = {}
      const conflictedRootFields = new Set<string>()
      const rootEntityProposals = proposals.filter((proposal) => proposal.kind === 'entity' && proposal.subjectKey === input.entity.localKey && proposal.entityType === input.entity.entityType && proposal.entityName === input.entity.name)
      for (const proposal of rootEntityProposals) {
        if ((existingEvidenceByProposal.get(proposal.proposalId) ?? []).length === 0) continue
        const fields = record(proposal.structuredValue) ? proposal.structuredValue : {}
        const candidateFields: Dict = {}
        const fieldIssues: string[] = []
        if (Object.prototype.hasOwnProperty.call(fields, 'description')) {
          if (typeof fields.description !== 'string' || !text(fields.description)) fieldIssues.push('Root Entity description must be a non-empty string')
          else candidateFields.description = text(fields.description)
        }
        if (Object.prototype.hasOwnProperty.call(fields, 'legalName')) {
          if (input.entity.entityType !== 'company') fieldIssues.push('Root Entity legalName is supported only for Company')
          else if (typeof fields.legalName !== 'string' || !text(fields.legalName)) fieldIssues.push('Root Company legalName must be a non-empty string')
          else candidateFields.legalName = text(fields.legalName)
        }
        if (fieldIssues.length > 0) intents.push(intent(`entity-root-fields-${proposal.proposalId}`, 'review_required', fieldIssues.join('; '), { proposalId: proposal.proposalId, localKey: input.entity.localKey }))
        for (const [field, value] of Object.entries(candidateFields)) {
          if (conflictedRootFields.has(field)) continue
          const existingValue = evidencedRootFields[field]
          if (existingValue !== undefined && existingValue !== value) {
            delete evidencedRootFields[field]
            conflictedRootFields.add(field)
            intents.push(intent(`entity-root-field-conflict-${field}`, 'review_required', `Multiple evidence-backed root Entity proposals conflict on ${field}`, { localKey: input.entity.localKey }))
          } else evidencedRootFields[field] = value
        }
      }
      const entityInputs = new Map<string, KnowledgeProductionInput['entity']>([[input.entity.localKey, input.entity]])
      const entityProposalByLocalKey = new Map<string, SemanticProductionProposal>()
      for (const p of proposals.filter((x) => x.kind === 'entity')) {
        if (p.subjectKey === input.entity.localKey) {
          if (p.entityType !== input.entity.entityType || p.entityName !== input.entity.name) return terminalOutcome('blocked', ['Semantic Entity proposal cannot overwrite authoritative root ProductionEntityInput'], intents, entityRefs, relationRefs, sourceRefs, claimRefs)
          continue
        }
        entityProposalByLocalKey.set(p.subjectKey, p)
        entityInputs.set(p.subjectKey, { localKey: p.subjectKey, entityType: p.entityType!, name: p.entityName!, aliases: entityProposalAliases(p.structuredValue), semanticFields: normalizeNonRootCompanyFields(p.entityType!, p.structuredValue), externalIdentifiers: p.externalIdentifiers })
      }
      for (const [localKey, ei] of entityInputs) {
        const isRoot = localKey === input.entity.localKey
        const hardIdentity = !isRoot && ei.entityType === 'company' ? nonRootCompanyIdentity(ei.semanticFields) : undefined
        let existing: KnowledgeEntityV04 | undefined
        if (ei.existingEntityRef) {
          const x = objects.get(ei.existingEntityRef)
          const identity = isRoot ? f : hardIdentity
          if (!x || !x.id.startsWith('entity:') || (x as KnowledgeEntityV04).type !== ei.entityType || (ei.entityType === 'company' && (!identity || !companyMatch(x, identity)))) {
            intents.push(intent(`entity-${localKey}`, 'review_required', 'Explicit canonical Entity ref is missing, type-mismatched, or violates Company hard identity', { localKey }))
            continue
          }
          existing = x as KnowledgeEntityV04
        } else if (isRoot && ei.entityType === 'company') {
          const matches = [...objects.values()].filter((o) => companyMatch(o, f))
          if (matches.length > 1) { intents.push(intent(`entity-${localKey}`, 'review_required', 'Multiple canonical companies match hard identity', { localKey })); continue }
          existing = matches[0] as KnowledgeEntityV04 | undefined
        } else if (!isRoot && ei.entityType === 'company') {
          if (!hardIdentity) {
            intents.push(intent(`entity-${localKey}`, 'review_required', 'Non-root Company requires both ticker and exchange to establish hard identity', { localKey }))
            continue
          }
          const matches = [...objects.values()].filter((o) => companyMatch(o, hardIdentity)) as KnowledgeEntityV04[]
          if (matches.length > 1) { intents.push(intent(`entity-${localKey}`, 'review_required', 'Multiple canonical companies match non-root ticker and exchange', { localKey })); continue }
          if (matches.length === 1) existing = matches[0]
          else {
            const nameConflicts = [...objects.values()].filter((o) => nameMatch(o, 'company', ei.name, ei.aliases ?? [])) as KnowledgeEntityV04[]
            if (nameConflicts.length) {
              intents.push(intent(`entity-${localKey}`, 'review_required', 'Company name matches canonical entities with a different hard identity', { localKey, ...(nameConflicts.length === 1 ? { targetRef: nameConflicts[0]!.id } : {}) }))
              continue
            }
          }
        } else {
          const matches = [...objects.values()].filter((o) => nameMatch(o, ei.entityType, ei.name, ei.aliases ?? [])) as KnowledgeEntityV04[]
          if (matches.length) {
            const resolver = input.semanticResolver ?? this.resolver
            const decision = resolver ? await resolver({ proposal: { proposalId: `entity-${localKey}`, kind: 'entity', subjectKey: localKey, entityType: ei.entityType, entityName: ei.name }, existing: matches.map((m) => ({ canonicalRef: m.id, type: m.type, name: m.name, aliases: m.aliases ?? [] })), evidence: [] }) : undefined
            if (decision?.outcome === 'equivalent' && matches.length === 1) existing = matches[0]
            else { intents.push(intent(`entity-${localKey}`, 'review_required', matches.length > 1 ? 'Multiple plausible non-Company candidates require semantic resolution' : 'Name similarity alone cannot establish non-Company identity', { localKey, ...(matches.length === 1 ? { targetRef: matches[0]!.id } : {}) })); continue }
          }
        }
        const ref = existing?.id ?? (isRoot
          ? allocateEntityId(ei.entityType, ei.entityType === 'company' && text(f.ticker) ? text(f.ticker) : ei.name)
          : ei.entityType === 'company' && hardIdentity
            ? allocateEntityId('company', hardIdentity.ticker, { ticker: ident(hardIdentity.ticker), exchange: ident(hardIdentity.exchange) })
            : allocateEntityId(ei.entityType, ei.name))
        entityRefs[localKey] = ref
        if (existing) {
          const entityProposal = entityProposalByLocalKey.get(localKey)
          const declaredSourceIds = new Set(entityProposal?.sourceCandidateIds ?? [])
          const hasSubmittedEvidence = Boolean(entityProposal && input.evidenceBindings.some((binding) => declaredSourceIds.has(binding.localSourceId) && validateUsableAcquisitionPayload(binding.source.content).status === 'usable'))
          const evidenceBacked = Boolean(entityProposal && ((existingEvidenceByProposal.get(entityProposal.proposalId) ?? []).length > 0 || hasSubmittedEvidence))
          const incomingFields = isRoot ? { ...f, ...evidencedRootFields } : ei.semanticFields
          const requestedSupplementalFields = Boolean((ei.aliases?.length ?? 0) || (entityProposal && ident(ei.name) !== ident(existing.name)) || text(incomingFields?.description))
          if (!isRoot && requestedSupplementalFields && !evidenceBacked) intents.push(intent(`entity-fields-evidence-${entityProposal?.proposalId ?? localKey}`, 'review_required', 'Non-root Entity aliases, name variants, and description require validated Source/Raw evidence; unverified values were not applied', { ...(entityProposal ? { proposalId: entityProposal.proposalId } : {}), localKey, targetRef: ref }))
          const incomingDescription = evidenceBacked ? text(incomingFields?.description) : ''
          const priorDescription = text((existing as unknown as Dict).description)
          if (!isRoot && incomingDescription && priorDescription && ident(incomingDescription) !== ident(priorDescription)) intents.push(intent(`entity-description-conflict-${entityProposal?.proposalId ?? localKey}`, 'review_required', 'Evidence-backed non-root Entity description conflicts with the canonical description; the existing value was retained', { proposalId: entityProposal?.proposalId, localKey, targetRef: ref }))
          const incomingLegalName = evidenceBacked ? text(incomingFields?.legalName) : ''
          const priorLegalName = text((existing as unknown as Dict).legalName)
          if (!isRoot && incomingLegalName && priorLegalName && ident(incomingLegalName) !== ident(priorLegalName)) intents.push(intent(`entity-legal-name-conflict-${entityProposal?.proposalId ?? localKey}`, 'review_required', 'Evidence-backed non-root Company legalName conflicts with the canonical legalName; the existing value was retained', { proposalId: entityProposal?.proposalId, localKey, targetRef: ref }))
          const nameAlias = evidenceBacked && ident(ei.name) !== ident(existing.name) ? [ei.name] : []
          const aliases = isRoot ? ei.aliases ?? [] : evidenceBacked ? uniqueSorted([...(ei.aliases ?? []), ...nameAlias]) : []
          const merged = mergeEntity(existing, { aliases, semanticFields: incomingFields, externalIdentifiers: isRoot ? f.externalIdentifiers : ei.externalIdentifiers, allowDescription: isRoot || evidenceBacked })
          if (hashKnowledgeObject(existing) !== hashKnowledgeObject(merged)) { objects.set(ref, merged); operations.push({ operationId: `update-entity-${operations.length + 1}`, type: 'update', knowledgeId: ref, expectedBeforeHash: hashKnowledgeObject(existing), object: merged }); updatedIds.push(ref) }
          intents.push(intent(`entity-${localKey}`, 'bound_existing', 'Bound to a validated canonical Entity', { localKey, targetRef: ref }))
        } else {
          const fields = isRoot ? { ...f, ...evidencedRootFields } : ei.semanticFields ?? {}
          const created = { id: ref as `entity:${string}`, type: ei.entityType, name: ei.name, ...fields, ...(isRoot || ei.externalIdentifiers === undefined ? {} : { externalIdentifiers: ei.externalIdentifiers }), aliases: [...new Set(ei.aliases ?? [])], lifecycle: { status: 'active' } } as KnowledgeEntityV04
          objects.set(ref, created); operations.push({ operationId: `create-entity-${operations.length + 1}`, type: 'create', object: created }); createdIds.push(ref); intents.push(intent(`entity-${localKey}`, 'created_new', 'No plausible canonical Entity was proven equivalent', { localKey, targetRef: ref }))
        }
      }
      if (!entityRefs[input.entity.localKey]) return terminalOutcome('blocked', ['Root Entity binding requires review before dependent Knowledge can be committed'], intents, entityRefs, relationRefs, sourceRefs, claimRefs)
      for (const b of input.evidenceBindings) { if (validateUsableAcquisitionPayload(b.source.content).status !== 'usable') continue; const bytes = b.source.rawBytes === undefined ? new TextEncoder().encode(b.source.content) : Uint8Array.from(b.source.rawBytes); const raw = await archiveRaw(input.handle, { bytes, originalFilename: b.originalFilename ?? `${b.localSourceId}.txt`, mediaType: b.mediaType ?? 'text/plain', suppliedMetadata: { title: b.source.title, institution: b.source.publisher, publishedAt: b.source.candidate.publishedAt ?? null, sourceUrl: b.source.canonicalUrl ?? b.source.candidate.url ?? null } }, { clock: now }); const rawRef = raw.manifest.rawRef as RawRef; rawBySource.set(b.localSourceId, rawRef); const hash = hashKnowledgeObject(sourceIdentity(b.source, f)); const old = [...objects.values()].find((o) => o.id.startsWith('source:') && (o as KnowledgeSourceV04).metadata?.researchSourceIdentity === hash) as KnowledgeSourceV04 | undefined; const s = sourceObject(b.source, old?.id ?? `source:research-${hash.slice(7, 23)}`, rawRef, f); const final = old ? mergeSource(old, s) : s; sourceRefs[b.localSourceId] = final.id; objects.set(final.id, final); if (!old) { operations.push({ operationId: `create-source-${operations.length + 1}`, type: 'create', object: final }); createdIds.push(final.id) } else if (hashKnowledgeObject(old) !== hashKnowledgeObject(final)) { operations.push({ operationId: `update-source-${operations.length + 1}`, type: 'update', knowledgeId: old.id, expectedBeforeHash: hashKnowledgeObject(old), object: final }); updatedIds.push(old.id) } }
      const evidenceFor = (p: { readonly proposalId: string; readonly sourceCandidateIds?: readonly string[]; readonly existingEvidenceBindings?: readonly { readonly sourceRef: `source:${string}`; readonly rawRef: `raw-sha256-${string}`; readonly locator?: string }[] }): EvidenceRef[] => {
        const locatorBySource = new Map(input.evidenceBindings.map((binding) => [binding.localSourceId, binding.locator]))
        const submitted = uniqueSorted(p.sourceCandidateIds ?? []).flatMap((id): EvidenceRef[] => { const sourceRef = sourceRefs[id]; const rawRef = rawBySource.get(id); if (!sourceRef || !rawRef) return []; const locator = locatorBySource.get(id); return [{ sourceRef: sourceRef as `source:${string}`, rawRef, ...(locator === undefined ? {} : { locator }) }] })
        const combined = [...submitted, ...(existingEvidenceByProposal.get(p.proposalId) ?? [])]
        return [...new Map(combined.map((item) => [`${item.sourceRef}|${item.rawRef}|${item.locator ?? ''}`, item])).values()].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef) || left.rawRef.localeCompare(right.rawRef) || String(left.locator ?? '').localeCompare(String(right.locator ?? '')))
      }
      const addOrUpdate = (object: KnowledgeAssetV04, kind: string, id: string): void => { const old = objects.get(id); if (!old) { objects.set(id, object); operations.push({ operationId: `create-${kind}-${operations.length + 1}`, type: 'create', object }); createdIds.push(id); return } if (hashKnowledgeObject(old) !== hashKnowledgeObject(object)) { operations.push({ operationId: `update-${kind}-${operations.length + 1}`, type: 'update', knowledgeId: id, expectedBeforeHash: hashKnowledgeObject(old), object }); updatedIds.push(id); objects.set(id, object) } else objects.set(id, old) }
      const boundRef = (proposalId: string | undefined): string | undefined => proposalId === undefined ? undefined : claimRefs[proposalId] ?? eventRefs[proposalId] ?? observationRefs[proposalId] ?? thesisRefs[proposalId] ?? relationRefs[proposalId] ?? entityRefs[proposalId]
      for (const p of proposals.filter((x) => x.kind === 'event')) { const subjectRef = entityRefs[p.subjectKey]; const ev = evidenceFor(p); if (!subjectRef || ev.length === 0) { intents.push(intent(`event-${p.proposalId}`, 'review_required', 'Event requires a bound Entity subject and usable evidence', { proposalId: p.proposalId })); continue } const temporal = record(p.temporal) ? p.temporal : { announcedAt: input.asOf ?? null }; const identity = { eventType: p.eventType, title: text(p.statement), subjectRefs: [subjectRef], temporal }; const id = allocateKnowledgeId('event', identity); const existing = objects.get(id) as KnowledgeEventV04 | undefined; const event: KnowledgeEventV04 = { id: id as `event:${string}`, eventType: p.eventType!, title: text(p.statement), subjectRefs: [subjectRef as `entity:${string}`], ...(p.participantKeys?.length ? { participantRefs: p.participantKeys.map((key) => entityRefs[key]).filter((ref): ref is `entity:${string}` => Boolean(ref)) } : {}), temporal, sourceRefs: [...new Set([...(existing?.sourceRefs ?? []), ...ev.map((item) => item.sourceRef)])], ...(p.attributes === undefined ? {} : { attributes: p.attributes as never }), lifecycle: { status: 'active' }, createdAt: existing?.createdAt ?? now(), updatedAt: now() }; eventRefs[p.proposalId] = id; addOrUpdate(event, 'event', id); intents.push(intent(`event-${p.proposalId}`, existing ? 'bound_existing' : 'created_new', existing ? 'Canonical Event resolved and provenance merged' : 'Created canonical Event', { proposalId: p.proposalId, targetRef: id })) }
      for (const p of proposals.filter((x) => x.kind === 'observation')) {
        const subjectRef = entityRefs[p.subjectKey]
        const ev = evidenceFor(p)
        if (!subjectRef || (p.observationType !== 'consensus' && ev.length === 0)) { intents.push(intent(`observation-${p.proposalId}`, 'review_required', 'Observation requires a bound Entity subject and usable evidence', { proposalId: p.proposalId })); continue }
        const provenance = canonicalProvenance(ev)
        let observationId: string | undefined
        let existing: KnowledgeObservationV04 | undefined
        let observation: KnowledgeObservationV04 | undefined
        if (p.observationType === 'metric') {
          observationId = allocateKnowledgeId('observation', { observationType: p.observationType, subjectRef, metricRef: p.metricRef, fiscalPeriod: p.fiscalPeriod ?? null, period: p.period ?? null, value: p.value ?? null, sourceRefs: ev.map((item) => item.sourceRef) })
          existing = objects.get(observationId) as KnowledgeObservationV04 | undefined
          observation = { id: observationId as `observation:${string}`, observationType: 'metric', subjectRef: subjectRef as `entity:${string}`, metricRef: p.metricRef!, value: p.value ?? null, ...(p.unit === undefined ? {} : { unit: p.unit }), ...(p.period === undefined ? {} : { period: p.period }), ...(p.attributes === undefined ? {} : { dimensions: p.attributes as never }), sourceRef: ev[0]!.sourceRef, provenance, ...(p.temporal && record(p.temporal) && typeof p.temporal.observedAt === 'string' ? { observedAt: p.temporal.observedAt } : {}), ...(p.temporal && record(p.temporal) && typeof p.temporal.reportedAt === 'string' ? { reportedAt: p.temporal.reportedAt } : {}), ...(input.asOf ? { asOf: input.asOf } : {}), recordedAt: existing?.recordedAt ?? now(), lifecycle: { status: 'active' } } as KnowledgeObservationV04
        } else if (p.observationType === 'estimate') {
          const institutionRef = p.institutionKey ? entityRefs[p.institutionKey] : undefined
          const analystRef = p.analystKey ? entityRefs[p.analystKey] : undefined
          const estimateValue = p.estimateValue ?? p.value
          const revisionRef = p.revisionOfProposalId === undefined || p.revisionOfProposalId === null ? undefined : observationRefs[p.revisionOfProposalId]
          const declaredSourceIds = uniqueSorted(p.sourceCandidateIds ?? [])
          if (!institutionRef || (p.analystKey !== undefined && !analystRef) || !p.fiscalPeriod || !p.publishedAt || Number.isNaN(Date.parse(p.publishedAt)) || typeof p.unit !== 'string' || p.unit.trim() === '' || typeof estimateValue !== 'number' || !Number.isFinite(estimateValue) || declaredSourceIds.length === 0 || ev.length !== declaredSourceIds.length || (p.revisionOfProposalId !== undefined && p.revisionOfProposalId !== null && !revisionRef)) { intents.push(intent(`observation-${p.proposalId}`, 'review_required', 'EstimateObservation requires complete attributable source provenance, institution, unit, finite value, publishedAt, and resolvable revision target', { proposalId: p.proposalId })); continue }
          const revisionTarget = revisionRef ? objects.get(revisionRef) as KnowledgeObservationV04 | undefined : undefined
          if (revisionTarget !== undefined && (revisionTarget.observationType !== 'estimate' || revisionTarget.subjectRef !== subjectRef || revisionTarget.metricRef !== p.metricRef || revisionTarget.fiscalPeriod !== p.fiscalPeriod || revisionTarget.institutionRef !== institutionRef || revisionTarget.unit !== p.unit || Number.isNaN(Date.parse(revisionTarget.publishedAt)) || Date.parse(revisionTarget.publishedAt) >= Date.parse(p.publishedAt))) { intents.push(intent(`observation-${p.proposalId}`, 'review_required', 'Estimate revision target does not satisfy historical lineage constraints', { proposalId: p.proposalId })); continue }
          const sourceRefsForIdentity = canonicalSourceRefs(ev)
          observationId = allocateKnowledgeId('observation', { observationType: 'estimate', subjectRef, metricRef: p.metricRef, fiscalPeriod: p.fiscalPeriod, institutionRef, analystRef: analystRef ?? null, publishedAt: p.publishedAt, sourceRefs: sourceRefsForIdentity })
          existing = objects.get(observationId) as KnowledgeObservationV04 | undefined
          const canonicalRevisionRef = revisionRef ?? (existing?.observationType === 'estimate' ? existing.revisionOf ?? undefined : undefined)
          observation = { id: observationId as `observation:${string}`, observationType: 'estimate', subjectRef: subjectRef as `entity:${string}`, metricRef: p.metricRef!, fiscalPeriod: p.fiscalPeriod, estimateValue, unit: p.unit, ...(p.currency === undefined ? {} : { currency: p.currency }), institutionRef: institutionRef as `entity:${string}`, ...(analystRef ? { analystRef: analystRef as `entity:${string}` } : {}), publishedAt: p.publishedAt, ...(p.estimateHorizon === undefined ? {} : { estimateHorizon: p.estimateHorizon }), ...(canonicalRevisionRef ? { revisionOf: canonicalRevisionRef as `observation:${string}` } : {}), sourceRef: sourceRefsForIdentity[0]!, provenance, recordedAt: existing?.recordedAt ?? now(), lifecycle: { status: 'active' } } as KnowledgeObservationV04
        } else {
          const proposalIds = p.contributingProposalIds ?? []
          const contributingObservationRefs = proposalIds.map((proposalId) => observationRefs[proposalId])
          const consensusAsOf = p.consensusAsOf ?? input.asOf
          const contributors = contributingObservationRefs.map((ref) => ref === undefined ? undefined : objects.get(ref) as KnowledgeObservationV04 | undefined)
          const count = p.consensusCount ?? proposalIds.length
          const contributorValid = contributors.every((item): item is Extract<KnowledgeObservationV04, { observationType: 'estimate' }> => item?.observationType === 'estimate')
          const units = new Set(contributors.filter((item): item is Extract<KnowledgeObservationV04, { observationType: 'estimate' }> => item?.observationType === 'estimate').map((item) => item.unit))
          const consensusUnit = p.unit ?? (units.size === 1 ? [...units][0] : undefined)
          const values = contributors.filter((item): item is Extract<KnowledgeObservationV04, { observationType: 'estimate' }> => item?.observationType === 'estimate').map((item) => item.estimateValue).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          const mean = p.consensusMean ?? (typeof p.value === 'number' ? p.value : values.length === contributors.length && values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined)
          if (!p.fiscalPeriod || !consensusAsOf || Number.isNaN(Date.parse(consensusAsOf)) || typeof consensusUnit !== 'string' || consensusUnit.trim() === '' || proposalIds.length < 2 || new Set(proposalIds).size !== proposalIds.length || contributingObservationRefs.some((ref) => ref === undefined) || !contributorValid || units.size !== 1 || !units.has(consensusUnit) || values.length !== contributors.length || contributors.some((item) => item?.subjectRef !== subjectRef || item.metricRef !== p.metricRef || item.fiscalPeriod !== p.fiscalPeriod || typeof item.unit !== 'string' || Number.isNaN(Date.parse(item.publishedAt)) || Date.parse(item.publishedAt) > Date.parse(consensusAsOf)) || !Number.isInteger(count) || count !== proposalIds.length || mean === undefined || !Number.isFinite(mean) || [p.consensusMedian, p.consensusHigh, p.consensusLow, p.consensusDispersion].some((value) => value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) { intents.push(intent(`observation-${p.proposalId}`, 'review_required', 'ConsensusObservation requires complete, homogeneous, point-in-time estimate contributors and finite statistics', { proposalId: p.proposalId })); continue }
          const refs = contributingObservationRefs as `observation:${string}`[]
          observationId = allocateKnowledgeId('observation', { observationType: 'consensus', subjectRef, metricRef: p.metricRef, fiscalPeriod: p.fiscalPeriod, asOf: consensusAsOf, contributingObservationRefs: refs })
          existing = objects.get(observationId) as KnowledgeObservationV04 | undefined
          observation = { id: observationId as `observation:${string}`, observationType: 'consensus', subjectRef: subjectRef as `entity:${string}`, metricRef: p.metricRef!, fiscalPeriod: p.fiscalPeriod, asOf: consensusAsOf, mean, ...(p.consensusMedian === undefined ? {} : { median: p.consensusMedian }), ...(p.consensusHigh === undefined ? {} : { high: p.consensusHigh }), ...(p.consensusLow === undefined ? {} : { low: p.consensusLow }), count, ...(p.consensusDispersion === undefined ? {} : { dispersion: p.consensusDispersion }), contributingObservationRefs: refs, ...(ev[0] ? { sourceRef: ev[0].sourceRef, provenance } : {}), recordedAt: existing?.recordedAt ?? now(), lifecycle: { status: 'active' } } as KnowledgeObservationV04
        }
        if (observationId === undefined || observation === undefined) continue
        observationRefs[p.proposalId] = observationId
        addOrUpdate(observation, 'observation', observationId)
        intents.push(intent(`observation-${p.proposalId}`, existing ? 'bound_existing' : 'created_new', existing ? 'Canonical Observation resolved' : 'Created canonical Observation', { proposalId: p.proposalId, targetRef: observationId }))
      }
      for (const p of proposals.filter((x) => x.kind === 'thesis')) { const subjectRef = entityRefs[p.subjectKey]; if (!subjectRef || !p.thesisTitle || !p.statement || !p.thesisStatus) { intents.push(intent(`thesis-${p.proposalId}`, 'review_required', 'Thesis requires a bound Entity subject and complete semantic fields', { proposalId: p.proposalId })); continue } const id = allocateKnowledgeId('thesis', { subjectRefs: [subjectRef], title: p.thesisTitle }); const existing = objects.get(id) as KnowledgeThesisV04 | undefined; if (p.criterionRevision !== undefined) { const revision = p.criterionRevision; const origin = revision.authority.origin; if (!existing || input.producerType !== 'thesis_criterion_confirmed' || input.proposals.length !== 1 || p.subjectKey !== input.entity.localKey || p.thesisTitle !== existing.title || p.statement !== existing.statement || p.thesisStatus !== existing.status || !validConfirmedCriterion(revision, input.producerRunId)) return terminalOutcome('blocked', [`Proposal ${p.proposalId} cannot confirm a criterion for a new, changed, or unauthorized Thesis`], intents, entityRefs, relationRefs, sourceRefs, claimRefs); const sameCondition = (existing.killCriteria ?? []).filter((item) => item.conditionId === revision.conditionId); const expectedRevision = Math.max(0, ...sameCondition.map((item) => item.revision)) + 1; if (revision.revision !== expectedRevision) return terminalOutcome('blocked', [`Criterion ${String(revision.conditionId)} revision is stale or conflicts with canonical history`], intents, entityRefs, relationRefs, sourceRefs, claimRefs); if (origin.kind === 'source_derived') { const ev = evidenceFor(p); const bound = ev.some((item) => item.sourceRef === origin.sourceRef && item.rawRef === origin.rawRef && item.locator === origin.locator); if (!bound) return terminalOutcome('blocked', ['Source-derived criterion origin must match admitted Source/Raw evidence and its exact locator at confirmation'], intents, entityRefs, relationRefs, sourceRefs, claimRefs); try { await verifyRaw(input.handle, origin.rawRef as RawRef) } catch { return terminalOutcome('blocked', ['Source-derived criterion Raw failed integrity verification at confirmation'], intents, entityRefs, relationRefs, sourceRefs, claimRefs) } } const priorCriteria = existing.killCriteria ?? []; const updatedCriteria = priorCriteria.map((item) => item.conditionId === revision.conditionId && item.state === 'active' ? { ...item, state: 'superseded' as const } : item); const canonicalRevision = structuredClone(revision); const thesis: KnowledgeThesisV04 = { ...existing, killCriteria: [...updatedCriteria, canonicalRevision], updatedAt: now() }; thesisRefs[p.proposalId] = id; addOrUpdate(thesis, 'thesis', id); intents.push(intent(`thesis-${p.proposalId}`, 'bound_existing', 'Confirmed criterion revision appended to canonical Thesis', { proposalId: p.proposalId, targetRef: id })); continue } const thesis: KnowledgeThesisV04 = { id: id as `thesis:${string}`, subjectRefs: [subjectRef as `entity:${string}`], title: p.thesisTitle, statement: p.statement, status: p.thesisStatus, createdAt: existing?.createdAt ?? now(), ...(existing?.lastReviewedAt ? { lastReviewedAt: existing.lastReviewedAt } : {}), ...(existing?.killCriteria === undefined ? {} : { killCriteria: existing.killCriteria }), lifecycle: { status: p.thesisStatus === 'archived' ? 'archived' : 'active' }, updatedAt: now() }; thesisRefs[p.proposalId] = id; addOrUpdate(thesis, 'thesis', id); intents.push(intent(`thesis-${p.proposalId}`, existing ? 'bound_existing' : 'created_new', existing ? 'Canonical Thesis resolved' : 'Created canonical Thesis', { proposalId: p.proposalId, targetRef: id })) }
      for (const p of proposals.filter((x) => x.kind === 'relation')) { const sr = entityRefs[p.subjectKey]; const tr = p.targetKey ? entityRefs[p.targetKey] : undefined; const d = p.relationType ? KNOWLEDGE_SCHEMA_V04.relation.definitions[p.relationType as keyof typeof KNOWLEDGE_SCHEMA_V04.relation.definitions] : undefined; const se = sr ? objects.get(sr) as KnowledgeEntityV04 : undefined; const te = tr ? objects.get(tr) as KnowledgeEntityV04 : undefined; const ev = evidenceFor(p); const valid = Boolean(sr && tr && d && relationTypes.has(p.relationType ?? '') && se && te && (d.sourceTypes as readonly string[]).includes(se.type) && (d.targetTypes as readonly string[]).includes(te.type) && validateRelationAttributesV03(p.relationType!, p.attributes).valid && ev.length); if (!valid) { intents.push(intent(`relation-${p.proposalId}`, 'review_required', 'Relation endpoint, type, attributes, or evidence could not be resolved', { proposalId: p.proposalId })); continue } const old = [...objects.values()].find((o) => o.id.startsWith('relation:') && (o as KnowledgeRelationV04).type === p.relationType && (o as KnowledgeRelationV04).sourceRef === sr && (o as KnowledgeRelationV04).targetRef === tr && hashKnowledgeObject((o as KnowledgeRelationV04).attributes ?? null) === hashKnowledgeObject(p.attributes ?? null)) as KnowledgeRelationV04 | undefined; const id = old?.id ?? allocateKnowledgeId('relation', { type: p.relationType, sourceRef: sr, targetRef: tr, attributes: p.attributes ?? null }); relationRefs[p.proposalId] = id; const merged = { id, type: p.relationType, sourceRef: sr, targetRef: tr, ...(p.attributes === undefined ? {} : { attributes: p.attributes }), sourceRefs: [...new Set([...(old?.sourceRefs ?? []), ...ev.map((x) => x.sourceRef)])], lifecycle: { status: 'active' } } as unknown as KnowledgeRelationV04; objects.set(id, merged); if (!old) { operations.push({ operationId: `create-relation-${operations.length + 1}`, type: 'create', object: merged }); createdIds.push(id) } else if (hashKnowledgeObject(old) !== hashKnowledgeObject(merged)) { operations.push({ operationId: `update-relation-${operations.length + 1}`, type: 'update', knowledgeId: id, expectedBeforeHash: hashKnowledgeObject(old), object: merged }); updatedIds.push(id) } intents.push(intent(`relation-${p.proposalId}`, old ? 'bound_existing' : 'created_new', old ? 'Exact canonical Relation matched' : 'Created canonical Relation', { proposalId: p.proposalId, targetRef: id })) }
      const reviewCases: ReviewCase[] = []
      for (const p of proposals.filter((x) => x.kind === 'claim')) { const ev = evidenceFor(p); const relationSubject = proposals.some((x) => x.kind === 'relation' && x.proposalId === p.subjectKey); const subject = p.resolution === 'review' ? undefined : relationRefs[p.subjectKey] ?? entityRefs[p.subjectKey] ?? (relationSubject ? undefined : entityRefs[input.entity.localKey]); if (!subject || ev.length === 0) { intents.push(intent(`claim-${p.proposalId}`, 'review_required', p.resolution === 'review' ? 'Producer marked semantic resolution for review' : relationSubject ? 'Relation subject unresolved; no root fallback permitted' : 'Claim lacks a bound subject or usable evidence', { proposalId: p.proposalId })); if (p.resolution === 'review' && ev[0]?.rawRef) reviewCases.push(reviewCase(input, p, ev[0].rawRef)); continue }
        const incoming = validStructured(p.structuredValue); const requestedRef = p.existingKnowledgeRefs?.length === 1 ? p.existingKnowledgeRefs[0] : undefined; const explicitResolution = p.resolution === 'update' || p.resolution === 'supersede' || p.resolution === 'contradict' || p.resolution === 'review'; if (p.existingKnowledgeRefs && (p.existingKnowledgeRefs.length !== 1 || !explicitResolution)) { intents.push(intent(`claim-${p.proposalId}`, 'review_required', 'existingKnowledgeRefs require one explicit resolution', { proposalId: p.proposalId })); continue } const requested = requestedRef && p.resolution !== 'review' ? objects.get(requestedRef) as KnowledgeClaimV04 | undefined : undefined; if (requestedRef && p.resolution !== 'review' && (!requested || !requested.id.startsWith('claim:'))) { intents.push(intent(`claim-${p.proposalId}`, 'review_required', 'Explicit Claim resolution requires one existing canonical Claim ref', { proposalId: p.proposalId })); continue }
        const subjectRef = subject as `entity:${string}` | `relation:${string}`; const exact = requested ?? [...objects.values()].find((o) => exactClaim(o, claimIdentity(p, subjectRef))) as KnowledgeClaimV04 | undefined; let old = exact; let semanticSupersede = false; let semanticContradict = false; const resolver = input.semanticResolver ?? this.resolver; if (!old && incoming && resolver) { const plausible = [...objects.values()].filter((o) => o.id.startsWith('claim:') && (o as KnowledgeClaimV04).claimType === p.claimType && (o as KnowledgeClaimV04).subjectRefs.includes(subjectRef) && validStructured((o as KnowledgeClaimV04).structuredValue)?.metric === incoming.metric) as KnowledgeClaimV04[]; if (plausible.length) { const decision = await resolver({ proposal: p, existing: plausible.map((x) => ({ canonicalRef: x.id, claimType: x.claimType, statement: x.statement, structuredValue: x.structuredValue })), evidence: ev }); if (decision.outcome === 'uncertain' || plausible.length !== 1) { intents.push(intent(`claim-${p.proposalId}`, 'review_required', 'Bounded semantic resolution did not identify one canonical Claim', { proposalId: p.proposalId })); if (ev[0]?.rawRef) reviewCases.push(reviewCase(input, p, ev[0].rawRef)); continue } old = plausible[0]; semanticSupersede = decision.outcome === 'supersedes'; semanticContradict = decision.outcome === 'contradicts' } } if (!old && (p.resolution === 'supersede' || p.resolution === 'contradict') && incoming) old = [...objects.values()].find((o) => o.id.startsWith('claim:') && (o as KnowledgeClaimV04).subjectRefs.includes(subjectRef) && validStructured((o as KnowledgeClaimV04).structuredValue)?.metric === incoming.metric) as KnowledgeClaimV04 | undefined
        const id = (old && !((p.resolution === 'supersede' || p.resolution === 'contradict') || semanticSupersede || semanticContradict)) ? old.id : allocateKnowledgeId('claim', { ...claimIdentity(p, subjectRef), ...(old && (p.resolution === 'contradict' || semanticContradict) ? { contradictsClaimRef: old.id } : {}) }).replace('claim:', 'claim:research-'); const provenance = ev.map((x) => ({ sourceRef: x.sourceRef, rawRef: x.rawRef, locator: x.locator ?? null, chunkRef: null })); const probability = p.probability ?? (p.claimType === 'forecast' ? 0.5 : null)
        let claim: KnowledgeClaimV04 = { id, claimType: p.claimType!, statement: p.statement!, subjectRefs: [subjectRef], primarySubjectRef: subjectRef, ...(p.temporal === undefined ? {} : { temporal: p.temporal }), ...(incoming ? { structuredValue: incoming } : {}), sourceRefs: ev.map((x) => x.sourceRef), provenance, confidence: p.confidence ?? 0.5, probability, lifecycle: { status: 'active' } } as unknown as KnowledgeClaimV04
        if (p.resolution === 'update' && old && incoming) { const prior = validStructured(old.structuredValue); if (!prior || !frozenClaimFields(old, p, subjectRef)) { intents.push(intent(`claim-${p.proposalId}`, 'review_required', 'Claim update changes a frozen canonical field; only structured value may change', { proposalId: p.proposalId, targetRef: old.id })); continue } claim = { ...mergeClaimEvidence(old, ev), structuredValue: { ...prior, value: incoming.value as string | number | boolean | null } as never } }
        else if (old && p.resolution !== 'supersede' && p.resolution !== 'contradict' && !semanticSupersede && !semanticContradict) claim = { ...old, sourceRefs: [...new Set([...(old.sourceRefs ?? []), ...ev.map((x) => x.sourceRef)])], provenance: [...new Map([...(old.provenance ?? []), ...provenance].map((x) => [`${x.sourceRef}|${x.rawRef}|${x.locator ?? ''}`, x])).values()] }
        if ((p.resolution === 'contradict' || semanticContradict) && old) claim = { ...claim, contradictsClaimRefs: [...new Set([...(claim.contradictsClaimRefs ?? []), old.id])] }
        if ((p.resolution === 'supersede' || semanticSupersede) && old && old.id !== id) { const superseded = { ...old, lifecycle: { ...old.lifecycle, status: 'superseded' as const }, supersededBy: [...new Set([...(old.supersededBy ?? []), id as `claim:${string}`])] } as KnowledgeClaimV04; claim = { ...claim, supersedes: [...new Set([...(claim.supersedes ?? []), old.id])] }; objects.set(old.id, superseded); operations.push({ operationId: `supersede-claim-${operations.length + 1}`, type: 'update', knowledgeId: old.id, expectedBeforeHash: hashKnowledgeObject(old), object: superseded }); updatedIds.push(old.id) }
        claimRefs[p.proposalId] = id; objects.set(id, claim); if (!old || ((p.resolution === 'supersede' || semanticSupersede) && old.id !== id) || p.resolution === 'contradict' || semanticContradict) { operations.push({ operationId: `claim-${operations.length + 1}`, type: 'create', object: { ...claim, id: id as `claim:${string}` } }); createdIds.push(id) } else if (hashKnowledgeObject(old) !== hashKnowledgeObject(claim)) { operations.push({ operationId: `update-claim-${operations.length + 1}`, type: 'update', knowledgeId: old.id, expectedBeforeHash: hashKnowledgeObject(old), object: { ...claim, id: old.id } }); updatedIds.push(old.id) } intents.push(intent(`claim-${p.proposalId}`, old ? 'bound_existing' : 'created_new', old ? 'Canonical Claim resolved and provenance merged' : 'Created canonical Claim', { proposalId: p.proposalId, targetRef: id }))
      }
      for (const p of proposals.filter((x) => x.kind === 'claim')) {
        const id = claimRefs[p.proposalId]; let current = id ? objects.get(id) as KnowledgeClaimV04 | undefined : undefined
        if (!current) continue
        for (const [key, field] of [['supportsProposalIds', 'supportsClaimRefs'], ['dependsOnProposalIds', 'dependsOnClaimRefs'], ['contradictsProposalIds', 'contradictsClaimRefs']] as const) {
          const refs = (p[key] ?? []).map((proposalId) => claimRefs[proposalId]).filter((ref): ref is `claim:${string}` => Boolean(ref) && ref !== id)
          if (!refs.length) continue
          const linked = { ...current, [field]: [...new Set([...(current[field] ?? []), ...refs])] } as KnowledgeClaimV04
          if (hashKnowledgeObject(linked) === hashKnowledgeObject(current)) continue
          objects.set(id, linked); current = linked
          let operationIndex = -1
          for (let index = operations.length - 1; index >= 0 && operationIndex < 0; index -= 1) { const candidate = operations[index]; if ((candidate.type === 'create' && candidate.object.id === id) || (candidate.type === 'update' && candidate.knowledgeId === id)) operationIndex = index }
          if (operationIndex >= 0) operations[operationIndex] = { ...operations[operationIndex], object: linked } as KnowledgeOperationV04
          else { const original = assets.objects.find((asset) => asset.value.id === id)?.value; if (original) operations.push({ operationId: `link-claim-${operations.length + 1}`, type: 'update', knowledgeId: id, expectedBeforeHash: hashKnowledgeObject(original), object: linked }) }
        }
      }
      const evidenceBackedNumericClaimRefs = new Set<string>()
      for (const [ref, value] of objects) {
        if (!ref.startsWith('claim:')) continue
        const before = canonicalObjects.get(ref) as KnowledgeClaimV04 | undefined
        if (!before) continue
        const priorEvidence = new Set((before.provenance ?? []).map((item) => `${item.sourceRef}|${item.rawRef}|${item.locator ?? ''}`))
        const current = value as KnowledgeClaimV04
        const addedEvidence = current.provenance?.some((item) => !priorEvidence.has(`${item.sourceRef}|${item.rawRef}|${item.locator ?? ''}`)) ?? false
        const priorStructured = validStructured(before.structuredValue)
        const currentStructured = validStructured(current.structuredValue)
        const finiteNumericValueChanged = Boolean(priorStructured && currentStructured
          && typeof priorStructured.value === 'number' && Number.isFinite(priorStructured.value)
          && typeof currentStructured.value === 'number' && Number.isFinite(currentStructured.value)
          && priorStructured.value !== currentStructured.value
          && hashKnowledgeObject({ ...priorStructured, value: null }) === hashKnowledgeObject({ ...currentStructured, value: null }))
        if (addedEvidence && finiteNumericValueChanged) evidenceBackedNumericClaimRefs.add(ref)
      }
      const claimMetricMatchesNumericRole = (ref: string, role: string | undefined): boolean => {
        if (role !== 'market_cap' && role !== 'annual_revenue') return false
        const claim = objects.get(ref) as KnowledgeClaimV04 | undefined
        const structured = claim ? validStructured(claim.structuredValue) : undefined
        if (!structured || typeof structured.value !== 'number' || !Number.isFinite(structured.value)) return false
        const metric = String(structured.metric).toLowerCase().replace(/^metric:/, '').replace(/[^a-z0-9]/g, '')
        return role === 'market_cap'
          ? ['marketcap', 'marketcapitalization', 'marketcapitalisation', 'marketvalue'].includes(metric)
          : ['revenue', 'annualrevenue', 'sales', 'turnover'].includes(metric)
      }
      for (const p of proposals.filter((x) => x.kind === 'reasoning_edge')) {
        const localSource = p.sourceProposalId ?? p.subjectKey
        const sourceRef = p.existingSourceRef ?? boundRef(localSource)
        const targetRef = p.existingTargetRef ?? boundRef(p.targetKey)
        const sourceObject = sourceRef ? (p.existingSourceRef ? canonicalObjects : objects).get(sourceRef) : undefined
        const targetObject = targetRef ? (p.existingTargetRef ? canonicalObjects : objects).get(targetRef) : undefined
        const sourceKind = sourceObject?.id.split(':', 1)[0]
        const targetKind = targetObject?.id.split(':', 1)[0]
        const endpointActive = (asset: KnowledgeAssetV04 | undefined): boolean => {
          if (!asset || !('lifecycle' in asset) || asset.lifecycle?.status !== 'active') return false
          const evaluatedAt = Date.parse(now())
          const validFrom = asset.lifecycle.validFrom == null ? undefined : Date.parse(asset.lifecycle.validFrom)
          const validUntil = asset.lifecycle.validUntil == null ? undefined : Date.parse(asset.lifecycle.validUntil)
          if (!Number.isFinite(evaluatedAt) || (validFrom !== undefined && (!Number.isFinite(validFrom) || validFrom > evaluatedAt)) || (validUntil !== undefined && (!Number.isFinite(validUntil) || validUntil <= evaluatedAt))) return false
          if (asset.id.startsWith('claim:') && (asset as KnowledgeClaimV04).lifecycle.status === 'superseded') return false
          if (asset.id.startsWith('thesis:') && ['invalidated', 'archived'].includes((asset as KnowledgeThesisV04).status)) return false
          return true
        }
        if (!sourceRef || !targetRef || !endpointActive(sourceObject) || !endpointActive(targetObject) || !['observation', 'claim'].includes(sourceKind ?? '') || !['claim', 'thesis'].includes(targetKind ?? '') || sourceRef === targetRef || !reasoningEdgeTypes.has(p.edgeType ?? '')) {
          intents.push(intent(`reasoning-edge-${p.proposalId}`, 'review_required', 'ReasoningEdge endpoint is missing, inactive, superseded, or type-invalid, or its edge type is invalid', { proposalId: p.proposalId }))
          continue
        }
        const ev = evidenceFor(p); const id = allocateKnowledgeId('reasoning-edge', { type: p.edgeType, sourceRef, targetRef }); const existing = objects.get(id) as KnowledgeReasoningEdgeV04 | undefined
        const edge: KnowledgeReasoningEdgeV04 = { id: id as `reasoning-edge:${string}`, type: p.edgeType!, sourceRef: sourceRef as KnowledgeReasoningEdgeV04['sourceRef'], targetRef: targetRef as KnowledgeReasoningEdgeV04['targetRef'], ...(ev.length ? { sourceRefs: uniqueSorted(ev.map((item) => item.sourceRef)) as `source:${string}`[] } : {}), ...(p.confidence === undefined ? {} : { confidence: p.confidence }), ...(input.asOf ? { asOf: input.asOf } : {}), lifecycle: { status: 'active' }, createdAt: existing?.createdAt ?? now(), updatedAt: now() }
        reasoningEdgeRefs[p.proposalId] = id; addOrUpdate(edge, 'reasoning-edge', id); intents.push(intent(`reasoning-edge-${p.proposalId}`, existing ? 'bound_existing' : 'created_new', existing ? 'Canonical ReasoningEdge resolved' : 'Created canonical ReasoningEdge', { proposalId: p.proposalId, targetRef: id }))
      }
      const competitionModuleProposals = input.proposals.filter((proposal): proposal is CompetitionModuleProductionProposal => proposal.kind === 'module')
      const activeObject = (value: KnowledgeAssetV04 | undefined): value is KnowledgeAssetV04 => record(value) && record((value as unknown as Dict).lifecycle) && ((value as unknown as Dict).lifecycle as Dict).status === 'active'
      const moduleSourceChecks = new Map<string, Promise<string | undefined>>()
      const moduleSourceFailure = (sourceRef: string): Promise<string | undefined> => {
        const cached = moduleSourceChecks.get(sourceRef)
        if (cached) return cached
        const checked = (async (): Promise<string | undefined> => {
          const source = objects.get(sourceRef) as KnowledgeSourceV04 | undefined
          const lifecycle = source?.lifecycle
          const validFrom = lifecycle?.validFrom == null ? undefined : Date.parse(lifecycle.validFrom)
          const validUntil = lifecycle?.validUntil == null ? undefined : Date.parse(lifecycle.validUntil)
          const rightsExpiresAt = source?.rights.expiresAt == null ? undefined : Date.parse(source.rights.expiresAt)
          const lifecycleValid = Boolean(source && lifecycle?.status === 'active' && Number.isFinite(evidenceEvaluatedAt)
            && (validFrom === undefined || (Number.isFinite(validFrom) && validFrom <= evidenceEvaluatedAt))
            && (validUntil === undefined || (Number.isFinite(validUntil) && validUntil > evidenceEvaluatedAt))
            && (rightsExpiresAt === undefined || (Number.isFinite(rightsExpiresAt) && rightsExpiresAt > evidenceEvaluatedAt)))
          const usagePolicy = source?.usagePolicy
          if (!source || !lifecycleValid || !['public', 'authenticated'].includes(source.rights.accessScope)
            || source.rights.retentionAllowed !== true || source.rights.aiProcessingAllowed !== true || source.rights.derivativeKnowledgeAllowed !== true
            || usagePolicy?.retainRaw !== true || usagePolicy.allowAiProcessing !== true || usagePolicy.allowDerivedKnowledge !== true) {
            return `Source ${sourceRef} is missing, inactive, expired, or does not permit retained derived Knowledge`
          }
          if (!Array.isArray(source.rawRefs) || source.rawRefs.length === 0) return `Source ${sourceRef} has no registered Raw evidence`
          for (const rawRef of source.rawRefs) {
            if (typeof rawRef !== 'string' || !/^raw-sha256-[0-9a-f]{64}$/.test(rawRef)) return `Source ${sourceRef} has a malformed Raw reference`
            try { await verifyRaw(input.handle, rawRef) } catch { return `Source ${sourceRef} Raw evidence failed registry or integrity verification: ${rawRef}` }
          }
          return undefined
        })()
        moduleSourceChecks.set(sourceRef, checked)
        return checked
      }
      interface KnowledgeSourceResolution { readonly sourceRefs: readonly string[]; readonly errors: readonly string[] }
      const sourceRefsForKnowledge = async (ref: string, visited = new Set<string>()): Promise<KnowledgeSourceResolution> => {
        if (visited.has(ref)) return { sourceRefs: [], errors: [] }
        visited.add(ref)
        const value = objects.get(ref) as unknown as Dict | undefined
        if (!value) return { sourceRefs: [], errors: [`Knowledge reference ${ref} does not resolve`] }
        if (ref.startsWith('source:')) {
          const failure = await moduleSourceFailure(ref)
          return failure ? { sourceRefs: [], errors: [failure] } : { sourceRefs: [ref], errors: [] }
        }
        const sourceRefs = new Set<string>()
        const sourceErrors: string[] = []
        const addSource = async (sourceRef: unknown): Promise<void> => {
          if (typeof sourceRef !== 'string' || !sourceRef.startsWith('source:')) { sourceErrors.push(`Knowledge reference ${ref} contains a malformed Source reference`); return }
          const failure = await moduleSourceFailure(sourceRef)
          if (failure) sourceErrors.push(failure)
          else sourceRefs.add(sourceRef)
        }
        if (Array.isArray(value.sourceRefs)) for (const sourceRef of value.sourceRefs) await addSource(sourceRef)
        else if (value.sourceRefs !== undefined && value.sourceRefs !== null) sourceErrors.push(`Knowledge reference ${ref} has malformed sourceRefs`)
        if (value.sourceRef !== undefined && value.sourceRef !== null && (ref.startsWith('observation:') || (typeof value.sourceRef === 'string' && value.sourceRef.startsWith('source:')))) await addSource(value.sourceRef)
        if (Array.isArray(value.supportingClaimRefs)) for (const claimRef of value.supportingClaimRefs) {
          const claim = objects.get(String(claimRef)) as KnowledgeClaimV04 | undefined
          if (!claim || !claim.id.startsWith('claim:')) { sourceErrors.push(`Knowledge reference ${ref} contains an unresolved supporting Claim: ${String(claimRef)}`); continue }
          if (claim.subjectRefs.includes(ref as `relation:${string}`)) {
            const nested = await sourceRefsForKnowledge(claim.id, visited)
            for (const sourceRef of nested.sourceRefs) sourceRefs.add(sourceRef)
            sourceErrors.push(...nested.errors)
          }
        }
        if (Array.isArray(value.contributingObservationRefs)) for (const observationRef of value.contributingObservationRefs) {
          const nested = await sourceRefsForKnowledge(String(observationRef), visited)
          for (const sourceRef of nested.sourceRefs) sourceRefs.add(sourceRef)
          sourceErrors.push(...nested.errors)
        }
        return { sourceRefs: uniqueSorted([...sourceRefs]), errors: sourceErrors }
      }
      const isRelevantToCompany = (value: KnowledgeAssetV04, companyRef: string): boolean => {
        const data = value as unknown as Dict
        if (value.id.startsWith('claim:')) {
          if (!Array.isArray(data.subjectRefs)) return false
          return data.subjectRefs.some((subjectRef) => subjectRef === companyRef || (typeof subjectRef === 'string' && subjectRef.startsWith('relation:') && (() => {
            const relation = objects.get(subjectRef) as KnowledgeRelationV04 | undefined
            return relation?.sourceRef === companyRef || relation?.targetRef === companyRef
          })()))
        }
        if (value.id.startsWith('observation:')) return data.subjectRef === companyRef
        if (value.id.startsWith('relation:')) return data.sourceRef === companyRef || data.targetRef === companyRef
        return false
      }
      const blockedModule = (proposal: CompetitionModuleProductionProposal, message: string): KnowledgeProductionOutcome => {
        intents.push(intent(`module-${proposal.proposalId}`, 'review_required', message, { proposalId: proposal.proposalId }))
        return terminalOutcome('blocked', [`Competition Module ${proposal.proposalId}: ${message}`], intents, entityRefs, relationRefs, sourceRefs, claimRefs)
      }
      const handledModuleIds = new Set<string>()
      for (const proposal of competitionModuleProposals) {
        const targetRef = 'localKey' in proposal.targetIndustry && typeof proposal.targetIndustry.localKey === 'string' ? entityRefs[proposal.targetIndustry.localKey] : proposal.targetIndustry.existingRef
        const target = targetRef ? objects.get(targetRef) as KnowledgeEntityV04 | undefined : undefined
        if (!targetRef || !target || !target.id.startsWith('entity:') || target.type !== 'industry' || !activeObject(target) || ('existingRef' in proposal.targetIndustry && !canonicalObjects.has(targetRef))) return blockedModule(proposal, 'target must resolve to an active Industry Entity')
        const existingModules = [...objects.values()].filter((value) => value.id.startsWith('module:') && (value as KnowledgeModuleV04).type === 'competition' && (value as KnowledgeModuleV04).targetEntity === targetRef)
        if (existingModules.length > 1) return blockedModule(proposal, 'multiple canonical competition Modules already target this Industry')
        const moduleId = existingModules[0]?.id ?? allocateKnowledgeId('module', { type: 'competition', targetEntity: targetRef })
        if (handledModuleIds.has(moduleId)) return blockedModule(proposal, 'multiple Module proposals target the same Industry in one submission')
        handledModuleIds.add(moduleId)
        const collision = objects.get(moduleId)
        if (collision && (!collision.id.startsWith('module:') || (collision as KnowledgeModuleV04).type !== 'competition' || (collision as KnowledgeModuleV04).targetEntity !== targetRef)) return blockedModule(proposal, 'stable Module identity collides with an incompatible canonical object')
        const existing = collision as unknown as CompetitionModuleV1 | undefined
        if (existing && (existing.schemaId !== COMPETITION_MODULE_SCHEMA_ID_V1 || hashKnowledgeObject(existing.columns) !== hashKnowledgeObject(proposal.columns))) return blockedModule(proposal, 'existing table columns differ; schema changes require review')
        const existingModuleEvidence = existing ? await sourceRefsForKnowledge(moduleId) : { sourceRefs: [], errors: [] }
        if (existingModuleEvidence.errors.length) return blockedModule(proposal, `existing Module Source evidence is unusable: ${existingModuleEvidence.errors.join('; ')}`)

        const directEvidence = evidenceFor(proposal)
        const unresolvedCandidates = uniqueSorted(proposal.sourceCandidateIds ?? []).filter((candidateId) => !sourceRefs[candidateId] || !rawBySource.has(candidateId))
        if (unresolvedCandidates.length) return blockedModule(proposal, `direct Source evidence did not resolve to usable admitted candidates: ${unresolvedCandidates.join(', ')}`)
        const moduleSourceRefs = new Set<string>([
          ...existingModuleEvidence.sourceRefs,
          ...directEvidence.map((item) => item.sourceRef),
        ])
        const incomingRows: CompetitionRowV1[] = []
        const incomingCompanies = new Set<string>()
        for (const [rowIndex, rowProposal] of proposal.rows.entries()) {
          const companyRef = 'localKey' in rowProposal.company && typeof rowProposal.company.localKey === 'string' ? entityRefs[rowProposal.company.localKey] : rowProposal.company.existingRef
          const company = companyRef ? objects.get(companyRef) as KnowledgeEntityV04 | undefined : undefined
          if (!companyRef || !company || !company.id.startsWith('entity:') || company.type !== 'company' || !activeObject(company) || ('existingRef' in rowProposal.company && !canonicalObjects.has(companyRef))) return blockedModule(proposal, `row ${rowIndex} Company must resolve to an active canonical Company Entity`)
          if (incomingCompanies.has(companyRef)) return blockedModule(proposal, `row ${rowIndex} duplicates Company ${companyRef}`)
          incomingCompanies.add(companyRef)

          const relationRef = 'proposalId' in rowProposal.businessExposure && typeof rowProposal.businessExposure.proposalId === 'string' ? relationRefs[rowProposal.businessExposure.proposalId] : rowProposal.businessExposure.existingRef
          const relation = relationRef ? objects.get(relationRef) as KnowledgeRelationV04 | undefined : undefined
          if (!relationRef || !relation || !relation.id.startsWith('relation:') || relation.type !== 'business_exposure' || relation.sourceRef !== companyRef || relation.targetRef !== targetRef || !activeObject(relation) || ('existingRef' in rowProposal.businessExposure && !canonicalObjects.has(relationRef))) return blockedModule(proposal, `row ${rowIndex} requires an active Company-to-Industry business_exposure Relation`)
          const relationEvidence = await sourceRefsForKnowledge(relationRef)
          if (relationEvidence.errors.length) return blockedModule(proposal, `row ${rowIndex} business_exposure Relation has unusable Source evidence: ${relationEvidence.errors.join('; ')}`)
          if (relationEvidence.sourceRefs.length === 0) return blockedModule(proposal, `row ${rowIndex} business_exposure Relation has no resolved Source evidence`)
          for (const sourceRef of relationEvidence.sourceRefs) moduleSourceRefs.add(sourceRef)

          const cells: Record<string, CompetitionModuleV1['rows'][number]['cells'][string]> = {}
          for (const [columnId, cellProposal] of Object.entries(rowProposal.cells)) {
            if (cellProposal.status !== 'available') {
              cells[columnId] = structuredClone(cellProposal)
              continue
            }
            const refs: string[] = []
            for (const selector of cellProposal.knowledgeRefs as readonly CompetitionModuleKnowledgeSelectorV1[]) {
              const knowledgeRef = 'proposalId' in selector ? boundRef(selector.proposalId) : selector.existingRef
              const knowledge = knowledgeRef ? objects.get(knowledgeRef) : undefined
              if (!knowledgeRef || !knowledge || !['claim:', 'observation:', 'relation:'].some((prefix) => knowledge.id.startsWith(prefix)) || ('existingRef' in selector && !canonicalObjects.has(knowledgeRef))) return blockedModule(proposal, `row ${rowIndex} cell ${columnId} has an unresolved canonical knowledge reference`)
              if (!activeObject(knowledge) || !isRelevantToCompany(knowledge, companyRef)) return blockedModule(proposal, `row ${rowIndex} cell ${columnId} reference is inactive or unrelated to Company ${companyRef}`)
              const evidenceRefs = await sourceRefsForKnowledge(knowledgeRef)
              if (evidenceRefs.errors.length) return blockedModule(proposal, `row ${rowIndex} cell ${columnId} reference has unusable Source evidence: ${evidenceRefs.errors.join('; ')}`)
              if (evidenceRefs.sourceRefs.length === 0) return blockedModule(proposal, `row ${rowIndex} cell ${columnId} reference has no resolved Source evidence`)
              refs.push(knowledgeRef)
              for (const sourceRef of evidenceRefs.sourceRefs) moduleSourceRefs.add(sourceRef)
            }
            const canonicalRefs = uniqueSorted(refs) as CompetitionCellKnowledgeRefV1[]
            const { knowledgeRefs: _selectors, ...cellFields } = cellProposal
            cells[columnId] = { ...structuredClone(cellFields), knowledgeRefs: canonicalRefs } as CompetitionModuleV1['rows'][number]['cells'][string]
          }
          incomingRows.push({ companyRef: companyRef as EntityRefV04, cells })
        }

        const priorRows = existing?.rows ?? []
        const priorRowsByCompany = new Map(priorRows.map((row) => [row.companyRef, row]))
        let mergeError: string | undefined
        const mergedRows: CompetitionRowV1[] = incomingRows.map((incoming) => {
          const prior = priorRowsByCompany.get(incoming.companyRef)
          if (!prior) return incoming
          const cells: Record<string, CompetitionRowV1['cells'][string]> = {}
          for (const [columnId, incomingCell] of Object.entries(incoming.cells)) {
            const priorCell = prior.cells[columnId]
            if (priorCell?.status === 'available' && incomingCell.status !== 'available') {
              cells[columnId] = structuredClone(priorCell)
              continue
            }
            if (priorCell?.status === 'available' && incomingCell.status === 'available') {
              const priorRefs = uniqueSorted(priorCell.knowledgeRefs)
              const incomingRefs = uniqueSorted(incomingCell.knowledgeRefs)
              if (hashKnowledgeObject(priorRefs) === hashKnowledgeObject(incomingRefs) && hashKnowledgeObject(priorCell) !== hashKnowledgeObject(incomingCell)) {
                const withoutDisplayAndAsOf = (cell: CompetitionModuleV1['rows'][number]['cells'][string]): Dict => {
                  const remaining = { ...cell } as Dict
                  delete remaining.displayValue
                  delete remaining.asOf
                  return remaining
                }
                const onlyDisplayOrAsOfChanged = hashKnowledgeObject(withoutDisplayAndAsOf(priorCell)) === hashKnowledgeObject(withoutDisplayAndAsOf(incomingCell))
                const columnRole = proposal.columns.find((column) => column.id === columnId)?.role
                const backedByUpdatedClaim = incomingRefs.some((ref) => evidenceBackedNumericClaimRefs.has(ref) && claimMetricMatchesNumericRole(ref, columnRole))
                if (!onlyDisplayOrAsOfChanged || !backedByUpdatedClaim) mergeError = `row Company ${incoming.companyRef} cell ${columnId} changes with the same knowledge references without a newly evidenced numeric Claim value change`
              }
            }
            cells[columnId] = structuredClone(incomingCell)
          }
          return { companyRef: incoming.companyRef, cells }
        })
        if (mergeError) return blockedModule(proposal, mergeError)
        for (const prior of priorRows) if (!incomingCompanies.has(prior.companyRef)) mergedRows.push(structuredClone(prior))

        const sourceRefsForModule = uniqueSorted([...moduleSourceRefs])
        const candidate = {
          id: moduleId as `module:${string}`,
          type: 'competition' as const,
          targetEntity: targetRef as EntityRefV04,
          ...(sourceRefsForModule.length ? { sourceRefs: sourceRefsForModule as `source:${string}`[] } : {}),
          schemaId: proposal.schemaId,
          columns: structuredClone(proposal.columns),
          rows: mergedRows,
        } as CompetitionModuleV1
        const structural = validateCompetitionModuleV1(candidate)
        if (!structural.valid) return blockedModule(proposal, structural.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
        moduleRefs[proposal.proposalId] = moduleId
        const changed = !existing || hashKnowledgeObject(existing) !== hashKnowledgeObject(candidate)
        addOrUpdate(candidate as unknown as KnowledgeAssetV04, 'module', moduleId)
        intents.push(intent(`module-${proposal.proposalId}`, !existing ? 'created_new' : changed ? 'bound_existing' : 'bound_existing', !existing ? 'Created canonical competition Module' : changed ? 'Merged evidence-backed changes into the canonical competition Module' : 'Canonical competition Module resolved without changes', { proposalId: proposal.proposalId, targetRef: moduleId }))
      }
      for (const operation of operations) if (operation.type === 'update' && operation.knowledgeId !== operation.object.id) return terminalOutcome('blocked', ['Update operation knowledgeId must equal operation.object.id'], intents, entityRefs, relationRefs, sourceRefs, claimRefs)
      if (input.writeKnowledge !== false && reviewCases.length) await persistReviewCases({ rootRef: input.handle.rootRef, knowledgeBaseId: input.handle.knowledgeBaseId, producerRunId: input.producerRunId, producerType: input.reviewProducerType ?? input.producerType, cases: reviewCases, createdAt: now(), schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: input.handle.revision })
      if (input.writeKnowledge === false) return { status: 'no_changes', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: sourceRefs, claimRefsByProposalId: claimRefs, entityRefsByLocalKey: entityRefs, relationRefsByProposalId: relationRefs, moduleRefsByProposalId: moduleRefs, eventRefsByProposalId: eventRefs, observationRefsByProposalId: observationRefs, thesisRefsByProposalId: thesisRefs, reasoningEdgeRefsByProposalId: reasoningEdgeRefs, resolutionIntents: intents, errors: [] }
      if (!operations.length) return { status: 'no_changes', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: sourceRefs, claimRefsByProposalId: claimRefs, entityRefsByLocalKey: entityRefs, relationRefsByProposalId: relationRefs, moduleRefsByProposalId: moduleRefs, eventRefsByProposalId: eventRefs, observationRefsByProposalId: observationRefs, thesisRefsByProposalId: thesisRefs, reasoningEdgeRefsByProposalId: reasoningEdgeRefs, resolutionIntents: intents, errors: [] }
      const cs: KnowledgeChangeSetV04 = { changeSetId: `changeset-${input.producerType}-${sha256(JSON.stringify(operations.map((o) => o.operationId))).slice(0, 20)}`, workflowRunId: input.producerRunId, knowledgeBaseId: input.handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: input.handle.revision, operations, ingestionContext: { producerType: input.producerType, producerRunId: input.producerRunId, asOf: input.asOf ?? null } }; const v = await validateKnowledgeChangeSetV04(input.handle, cs, { mode: 'commit', now }); if (!v.validatedChangeSet) return terminalOutcome('blocked', v.report.errors.map((e) => `${e.code}: ${e.message}`), intents, entityRefs, relationRefs, sourceRefs, claimRefs); const w = await writeKnowledgeBase(input.handle, v.validatedChangeSet, { registry: this.registry, clock: now }) as KnowledgeWriteResultV04; if (w.status === 'failed' || w.status === 'rejected') return terminalOutcome('failed', [w.error?.message ?? 'Shared Writer rejected the validated ChangeSet'], intents, entityRefs, relationRefs, sourceRefs, claimRefs); return { status: w.status, knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: w.committedRevision, baseRevision: input.handle.revision, changeSetId: cs.changeSetId, createdIds: w.createdIds, updatedIds: w.updatedIds, sourceRefsByLocalId: sourceRefs, claimRefsByProposalId: claimRefs, entityRefsByLocalKey: entityRefs, relationRefsByProposalId: relationRefs, moduleRefsByProposalId: moduleRefs, eventRefsByProposalId: eventRefs, observationRefsByProposalId: observationRefs, thesisRefsByProposalId: thesisRefs, reasoningEdgeRefsByProposalId: reasoningEdgeRefs, resolutionIntents: intents, errors: [] }
    } catch (e) { return terminalOutcome('failed', [e instanceof Error ? e.message : String(e)], intents, entityRefs, relationRefs, sourceRefs, claimRefs) }
  }
}
