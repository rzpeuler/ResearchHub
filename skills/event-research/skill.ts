import type { ReasoningExecutor, ReasoningRequest } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { SemanticProductionProposal } from '../../knowledge/production/contracts.ts'
import {
  EVENT_DURABLE_CLAIM_TYPES,
  EVENT_EVIDENCE_REQUIREMENTS,
  EVENT_EVIDENCE_VERDICTS,
  EVENT_RESEARCH_SECTIONS,
  type EventAssumptionUpdate,
  type EventContradiction,
  type EventDurableClaimType,
  type EventEvidenceAssessmentInput,
  type EventEvidenceAssessmentOutput,
  type EventEvidenceRequirement,
  type EventEvidenceSource,
  type EventExistingKnowledgeClaim,
  type EventImpactAssessment,
  type EventInterpretation,
  type EventResearchProposal,
  type EventResearchGatewayProposal,
  type EventResearchReasoningTelemetry,
  type EventReasoningShape,
  type EventResearchSynthesisInput,
  type EventResearchSynthesisOutput,
  type EventSourceAssessment,
  type EventStructuredValue,
  type EventVerifiedFact,
  type EventVerificationLevel,
  type EventVerificationResult,
  type EventEvidenceAssessmentSkillResult,
  type EventResearchSynthesisSkillResult,
} from './contracts.ts'

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const CLAIM_REF = /^claim:[^\s]+$/
const MAX_VERIFIED_FACTS = 12
const MAX_PROPOSALS = 4
const MAX_REPAIR_OUTPUT_CHARS = 12_000
const MAX_SOURCE_EXCERPT = 1_500
const MAX_EXISTING_CLAIMS = 60
const MAX_SOURCE_ASSESSMENTS = 12
const MAX_CONTRADICTIONS = 12
const MAX_REFERENCE_ITEMS = 12
const MAX_IMPACT_ASSESSMENTS = 12
const MAX_STRUCTURED_STRING = 96
const STRUCTURED_SAFE_STRING = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/
const FISCAL_PERIOD = /^\d{4}-(?:Q[1-4]|H[12]|FY)$/
const WRAPPERS = ['result', 'output', 'data', 'structuredOutput', 'response'] as const
const STRUCTURED_FIELDS = ['comparator', 'fiscalPeriod', 'metric', 'period', 'semanticKey', 'unit', 'value'] as const
const PROPOSAL_FIELDS = ['assessmentRefs', 'claimType', 'existingKnowledgeRefs', 'kind', 'newValue', 'proposalId', 'sourceCandidateIds', 'statement', 'subjectKey', 'structuredValue'] as const

export class EventResearchSemanticError extends Error {
  readonly retryable: boolean
  readonly diagnostics: readonly string[]

  constructor(message: string, diagnostics: readonly string[] = [], retryable = true) {
    super(message)
    this.name = 'EventResearchSemanticError'
    this.retryable = retryable
    this.diagnostics = diagnostics
  }
}

function telemetry(executor: ReasoningExecutor | undefined, operation: EventResearchReasoningTelemetry['operation'], values: Omit<EventResearchReasoningTelemetry, 'called' | 'operation' | 'model'>): EventResearchReasoningTelemetry {
  const runtime = executor as unknown as { runtimeMetadata?: () => { requestedModel?: string } } | undefined
  const model = typeof runtime?.runtimeMetadata === 'function' ? runtime.runtimeMetadata().requestedModel : undefined
  return { called: executor !== undefined, operation, ...(model === undefined ? {} : { model }), ...values }
}

function safeDiagnostics(error: unknown): readonly string[] {
  if (error instanceof EventResearchSemanticError && error.diagnostics.length > 0) return error.diagnostics.filter((item) => /^[A-Za-z0-9_.:,?=-]+$/.test(item)).slice(0, 24)
  if (error instanceof ReasoningExecutorError) return [`executor_${error.code}`]
  return ['event_research_reasoning_failed']
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function reasoningShape(value: unknown): EventReasoningShape {
  const object = isRecord(value) ? value : {}
  const count = (key: string) => Array.isArray(object[key]) ? object[key].length : 0
  return { topLevelKeys: Object.keys(object).sort().slice(0, 16), interpretationCount: count('interpretations'), assessmentCount: count('assessments'), proposalCount: count('proposals') }
}
function strings(value: unknown): readonly string[] { return Array.isArray(value) ? value.slice(0, MAX_REFERENCE_ITEMS).filter((item): item is string => typeof item === 'string') : [] }
function validLocalId(value: unknown): value is string { return typeof value === 'string' && LOCAL_ID.test(value) }
function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort() }
function exactArray(value: unknown, allowed: ReadonlySet<string>, nonEmpty = false): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_ITEMS) return false
  const items = strings(value)
  return items.length === value.length && new Set(items).size === items.length && (!nonEmpty || items.length > 0) && items.every((item) => allowed.has(item))
}
function nonEmptyText(value: unknown, max = 2_000): value is string { return typeof value === 'string' && value.trim() !== '' && value.trim().length <= max }
function enumValue<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === 'string' && (values as readonly string[]).includes(value) }
function keysAreAllowed(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }

export function parseEventReasoningObject(value: unknown, depth = 0): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      return parseEventReasoningObject(JSON.parse(cleaned), depth)
    } catch {
      throw new EventResearchSemanticError('Event Research reasoning returned invalid JSON', ['output_json_invalid'])
    }
  }
  if (!isRecord(value)) throw new EventResearchSemanticError('Event Research reasoning must return an object', ['output_object_missing'])
  const wrapper = WRAPPERS.find((key) => value[key] !== undefined)
  if (wrapper === undefined) return value
  if (depth >= 2) throw new EventResearchSemanticError('Event Research wrapper depth exceeded', ['output_wrapper_depth_exceeded'])
  return parseEventReasoningObject(value[wrapper], depth + 1)
}

function validSourceId(value: unknown): value is string { return typeof value === 'string' && value !== '' && value.length <= 160 }
function boundedUniqueSources(sources: readonly EventEvidenceSource[]): readonly EventEvidenceSource[] {
  if (!Array.isArray(sources) || sources.length > MAX_REFERENCE_ITEMS) throw new EventResearchSemanticError('Event source candidates exceed the bounded source set', ['source_count_exceeds_bound'])
  const seen = new Set<string>()
  for (const source of sources) {
    if (!isRecord(source)) throw new EventResearchSemanticError('Event source metadata is incomplete or invalid', ['source_metadata_invalid'])
    const candidateId = source.candidateId
    if (!validSourceId(candidateId) || typeof source.title !== 'string' || source.title.trim() === '' || typeof source.provider !== 'string' || source.provider.trim() === '' || typeof source.excerpt !== 'string' || source.excerpt.trim() === '' || (source.kind !== undefined && typeof source.kind !== 'string') || (source.url !== undefined && typeof source.url !== 'string') || (source.publishedAt !== undefined && typeof source.publishedAt !== 'string') || (source.official !== undefined && typeof source.official !== 'boolean')) throw new EventResearchSemanticError('Event source metadata is incomplete or invalid', ['source_metadata_invalid'])
    if (seen.has(candidateId)) throw new EventResearchSemanticError('Duplicate event source candidate IDs are not allowed', ['source_candidate_duplicate'])
    seen.add(candidateId)
  }
  return sources
}
function sourceIds(input: EventEvidenceAssessmentInput | EventResearchSynthesisInput): readonly string[] {
  if (!('evidence' in input)) return uniqueSorted(boundedUniqueSources(input.sources).map((source) => source.candidateId).filter(validSourceId))
  if (input.sources === undefined) return []
  return uniqueSorted(boundedUniqueSources(input.sources).map((source) => source.candidateId).filter(validSourceId))
}

function claimIds(input: EventResearchSynthesisInput): readonly string[] { return uniqueSorted(input.existingKnowledge.slice(0, MAX_EXISTING_CLAIMS).map((claim) => claim.canonicalRef).filter((ref) => typeof ref === 'string' && ref.length <= 200 && CLAIM_REF.test(ref))) }
function claimByRef(input: EventResearchSynthesisInput, ref: string): EventExistingKnowledgeClaim | undefined { return input.existingKnowledge.find((claim) => claim.canonicalRef === ref) }

function sourceIsOfficial(source: EventEvidenceSource | undefined): boolean {
  return source?.official === true || source?.kind === 'official_disclosure' || /cninfo/i.test(source?.provider ?? '')
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return typeof value === 'string' ? value.slice(0, 400) : '[bounded]'
  if (typeof value === 'string') return value.slice(0, 1_200)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => boundedValue(item, depth + 1))
  if (isRecord(value)) {
    const bounded = Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key.slice(0, 160), boundedValue(item, depth + 1)]))
    return JSON.stringify(bounded).length <= MAX_REPAIR_OUTPUT_CHARS ? bounded : { bounded: true, preview: JSON.stringify(bounded).slice(0, MAX_REPAIR_OUTPUT_CHARS - 80) }
  }
  return null
}

