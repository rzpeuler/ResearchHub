import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { allocateKnowledgeId } from '../registry/id-allocation.ts'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import type { KnowledgeAssetV04, KnowledgeEntityV04, KnowledgeIndustryV04, KnowledgeRelationV04, KnowledgeSourceV04 } from '../schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import { parseYaml } from '../storage/yaml.ts'
import { readThemeScopeLedgerV04 } from '../governance/theme-scope-ledger-v04.ts'
import {
  createThemeScopeDecisionV04,
  fingerprintThemeScopeCandidateV04,
  validateThemeScopeDecisionBatchV04,
  THEME_SCOPE_V04_LIMITS,
  type ThemeScopeCandidateV04,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionV04,
  type ThemeScopeEvidenceV04,
} from '../governance/theme-scope-v04.ts'
import { validateKnowledgeChangeSetV04 } from '../validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../writer/writer.ts'
import type { ThemeScopeImpactCandidate } from '../../workflows/theme-scope-impact-check/workflow.ts'

/** Structural projection of an inbox proposal. The application service must re-read it from its bounded inbox before calling this port. */
export interface ThemeScopeImpactProposalForAcceptanceV04 {
  readonly proposalId: string
  readonly themeRef: string
  readonly candidate: ThemeScopeImpactCandidate['candidate']
  readonly candidateFingerprint: string
  readonly changeKind: ThemeScopeImpactCandidate['changeKind']
  readonly priorDecision?: ThemeScopeImpactCandidate['priorDecision']
  readonly rationale: string
  readonly evidenceRefs: readonly string[]
  readonly changedRefs: readonly string[]
  readonly basedOnRevision: number
}

export interface ThemeScopeImpactAcceptanceInputV04 {
  readonly handle: KnowledgeBaseHandle
  readonly proposal: ThemeScopeImpactProposalForAcceptanceV04
  readonly decision: 'include' | 'exclude' | 'pending'
  readonly rationale?: string
  readonly expectedBaseRevision: number
  readonly workflowRunId: string
  /** Internal endpoint selections made in the same atomic inbox decision. */
  readonly finalIndustryDecisions?: ReadonlyMap<string, { readonly decision: 'include' | 'exclude' | 'pending'; readonly canonicalRef?: string }>
  /** Internal planner mode; the combined batch is validated before the real Writer call. */
  readonly batchPlanning?: boolean
}

export interface ThemeScopeImpactAcceptanceBatchItemV04 {
  readonly proposal: ThemeScopeImpactProposalForAcceptanceV04
  readonly decision: 'include' | 'exclude' | 'pending'
  readonly rationale?: string
}

export interface ThemeScopeImpactAcceptanceBatchInputV04 {
  readonly handle: KnowledgeBaseHandle
  readonly items: readonly ThemeScopeImpactAcceptanceBatchItemV04[]
  readonly expectedBaseRevision: number
  readonly workflowRunId: string
}

export interface ThemeScopeImpactAcceptanceBatchResultV04 {
  readonly status: 'committed' | 'already_committed' | 'blocked' | 'conflict' | 'failed'
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly committedRevision: number
  readonly workflowRunId: string
  readonly changeSetId?: string
  readonly decisions: readonly { readonly proposalId: string; readonly candidateFingerprint: string; readonly decision: 'include' | 'exclude' | 'pending'; readonly decisionId: string }[]
  readonly errors: readonly string[]
}

export interface ThemeScopeImpactAcceptanceResultV04 {
  readonly status: 'committed' | 'already_committed' | 'blocked' | 'conflict' | 'failed'
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly committedRevision: number
  readonly themeRef: string
  readonly proposalId: string
  readonly candidateFingerprint: string
  readonly decision?: ThemeScopeDecisionV04['decision']
  readonly decisionId?: ThemeScopeDecisionV04['id']
  readonly writerRunId: string
  readonly changeSetId?: string
  readonly errors: readonly string[]
}

export interface ThemeScopeImpactAcceptanceOptionsV04 {
  readonly registry?: KnowledgeBaseRegistry
  readonly clock?: () => string
  readonly writer?: typeof writeKnowledgeBase
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SAFE_PROPOSAL_ID = /^theme-scope-impact:[a-f0-9]{40}$/u
const SAFE_REF = /^(entity|relation|claim|observation|event|source|module|thesis|reasoning-edge|theme-group):[A-Za-z0-9][A-Za-z0-9._-]*$/u
const RAW_REF = /^raw-sha256-[a-f0-9]{64}$/u
const ACTIVE = (value: { readonly lifecycle?: { readonly status?: string } }): boolean => value.lifecycle?.status === 'active'
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort()
const branchKey = (fingerprint: string): string => `branch-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 16)}`
const evidenceKey = (item: ThemeScopeEvidenceV04): string => `${item.sourceRef}\u0000${item.rawRef}\u0000${item.locator}`

function sourceAllowsThemeEvidence(source: KnowledgeSourceV04, now: number): boolean {
  const rights = source.rights
  const policy = source.usagePolicy
  const expiry = rights.expiresAt == null ? undefined : Date.parse(rights.expiresAt)
  return ACTIVE(source)
    && (rights.accessScope === 'public' || rights.accessScope === 'authenticated')
    && rights.retentionAllowed === true
    && rights.aiProcessingAllowed === true
    && rights.derivativeKnowledgeAllowed === true
    && (expiry === undefined || Number.isFinite(expiry) && expiry > now)
    && policy.mode === 'personal_noncommercial_research'
    && policy.retainRaw && policy.allowAiProcessing && policy.allowDerivedKnowledge
}

function evidenceSourcesForRef(ref: string, objects: ReadonlyMap<string, KnowledgeAssetV04>): string[] {
  const result = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)
    const value = objects.get(id) as (KnowledgeAssetV04 & { sourceRefs?: readonly string[]; sourceRef?: string; provenance?: readonly { sourceRef?: string }[]; supportingClaimRefs?: readonly string[] }) | undefined
    if (!value) return
    if (id.startsWith('source:')) result.add(id)
    for (const sourceRef of value.sourceRefs ?? []) if (sourceRef.startsWith('source:')) result.add(sourceRef)
    if (typeof value.sourceRef === 'string' && value.sourceRef.startsWith('source:')) result.add(value.sourceRef)
    for (const provenance of value.provenance ?? []) if (typeof provenance.sourceRef === 'string' && provenance.sourceRef.startsWith('source:')) result.add(provenance.sourceRef)
    for (const claimRef of value.supportingClaimRefs ?? []) visit(claimRef)
  }
  visit(ref)
  return [...result].sort()
}

