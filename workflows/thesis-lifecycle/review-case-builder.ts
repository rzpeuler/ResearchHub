import { createHash } from 'node:crypto'
import type { KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEntityV04, KnowledgeRelationV04, KnowledgeThesisV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04 } from '../../knowledge/storage/v04-types.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../../knowledge/schema/executable-schema.ts'
import { validateReviewCase } from '../../knowledge/review/validation.ts'
import type { CanonicalResearchEvidenceBinding, KillCriterionReviewBindingV1, ReviewCase, ReviewClaimType, ThesisReviewedEvidence } from '../../knowledge/review/contracts.ts'
import type { KillCriterionAssessment } from '../../skills/thesis_refresh/contracts.ts'
import type { ThesisRefreshAdapterResult, ThesisRefreshEvidenceLineage } from './refresh-adapter.ts'

export interface ThesisRefreshReviewCaseBuilderInput {
  readonly adapterResult: ThesisRefreshAdapterResult
  readonly assets: KnowledgeAssetCollectionV04
  readonly knowledgeBaseId: string
  readonly producerRunId: string
  readonly knowledgeBaseRevisionAtCreation: number
  readonly createdAt: string
}

export interface ThesisRefreshReviewCaseBuilderResult {
  readonly status: 'completed' | 'blocked'
  readonly cases: readonly ReviewCase[]
  readonly diagnostics: readonly string[]
}

const active = (asset: KnowledgeAssetV04): boolean => 'lifecycle' in asset && asset.lifecycle?.status === 'active'
const REVIEW_CLAIM_TYPES: ReadonlySet<string> = new Set([...KNOWLEDGE_SCHEMA_V03.claim.types, 'assumption', 'catalyst'])
const ordered = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const fullHash = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
const block = (diagnostic: string): ThesisRefreshReviewCaseBuilderResult => ({ status: 'blocked', cases: [], diagnostics: [diagnostic] })

function isReviewDelta(line: { readonly candidateStatus: string }): boolean { return line.candidateStatus !== 'unchanged' }

function activeEntity(ref: string, assets: KnowledgeAssetCollectionV04): KnowledgeEntityV04 | undefined {
  const matches = assets.objects.filter((item) => item.kind === 'entity' && item.value.id === ref)
  if (matches.length !== 1) return undefined
  const entity = matches[0]!.value as KnowledgeEntityV04
  return entity && active(entity) && typeof entity.name === 'string' && entity.name.trim() !== '' ? entity : undefined
}

function thesisIdentityIsValid(thesis: KnowledgeThesisV04, assets: KnowledgeAssetCollectionV04): boolean {
  return typeof thesis.title === 'string' && thesis.title.trim() !== '' && Array.isArray(thesis.subjectRefs) && thesis.subjectRefs.length > 0 && new Set(thesis.subjectRefs).size === thesis.subjectRefs.length && thesis.subjectRefs.every((ref) => activeEntity(ref, assets) !== undefined)
}

function claimSubjectMentions(claim: KnowledgeClaimV04, assets: KnowledgeAssetCollectionV04): { candidateRef: string; mention: string }[] | undefined {
  if (!Array.isArray(claim.subjectRefs) || claim.subjectRefs.length === 0 || new Set(claim.subjectRefs).size !== claim.subjectRefs.length) return undefined
  const result: { candidateRef: string; mention: string }[] = []
  for (const ref of claim.subjectRefs) {
    const matches = assets.objects.filter((loaded) => loaded.value.id === ref)
    if (matches.length !== 1) return undefined
    const item = matches[0]
    if (item?.kind === 'entity') {
      const entity = activeEntity(ref, assets)
      if (!entity) return undefined
      result.push({ candidateRef: ref, mention: entity.name })
      continue
    }
    if (item?.kind === 'relation') {
      const relation = item.value as KnowledgeRelationV04
      const source = activeEntity(relation.sourceRef, assets)
      const target = activeEntity(relation.targetRef, assets)
      if (!active(relation) || !source || !target || typeof relation.type !== 'string') return undefined
      result.push({ candidateRef: ref, mention: `${source.name} ${relation.type} ${target.name}` })
      continue
    }
    return undefined
  }
  return result
}