function repairInput(priorInvalidStructuredOutput: unknown, validatorDiagnostics: readonly string[]): Record<string, unknown> {
  const diagnostics = validatorDiagnostics.slice(0, 24)
  const candidate = { attempt: 1, priorInvalidStructuredOutput: boundedValue(priorInvalidStructuredOutput), validatorDiagnostics: diagnostics }
  if (JSON.stringify(candidate).length <= MAX_REPAIR_OUTPUT_CHARS) return candidate
  return { attempt: 1, priorInvalidStructuredOutput: '[bounded]', validatorDiagnostics: diagnostics.slice(0, 8) }
}

function modelSources(sources: readonly EventEvidenceSource[]): readonly Record<string, unknown>[] {
  return boundedUniqueSources(sources).map((source) => boundedValue({ candidateId: source.candidateId.slice(0, 160), title: source.title.slice(0, 600), provider: source.provider.slice(0, 160), kind: source.kind?.slice(0, 80), publishedAt: source.publishedAt?.slice(0, 80), url: source.url?.slice(0, 2_000), excerpt: source.excerpt.slice(0, MAX_SOURCE_EXCERPT), ...(source.official === undefined ? {} : { official: source.official }), ...(source.dataProvenance ? { dataProvenance: modelDataProvenance(source.dataProvenance) } : {}) }) as Record<string, unknown>)
}

function modelCompany(company: EventEvidenceAssessmentInput['company'] | EventResearchSynthesisInput['company']): Record<string, unknown> { return boundedValue({ symbol: company.symbol.slice(0, 32), name: company.name?.slice(0, 200), exchange: company.exchange?.slice(0, 32) }) as Record<string, unknown> }
function modelAnchor(anchor: EventEvidenceAssessmentInput['anchor'] | EventResearchSynthesisInput['anchor']): Record<string, unknown> { return boundedValue({ kind: anchor.kind, title: anchor.title.slice(0, 600), description: anchor.description?.slice(0, 1_500), signalId: anchor.signalId?.slice(0, 160), clusterKey: anchor.clusterKey?.slice(0, 160), url: anchor.url?.slice(0, 2_000), publishedAt: anchor.publishedAt?.slice(0, 80), eventDate: anchor.eventDate?.slice(0, 32) }) as Record<string, unknown> }
function modelDataProvenance(provenance: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const allowed = ['originAuthority', 'retrievalProvider', 'sourceUrl', 'publishedAt', 'retrievedAt', 'contentHash', 'dateStatus']
  const result: Record<string, unknown> = {}
  for (const key of allowed) if (typeof provenance[key] === 'string') result[key] = (provenance[key] as string).slice(0, key === 'contentHash' ? 128 : 2_000)
  if (typeof provenance.pointInTimeSafe === 'boolean') result.pointInTimeSafe = provenance.pointInTimeSafe
  return result
}
function modelExcerpt(source: EventEvidenceSource): Record<string, unknown> { return { candidateId: source.candidateId, title: source.title.slice(0, 600), provider: source.provider.slice(0, 160), publishedAt: source.publishedAt?.slice(0, 80), url: source.url?.slice(0, 2_000), excerpt: source.excerpt.slice(0, MAX_SOURCE_EXCERPT), ...(source.dataProvenance ? { dataProvenance: modelDataProvenance(source.dataProvenance) } : {}) } }
function selectedExcerpts(input: EventResearchSynthesisInput, ids: readonly string[], supplied: readonly EventEvidenceSource[] | undefined): readonly Record<string, unknown>[] {
  const allowed = new Set(ids)
  return (supplied ?? input.sources ?? []).slice(0, MAX_SOURCE_ASSESSMENTS).filter((source) => allowed.has(source.candidateId)).map(modelExcerpt)
}

function validateSourceExcerpts(ids: readonly string[], supplied: readonly EventEvidenceSource[] | undefined, label: string, sourceSet: ReadonlySet<string>): void {
  if (supplied === undefined) return
  const bounded = boundedUniqueSources(supplied)
  const allowed = new Set(ids)
  if (bounded.some((source) => !sourceSet.has(source.candidateId) || !allowed.has(source.candidateId))) throw new EventResearchSemanticError(`${label} source excerpts are outside the exact evidence allowlist`, [`${label}_source_excerpts_invalid`])
}
function modelClaim(claim: EventExistingKnowledgeClaim): Record<string, unknown> { return boundedValue({ canonicalRef: claim.canonicalRef, claimType: claim.claimType, statement: claim.statement?.slice(0, 600), subjectRefs: claim.subjectRefs?.slice(0, 12), structuredValue: claim.structuredValue === null || claim.structuredValue === undefined ? claim.structuredValue : boundedValue(claim.structuredValue) }) as Record<string, unknown> }
function modelSourceAssessment(item: EventSourceAssessment): Record<string, unknown> { return boundedValue({ sourceCandidateId: item.sourceCandidateId, verdict: item.verdict, confidence: item.confidence, rationale: item.rationale, evidenceRequirement: item.evidenceRequirement }) as Record<string, unknown> }
function modelFact(item: EventVerifiedFact): Record<string, unknown> { return boundedValue({ factId: item.factId, statement: item.statement, sourceCandidateIds: item.sourceCandidateIds.slice(0, MAX_REFERENCE_ITEMS), confidence: item.confidence, evidenceRequirement: item.evidenceRequirement, structuredValue: item.structuredValue }) as Record<string, unknown> }
function modelContradiction(item: EventContradiction): Record<string, unknown> { return boundedValue({ statement: item.statement, sourceCandidateIds: item.sourceCandidateIds.slice(0, MAX_REFERENCE_ITEMS), ...(item.contradictionId === undefined ? {} : { contradictionId: item.contradictionId }), ...(item.rationale === undefined ? {} : { rationale: item.rationale }) }) as Record<string, unknown> }

function modelVerification(value: EventVerificationResult): Record<string, unknown> { return boundedValue({ verificationLevel: value.verificationLevel, strongVerification: value.strongVerification, supportingSourceCandidateIds: value.supportingSourceCandidateIds.slice(0, MAX_REFERENCE_ITEMS), contradictingSourceCandidateIds: value.contradictingSourceCandidateIds.slice(0, MAX_REFERENCE_ITEMS) }) as Record<string, unknown> }

function assessmentInstruction(repair: boolean, diagnostics: readonly string[]): string {
  const prefix = repair ? `Bounded repair attempt 1. Correct every deterministic diagnostic: ${diagnostics.join(', ') || 'output_contract_invalid'}. Return a complete replacement object.` : 'Return one complete candidate object.'
  return `${prefix} Assess only the supplied event anchor and source candidates. Return exactly sourceAssessments, verifiedFacts, and contradictions, in that order. Copy sourceCandidateId values exactly from the allowlist. Verdicts are supports, contradicts, context, or irrelevant; confidence must be a finite number from 0 through 1; evidenceRequirement is primary, corroborated, or single_source. Return no canonical IDs, no unsupported numbers, no source content outside the supplied excerpts, and no explanatory text outside JSON. verifiedFacts must contain at most ${MAX_VERIFIED_FACTS} items.`
}

function assessmentModelInput(input: EventEvidenceAssessmentInput, repair?: { readonly prior: unknown; readonly diagnostics: readonly string[] }): Record<string, unknown> {
  const value: Record<string, unknown> = { company: modelCompany(input.company), anchor: modelAnchor(input.anchor), asOf: input.asOf?.slice(0, 80), eventDate: input.eventDate?.slice(0, 32), allowedSourceCandidateIds: sourceIds(input), sources: modelSources(input.sources), allowedVerdictValues: EVENT_EVIDENCE_VERDICTS, confidenceRange: { min: 0, max: 1, finite: true }, allowedEvidenceRequirementValues: EVENT_EVIDENCE_REQUIREMENTS, methodology: 'Code owns source identity, dates, verification level, and durable eligibility; the model only assesses bounded evidence.' }
  if (repair !== undefined) value.repair = repairInput(repair.prior, repair.diagnostics)
  return value
}

