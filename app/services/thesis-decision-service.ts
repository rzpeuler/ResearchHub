import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput, KnowledgeProductionOutcome, SemanticProductionInputProposal } from '../../knowledge/production/contracts.ts'
import { loadReviewCase } from '../../knowledge/review/store.ts'
import { beginApplyingReviewCase, deferReviewCase, finalizeAcceptedReviewCase, loadReviewDecision, markReviewCaseStale, rejectReviewCase, type ReviewDecisionApplyingIntent, type ReviewDecisionSnapshot } from '../../knowledge/review/decision-store.ts'
import type { KillCriterionReviewBindingV1, ReviewCase, ThesisReviewedEvidence } from '../../knowledge/review/contracts.ts'
import { verifyRaw } from '../../knowledge/raw/raw-archive.ts'
import { allocateKnowledgeId } from '../../knowledge/registry/id-allocation.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { CanonicalKnowledgeRefV04, ClaimRefV04, KnowledgeAssetV04, KnowledgeEntityV04, KnowledgeReasoningEdgeV04, KnowledgeSourceV04, KnowledgeThesisV04, ObservationRefV04, ReasoningEdgeTypeV04, SourceRefV04 } from '../../knowledge/schema/domain-v04.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { KnowledgeAssetCollectionV04 } from '../../knowledge/storage/v04-types.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import { runThesisRefreshAdapter, type ThesisRefreshEvidenceBinding } from '../../workflows/thesis-lifecycle/refresh-adapter.ts'

export type ThesisDecision = 'ACCEPT' | 'REJECT' | 'DEFER'
export interface ThesisDecisionCommand { readonly reviewCaseId: string; readonly decision: ThesisDecision; readonly note?: string }
export type ThesisDecisionServiceStatus = 'accepted' | 'rejected' | 'deferred' | 'stale' | 'in_progress' | 'blocked' | 'conflict' | 'failed'
export interface ThesisDecisionServiceResult {
  readonly status: ThesisDecisionServiceStatus
  readonly reviewCaseId: string
  readonly decisionState?: string
  readonly replay?: boolean
  readonly knowledgeBaseRevision?: number
  readonly committedRevision?: number
  readonly writerRunId?: string
  readonly errors: readonly string[]
}
export interface ThesisDecisionServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly gateway?: Pick<KnowledgeProductionGateway, 'submit'>
  readonly now?: () => string
  readonly failpoint?: (phase: 'after_writer') => void | Promise<void>
}

interface SourceRawPair { readonly sourceRef: SourceRefV04; readonly rawRef: `raw-sha256-${string}` }
interface BoundRefreshEvidence extends Omit<ThesisRefreshEvidenceBinding, 'sourceBindings'> { readonly sourceBindings: readonly SourceRawPair[] }
interface ExpectedEdge { readonly id: `reasoning-edge:${string}`; readonly type: ReasoningEdgeTypeV04; readonly sourceRef: ClaimRefV04 | ObservationRefV04; readonly targetRef: ClaimRefV04; readonly sourceRefs: readonly SourceRefV04[]; readonly evidenceBindings: readonly SourceRawPair[] }
interface ExpectedResultChecks { readonly edges: readonly Omit<ExpectedEdge, 'evidenceBindings'>[]; readonly thesis?: { readonly ref: string; readonly status: string } }
interface ValidatedCaseScope {
  readonly handle: KnowledgeBaseHandle
  readonly assets: KnowledgeAssetCollectionV04
  readonly thesis: KnowledgeThesisV04
  readonly rootEntity: KnowledgeEntityV04
  readonly evidenceBindings: readonly BoundRefreshEvidence[]
  readonly expectedEdges: readonly ExpectedEdge[]
  readonly expectedResultChecks: ExpectedResultChecks
}
interface WriterExecutionLog { readonly workflowRunId: string; readonly knowledgeBaseId: string; readonly status: string; readonly writeStatus: string; readonly committedRevision: number; readonly changes?: { readonly createdIds?: readonly string[]; readonly updatedIds?: readonly string[] } }