function isReviewClaimType(value: string): value is ReviewClaimType {
  return value !== 'thesis' && REVIEW_CLAIM_TYPES.has(value)
}

function numericValueIdentity(value: Omit<KillCriterionReviewBindingV1, 'evaluatedValueIdentity'>): string {
  return fullHash([value.conditionId, value.revision, value.definitionHash, value.evidenceRef, value.value, value.metricRef, value.unit, value.period, value.sourceRef, value.rawRef, value.locator, value.publishedAt, [...value.targetClaimRefs], value.numericValueVersionVerified, value.asOf])
}

function canonicalNumericValue(asset: KnowledgeAssetV04): { metricRef?: string; unit?: string; period?: string; value?: number } {
  if (asset.id.startsWith('observation:')) {
    const observation = asset as unknown as Record<string, unknown>
    return { metricRef: typeof observation.metricRef === 'string' ? observation.metricRef : undefined, unit: typeof observation.unit === 'string' ? observation.unit : undefined, period: typeof observation.period === 'string' ? observation.period : undefined, ...(typeof observation.value === 'number' ? { value: observation.value } : {}) }
  }
  if (asset.id.startsWith('claim:')) {
    const structured = (asset as unknown as Record<string, unknown>).structuredValue
    if (typeof structured !== 'object' || structured === null || Array.isArray(structured)) return {}
    const fields = structured as Record<string, unknown>
    return { metricRef: typeof fields.metric === 'string' ? fields.metric : undefined, unit: typeof fields.unit === 'string' ? fields.unit : undefined, period: typeof fields.fiscalPeriod === 'string' ? fields.fiscalPeriod : typeof fields.period === 'string' ? fields.period : undefined, ...(typeof fields.value === 'number' ? { value: fields.value } : {}) }
  }
  return {}
}

function sourceRawValueBindingMatches(input: ThesisRefreshReviewCaseBuilderInput, value: { evidenceRef: string; sourceRef: string; rawRef: string; locator: string; publishedAt: string; metricRef: string; unit: string; period: string; value: number }): boolean {
  const evidenceMatches = input.assets.objects.filter((item) => item.value.id === value.evidenceRef && (item.kind === 'observation' || item.kind === 'claim'))
  const sourceMatches = input.assets.objects.filter((item) => item.value.id === value.sourceRef && item.kind === 'source')
  if (evidenceMatches.length !== 1 || sourceMatches.length !== 1) return false
  const evidence = evidenceMatches[0]!.value
  const source = sourceMatches[0]!.value as unknown as Record<string, unknown>
  const rawRefs = source.rawRefs
  if (!active(evidence) || !active(sourceMatches[0]!.value) || !Array.isArray(rawRefs) || !rawRefs.includes(value.rawRef)) return false
  const provenance = (evidence as unknown as Record<string, unknown>).provenance
  if (!Array.isArray(provenance) || !provenance.some((entry) => entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).sourceRef === value.sourceRef && (entry as Record<string, unknown>).rawRef === value.rawRef && (entry as Record<string, unknown>).locator === value.locator)) return false
  if (source.publishedAt !== value.publishedAt) return false
  const numeric = canonicalNumericValue(evidence)
  return numeric.metricRef === value.metricRef && numeric.unit === value.unit && numeric.period === value.period && numeric.value === value.value
}

