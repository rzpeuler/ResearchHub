import { readRaw, verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { hashKillCriterionDefinitionV04 } from '../../knowledge/schema/kill-criterion-v04.ts'
import { getMetricDefinitionV04 } from '../../knowledge/schema/metric-registry.ts'
import type { KillCriterionV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeObservationV04, KnowledgeReasoningEdgeV04, KnowledgeSourceV04, KnowledgeThesisV04, NumericThresholdDefinitionV1 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04 } from '../../knowledge/storage/v04-types.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'

export interface KillCriterionEvidenceBindingV1 {
  readonly evidenceRef: string
  readonly targetClaimRefs: readonly string[]
  readonly sourceRef: string
  readonly rawRef: string
  /** Must equal the evidence asset's provenance locator and use quote:<base64url UTF-8 exact quote>. */
  readonly locator: string
}

export interface ThesisKillCriterionEvaluatorInput {
  readonly assets: KnowledgeAssetCollectionV04
  readonly handle: KnowledgeBaseHandle
  readonly thesisRef: string
  readonly conditionId: string
  readonly asOf: string
  readonly evidenceBindings: readonly KillCriterionEvidenceBindingV1[]
}

export interface KillCriterionEvaluatedValueV1 {
  readonly evidenceRef: string
  readonly value: number
  readonly metricRef: string
  readonly unit: string
  readonly period: string
  readonly sourceRef: string
  readonly rawRef: string
  readonly locator: string
  readonly publishedAt: string
  readonly targetClaimRefs: readonly string[]
  readonly numericValueVersionVerified: true
}

export interface ThesisKillCriterionEvaluatorResult {
  readonly status: 'met' | 'not_met' | 'insufficient_evidence'
  readonly conditionId: string
  readonly revision?: number
  readonly definitionHash?: string
  readonly asOf: string
  readonly evaluatedValue?: KillCriterionEvaluatedValueV1
  readonly diagnostics: readonly string[]
}

const MAX_BINDINGS = 80
const MAX_DIAGNOSTICS = 12
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value) && !Number.isNaN(Date.parse(value))
const active = (value: KnowledgeAssetV04): boolean => 'lifecycle' in value && value.lifecycle?.status === 'active'
const boundedDiagnostics = (items: readonly string[]): string[] => [...new Set(items)].slice(0, MAX_DIAGNOSTICS)

function result(input: ThesisKillCriterionEvaluatorInput, status: ThesisKillCriterionEvaluatorResult['status'], diagnostics: readonly string[], criterion?: KillCriterionV04, evaluatedValue?: KillCriterionEvaluatedValueV1): ThesisKillCriterionEvaluatorResult {
  return {
    status,
    conditionId: criterion?.conditionId ?? input.conditionId,
    ...(criterion ? { revision: criterion.revision, definitionHash: criterion.definitionHash } : {}),
    asOf: input.asOf,
    ...(evaluatedValue ? { evaluatedValue } : {}),
    diagnostics: boundedDiagnostics(diagnostics),
  }
}

function sourceEligible(source: KnowledgeSourceV04, asOf: string): boolean {
  const cutoff = Date.parse(asOf)
  const lifecycle = source.lifecycle as unknown as { validFrom?: unknown; validUntil?: unknown } | undefined
  const before = (value: unknown): boolean => value === undefined || value === null || (validTime(value) && Date.parse(value) <= cutoff)
  const after = (value: unknown): boolean => value === undefined || value === null || (validTime(value) && Date.parse(value) >= cutoff)
  return active(source)
    && before(lifecycle?.validFrom) && after(lifecycle?.validUntil) && after(source.rights?.expiresAt)
    && source.rights?.accessScope !== 'unknown' && source.rights?.accessScope !== 'restricted'
    && source.rights?.retentionAllowed === true && source.rights?.aiProcessingAllowed === true && source.rights?.derivativeKnowledgeAllowed === true
    && source.usagePolicy?.retainRaw === true && source.usagePolicy?.allowAiProcessing === true && source.usagePolicy?.allowDerivedKnowledge === true
    && source.sourceType === 'official_disclosure' && source.acquisition?.method === 'official'
}

