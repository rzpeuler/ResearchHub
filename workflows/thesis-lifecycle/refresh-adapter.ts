import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import type { KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeObservationV04, KnowledgeReasoningEdgeV04, KnowledgeSourceV04, KnowledgeThesisV04, RawRefV04, ThesisRefV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04 } from '../../knowledge/storage/v04-types.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { KnowledgeIndexV04 } from '../../knowledge/query/index.ts'
import { refreshThesis } from '../../skills/thesis_refresh/calculations.ts'
import type { PriorThesisSnapshot, RefreshEvidence, RefreshEvidenceRelation, ThesisRefreshResult } from '../../skills/thesis_refresh/contracts.ts'
import { evaluateThesisKillCriterion, type KillCriterionEvidenceBindingV1, type ThesisKillCriterionEvaluatorResult } from './kill-criterion-evaluator.ts'

export interface ThesisRefreshEvidenceBinding {
  readonly evidenceRef: string
  readonly relation: RefreshEvidenceRelation
  readonly targetClaimRefs: readonly string[]
  readonly sourceBindings: readonly { readonly sourceRef: string; readonly rawRef: string }[]
  readonly basis?: 'verified_evidence' | 'inference' | 'hypothesis'
}

export interface ThesisRefreshAdapterInput {
  readonly assets: KnowledgeAssetCollectionV04
  readonly handle: KnowledgeBaseHandle
  readonly thesisRef: ThesisRefV04
  readonly currentAsOf: string
  /** Producer-owned, explicit semantic bindings. Object text is never searched for relationships. */
  readonly evidenceBindings: readonly ThesisRefreshEvidenceBinding[]
}

export interface ThesisRefreshEvidenceLineage {
  readonly evidenceRef: string
  readonly relation: RefreshEvidenceRelation
  readonly targetClaimRefs: readonly string[]
  readonly sourceBindings: readonly { readonly sourceRef: string; readonly rawRef: string }[]
  readonly publishedAt?: string
  readonly decision: 'included' | 'excluded'
  readonly reason?: string
}

export interface ThesisRefreshAdapterResult {
  readonly status: 'completed' | 'blocked'
  readonly thesisRef: ThesisRefV04
  readonly priorSnapshot?: PriorThesisSnapshot
  readonly refresh?: ThesisRefreshResult
  /** Deterministic evaluations of active canonical criteria; separate from Skill proposition assessments. */
  readonly criterionEvaluations: readonly ThesisKillCriterionEvaluatorResult[]
  readonly evidenceLineage: readonly ThesisRefreshEvidenceLineage[]
  readonly diagnostics: readonly string[]
}

const validTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const active = (asset: KnowledgeAssetV04): boolean => 'lifecycle' in asset && asset.lifecycle?.status === 'active'
const ordered = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const isClaim = (value: KnowledgeAssetV04 | undefined): value is KnowledgeClaimV04 => value?.id.startsWith('claim:') === true
const isObservation = (value: KnowledgeAssetV04 | undefined): value is KnowledgeObservationV04 => value?.id.startsWith('observation:') === true
const MAX_ACTIVE_CRITERIA = 100

function publicationTime(asset: KnowledgeClaimV04 | KnowledgeObservationV04, binding: ThesisRefreshEvidenceBinding, index: KnowledgeIndexV04): { publishedAt?: string; reason?: string } {
  const dates = binding.sourceBindings.map((pair) => {
    const source = index.objects.get(pair.sourceRef)
    return source && source.id.startsWith('source:') ? (source as KnowledgeSourceV04).publishedAt ?? undefined : undefined
  })
  if (dates.length === 0 || dates.some((date) => !validTime(date))) return { reason: 'EVIDENCE_PUBLICATION_UNKNOWN' }
  const timestamps = new Set(dates.map((date) => Date.parse(date!)))
  if (timestamps.size !== 1) return { reason: 'EVIDENCE_PUBLICATION_BINDING_MISMATCH' }
  const publishedAt = dates[0]!
  if (asset.id.startsWith('observation:') && (asset as KnowledgeObservationV04).observationType === 'estimate') {
    const estimatePublishedAt = (asset as Extract<KnowledgeObservationV04, { observationType: 'estimate' }>).publishedAt
    if (!validTime(estimatePublishedAt)) return { reason: 'EVIDENCE_PUBLICATION_UNKNOWN' }
    if (Date.parse(estimatePublishedAt) !== Date.parse(publishedAt)) return { reason: 'EVIDENCE_PUBLICATION_BINDING_MISMATCH' }
  }
  return { publishedAt }
}