function failure(input: ThemeScopeImpactAcceptanceInputV04, status: 'blocked' | 'conflict' | 'failed', message: string, changeSetId?: string): ThemeScopeImpactAcceptanceResultV04 {
  return {
    status,
    knowledgeBaseId: input.handle.knowledgeBaseId,
    baseRevision: input.expectedBaseRevision,
    committedRevision: input.handle.revision,
    themeRef: input.proposal.themeRef,
    proposalId: input.proposal.proposalId,
    candidateFingerprint: input.proposal.candidateFingerprint,
    writerRunId: input.workflowRunId,
    ...(changeSetId ? { changeSetId } : {}),
    errors: [message],
  }
}

function sameDecisionProjection(decision: ThemeScopeDecisionV04): unknown {
  return {
    candidateFingerprint: decision.candidateFingerprint,
    decision: decision.decision,
    rationale: decision.rationale,
    evidence: [...decision.evidence].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b))),
    reopenBasis: decision.reopenBasis ? { rationale: decision.reopenBasis.rationale, evidence: [...decision.reopenBasis.evidence].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b))) } : null,
    basedOnRevision: decision.basedOnRevision,
    affectedBranchKeys: [...decision.affectedBranchKeys].sort(),
  }
}

/** Executes one reviewed impact proposal as an A4 decision plus any Theme exposure change in one Writer transaction. */
export class ThemeScopeImpactAcceptanceV04 {
  private readonly registry: KnowledgeBaseRegistry
  private readonly clock: () => string
  private readonly writer: typeof writeKnowledgeBase

  constructor(options: ThemeScopeImpactAcceptanceOptionsV04 = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.writer = options.writer ?? writeKnowledgeBase
  }