function numericFields(asset: KnowledgeClaimV04 | KnowledgeObservationV04): { metricRef?: string; unit?: string; period?: string; value?: number } {
  if (asset.id.startsWith('observation:')) {
    const observation = asset as KnowledgeObservationV04
    if (observation.observationType !== 'metric') return {}
    return { metricRef: observation.metricRef, unit: observation.unit ?? undefined, period: observation.period ?? undefined, ...(typeof observation.value === 'number' ? { value: observation.value } : {}) }
  }
  const claim = asset as KnowledgeClaimV04
  const structured = claim.structuredValue as (Record<string, unknown> & { value?: unknown }) | null | undefined
  if (!structured) return {}
  return {
    metricRef: typeof structured.metric === 'string' ? structured.metric : undefined,
    unit: typeof structured.unit === 'string' ? structured.unit : undefined,
    period: typeof structured.fiscalPeriod === 'string' ? structured.fiscalPeriod : typeof structured.period === 'string' ? structured.period : undefined,
    ...(typeof structured.value === 'number' ? { value: structured.value } : {}),
  }
}

function provenanceLocatorMatches(asset: KnowledgeClaimV04 | KnowledgeObservationV04, binding: KillCriterionEvidenceBindingV1): boolean {
  if (asset.id.startsWith('observation:') && (asset as KnowledgeObservationV04).sourceRef !== binding.sourceRef) return false
  if (asset.id.startsWith('claim:') && !(asset as KnowledgeClaimV04).sourceRefs.includes(binding.sourceRef as never)) return false
  const provenance = (asset as unknown as { provenance?: unknown }).provenance
  if (!Array.isArray(provenance)) return false
  return provenance.some((item) => isRecord(item)
    && item.sourceRef === binding.sourceRef && item.rawRef === binding.rawRef && item.locator === binding.locator)
}

function decodeExactQuote(locator: string): string | undefined {
  if (!locator.startsWith('quote:') || locator.length > 2048) return undefined
  const encoded = locator.slice('quote:'.length)
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined
  try {
    const bytes = Buffer.from(encoded, 'base64url')
    const quote = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!quote || Buffer.from(quote, 'utf8').toString('base64url') !== encoded) return undefined
    return quote
  } catch { return undefined }
}

function exactTokenSpan(text: string, token: string): { start: number; end: number } | undefined {
  if (!token) return undefined
  const isWord = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}_]/u.test(character)
  const spans: Array<{ start: number; end: number }> = []
  let from = 0
  while (from < text.length) {
    const start = text.indexOf(token, from)
    if (start < 0) break
    const end = start + token.length
    if (!isWord(text[start - 1]) && !isWord(text[end])) spans.push({ start, end })
    from = start + Math.max(1, token.length)
  }
  return spans.length === 1 ? spans[0] : undefined
}

function quoteProvesValue(rawText: string, locator: string, fields: { metricRef: string; value: number; unit: string; period: string }): boolean {
  const quote = decodeExactQuote(locator)
  if (!quote || !rawText.includes(quote)) return false
  const metricLabel = getMetricDefinitionV04(fields.metricRef)?.label ?? fields.metricRef
  const spans = [metricLabel, fields.unit, fields.period].map((token) => exactTokenSpan(quote, token))
  if (spans.some((span) => span === undefined)) return false
  let remainder = quote
  for (const span of (spans as Array<{ start: number; end: number }>).sort((left, right) => right.start - left.start)) {
    remainder = remainder.slice(0, span.start) + remainder.slice(span.end)
  }
  const numericTokens = remainder.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  return numericTokens.length === 1 && numericTokens[0] === String(fields.value)
}

function activeCriterion(thesis: KnowledgeThesisV04, conditionId: string): { criterion?: KillCriterionV04; diagnostic?: string } {
  if (!Array.isArray(thesis.killCriteria)) return { diagnostic: 'KILL_CRITERION_MISSING' }
  const matching = thesis.killCriteria.filter((item) => item.conditionId === conditionId && item.state === 'active')
  if (matching.length === 0) return { diagnostic: 'KILL_CRITERION_MISSING' }
  if (matching.length !== 1) return { diagnostic: 'KILL_CRITERION_ACTIVE_REVISION_AMBIGUOUS' }
  return { criterion: matching[0] }
}