function assessmentContract(input: EventEvidenceAssessmentInput): Record<string, unknown> {
  const allowedSources = sourceIds(input)
  return { type: 'object', required: ['sourceAssessments', 'verifiedFacts', 'contradictions'], additionalProperties: false, allowedSourceCandidateIds: allowedSources,
    sourceAssessments: { type: 'array', maxItems: MAX_SOURCE_ASSESSMENTS, item: { type: 'object', required: ['sourceCandidateId', 'verdict', 'confidence', 'rationale', 'evidenceRequirement'], additionalProperties: false, sourceCandidateId: { type: 'string', enum: allowedSources, maxLength: 160 }, verdict: EVENT_EVIDENCE_VERDICTS, confidence: { type: 'number', finite: true, min: 0, max: 1 }, rationale: { type: 'string', minLength: 1, maxLength: 1_000 }, evidenceRequirement: EVENT_EVIDENCE_REQUIREMENTS } },
    verifiedFacts: { type: 'array', maxItems: MAX_VERIFIED_FACTS, item: { type: 'object', required: ['factId', 'statement', 'sourceCandidateIds', 'confidence', 'evidenceRequirement'], additionalProperties: false, factId: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 }, statement: { type: 'string', minLength: 1, maxLength: 2_000 }, sourceCandidateIds: sourceReferenceContract(allowedSources, true), confidence: { type: 'number', finite: true, min: 0, max: 1 }, evidenceRequirement: EVENT_EVIDENCE_REQUIREMENTS, structuredValue: structuredValueContract() } },
    contradictions: { type: 'array', maxItems: MAX_CONTRADICTIONS, item: { type: 'object', required: ['statement', 'sourceCandidateIds'], additionalProperties: false, contradictionId: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 }, statement: { type: 'string', minLength: 1, maxLength: 2_000 }, sourceCandidateIds: sourceReferenceContract(allowedSources, true), rationale: { type: 'string', minLength: 1, maxLength: 1_000 } } } }
}

function validateSourceAssessment(value: unknown, index: number, allowed: ReadonlySet<string>): EventSourceAssessment {
  const item = isRecord(value) ? value : {}
  const valid = keysAreAllowed(item, ['sourceCandidateId', 'verdict', 'confidence', 'rationale', 'evidenceRequirement']) && typeof item.sourceCandidateId === 'string' && allowed.has(item.sourceCandidateId) && enumValue(item.verdict, EVENT_EVIDENCE_VERDICTS) && typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 && enumValue(item.evidenceRequirement, EVENT_EVIDENCE_REQUIREMENTS) && nonEmptyText(item.rationale, 1_000)
  if (!valid) throw new EventResearchSemanticError(`Invalid event source assessment ${index}`, [`source_assessment_${index}_invalid`])
  return { sourceCandidateId: item.sourceCandidateId as string, verdict: item.verdict as EventSourceAssessment['verdict'], confidence: item.confidence as number, rationale: (item.rationale as string).trim().slice(0, 1_000), evidenceRequirement: item.evidenceRequirement as EventEvidenceRequirement }
}

function structuredString(value: unknown): value is string { return typeof value === 'string' && STRUCTURED_SAFE_STRING.test(value) }
function structuredPeriod(value: unknown, allowedDates?: ReadonlySet<string>): boolean {
  if (value === undefined || value === null) return true
  if (!structuredString(value)) return false
  if (validIsoDate(value)) return allowedDates === undefined || allowedDates.has(value)
  return FISCAL_PERIOD.test(value)
}
function validateStructuredShape(value: unknown, allowSemanticKey = true, allowedDates?: ReadonlySet<string>): value is EventStructuredValue {
  if (!isRecord(value) || !keysAreAllowed(value, STRUCTURED_FIELDS as readonly string[])) return false
  if (!structuredString(value.metric) || !('value' in value) || !('unit' in value) || (value.unit !== null && !structuredString(value.unit)) || !('comparator' in value) || (value.comparator !== null && !['eq', 'gt', 'gte', 'lt', 'lte', 'approx'].includes(value.comparator as string))) return false
  if (!((typeof value.value === 'string' && value.value.length <= 1_200) || (typeof value.value === 'number' && Number.isFinite(value.value)) || typeof value.value === 'boolean' || value.value === null)) return false
  if (typeof value.value === 'string' && /[-+]?(?:\d+(?:\.\d*)?|\.\d+)/.test(value.value)) return false
  if (!structuredPeriod(value.period, allowedDates) || (value.fiscalPeriod !== undefined && value.fiscalPeriod !== null && (!structuredString(value.fiscalPeriod) || !FISCAL_PERIOD.test(value.fiscalPeriod)))) return false
  if (value.semanticKey !== undefined && value.semanticKey !== null && !structuredString(value.semanticKey)) return false
  return allowSemanticKey || value.semanticKey === undefined || value.semanticKey === null
}

function structuredValueContract(): Record<string, unknown> {
  return { type: 'object', required: ['metric', 'value', 'unit', 'comparator'], additionalProperties: false, allowedFields: STRUCTURED_FIELDS, metric: { type: 'string', pattern: STRUCTURED_SAFE_STRING.source, minLength: 1, maxLength: MAX_STRUCTURED_STRING }, value: { type: ['string', 'number', 'boolean', 'null'], maxLength: 1_200, finite: true, numericTextForbidden: true }, unit: { type: ['string', 'null'], pattern: STRUCTURED_SAFE_STRING.source, maxLength: MAX_STRUCTURED_STRING }, comparator: { type: ['string', 'null'], enum: ['eq', 'gt', 'gte', 'lt', 'lte', 'approx'] }, period: { type: ['string', 'null'], pattern: STRUCTURED_SAFE_STRING.source, maxLength: MAX_STRUCTURED_STRING, semantic: 'ISO date from the authoritative date allowlist or YYYY-(Q1|H1|Q3|FY)' }, fiscalPeriod: { type: ['string', 'null'], pattern: FISCAL_PERIOD.source, maxLength: MAX_STRUCTURED_STRING }, semanticKey: { type: ['string', 'null'], pattern: STRUCTURED_SAFE_STRING.source, maxLength: MAX_STRUCTURED_STRING } }
}

function sourceReferenceContract(allowed: readonly string[], nonEmpty = false): Record<string, unknown> {
  return { type: 'array', minItems: nonEmpty ? 1 : 0, maxItems: MAX_REFERENCE_ITEMS, uniqueItems: true, items: { type: 'string', enum: allowed, maxLength: 160 } }
}

export function validateEventStructuredValue(value: unknown, expected: EventStructuredValue): value is EventStructuredValue {
  if (!validateStructuredShape(value)) return false
  const actual = value as EventStructuredValue
  const expectedKeys = Object.keys(expected).sort().join(',')
  if (Object.keys(actual).sort().join(',') !== expectedKeys) return false
  return actual.metric === expected.metric && actual.value === expected.value && actual.unit === expected.unit && actual.comparator === expected.comparator && actual.period === expected.period && actual.fiscalPeriod === expected.fiscalPeriod && actual.semanticKey === expected.semanticKey
}

function validatedSourceReferences(value: unknown, allowed: ReadonlySet<string>, label: string, nonEmpty = true): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_ITEMS || (nonEmpty && value.length === 0)) throw new EventResearchSemanticError(`${label} source references are invalid`, [`${label}_refs_invalid`])
  const refs = value.filter((item): item is string => typeof item === 'string')
  if (refs.length !== value.length || new Set(refs).size !== refs.length || refs.some((ref) => !validSourceId(ref) || !allowed.has(ref))) throw new EventResearchSemanticError(`${label} source references are outside the real source set`, [`${label}_refs_invalid`])
  return refs
}

function validateEvidenceForVerification(input: EventEvidenceAssessmentOutput, sources: readonly EventEvidenceSource[]): ReadonlyMap<string, EventEvidenceSource> {
  if (input.sourceAssessments.length > MAX_SOURCE_ASSESSMENTS || input.verifiedFacts.length > MAX_VERIFIED_FACTS || input.contradictions.length > MAX_CONTRADICTIONS) throw new EventResearchSemanticError('Event evidence exceeds its bounded contract', ['verification_evidence_bound_exceeded'])
  const boundedSources = boundedUniqueSources(sources)
  const sourceSet = new Set(boundedSources.map((source) => source.candidateId))
  const sourceMap = new Map(boundedSources.map((source) => [source.candidateId, source]))
  const assessmentIds = new Set<string>()
  for (const [index, assessment] of input.sourceAssessments.entries()) {
    const validated = validateSourceAssessment(assessment, index, sourceSet)
    if (assessmentIds.has(validated.sourceCandidateId)) throw new EventResearchSemanticError('Duplicate source assessments are not allowed', ['source_assessment_duplicate'])
    assessmentIds.add(validated.sourceCandidateId)
  }
  for (const [index, fact] of input.verifiedFacts.entries()) validatedSourceReferences(fact?.sourceCandidateIds, sourceSet, `verified_fact_${index}`)
  for (const [index, contradiction] of input.contradictions.entries()) validatedSourceReferences(contradiction?.sourceCandidateIds, sourceSet, `contradiction_${index}`)
  return sourceMap
}