function statement(asset: KnowledgeClaimV04 | KnowledgeObservationV04): string {
  if (asset.id.startsWith('claim:')) return (asset as KnowledgeClaimV04).statement
  const observation = asset as KnowledgeObservationV04
  if (observation.observationType === 'metric') return `${observation.metricRef}=${String(observation.value)}${observation.unit ? ` ${observation.unit}` : ''}`
  if (observation.observationType === 'estimate') return `${observation.metricRef} estimate=${String(observation.estimateValue)}${observation.unit ? ` ${observation.unit}` : ''}`
  return `${observation.metricRef} consensus=${observation.mean}`
}

function fields(asset: KnowledgeClaimV04 | KnowledgeObservationV04): Pick<RefreshEvidence, 'metric' | 'period' | 'unit' | 'value'> {
  if (asset.id.startsWith('claim:')) {
    const value = (asset as KnowledgeClaimV04).structuredValue
    return value ? { metric: value.metric, period: value.fiscalPeriod ?? value.period ?? undefined, unit: value.unit ?? undefined, ...(typeof value.value === 'number' ? { value: value.value } : {}) } : {}
  }
  const observation = asset as KnowledgeObservationV04
  if (observation.observationType === 'metric') return { metric: observation.metricRef, period: observation.period ?? undefined, unit: observation.unit ?? undefined, ...(typeof observation.value === 'number' ? { value: observation.value } : {}) }
  if (observation.observationType === 'estimate') return { metric: observation.metricRef, period: observation.fiscalPeriod, unit: observation.unit ?? undefined, ...(typeof observation.estimateValue === 'number' ? { value: observation.estimateValue } : {}) }
  return { metric: observation.metricRef, period: observation.fiscalPeriod, value: observation.mean }
}

function sourceBoundToEvidence(asset: KnowledgeClaimV04 | KnowledgeObservationV04, sourceRef: string, rawRef: string): boolean {
  if (!asset.id.startsWith('claim:') && !asset.id.startsWith('observation:')) return false
  const raw = asset as unknown as Record<string, unknown>
  if (asset.id.startsWith('observation:') && raw.sourceRef !== sourceRef) return false
  if (asset.id.startsWith('claim:') && !(Array.isArray(raw.sourceRefs) && raw.sourceRefs.includes(sourceRef))) return false
  const provenance = raw.provenance
  return Array.isArray(provenance) && provenance.some((item) => item !== null && typeof item === 'object' && (item as Record<string, unknown>).sourceRef === sourceRef && (item as Record<string, unknown>).rawRef === rawRef)
}

function sourceEligible(source: KnowledgeSourceV04, asOf: string): boolean {
  const timestamp = Date.parse(asOf)
  const lifecycle = source.lifecycle as unknown as { validFrom?: unknown; validUntil?: unknown } | undefined
  const inInterval = (value: unknown, lowerBound: boolean): boolean => {
    if (value === undefined || value === null) return true
    if (!validTime(value)) return false
    return lowerBound ? Date.parse(value) <= timestamp : Date.parse(value) >= timestamp
  }
  return active(source) && inInterval(lifecycle?.validFrom, true) && inInterval(lifecycle?.validUntil, false) && inInterval(source.rights.expiresAt, false) && source.rights.accessScope !== 'unknown' && source.rights.accessScope !== 'restricted' && source.rights.retentionAllowed === true && source.rights.aiProcessingAllowed === true && source.rights.derivativeKnowledgeAllowed === true && source.usagePolicy?.retainRaw === true && source.usagePolicy.allowAiProcessing === true && source.usagePolicy.allowDerivedKnowledge === true
}