const MAX_NOTE_LENGTH = 1000
const RAW_PATTERN = /^raw-sha256-[a-f0-9]{64}$/
const refPrefix = (value: unknown, prefix: string): value is string => typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length && !/[\s/\\]/.test(value)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const active = (value: KnowledgeAssetV04): boolean => 'lifecycle' in value && value.lifecycle?.status === 'active'
const safeRunId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
const edgeTypeFor = (relation: ThesisReviewedEvidence['relation']): ReasoningEdgeTypeV04 | undefined => relation === 'supports' ? 'supports' : relation === 'weakens' ? 'challenges' : relation === 'contradicts' ? 'contradicts' : undefined
const ordered = (items: readonly string[]): string[] => [...new Set(items)].sort((left, right) => left.localeCompare(right))
const activeAt = (asset: KnowledgeAssetV04, at: string): boolean => active(asset) && (!('lifecycle' in asset) || (asset.lifecycle?.validFrom == null || Date.parse(asset.lifecycle.validFrom) <= Date.parse(at)) && (asset.lifecycle?.validUntil == null || Date.parse(asset.lifecycle.validUntil) > Date.parse(at)))
const sourceEligible = (source: KnowledgeSourceV04, at: string): boolean => activeAt(source, at) && Number.isFinite(Date.parse(at)) && ['public', 'authenticated'].includes(source.rights.accessScope) && source.rights.retentionAllowed === true && source.rights.aiProcessingAllowed === true && source.rights.derivativeKnowledgeAllowed === true && source.usagePolicy?.retainRaw === true && source.usagePolicy.allowAiProcessing === true && source.usagePolicy.allowDerivedKnowledge === true && (source.rights.expiresAt == null || Date.parse(source.rights.expiresAt) > Date.parse(at))
const hasSourceProvenance = (asset: KnowledgeAssetV04, pair: SourceRawPair): boolean => {
  const value = asset as unknown as Record<string, unknown>
  if (asset.id.startsWith('observation:') && value.sourceRef !== pair.sourceRef) return false
  if (asset.id.startsWith('claim:') && (!Array.isArray(value.sourceRefs) || !value.sourceRefs.includes(pair.sourceRef))) return false
  return Array.isArray(value.provenance) && value.provenance.some((item) => record(item) && item.sourceRef === pair.sourceRef && item.rawRef === pair.rawRef)
}
function outcome(status: ThesisDecisionServiceStatus, reviewCaseId: string, fields: Partial<ThesisDecisionServiceResult> = {}): ThesisDecisionServiceResult { return { status, reviewCaseId, errors: [], ...fields } }
function decisionHash(reviewCaseId: string, note?: string): string { return hashKnowledgeObject({ reviewCaseId, decision: 'ACCEPT', note: note ?? null }) }
function deterministicWriterRunId(reviewCaseId: string, payloadHash: string): string { return `writer-thesis-${createHash('sha256').update(`${reviewCaseId}|${payloadHash}`).digest('hex').slice(0, 24)}` }
function exactScopeEqual(left: unknown, right: unknown): boolean { return hashKnowledgeObject(left) === hashKnowledgeObject(right) }
function requiredCaseIdentity(reviewCase: ReviewCase, handle: KnowledgeBaseHandle): string | undefined {
  if (reviewCase.producerType !== 'thesis_lifecycle' || reviewCase.resolutionContext.schemaVersionAtCreation !== '0.4' || !reviewCase.thesisScope) return 'THESIS_REVIEW_CASE_SCOPE_REQUIRED'
  if (reviewCase.knowledgeBaseId !== handle.knowledgeBaseId) return 'THESIS_REVIEW_CASE_KNOWLEDGE_BASE_MISMATCH'
  if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') return 'THESIS_DECISION_KNOWLEDGE_BASE_NOT_WRITABLE'
  return undefined
}
function extractionBindings(reviewCase: ReviewCase, allowContext: boolean): { readonly values?: readonly BoundRefreshEvidence[]; readonly diagnostic?: string } {
  const scope = reviewCase.thesisScope!
  const byEvidence = new Map<string, SourceRawPair[]>()
  for (const binding of reviewCase.rootProposal.evidenceBindings) {
    if (binding.kind !== 'canonical_research_evidence' || !binding.evidenceRef) return { diagnostic: 'REVIEW_EVIDENCE_BINDING_UNAVAILABLE' }
    if (!scope.evidenceRefs.includes(binding.evidenceRef)) return { diagnostic: 'REVIEW_EVIDENCE_BINDING_OUT_OF_SCOPE' }
    if (!refPrefix(binding.sourceRef, 'source:') || !RAW_PATTERN.test(binding.rawRef)) return { diagnostic: 'REVIEW_EVIDENCE_BINDING_INVALID' }
    const pairs = byEvidence.get(binding.evidenceRef) ?? []
    pairs.push({ sourceRef: binding.sourceRef as `source:${string}`, rawRef: binding.rawRef as `raw-sha256-${string}` })
    byEvidence.set(binding.evidenceRef, pairs)
  }
  const values: BoundRefreshEvidence[] = []
  for (const item of scope.reviewedEvidence) {
    const sourceBindings = [...new Map<string, SourceRawPair>((byEvidence.get(item.evidenceRef) ?? []).map((pair) => [`${pair.sourceRef}|${pair.rawRef}`, pair])).values()].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef) || left.rawRef.localeCompare(right.rawRef))
    if (!sourceBindings.length) return { diagnostic: 'REVIEW_EVIDENCE_BINDING_UNAVAILABLE' }
    values.push({ evidenceRef: item.evidenceRef, relation: item.relation, targetClaimRefs: [...item.targetClaimRefs], sourceBindings })
  }
  if (values.length === 0 || (!allowContext && values.some((item) => item.relation === 'context' || item.relation === 'irrelevant'))) return { diagnostic: 'THESIS_DECISION_RELATION_UNSUPPORTED' }
  return { values }
}