export function validateEventEvidenceAssessment(value: unknown, input: EventEvidenceAssessmentInput): EventEvidenceAssessmentOutput {
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new EventResearchSemanticError('Event evidence requires real source metadata', ['source_metadata_missing'])
  const object = parseEventReasoningObject(value)
  const allowed = new Set(sourceIds(input))
  if (!keysAreAllowed(object, ['sourceAssessments', 'verifiedFacts', 'contradictions']) || !Array.isArray(object.sourceAssessments) || !Array.isArray(object.verifiedFacts) || !Array.isArray(object.contradictions)) throw new EventResearchSemanticError('Event evidence assessment arrays are required', ['assessment_arrays_missing'])
  if (object.sourceAssessments.length > MAX_SOURCE_ASSESSMENTS) throw new EventResearchSemanticError('Event source assessments exceed the bounded source set', ['source_assessment_count_exceeds_bound'])
  const sourceAssessments = object.sourceAssessments.map((item, index) => validateSourceAssessment(item, index, allowed))
  if (new Set(sourceAssessments.map((item) => item.sourceCandidateId)).size !== sourceAssessments.length) throw new EventResearchSemanticError('Duplicate source assessments are not allowed', ['source_assessment_duplicate'])
  if (object.verifiedFacts.length > MAX_VERIFIED_FACTS) throw new EventResearchSemanticError('Verified event facts exceed the bounded contract', ['verified_fact_count_exceeds_bound'])
  const dates = authoritativeDates(input)
  const facts: EventVerifiedFact[] = object.verifiedFacts.map((value, index) => {
    const item = isRecord(value) ? value : {}
    const refs = exactArray(item.sourceCandidateIds, allowed, true) ? item.sourceCandidateIds : []
    const valid = keysAreAllowed(item, ['factId', 'statement', 'sourceCandidateIds', 'confidence', 'evidenceRequirement', 'structuredValue']) && validLocalId(item.factId) && nonEmptyText(item.statement, 2_000) && exactArray(item.sourceCandidateIds, allowed, true) && typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 && enumValue(item.evidenceRequirement, EVENT_EVIDENCE_REQUIREMENTS) && (item.structuredValue === undefined || validateStructuredShape(item.structuredValue, true, dates))
    if (!valid) throw new EventResearchSemanticError(`Invalid verified event fact ${index}`, [`verified_fact_${index}_invalid`])
    return { factId: item.factId as string, statement: (item.statement as string).trim().slice(0, 2_000), sourceCandidateIds: refs, confidence: item.confidence as number, evidenceRequirement: item.evidenceRequirement as EventEvidenceRequirement, ...(item.structuredValue === undefined ? {} : { structuredValue: item.structuredValue as EventStructuredValue }) }
  })
  if (new Set(facts.map((item) => item.factId)).size !== facts.length) throw new EventResearchSemanticError('Verified event facts exceed the bounded contract', ['verified_fact_count_or_duplicate_invalid'])
  if (object.contradictions.length > MAX_CONTRADICTIONS) throw new EventResearchSemanticError('Event contradictions exceed the bounded contract', ['contradiction_count_exceeds_bound'])
  const contradictions: EventContradiction[] = object.contradictions.map((value, index) => {
    const item = isRecord(value) ? value : {}
    const refs = exactArray(item.sourceCandidateIds, allowed, true) ? item.sourceCandidateIds : []
    const valid = keysAreAllowed(item, ['contradictionId', 'statement', 'sourceCandidateIds', 'rationale']) && (item.contradictionId === undefined || validLocalId(item.contradictionId)) && nonEmptyText(item.statement, 2_000) && exactArray(item.sourceCandidateIds, allowed, true) && (item.rationale === undefined || nonEmptyText(item.rationale, 1_000))
    if (!valid) throw new EventResearchSemanticError(`Invalid event contradiction ${index}`, [`contradiction_${index}_invalid`])
    return { ...(item.contradictionId === undefined ? {} : { contradictionId: item.contradictionId as string }), statement: (item.statement as string).trim().slice(0, 2_000), sourceCandidateIds: refs, ...(item.rationale === undefined ? {} : { rationale: (item.rationale as string).trim().slice(0, 1_000) }) }
  })
  if (contradictions.some((item) => item.contradictionId !== undefined) && new Set(contradictions.flatMap((item) => item.contradictionId === undefined ? [] : [item.contradictionId])).size !== contradictions.filter((item) => item.contradictionId !== undefined).length) throw new EventResearchSemanticError('Duplicate event contradictions are not allowed', ['contradiction_duplicate'])
  return { sourceAssessments, verifiedFacts: facts, contradictions }
}

export function deriveEventVerification(input: EventEvidenceAssessmentOutput, sources: readonly EventEvidenceSource[] = []): EventVerificationResult {
  const sourceMap = validateEvidenceForVerification(input, sources)
  const supporting = uniqueSorted(input.sourceAssessments.filter((item) => item.verdict === 'supports').map((item) => item.sourceCandidateId))
  const contradicting = uniqueSorted([...input.sourceAssessments.filter((item) => item.verdict === 'contradicts').map((item) => item.sourceCandidateId), ...input.contradictions.flatMap((item) => item.sourceCandidateIds)])
  const official = supporting.some((id) => sourceIsOfficial(sourceMap.get(id)))
  let verificationLevel: EventVerificationLevel = 'unverified'
  if (supporting.length > 0 && contradicting.length > 0) verificationLevel = 'conflicted'
  else if (official) verificationLevel = 'official_verified'
  else if (supporting.length >= 2) verificationLevel = 'corroborated'
  else if (supporting.length === 1) verificationLevel = 'single_source'
  return { verificationLevel, strongVerification: verificationLevel === 'official_verified' || verificationLevel === 'corroborated', supportingSourceCandidateIds: supporting, contradictingSourceCandidateIds: contradicting }
}

export const determineEventVerificationLevel = deriveEventVerification
export function validateEventVerificationResult(value: unknown): value is EventVerificationResult {
  if (!isRecord(value) || !keysAreAllowed(value, ['verificationLevel', 'strongVerification', 'supportingSourceCandidateIds', 'contradictingSourceCandidateIds']) || !enumValue(value.verificationLevel, ['official_verified', 'corroborated', 'single_source', 'conflicted', 'unverified'] as const) || typeof value.strongVerification !== 'boolean' || !Array.isArray(value.supportingSourceCandidateIds) || !Array.isArray(value.contradictingSourceCandidateIds)) return false
  const supporting = strings(value.supportingSourceCandidateIds); const contradicting = strings(value.contradictingSourceCandidateIds)
  if (supporting.length !== value.supportingSourceCandidateIds.length || contradicting.length !== value.contradictingSourceCandidateIds.length || new Set(supporting).size !== supporting.length || new Set(contradicting).size !== contradicting.length) return false
  const strong = value.verificationLevel === 'official_verified' || value.verificationLevel === 'corroborated'
  if (value.strongVerification !== strong) return false
  if (value.verificationLevel === 'official_verified' && (supporting.length < 1 || contradicting.length > 0)) return false
  if (value.verificationLevel === 'corroborated' && (supporting.length < 2 || contradicting.length > 0)) return false
  if (value.verificationLevel === 'single_source' && supporting.length !== 1) return false
  if (value.verificationLevel === 'conflicted' && (supporting.length < 1 || contradicting.length < 1)) return false
  if (value.verificationLevel === 'unverified' && (supporting.length !== 0 || contradicting.length !== 0)) return false
  return true
}

export function isStrongEventVerification(level: EventVerificationLevel | EventVerificationResult): boolean { return typeof level === 'string' ? level === 'official_verified' || level === 'corroborated' : validateEventVerificationResult(level) && level.strongVerification }

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]!
}

function dateTokens(value: unknown): readonly string[] {
  return typeof value === 'string' ? [...value.matchAll(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g)].map((match) => match[0]!.slice(0, 10)) : []
}

function authoritativeDates(input: EventEvidenceAssessmentInput | EventResearchSynthesisInput): ReadonlySet<string> {
  const values: unknown[] = [input.anchor.publishedAt, input.anchor.eventDate, input.eventDate]
  if ('asOf' in input) values.push(input.asOf)
  if (input.sources !== undefined) values.push(...input.sources.map((source) => source.publishedAt))
  return new Set(values.flatMap(dateTokens).filter(validIsoDate))
}

function numericTokens(statement: string, allowedTickers: readonly string[] = []): readonly number[] {
  const tickerSet = new Set(allowedTickers)
  const masked = statement.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, (date) => validIsoDate(date.slice(0, 10)) ? ' ' : date)
  return [...masked.matchAll(/[-+]?\d+(?:\.\d+)?/g)].filter((match) => !tickerSet.has(match[0])).map((match) => Number(match[0])).filter((value) => Number.isFinite(value))
}

export function hasUnsupportedNumericClaim(statement: string, allowedValues: readonly number[] = [], allowedTickers: readonly string[] = [], allowedDates?: readonly string[]): boolean {
  if (allowedDates !== undefined) {
    const dates = new Set(allowedDates.filter(validIsoDate))
    if (dateTokens(statement).some((date) => !dates.has(date))) return true
  }
  const allowed = allowedValues.flatMap((value) => [value, value * 100]).filter((value) => Number.isFinite(value))
  return numericTokens(statement, allowedTickers).some((value) => !allowed.some((candidate) => Math.abs(candidate - value) < 1e-9))
}