function definitionIsValid(criterion: KillCriterionV04): criterion is KillCriterionV04 & { definition: NumericThresholdDefinitionV1 } {
  const definition = criterion.definition as unknown
  if (criterion.type !== 'numeric_threshold' || criterion.definitionVersion !== 1 || !isRecord(definition)) return false
  if (Object.keys(definition).some((key) => !['metricRef', 'operator', 'threshold', 'unit', 'period', 'deadline'].includes(key))) return false
  return typeof definition.metricRef === 'string' && definition.metricRef.trim().length > 0
    && ['eq', 'gt', 'gte', 'lt', 'lte'].includes(String(definition.operator))
    && typeof definition.threshold === 'number' && Number.isFinite(definition.threshold)
    && typeof definition.unit === 'string' && definition.unit.length > 0
    && typeof definition.period === 'string' && definition.period.length > 0
    && (definition.deadline === undefined || validTime(definition.deadline))
}

function compare(value: number, definition: NumericThresholdDefinitionV1): boolean {
  switch (definition.operator) {
    case 'eq': return value === definition.threshold
    case 'gt': return value > definition.threshold
    case 'gte': return value >= definition.threshold
    case 'lt': return value < definition.threshold
    case 'lte': return value <= definition.threshold
  }
}

async function readVerifiedTextRaw(input: ThesisKillCriterionEvaluatorInput, rawRef: string): Promise<string | undefined> {
  try {
    const verified = await verifyRaw(input.handle, rawRef)
    const type = verified.manifest.mediaType.toLowerCase().split(';', 1)[0]!.trim()
    if (!['text/plain', 'text/html', 'application/xhtml+xml'].includes(type)) return undefined
    const bytes = await readRaw(input.handle, rawRef)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return undefined }
}

function getCanonicalCriterionOriginSource(criterion: KillCriterionV04): { sourceRef: string; rawRef: string; locator: string; publishedAt: string } | undefined {
  const origin = criterion.authority?.origin
  return origin?.kind === 'source_derived' ? origin : undefined
}