  async execute(input: ThemeScopeImpactAcceptanceInputV04): Promise<ThemeScopeImpactAcceptanceResultV04> {
    const { proposal } = input
    if (!input.handle || input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1' || !input.handle.writable || input.handle.status !== 'active') return failure(input, 'blocked', 'Impact decision requires an active writable Schema 0.4 Knowledge Base.')
    if (!SAFE_RUN_ID.test(input.workflowRunId) || input.workflowRunId.includes('..') || !SAFE_PROPOSAL_ID.test(proposal.proposalId)) return failure(input, 'blocked', 'Impact decision workflowRunId or proposalId is invalid.')
    if (!['include', 'exclude', 'pending'].includes(input.decision)) return failure(input, 'blocked', 'Impact decision must be include, exclude, or pending.')
    if (!Number.isSafeInteger(input.expectedBaseRevision) || input.expectedBaseRevision < 0 || proposal.basedOnRevision !== input.expectedBaseRevision) return failure(input, 'conflict', 'Impact proposal revision does not match the requested base revision.')
    if (!SAFE_REF.test(proposal.themeRef) || proposal.candidateFingerprint !== fingerprintThemeScopeCandidateV04(proposal.candidate)) return failure(input, 'blocked', 'Persisted impact proposal Theme ref or candidate fingerprint is invalid.')
    if (!Array.isArray(proposal.evidenceRefs) || proposal.evidenceRefs.length > 256 || new Set(proposal.evidenceRefs).size !== proposal.evidenceRefs.length || proposal.evidenceRefs.some((ref) => typeof ref !== 'string' || !SAFE_REF.test(ref))) return failure(input, 'blocked', 'Persisted impact proposal evidence refs are malformed or duplicated.')
    if (!Array.isArray(proposal.changedRefs) || proposal.changedRefs.length > 256 || new Set(proposal.changedRefs).size !== proposal.changedRefs.length || proposal.changedRefs.some((ref) => typeof ref !== 'string' || !SAFE_REF.test(ref))) return failure(input, 'blocked', 'Persisted impact proposal changed refs are malformed or duplicated.')
    const expectedProposalId = `theme-scope-impact:${createHash('sha256').update(`${proposal.themeRef}|${proposal.candidateFingerprint}|${proposal.evidenceRefs.join('|')}`, 'utf8').digest('hex').slice(0, 40)}`
    if (proposal.proposalId !== expectedProposalId) return failure(input, 'blocked', 'Impact proposal identity does not bind its Theme, candidate fingerprint, and evidence refs.')

    let manifest
    let assets
    try {
      manifest = await loadKnowledgeBaseManifest(input.handle.rootRef)
      assets = await readCanonicalV04Assets(input.handle.rootRef)
    } catch (error) { return failure(input, 'failed', `Canonical Theme scope state could not be re-read: ${error instanceof Error ? error.message : String(error)}`) }
    if (manifest.knowledgeBaseId !== input.handle.knowledgeBaseId) return failure(input, 'conflict', 'Knowledge Base identity changed before the Theme scope decision.')
    const objects = new Map<string, KnowledgeAssetV04>(assets.objects.map((item) => [item.value.id, structuredClone(item.value)]))
    const theme = objects.get(proposal.themeRef)
    if (!theme || !theme.id.startsWith('entity:') || (theme as KnowledgeEntityV04).type !== 'investment_theme' || !ACTIVE(theme as KnowledgeEntityV04)) return failure(input, 'blocked', 'Impact proposal does not resolve to an active InvestmentTheme.')
    const ledger = await readThemeScopeLedgerV04(input.handle)
    if (ledger.status !== 'available') return failure(input, 'blocked', `A4 ledger is unavailable (${ledger.error.code}): ${ledger.error.message}`)
    if (ledger.knowledgeBaseId !== input.handle.knowledgeBaseId || ledger.knowledgeBaseRevision !== manifest.revision) return failure(input, 'conflict', 'A4 ledger revision changed before the Theme scope decision.')
    const themeHistory = ledger.themes.find((item) => item.themeRef === proposal.themeRef)
    const currentHead = themeHistory?.currentByCandidateFingerprint[proposal.candidateFingerprint]?.decision
    const previousDecisions = ledger.themes.flatMap((item) => item.history.map((entry) => entry.decision))

    if (manifest.revision !== input.expectedBaseRevision) {
      const sameRun = themeHistory?.history.filter((entry) => entry.workflowRunId === input.workflowRunId) ?? []
      const replay = sameRun.length === 1 && sameRun[0]!.decision.candidateFingerprint === proposal.candidateFingerprint
        ? sameRun[0]
        : undefined
      if (replay && replay.decision.decision === input.decision
        && replay.decision.rationale === (input.rationale?.trim() || proposal.rationale.trim())
        && replay.decision.basedOnRevision === input.expectedBaseRevision
        && replay.decision.review.status === 'human_confirmed') {
        try {
          const raw: unknown = parseYaml(await readFile(`${input.handle.rootRef}/logs/research/${input.workflowRunId}.yaml`, 'utf8'))
          const log = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
          const context = typeof log?.ingestionContext === 'object' && log.ingestionContext !== null && !Array.isArray(log.ingestionContext) ? log.ingestionContext as Record<string, unknown> : undefined
          const batch = typeof context?.themeScope === 'object' && context.themeScope !== null && !Array.isArray(context.themeScope) ? context.themeScope as Record<string, unknown> : undefined
          const loggedDecisions = Array.isArray(batch?.decisions) ? batch.decisions : []
          if (log?.workflowRunId === input.workflowRunId && log.knowledgeBaseId === input.handle.knowledgeBaseId
            && log.schemaVersionAtExecution === '0.4' && log.status === 'completed' && log.writeStatus === 'committed'
            && log.committedRevision === replay.committedRevision && typeof log.changeSetId === 'string' && SAFE_RUN_ID.test(log.changeSetId)
            && context?.producerType === 'theme_scope_impact_human_decision' && context.producerRunId === input.workflowRunId
            && batch?.themeRef === proposal.themeRef && batch.basedOnRevision === input.expectedBaseRevision
            && loggedDecisions.length === 1 && hashKnowledgeObject(loggedDecisions[0]) === hashKnowledgeObject(replay.decision)) {
            return { status: 'already_committed', knowledgeBaseId: input.handle.knowledgeBaseId, baseRevision: input.expectedBaseRevision, committedRevision: replay.committedRevision, themeRef: proposal.themeRef, proposalId: proposal.proposalId, candidateFingerprint: proposal.candidateFingerprint, decision: replay.decision.decision, decisionId: replay.decision.id, writerRunId: input.workflowRunId, changeSetId: log.changeSetId, errors: [] }
          }
        } catch { /* A replay needs a verifiable Writer log below. */ }
      }
      return failure(input, 'conflict', 'Impact proposal is stale at the current Knowledge Base revision and has no exact committed replay.')
    }

    const bindingRef = currentHead?.candidate.canonicalRef ?? proposal.candidate.canonicalRef
    let candidate: ThemeScopeCandidateV04
    if (proposal.candidate.kind === 'industry') {
      if (bindingRef !== undefined && !bindingRef.startsWith('entity:')) return failure(input, 'blocked', 'Industry proposal has a non-Entity canonical binding.')
      candidate = { kind: 'industry', name: proposal.candidate.name, ...(proposal.candidate.identityContext ? { identityContext: proposal.candidate.identityContext } : {}), ...(bindingRef ? { canonicalRef: bindingRef as `entity:${string}` } : {}) }
    } else {
      if (bindingRef !== undefined && !bindingRef.startsWith('relation:')) return failure(input, 'blocked', 'Relation proposal has a non-Relation canonical binding.')
      candidate = { kind: 'relation', relationType: proposal.candidate.relationType, sourceFingerprint: proposal.candidate.sourceFingerprint, targetFingerprint: proposal.candidate.targetFingerprint, ...(bindingRef ? { canonicalRef: bindingRef as `relation:${string}` } : {}) }
    }
    const fingerprint = fingerprintThemeScopeCandidateV04(candidate)
    if (fingerprint !== proposal.candidateFingerprint) return failure(input, 'blocked', 'Impact proposal candidate identity changed while binding its canonical identity.')
    if (proposal.priorDecision && (!currentHead || currentHead.id !== proposal.priorDecision.id || currentHead.decision !== proposal.priorDecision.decision)) return failure(input, 'conflict', 'Impact proposal no longer matches its prior A4 decision head.')

    const now = this.clock()
    const nowMs = Date.parse(now)
    if (!Number.isFinite(nowMs)) return failure(input, 'failed', 'A valid confirmation clock is required for A4.')
    const evidenceResult = this.buildEvidence(proposal, objects, nowMs)
    if (typeof evidenceResult === 'string') return failure(input, 'blocked', evidenceResult)
    const evidence = evidenceResult
    if (evidence.length === 0) return failure(input, 'blocked', 'Human Theme scope decisions require currently eligible Source/Raw evidence.')
    const rationale = input.rationale?.trim() || proposal.rationale.trim()
    if (!rationale || rationale.length > THEME_SCOPE_V04_LIMITS.maxRationaleLength) return failure(input, 'blocked', 'Impact decision rationale is empty or exceeds the A4 limit.')

    let reopenBasis: ThemeScopeDecisionV04['reopenBasis']
    if (currentHead?.decision === 'exclude' && input.decision !== 'exclude') {
      const priorEvidence = new Set(currentHead.evidence.map(evidenceKey))
      const newEvidence = evidence.filter((item) => !priorEvidence.has(evidenceKey(item)))
      if (newEvidence.length === 0) return failure(input, 'blocked', 'Reopening an excluded candidate requires new durable Source/Raw evidence.')
      reopenBasis = { rationale: 'New canonical source evidence cited by the impact proposal supports reconsidering the prior exclusion.', evidence: newEvidence }
    }

    const operations: KnowledgeOperationV04[] = []
    let canonicalRef = candidate.canonicalRef
    const operationToken = hashKnowledgeObject({ themeRef: proposal.themeRef, candidateFingerprint: proposal.candidateFingerprint }).slice('sha256:'.length, 'sha256:'.length + 16)
    if (proposal.candidate.kind === 'industry') {
      if (canonicalRef && !proposal.evidenceRefs.concat(proposal.changedRefs).includes(canonicalRef) && !currentHead?.candidate.canonicalRef) return failure(input, 'blocked', 'Unbound Industry canonical ref is unrelated to the persisted impact evidence.')
      const industryCandidate = proposal.candidate as Extract<ThemeScopeCandidateV04, { kind: 'industry' }>
      if (canonicalRef) {
        const industry = objects.get(canonicalRef)
        if (!industry || !industry.id.startsWith('entity:') || (industry as KnowledgeEntityV04).type !== 'industry' || !ACTIVE(industry as KnowledgeIndustryV04)) return failure(input, 'blocked', `Industry canonical ref is missing, inactive, or has the wrong type: ${canonicalRef}`)
        const names = [(industry as KnowledgeIndustryV04).name, ...((industry as KnowledgeIndustryV04).aliases ?? [])]
        if (!names.some((name) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US') === industryCandidate.name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US'))) return failure(input, 'blocked', `Industry canonical ref does not match the proposal candidate name: ${canonicalRef}`)
      } else if (input.decision === 'include') return failure(input, 'blocked', 'Included Industry impact candidate must resolve to a canonical Industry ref.')
      if (input.decision === 'include' && canonicalRef) {
        const exposures = [...objects.values()].filter((value): value is KnowledgeRelationV04 => value.id.startsWith('relation:') && (value as KnowledgeRelationV04).type === 'theme_exposure' && (value as KnowledgeRelationV04).sourceRef === proposal.themeRef && (value as KnowledgeRelationV04).targetRef === canonicalRef)
        if (exposures.length > 1) return failure(input, 'blocked', `Theme has ambiguous duplicate exposures for ${canonicalRef}.`)
        const prior = exposures[0]
        const sourceRefs = sortedUnique([...(prior?.sourceRefs ?? []), ...evidence.map((item) => item.sourceRef)]) as `source:${string}`[]
        const exposure: KnowledgeRelationV04 = prior
          ? { ...prior, sourceRefs, lifecycle: { ...prior.lifecycle, status: 'active' } }
          : { id: allocateKnowledgeId('relation', { type: 'theme_exposure', sourceRef: proposal.themeRef, targetRef: canonicalRef, attributes: null }) as `relation:${string}`, type: 'theme_exposure', sourceRef: proposal.themeRef as `entity:${string}`, targetRef: canonicalRef as `entity:${string}`, sourceRefs, lifecycle: { status: 'active' } }
        if (!prior) {
          const occupied = objects.get(exposure.id)
          if (occupied) return failure(input, 'blocked', `Stable Theme exposure identity is occupied by an incompatible object: ${exposure.id}`)
          operations.push({ operationId: `create-impact-exposure-${operationToken}`, type: 'create', object: exposure })
        } else if (hashKnowledgeObject(prior) !== hashKnowledgeObject(exposure)) {
          operations.push({ operationId: `update-impact-exposure-${operationToken}`, type: 'update', knowledgeId: prior.id, expectedBeforeHash: hashKnowledgeObject(prior), object: exposure })
        }
      } else if (canonicalRef) {
        for (const exposure of objects.values()) {
          if (!exposure.id.startsWith('relation:')) continue
          const relation = exposure as KnowledgeRelationV04
          if (relation.type !== 'theme_exposure' || relation.sourceRef !== proposal.themeRef || relation.targetRef !== canonicalRef || !ACTIVE(relation)) continue
          const archived: KnowledgeRelationV04 = { ...relation, lifecycle: { ...relation.lifecycle, status: 'archived' } }
          operations.push({ operationId: `archive-impact-exposure-${operationToken}`, type: 'update', knowledgeId: relation.id, expectedBeforeHash: hashKnowledgeObject(relation), object: archived })
        }
      }
    } else {
      const relationCandidate = candidate as Extract<ThemeScopeCandidateV04, { kind: 'relation' }>
      const sourceHead = themeHistory?.currentByCandidateFingerprint[relationCandidate.sourceFingerprint]?.decision
      const targetHead = themeHistory?.currentByCandidateFingerprint[relationCandidate.targetFingerprint]?.decision
      const sourceOverride = input.finalIndustryDecisions?.get(`${proposal.themeRef}\u0000${relationCandidate.sourceFingerprint}`)
      const targetOverride = input.finalIndustryDecisions?.get(`${proposal.themeRef}\u0000${relationCandidate.targetFingerprint}`)
      const sourceRef = sourceOverride?.canonicalRef ?? (sourceHead?.candidate.kind === 'industry' ? sourceHead.candidate.canonicalRef : undefined)
      const targetRef = targetOverride?.canonicalRef ?? (targetHead?.candidate.kind === 'industry' ? targetHead.candidate.canonicalRef : undefined)
      const sourceDecision = sourceOverride?.decision ?? sourceHead?.decision
      const targetDecision = targetOverride?.decision ?? targetHead?.decision
      if ((!sourceHead && !sourceOverride) || (!targetHead && !targetOverride) || !sourceRef || !targetRef) return failure(input, 'blocked', 'Impact Relation endpoints do not resolve through current or same-batch A4 Industry decisions.')
      if (input.decision === 'include' && (sourceDecision !== 'include' || targetDecision !== 'include')) return failure(input, 'blocked', 'Included impact Relation requires both endpoint Industries to be included in the final decision batch.')
      const relationCandidates = [...objects.values()].filter((value): value is KnowledgeRelationV04 => value.id.startsWith('relation:') && (value as KnowledgeRelationV04).type === relationCandidate.relationType && (value as KnowledgeRelationV04).sourceRef === sourceRef && (value as KnowledgeRelationV04).targetRef === targetRef && ACTIVE(value as KnowledgeRelationV04))
      if (relationCandidate.canonicalRef && !proposal.evidenceRefs.concat(proposal.changedRefs).includes(relationCandidate.canonicalRef) && !currentHead?.candidate.canonicalRef) return failure(input, 'blocked', 'Unbound Relation canonical ref is unrelated to the persisted impact evidence.')
      const referenced = relationCandidate.canonicalRef
        ? relationCandidates.filter((value) => value.id === relationCandidate.canonicalRef)
        : relationCandidates.filter((value) => proposal.evidenceRefs.concat(proposal.changedRefs).includes(value.id))
      if (referenced.length !== 1) return failure(input, 'blocked', 'Impact Relation does not resolve to one active canonical Relation with the exact directed included endpoints.')
      canonicalRef = referenced[0]!.id
      candidate = { ...relationCandidate, canonicalRef: canonicalRef as `relation:${string}` }
    }

    const finalCandidate: ThemeScopeCandidateV04 = candidate.kind === 'industry'
      ? { kind: 'industry', name: candidate.name, ...(candidate.identityContext ? { identityContext: candidate.identityContext } : {}), ...(candidate.canonicalRef ? { canonicalRef: candidate.canonicalRef as `entity:${string}` } : {}) }
      : { kind: 'relation', relationType: candidate.relationType, sourceFingerprint: candidate.sourceFingerprint, targetFingerprint: candidate.targetFingerprint, ...(candidate.canonicalRef ? { canonicalRef: candidate.canonicalRef as `relation:${string}` } : {}) }
    const decisionDraft = {
      version: '0.4' as const,
      themeRef: proposal.themeRef as `entity:${string}`,
      candidate: finalCandidate,
      candidateFingerprint: fingerprint,
      decision: input.decision,
      rationale,
      evidence,
      coverageGaps: [],
      review: { status: 'human_confirmed' as const, confirmedAt: now },
      basedOnRevision: input.expectedBaseRevision,
      ...(currentHead ? { previousDecisionId: currentHead.id } : {}),
      ...(reopenBasis ? { reopenBasis } : {}),
      affectedBranchKeys: candidate.kind === 'industry'
        ? [branchKey(fingerprint)]
        : sortedUnique([branchKey(candidate.sourceFingerprint), branchKey(candidate.targetFingerprint)]),
    }
    const decision = createThemeScopeDecisionV04(decisionDraft)
    const scopeBatch: ThemeScopeDecisionBatchV04 = { version: '0.4', themeRef: proposal.themeRef as `entity:${string}`, basedOnRevision: input.expectedBaseRevision, decisions: [decision] }
    const scopeValidation = input.batchPlanning ? undefined : validateThemeScopeDecisionBatchV04(scopeBatch, { previousDecisions })
    if (scopeValidation && !scopeValidation.valid) return failure(input, 'blocked', scopeValidation.errors.map((issue) => `${issue.code}: ${issue.message}`).join('; '))

    const decisionDigest = hashKnowledgeObject(sameDecisionProjection(decision))
    const changeSetId = `changeset-theme-scope-impact-${hashKnowledgeObject({ workflowRunId: input.workflowRunId, proposalId: proposal.proposalId, decisionDigest, operations }).slice('sha256:'.length, 'sha256:'.length + 24)}`
    const changeSet: KnowledgeChangeSetV04 = {
      changeSetId,
      workflowRunId: input.workflowRunId,
      knowledgeBaseId: input.handle.knowledgeBaseId,
      schemaVersion: '0.4',
      storageFormatVersion: '1',
      expectedBaseRevision: input.expectedBaseRevision,
      operations,
      ingestionContext: { producerType: 'theme_scope_impact_human_decision', producerRunId: input.workflowRunId, acceptedDecisionDigest: decisionDigest, themeScope: scopeBatch },
    }
    if (input.batchPlanning) {
      const plannedReceipt = { changeSet, knowledgeBaseId: input.handle.knowledgeBaseId, schemaVersion: '0.4' as const, baseRevision: input.expectedBaseRevision, changeSetId, changeSetHash: hashKnowledgeObject(changeSet), validatedAt: now } as import('../schema/mutation-v04.ts').ValidatedKnowledgeChangeSetV04
      try { await this.writer(input.handle, plannedReceipt, { registry: this.registry, clock: this.clock }) }
      catch (error) { return failure(input, 'failed', `Batch planner could not capture proposal operations: ${error instanceof Error ? error.message : String(error)}`, changeSetId) }
      return { status: 'committed', knowledgeBaseId: input.handle.knowledgeBaseId, baseRevision: input.expectedBaseRevision, committedRevision: input.expectedBaseRevision + 1, themeRef: proposal.themeRef, proposalId: proposal.proposalId, candidateFingerprint: fingerprint, decision: decision.decision, decisionId: decision.id, writerRunId: input.workflowRunId, changeSetId, errors: [] }
    }
    const validation = await validateKnowledgeChangeSetV04(input.handle, changeSet, { mode: 'commit', now: this.clock })
    if (!validation.validatedChangeSet) return failure(input, 'blocked', validation.report.errors.map((error) => `${error.code}: ${error.message}`).join('; '), changeSetId)

    let written: KnowledgeWriteResultV04
    try { written = await this.writer(input.handle, validation.validatedChangeSet, { registry: this.registry, clock: this.clock }) as KnowledgeWriteResultV04 }
    catch (error) { return failure(input, 'failed', `Shared Writer failed: ${error instanceof Error ? error.message : String(error)}`, changeSetId) }
    if (written.status === 'failed' || written.status === 'rejected') {
      return { ...failure(input, /revision|stale|conflict/i.test(`${written.error?.code ?? ''} ${written.error?.message ?? ''}`) ? 'conflict' : 'failed', written.error?.message ?? 'Shared Writer rejected the Theme scope impact ChangeSet.', changeSetId), committedRevision: written.committedRevision }
    }
    if (written.status === 'no_changes') return failure(input, 'failed', 'Writer returned no_changes for a new A4 human decision.', changeSetId)
    return { status: written.status, knowledgeBaseId: written.knowledgeBaseId, baseRevision: written.baseRevision, committedRevision: written.committedRevision, themeRef: proposal.themeRef, proposalId: proposal.proposalId, candidateFingerprint: fingerprint, decision: decision.decision, decisionId: decision.id, writerRunId: input.workflowRunId, changeSetId, errors: [] }
  }