export const containsUnsupportedNumericClaim = hasUnsupportedNumericClaim

export function eventOccurrenceStructuredValue(eventFingerprint: string, eventDate: string): EventStructuredValue {
  if (!validLocalId(eventFingerprint) || !validIsoDate(eventDate)) throw new TypeError('event fingerprint and valid ISO event date are required')
  const metric = `event_occurrence_${eventFingerprint}`
  if (!structuredString(metric)) throw new TypeError('event fingerprint is too long for a structured event value')
  return { metric, value: true, unit: 'event', comparator: 'eq', period: eventDate }
}

export function buildEventOccurrenceProposal(eventFingerprint: string, eventDate: string, sourceCandidateIds: readonly string[], statement = 'The selected event was verified.'): SemanticProductionProposal {
  if (!Array.isArray(sourceCandidateIds) || sourceCandidateIds.length === 0 || sourceCandidateIds.length > MAX_REFERENCE_ITEMS || new Set(sourceCandidateIds).size !== sourceCandidateIds.length || sourceCandidateIds.some((id) => !validLocalId(id))) throw new TypeError('source candidate ids must be bounded, unique, and safe')
  return { proposalId: `event-occurrence-${eventFingerprint}`, kind: 'claim', claimType: 'fact', subjectKey: 'company', statement: statement.trim().slice(0, 1_500), sourceCandidateIds: [...sourceCandidateIds], structuredValue: eventOccurrenceStructuredValue(eventFingerprint, eventDate) }
}

export function validateEventAssumptionUpdate(value: unknown, existingClaim: EventExistingKnowledgeClaim): value is EventAssumptionUpdate {
  if (!isRecord(value) || !keysAreAllowed(value, ['existingClaimRef', 'structuredValue']) || value.existingClaimRef !== existingClaim.canonicalRef || existingClaim.claimType !== 'assumption' || !isRecord(existingClaim.structuredValue) || !validateStructuredShape(value.structuredValue)) return false
  const current = existingClaim.structuredValue as unknown as EventStructuredValue
  const next = value.structuredValue as EventStructuredValue
  const currentType = current.value === null ? 'null' : typeof current.value
  const nextType = next.value === null ? 'null' : typeof next.value
  return currentType === nextType && next.metric === current.metric && next.unit === current.unit && next.comparator === current.comparator && next.period === current.period && next.fiscalPeriod === current.fiscalPeriod && next.semanticKey === current.semanticKey
}

export const isValidEventAssumptionUpdate = validateEventAssumptionUpdate

function durableImpactType(impactType: EventImpactAssessment['impactType']): boolean { return impactType !== 'no_change' && impactType !== 'research_gap' }
function compatibleImpactType(claimType: EventDurableClaimType, impactType: EventImpactAssessment['impactType']): boolean {
  if (claimType === 'assumption') return impactType === 'assumption'
  if (claimType === 'risk') return impactType === 'risk' || impactType === 'direct' || impactType === 'second_order'
  if (claimType === 'catalyst') return impactType === 'catalyst' || impactType === 'direct' || impactType === 'second_order'
  return impactType === 'direct' || impactType === 'second_order' || impactType === 'thesis'
}

function allowedSupportingSources(input: EventResearchSynthesisInput): ReadonlySet<string> { return new Set(input.verification.supportingSourceCandidateIds) }
function validatedCompanyTicker(input: EventResearchSynthesisInput): readonly string[] { return /^\d{6}$/.test(input.company.symbol) ? [input.company.symbol] : [] }

function validateAssessment(value: unknown, index: number, input: EventResearchSynthesisInput, sourceSet: ReadonlySet<string>, claimSet: ReadonlySet<string>): EventImpactAssessment {
  const item = isRecord(value) ? value : {}
  const sources = strings(item.sourceCandidateIds)
  const claims = strings(item.existingKnowledgeRefs)
  const impactType = item.impactType
  const basis = item.basis
  const direction = item.direction
  const materiality = item.materiality
  const timeHorizon = item.timeHorizon
  const causalChain = item.causalChain
  const diagnostic = (field: string) => `impact_assessment_${index}_${field}`
  if (!validLocalId(item.assessmentId)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('id_invalid')])
  if (!enumValue(impactType, ['direct', 'second_order', 'assumption', 'thesis', 'catalyst', 'risk', 'no_change', 'research_gap'] as const)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('impact_type_invalid')])
  if (!enumValue(basis, ['verified_fact', 'inference', 'hypothesis'] as const)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('basis_invalid')])
  if (!enumValue(direction, ['positive', 'negative', 'mixed', 'unclear'] as const)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('direction_invalid')])
  if (!enumValue(materiality, ['low', 'medium', 'high'] as const)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('materiality_invalid')])
  if (!enumValue(timeHorizon, ['immediate', 'near_term', 'medium_term', 'long_term'] as const)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('time_horizon_invalid')])
  if (!exactArray(item.sourceCandidateIds, sourceSet)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('source_refs_invalid')])
  if (!exactArray(item.existingKnowledgeRefs, claimSet)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('existing_refs_invalid')])
  if (!nonEmptyText(item.rationale, 1_000)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('rationale_invalid')])
  if (!nonEmptyText(causalChain, 1_500)) throw new EventResearchSemanticError(`Invalid event impact assessment ${index}`, [diagnostic('causal_chain_invalid')])
  if (impactType === 'second_order' && basis === 'hypothesis') throw new EventResearchSemanticError(`Second-order impact requires evidence ${index}`, [diagnostic('second_order_basis_invalid')])
  if (basis !== 'hypothesis' && durableImpactType(impactType) && (sources.length === 0 || !sources.every((id) => allowedSupportingSources(input).has(id)))) throw new EventResearchSemanticError(`Durable event impact lacks supporting evidence ${index}`, [diagnostic('evidence_required')])
  const referencedClaims = claims.map((ref) => input.existingKnowledge.find((claim) => claim.canonicalRef === ref)).filter((claim): claim is EventExistingKnowledgeClaim => claim !== undefined)
  if (impactType === 'assumption' && (referencedClaims.length !== 1 || referencedClaims[0]?.claimType !== 'assumption')) throw new EventResearchSemanticError(`Assumption impact requires one exact assumption Claim ${index}`, [`impact_assessment_${index}_assumption_ref_required`])
  if (impactType === 'thesis' && (referencedClaims.length !== 1 || referencedClaims[0]?.claimType !== 'thesis')) throw new EventResearchSemanticError(`Thesis impact requires one exact thesis Claim ${index}`, [`impact_assessment_${index}_thesis_ref_required`])
  return { assessmentId: item.assessmentId as string, impactType, basis, direction, materiality, timeHorizon, existingKnowledgeRefs: claims, sourceCandidateIds: sources, rationale: (item.rationale as string).trim().slice(0, 1_000), causalChain: (causalChain as string).trim().slice(0, 1_500) }
}

function proposalDiagnostics(index: number, code: string): never { throw new EventResearchSemanticError(`Invalid event research proposal ${index}`, [`proposal_${index}_${code}`]) }