function buildInvalidationCase(input: ThesisRefreshReviewCaseBuilderInput, thesis: KnowledgeThesisV04): ThesisRefreshReviewCaseBuilderResult {
  const result = input.adapterResult
  const refresh = result.refresh!
  const met = result.criterionEvaluations.filter((evaluation) => evaluation.status === 'met')
  if (met.length === 0 || met.length > 40) return block('THESIS_REVIEW_CANONICAL_KILL_CRITERION_MET_REQUIRED')
  const activeCriteria = Array.isArray(thesis.killCriteria) ? thesis.killCriteria.filter((criterion) => criterion.state === 'active') : []
  if (activeCriteria.length === 0) return block('THESIS_REVIEW_CANONICAL_KILL_CRITERION_UNAVAILABLE')

  const bindings: KillCriterionReviewBindingV1[] = []
  const bindingKeys = new Set<string>()
  for (const evaluation of met) {
    const criteria = activeCriteria.filter((criterion) => criterion.conditionId === evaluation.conditionId)
    if (criteria.length !== 1 || !Number.isSafeInteger(evaluation.revision) || evaluation.revision! < 1 || criteria[0]!.revision !== evaluation.revision || !/^sha256:[a-f0-9]{64}$/.test(evaluation.definitionHash ?? '') || criteria[0]!.definitionHash !== evaluation.definitionHash) return block('THESIS_REVIEW_CANONICAL_KILL_CRITERION_MISMATCH')
    const value = evaluation.evaluatedValue
    if (!value || value.numericValueVersionVerified !== true || !Number.isFinite(value.value) || !value.metricRef || !value.unit || !value.period || !value.publishedAt || evaluation.asOf !== refresh.currentAsOf || !Array.isArray(value.targetClaimRefs) || value.targetClaimRefs.length === 0 || value.targetClaimRefs.length > 64) return block('THESIS_REVIEW_KILL_CRITERION_VALUE_BINDING_UNAVAILABLE')
    const targets = ordered(value.targetClaimRefs)
    if (targets.length !== value.targetClaimRefs.length || targets.some((ref) => !/^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) return block('THESIS_REVIEW_KILL_CRITERION_TARGET_BINDING_INVALID')
    if (targets.some((ref) => !criteria[0]!.targetClaimRefs.includes(ref as `claim:${string}`))) return block('THESIS_REVIEW_CANONICAL_KILL_CRITERION_TARGET_MISMATCH')
    if (!/^raw-sha256-[a-f0-9]{64}$/.test(value.rawRef) || !/^source:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.sourceRef) || !/^quote:[A-Za-z0-9_-]+$/.test(value.locator) || value.locator.length > 2048 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(evaluation.asOf) || Number.isNaN(Date.parse(evaluation.asOf)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.publishedAt) || Number.isNaN(Date.parse(value.publishedAt))) return block('THESIS_REVIEW_KILL_CRITERION_VALUE_BINDING_INVALID')
    if (!sourceRawValueBindingMatches(input, value)) return block('THESIS_REVIEW_KILL_CRITERION_CANONICAL_VALUE_MISMATCH')
    const lineage = result.evidenceLineage.filter((item) => item.decision === 'included' && item.evidenceRef === value.evidenceRef && item.sourceBindings.some((pair) => pair.sourceRef === value.sourceRef && pair.rawRef === value.rawRef) && item.targetClaimRefs.includes(value.targetClaimRefs[0]!))
    if (lineage.length !== 1 || targets.some((target) => !lineage[0]!.targetClaimRefs.includes(target)) || lineage[0]!.publishedAt !== value.publishedAt) return block('THESIS_REVIEW_KILL_CRITERION_LINEAGE_MISMATCH')
    for (const target of targets) {
      const matches = input.assets.objects.filter((item) => item.kind === 'claim' && item.value.id === target)
      const memberships = input.assets.objects.filter((item) => {
        if (item.kind !== 'reasoning_edge') return false
        const edge = item.value as KnowledgeAssetV04 & { type?: string; sourceRef?: string; targetRef?: string }
        return edge.type === 'qualifies' && edge.sourceRef === target && edge.targetRef === thesis.id && active(item.value)
      })
      if (matches.length !== 1 || !active(matches[0]!.value) || memberships.length !== 1) return block('THESIS_REVIEW_KILL_CRITERION_TARGET_MEMBERSHIP_INVALID')
    }
    const partial = {
      conditionId: evaluation.conditionId,
      revision: evaluation.revision!,
      definitionHash: evaluation.definitionHash!,
      evidenceRef: value.evidenceRef,
      value: value.value,
      metricRef: value.metricRef,
      unit: value.unit,
      period: value.period,
      sourceRef: value.sourceRef,
      rawRef: value.rawRef,
      locator: value.locator,
      publishedAt: value.publishedAt,
      targetClaimRefs: targets,
      numericValueVersionVerified: true as const,
      asOf: evaluation.asOf,
    }
    const binding: KillCriterionReviewBindingV1 = { ...partial, evaluatedValueIdentity: numericValueIdentity(partial) }
    const key = `${binding.conditionId}\u0000${binding.revision}`
    if (bindingKeys.has(key)) return block('THESIS_REVIEW_KILL_CRITERION_DUPLICATE_EVALUATION')
    bindingKeys.add(key)
    bindings.push(binding)
  }
  bindings.sort((left, right) => left.conditionId.localeCompare(right.conditionId) || left.revision - right.revision)

  const evidenceScopeByRef = new Map<string, { targetClaimRefs: string; sourceRawLocator: string }>()
  for (const binding of bindings) {
    const scope = { targetClaimRefs: JSON.stringify(binding.targetClaimRefs), sourceRawLocator: JSON.stringify([binding.sourceRef, binding.rawRef, binding.locator]) }
    const previous = evidenceScopeByRef.get(binding.evidenceRef)
    if (previous && (previous.targetClaimRefs !== scope.targetClaimRefs || previous.sourceRawLocator !== scope.sourceRawLocator)) return block('THESIS_REVIEW_KILL_CRITERION_EVIDENCE_SCOPE_CONFLICT')
    evidenceScopeByRef.set(binding.evidenceRef, scope)
  }

  const affectedClaimRefs = ordered(bindings.flatMap((binding) => binding.targetClaimRefs))
  if (affectedClaimRefs.length === 0 || affectedClaimRefs.length > 64) return block('THESIS_REVIEW_KILL_CRITERION_TARGET_BINDING_INVALID')
  const claims = new Map<string, KnowledgeClaimV04>()
  for (const ref of affectedClaimRefs) {
    const found = input.assets.objects.filter((item) => item.kind === 'claim' && item.value.id === ref)
    if (found.length !== 1 || !active(found[0]!.value)) return block('THESIS_REVIEW_AFFECTED_CLAIM_UNAVAILABLE')
    const claim = found[0]!.value as KnowledgeClaimV04
    if (!isReviewClaimType(claim.claimType)) return block('THESIS_REVIEW_CLAIM_TYPE_UNSUPPORTED')
    if (!claimSubjectMentions(claim, input.assets)) return block('THESIS_REVIEW_CLAIM_SUBJECT_UNAVAILABLE')
    claims.set(ref, claim)
  }
  const rootClaimRef = affectedClaimRefs[0]!
  const rootClaim = claims.get(rootClaimRef)!
  const subjects = claimSubjectMentions(rootClaim, input.assets)!
  const evidenceRefs = ordered(bindings.map((binding) => binding.evidenceRef))
  const evidenceByRef = new Map<string, ThesisReviewedEvidence>()
  const canonical = new Map<string, CanonicalResearchEvidenceBinding>()
  for (const binding of bindings) {
    const lineage = result.evidenceLineage.find((item) => item.decision === 'included' && item.evidenceRef === binding.evidenceRef && item.sourceBindings.some((pair) => pair.sourceRef === binding.sourceRef && pair.rawRef === binding.rawRef))!
    const key = `${binding.evidenceRef}\u0000${lineage.relation}`
    const previous = evidenceByRef.get(key)
    const reviewed: ThesisReviewedEvidence = { evidenceRef: binding.evidenceRef, relation: lineage.relation, targetClaimRefs: ordered([...(previous?.targetClaimRefs ?? []), ...binding.targetClaimRefs]) }
    evidenceByRef.set(key, reviewed)
    const rootBinding: CanonicalResearchEvidenceBinding = { kind: 'canonical_research_evidence', sourceRef: binding.sourceRef, rawRef: binding.rawRef, evidenceRef: binding.evidenceRef, locator: binding.locator }
    canonical.set(`${rootBinding.sourceRef}\u0000${rootBinding.rawRef}\u0000${rootBinding.evidenceRef}\u0000${rootBinding.locator}`, rootBinding)
  }
  const reviewedEvidence = [...evidenceByRef.values()].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef) || a.relation.localeCompare(b.relation))
  if (reviewedEvidence.length > 64 || canonical.size === 0 || canonical.size > 64) return block('REVIEW_EVIDENCE_BINDING_UNAVAILABLE')
  const killCriterionAssessments: KillCriterionAssessment[] = bindings.map((binding) => ({ conditionId: binding.conditionId, status: 'met', targetPropositionRefs: binding.targetClaimRefs, evidenceRefs: [binding.evidenceRef], rationale: `Canonical evaluator verified ${binding.metricRef}=${binding.value} ${binding.unit} for ${binding.period} against the confirmed criterion revision.` }))
  const identity = { run: input.producerRunId, thesis: thesis.id, transition: 'invalidation_condition_met', asOf: refresh.currentAsOf, killCriterionBindings: bindings }
  const digest = fullHash(identity).slice('sha256:'.length)
  const proposalId = `thesis-claim-${digest}`
  const rationale = `Deterministic canonical kill-criterion evaluation met ${bindings.length} active criterion${bindings.length === 1 ? '' : 's'}; human review is required before invalidating the Thesis.`
  const reviewCase: ReviewCase = {
    version: '0.1', reviewCaseId: `thesis-refresh-${digest}`, knowledgeBaseId: input.knowledgeBaseId, producerType: 'thesis_lifecycle', producerRunId: input.producerRunId, createdAt: input.createdAt,
    classification: { category: 'reconciliation_review', actionability: 'knowledge_decision', origin: 'semantic_case', stage: 'thesis_refresh', rationale },
    rootProposal: { proposalId, proposalKind: 'claim', semanticType: rootClaim.claimType as ReviewClaimType, semanticPayload: { candidateId: proposalId, claimType: rootClaim.claimType as ReviewClaimType, statement: rootClaim.statement, subjectRefs: subjects, ...(rootClaim.structuredValue ? { structuredValue: rootClaim.structuredValue as unknown as Readonly<Record<string, unknown>> } : {}), evidenceBlockRefs: [], reason: rationale }, evidenceBindings: [...canonical.values()], dependencyRefs: [] },
    suspendedProposalBundle: { dependentProposals: [] }, resolutionContext: { existingKnowledgeProjections: [], schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: input.knowledgeBaseRevisionAtCreation }, impact: { dependentProposalCount: 0, affectedProposalRefs: [] },
    thesisScope: { thesisRef: thesis.id, rootClaimRef: rootClaimRef as `claim:${string}`, affectedClaimRefs, evidenceRefs, reviewedEvidence, candidateTransition: 'invalidation_condition_met', asOf: refresh.currentAsOf, proposedThesisStatus: 'invalidated', killCriterionAssessments, killCriterionBindings: bindings },
    state: { status: 'open' },
  }
  try { validateReviewCase(reviewCase) } catch { return block('THESIS_REVIEW_CASE_VALIDATION_FAILED') }
  return { status: 'completed', cases: [reviewCase], diagnostics: [] }
}

