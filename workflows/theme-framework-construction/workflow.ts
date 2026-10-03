import {
  executeThemeFramework,
} from '../../skills/theme-framework/semantic.ts'
import { THEME_SCOPE_V04_LIMITS } from '../../knowledge/governance/theme-scope-v04.ts'
import {
  THEME_FRAMEWORK_BOUNDS,
  THEME_FRAMEWORK_RECOMMENDATIONS,
  validateThemeFrameworkInput,
  type ThemeFrameworkIndustryCandidate,
  type ThemeFrameworkRelationCandidate,
} from '../../skills/theme-framework/contracts.ts'
import {
  THEME_FRAMEWORK_CONSTRUCTION_LIMITS,
  type ThemeFrameworkDurableEvidenceBinding,
  type ThemeFrameworkConstructionPorts,
  type ThemeFrameworkConstructionRequest,
  type ThemeFrameworkConstructionResult,
  type ThemeFrameworkDecision,
  type ThemeFrameworkKnowledgeSnapshot,
  type ThemeFrameworkReviewCandidate,
  type ThemeFrameworkReviewRequest,
  type ThemeFrameworkReviewResult,
} from './contracts.ts'

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

function cancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

function diagnostic(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/[\r\n]+/gu, ' ').slice(0, 240)
}

function validDurableBinding(value: ThemeFrameworkDurableEvidenceBinding): boolean {
  return typeof value.evidenceId === 'string'
    && value.evidenceId.length <= 80
    && /^source:[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/u.test(value.sourceRef)
    && /^raw-sha256-[a-f0-9]{64}$/u.test(value.rawRef)
    && (value.locator === undefined || (typeof value.locator === 'string' && value.locator.length > 0 && value.locator.length <= 2048))
}

function evidenceIdentity(value: ThemeFrameworkKnowledgeSnapshot['evidence'][number]): string {
  return JSON.stringify({
    evidenceId: value.evidenceId,
    origin: value.origin,
    description: value.description,
    sourceRef: value.sourceRef,
    publishedAt: value.publishedAt ?? null,
    excerpt: value.excerpt ?? null,
  })
}

function mergeEvidence(
  groups: readonly (readonly ThemeFrameworkKnowledgeSnapshot['evidence'][number][])[],
): readonly ThemeFrameworkKnowledgeSnapshot['evidence'][number][] | string {
  const byId = new Map<string, ThemeFrameworkKnowledgeSnapshot['evidence'][number]>()
  for (const group of groups) {
    for (const item of group) {
      if (!item || typeof item.evidenceId !== 'string' || item.evidenceId.length === 0) return 'theme_framework_evidence_invalid'
      const previous = byId.get(item.evidenceId)
      if (previous && evidenceIdentity(previous) !== evidenceIdentity(item)) return `theme_framework_evidence_identity_conflict:${item.evidenceId.slice(0, 80)}`
      if (!previous) byId.set(item.evidenceId, item)
    }
  }
  return [...byId.values()]
}

function mergeDurableBindings(
  groups: readonly (readonly ThemeFrameworkDurableEvidenceBinding[] | undefined)[],
): readonly ThemeFrameworkDurableEvidenceBinding[] | string {
  const byId = new Map<string, ThemeFrameworkDurableEvidenceBinding>()
  for (const group of groups) {
    for (const binding of group ?? []) {
      if (!binding || !validDurableBinding(binding)) return 'theme_framework_durable_evidence_binding_invalid'
      const previous = byId.get(binding.evidenceId)
      if (previous && (previous.sourceRef !== binding.sourceRef || previous.rawRef !== binding.rawRef || (previous.locator !== undefined && binding.locator !== undefined && previous.locator !== binding.locator))) {
        return `theme_framework_durable_evidence_identity_conflict:${binding.evidenceId.slice(0, 80)}`
      }
      if (!previous || (previous.locator === undefined && binding.locator !== undefined)) byId.set(binding.evidenceId, binding)
    }
  }
  return [...byId.values()]
}

function allCandidates(framework: ThemeFrameworkReviewCandidate['framework']): readonly (ThemeFrameworkIndustryCandidate | ThemeFrameworkRelationCandidate)[] {
  return [...framework.industryCandidates, ...framework.relationCandidates]
}

export async function runThemeFrameworkConstruction(
  request: ThemeFrameworkConstructionRequest,
  ports: ThemeFrameworkConstructionPorts,
): Promise<ThemeFrameworkConstructionResult> {
  const themeName = request.themeName.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!SAFE_RUN_ID.test(request.workflowRunId) || !themeName || themeName.length > 300) {
    return { status: 'blocked', diagnostics: ['theme_framework_request_invalid'] }
  }
  if (request.definition !== undefined && (!request.definition.trim() || request.definition.length > 2000)) {
    return { status: 'blocked', diagnostics: ['theme_framework_definition_invalid'] }
  }
  if (cancelled(request.signal)) return { status: 'cancelled', diagnostics: ['workflow_cancelled'] }

  let snapshot: Awaited<ReturnType<ThemeFrameworkConstructionPorts['readKnowledgeSnapshot']>>
  try {
    // Knowledge is always read before external acquisition.
    snapshot = await ports.readKnowledgeSnapshot(themeName)
  } catch (error) {
    return { status: 'failed', diagnostics: [`knowledge_snapshot_unavailable:${diagnostic(error)}`] }
  }
  if (snapshot.existingThemeRef) {
    return { status: 'blocked', diagnostics: ['theme_already_exists:use_framework_update_workflow'] }
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !snapshot.knowledgeBaseId) {
    return { status: 'failed', diagnostics: ['knowledge_snapshot_identity_invalid'] }
  }
  if (cancelled(request.signal)) return { status: 'cancelled', diagnostics: ['workflow_cancelled'] }

  let acquisition: NonNullable<ThemeFrameworkReviewCandidate['acquisitionStatus']> = 'unavailable'
  const diagnostics: string[] = []
  let acquiredEvidence: ThemeFrameworkKnowledgeSnapshot['evidence'][number][] = []
  let acquiredBindings: ThemeFrameworkDurableEvidenceBinding[] = []
  if (!ports.acquisition) {
    diagnostics.push('external_acquisition_unavailable:not_configured')
  } else {
    try {
      const result = await ports.acquisition.acquire({
        themeName,
        ...(request.definition ? { definition: request.definition } : {}),
        maxSources: THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxSources,
        knowledgeBaseId: snapshot.knowledgeBaseId,
        knowledgeBaseRevision: snapshot.revision,
        ...(request.signal ? { signal: request.signal } : {}),
      })
      acquisition = result.status
      diagnostics.push(...(result.diagnostics ?? []).slice(0, 16))
      if (result.status !== 'unavailable') {
        if (!Array.isArray(result.evidence)) return { status: 'failed', diagnostics: ['theme_framework_acquisition_evidence_invalid'] }
        acquiredEvidence = [...result.evidence.slice(0, THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxSources)]
        if (result.evidence.length > acquiredEvidence.length) diagnostics.push(`external_evidence_truncated:${result.evidence.length}:${acquiredEvidence.length}`)
        acquiredBindings = [...(result.durableEvidenceBindings ?? [])]
      } else {
        diagnostics.push(`external_acquisition_unavailable:${result.reason.slice(0, 160)}`)
      }
    } catch (error) {
      if (cancelled(request.signal)) return { status: 'cancelled', diagnostics: ['workflow_cancelled'] }
      diagnostics.push(`external_acquisition_unavailable:${diagnostic(error)}`)
    }
  }
  if (cancelled(request.signal)) return { status: 'cancelled', diagnostics: ['workflow_cancelled'] }

  // Acquisition may persist eligible Source/Raw evidence through Writer. Refresh
  // the canonical snapshot after acquisition so the review candidate is bound to
  // the revision that contains those durable records.
  let latestSnapshot: Awaited<ReturnType<ThemeFrameworkConstructionPorts['readKnowledgeSnapshot']>>
  try {
    latestSnapshot = await ports.readKnowledgeSnapshot(themeName)
  } catch (error) {
    return { status: 'failed', diagnostics: [`knowledge_snapshot_refresh_unavailable:${diagnostic(error)}`] }
  }
  if (latestSnapshot.knowledgeBaseId !== snapshot.knowledgeBaseId) {
    return { status: 'failed', diagnostics: ['knowledge_snapshot_identity_changed_during_acquisition'] }
  }
  if (!Number.isSafeInteger(latestSnapshot.revision) || latestSnapshot.revision < snapshot.revision) {
    return { status: 'failed', diagnostics: ['knowledge_snapshot_revision_invalid_after_acquisition'] }
  }
  if (latestSnapshot.existingThemeRef) {
    return { status: 'blocked', diagnostics: ['theme_already_exists:use_framework_update_workflow'] }
  }

  const mergedEvidence = mergeEvidence([snapshot.evidence, latestSnapshot.evidence, acquiredEvidence])
  if (typeof mergedEvidence === 'string') return { status: 'failed', diagnostics: [mergedEvidence] }
  const evidence = mergedEvidence.slice(0, THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxEvidence)
  if (mergedEvidence.length > evidence.length) diagnostics.push(`theme_framework_evidence_truncated:${mergedEvidence.length}:${evidence.length}`)
  const mergedBindings = mergeDurableBindings([
    snapshot.durableEvidenceBindings,
    latestSnapshot.durableEvidenceBindings,
    acquiredBindings,
  ])
  if (typeof mergedBindings === 'string') return { status: 'failed', diagnostics: [mergedBindings] }
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId))
  const durableEvidenceBindings = mergedBindings.filter((binding) => evidenceIds.has(binding.evidenceId))
  if (durableEvidenceBindings.length !== mergedBindings.length) diagnostics.push('durable_bindings_without_candidate_evidence_ignored')
  const industries = latestSnapshot.industries.slice(0, THEME_FRAMEWORK_BOUNDS.maxIndustries)
  if (latestSnapshot.industries.length > industries.length) diagnostics.push(`knowledge_industries_truncated:${latestSnapshot.industries.length}:${industries.length}`)

  const skillInput = {
    theme: { name: themeName, ...(request.definition ? { definition: request.definition } : {}) },
    existingKnowledge: { summary: latestSnapshot.summary.slice(0, THEME_FRAMEWORK_BOUNDS.maxSummary), industries },
    evidence: evidence.slice(0, THEME_FRAMEWORK_BOUNDS.maxEvidence),
    priorDecisions: latestSnapshot.priorDecisions.slice(0, THEME_FRAMEWORK_BOUNDS.maxPriorDecisions),
  }
  try {
    validateThemeFrameworkInput(skillInput)
  } catch (error) {
    return { status: 'failed', diagnostics: [`theme_framework_input_invalid:${diagnostic(error)}`] }
  }
  const result = await executeThemeFramework(skillInput, ports.reasoningExecutor)
  if (result.status !== 'complete') return { status: 'blocked', diagnostics: result.diagnostics }
  const candidate: ThemeFrameworkReviewCandidate = {
    workflowRunId: request.workflowRunId,
    knowledgeBaseId: latestSnapshot.knowledgeBaseId,
    basedOnRevision: latestSnapshot.revision,
    theme: { name: themeName, ...(request.definition ? { definition: request.definition } : {}) },
    framework: result.result,
    durableEvidenceBindings: durableEvidenceBindings.filter((binding) => evidence.some((item) => item.evidenceId === binding.evidenceId)).slice(0, THEME_FRAMEWORK_CONSTRUCTION_LIMITS.maxEvidence),
    acquisitionStatus: acquisition,
    diagnostics: diagnostics.slice(0, 32),
  }
  return { status: 'awaiting_review', candidate }
}

