import { createHash } from 'node:crypto'
import type {
  ExistingKnowledgeProjection,
  ReviewCase,
  ReviewCaseActionability,
  ReviewCaseCategory,
  ReviewEvidenceBinding,
  ReviewProposalKind,
  ReviewRunManifest,
  ReviewSemanticProposal,
} from './contracts.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../schema/executable-schema.ts'
import { KNOWLEDGE_SCHEMA_V04 } from '../schema/executable-schema-v04.ts'
import { REFRESH_EVIDENCE_RELATIONS, REFRESH_TRANSITIONS } from '../../skills/thesis_refresh/contracts.ts'

const TELEMETRY_CATEGORIES = new Set<ReviewCaseCategory>(['invalid_reference', 'invalid_semantics'])
const NON_ACTIONABLE_ORIGINS = new Set(['extraction_rejection', 'consolidation_mirror', 'dependency_isolation'])
const ALLOWED_CATEGORIES = new Set<ReviewCaseCategory>(['invalid_reference', 'invalid_semantics', 'relation_cardinality', 'schema_gap', 'theme_creation', 'theme_ambiguity', 'reconciliation_review', 'other'])
const ALLOWED_ORIGINS = new Set(['extraction_rejection', 'consolidation', 'consolidation_mirror', 'knowledge_resolution', 'semantic_case', 'planner', 'dependency_isolation'])
const ALLOWED_ACTIONABILITIES = new Set<ReviewCaseActionability>(['knowledge_decision', 'research_followup', 'schema_design'])
const KNOWN_ACTIONABILITY: Readonly<Record<string, ReviewCaseActionability>> = {
  relation_cardinality: 'knowledge_decision',
  reconciliation_review: 'knowledge_decision',
  theme_ambiguity: 'knowledge_decision',
  theme_creation: 'research_followup',
  schema_gap: 'schema_design',
}
const MAX_THESIS_SCOPE_REFS = 64
const MAX_RESEARCH_EVIDENCE_LOCATOR_LENGTH = 2048
const MAX_KILL_CRITERION_BINDINGS = 40