export function validateEventResearchProposal(value: unknown, index: number, input: EventResearchSynthesisInput, assessments: readonly EventImpactAssessment[]): EventResearchProposal {
  const item = isRecord(value) ? value : {}
  const sources = strings(item.sourceCandidateIds)
  const claims = strings(item.existingKnowledgeRefs)
  const assessmentRefs = strings(item.assessmentRefs)
  const sourceSet = new Set(sourceIds(input))
  const claimSet = new Set(claimIds(input))
  const assessmentMap = new Map(assessments.map((assessment) => [assessment.assessmentId, assessment]))
  const claimType = item.claimType
  const baseValid = keysAreAllowed(item, PROPOSAL_FIELDS) && validLocalId(item.proposalId) && item.kind === 'claim' && item.subjectKey === 'company' && enumValue(claimType, EVENT_DURABLE_CLAIM_TYPES) && nonEmptyText(item.statement, 1_500) && exactArray(item.sourceCandidateIds, sourceSet, true) && exactArray(item.existingKnowledgeRefs, claimSet) && Array.isArray(item.assessmentRefs) && assessmentRefs.length > 0 && assessmentRefs.length === item.assessmentRefs.length && assessmentRefs.every((ref) => assessmentMap.has(ref))
  if (!baseValid) proposalDiagnostics(index, 'shape_or_allowlist')
  if (input.verification.strongVerification !== true) proposalDiagnostics(index, 'verification_not_strong')
  if (!sources.every((id) => allowedSupportingSources(input).has(id))) proposalDiagnostics(index, 'source_not_supporting')
  if (new Set(assessmentRefs).size !== assessmentRefs.length) proposalDiagnostics(index, 'assessment_refs_duplicate')
  const referencedAssessments = assessmentRefs.map((ref) => assessmentMap.get(ref)!).filter(Boolean)
  if (!referencedAssessments.some((assessment) => durableImpactType(assessment.impactType) && assessment.basis !== 'hypothesis')) proposalDiagnostics(index, 'non_hypothesis_assessment_required')
  const referencedSourceIds = new Set(referencedAssessments.flatMap((assessment) => assessment.sourceCandidateIds))
  if (!sources.every((sourceId) => referencedSourceIds.has(sourceId))) proposalDiagnostics(index, 'source_not_referenced_by_assessment')
  if (!referencedAssessments.every((assessment) => compatibleImpactType(claimType as EventDurableClaimType, assessment.impactType))) proposalDiagnostics(index, 'impact_type_incompatible')
  if (claimType === 'assumption') {
  if (claims.length !== 1) proposalDiagnostics(index, 'assumption_ref_count')
    const existing = claimByRef(input, claims[0]!)
    const dates = authoritativeDates(input)
    if (existing === undefined || !isRecord(existing.structuredValue)) proposalDiagnostics(index, 'assumption_update_invalid')
    const current = existing!.structuredValue as EventStructuredValue
    const nextStructuredValue = item.structuredValue === undefined
      ? (Object.prototype.hasOwnProperty.call(item, 'newValue') && (item.newValue === null || ['string', 'number', 'boolean'].includes(typeof item.newValue)) ? { ...current, value: item.newValue } : undefined)
      : item.structuredValue
    if (nextStructuredValue === undefined || !validateStructuredShape(nextStructuredValue, true, dates)) proposalDiagnostics(index, 'structured_value_invalid')
    if (!validateEventAssumptionUpdate({ existingClaimRef: claims[0], structuredValue: nextStructuredValue }, existing!)) proposalDiagnostics(index, 'assumption_update_invalid')
    const nextValue = nextStructuredValue as EventStructuredValue
    if (hasUnsupportedNumericClaim(item.statement as string, typeof nextValue.value === 'number' ? [nextValue.value] : [], validatedCompanyTicker(input), [...dates])) proposalDiagnostics(index, 'unsupported_numeric_claim')
  } else {
    if (item.structuredValue !== undefined) proposalDiagnostics(index, 'unsupported_structured_value')
    if (hasUnsupportedNumericClaim(item.statement as string, [], validatedCompanyTicker(input), [...authoritativeDates(input)])) proposalDiagnostics(index, 'unsupported_numeric_claim')
  }
  return { proposalId: item.proposalId as string, kind: 'claim', claimType: claimType as EventDurableClaimType, subjectKey: 'company', statement: (item.statement as string).trim(), sourceCandidateIds: sources, existingKnowledgeRefs: claims, assessmentRefs, ...(claimType === 'assumption' ? { structuredValue: (item.structuredValue ?? { ...(claimByRef(input, claims[0]!)!.structuredValue as EventStructuredValue), value: item.newValue }) as EventStructuredValue } : {}) }
}

export interface EventResearchProposalFilterResult { readonly accepted: readonly EventResearchProposal[]; readonly diagnostics: readonly string[] }
export function filterEventResearchProposalsWithDiagnostics(values: readonly unknown[], input: EventResearchSynthesisInput, assessments: readonly EventImpactAssessment[]): EventResearchProposalFilterResult {
  const accepted: EventResearchProposal[] = []
  const diagnostics: string[] = []
  const types = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (accepted.length >= MAX_PROPOSALS) break
    try {
      const proposal = validateEventResearchProposal(value, index, input, assessments)
      if (types.has(proposal.claimType)) continue
      types.add(proposal.claimType)
      accepted.push(proposal)
    } catch (error) {
      const diagnostic = error instanceof EventResearchSemanticError ? error.diagnostics[0] : undefined
      diagnostics.push((diagnostic ?? `proposal_${index}_rejected`).slice(0, 160))
    }
  }
  return { accepted, diagnostics: diagnostics.slice(0, 24) }
}
export function filterEventResearchProposals(values: readonly unknown[], input: EventResearchSynthesisInput, assessments: readonly EventImpactAssessment[]): readonly EventResearchProposal[] { return filterEventResearchProposalsWithDiagnostics(values, input, assessments).accepted }

function synthesisInstruction(repair: boolean, diagnostics: readonly string[]): string {
  const prefix = repair ? `Bounded repair attempt 1. Correct every deterministic diagnostic: ${diagnostics.join(', ') || 'output_contract_invalid'}. Return a complete replacement object.` : 'Return one complete synthesis object.'
  return `${prefix} Use only verified event facts, supplied evidence, and bounded Company Knowledge. Return exactly interpretations, assessments, and proposals (proposal candidates). If no durable Knowledge update is clearly justified, return proposals: []. interpretations may only use sectionId values: ${EVENT_RESEARCH_SECTIONS.slice(5).map((title) => eventResearchSectionId(title)).join(', ')}; each contains interpretationId, sectionId, markdown, sourceCandidateIds, existingKnowledgeRefs, and assessmentRefs. Do not generate the final 16-section report. Impact assessments must explicitly include impactType, basis, direction, materiality, timeHorizon, causalChain, rationale, exact existingKnowledgeRefs and sourceCandidateIds; never omit a semantic field and never use legacy disposition. impactType values: direct, second_order, assumption, thesis, catalyst, risk, no_change, research_gap. basis values: verified_fact, inference, hypothesis. direction values: positive, negative, mixed, unclear. materiality values: low, medium, high. timeHorizon values: immediate, near_term, medium_term, long_term. Proposals are optional local claim candidates only, with claimType viewpoint, risk, catalyst, or assumption. Copy all IDs exactly from supplied allowlists. Thesis impact is report-level and must not be a thesis proposal. Do not invent dates, canonical refs, calculations, or numeric claims. An assumption candidate may provide only its new value; code owns the authoritative assumption slot. Example shape: { interpretations: [{ interpretationId: 'interpretation-1', sectionId: 'first-order-impact', markdown: 'bounded interpretation', sourceCandidateIds: ['source-1'], existingKnowledgeRefs: ['claim-1'], assessmentRefs: ['assessment-1'] }], assessments: [{ assessmentId: 'assessment-1', impactType: 'direct', basis: 'verified_fact', direction: 'positive', materiality: 'medium', timeHorizon: 'near_term', existingKnowledgeRefs: [], sourceCandidateIds: ['source-1'], rationale: 'bounded rationale', causalChain: 'event -> direct effect' }, { assessmentId: 'assessment-2', impactType: 'second_order', basis: 'inference', direction: 'unclear', materiality: 'low', timeHorizon: 'medium_term', existingKnowledgeRefs: [], sourceCandidateIds: ['source-1'], rationale: 'bounded rationale', causalChain: 'event -> direct effect -> second-order effect' }], proposals: [] }. Return JSON only.`
}

function synthesisModelInput(input: EventResearchSynthesisInput, repair?: { readonly prior: unknown; readonly diagnostics: readonly string[] }): Record<string, unknown> {
  const claims = claimIds(input)
  const assumptions = uniqueSorted(input.existingKnowledge.filter((claim) => claim.claimType === 'assumption' && claims.includes(claim.canonicalRef)).map((claim) => claim.canonicalRef))
  const theses = uniqueSorted(input.existingKnowledge.filter((claim) => claim.claimType === 'thesis' && claims.includes(claim.canonicalRef)).map((claim) => claim.canonicalRef))
  const verification = deriveEventVerification(input.evidence, input.sources ?? [])
  const value: Record<string, unknown> = { company: modelCompany(input.company), anchor: modelAnchor(input.anchor), eventFingerprint: input.eventFingerprint.slice(0, 160), eventDate: input.eventDate?.slice(0, 32), verification: modelVerification(verification), verifiedFacts: input.evidence.verifiedFacts.slice(0, MAX_VERIFIED_FACTS).map(modelFact), sourceAssessments: input.evidence.sourceAssessments.slice(0, MAX_SOURCE_ASSESSMENTS).map(modelSourceAssessment), contradictions: input.evidence.contradictions.slice(0, MAX_CONTRADICTIONS).map(modelContradiction), supportingSourceExcerpts: selectedExcerpts(input, verification.supportingSourceCandidateIds, input.supportingSourceExcerpts), contradictingSourceExcerpts: selectedExcerpts(input, verification.contradictingSourceCandidateIds, input.contradictingSourceExcerpts), allowedSourceCandidateIds: sourceIds(input), allowedSupportingSourceCandidateIds: verification.supportingSourceCandidateIds, allowedContradictingSourceCandidateIds: verification.contradictingSourceCandidateIds, allowedExistingClaimRefs: claims, allowedAssumptionClaimRefs: assumptions, allowedThesisClaimRefs: theses, existingKnowledge: input.existingKnowledge.slice(0, MAX_EXISTING_CLAIMS).map(modelClaim), methodology: 'Code owns verification, event dates, canonical identity, numeric equality, proposal admissibility, and persistence authority.' }
  if (repair !== undefined) value.repair = repairInput(repair.prior, repair.diagnostics)
  return value
}