/** Deterministically evaluates an active canonical numeric_threshold V1 criterion against explicit evidence bindings. */
export async function evaluateThesisKillCriterion(input: ThesisKillCriterionEvaluatorInput): Promise<ThesisKillCriterionEvaluatorResult> {
  if (!validTime(input.asOf)) return result(input, 'insufficient_evidence', ['KILL_CRITERION_ASOF_INVALID'])
  if (input.handle.schemaVersion !== '0.4' || input.handle.status !== 'active') return result(input, 'insufficient_evidence', ['KILL_CRITERION_KNOWLEDGE_HANDLE_INVALID'])
  const matches = input.assets.objects.filter((item) => item.value.id === input.thesisRef && item.kind === 'thesis')
  if (matches.length !== 1) return result(input, 'insufficient_evidence', [matches.length === 0 ? 'KILL_CRITERION_THESIS_MISSING' : 'KILL_CRITERION_THESIS_AMBIGUOUS'])
  const thesis = matches[0]!.value as KnowledgeThesisV04
  if (!active(thesis) || thesis.status === 'archived' || thesis.status === 'invalidated') return result(input, 'insufficient_evidence', ['KILL_CRITERION_THESIS_INACTIVE'])
  const selected = activeCriterion(thesis, input.conditionId)
  if (!selected.criterion) return result(input, 'insufficient_evidence', [selected.diagnostic!])
  const criterion = selected.criterion
  if (!definitionIsValid(criterion)) return result(input, 'insufficient_evidence', ['KILL_CRITERION_TYPE_OR_DEFINITION_UNSUPPORTED'], criterion)
  const definition = criterion.definition
  if (definition.deadline !== undefined) return result(input, 'insufficient_evidence', ['KILL_CRITERION_DEADLINE_UNSUPPORTED'], criterion)
  if (!validTime(criterion.effectiveAt) || Date.parse(criterion.effectiveAt) > Date.parse(input.asOf)
    || !validTime(criterion.authority?.confirmedAt) || Date.parse(criterion.effectiveAt) < Date.parse(criterion.authority.confirmedAt)) return result(input, 'insufficient_evidence', ['KILL_CRITERION_EFFECTIVE_TIME_INVALID'], criterion)
  try {
    const expectedHash = hashKillCriterionDefinitionV04({ type: criterion.type, definitionVersion: criterion.definitionVersion, definition: definition as unknown as Record<string, unknown>, targetClaimRefs: criterion.targetClaimRefs, origin: criterion.authority.origin })
    if (expectedHash !== criterion.definitionHash) return result(input, 'insufficient_evidence', ['KILL_CRITERION_DEFINITION_HASH_INVALID'], criterion)
  } catch { return result(input, 'insufficient_evidence', ['KILL_CRITERION_DEFINITION_HASH_INVALID'], criterion) }

  const objects = new Map<string, KnowledgeAssetV04[]>()
  for (const item of input.assets.objects) objects.set(item.value.id, [...(objects.get(item.value.id) ?? []), item.value])
  const edges = input.assets.objects.filter((item) => item.kind === 'reasoning_edge').map((item) => item.value as KnowledgeReasoningEdgeV04)
  const activeTargets = new Set<string>()
  for (const targetRef of criterion.targetClaimRefs) {
    const claims = objects.get(targetRef) ?? []
    if (claims.length !== 1 || !claims[0]!.id.startsWith('claim:') || !active(claims[0]!)) return result(input, 'insufficient_evidence', ['KILL_CRITERION_TARGET_CLAIM_INACTIVE_OR_AMBIGUOUS'], criterion)
    const memberships = edges.filter((edge) => edge.type === 'qualifies' && edge.sourceRef === targetRef && edge.targetRef === thesis.id && active(edge))
    if (memberships.length !== 1) return result(input, 'insufficient_evidence', ['KILL_CRITERION_TARGET_MEMBERSHIP_INVALID'], criterion)
    activeTargets.add(targetRef)
  }

  const origin = getCanonicalCriterionOriginSource(criterion)
  if (origin) {
    const sourceMatches = objects.get(origin.sourceRef) ?? []
    const source = sourceMatches[0] as KnowledgeSourceV04 | undefined
    if (sourceMatches.length !== 1 || !source || !source.id.startsWith('source:') || !sourceEligible(source, input.asOf)
      || !Array.isArray(source.rawRefs) || !source.rawRefs.includes(origin.rawRef as never)
      || !validTime(source.publishedAt) || source.publishedAt !== origin.publishedAt
      || Date.parse(source.publishedAt) > Date.parse(criterion.authority.confirmedAt)) return result(input, 'insufficient_evidence', ['KILL_CRITERION_ORIGIN_SOURCE_INELIGIBLE'], criterion)
    const rawText = await readVerifiedTextRaw(input, origin.rawRef)
    if (rawText === undefined || !quoteProvesValue(rawText, origin.locator, { metricRef: definition.metricRef, value: definition.threshold, unit: definition.unit, period: definition.period })) return result(input, 'insufficient_evidence', ['KILL_CRITERION_ORIGIN_VALUE_UNVERIFIED'], criterion)
  }

  if (!Array.isArray(input.evidenceBindings) || input.evidenceBindings.length === 0) return result(input, 'insufficient_evidence', ['KILL_CRITERION_EVIDENCE_MISSING'], criterion)
  if (input.evidenceBindings.length > MAX_BINDINGS) return result(input, 'insufficient_evidence', ['KILL_CRITERION_EVIDENCE_LIMIT_EXCEEDED'], criterion)
  const diagnostics: string[] = []
  const candidates: KillCriterionEvaluatedValueV1[] = []
  let scopedFailure = false
  const seenBindings = new Set<string>()
  for (const binding of input.evidenceBindings) {
    const key = `${binding.evidenceRef}\0${binding.sourceRef}\0${binding.rawRef}\0${binding.locator}`
    if (seenBindings.has(key)) { diagnostics.push('KILL_CRITERION_EVIDENCE_BINDING_DUPLICATE'); scopedFailure = true; continue }
    seenBindings.add(key)
    const evidenceMatches = objects.get(binding.evidenceRef) ?? []
    const evidence = evidenceMatches[0]
    if (evidenceMatches.length !== 1 || !evidence || !active(evidence)) { diagnostics.push('KILL_CRITERION_EVIDENCE_INACTIVE_OR_AMBIGUOUS'); continue }
    if (!evidence.id.startsWith('claim:') && !evidence.id.startsWith('observation:')) continue
    const fields = numericFields(evidence as KnowledgeClaimV04 | KnowledgeObservationV04)
    if (fields.metricRef !== definition.metricRef || fields.period !== definition.period) continue
    if (!Array.isArray(binding.targetClaimRefs) || binding.targetClaimRefs.length === 0 || binding.targetClaimRefs.some((ref: string) => !activeTargets.has(ref)) || new Set(binding.targetClaimRefs).size !== binding.targetClaimRefs.length) {
      diagnostics.push('KILL_CRITERION_EVIDENCE_TARGET_BINDING_INVALID'); scopedFailure = true; continue
    }
    if (fields.unit !== definition.unit) { diagnostics.push('KILL_CRITERION_EVIDENCE_UNIT_MISMATCH'); scopedFailure = true; continue }
    if (typeof fields.value !== 'number' || !Number.isFinite(fields.value)) { diagnostics.push('KILL_CRITERION_EVIDENCE_VALUE_INVALID'); scopedFailure = true; continue }
    if (!provenanceLocatorMatches(evidence as KnowledgeClaimV04 | KnowledgeObservationV04, binding)) { diagnostics.push('KILL_CRITERION_EVIDENCE_PROVENANCE_LOCATOR_INVALID'); scopedFailure = true; continue }
    const sourceMatches = objects.get(binding.sourceRef) ?? []
    const source = sourceMatches[0] as KnowledgeSourceV04 | undefined
    if (sourceMatches.length !== 1 || !source || !source.id.startsWith('source:') || !sourceEligible(source, input.asOf)) { diagnostics.push('KILL_CRITERION_SOURCE_INELIGIBLE'); scopedFailure = true; continue }
    if (Date.parse(criterion.effectiveAt) > Date.parse(input.asOf) || !validTime(source.publishedAt) || Date.parse(source.publishedAt) > Date.parse(input.asOf) || Date.parse(source.publishedAt) < Date.parse(criterion.effectiveAt)) { diagnostics.push('KILL_CRITERION_PUBLICATION_TIME_INVALID'); scopedFailure = true; continue }
    if (!Array.isArray(source.rawRefs) || !source.rawRefs.includes(binding.rawRef as never)) { diagnostics.push('KILL_CRITERION_SOURCE_RAW_BINDING_INVALID'); scopedFailure = true; continue }
    const rawText = await readVerifiedTextRaw(input, binding.rawRef)
    if (rawText === undefined) { diagnostics.push('KILL_CRITERION_RAW_FORMAT_OR_INTEGRITY_UNSUPPORTED'); scopedFailure = true; continue }
    if (!quoteProvesValue(rawText, binding.locator, { metricRef: definition.metricRef, value: fields.value, unit: definition.unit, period: definition.period })) { diagnostics.push('KILL_CRITERION_NUMERIC_VALUE_VERSION_UNVERIFIED'); scopedFailure = true; continue }
    candidates.push({ evidenceRef: evidence.id, value: fields.value, metricRef: definition.metricRef, unit: definition.unit, period: definition.period, sourceRef: source.id, rawRef: binding.rawRef, locator: binding.locator, publishedAt: source.publishedAt, targetClaimRefs: [...binding.targetClaimRefs].sort(), numericValueVersionVerified: true })
  }
  if (scopedFailure) return result(input, 'insufficient_evidence', diagnostics.length ? diagnostics : ['KILL_CRITERION_EVIDENCE_UNVERIFIED'], criterion)
  if (candidates.length === 0) return result(input, 'insufficient_evidence', diagnostics.length ? diagnostics : ['KILL_CRITERION_EVIDENCE_MISSING_OR_MISMATCHED'], criterion)
  const values = new Set(candidates.map((item) => item.value))
  if (values.size !== 1) return result(input, 'insufficient_evidence', ['KILL_CRITERION_EVIDENCE_VALUES_CONFLICT'], criterion)
  if (candidates.length !== 1) return result(input, 'insufficient_evidence', ['KILL_CRITERION_EVIDENCE_PRECEDENCE_UNRESOLVED'], criterion)
  const evaluatedValue = candidates[0]!
  return result(input, compare(evaluatedValue.value, definition) ? 'met' : 'not_met', diagnostics, criterion, evaluatedValue)
}