function canonicalBindings(evidence: readonly ThesisRefreshEvidenceLineage[]): CanonicalResearchEvidenceBinding[] {
  const values = new Map<string, CanonicalResearchEvidenceBinding>()
  for (const item of evidence) {
    for (const pair of item.sourceBindings) {
      const binding: CanonicalResearchEvidenceBinding = { kind: 'canonical_research_evidence', sourceRef: pair.sourceRef, rawRef: pair.rawRef, evidenceRef: item.evidenceRef }
      values.set(`${binding.sourceRef}\u0000${binding.rawRef}\u0000${binding.evidenceRef}`, binding)
    }
  }
  return [...values.values()].sort((a, b) => `${a.evidenceRef}\u0000${a.sourceRef}\u0000${a.rawRef}`.localeCompare(`${b.evidenceRef}\u0000${b.sourceRef}\u0000${b.rawRef}`))
}

function reviewedEvidence(evidence: readonly ThesisRefreshEvidenceLineage[]): ThesisReviewedEvidence[] {
  const values = new Map<string, ThesisReviewedEvidence>()
  for (const item of evidence) {
    const entry: ThesisReviewedEvidence = { evidenceRef: item.evidenceRef, relation: item.relation, targetClaimRefs: ordered(item.targetClaimRefs) }
    values.set(JSON.stringify(entry), entry)
  }
  return [...values.values()].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef) || a.relation.localeCompare(b.relation))
}