function decisionsForReview(request: ThemeFrameworkReviewRequest): readonly ThemeFrameworkDecision[] | string {
  const candidates = allCandidates(request.candidate.framework)
  const overrides = request.decisions ?? {}
  const rationales = request.decisionRationales ?? {}
  const ids = new Set(candidates.map((candidate) => candidate.candidateId))
  if (Object.keys(overrides).some((id) => !ids.has(id))) return 'review_contains_unknown_candidate'
  if (Object.values(overrides).some((value) => !THEME_FRAMEWORK_RECOMMENDATIONS.includes(value))) return 'review_decision_invalid'
  if (Object.keys(rationales).some((id) => !ids.has(id))) return 'review_contains_unknown_candidate'
  for (const candidate of candidates) {
    const decision = overrides[candidate.candidateId] ?? candidate.recommendation
    const rationale = rationales[candidate.candidateId]
    if (decision !== candidate.recommendation) {
      if (typeof rationale !== 'string' || rationale.trim().length === 0 || rationale.length > THEME_SCOPE_V04_LIMITS.maxRationaleLength) return 'review_decision_override_requires_rationale'
    } else if (rationale !== undefined) {
      return 'review_rationale_without_decision_override'
    }
  }
  const durableBindings = new Map(request.candidate.durableEvidenceBindings.map((binding) => [binding.evidenceId, binding]))
  const decisions: ThemeFrameworkDecision[] = candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    kind: 'independentlyResearchableRationale' in candidate ? 'industry' : 'relation',
    decision: overrides[candidate.candidateId] ?? candidate.recommendation,
    rationale: rationales[candidate.candidateId] ?? candidate.boundaryRationale,
    // Only already retained, integrity-verified Source/Raw evidence can be
    // bound to an A4 human-confirmed scope decision. Acquired-but-unpersisted
    // material remains visible to Chat but cannot justify canonical inclusion.
    evidenceRefs: candidate.evidenceRefs.filter((ref) => durableBindings.has(ref)),
    evidenceBindings: candidate.evidenceRefs.flatMap((ref) => {
      const binding = durableBindings.get(ref)
      return binding ? [binding] : []
    }),
    coverageGaps: candidate.coverageGaps,
  }))
  const decisionByCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision.decision]))
  for (const relation of request.candidate.framework.relationCandidates) {
    if (decisionByCandidate.get(relation.candidateId) !== 'include') continue
    const source = request.candidate.framework.industryCandidates.find((item => item.candidateId === relation.sourceIndustryRef || item.existingIndustryRef === relation.sourceIndustryRef))
    const target = request.candidate.framework.industryCandidates.find((item => item.candidateId === relation.targetIndustryRef || item.existingIndustryRef === relation.targetIndustryRef))
    if (!source || !target || decisionByCandidate.get(source.candidateId) !== 'include' || decisionByCandidate.get(target.candidateId) !== 'include') {
      return 'included_relation_requires_included_endpoints'
    }
  }
  return decisions
}