function blocked(input: ThesisRefreshAdapterInput, diagnostics: readonly string[], lineage: readonly ThesisRefreshEvidenceLineage[] = []): ThesisRefreshAdapterResult {
  return { status: 'blocked', thesisRef: input.thesisRef, criterionEvaluations: [], evidenceLineage: lineage, diagnostics }
}

function criterionEvidenceBindings(
  index: KnowledgeIndexV04,
  lineage: readonly ThesisRefreshEvidenceLineage[],
  targetClaimRefs: readonly string[],
): KillCriterionEvidenceBindingV1[] {
  const targets = new Set(targetClaimRefs)
  const bindings: KillCriterionEvidenceBindingV1[] = []
  for (const item of lineage) {
    if (item.decision !== 'included' || item.targetClaimRefs.length === 0 || !item.targetClaimRefs.some((ref) => targets.has(ref))) continue
    const evidence = index.objects.get(item.evidenceRef)
    if (!isClaim(evidence) && !isObservation(evidence)) continue
    const provenance = (evidence as unknown as { provenance?: unknown }).provenance
    for (const pair of item.sourceBindings) {
      const matchingProvenance = Array.isArray(provenance)
        ? provenance.filter((value) => value !== null && typeof value === 'object' && (value as Record<string, unknown>).sourceRef === pair.sourceRef && (value as Record<string, unknown>).rawRef === pair.rawRef)
        : []
      if (matchingProvenance.length === 0) {
        bindings.push({ evidenceRef: item.evidenceRef, targetClaimRefs: [...item.targetClaimRefs], sourceRef: pair.sourceRef, rawRef: pair.rawRef, locator: '' })
      }
      for (const value of matchingProvenance) {
        const entry = value as Record<string, unknown>
        bindings.push({ evidenceRef: item.evidenceRef, targetClaimRefs: [...item.targetClaimRefs], sourceRef: pair.sourceRef, rawRef: pair.rawRef, locator: typeof entry.locator === 'string' ? entry.locator : '' })
        // The evaluator rejects >80 bindings. Preserve that fail-closed signal
        // without constructing an unbounded array from malformed provenance.
        if (bindings.length > 80) return bindings
      }
    }
  }
  return bindings
}