  /** Plans every inbox decision against one revision, then validates and commits one multi-Theme ChangeSet. */
  async executeBatch(input: ThemeScopeImpactAcceptanceBatchInputV04): Promise<ThemeScopeImpactAcceptanceBatchResultV04> {
    const failureBatch = (status: ThemeScopeImpactAcceptanceBatchResultV04['status'], message: string, changeSetId?: string): ThemeScopeImpactAcceptanceBatchResultV04 => ({
      status, knowledgeBaseId: input.handle.knowledgeBaseId, baseRevision: input.expectedBaseRevision, committedRevision: input.handle.revision,
      workflowRunId: input.workflowRunId, ...(changeSetId ? { changeSetId } : {}), decisions: [], errors: [message],
    })
    if (input.items.length < 1 || input.items.length > THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch || input.items.some((item) => !item?.proposal)) return failureBatch('blocked', 'Theme scope impact decision batch must contain 1 to 100 proposals.')
    const proposalIds = new Set<string>()
    const candidateKeys = new Set<string>()
    for (const item of input.items) {
      if (proposalIds.has(item.proposal.proposalId)) return failureBatch('blocked', 'Theme scope impact decision batch contains a duplicate proposal.')
      proposalIds.add(item.proposal.proposalId)
      const key = `${item.proposal.themeRef}\u0000${item.proposal.candidateFingerprint}`
      if (candidateKeys.has(key)) return failureBatch('blocked', 'Theme scope impact decision batch contains duplicate candidates for one Theme.')
      candidateKeys.add(key)
      if (item.proposal.basedOnRevision !== input.expectedBaseRevision) return failureBatch('conflict', 'Every proposal in a Theme scope impact decision batch must share the current base revision.')
    }
    if (!SAFE_RUN_ID.test(input.workflowRunId) || input.workflowRunId.includes('..')) return failureBatch('blocked', 'Theme scope impact workflowRunId is invalid.')
    let currentManifest
    let currentLedger
    try {
      currentManifest = await loadKnowledgeBaseManifest(input.handle.rootRef)
      currentLedger = await readThemeScopeLedgerV04(input.handle)
    } catch (error) { return failureBatch('failed', `Could not verify Theme scope replay state: ${error instanceof Error ? error.message : String(error)}`) }
    if (currentLedger.status !== 'available') return failureBatch('blocked', `A4 ledger is unavailable (${currentLedger.error.code}): ${currentLedger.error.message}`)
    if (currentManifest.revision !== input.expectedBaseRevision) {
      const history = currentLedger.themes.flatMap((theme) => theme.history.filter((entry) => entry.workflowRunId === input.workflowRunId))
      const expected = input.items.map((item) => ({ item, rationale: item.rationale?.trim() || item.proposal.rationale.trim() }))
      const matches = expected.map(({ item, rationale }) => history.find((entry) => entry.decision.themeRef === item.proposal.themeRef && entry.decision.candidateFingerprint === item.proposal.candidateFingerprint && entry.decision.decision === item.decision && entry.decision.rationale === rationale && entry.decision.basedOnRevision === input.expectedBaseRevision && entry.decision.review.status === 'human_confirmed'))
      if (history.length === expected.length && matches.every(Boolean)) {
        try {
          const raw: unknown = parseYaml(await readFile(`${input.handle.rootRef}/logs/research/${input.workflowRunId}.yaml`, 'utf8'))
          const log = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
          const context = typeof log?.ingestionContext === 'object' && log.ingestionContext !== null && !Array.isArray(log.ingestionContext) ? log.ingestionContext as Record<string, unknown> : undefined
          const loggedBatches = Array.isArray(context?.themeScopeBatches) ? context.themeScopeBatches : []
          const loggedDecisions = loggedBatches.flatMap((batch) => typeof batch === 'object' && batch !== null && !Array.isArray(batch) && Array.isArray((batch as Record<string, unknown>).decisions) ? (batch as Record<string, unknown>).decisions as unknown[] : [])
          const matchedDecisions = matches.map((entry) => entry!.decision)
          if (log?.workflowRunId === input.workflowRunId && log.knowledgeBaseId === input.handle.knowledgeBaseId && typeof log.changeSetId === 'string' && SAFE_RUN_ID.test(log.changeSetId) && log.schemaVersionAtExecution === '0.4' && log.status === 'completed' && log.writeStatus === 'committed' && log.committedRevision === matches[0]!.committedRevision
            && context?.producerType === 'theme_scope_impact_human_decision' && context.producerRunId === input.workflowRunId && context.themeScope === undefined
            && loggedDecisions.length === matchedDecisions.length && matchedDecisions.every((decision) => loggedDecisions.some((logged) => hashKnowledgeObject(logged) === hashKnowledgeObject(decision)))
            && loggedBatches.every((batch) => typeof batch === 'object' && batch !== null && !Array.isArray(batch) && (batch as Record<string, unknown>).basedOnRevision === input.expectedBaseRevision)) {
            return { status: 'already_committed', knowledgeBaseId: input.handle.knowledgeBaseId, baseRevision: input.expectedBaseRevision, committedRevision: matches[0]!.committedRevision, workflowRunId: input.workflowRunId,
              changeSetId: log.changeSetId,
              decisions: matches.map((entry, index) => ({ proposalId: expected[index]!.item.proposal.proposalId, candidateFingerprint: entry!.decision.candidateFingerprint, decision: entry!.decision.decision, decisionId: entry!.decision.id })), errors: [] }
          }
        } catch { /* Exact Writer receipt required for retry recovery. */ }
      }
      return failureBatch('conflict', 'Theme scope impact decision batch is stale and has no exact committed replay.')
    }
    const planned: KnowledgeChangeSetV04[] = []
    const planner = new ThemeScopeImpactAcceptanceV04({ registry: this.registry, clock: this.clock, writer: async (_handle, receipt) => {
      const validated = receipt as import('../schema/mutation-v04.ts').ValidatedKnowledgeChangeSetV04
      planned.push(validated.changeSet)
      return { status: 'committed', knowledgeBaseId: validated.knowledgeBaseId, changeSetId: validated.changeSetId, baseRevision: validated.baseRevision, committedRevision: validated.baseRevision + 1, createdIds: [], updatedIds: [] }
    } })
    const finalIndustryDecisions = new Map<string, { decision: 'include' | 'exclude' | 'pending'; canonicalRef?: string }>()
    for (const batchItem of input.items) {
      if (batchItem.proposal.candidate.kind !== 'industry') continue
      const prior = currentLedger.themes.find((theme) => theme.themeRef === batchItem.proposal.themeRef)?.currentByCandidateFingerprint[batchItem.proposal.candidateFingerprint]?.decision
      const canonicalRef = batchItem.proposal.candidate.canonicalRef ?? (prior?.candidate.kind === 'industry' ? prior.candidate.canonicalRef : undefined)
      finalIndustryDecisions.set(`${batchItem.proposal.themeRef}\u0000${batchItem.proposal.candidateFingerprint}`, { decision: batchItem.decision, ...(canonicalRef ? { canonicalRef } : {}) })
    }
    for (const item of input.items) {
      const result = await planner.execute({ handle: input.handle, proposal: item.proposal, decision: item.decision, ...(item.rationale === undefined ? {} : { rationale: item.rationale }), expectedBaseRevision: input.expectedBaseRevision, workflowRunId: input.workflowRunId, finalIndustryDecisions, batchPlanning: true })
      if (result.status !== 'committed' || !result.decisionId) return failureBatch(result.status === 'conflict' ? 'conflict' : result.status === 'failed' ? 'failed' : 'blocked', result.errors.join('; ') || 'One proposal could not be planned for the atomic Theme scope decision.', result.changeSetId)
    }
    if (planned.length !== input.items.length) return failureBatch('failed', 'Theme scope impact batch planner did not produce one validated plan per proposal.')
    const batchesByTheme = new Map<string, ThemeScopeDecisionBatchV04>()
    const operationsById = new Map<string, KnowledgeOperationV04>()
    for (const changeSet of planned) {
      const context = changeSet.ingestionContext
      const batch = context?.themeScope as ThemeScopeDecisionBatchV04 | undefined
      if (!batch || !Array.isArray(batch.decisions)) return failureBatch('failed', 'Theme scope impact planner omitted its A4 decision batch.')
      const previous = batchesByTheme.get(batch.themeRef)
      if (previous) batchesByTheme.set(batch.themeRef, { ...previous, decisions: [...previous.decisions, ...batch.decisions] })
      else batchesByTheme.set(batch.themeRef, batch)
      for (const operation of changeSet.operations) {
        const prior = operationsById.get(operation.operationId)
        if (prior && hashKnowledgeObject(prior) !== hashKnowledgeObject(operation)) return failureBatch('blocked', `Conflicting canonical operations share id ${operation.operationId}.`)
        operationsById.set(operation.operationId, operation)
      }
    }
    const themeScopeBatches = [...batchesByTheme.values()].sort((left, right) => left.themeRef.localeCompare(right.themeRef))
    if (themeScopeBatches.length > 32) return failureBatch('blocked', 'Theme scope impact batch exceeds the 32-Theme bound.')
    const allDecisions = themeScopeBatches.flatMap((batch) => batch.decisions)
    if (allDecisions.length !== input.items.length) return failureBatch('blocked', 'Theme scope impact A4 decision cardinality does not match the requested proposals.')
    const changeSetId = `changeset-theme-scope-impact-${hashKnowledgeObject({ workflowRunId: input.workflowRunId, decisions: allDecisions.map((decision) => decision.id), operations: [...operationsById.values()] }).slice('sha256:'.length, 'sha256:'.length + 24)}`
    const changeSet: KnowledgeChangeSetV04 = {
      changeSetId, workflowRunId: input.workflowRunId, knowledgeBaseId: input.handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: input.expectedBaseRevision,
      operations: [...operationsById.values()],
      ingestionContext: { producerType: 'theme_scope_impact_human_decision', producerRunId: input.workflowRunId, themeScopeBatches },
    }
    const validation = await validateKnowledgeChangeSetV04(input.handle, changeSet, { mode: 'commit', now: this.clock })
    if (!validation.validatedChangeSet) return failureBatch('blocked', validation.report.errors.map((error) => `${error.code}: ${error.message}`).join('; '), changeSetId)
    let written: KnowledgeWriteResultV04
    try { written = await this.writer(input.handle, validation.validatedChangeSet, { registry: this.registry, clock: this.clock }) as KnowledgeWriteResultV04 }
    catch (error) { return failureBatch('failed', `Shared Writer failed: ${error instanceof Error ? error.message : String(error)}`, changeSetId) }
    if (written.status !== 'committed' && written.status !== 'already_committed') return failureBatch(written.status === 'rejected' ? 'conflict' : 'failed', written.error?.message ?? `Shared Writer returned ${written.status}.`, changeSetId)
    return { status: written.status, knowledgeBaseId: written.knowledgeBaseId, baseRevision: written.baseRevision, committedRevision: written.committedRevision, workflowRunId: input.workflowRunId, changeSetId, decisions: allDecisions.map((decision) => ({ proposalId: input.items.find((item) => item.proposal.candidateFingerprint === decision.candidateFingerprint && item.proposal.themeRef === decision.themeRef)!.proposal.proposalId, candidateFingerprint: decision.candidateFingerprint, decision: decision.decision, decisionId: decision.id })), errors: [] }
  }