function synthesisContract(input: EventResearchSynthesisInput): Record<string, unknown> {
  const verification = deriveEventVerification(input.evidence, input.sources ?? [])
  const claims = claimIds(input)
  const allowedSources = sourceIds(input)
  const assessmentRefs = { type: 'array', maxItems: MAX_REFERENCE_ITEMS, uniqueItems: true, items: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 } }
  const claimRefs = sourceReferenceContract(claims)
  const assessment = { type: 'object', required: ['assessmentId', 'impactType', 'basis', 'direction', 'materiality', 'timeHorizon', 'existingKnowledgeRefs', 'sourceCandidateIds', 'rationale', 'causalChain'], additionalProperties: false, assessmentId: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 }, impactType: { type: 'string', enum: ['direct', 'second_order', 'assumption', 'thesis', 'catalyst', 'risk', 'no_change', 'research_gap'] }, basis: { type: 'string', enum: ['verified_fact', 'inference', 'hypothesis'] }, direction: { type: 'string', enum: ['positive', 'negative', 'mixed', 'unclear'] }, materiality: { type: 'string', enum: ['low', 'medium', 'high'] }, timeHorizon: { type: 'string', enum: ['immediate', 'near_term', 'medium_term', 'long_term'] }, existingKnowledgeRefs: claimRefs, sourceCandidateIds: sourceReferenceContract(allowedSources), rationale: { type: 'string', minLength: 1, maxLength: 1_000 }, causalChain: { type: 'string', minLength: 1, maxLength: 1_500 } }
  const proposal = { type: 'object', required: ['proposalId', 'kind', 'claimType', 'subjectKey', 'statement', 'sourceCandidateIds', 'existingKnowledgeRefs', 'assessmentRefs'], additionalProperties: false, proposalId: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 }, kind: { type: 'string', enum: ['claim'] }, claimType: { type: 'string', enum: EVENT_DURABLE_CLAIM_TYPES }, subjectKey: { type: 'string', enum: ['company'] }, statement: { type: 'string', minLength: 1, maxLength: 1_500 }, sourceCandidateIds: sourceReferenceContract(verification.supportingSourceCandidateIds, true), existingKnowledgeRefs: claimRefs, assessmentRefs, structuredValue: structuredValueContract(), newValue: { type: ['string', 'number', 'boolean', 'null'] } }
  const interpretation = { type: 'object', required: ['interpretationId', 'sectionId', 'markdown', 'sourceCandidateIds', 'existingKnowledgeRefs', 'assessmentRefs'], additionalProperties: false, interpretationId: { type: 'string', pattern: LOCAL_ID.source, maxLength: 96 }, sectionId: { type: 'string', enum: EVENT_RESEARCH_SECTIONS.slice(5).map((title) => eventResearchSectionId(title)) }, markdown: { type: 'string', minLength: 1, maxLength: 2_000 }, sourceCandidateIds: sourceReferenceContract(allowedSources), existingKnowledgeRefs: claimRefs, assessmentRefs }
  return { type: 'object', required: ['interpretations', 'assessments', 'proposals'], additionalProperties: false, allowedSourceCandidateIds: allowedSources, allowedSupportingSourceCandidateIds: verification.supportingSourceCandidateIds, allowedContradictingSourceCandidateIds: verification.contradictingSourceCandidateIds, allowedExistingClaimRefs: claims, allowedAssumptionClaimRefs: input.existingKnowledge.slice(0, MAX_EXISTING_CLAIMS).filter((claim) => claim.claimType === 'assumption' && claims.includes(claim.canonicalRef)).map((claim) => claim.canonicalRef), allowedThesisClaimRefs: input.existingKnowledge.slice(0, MAX_EXISTING_CLAIMS).filter((claim) => claim.claimType === 'thesis' && claims.includes(claim.canonicalRef)).map((claim) => claim.canonicalRef), allowedImpactTypes: ['direct', 'second_order', 'assumption', 'thesis', 'catalyst', 'risk', 'no_change', 'research_gap'], allowedBasisValues: ['verified_fact', 'inference', 'hypothesis'], allowedDirections: ['positive', 'negative', 'mixed', 'unclear'], allowedMaterialityValues: ['low', 'medium', 'high'], allowedTimeHorizons: ['immediate', 'near_term', 'medium_term', 'long_term'], allowedInterpretationSectionIds: EVENT_RESEARCH_SECTIONS.slice(5).map((title) => eventResearchSectionId(title)), interpretations: { type: 'array', maxItems: 12, item: interpretation }, assessments: { type: 'array', maxItems: MAX_IMPACT_ASSESSMENTS, item: assessment }, proposals: { type: 'array', maxItems: MAX_PROPOSALS, item: proposal } }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]) }
function deterministicSynthesisVerification(input: EventResearchSynthesisInput): EventVerificationResult {
  if (input.sources === undefined || input.sources.length === 0) throw new EventResearchSemanticError('Event synthesis requires real source metadata', ['source_metadata_missing'])
  if (input.evidence.sourceAssessments.length > MAX_SOURCE_ASSESSMENTS || input.evidence.verifiedFacts.length > MAX_VERIFIED_FACTS || input.evidence.contradictions.length > MAX_CONTRADICTIONS) throw new EventResearchSemanticError('Stage A evidence exceeds the bounded synthesis input', ['verification_evidence_bound_exceeded'])
  const sourceSet = new Set(sourceIds(input))
  const evidenceRefArrays = [...input.evidence.verifiedFacts.map((item) => item.sourceCandidateIds), ...input.evidence.contradictions.map((item) => item.sourceCandidateIds)]
  if (evidenceRefArrays.some((value) => !Array.isArray(value) || value.length > MAX_REFERENCE_ITEMS)) throw new EventResearchSemanticError('Stage A evidence reference arrays exceed the bounded synthesis input', ['verification_evidence_refs_bound_exceeded'])
  const refs = [...input.evidence.sourceAssessments.map((item) => item.sourceCandidateId), ...input.evidence.verifiedFacts.flatMap((item) => strings(item.sourceCandidateIds)), ...input.evidence.contradictions.flatMap((item) => strings(item.sourceCandidateIds))]
  if (refs.some((ref) => !sourceSet.has(ref))) throw new EventResearchSemanticError('Stage A evidence references are outside supplied sources', ['verification_evidence_refs_invalid'])
  const derived = deriveEventVerification(input.evidence, input.sources ?? [])
  if (!validateEventVerificationResult(input.verification) || input.verification.verificationLevel !== derived.verificationLevel || input.verification.strongVerification !== derived.strongVerification || !sameStringSet(input.verification.supportingSourceCandidateIds, derived.supportingSourceCandidateIds) || !sameStringSet(input.verification.contradictingSourceCandidateIds, derived.contradictingSourceCandidateIds)) throw new EventResearchSemanticError('Caller verification does not match Stage A evidence', ['verification_derived_mismatch'])
  return derived
}