/** Builds validated, Thesis-scoped v0.4 ReviewCases from verified adapter output only. */
export function buildThesisRefreshReviewCases(input: ThesisRefreshReviewCaseBuilderInput): ThesisRefreshReviewCaseBuilderResult {
  const result = input.adapterResult
  if (result.status !== 'completed' || !result.refresh || !result.priorSnapshot) return block('THESIS_REFRESH_RESULT_REQUIRED')
  const thesisItems = input.assets.objects.filter((item) => item.value.id === result.thesisRef)
  if (thesisItems.length !== 1 || thesisItems[0]?.kind !== 'thesis') return block('THESIS_REVIEW_THESIS_UNAVAILABLE')
  const thesis = thesisItems[0]!.value as KnowledgeThesisV04
  if (!active(thesis) || thesis.status === 'archived' || thesis.status === 'invalidated') return block('THESIS_REVIEW_THESIS_INACTIVE')
  if (!thesisIdentityIsValid(thesis, input.assets)) return block('THESIS_REVIEW_THESIS_IDENTITY_UNAVAILABLE')

  const transition = result.refresh.candidateTransition
  if (transition === 'invalidation_condition_met') return buildInvalidationCase(input, thesis)
  const reviewDeltas = result.refresh.propositionDeltas.filter(isReviewDelta).sort((a, b) => a.propositionRef.localeCompare(b.propositionRef))
  const transitionNeedsReview = result.refresh.candidateTransition !== 'unchanged'
  if (!transitionNeedsReview && reviewDeltas.length === 0) return { status: 'completed', cases: [], diagnostics: [] }
  if (reviewDeltas.length === 0) return block('REVIEW_EVIDENCE_BINDING_UNAVAILABLE')
  const proposedThesisStatus = transition === 'weakened' ? 'weakening' : transition === 'possible_invalidation' ? 'challenged' : transition === 'strengthened' ? 'strengthening' : undefined
  const priorClaims = new Map(result.priorSnapshot.propositions.map((item) => [item.propositionId, item]))
  const changedRefs = ordered(reviewDeltas.map((delta) => delta.propositionRef))
  if (changedRefs.length === 0 || changedRefs.length > 64) return block('REVIEW_EVIDENCE_BINDING_UNAVAILABLE')
  const claims = new Map<string, KnowledgeClaimV04>()
  for (const ref of changedRefs) {
    const claimMatches = input.assets.objects.filter((item) => item.value.id === ref)
    if (claimMatches.length !== 1 || claimMatches[0]?.kind !== 'claim') return block('THESIS_REVIEW_AFFECTED_CLAIM_UNAVAILABLE')
    const claim = claimMatches[0].value as KnowledgeClaimV04
    if (!active(claim) || claim.lifecycle.status === 'superseded' || claim.supersededBy?.length) return block('THESIS_REVIEW_AFFECTED_CLAIM_UNAVAILABLE')
    if (!priorClaims.has(ref)) return block('THESIS_REVIEW_AFFECTED_CLAIM_NOT_IN_SNAPSHOT')
    if (!isReviewClaimType(claim.claimType)) return block('THESIS_REVIEW_CLAIM_TYPE_UNSUPPORTED')
    if (!claimSubjectMentions(claim, input.assets)) return block('THESIS_REVIEW_CLAIM_SUBJECT_UNAVAILABLE')
    claims.set(ref, claim)
  }
  const evidence = result.evidenceLineage.filter((item) => item.decision === 'included' && item.targetClaimRefs.some((ref) => changedRefs.includes(ref)))
  if (evidence.length === 0 || reviewDeltas.some((delta) => !evidence.some((item) => item.targetClaimRefs.includes(delta.propositionRef) && item.relation === delta.newEvidenceRelation))) return block('REVIEW_EVIDENCE_BINDING_UNAVAILABLE')
  const evidenceRefs = ordered(evidence.map((item) => item.evidenceRef))
  const bindings = canonicalBindings(evidence)
  if (evidenceRefs.length > 64 || bindings.length === 0 || bindings.length > 64 || evidence.some((item) => item.sourceBindings.length === 0 || !item.sourceBindings.every((pair) => bindings.some((binding) => binding.evidenceRef === item.evidenceRef && binding.sourceRef === pair.sourceRef && binding.rawRef === pair.rawRef)))) return block('REVIEW_EVIDENCE_BINDING_UNAVAILABLE')
  const reviewEvidence = reviewedEvidence(evidence)
  const affectedClaimRefs = ordered([...changedRefs, ...reviewEvidence.flatMap((item) => item.targetClaimRefs)])
  const rootClaimRef = changedRefs[0]!
  const claim = claims.get(rootClaimRef)!
  const subjects = claimSubjectMentions(claim, input.assets)
  if (!subjects) return block('THESIS_REVIEW_CLAIM_SUBJECT_UNAVAILABLE')
  const identity = { run: input.producerRunId, thesis: thesis.id, claims: changedRefs, evidence: evidenceRefs, transition, asOf: result.refresh.currentAsOf }
  const digest = hash(identity)
  const proposalId = `thesis-claim-${digest}`
  const rationale = `Thesis refresh classified ${changedRefs.join(', ')} as ${reviewDeltas.map((delta) => delta.candidateStatus).join(', ')}; human review is required before applying a semantic change.`
  const reviewCase: ReviewCase = {
    version: '0.1',
    reviewCaseId: `thesis-refresh-${digest}`,
    knowledgeBaseId: input.knowledgeBaseId,
    producerType: 'thesis_lifecycle',
    producerRunId: input.producerRunId,
    createdAt: input.createdAt,
    classification: { category: 'reconciliation_review', actionability: 'knowledge_decision', origin: 'semantic_case', stage: 'thesis_refresh', rationale },
    rootProposal: {
      proposalId,
      proposalKind: 'claim',
      semanticType: claim.claimType as ReviewClaimType,
      semanticPayload: {
        candidateId: proposalId,
        claimType: claim.claimType as ReviewClaimType,
        statement: claim.statement,
        subjectRefs: subjects,
        ...(claim.structuredValue ? { structuredValue: claim.structuredValue as unknown as Readonly<Record<string, unknown>> } : {}),
        evidenceBlockRefs: [],
        reason: rationale,
      },
      evidenceBindings: bindings,
      dependencyRefs: [],
    },
    suspendedProposalBundle: { dependentProposals: [] },
    resolutionContext: { existingKnowledgeProjections: [], schemaVersionAtCreation: '0.4', knowledgeBaseRevisionAtCreation: input.knowledgeBaseRevisionAtCreation },
    impact: { dependentProposalCount: 0, affectedProposalRefs: [] },
    thesisScope: {
      thesisRef: thesis.id,
      rootClaimRef: rootClaimRef as `claim:${string}`,
      affectedClaimRefs,
      evidenceRefs,
      reviewedEvidence: reviewEvidence,
      candidateTransition: transition,
      asOf: result.refresh.currentAsOf,
      ...(proposedThesisStatus === undefined ? {} : { proposedThesisStatus }),
    },
    state: { status: 'open' },
  }
  try { validateReviewCase(reviewCase) } catch { return block('THESIS_REVIEW_CASE_VALIDATION_FAILED') }
  return { status: 'completed', cases: [reviewCase], diagnostics: [] }
}