  private buildEvidence(proposal: ThemeScopeImpactProposalForAcceptanceV04, objects: ReadonlyMap<string, KnowledgeAssetV04>, now: number): ThemeScopeEvidenceV04[] | string {
    const evidenceRefs = sortedUnique(proposal.evidenceRefs)
    const sourceRefs = sortedUnique(evidenceRefs.flatMap((ref) => evidenceSourcesForRef(ref, objects)))
    const result: ThemeScopeEvidenceV04[] = []
    for (const sourceRef of sourceRefs) {
      const source = objects.get(sourceRef)
      if (!source || !source.id.startsWith('source:')) continue
      const canonicalSource = source as KnowledgeSourceV04
      if (!sourceAllowsThemeEvidence(canonicalSource, now)) continue
      const rawRefs = sortedUnique(canonicalSource.rawRefs ?? []).filter((rawRef) => RAW_REF.test(rawRef))
      const rawRef = rawRefs[0]
      if (!rawRef) continue
      const supportingRef = evidenceRefs.find((ref) => evidenceSourcesForRef(ref, objects).includes(sourceRef)) ?? sourceRef
      result.push({ sourceRef: sourceRef as `source:${string}`, rawRef: rawRef as `raw-sha256-${string}`, locator: `Canonical evidence ref ${supportingRef}` })
      if (result.length >= THEME_SCOPE_V04_LIMITS.maxEvidencePerDecision) break
    }
    const malformedBindings = result.some((item) => !SAFE_REF.test(item.sourceRef) || !RAW_REF.test(item.rawRef) || !item.locator.trim())
    if (malformedBindings) return 'Impact proposal resolved to malformed Source/Raw evidence.'
    return result
  }
}