export function isSafeReviewPathSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim() !== '' }
function validDateString(value: unknown): value is string { return nonEmptyString(value) && !Number.isNaN(Date.parse(value)) }
function stringArray(value: unknown, label: string, unique = false): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) throw new Error(`${label} must be a non-empty string array`)
  if (unique && new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`)
}
function optionalRecord(value: unknown, label: string): void { if (value !== undefined && value !== null && !isRecord(value)) throw new Error(`${label} must be an object or null`) }
function expectedActionability(category: string): ReviewCaseActionability | undefined { return KNOWN_ACTIONABILITY[category] }
function canonicalRef(value: unknown, kind: ReviewProposalKind, label: string): asserts value is string {
  if (!nonEmptyString(value) || !new RegExp(`^${kind}:[A-Za-z0-9][A-Za-z0-9._-]*$`).test(value)) throw new Error(`${label} must be a canonical ${kind} reference`)
}
function canonicalV04Ref(value: unknown, kind: 'source' | 'thesis' | 'claim' | 'observation', label: string): asserts value is string {
  if (!nonEmptyString(value) || !new RegExp(`^${kind}:[A-Za-z0-9][A-Za-z0-9._-]*$`).test(value)) throw new Error(`${label} must be a canonical ${kind} reference`)
}

function killCriterionValueIdentity(binding: Record<string, unknown>): string {
  const tuple = [binding.conditionId, binding.revision, binding.definitionHash, binding.evidenceRef, binding.value, binding.metricRef, binding.unit, binding.period, binding.sourceRef, binding.rawRef, binding.locator, binding.publishedAt, binding.targetClaimRefs, binding.numericValueVersionVerified, binding.asOf]
  return `sha256:${createHash('sha256').update(JSON.stringify(tuple)).digest('hex')}`
}

export function validateReviewEvidenceBindings(bindings: readonly ReviewEvidenceBinding[], schemaVersion: '0.3' | '0.4' = '0.3'): void {
  const keys = new Set<string>()
  for (const binding of bindings) {
    if (!isRecord(binding)) throw new Error('ReviewCase evidence binding is malformed')
    let key: string
    if (binding.kind === 'raw_document_block' && nonEmptyString(binding.rawRef) && nonEmptyString(binding.documentId) && nonEmptyString(binding.blockId)) {
      key = `${binding.kind}\u0000${binding.rawRef}\u0000${binding.documentId}\u0000${binding.blockId}`
    } else if (binding.kind === 'canonical_research_evidence') {
      if (schemaVersion !== '0.4') throw new Error('Canonical research evidence bindings require Schema 0.4')
      canonicalV04Ref(binding.sourceRef, 'source', 'ReviewCase evidence binding.sourceRef')
      if (typeof binding.rawRef !== 'string' || !/^raw-sha256-[a-f0-9]{64}$/.test(binding.rawRef)) throw new Error('ReviewCase evidence binding.rawRef must be a canonical Raw reference')
      if (binding.evidenceRef !== undefined && (!nonEmptyString(binding.evidenceRef) || !/^(observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(binding.evidenceRef))) throw new Error('ReviewCase evidence binding.evidenceRef must be a canonical Observation or Claim reference')
      if (binding.locator !== undefined && (typeof binding.locator !== 'string' || binding.locator.length > MAX_RESEARCH_EVIDENCE_LOCATOR_LENGTH)) throw new Error(`ReviewCase evidence binding.locator must be at most ${MAX_RESEARCH_EVIDENCE_LOCATOR_LENGTH} characters`)
      key = `${binding.kind}\u0000${binding.sourceRef}\u0000${binding.rawRef}\u0000${binding.evidenceRef ?? ''}\u0000${binding.locator ?? ''}`
    } else throw new Error('ReviewCase evidence binding is not a valid evidence binding variant')
    if (keys.has(key)) throw new Error('Duplicate ReviewCase evidence binding')
    keys.add(key)
  }
}

function validateSemanticPayload(kind: ReviewProposalKind, payload: unknown, semanticType: string, proposalId: string, label: string, schemaVersion: '0.3' | '0.4'): void {
  if (!isRecord(payload) || payload.candidateId !== proposalId || !nonEmptyString(payload.candidateId) || !Array.isArray(payload.evidenceBlockRefs)) throw new Error(`Malformed ReviewCase ${label} semantic payload`)
  stringArray(payload.evidenceBlockRefs, `${label}.semanticPayload.evidenceBlockRefs`, true)
  if (kind === 'entity') {
    if (!nonEmptyString(payload.entityType) || !KNOWLEDGE_SCHEMA_V03.entity.types.includes(payload.entityType as never) || payload.entityType !== semanticType || !nonEmptyString(payload.name)) throw new Error(`ReviewCase ${label} entity payload does not match its semantic kind`)
    if (payload.aliases !== undefined) stringArray(payload.aliases, `${label}.semanticPayload.aliases`)
    return
  }
  if (kind === 'relation') {
    if (!nonEmptyString(payload.relationType) || !KNOWLEDGE_SCHEMA_V03.relation.types.includes(payload.relationType as never) || payload.relationType !== semanticType || !isRecord(payload.source) || !isRecord(payload.target) || !nonEmptyString(payload.source.candidateRef) || !nonEmptyString(payload.source.mention) || !nonEmptyString(payload.target.candidateRef) || !nonEmptyString(payload.target.mention)) throw new Error(`ReviewCase ${label} relation payload does not match its semantic kind`)
    optionalRecord(payload.attributes, `${label}.semanticPayload.attributes`)
    return
  }
  const validClaimType = nonEmptyString(payload.claimType) && (KNOWLEDGE_SCHEMA_V03.claim.types.includes(payload.claimType as never) || (schemaVersion === '0.4' && KNOWLEDGE_SCHEMA_V04.claim.types.includes(payload.claimType as never)))
  if (!validClaimType || payload.claimType !== semanticType || !nonEmptyString(payload.statement) || !Array.isArray(payload.subjectRefs) || payload.subjectRefs.length === 0 || payload.subjectRefs.some((subject) => !isRecord(subject) || !nonEmptyString(subject.candidateRef) || !nonEmptyString(subject.mention))) throw new Error(`ReviewCase ${label} claim payload does not match its semantic kind`)
  optionalRecord(payload.structuredValue, `${label}.semanticPayload.structuredValue`)
}

function validateProposal(value: unknown, label: string, schemaVersion: '0.3' | '0.4', expectedKind?: ReviewProposalKind): asserts value is ReviewSemanticProposal {
  if (!isRecord(value) || !nonEmptyString(value.proposalId) || !isSafeReviewPathSegment(value.proposalId) || (value.proposalKind !== 'entity' && value.proposalKind !== 'relation' && value.proposalKind !== 'claim') || (expectedKind !== undefined && value.proposalKind !== expectedKind) || !nonEmptyString(value.semanticType) || !('semanticPayload' in value) || !Array.isArray(value.evidenceBindings) || !Array.isArray(value.dependencyRefs)) throw new Error(`Malformed ReviewCase ${label}`)
  stringArray(value.dependencyRefs, `${label}.dependencyRefs`, true)
  if (value.dependencyRefs.includes(value.proposalId)) throw new Error(`ReviewCase ${label} cannot depend on itself`)
  validateSemanticPayload(value.proposalKind, value.semanticPayload, value.semanticType, value.proposalId, label, schemaVersion)
  validateReviewEvidenceBindings(value.evidenceBindings as ReviewEvidenceBinding[], schemaVersion)
}

function validateThesisScope(value: unknown, producerType: string, rootProposal: Record<string, unknown>, schemaVersion: '0.3' | '0.4', label: string): void {
  if (value === undefined) return
  if (schemaVersion !== '0.4' || producerType !== 'thesis_lifecycle' || rootProposal.proposalKind !== 'claim') throw new Error(`ReviewCase thesisScope is only valid for a v0.4 thesis_lifecycle Claim-root case: ${label}`)
  if (!isRecord(value)) throw new Error(`Malformed ReviewCase thesisScope: ${label}`)
  canonicalV04Ref(value.thesisRef, 'thesis', `ReviewCase ${label}.thesisScope.thesisRef`)
  canonicalV04Ref(value.rootClaimRef, 'claim', `ReviewCase ${label}.thesisScope.rootClaimRef`)
  const validateBoundedRefs = (refs: unknown, name: 'affectedClaimRefs' | 'evidenceRefs', refPattern: RegExp): void => {
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > MAX_THESIS_SCOPE_REFS || refs.some((ref) => typeof ref !== 'string' || !refPattern.test(ref))) throw new Error(`ReviewCase ${label}.thesisScope.${name} must contain between 1 and ${MAX_THESIS_SCOPE_REFS} canonical references`)
    if (new Set(refs).size !== refs.length) throw new Error(`ReviewCase ${label}.thesisScope.${name} must not contain duplicates`)
  }
  validateBoundedRefs(value.affectedClaimRefs, 'affectedClaimRefs', /^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/)
  if (!(value.affectedClaimRefs as string[]).includes(value.rootClaimRef as string)) throw new Error(`ReviewCase ${label}.thesisScope.rootClaimRef must be listed in affectedClaimRefs`)
  validateBoundedRefs(value.evidenceRefs, 'evidenceRefs', /^(observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*$/)
  if (!Array.isArray(value.reviewedEvidence) || value.reviewedEvidence.length < 1 || value.reviewedEvidence.length > MAX_THESIS_SCOPE_REFS) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence must contain between 1 and ${MAX_THESIS_SCOPE_REFS} entries`)
  const evidenceRefSet = new Set(value.evidenceRefs as string[])
  const affectedClaimRefSet = new Set(value.affectedClaimRefs as string[])
  for (const [index, entry] of value.reviewedEvidence.entries()) {
    if (!isRecord(entry)) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}] is malformed`)
    if (typeof entry.evidenceRef !== 'string' || !/^(observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.evidenceRef) || !evidenceRefSet.has(entry.evidenceRef)) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}].evidenceRef must be listed in evidenceRefs`)
    if (!REFRESH_EVIDENCE_RELATIONS.includes(entry.relation as never)) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}].relation is invalid`)
    if (!Array.isArray(entry.targetClaimRefs) || entry.targetClaimRefs.length < 1 || entry.targetClaimRefs.length > MAX_THESIS_SCOPE_REFS || entry.targetClaimRefs.some((ref) => typeof ref !== 'string' || !/^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}].targetClaimRefs must contain between 1 and ${MAX_THESIS_SCOPE_REFS} canonical Claim references`)
    if (new Set(entry.targetClaimRefs).size !== entry.targetClaimRefs.length) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}].targetClaimRefs must not contain duplicates`)
    if (entry.targetClaimRefs.some((ref) => !affectedClaimRefSet.has(ref))) throw new Error(`ReviewCase ${label}.thesisScope.reviewedEvidence[${index}].targetClaimRefs must be listed in affectedClaimRefs`)
  }
  if (!REFRESH_TRANSITIONS.includes(value.candidateTransition as never)) throw new Error(`ReviewCase ${label}.thesisScope.candidateTransition is invalid`)
  if (!validDateString(value.asOf)) throw new Error(`ReviewCase ${label}.thesisScope.asOf must be an ISO timestamp`)
  if (typeof value.asOf === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.asOf)) throw new Error(`ReviewCase ${label}.thesisScope.asOf must be an ISO timestamp`)
  if (value.proposedThesisStatus !== undefined && !KNOWLEDGE_SCHEMA_V04.thesis.statuses.includes(value.proposedThesisStatus as never)) throw new Error(`ReviewCase ${label}.thesisScope.proposedThesisStatus is invalid`)
  if (value.candidateTransition === 'invalidation_condition_met') {
    if (!Array.isArray(value.killCriterionAssessments) || value.killCriterionAssessments.length < 1 || value.killCriterionAssessments.length > MAX_KILL_CRITERION_BINDINGS) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments must contain between 1 and ${MAX_KILL_CRITERION_BINDINGS} assessments for a kill transition`)
    if (!Array.isArray(value.killCriterionBindings) || value.killCriterionBindings.length < 1 || value.killCriterionBindings.length > MAX_KILL_CRITERION_BINDINGS) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings must contain between 1 and ${MAX_KILL_CRITERION_BINDINGS} bindings for a kill transition`)
    for (const [index, assessment] of value.killCriterionAssessments.entries()) {
      if (!isRecord(assessment) || typeof assessment.conditionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(assessment.conditionId) || assessment.status !== 'met' || typeof assessment.rationale !== 'string' || assessment.rationale.trim() === '') throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments[${index}] is malformed or not met`)
      if (!Array.isArray(assessment.targetPropositionRefs) || assessment.targetPropositionRefs.length < 1 || assessment.targetPropositionRefs.length > MAX_THESIS_SCOPE_REFS || assessment.targetPropositionRefs.some((ref) => typeof ref !== 'string' || !/^(claim):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref) || !affectedClaimRefSet.has(ref))) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments[${index}].targetPropositionRefs must be in affectedClaimRefs`)
      if (!Array.isArray(assessment.evidenceRefs) || assessment.evidenceRefs.length < 1 || assessment.evidenceRefs.length > MAX_THESIS_SCOPE_REFS || assessment.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^(observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref) || !evidenceRefSet.has(ref))) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments[${index}].evidenceRefs must be in evidenceRefs`)
      const scopedEvidence = new Map((value.reviewedEvidence as Record<string, unknown>[]).map((entry) => [entry.evidenceRef as string, entry.targetClaimRefs as string[]]))
      for (const evidenceRef of assessment.evidenceRefs as string[]) {
        const targets = scopedEvidence.get(evidenceRef)
        if (!targets || (assessment.targetPropositionRefs as string[]).some((ref) => !targets.includes(ref))) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments[${index}] does not match reviewed evidence targets`)
      }
    }
    const assessmentByCondition = new Map<string, Record<string, unknown>>()
    for (const assessment of value.killCriterionAssessments as Record<string, unknown>[]) {
      if (assessmentByCondition.has(assessment.conditionId as string)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionAssessments contains duplicate criterion IDs`)
      assessmentByCondition.set(assessment.conditionId as string, assessment)
    }
    const bindingConditionIds = new Set<string>()
    const bindingRevisions = new Set<string>()
    const canonicalBindings = (Array.isArray(rootProposal.evidenceBindings) ? rootProposal.evidenceBindings : []).filter(isRecord).filter((binding) => binding.kind === 'canonical_research_evidence')
    const reviewedByEvidence = new Map((value.reviewedEvidence as Record<string, unknown>[]).map((entry) => [entry.evidenceRef as string, entry.targetClaimRefs as string[]]))
    for (const [index, binding] of value.killCriterionBindings.entries()) {
      if (!isRecord(binding) || typeof binding.conditionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(binding.conditionId) || !Number.isSafeInteger(binding.revision) || (binding.revision as number) < 1 || typeof binding.definitionHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(binding.definitionHash) || typeof binding.evaluatedValueIdentity !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(binding.evaluatedValueIdentity)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] has an invalid criterion identity`)
      if (bindingConditionIds.has(binding.conditionId) || bindingRevisions.has(`${binding.conditionId}\u0000${binding.revision}`)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings contains duplicate criterion IDs or revisions`)
      bindingConditionIds.add(binding.conditionId)
      bindingRevisions.add(`${binding.conditionId}\u0000${binding.revision}`)
      if (typeof binding.value !== 'number' || !Number.isFinite(binding.value) || !nonEmptyString(binding.metricRef) || !nonEmptyString(binding.unit) || !nonEmptyString(binding.period)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] has an invalid numeric value`)
      if (typeof binding.evidenceRef !== 'string' || !evidenceRefSet.has(binding.evidenceRef) || !/^((observation|claim):[A-Za-z0-9][A-Za-z0-9._-]*)$/.test(binding.evidenceRef)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}].evidenceRef must be listed in evidenceRefs`)
      canonicalV04Ref(binding.sourceRef, 'source', `ReviewCase ${label}.thesisScope.killCriterionBindings[${index}].sourceRef`)
      if (typeof binding.rawRef !== 'string' || !/^raw-sha256-[a-f0-9]{64}$/.test(binding.rawRef)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}].rawRef must be a canonical Raw reference`)
      if (typeof binding.locator !== 'string' || binding.locator.length > 2048 || !/^quote:[A-Za-z0-9_-]+$/.test(binding.locator)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}].locator must be an exact quote locator`)
      if (!validDateString(binding.publishedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(binding.publishedAt as string) || !validDateString(binding.asOf) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(binding.asOf as string) || binding.asOf !== value.asOf) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] has invalid publication/asOf timing`)
      if (binding.numericValueVersionVerified !== true) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] lacks numeric value version proof`)
      if (!Array.isArray(binding.targetClaimRefs) || binding.targetClaimRefs.length < 1 || binding.targetClaimRefs.length > MAX_THESIS_SCOPE_REFS || binding.targetClaimRefs.some((ref) => typeof ref !== 'string' || !/^claim:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref) || !affectedClaimRefSet.has(ref)) || new Set(binding.targetClaimRefs).size !== binding.targetClaimRefs.length) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}].targetClaimRefs must be unique affected Claim references`)
      const reviewedTargets = reviewedByEvidence.get(binding.evidenceRef)
      if (!reviewedTargets || (binding.targetClaimRefs as string[]).some((ref) => !reviewedTargets.includes(ref))) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] targets do not match reviewed evidence`)
      const proposalBinding = canonicalBindings.find((item) => item.sourceRef === binding.sourceRef && item.rawRef === binding.rawRef && item.evidenceRef === binding.evidenceRef && item.locator === binding.locator)
      if (!proposalBinding) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] does not match canonical Source/Raw evidence binding`)
      if (killCriterionValueIdentity(binding) !== binding.evaluatedValueIdentity) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] evaluated value identity does not match its value binding`)
      const assessment = assessmentByCondition.get(binding.conditionId)
      if (!assessment || JSON.stringify(assessment.targetPropositionRefs) !== JSON.stringify(binding.targetClaimRefs) || !(assessment.evidenceRefs as string[]).includes(binding.evidenceRef)) throw new Error(`ReviewCase ${label}.thesisScope.killCriterionBindings[${index}] does not match its canonical met assessment`)
    }
    if (assessmentByCondition.size !== bindingConditionIds.size || [...assessmentByCondition.keys()].some((id) => !bindingConditionIds.has(id))) throw new Error(`ReviewCase ${label}.thesisScope kill assessments must derive from canonical criterion bindings`)
    if (value.proposedThesisStatus !== 'invalidated') throw new Error(`ReviewCase ${label}.thesisScope kill transition must propose invalidated Thesis status`)
  } else if (value.killCriterionAssessments !== undefined || value.killCriterionBindings !== undefined) {
    throw new Error(`ReviewCase ${label}.thesisScope kill criterion data is only valid for an invalidation_condition_met transition`)
  }
  const bindings = Array.isArray(rootProposal.evidenceBindings) ? rootProposal.evidenceBindings.filter(isRecord) : []
  const canonicalBindings = bindings.filter((binding) => binding.kind === 'canonical_research_evidence')
  if (canonicalBindings.length === 0) throw new Error(`ReviewCase ${label}.thesisScope requires canonical research evidence binding`)
  for (const evidenceRef of value.evidenceRefs as string[]) {
    if (!canonicalBindings.some((binding) => binding.evidenceRef === evidenceRef)) throw new Error(`ReviewCase ${label}.thesisScope.evidenceRefs must be represented by canonical evidence bindings`)
  }
}