function killCriterionValueIdentity(binding: KillCriterionReviewBindingV1): string {
  const value = [binding.conditionId, binding.revision, binding.definitionHash, binding.evidenceRef, binding.value, binding.metricRef, binding.unit, binding.period, binding.sourceRef, binding.rawRef, binding.locator, binding.publishedAt, [...binding.targetClaimRefs], binding.numericValueVersionVerified, binding.asOf]
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
function rootEntityFor(thesis: KnowledgeThesisV04, assets: KnowledgeAssetCollectionV04): (KnowledgeEntityV04 & { readonly type: KnowledgeProductionInput['entity']['entityType'] }) | undefined {
  if (thesis.subjectRefs.length !== 1) return undefined
  const loaded = assets.objects.find((item) => item.kind === 'entity' && item.value.id === thesis.subjectRefs[0])
  if (!loaded) return undefined
  const entity = loaded.value as KnowledgeEntityV04
  if (!active(entity) || !entity.name?.trim() || entity.type === 'investment_theme') return undefined
  if (entity.type === 'company' && (typeof entity.ticker !== 'string' || entity.ticker.trim() === '')) return undefined
  return entity as KnowledgeEntityV04 & { readonly type: KnowledgeProductionInput['entity']['entityType'] }
}
function edgeDrafts(bindings: readonly BoundRefreshEvidence[]): ExpectedEdge[] {
  const grouped = new Map<string, { type: ReasoningEdgeTypeV04; sourceRef: ClaimRefV04 | ObservationRefV04; targetRef: ClaimRefV04; sourceRefs: Set<SourceRefV04>; evidenceBindings: Map<string, SourceRawPair> }>()
  for (const binding of bindings) {
    const type = edgeTypeFor(binding.relation)
    if (!type) throw new Error('THESIS_DECISION_RELATION_UNSUPPORTED')
    for (const targetRef of binding.targetClaimRefs) {
      const key = `${type}|${binding.evidenceRef}|${targetRef}`
      const draft = grouped.get(key) ?? { type, sourceRef: binding.evidenceRef as ClaimRefV04 | ObservationRefV04, targetRef: targetRef as ClaimRefV04, sourceRefs: new Set<SourceRefV04>(), evidenceBindings: new Map<string, SourceRawPair>() }
      for (const pair of binding.sourceBindings) { draft.sourceRefs.add(pair.sourceRef); draft.evidenceBindings.set(`${pair.sourceRef}|${pair.rawRef}`, pair) }
      grouped.set(key, draft)
    }
  }
  return [...grouped.values()].map((draft) => {
    const id = allocateKnowledgeId('reasoning-edge', { type: draft.type, sourceRef: draft.sourceRef, targetRef: draft.targetRef }) as `reasoning-edge:${string}`
    return { id, type: draft.type, sourceRef: draft.sourceRef, targetRef: draft.targetRef, sourceRefs: ordered([...draft.sourceRefs]) as SourceRefV04[], evidenceBindings: [...draft.evidenceBindings.values()].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef) || a.rawRef.localeCompare(b.rawRef)) }
  }).sort((left, right) => left.id.localeCompare(right.id))
}
function expectedChecks(edges: readonly ExpectedEdge[], thesisRef: string, thesisStatus?: string): ExpectedResultChecks {
  return { edges: edges.map(({ id, type, sourceRef, targetRef, sourceRefs }) => ({ id, type, sourceRef, targetRef, sourceRefs })), ...(thesisStatus ? { thesis: { ref: thesisRef, status: thesisStatus } } : {}) }
}
function expectedEdgesAbsent(assets: KnowledgeAssetCollectionV04, edges: readonly ExpectedEdge[]): boolean { const ids = new Set(assets.objects.map((item) => item.value.id)); return edges.every((edge) => !ids.has(edge.id)) }
function actualChecksSatisfied(assets: KnowledgeAssetCollectionV04, checks: ExpectedResultChecks): boolean {
  for (const expected of checks.edges) {
    const matches = assets.objects.filter((item) => item.kind === 'reasoning_edge' && item.value.id === expected.id)
    if (matches.length !== 1) return false
    const edge = matches[0]!.value as KnowledgeReasoningEdgeV04
    if (!active(edge) || edge.type !== expected.type || edge.sourceRef !== expected.sourceRef || edge.targetRef !== expected.targetRef || !exactScopeEqual(ordered(edge.sourceRefs ?? []), ordered(expected.sourceRefs))) return false
  }
  if (checks.thesis) {
    const matches = assets.objects.filter((item) => item.kind === 'thesis' && item.value.id === checks.thesis!.ref)
    if (matches.length !== 1 || (matches[0]!.value as KnowledgeThesisV04).status !== checks.thesis.status) return false
  }
  return true
}
function gatewayProposals(scope: ValidatedCaseScope): SemanticProductionInputProposal[] {
  const edgeProposals: SemanticProductionInputProposal[] = scope.expectedEdges.map((edge, index) => ({
    proposalId: `review-edge-${index + 1}`,
    kind: 'reasoning_edge',
    edgeType: edge.type,
    existingSourceRef: edge.sourceRef as CanonicalKnowledgeRefV04,
    existingTargetRef: edge.targetRef as CanonicalKnowledgeRefV04,
    existingEvidenceBindings: edge.evidenceBindings,
  } as SemanticProductionInputProposal))
  const thesisStatus = scope.expectedResultChecks.thesis?.status
  if (!thesisStatus) return edgeProposals
  return [...edgeProposals, { proposalId: 'review-thesis-status', kind: 'thesis', subjectKey: 'thesis-subject', thesisTitle: scope.thesis.title, thesisStatus: thesisStatus as KnowledgeThesisV04['status'], statement: scope.thesis.statement }]
}