/** Reconstructs a refresh snapshot from the current v0.4 graph and runs the deterministic refresh skill. */
export async function runThesisRefreshAdapter(input: ThesisRefreshAdapterInput): Promise<ThesisRefreshAdapterResult> {
  if (!validTime(input.currentAsOf)) return blocked(input, ['THESIS_REFRESH_ASOF_INVALID'])
  if (input.handle.schemaVersion !== '0.4' || input.handle.status !== 'active') return blocked(input, ['THESIS_REFRESH_KNOWLEDGE_HANDLE_INVALID'])

  const assetIdCounts = new Map<string, number>()
  for (const loaded of input.assets.objects) assetIdCounts.set(loaded.value.id, (assetIdCounts.get(loaded.value.id) ?? 0) + 1)
  const duplicateIds = new Set([...assetIdCounts].filter(([, count]) => count > 1).map(([id]) => id))
  if (duplicateIds.size > 0) return blocked(input, ['THESIS_REFRESH_CANONICAL_ID_AMBIGUOUS'])
  const index = KnowledgeIndexV04.fromAssets(input.assets)

  const thesisMatches = input.assets.objects.filter((item) => item.value.id === input.thesisRef && item.kind === 'thesis')
  if (thesisMatches.length !== 1) return blocked(input, [thesisMatches.length === 0 ? 'THESIS_REFRESH_THESIS_NOT_FOUND' : 'THESIS_REFRESH_THESIS_AMBIGUOUS'])
  const thesis = thesisMatches[0]!.value as KnowledgeThesisV04
  if (!active(thesis) || thesis.status === 'archived' || thesis.status === 'invalidated') return blocked(input, ['THESIS_REFRESH_THESIS_INACTIVE'])

  const edges = input.assets.objects.filter((item) => item.kind === 'reasoning_edge').map((item) => item.value as KnowledgeReasoningEdgeV04)
  const membershipEdges = edges.filter((edge) => edge.type === 'qualifies' && edge.targetRef === thesis.id && active(edge))
  const claimEdgeCounts = new Map<string, number>()
  for (const edge of membershipEdges) claimEdgeCounts.set(edge.sourceRef, (claimEdgeCounts.get(edge.sourceRef) ?? 0) + 1)
  if ([...claimEdgeCounts.values()].some((count) => count !== 1)) return blocked(input, ['THESIS_REFRESH_MEMBERSHIP_AMBIGUOUS'])
  const activeClaims: KnowledgeClaimV04[] = []
  for (const edge of membershipEdges) {
    const claim = index.objects.get(edge.sourceRef)
    if (!isClaim(claim)) return blocked(input, ['THESIS_REFRESH_MEMBERSHIP_CLAIM_MISSING'])
    if (!active(claim) || claim.lifecycle.status === 'superseded' || Boolean(claim.supersededBy?.length)) return blocked(input, ['THESIS_REFRESH_MEMBERSHIP_INACTIVE_CLAIM'])
    activeClaims.push(claim)
  }
  activeClaims.sort((a, b) => a.id.localeCompare(b.id))
  if (activeClaims.length === 0) return blocked(input, ['THESIS_REFRESH_ACTIVE_MEMBERSHIP_EMPTY'])

  const priorAsOf = thesis.lastReviewedAt ?? thesis.updatedAt ?? thesis.createdAt
  if (!validTime(priorAsOf) || Date.parse(priorAsOf) >= Date.parse(input.currentAsOf)) return blocked(input, ['THESIS_REFRESH_PRIOR_ASOF_INVALID'])
  const priorSnapshot: PriorThesisSnapshot = {
    thesisId: thesis.id,
    priorAsOf,
    propositions: activeClaims.map((claim) => ({ propositionId: claim.id, statement: claim.statement })),
  }
  const activeClaimRefs = new Set(activeClaims.map((claim) => claim.id))
  const lineage: ThesisRefreshEvidenceLineage[] = []
  const evidence: RefreshEvidence[] = []
  const seenEvidence = new Set<string>()
  const diagnostics: string[] = []

  for (const [bindingIndex, binding] of input.evidenceBindings.entries()) {
    const exclude = (reason: string, publishedAt?: string): void => {
      lineage.push({ ...binding, ...(publishedAt === undefined ? {} : { publishedAt }), decision: 'excluded', reason })
      diagnostics.push(`${binding.evidenceRef}:${reason}`)
    }
    if (bindingIndex >= 80) { exclude('EVIDENCE_LIMIT_EXCEEDED'); continue }
    if (seenEvidence.has(binding.evidenceRef)) { exclude('EVIDENCE_BINDING_AMBIGUOUS'); continue }
    seenEvidence.add(binding.evidenceRef)
    const asset = index.objects.get(binding.evidenceRef)
    if (!isClaim(asset) && !isObservation(asset)) { exclude('EVIDENCE_REF_MISSING_OR_WRONG_KIND'); continue }
    if (!active(asset) || (isClaim(asset) && (asset.lifecycle.status === 'superseded' || Boolean(asset.supersededBy?.length)))) { exclude('EVIDENCE_REF_INACTIVE'); continue }
    if (!Array.isArray(binding.targetClaimRefs) || (binding.targetClaimRefs.length === 0 && binding.relation !== 'context' && binding.relation !== 'irrelevant') || binding.targetClaimRefs.some((ref) => !activeClaimRefs.has(ref)) || new Set(binding.targetClaimRefs).size !== binding.targetClaimRefs.length) { exclude('EVIDENCE_TARGET_CLAIM_BINDING_INVALID'); continue }
    if (!['supports', 'weakens', 'contradicts', 'context', 'irrelevant'].includes(binding.relation)) { exclude('EVIDENCE_RELATION_INVALID'); continue }
    if (!Array.isArray(binding.sourceBindings) || binding.sourceBindings.length === 0) { exclude('EVIDENCE_SOURCE_BINDING_MISSING'); continue }
    const sourceRefs: string[] = []
    let sourceError: string | undefined
    for (const pair of binding.sourceBindings) {
      const source = index.objects.get(pair.sourceRef)
      if (!source || !source.id.startsWith('source:')) { sourceError = 'EVIDENCE_SOURCE_MISSING'; break }
      if (!sourceEligible(source as KnowledgeSourceV04, input.currentAsOf)) { sourceError = 'EVIDENCE_SOURCE_INELIGIBLE'; break }
      if (!Array.isArray((source as KnowledgeSourceV04).rawRefs) || !(source as KnowledgeSourceV04).rawRefs!.includes(pair.rawRef as RawRefV04) || !sourceBoundToEvidence(asset, pair.sourceRef, pair.rawRef)) { sourceError = 'EVIDENCE_SOURCE_RAW_BINDING_INVALID'; break }
      try { await verifyRaw(input.handle, pair.rawRef) } catch { sourceError = 'EVIDENCE_RAW_UNVERIFIED'; break }
      sourceRefs.push(pair.sourceRef)
    }
    if (sourceError) { exclude(sourceError); continue }
    const publication = publicationTime(asset, binding, index)
    const publishedAt = publication.publishedAt
    if (publication.reason) { exclude(publication.reason); continue }
    if (Date.parse(publishedAt!) > Date.parse(input.currentAsOf)) { exclude('EVIDENCE_PUBLICATION_FUTURE', publishedAt); continue }
    if (Date.parse(publishedAt!) <= Date.parse(priorAsOf)) { exclude('EVIDENCE_PUBLICATION_NOT_NEW', publishedAt); continue }
    const item: RefreshEvidence = {
      evidenceId: binding.evidenceRef,
      publishedAt: publishedAt!,
      relation: binding.relation,
      targetPropositionRefs: ordered(binding.targetClaimRefs),
      sourceRefs: ordered(sourceRefs),
      ...(binding.basis ? { basis: binding.basis } : {}),
      statement: statement(asset),
      ...fields(asset),
    }
    evidence.push(item)
    lineage.push({ ...binding, publishedAt, decision: 'included' })
  }

  let refresh: ThesisRefreshResult
  try { refresh = refreshThesis({ priorSnapshot, currentAsOf: input.currentAsOf, evidence }) }
  catch (error) { return blocked(input, [...diagnostics, error instanceof Error ? error.message : 'THESIS_REFRESH_FAILED'], lineage) }
  diagnostics.push(...refresh.diagnostics)

  const activeCriteria = Array.isArray(thesis.killCriteria) ? thesis.killCriteria.filter((criterion) => criterion.state === 'active') : []
  const criterionEvaluations: ThesisKillCriterionEvaluatorResult[] = []
  if (activeCriteria.length === 0) {
    diagnostics.push('KILL_CRITERION_MISSING')
  } else if (activeCriteria.length > MAX_ACTIVE_CRITERIA) {
    diagnostics.push('KILL_CRITERION_ACTIVE_LIMIT_EXCEEDED')
  } else {
    for (const criterion of activeCriteria) {
      const evidenceBindings = criterionEvidenceBindings(index, lineage, criterion.targetClaimRefs)
      const evaluation = await evaluateThesisKillCriterion({
        assets: input.assets,
        handle: input.handle,
        thesisRef: thesis.id,
        conditionId: criterion.conditionId,
        asOf: input.currentAsOf,
        evidenceBindings,
      })
      criterionEvaluations.push(evaluation)
      for (const code of evaluation.diagnostics) diagnostics.push(`KILL_CRITERION:${evaluation.conditionId}:${code}`)
    }
  }
  if (criterionEvaluations.some((evaluation) => evaluation.status === 'met')) {
    refresh = { ...refresh, candidateTransition: 'invalidation_condition_met' }
  }
  return { status: refresh.status === 'blocked' ? 'blocked' : 'completed', thesisRef: thesis.id, priorSnapshot, refresh, criterionEvaluations, evidenceLineage: lineage, diagnostics: [...new Set(diagnostics)] }
}