function validateProjection(value: unknown, label: string): asserts value is ExistingKnowledgeProjection {
  if (!isRecord(value) || !nonEmptyString(value.canonicalRef) || (value.kind !== 'entity' && value.kind !== 'relation' && value.kind !== 'claim') || !nonEmptyString(value.semanticType) || !isRecord(value.payload)) throw new Error(`Malformed ReviewCase existing Knowledge projection: ${label}`)
  canonicalRef(value.canonicalRef, value.kind, `${label}.canonicalRef`)
  const payload = value.payload
  if (payload.kind !== value.kind) throw new Error(`ReviewCase existing Knowledge projection kind mismatch: ${label}`)
  if (value.kind === 'entity') {
    if (!nonEmptyString(payload.type) || !KNOWLEDGE_SCHEMA_V03.entity.types.includes(payload.type as never) || value.semanticType !== payload.type || !nonEmptyString(payload.name) || !Array.isArray(payload.aliases) || payload.aliases.some((item: unknown) => !nonEmptyString(item))) throw new Error(`Malformed Entity projection: ${label}`)
    return
  }
  if (value.kind === 'relation') {
    if (!nonEmptyString(payload.type) || !KNOWLEDGE_SCHEMA_V03.relation.types.includes(payload.type as never) || value.semanticType !== payload.type || !nonEmptyString(payload.sourceRef) || !new RegExp('^entity:[A-Za-z0-9][A-Za-z0-9._-]*$').test(payload.sourceRef) || !nonEmptyString(payload.targetRef) || !new RegExp('^entity:[A-Za-z0-9][A-Za-z0-9._-]*$').test(payload.targetRef)) throw new Error(`Malformed Relation projection: ${label}`)
    optionalRecord(payload.attributes, `${label}.payload.attributes`)
    return
  }
  if (!nonEmptyString(payload.claimType) || !KNOWLEDGE_SCHEMA_V03.claim.types.includes(payload.claimType as never) || value.semanticType !== payload.claimType || !nonEmptyString(payload.statement) || !Array.isArray(payload.subjectRefs) || payload.subjectRefs.length === 0 || payload.subjectRefs.some((item: unknown) => !nonEmptyString(item) || !/^(entity|relation):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) throw new Error(`Malformed Claim projection: ${label}`)
  optionalRecord(payload.structuredValue, `${label}.payload.structuredValue`)
}

export function validateReviewCase(value: unknown): asserts value is ReviewCase {
  if (!isRecord(value) || value.version !== '0.1' || !nonEmptyString(value.reviewCaseId) || !isSafeReviewPathSegment(value.reviewCaseId) || !nonEmptyString(value.knowledgeBaseId) || !nonEmptyString(value.producerType) || !nonEmptyString(value.producerRunId) || !isSafeReviewPathSegment(value.producerRunId) || !validDateString(value.createdAt)) throw new Error('Malformed ReviewCase contract')
  if (!isRecord(value.classification) || !nonEmptyString(value.classification.category) || !nonEmptyString(value.classification.actionability) || !nonEmptyString(value.classification.origin) || !nonEmptyString(value.classification.stage) || !nonEmptyString(value.classification.rationale) || !ALLOWED_CATEGORIES.has(value.classification.category as ReviewCaseCategory) || !ALLOWED_ACTIONABILITIES.has(value.classification.actionability as ReviewCaseActionability) || !ALLOWED_ORIGINS.has(value.classification.origin)) throw new Error(`Malformed ReviewCase classification: ${value.reviewCaseId}`)
  const expected = expectedActionability(value.classification.category)
  if (TELEMETRY_CATEGORIES.has(value.classification.category as ReviewCaseCategory) || NON_ACTIONABLE_ORIGINS.has(value.classification.origin) || (expected !== undefined && value.classification.actionability !== expected)) throw new Error(`ReviewCase classification is not actionable or is inconsistent: ${value.reviewCaseId}`)
  if (!isRecord(value.rootProposal)) throw new Error(`Malformed ReviewCase root proposal: ${value.reviewCaseId}`)
  const schemaVersion = isRecord(value.resolutionContext) && value.resolutionContext.schemaVersionAtCreation === '0.4' ? '0.4' : '0.3'
  validateProposal(value.rootProposal, 'rootProposal', schemaVersion)
  if (!isRecord(value.suspendedProposalBundle) || !Array.isArray(value.suspendedProposalBundle.dependentProposals)) throw new Error(`Malformed ReviewCase suspended proposal bundle: ${value.reviewCaseId}`)
  const proposalIds = new Set<string>([value.rootProposal.proposalId])
  for (const [index, proposal] of value.suspendedProposalBundle.dependentProposals.entries()) {
    validateProposal(proposal, `suspendedProposalBundle.dependentProposals[${index}]`, schemaVersion)
    if (proposalIds.has(proposal.proposalId)) throw new Error(`ReviewCase proposal bundle contains duplicate proposal: ${proposal.proposalId}`)
    proposalIds.add(proposal.proposalId)
  }
  if (!isRecord(value.resolutionContext) || !Array.isArray(value.resolutionContext.existingKnowledgeProjections) || !['0.3', '0.4'].includes(String(value.resolutionContext.schemaVersionAtCreation)) || typeof value.resolutionContext.knowledgeBaseRevisionAtCreation !== 'number' || !Number.isSafeInteger(value.resolutionContext.knowledgeBaseRevisionAtCreation) || value.resolutionContext.knowledgeBaseRevisionAtCreation < 0) throw new Error(`Malformed ReviewCase resolution context: ${value.reviewCaseId}`)
  if (value.resolutionContext.existingKnowledgeProjections.length > 8) throw new Error(`ReviewCase existing Knowledge context exceeds the deterministic bound: ${value.reviewCaseId}`)
  const projectionRefs = new Set<string>()
  for (const [index, projection] of value.resolutionContext.existingKnowledgeProjections.entries()) { validateProjection(projection, `existingKnowledgeProjections[${index}]`); if (projectionRefs.has(projection.canonicalRef)) throw new Error(`ReviewCase existing Knowledge projections contain duplicate canonicalRef: ${projection.canonicalRef}`); projectionRefs.add(projection.canonicalRef) }
  if (value.resolutionContext.context !== undefined && (!isRecord(value.resolutionContext.context) || Object.values(value.resolutionContext.context).some((item) => item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean'))) throw new Error(`Malformed ReviewCase context: ${value.reviewCaseId}`)
  if (!isRecord(value.impact) || typeof value.impact.dependentProposalCount !== 'number' || !Number.isSafeInteger(value.impact.dependentProposalCount) || value.impact.dependentProposalCount < 0 || !Array.isArray(value.impact.affectedProposalRefs)) throw new Error(`Malformed ReviewCase impact: ${value.reviewCaseId}`)
  stringArray(value.impact.affectedProposalRefs, `ReviewCase ${value.reviewCaseId}.impact.affectedProposalRefs`, true)
  const bundleIds = value.suspendedProposalBundle.dependentProposals.map((proposal) => proposal.proposalId).sort()
  if (value.impact.dependentProposalCount !== bundleIds.length || JSON.stringify([...value.impact.affectedProposalRefs].sort()) !== JSON.stringify(bundleIds)) throw new Error(`ReviewCase impact is inconsistent with its suspended proposal bundle: ${value.reviewCaseId}`)
  validateThesisScope(value.thesisScope, value.producerType, value.rootProposal, schemaVersion, value.reviewCaseId)
  if (!isRecord(value.state) || value.state.status !== 'open') throw new Error(`ReviewCase is not open: ${value.reviewCaseId}`)
}

export function validateReviewRunManifest(value: unknown): asserts value is ReviewRunManifest {
  if (!isRecord(value) || value.version !== '0.1' || !nonEmptyString(value.knowledgeBaseId) || !nonEmptyString(value.producerType) || !nonEmptyString(value.producerRunId) || !isSafeReviewPathSegment(value.producerRunId) || typeof value.reviewCaseCount !== 'number' || !Number.isSafeInteger(value.reviewCaseCount) || value.reviewCaseCount < 1 || !Array.isArray(value.caseIds) || value.caseIds.some((id) => typeof id !== 'string' || !isSafeReviewPathSegment(id)) || typeof value.deterministicSetHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.deterministicSetHash) || !validDateString(value.createdAt) || !['0.3', '0.4'].includes(String(value.schemaVersionAtCreation)) || typeof value.knowledgeBaseRevisionAtCreation !== 'number' || !Number.isSafeInteger(value.knowledgeBaseRevisionAtCreation) || value.knowledgeBaseRevisionAtCreation < 0) throw new Error('Malformed ReviewCase run manifest')
  if (value.caseIds.length !== value.reviewCaseCount || new Set(value.caseIds).size !== value.caseIds.length || [...value.caseIds].sort().join('\u0000') !== value.caseIds.join('\u0000')) throw new Error('ReviewCase run manifest has duplicate, unsorted, or inconsistent case IDs')
}