async function loadWriterLog(rootRef: string, writerRunId: string): Promise<WriterExecutionLog | undefined> {
  if (!safeRunId(writerRunId)) throw new Error('Unsafe deterministic Writer run ID')
  const root = resolve(rootRef)
  const directories = [join(root, 'logs'), join(root, 'logs', 'research')]
  const path = join(directories[1]!, `${writerRunId}.yaml`)
  try {
    for (const directory of directories) {
      const stat = await lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Thesis decision Writer log directory is unsafe')
    }
    const fileStat = await lstat(path)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error('Thesis decision Writer log is unsafe')
    const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(path)])
    const relativeFile = relative(rootReal, fileReal)
    if (!relativeFile || relativeFile.split(/[\\/]/).includes('..') || isAbsolute(relativeFile)) throw new Error('Thesis decision Writer log escapes the Knowledge Base')
    const value = parseYaml(await readFile(path, 'utf8'), path)
    if (!record(value) || value.workflowRunId !== writerRunId || typeof value.knowledgeBaseId !== 'string' || typeof value.status !== 'string' || typeof value.writeStatus !== 'string' || !Number.isSafeInteger(value.committedRevision)) throw new Error('Malformed Thesis decision Writer log')
    return value as unknown as WriterExecutionLog
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export class ThesisDecisionService {
  private readonly gateway: Pick<KnowledgeProductionGateway, 'submit'>
  private readonly now: () => string
  constructor(private readonly options: ThesisDecisionServiceOptions) { this.gateway = options.gateway ?? new KnowledgeProductionGateway(); this.now = options.now ?? (() => new Date().toISOString()) }

  private async current(reviewCase: ReviewCase): Promise<{ readonly scope?: ValidatedCaseScope; readonly diagnostic?: string }> {
    const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
    const identityError = requiredCaseIdentity(reviewCase, handle)
    if (identityError) return { diagnostic: identityError }
    let assets: KnowledgeAssetCollectionV04
    try { assets = await readCanonicalV04Assets(handle.rootRef) } catch { return { diagnostic: 'THESIS_DECISION_CANONICAL_ASSETS_UNAVAILABLE' } }
    const scope = reviewCase.thesisScope!
    if (!Number.isSafeInteger(handle.revision) || handle.revision < reviewCase.resolutionContext.knowledgeBaseRevisionAtCreation) return { diagnostic: 'THESIS_DECISION_REVISION_INVALID' }
    const invalidation = scope.candidateTransition === 'invalidation_condition_met'
    if (invalidation) {
      if (scope.proposedThesisStatus !== 'invalidated') return { diagnostic: 'THESIS_DECISION_STATUS_TRANSITION_UNSUPPORTED' }
      if (handle.revision !== reviewCase.resolutionContext.knowledgeBaseRevisionAtCreation) return { diagnostic: 'THESIS_DECISION_BASE_KNOWLEDGE_REVISION_STALE' }
      if (!Array.isArray(scope.killCriterionBindings) || scope.killCriterionBindings.length === 0) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_CANONICAL_BINDING_UNAVAILABLE' }
    } else {
      if ((scope.candidateTransition === 'possible_invalidation') !== (scope.proposedThesisStatus === 'challenged')) return { diagnostic: 'THESIS_DECISION_STATUS_TRANSITION_UNSUPPORTED' }
      if (scope.proposedThesisStatus === 'invalidated' || scope.proposedThesisStatus === 'archived' || scope.proposedThesisStatus === 'active') return { diagnostic: 'THESIS_DECISION_STATUS_TRANSITION_UNSUPPORTED' }
    }
    const thesisMatches = assets.objects.filter((item) => item.kind === 'thesis' && item.value.id === scope.thesisRef)
    if (thesisMatches.length !== 1) return { diagnostic: 'THESIS_DECISION_THESIS_MISSING_OR_AMBIGUOUS' }
    const thesis = thesisMatches[0]!.value as KnowledgeThesisV04
    if (!active(thesis) || thesis.status === 'invalidated' || thesis.status === 'archived') return { diagnostic: 'THESIS_DECISION_THESIS_INACTIVE' }
    const entity = rootEntityFor(thesis, assets)
    if (!entity) return { diagnostic: 'THESIS_DECISION_THESIS_SUBJECT_UNSUPPORTED' }
    const claims = new Map<string, KnowledgeAssetV04>(assets.objects.filter((item) => item.kind === 'claim').map((item) => [item.value.id, item.value]))
    const membershipEdges = assets.objects.filter((item) => item.kind === 'reasoning_edge').map((item) => item.value as KnowledgeReasoningEdgeV04).filter((edge) => edge.type === 'qualifies' && edge.targetRef === thesis.id && active(edge))
    const memberRefs: ReadonlySet<string> = new Set<string>(membershipEdges.map((edge) => edge.sourceRef))
    const affected = ordered(scope.affectedClaimRefs)
    if (affected.length !== scope.affectedClaimRefs.length || affected.length === 0 || affected.some((ref) => !refPrefix(ref, 'claim:') || !memberRefs.has(ref) || !claims.has(ref) || !active(claims.get(ref)!))) return { diagnostic: 'THESIS_DECISION_QUALIFIES_MEMBERSHIP_STALE' }
    const rootPayload = reviewCase.rootProposal.semanticPayload as unknown as Record<string, unknown>
    const rootSubjects = Array.isArray(rootPayload.subjectRefs) ? rootPayload.subjectRefs.map((item) => record(item) ? item.candidateRef : undefined) : []
    const rootClaim = claims.get(scope.rootClaimRef)
    if (!rootClaim || !affected.includes(scope.rootClaimRef) || !memberRefs.has(scope.rootClaimRef) || !active(rootClaim) || !rootClaim.id.startsWith('claim:') || (rootClaim as { claimType: string }).claimType !== reviewCase.rootProposal.semanticType || (rootClaim as { claimType: string }).claimType !== rootPayload.claimType || (rootClaim as { statement: string }).statement !== rootPayload.statement || !exactScopeEqual(ordered((rootClaim as { subjectRefs: readonly string[] }).subjectRefs), ordered(rootSubjects.filter((ref): ref is string => typeof ref === 'string')))) return { diagnostic: 'THESIS_DECISION_ROOT_CLAIM_REBIND_FAILED' }

    const extracted = extractionBindings(reviewCase, invalidation)
    if (!extracted.values) return { diagnostic: extracted.diagnostic }
    const asOf = scope.asOf
    const sourceAssets = new Map<string, KnowledgeSourceV04>(assets.objects.filter((item) => item.kind === 'source').map((item) => [item.value.id, item.value as KnowledgeSourceV04]))
    for (const binding of extracted.values) for (const pair of binding.sourceBindings) {
      const source = sourceAssets.get(pair.sourceRef)
      if (!source || !sourceEligible(source, this.now()) || !source.rawRefs?.includes(pair.rawRef)) return { diagnostic: 'THESIS_DECISION_SOURCE_RAW_BINDING_STALE' }
      const evidence = assets.objects.find((item) => item.value.id === binding.evidenceRef)?.value
      if (!evidence || !hasSourceProvenance(evidence, pair)) return { diagnostic: 'THESIS_DECISION_EVIDENCE_PROVENANCE_STALE' }
      try { await verifyRaw(handle, pair.rawRef) } catch { return { diagnostic: 'THESIS_DECISION_RAW_UNAVAILABLE' } }
    }
    if (invalidation) {
      const activeCriteria = Array.isArray(thesis.killCriteria) ? thesis.killCriteria.filter((criterion) => criterion.state === 'active') : []
      const reviewedBindings = scope.killCriterionBindings!
      const bindingIds = new Set<string>()
      for (const binding of reviewedBindings) {
        const key = `${binding.conditionId}\u0000${binding.revision}`
        if (bindingIds.has(key) || killCriterionValueIdentity(binding) !== binding.evaluatedValueIdentity) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_BINDING_INVALID' }
        bindingIds.add(key)
        const matching = activeCriteria.filter((criterion) => criterion.conditionId === binding.conditionId && criterion.revision === binding.revision)
        if (matching.length !== 1 || matching[0]!.definitionHash !== binding.definitionHash || binding.targetClaimRefs.some((ref) => !matching[0]!.targetClaimRefs.includes(ref as ClaimRefV04))) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_BINDING_STALE' }
      }
      // The evaluator checks source-derived origin eligibility at the reviewed
      // asOf. Recheck the origin's rights and archived bytes at decision time too.
      for (const criterion of activeCriteria) {
        const origin = criterion.authority?.origin
        if (origin?.kind !== 'source_derived') continue
        const source = sourceAssets.get(origin.sourceRef)
        if (!source || !sourceEligible(source, this.now()) || !source.rawRefs?.includes(origin.rawRef)) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_ORIGIN_RIGHTS_STALE' }
        try { await verifyRaw(handle, origin.rawRef) } catch { return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_ORIGIN_RAW_UNAVAILABLE' } }
      }
    }
    const adapter = await runThesisRefreshAdapter({ assets, handle, thesisRef: thesis.id, currentAsOf: asOf, evidenceBindings: extracted.values })
    if (adapter.status !== 'completed' || !adapter.refresh || adapter.refresh.candidateTransition !== scope.candidateTransition) return { diagnostic: 'THESIS_DECISION_REFRESH_SCOPE_CHANGED' }
    const included = adapter.evidenceLineage.filter((item) => item.decision === 'included').map(({ evidenceRef, relation, targetClaimRefs }) => ({ evidenceRef, relation, targetClaimRefs: ordered(targetClaimRefs) })).sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef) || a.relation.localeCompare(b.relation))
    const reviewed = scope.reviewedEvidence.map(({ evidenceRef, relation, targetClaimRefs }) => ({ evidenceRef, relation, targetClaimRefs: ordered(targetClaimRefs) })).sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef) || a.relation.localeCompare(b.relation))
    if (adapter.evidenceLineage.some((item) => item.decision !== 'included') || !exactScopeEqual(included, reviewed) || !exactScopeEqual(ordered(scope.affectedClaimRefs), ordered(scope.reviewedEvidence.flatMap((item) => item.targetClaimRefs)))) return { diagnostic: 'THESIS_DECISION_REVIEWED_EVIDENCE_SCOPE_CHANGED' }
    if (invalidation) {
      const bindings = scope.killCriterionBindings!
      const evaluations = adapter.criterionEvaluations.filter((evaluation) => evaluation.status === 'met')
      const evaluationIds = new Set(evaluations.map((evaluation) => `${evaluation.conditionId}\u0000${evaluation.revision}`))
      if (evaluationIds.size !== bindings.length || bindings.some((binding) => !evaluationIds.has(`${binding.conditionId}\u0000${binding.revision}`))) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_ASSESSMENT_CHANGED' }
      for (const binding of bindings) {
        const evaluation = evaluations.find((item) => item.conditionId === binding.conditionId && item.revision === binding.revision)
        const value = evaluation?.evaluatedValue
        if (!evaluation || evaluation.definitionHash !== binding.definitionHash || evaluation.asOf !== binding.asOf || !value || value.numericValueVersionVerified !== true) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_ASSESSMENT_CHANGED' }
        const rebound = { conditionId: evaluation.conditionId, revision: evaluation.revision!, definitionHash: evaluation.definitionHash!, evaluatedValueIdentity: '', evidenceRef: value.evidenceRef, value: value.value, metricRef: value.metricRef, unit: value.unit, period: value.period, sourceRef: value.sourceRef, rawRef: value.rawRef, locator: value.locator, publishedAt: value.publishedAt, targetClaimRefs: value.targetClaimRefs, numericValueVersionVerified: value.numericValueVersionVerified, asOf: evaluation.asOf } as KillCriterionReviewBindingV1
        if (killCriterionValueIdentity(rebound) !== binding.evaluatedValueIdentity) return { diagnostic: 'THESIS_DECISION_KILL_CRITERION_BINDING_CHANGED' }
      }
    }
    const edgeBindings = invalidation ? extracted.values.filter((item) => item.relation !== 'context' && item.relation !== 'irrelevant') : extracted.values
    const expectedEdges = edgeDrafts(edgeBindings)
    if (scope.proposedThesisStatus && allocateKnowledgeId('thesis', { subjectRefs: thesis.subjectRefs, title: thesis.title }) !== thesis.id) return { diagnostic: 'THESIS_DECISION_THESIS_IDENTITY_UNSTABLE' }
    const thesisStatus = scope.proposedThesisStatus
    const checks = expectedChecks(expectedEdges, thesis.id, thesisStatus)
    return { scope: { handle, assets, thesis, rootEntity: entity, evidenceBindings: extracted.values, expectedEdges, expectedResultChecks: checks } }
  }

  private async markStale(reviewCase: ReviewCase, snapshot: ReviewDecisionSnapshot, diagnostic: string): Promise<ThesisDecisionServiceResult> {
    if (!['OPEN', 'DEFERRED', 'APPLYING'].includes(snapshot.state)) return outcome('conflict', reviewCase.reviewCaseId, { decisionState: snapshot.state, errors: [diagnostic] })
    const stored = await markReviewCaseStale(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), note: diagnostic.slice(0, MAX_NOTE_LENGTH) })
    return outcome(stored.kind === 'conflict' ? 'conflict' : 'stale', reviewCase.reviewCaseId, { decisionState: stored.snapshot.state, replay: stored.kind === 'replay', errors: [diagnostic], knowledgeBaseRevision: snapshot.case.resolutionContext.knowledgeBaseRevisionAtCreation })
  }

  private command(scope: ValidatedCaseScope, reviewCase: ReviewCase, intent: ReviewDecisionApplyingIntent, at: string): KnowledgeProductionInput {
    const entity = scope.rootEntity
    const proposals = gatewayProposals(scope)
    return {
      handle: scope.handle,
      producerType: 'thesis_lifecycle',
      reviewProducerType: 'thesis_lifecycle',
      producerRunId: intent.writerRunId,
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: {
        localKey: 'thesis-subject',
      entityType: entity.type as KnowledgeProductionInput['entity']['entityType'],
        name: entity.name,
        aliases: [],
        existingEntityRef: entity.id,
        ...(entity.type === 'company' ? { semanticFields: { ticker: entity.ticker, exchange: entity.exchange } } : {}),
      },
      proposals: proposals.map((proposal) => proposal.kind === 'reasoning_edge' ? { ...proposal, asOf: reviewCase.thesisScope!.asOf } : proposal),
      evidenceBindings: [],
      asOf: reviewCase.thesisScope!.asOf,
      now: () => at,
    }
  }

  private async verifyCurrentResult(checks: ExpectedResultChecks): Promise<{ readonly ok: boolean; readonly revision: number }> {
    const handle = await new KnowledgeBaseRegistry().mount(this.options.mountedKnowledgeBaseRoot)
    const assets = await readCanonicalV04Assets(handle.rootRef)
    return { ok: actualChecksSatisfied(assets, checks), revision: handle.revision }
  }

  private async reconcileApplying(reviewCase: ReviewCase, snapshot: ReviewDecisionSnapshot): Promise<ThesisDecisionServiceResult> {
    const event = snapshot.record?.events.at(-1)
    const intent = event?.applyingIntent
    if (snapshot.state !== 'APPLYING' || !intent || intent.caseHash !== snapshot.caseHash) return outcome('conflict', reviewCase.reviewCaseId, { decisionState: snapshot.state, errors: ['THESIS_DECISION_APPLYING_INTENT_INVALID'] })
    const log = await loadWriterLog(this.options.mountedKnowledgeBaseRoot, intent.writerRunId)
    const state = await this.verifyCurrentResult(intent.expectedResultChecks as unknown as ExpectedResultChecks)
    if (log) {
      if (log.workflowRunId !== intent.writerRunId || log.knowledgeBaseId !== reviewCase.knowledgeBaseId || log.status !== 'completed' || !['committed', 'no_changes'].includes(log.writeStatus) || !Number.isSafeInteger(log.committedRevision) || !state.ok || state.revision < log.committedRevision) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_WRITER_LOG_RESULT_MISMATCH')
      const finalized = await finalizeAcceptedReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), payloadHash: intent.payloadHash, writerRunId: intent.writerRunId, committedRevision: log.committedRevision, expectedResultChecks: intent.expectedResultChecks })
      return outcome(finalized.kind === 'conflict' ? 'conflict' : 'accepted', reviewCase.reviewCaseId, { decisionState: finalized.snapshot.state, replay: finalized.kind === 'replay', knowledgeBaseRevision: state.revision, committedRevision: log.committedRevision, writerRunId: intent.writerRunId })
    }
    const current = await this.current(reviewCase)
    if (!current.scope) return this.markStale(reviewCase, snapshot, current.diagnostic ?? 'THESIS_DECISION_REBIND_FAILED')
    if (!exactScopeEqual(intent.expectedResultChecks, current.scope.expectedResultChecks)) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_EXPECTED_RESULT_CHANGED')
    if (current.scope.handle.revision !== intent.baseKnowledgeRevision || !expectedEdgesAbsent(current.scope.assets, current.scope.expectedEdges)) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_APPLYING_BASE_REVISION_CHANGED')
    return this.executeGateway(reviewCase, snapshot, current.scope, intent, event!.at)
  }

  private async executeGateway(reviewCase: ReviewCase, snapshot: ReviewDecisionSnapshot, scope: ValidatedCaseScope, intent: ReviewDecisionApplyingIntent, at: string): Promise<ThesisDecisionServiceResult> {
    let written: KnowledgeProductionOutcome
    try { written = await this.gateway.submit(this.command(scope, reviewCase, intent, at)) }
    catch (error) { return outcome('failed', reviewCase.reviewCaseId, { decisionState: 'APPLYING', knowledgeBaseRevision: scope.handle.revision, writerRunId: intent.writerRunId, errors: [error instanceof Error ? error.message : String(error)] }) }
    await this.options.failpoint?.('after_writer')
    const log = await loadWriterLog(this.options.mountedKnowledgeBaseRoot, intent.writerRunId)
    const current = await this.verifyCurrentResult(scope.expectedResultChecks)
    if (!log && written.status === 'no_changes' && current.ok && current.revision === intent.baseKnowledgeRevision) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_EXPECTED_EDGES_ALREADY_PRESENT')
    if (['blocked', 'failed'].includes(written.status) && !log) return outcome('failed', reviewCase.reviewCaseId, { decisionState: 'APPLYING', knowledgeBaseRevision: current.revision, writerRunId: intent.writerRunId, errors: written.errors })
    if (!log || log.knowledgeBaseId !== reviewCase.knowledgeBaseId || log.status !== 'completed' || !['committed', 'no_changes'].includes(log.writeStatus) || !current.ok || current.revision < log.committedRevision) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_WRITER_RESULT_VERIFICATION_FAILED')
    const finalized = await finalizeAcceptedReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), payloadHash: intent.payloadHash, writerRunId: intent.writerRunId, committedRevision: log.committedRevision, expectedResultChecks: intent.expectedResultChecks })
    if (finalized.kind === 'conflict') return outcome('conflict', reviewCase.reviewCaseId, { decisionState: finalized.snapshot.state, writerRunId: intent.writerRunId, errors: [finalized.message ?? 'ReviewDecision changed while Writer completed'] })
    return outcome('accepted', reviewCase.reviewCaseId, { decisionState: finalized.snapshot.state, replay: finalized.kind === 'replay', knowledgeBaseRevision: scope.handle.revision, committedRevision: log.committedRevision, writerRunId: intent.writerRunId })
  }

  async decide(input: ThesisDecisionCommand): Promise<ThesisDecisionServiceResult> {
    if (!record(input) || Object.keys(input).some((key) => !['reviewCaseId', 'decision', 'note'].includes(key)) || typeof input.reviewCaseId !== 'string' || !input.reviewCaseId.trim() || !['ACCEPT', 'REJECT', 'DEFER'].includes(input.decision) || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > MAX_NOTE_LENGTH))) return outcome('blocked', typeof input?.reviewCaseId === 'string' ? input.reviewCaseId : '', { errors: ['THESIS_DECISION_INPUT_INVALID'] })
    const reviewCase = await loadReviewCase(this.options.mountedKnowledgeBaseRoot, input.reviewCaseId)
    if (!reviewCase) return outcome('blocked', input.reviewCaseId, { errors: ['THESIS_REVIEW_CASE_NOT_FOUND'] })
    if (reviewCase.producerType !== 'thesis_lifecycle' || !reviewCase.thesisScope) return outcome('blocked', input.reviewCaseId, { errors: ['THESIS_REVIEW_CASE_REQUIRED'] })
    const snapshot = await loadReviewDecision(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId)
    if (!snapshot) return outcome('blocked', input.reviewCaseId, { errors: ['THESIS_REVIEW_CASE_NOT_FOUND'] })
    if (snapshot.state === 'REJECTED' && input.decision === 'REJECT') {
      const replay = await rejectReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), note: input.note })
      return outcome(replay.kind === 'conflict' ? 'conflict' : 'rejected', input.reviewCaseId, { decisionState: replay.snapshot.state, replay: replay.kind === 'replay', ...(replay.message ? { errors: [replay.message] } : {}) })
    }
    if (snapshot.state === 'DEFERRED' && input.decision === 'DEFER') {
      const replay = await deferReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), note: input.note })
      return outcome(replay.kind === 'conflict' ? 'conflict' : 'deferred', input.reviewCaseId, { decisionState: replay.snapshot.state, replay: replay.kind === 'replay', ...(replay.message ? { errors: [replay.message] } : {}) })
    }
    if (snapshot.state === 'APPLYING') {
      const intent = snapshot.record?.events.at(-1)?.applyingIntent
      if (input.decision !== 'ACCEPT') return outcome('in_progress', input.reviewCaseId, { decisionState: snapshot.state, writerRunId: intent?.writerRunId })
      if (!intent || intent.payloadHash !== decisionHash(input.reviewCaseId, input.note)) return outcome('conflict', input.reviewCaseId, { decisionState: snapshot.state, writerRunId: intent?.writerRunId, errors: ['THESIS_DECISION_APPLYING_PAYLOAD_CONFLICT'] })
      return this.reconcileApplying(reviewCase, snapshot)
    }
    if (snapshot.state === 'ACCEPTED') {
      const payloadHash = decisionHash(input.reviewCaseId, input.note)
      const last = snapshot.record?.events.at(-1)
      const checks = last?.expectedResultChecks as ExpectedResultChecks | undefined
      const writerRunId = last?.writerRunId
      const log = writerRunId ? await loadWriterLog(this.options.mountedKnowledgeBaseRoot, writerRunId) : undefined
      const verified = checks ? await this.verifyCurrentResult(checks) : { ok: false, revision: -1 }
      const identical = input.decision === 'ACCEPT' && last?.payloadHash === payloadHash && checks && writerRunId === deterministicWriterRunId(reviewCase.reviewCaseId, payloadHash) && log?.workflowRunId === writerRunId && log.knowledgeBaseId === reviewCase.knowledgeBaseId && log.status === 'completed' && ['committed', 'no_changes'].includes(log.writeStatus) && Number.isSafeInteger(log.committedRevision) && last.committedRevision === log.committedRevision && verified.ok && verified.revision >= log.committedRevision
      if (identical) return outcome('accepted', input.reviewCaseId, { decisionState: snapshot.state, replay: true, knowledgeBaseRevision: verified.revision, committedRevision: log!.committedRevision, writerRunId })
      return outcome('conflict', input.reviewCaseId, { decisionState: snapshot.state, errors: ['THESIS_DECISION_TERMINAL_CONFLICT'] })
    }
    if (['REJECTED', 'STALE'].includes(snapshot.state)) return outcome('conflict', input.reviewCaseId, { decisionState: snapshot.state, errors: ['THESIS_DECISION_TERMINAL_CONFLICT'] })
    const current = await this.current(reviewCase)
    if (!current.scope) return this.markStale(reviewCase, snapshot, current.diagnostic ?? 'THESIS_DECISION_REBIND_FAILED')
    if (input.decision === 'DEFER') {
      const stored = await deferReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), note: input.note })
      return outcome(stored.kind === 'conflict' ? 'conflict' : 'deferred', input.reviewCaseId, { decisionState: stored.snapshot.state, replay: stored.kind === 'replay', knowledgeBaseRevision: current.scope.handle.revision, ...(stored.message ? { errors: [stored.message] } : {}) })
    }
    if (input.decision === 'REJECT') {
      const stored = await rejectReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at: this.now(), note: input.note })
      return outcome(stored.kind === 'conflict' ? 'conflict' : 'rejected', input.reviewCaseId, { decisionState: stored.snapshot.state, replay: stored.kind === 'replay', knowledgeBaseRevision: current.scope.handle.revision, ...(stored.message ? { errors: [stored.message] } : {}) })
    }
    const payloadHash = decisionHash(input.reviewCaseId, input.note)
    if (!['OPEN', 'DEFERRED'].includes(snapshot.state)) return outcome('conflict', input.reviewCaseId, { decisionState: snapshot.state, errors: ['THESIS_DECISION_TERMINAL_CONFLICT'] })
    if (!expectedEdgesAbsent(current.scope.assets, current.scope.expectedEdges)) return this.markStale(reviewCase, snapshot, 'THESIS_DECISION_EXPECTED_EDGES_ALREADY_PRESENT')
    const at = this.now()
    const writerRunId = deterministicWriterRunId(reviewCase.reviewCaseId, payloadHash)
    const intent = await beginApplyingReviewCase(this.options.mountedKnowledgeBaseRoot, reviewCase.producerRunId, reviewCase.reviewCaseId, { expectedHash: snapshot.hash, expectedRevision: snapshot.revision, at, note: input.note, payloadHash, baseKnowledgeRevision: current.scope.handle.revision, writerRunId, expectedResultChecks: { ...current.scope.expectedResultChecks } })
    if (intent.kind === 'conflict') return outcome('conflict', input.reviewCaseId, { decisionState: intent.snapshot.state, errors: [intent.message ?? 'ReviewDecision changed before ACCEPT'] })
    if (intent.kind === 'replay' && intent.snapshot.state === 'APPLYING') return outcome('in_progress', input.reviewCaseId, { decisionState: intent.snapshot.state, writerRunId })
    return this.executeGateway(reviewCase, intent.snapshot, current.scope, intent.snapshot.record!.events.at(-1)!.applyingIntent!, at)
  }
}