export async function reviewThemeFrameworkConstruction(
  request: ThemeFrameworkReviewRequest,
  commit?: ThemeFrameworkConstructionPorts['commit'],
): Promise<ThemeFrameworkReviewResult> {
  const workflowRunId = request.candidate.workflowRunId
  if (request.disposition === 'reject') return { status: 'rejected', workflowRunId }
  if (!commit) return { status: 'blocked', workflowRunId, diagnostics: ['theme_framework_atomic_commit_unavailable'] }
  const decisions = decisionsForReview(request)
  if (typeof decisions === 'string') return { status: 'blocked', workflowRunId, diagnostics: [decisions] }
  if (decisions.some((item) => item.decision === 'include' && item.evidenceBindings.length === 0)) {
    return { status: 'blocked', workflowRunId, diagnostics: ['included_scope_decision_requires_persisted_source_raw_evidence'] }
  }
  let result: Awaited<ReturnType<NonNullable<ThemeFrameworkConstructionPorts['commit']>['commitThemeFrameworkAtomically']>>
  try {
    result = await commit.commitThemeFrameworkAtomically({
      workflowRunId,
      knowledgeBaseId: request.candidate.knowledgeBaseId,
      expectedBaseRevision: request.candidate.basedOnRevision,
      theme: request.candidate.theme,
      framework: request.candidate.framework,
      decisions,
    })
  } catch (error) {
    return { status: 'failed', workflowRunId, diagnostics: [`theme_framework_atomic_commit_failed:${diagnostic(error)}`] }
  }
  if (result.status === 'committed' || result.status === 'already_committed') {
    if (!result.themeRef || !Number.isSafeInteger(result.committedRevision)) {
      return { status: 'failed', workflowRunId, diagnostics: ['theme_framework_commit_receipt_invalid'] }
    }
    return {
      status: result.status,
      workflowRunId,
      themeRef: result.themeRef,
      committedRevision: result.committedRevision!,
      decisions,
    }
  }
  return {
    status: result.status,
    workflowRunId,
    diagnostics: (result.errors ?? [`theme_framework_commit_${result.status}`]).slice(0, 16),
  }
}