export function validateEventResearchSynthesis(value: unknown, input: EventResearchSynthesisInput): EventResearchSynthesisOutput {
  const object = parseEventReasoningObject(value)
  if (!keysAreAllowed(object, ['interpretations', 'assessments', 'proposals']) || !Array.isArray(object.interpretations) || !Array.isArray(object.assessments) || !Array.isArray(object.proposals)) throw new EventResearchSemanticError('Event research synthesis arrays are required', ['synthesis_arrays_missing'])
  if (object.interpretations.length > 12) throw new EventResearchSemanticError('Event interpretations exceed the bounded contract', ['interpretation_count_exceeds_bound'])
  if (object.assessments.length > MAX_IMPACT_ASSESSMENTS) throw new EventResearchSemanticError('Event impact assessments exceed the bounded contract', ['impact_assessment_count_exceeds_bound'])
  if (object.proposals.length > MAX_PROPOSALS) throw new EventResearchSemanticError('Too many event research proposals', ['proposal_count_exceeds_bound'])
  if (input.evidence.sourceAssessments.length > MAX_SOURCE_ASSESSMENTS) throw new EventResearchSemanticError('Stage A source assessments exceed the bounded source set', ['verification_source_count_exceeds_bound'])
  const sourceSet = new Set(sourceIds(input))
  const claimSet = new Set(claimIds(input))
  const derivedVerification = deterministicSynthesisVerification(input)
  if (derivedVerification.supportingSourceCandidateIds.some((id) => !sourceSet.has(id)) || derivedVerification.contradictingSourceCandidateIds.some((id) => !sourceSet.has(id))) throw new EventResearchSemanticError('Event verification references are outside the evidence set', ['verification_refs_invalid'])
  validateSourceExcerpts(derivedVerification.supportingSourceCandidateIds, input.supportingSourceExcerpts, 'supporting', sourceSet)
  validateSourceExcerpts(derivedVerification.contradictingSourceCandidateIds, input.contradictingSourceExcerpts, 'contradicting', sourceSet)
  const allowedInterpretationIds = new Set(EVENT_RESEARCH_SECTIONS.slice(5).map((title) => eventResearchSectionId(title)))
  const seenInterpretationIds = new Set<string>()
  const interpretations: EventInterpretation[] = object.interpretations.map((value, index) => {
    const item = isRecord(value) ? value : {}
    const refs = strings(item.sourceCandidateIds); const claims = strings(item.existingKnowledgeRefs); const assessmentRefs = strings(item.assessmentRefs)
    if (!validLocalId(item.interpretationId)) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_id_invalid`])
    if (typeof item.sectionId !== 'string' || !allowedInterpretationIds.has(item.sectionId) || seenInterpretationIds.has(item.sectionId)) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_section_invalid`])
    if (!nonEmptyText(item.markdown, 2_000)) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_markdown_invalid`])
    if (!exactArray(item.sourceCandidateIds, sourceSet)) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_source_refs_invalid`])
    if (!exactArray(item.existingKnowledgeRefs, claimSet)) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_claim_refs_invalid`])
    if (!Array.isArray(item.assessmentRefs) || assessmentRefs.length !== item.assessmentRefs.length || new Set(assessmentRefs).size !== assessmentRefs.length) throw new EventResearchSemanticError(`Invalid event interpretation ${index}`, [`interpretation_${index}_assessment_refs_invalid`])
    seenInterpretationIds.add(item.sectionId)
    return { interpretationId: item.interpretationId as string, sectionId: item.sectionId, markdown: (item.markdown as string).trim().slice(0, 2_000), sourceCandidateIds: refs, existingKnowledgeRefs: claims, assessmentRefs }
  })
  const assessments = object.assessments.slice(0, MAX_IMPACT_ASSESSMENTS).map((item, index) => validateAssessment(item, index, input, sourceSet, claimSet))
  if (new Set(assessments.map((item) => item.assessmentId)).size !== assessments.length) throw new EventResearchSemanticError('Duplicate event impact assessment IDs are not allowed', ['impact_assessment_duplicate'])
  const assessmentSet = new Set(assessments.map((assessment) => assessment.assessmentId))
  if (interpretations.some((interpretation) => interpretation.assessmentRefs.some((ref) => !assessmentSet.has(ref)))) throw new EventResearchSemanticError('Interpretation assessment references must resolve to local assessments', ['interpretation_assessment_ref_invalid'])
  return { interpretations, assessments, proposalCandidates: object.proposals }
}

export function toEventResearchGatewayProposal(proposal: EventResearchProposal): EventResearchGatewayProposal {
  return { proposalId: proposal.proposalId as string, kind: 'claim', claimType: proposal.claimType, subjectKey: 'company', statement: proposal.statement, sourceCandidateIds: [...proposal.sourceCandidateIds], ...(proposal.structuredValue === undefined ? {} : { structuredValue: proposal.structuredValue }) }
}

export class EventEvidenceAssessmentSkill {
  constructor(private readonly executor?: ReasoningExecutor) {}

  fallback(repairAttempts = 0, diagnostics: readonly string[] = []): EventEvidenceAssessmentSkillResult {
    const output: EventEvidenceAssessmentOutput = { sourceAssessments: [], verifiedFacts: [], contradictions: [] }
    return { output, verification: deriveEventVerification(output), reasoning: telemetry(this.executor, 'event_evidence_assessment', { validated: false, applied: false, fallbackUsed: true, repairAttempts, ...(diagnostics.length === 0 ? {} : { diagnostic: diagnostics.join('; ').slice(0, 300), diagnostics }) }) }
  }

  async assess(input: EventEvidenceAssessmentInput): Promise<EventEvidenceAssessmentSkillResult> {
    if (this.executor === undefined) return this.fallback()
    if (!Array.isArray(input.sources) || input.sources.length === 0) return this.fallback(0, ['source_metadata_missing'])
    let repairAttempts = 0; let prior: unknown = null; let diagnostics: readonly string[] = []
    const execute = (repair?: { readonly prior: unknown; readonly diagnostics: readonly string[] }) => this.executor!.execute({ operation: 'event_evidence_assessment', instruction: assessmentInstruction(repair !== undefined, repair === undefined ? [] : repair.diagnostics), input: assessmentModelInput(input, repair), outputContract: assessmentContract(input), metadata: { operationFamily: 'personal-research-v1', companySymbol: input.company.symbol.slice(0, 32) } } satisfies ReasoningRequest)
    try {
      try {
      const result = await execute(); prior = parseEventReasoningObject(result.output)
        const output = validateEventEvidenceAssessment(prior, input)
        return { output, verification: deriveEventVerification(output, input.sources), reasoning: telemetry(this.executor, 'event_evidence_assessment', { validated: true, applied: true, fallbackUsed: false, repairAttempts }) }
      } catch (error) { diagnostics = safeDiagnostics(error) }
      repairAttempts = 1
      const result = await execute({ prior, diagnostics }); const output = validateEventEvidenceAssessment(parseEventReasoningObject(result.output), input)
      return { output, verification: deriveEventVerification(output, input.sources), reasoning: telemetry(this.executor, 'event_evidence_assessment', { validated: true, applied: true, fallbackUsed: false, repairAttempts }) }
    } catch (error) {
      const finalDiagnostics = [...diagnostics, ...safeDiagnostics(error)].slice(0, 24)
      return this.fallback(repairAttempts, finalDiagnostics)
    }
  }
}

export class EventResearchSynthesisSkill {
  constructor(private readonly executor?: ReasoningExecutor) {}

  fallback(repairAttempts = 0, diagnostics: readonly string[] = []): EventResearchSynthesisSkillResult {
    const output: EventResearchSynthesisOutput = { interpretations: [], assessments: [], proposalCandidates: [] }
    return { output, reasoning: telemetry(this.executor, 'event_research_synthesis', { validated: false, applied: false, fallbackUsed: true, repairAttempts, ...(diagnostics.length === 0 ? {} : { diagnostic: diagnostics.join('; ').slice(0, 300), diagnostics }) }) }
  }

  async synthesize(input: EventResearchSynthesisInput): Promise<EventResearchSynthesisSkillResult> {
    if (this.executor === undefined) return this.fallback()
    try {
      const sourceSet = new Set(sourceIds(input)); const verification = deterministicSynthesisVerification(input)
      validateSourceExcerpts(verification.supportingSourceCandidateIds, input.supportingSourceExcerpts, 'supporting', sourceSet)
      validateSourceExcerpts(verification.contradictingSourceCandidateIds, input.contradictingSourceExcerpts, 'contradicting', sourceSet)
    } catch (error) {
      return this.fallback(0, safeDiagnostics(error))
    }
    let repairAttempts = 0; let prior: unknown = null; let diagnostics: readonly string[] = []; let firstAttemptShape: EventReasoningShape | undefined; let repairAttemptShape: EventReasoningShape | undefined
    const execute = (repair?: { readonly prior: unknown; readonly diagnostics: readonly string[] }) => this.executor!.execute({ operation: 'event_research_synthesis', instruction: synthesisInstruction(repair !== undefined, repair === undefined ? [] : repair.diagnostics), input: synthesisModelInput(input, repair), outputContract: synthesisContract(input), metadata: { operationFamily: 'personal-research-v1', companySymbol: input.company.symbol.slice(0, 32), eventFingerprint: input.eventFingerprint.slice(0, 160) } } satisfies ReasoningRequest)
    try {
      try { const result = await execute(); prior = parseEventReasoningObject(result.output); firstAttemptShape = reasoningShape(prior); return { output: validateEventResearchSynthesis(prior, input), reasoning: telemetry(this.executor, 'event_research_synthesis', { validated: true, applied: true, fallbackUsed: false, repairAttempts, firstAttemptShape }) } } catch (error) { diagnostics = safeDiagnostics(error) }
      repairAttempts = 1
      const result = await execute({ prior, diagnostics }); const repaired = parseEventReasoningObject(result.output); repairAttemptShape = reasoningShape(repaired); return { output: validateEventResearchSynthesis(repaired, input), reasoning: telemetry(this.executor, 'event_research_synthesis', { validated: true, applied: true, fallbackUsed: false, repairAttempts, ...(firstAttemptShape === undefined ? {} : { firstAttemptShape }), repairAttemptShape }) }
    } catch (error) {
      const fallback = this.fallback(repairAttempts, [...diagnostics, ...safeDiagnostics(error)].slice(0, 24)); return { ...fallback, reasoning: telemetry(this.executor, 'event_research_synthesis', { ...fallback.reasoning, ...(firstAttemptShape === undefined ? {} : { firstAttemptShape }), ...(repairAttemptShape === undefined ? {} : { repairAttemptShape }) }) }
    }
  }
}

export function eventResearchSectionId(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
