import { allocateKnowledgeId } from '../registry/id-allocation.ts'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import type { KnowledgeAssetV04, KnowledgeEntityV04, KnowledgeIndustryV04, KnowledgeRelationV04 } from '../schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { readThemeScopeLedgerV04 } from '../governance/theme-scope-ledger-v04.ts'
import {
  createThemeScopeDecisionV04,
  fingerprintThemeIndustryCandidateV04,
  fingerprintThemeRelationCandidateV04,
  validateThemeScopeDecisionBatchV04,
  THEME_SCOPE_V04_LIMITS,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionV04,
  type ThemeScopeEvidenceV04,
  type ThemeScopeFingerprintV04,
  type ThemeScopeIndustryCandidateV04,
  type ThemeScopeRelationCandidateV04,
} from '../governance/theme-scope-v04.ts'
import { validateKnowledgeChangeSetV04 } from '../validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../writer/writer.ts'
import { KnowledgeProductionGateway } from './gateway.ts'
import type { KnowledgeProductionInput, SemanticProductionInputProposal } from './contracts.ts'
import { ThemeManagementGatewayV04 } from './theme-management-v04.ts'
import type { ThemeFrameworkAtomicCommitPort, ThemeFrameworkAtomicCommitResult, ThemeFrameworkDecision } from '../../workflows/theme-framework-construction/contracts.ts'
import type { ThemeFrameworkIndustryCandidate, ThemeFrameworkRelationCandidate, ThemeFrameworkResult } from '../../skills/theme-framework/contracts.ts'

type CommitFailure = { readonly status: 'blocked' | 'conflict' | 'failed'; readonly errors: readonly string[] }
type ScopeIdentity = { readonly canonicalRef: string; readonly exposureRef?: string }

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validLocator(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= THEME_SCOPE_V04_LIMITS.maxLocatorLength && !/[\u0000-\u001f\u007f]/u.test(value)
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function writeFailure(changeSet: KnowledgeChangeSetV04, code: string, message: string): KnowledgeWriteResultV04 {
  return {
    status: 'rejected',
    knowledgeBaseId: changeSet.knowledgeBaseId,
    changeSetId: changeSet.changeSetId,
    baseRevision: changeSet.expectedBaseRevision,
    committedRevision: changeSet.expectedBaseRevision,
    createdIds: [],
    updatedIds: [],
    error: { code, message },
  }
}

function evidenceFor(decision: ThemeFrameworkDecision): ThemeScopeEvidenceV04[] | string {
  const evidenceRefs = [...decision.evidenceRefs]
  if (new Set(evidenceRefs).size !== evidenceRefs.length) return `Decision ${decision.candidateId} repeats an evidence ref`
  const bindings = new Map<string, ThemeFrameworkDecision['evidenceBindings'][number]>()
  for (const binding of decision.evidenceBindings) {
    if (!binding || typeof binding.evidenceId !== 'string' || bindings.has(binding.evidenceId)) return `Decision ${decision.candidateId} has duplicate or malformed evidence bindings`
    if (!/^source:[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/.test(binding.sourceRef) || !/^raw-sha256-[a-f0-9]{64}$/.test(binding.rawRef) || !validLocator(binding.locator)) {
      return `Decision ${decision.candidateId} evidence must bind an eligible Source/Raw pair and a valid locator`
    }
    bindings.set(binding.evidenceId, binding)
  }
  if (evidenceRefs.some((evidenceId) => !bindings.has(evidenceId))) return `Decision ${decision.candidateId} cites evidence without a durable Source/Raw binding`
  if (bindings.size !== evidenceRefs.length) return `Decision ${decision.candidateId} contains durable bindings not cited by the decision`
  return evidenceRefs.map((evidenceId) => {
    const binding = bindings.get(evidenceId)!
    return { sourceRef: binding.sourceRef, rawRef: binding.rawRef, locator: binding.locator! }
  }).sort((left, right) => left.sourceRef.localeCompare(right.sourceRef) || left.rawRef.localeCompare(right.rawRef) || left.locator.localeCompare(right.locator))
}

function indexFramework(framework: ThemeFrameworkResult, decisions: readonly ThemeFrameworkDecision[]): { readonly valid: true; readonly industries: Map<string, ThemeFrameworkIndustryCandidate>; readonly relations: Map<string, ThemeFrameworkRelationCandidate>; readonly decisions: Map<string, ThemeFrameworkDecision> } | { readonly valid: false; readonly error: string } {
  const industries = new Map(framework.industryCandidates.map((candidate) => [candidate.candidateId, candidate]))
  const relations = new Map(framework.relationCandidates.map((candidate) => [candidate.candidateId, candidate]))
  if (industries.size !== framework.industryCandidates.length || relations.size !== framework.relationCandidates.length) return { valid: false, error: 'Theme Framework candidate IDs must be unique across each candidate kind' }
  const decisionById = new Map<string, ThemeFrameworkDecision>()
  const known = new Map<string, 'industry' | 'relation'>([
    ...[...industries.keys()].map((id) => [id, 'industry'] as const),
    ...[...relations.keys()].map((id) => [id, 'relation'] as const),
  ])
  for (const decision of decisions) {
    if (!safeId(decision.candidateId) || decisionById.has(decision.candidateId) || known.get(decision.candidateId) !== decision.kind) return { valid: false, error: `Decision ${decision.candidateId} does not uniquely resolve to a framework candidate of the same kind` }
    if (decision.decision !== 'include' && decision.decision !== 'exclude' && decision.decision !== 'pending') return { valid: false, error: `Decision ${decision.candidateId} has an unsupported review value` }
    if (!text(decision.rationale) || decision.rationale.length > THEME_SCOPE_V04_LIMITS.maxRationaleLength || decision.coverageGaps.length > THEME_SCOPE_V04_LIMITS.maxCoverageGaps || decision.coverageGaps.some((gap) => !text(gap) || gap.length > THEME_SCOPE_V04_LIMITS.maxCoverageGapLength)) return { valid: false, error: `Decision ${decision.candidateId} has invalid rationale or coverage gaps` }
    const evidenceError = evidenceFor(decision)
    if (typeof evidenceError === 'string') return { valid: false, error: evidenceError }
    decisionById.set(decision.candidateId, decision)
  }
  if (decisionById.size !== industries.size + relations.size) return { valid: false, error: 'Theme Framework acceptance must contain one decision for every Industry and Relation candidate' }
  return { valid: true, industries, relations, decisions: decisionById }
}

function industryFingerprint(candidate: ThemeFrameworkIndustryCandidate): ThemeScopeFingerprintV04 {
  return fingerprintThemeIndustryCandidateV04({ name: candidate.name, identityContext: candidate.semanticFingerprint })
}

function relationFingerprint(candidate: ThemeFrameworkRelationCandidate, industryFingerprints: ReadonlyMap<string, ThemeScopeFingerprintV04>): ThemeScopeFingerprintV04 | undefined {
  const sourceFingerprint = industryFingerprints.get(candidate.sourceIndustryRef)
  const targetFingerprint = industryFingerprints.get(candidate.targetIndustryRef)
  if (!sourceFingerprint || !targetFingerprint) return undefined
  return fingerprintThemeRelationCandidateV04({ relationType: candidate.relationType, sourceFingerprint, targetFingerprint })
}

function branchFor(fingerprint: ThemeScopeFingerprintV04): string {
  return `branch-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 16)}`
}

function decisionEvidenceProjection(decision: ThemeScopeDecisionV04): unknown {
  return {
    candidateFingerprint: decision.candidateFingerprint,
    decision: decision.decision,
    rationale: decision.rationale,
    evidence: [...decision.evidence].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef) || a.rawRef.localeCompare(b.rawRef) || a.locator.localeCompare(b.locator)),
    coverageGaps: [...decision.coverageGaps].sort(),
    reopenBasis: decision.reopenBasis === undefined ? null : {
      rationale: decision.reopenBasis.rationale,
      evidence: [...decision.reopenBasis.evidence].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef) || a.rawRef.localeCompare(b.rawRef) || a.locator.localeCompare(b.locator)),
    },
    affectedBranchKeys: [...decision.affectedBranchKeys].sort(),
    basedOnRevision: decision.basedOnRevision,
  }
}

function sameCompletedRun(
  input: { readonly expectedBaseRevision: number; readonly themeRef: string; readonly workflowRunId: string },
  decisions: readonly ThemeScopeDecisionV04[],
  ledger: Awaited<ReturnType<typeof readThemeScopeLedgerV04>>,
): { readonly status: 'same' | 'different' | 'absent'; readonly committedRevision?: number } {
  if (ledger.status !== 'available') return { status: 'different' }
  const runEntries = ledger.themes.flatMap((theme) => theme.history.filter((entry) => entry.workflowRunId === input.workflowRunId).map((entry) => ({ ...entry, themeRef: theme.themeRef })))
  if (runEntries.length === 0) return { status: 'absent' }
  if (runEntries.some((entry) => entry.themeRef !== input.themeRef) || runEntries.length !== decisions.length) return { status: 'different' }
  const persisted = new Map(runEntries.map((entry) => [entry.decision.candidateFingerprint, entry.decision]))
  if (persisted.size !== decisions.length) return { status: 'different' }
  for (const expected of decisions) {
    const prior = persisted.get(expected.candidateFingerprint)
    if (!prior || hashKnowledgeObject(decisionEvidenceProjection(prior)) !== hashKnowledgeObject(decisionEvidenceProjection(expected))) return { status: 'different' }
    if (expected.candidate.canonicalRef !== undefined && expected.candidate.canonicalRef !== prior.candidate.canonicalRef) return { status: 'different' }
  }
  return { status: 'same', committedRevision: Math.max(...runEntries.map((entry) => entry.committedRevision)) }
}

function makeScopeDecisions(input: {
  readonly themeRef: string
  readonly expectedBaseRevision: number
  readonly confirmedAt: string
  readonly decisions: readonly ThemeFrameworkDecision[]
  readonly industries: ReadonlyMap<string, ThemeFrameworkIndustryCandidate>
  readonly relations: ReadonlyMap<string, ThemeFrameworkRelationCandidate>
  readonly industryFingerprints: ReadonlyMap<string, ThemeScopeFingerprintV04>
  readonly includedIndustryRefs: ReadonlyMap<string, string>
  readonly includedRelationRefs: ReadonlyMap<string, string>
  readonly scopeIdentityByFingerprint: ReadonlyMap<string, ScopeIdentity>
  readonly ledgerTheme: { readonly history: readonly { readonly decision: ThemeScopeDecisionV04 }[]; readonly currentByCandidateFingerprint: Readonly<Record<string, { readonly decision: ThemeScopeDecisionV04 }>> } | undefined
}): ThemeScopeDecisionV04[] | string {
  const currentHeads = input.ledgerTheme?.currentByCandidateFingerprint ?? {}
  const result: ThemeScopeDecisionV04[] = []
  for (const reviewed of input.decisions) {
    const industry = input.industries.get(reviewed.candidateId)
    const relation = input.relations.get(reviewed.candidateId)
    const evidence = evidenceFor(reviewed)
    if (typeof evidence === 'string') return evidence
    let candidate: ThemeScopeIndustryCandidateV04 | ThemeScopeRelationCandidateV04
    let fingerprint: ThemeScopeFingerprintV04
    let branches: string[]
    if (industry) {
      fingerprint = input.industryFingerprints.get(industry.candidateId)!
      const sourceRef = input.includedIndustryRefs.get(industry.candidateId)
      const previous = currentHeads[fingerprint]?.decision
      const canonicalRef = input.scopeIdentityByFingerprint.get(fingerprint)?.canonicalRef ?? (reviewed.decision === 'include' ? sourceRef : industry.existingIndustryRef ?? previous?.candidate.canonicalRef)
      if (reviewed.decision === 'include' && !canonicalRef) return `Included Industry ${reviewed.candidateId} has no resolved canonical Industry ref`
      if (industry.existingIndustryRef && sourceRef && industry.existingIndustryRef !== sourceRef) return `A2 resolved ${industry.candidateId} to a different explicit Industry ref`
      candidate = { kind: 'industry', name: industry.name, identityContext: industry.semanticFingerprint, ...(canonicalRef ? { canonicalRef: canonicalRef as `entity:${string}` } : {}) }
      branches = [branchFor(fingerprint)]
    } else if (relation) {
      const sourceFingerprint = input.industryFingerprints.get(relation.sourceIndustryRef)
      const targetFingerprint = input.industryFingerprints.get(relation.targetIndustryRef)
      const relationFp = relationFingerprint(relation, input.industryFingerprints)
      if (!sourceFingerprint || !targetFingerprint || !relationFp) return `Relation ${reviewed.candidateId} has an unresolved Industry endpoint`
      fingerprint = relationFp
      const sourceIndustry = input.industries.get(relation.sourceIndustryRef) ?? [...input.industries.values()].find((item) => item.existingIndustryRef === relation.sourceIndustryRef)
      const targetIndustry = input.industries.get(relation.targetIndustryRef) ?? [...input.industries.values()].find((item) => item.existingIndustryRef === relation.targetIndustryRef)
      const sourceDecision = input.decisions.find((item) => item.candidateId === sourceIndustry?.candidateId)
      const targetDecision = input.decisions.find((item) => item.candidateId === targetIndustry?.candidateId)
      if (reviewed.decision === 'include' && (sourceDecision?.decision !== 'include' || targetDecision?.decision !== 'include')) return `Included Relation ${reviewed.candidateId} requires included Industry endpoints`
      const previous = currentHeads[fingerprint]?.decision
      const canonicalRef = input.scopeIdentityByFingerprint.get(fingerprint)?.canonicalRef ?? (reviewed.decision === 'include' ? input.includedRelationRefs.get(relation.candidateId) : previous?.candidate.canonicalRef)
      if (reviewed.decision === 'include' && !canonicalRef) return `Included Relation ${reviewed.candidateId} has no resolved canonical Relation ref`
      candidate = { kind: 'relation', relationType: relation.relationType, sourceFingerprint, targetFingerprint, ...(canonicalRef ? { canonicalRef: canonicalRef as `relation:${string}` } : {}) }
      branches = sortedUnique([branchFor(sourceFingerprint), branchFor(targetFingerprint)])
    } else {
      return `Decision ${reviewed.candidateId} cannot be bound to an Industry or Relation candidate`
    }
    const previous = currentHeads[fingerprint]?.decision
    const reopenRefs = industry?.reopenEvidenceRefs ?? relation?.reopenEvidenceRefs ?? []
    let reopenBasis: ThemeScopeDecisionV04['reopenBasis']
    if (previous?.decision === 'exclude' && reviewed.decision !== 'exclude') {
      const reopenEvidence = evidence.filter((item) => reviewed.evidenceBindings.some((binding) => reopenRefs.includes(binding.evidenceId) && binding.sourceRef === item.sourceRef && binding.rawRef === item.rawRef && binding.locator === item.locator))
      if (reopenEvidence.length === 0) return `Reopening excluded candidate ${reviewed.candidateId} requires cited new evidence`
      reopenBasis = { rationale: 'Accepted Theme Framework review cites new durable evidence for the reopened scope decision.', evidence: reopenEvidence }
    }
    const draft = {
      version: '0.4' as const,
      themeRef: input.themeRef as `entity:${string}`,
      candidate,
      candidateFingerprint: fingerprint,
      decision: reviewed.decision,
      rationale: reviewed.rationale,
      evidence,
      coverageGaps: [...reviewed.coverageGaps],
      review: { status: 'human_confirmed' as const, confirmedAt: input.confirmedAt },
      basedOnRevision: input.expectedBaseRevision,
      ...(previous ? { previousDecisionId: previous.id } : {}),
      ...(reopenBasis ? { reopenBasis } : {}),
      affectedBranchKeys: branches,
    }
    result.push(createThemeScopeDecisionV04(draft))
  }
  return result.sort((left, right) => left.candidateFingerprint.localeCompare(right.candidateFingerprint))
}

export interface ThemeFrameworkAcceptanceV04Options {
  readonly registry?: KnowledgeBaseRegistry
  readonly clock?: () => string
}

/** Composes A2 resolution, A3 Theme planning, canonical exposures, and A4 scope in one Writer transaction. */
export class ThemeFrameworkAcceptanceV04 implements ThemeFrameworkAtomicCommitPort {
  private readonly registry: KnowledgeBaseRegistry
  private readonly clock: () => string

  constructor(options: ThemeFrameworkAcceptanceV04Options = {}) {
    this.registry = options.registry ?? new KnowledgeBaseRegistry()
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  async commitThemeFrameworkAtomically(input: Parameters<ThemeFrameworkAtomicCommitPort['commitThemeFrameworkAtomically']>[0]): Promise<ThemeFrameworkAtomicCommitResult> {
    const failure = (status: 'blocked' | 'conflict' | 'failed', errors: readonly string[]): ThemeFrameworkAtomicCommitResult => ({ status, errors })
    const success = (status: 'committed' | 'already_committed', themeRef: string, committedRevision: number): ThemeFrameworkAtomicCommitResult => ({ status, themeRef, committedRevision })
    if (!safeId(input.workflowRunId) || !safeId(input.knowledgeBaseId) || !Number.isSafeInteger(input.expectedBaseRevision) || input.expectedBaseRevision < 0) {
      return failure('blocked', ['Theme Framework workflow identity or expected revision is invalid'])
    }
    const mounted = this.registry.get(input.knowledgeBaseId)
    if (!mounted) return failure('blocked', ['Knowledge Base is not mounted in the configured registry'])
    let handle: KnowledgeBaseHandle
    try {
      handle = await this.registry.refresh(mounted.rootRef)
    } catch (error) {
      return failure('failed', [error instanceof Error ? error.message : String(error)])
    }
    if (handle.schemaVersion !== '0.4' || handle.storageFormatVersion !== '1' || handle.status !== 'active') return failure('blocked', ['Theme Framework atomic acceptance requires an active Schema 0.4 / Storage 1 Knowledge Base'])

    const themeDefinition = input.theme.definition ?? input.framework.proposedDefinition.statement
    const themeInput = {
      name: input.theme.name,
      ...(themeDefinition ? { definition: themeDefinition } : {}),
      inclusionCriteria: [...input.framework.inclusionPrinciples],
      exclusionCriteria: [...input.framework.exclusionPrinciples],
    }
    const themePlan = await new ThemeManagementGatewayV04({ registry: this.registry, clock: this.clock }).planCreateTheme(handle, themeInput)
    if (themePlan.status === 'blocked' || themePlan.status === 'failed') return failure('blocked', themePlan.result.errors.map((error) => `${error.code}: ${error.message}`))
    const themeRef = themePlan.result.themeRef
    if (!themeRef) return failure('blocked', ['A3 Theme planning did not resolve a Theme ref'])

    const indexed = indexFramework(input.framework, input.decisions)
    if (!indexed.valid) return failure('blocked', [indexed.error])
    if (input.decisions.length === 0 || input.decisions.length > THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch) return failure('blocked', [`A4 requires between 1 and ${THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch} decisions; no decisions were truncated`])

    const industryFingerprints = new Map<string, ThemeScopeFingerprintV04>()
    for (const industry of indexed.industries.values()) {
      const fingerprint = industryFingerprint(industry)
      industryFingerprints.set(industry.candidateId, fingerprint)
      if (industry.existingIndustryRef) industryFingerprints.set(industry.existingIndustryRef, fingerprint)
    }
    const allRelationFingerprints = new Map<string, ThemeScopeFingerprintV04>()
    for (const relation of indexed.relations.values()) {
      const fingerprint = relationFingerprint(relation, industryFingerprints)
      if (!fingerprint) return failure('blocked', [`Relation ${relation.candidateId} endpoint does not resolve to a framework Industry`])
      allRelationFingerprints.set(relation.candidateId, fingerprint)
    }

    const ledger = await readThemeScopeLedgerV04(handle)
    if (ledger.status === 'failed') return failure('blocked', [`Theme scope ledger is unavailable (${ledger.error.code}): ${ledger.error.message}`])
    let replayDecisions: ThemeScopeDecisionV04[]
    try {
      replayDecisions = this.expectedDecisions(input, themeRef, indexed, industryFingerprints, allRelationFingerprints, ledger)
    } catch (error) {
      return failure('blocked', [error instanceof Error ? error.message : String(error)])
    }
    const sameRun = sameCompletedRun({ expectedBaseRevision: input.expectedBaseRevision, themeRef, workflowRunId: input.workflowRunId }, replayDecisions, ledger)
    if (sameRun.status === 'same') return success('already_committed', themeRef, sameRun.committedRevision!)
    if (sameRun.status === 'different') return failure('conflict', ['This workflowRunId already has a different committed Theme scope decision digest'])
    if (ledger.knowledgeBaseRevision !== handle.revision) return failure('conflict', ['Knowledge Base changed while Theme scope history was being read'])
    if (handle.revision !== input.expectedBaseRevision) return failure('conflict', [`Knowledge Base revision changed: expected ${input.expectedBaseRevision}, current ${handle.revision}`])

    const priorTheme = ledger.themes.find((theme) => theme.themeRef === themeRef)
    const previousDecisions = ledger.themes.flatMap((theme) => theme.history.map((entry) => entry.decision))
    const includedIndustries = [...indexed.industries.values()]
      .filter((candidate) => indexed.decisions.get(candidate.candidateId)?.decision === 'include')
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    const includedRelations = [...indexed.relations.values()]
      .filter((candidate) => indexed.decisions.get(candidate.candidateId)?.decision === 'include')
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    const expectedRefByLocalKey = new Map<string, string>()
    const localKeyByCandidateId = new Map<string, string>()
    const proposalIdByRelationCandidateId = new Map<string, string>()
    let rootCandidate: ThemeFrameworkIndustryCandidate | undefined
    let rootLocalKey: string | undefined
    const proposals: SemanticProductionInputProposal[] = []
    const evidenceErrors: string[] = []
    if (includedIndustries.length > 0) {
      rootCandidate = includedIndustries[0]
      rootLocalKey = 'industry-root-0'
      for (const [index, candidate] of includedIndustries.entries()) {
        const localKey = index === 0 ? rootLocalKey : `industry-node-${index}`
        localKeyByCandidateId.set(candidate.candidateId, localKey)
        if (candidate.existingIndustryRef) expectedRefByLocalKey.set(localKey, candidate.existingIndustryRef)
        const decision = indexed.decisions.get(candidate.candidateId)!
        const evidence = evidenceFor(decision)
        if (typeof evidence === 'string') evidenceErrors.push(evidence)
        if (!evidence || evidence.length === 0) evidenceErrors.push(`Included Industry ${candidate.candidateId} requires at least one durable Source/Raw binding`)
        const bindings = typeof evidence === 'string' ? [] : evidence.map((item) => ({ sourceRef: item.sourceRef, rawRef: item.rawRef, locator: item.locator }))
        proposals.push({
          proposalId: `theme-industry-${index}`,
          kind: 'entity',
          subjectKey: localKey,
          entityType: 'industry',
          entityName: candidate.name,
          existingEvidenceBindings: bindings,
        })
      }
      for (const [index, candidate] of includedRelations.entries()) {
        const decision = indexed.decisions.get(candidate.candidateId)!
        const evidence = evidenceFor(decision)
        if (typeof evidence === 'string') evidenceErrors.push(evidence)
        if (!evidence || evidence.length === 0) evidenceErrors.push(`Included Relation ${candidate.candidateId} requires at least one durable Source/Raw binding`)
        const sourceCandidate = indexed.industries.get(candidate.sourceIndustryRef) ?? [...indexed.industries.values()].find((industry) => industry.existingIndustryRef === candidate.sourceIndustryRef)
        const targetCandidate = indexed.industries.get(candidate.targetIndustryRef) ?? [...indexed.industries.values()].find((industry) => industry.existingIndustryRef === candidate.targetIndustryRef)
        const sourceLocalKey = sourceCandidate ? localKeyByCandidateId.get(sourceCandidate.candidateId) : undefined
        const targetLocalKey = targetCandidate ? localKeyByCandidateId.get(targetCandidate.candidateId) : undefined
        if (!sourceLocalKey || !targetLocalKey) return failure('blocked', [`Included Relation ${candidate.candidateId} requires included Industry endpoints`])
        const proposalId = `theme-relation-${index}`
        proposalIdByRelationCandidateId.set(candidate.candidateId, proposalId)
        proposals.push({
          proposalId,
          kind: 'relation',
          subjectKey: sourceLocalKey,
          targetKey: targetLocalKey,
          relationType: candidate.relationType,
          existingEvidenceBindings: typeof evidence === 'string' ? [] : evidence.map((item) => ({ sourceRef: item.sourceRef, rawRef: item.rawRef, locator: item.locator })),
        })
      }
    }
    if (evidenceErrors.length) return failure('blocked', sortedUnique(evidenceErrors))

    let compositionFailure: CommitFailure | undefined
    let committedWriterResult: KnowledgeWriteResultV04 | undefined
    const commitMerged = async (context: { readonly handle: KnowledgeBaseHandle; readonly changeSet: KnowledgeChangeSetV04; readonly entityRefsByLocalKey: Readonly<Record<string, string>>; readonly relationRefsByProposalId: Readonly<Record<string, string>> }): Promise<KnowledgeWriteResultV04> => {
      const fail = (status: CommitFailure['status'], errors: readonly string[]): KnowledgeWriteResultV04 => {
        compositionFailure = { status, errors }
        return writeFailure(context.changeSet, errors[0]?.split(':', 1)[0] ?? 'THEME_FRAMEWORK_COMPOSITION_BLOCKED', errors.join('; '))
      }
      if (context.handle.revision !== input.expectedBaseRevision || context.changeSet.expectedBaseRevision !== input.expectedBaseRevision) return fail('conflict', ['A2 preparation does not match the accepted Knowledge Base revision'])
      const assets = await readCanonicalV04Assets(context.handle.rootRef)
      const objects = new Map<string, KnowledgeAssetV04>(assets.objects.map((item) => [item.value.id, structuredClone(item.value)]))
      const currentHeads = priorTheme?.currentByCandidateFingerprint ?? {}
      const includedIndustryRefs = new Map<string, string>()
      for (const candidate of includedIndustries) {
        const localKey = localKeyByCandidateId.get(candidate.candidateId)!
        const canonicalRef = context.entityRefsByLocalKey[localKey]
        const scopeFingerprint = industryFingerprint(candidate)
        const priorRef = currentHeads[scopeFingerprint]?.decision.candidate.canonicalRef
        const object = canonicalRef ? objects.get(canonicalRef) ?? context.changeSet.operations.find((operation) => operation.type === 'create' && operation.object.id === canonicalRef)?.object : undefined
        if (!canonicalRef || !object || !object.id.startsWith('entity:') || (object as KnowledgeEntityV04).type !== 'industry' || normalized((object as KnowledgeIndustryV04).name) !== normalized(candidate.name) && !((object as KnowledgeIndustryV04).aliases ?? []).some((alias) => normalized(alias) === normalized(candidate.name))) return fail('blocked', [`A2 did not bind included Industry ${candidate.candidateId} to a matching canonical Industry`])
        if (candidate.existingIndustryRef && canonicalRef !== candidate.existingIndustryRef) return fail('blocked', [`A2 changed the explicit canonical Industry identity for ${candidate.candidateId}`])
        if (priorRef && canonicalRef !== priorRef) return fail('conflict', [`A2 resolved ${candidate.candidateId} to a different canonical ref than its previous Theme scope binding`])
        includedIndustryRefs.set(candidate.candidateId, canonicalRef)
      }
      const includedRelationRefs = new Map<string, string>()
      for (const candidate of includedRelations) {
        const proposalId = proposalIdByRelationCandidateId.get(candidate.candidateId)!
        const relationRef = context.relationRefsByProposalId[proposalId]
        const relation = relationRef ? objects.get(relationRef) ?? context.changeSet.operations.find((operation) => operation.type === 'create' && operation.object.id === relationRef)?.object : undefined
        const sourceCandidate = indexed.industries.get(candidate.sourceIndustryRef) ?? [...indexed.industries.values()].find((industry) => industry.existingIndustryRef === candidate.sourceIndustryRef)
        const targetCandidate = indexed.industries.get(candidate.targetIndustryRef) ?? [...indexed.industries.values()].find((industry) => industry.existingIndustryRef === candidate.targetIndustryRef)
        const sourceRef = sourceCandidate ? includedIndustryRefs.get(sourceCandidate.candidateId) : undefined
        const targetRef = targetCandidate ? includedIndustryRefs.get(targetCandidate.candidateId) : undefined
        if (!relationRef || !relation || !relation.id.startsWith('relation:') || (relation as KnowledgeRelationV04).type !== candidate.relationType || (relation as KnowledgeRelationV04).sourceRef !== sourceRef || (relation as KnowledgeRelationV04).targetRef !== targetRef) return fail('blocked', [`A2 did not bind included Relation ${candidate.candidateId} to the requested global directed Relation`])
        const priorRef = currentHeads[allRelationFingerprints.get(candidate.candidateId)!]?.decision.candidate.canonicalRef
        if (priorRef && relationRef !== priorRef) return fail('conflict', [`A2 resolved ${candidate.candidateId} to a different global Relation than its previous Theme scope binding`])
        includedRelationRefs.set(candidate.candidateId, relationRef)
      }

      const includedRefByFingerprint = new Map<string, string>()
      for (const candidate of includedIndustries) includedRefByFingerprint.set(industryFingerprint(candidate), includedIndustryRefs.get(candidate.candidateId)!)
      const priorCanonicalByFingerprint = new Map<string, string>()
      for (const candidate of indexed.industries.values()) {
        const fingerprint = industryFingerprint(candidate)
        const priorRef = currentHeads[fingerprint]?.decision.candidate.canonicalRef
        const explicitRef = candidate.existingIndustryRef
        if (priorRef && explicitRef && priorRef !== explicitRef) return fail('conflict', [`Industry ${candidate.candidateId} conflicts with its previous canonical scope binding`])
        if (priorRef || explicitRef) priorCanonicalByFingerprint.set(fingerprint, priorRef ?? explicitRef!)
      }
      for (const candidate of indexed.relations.values()) {
        const fingerprint = allRelationFingerprints.get(candidate.candidateId)!
        const priorRef = currentHeads[fingerprint]?.decision.candidate.canonicalRef
        if (priorRef) priorCanonicalByFingerprint.set(fingerprint, priorRef)
      }

      const exposureOperations: KnowledgeOperationV04[] = []
      const scopeIdentityByFingerprint = new Map<string, ScopeIdentity>()
      for (const [fingerprint, canonicalRef] of priorCanonicalByFingerprint) scopeIdentityByFingerprint.set(fingerprint, { canonicalRef })
      const themeExposures = [...objects.values()].filter((object): object is KnowledgeRelationV04 => object.id.startsWith('relation:') && (object as KnowledgeRelationV04).type === 'theme_exposure' && (object as KnowledgeRelationV04).sourceRef === themeRef)
      for (const candidate of indexed.industries.values()) {
        const fingerprint = industryFingerprint(candidate)
        const decision = indexed.decisions.get(candidate.candidateId)!
        const canonicalRef = includedRefByFingerprint.get(fingerprint) ?? priorCanonicalByFingerprint.get(fingerprint)
        if (decision.decision === 'include') {
          if (!canonicalRef) return fail('blocked', [`Included Industry ${candidate.candidateId} is missing a canonical identity`])
          const existing = themeExposures.filter((relation) => relation.targetRef === canonicalRef)
          const active = existing.filter((relation) => relation.lifecycle.status === 'active')
          if (active.length > 1 || (active.length === 0 && existing.length > 0)) return fail('blocked', [`Theme ${themeRef} has duplicate or inactive exposures for ${canonicalRef}`])
          const evidence = evidenceFor(decision)
          if (typeof evidence === 'string' || evidence.length === 0) return fail('blocked', [`Included Industry ${candidate.candidateId} requires durable evidence for its theme_exposure`])
          const sourceRefs = sortedUnique([...(active[0]?.sourceRefs ?? []), ...evidence.map((item) => item.sourceRef)]) as `source:${string}`[]
          const exposure = active[0]
            ? { ...active[0], sourceRefs }
            : {
              id: allocateKnowledgeId('relation', { type: 'theme_exposure', sourceRef: themeRef, targetRef: canonicalRef, attributes: null }) as `relation:${string}`,
              type: 'theme_exposure' as const,
              sourceRef: themeRef as `entity:${string}`,
              targetRef: canonicalRef as `entity:${string}`,
              sourceRefs,
              lifecycle: { status: 'active' as const },
            }
          const existingAtId = objects.get(exposure.id)
          if (active[0] && hashKnowledgeObject(active[0]) !== hashKnowledgeObject(exposure)) {
            exposureOperations.push({ operationId: `update-theme-exposure-${fingerprint.slice(7, 23)}`, type: 'update', knowledgeId: active[0].id, expectedBeforeHash: hashKnowledgeObject(active[0]), object: exposure })
          } else if (!active[0]) {
            if (existingAtId) return fail('blocked', [`Stable theme_exposure identity is occupied by an incompatible canonical object: ${exposure.id}`])
            exposureOperations.push({ operationId: `create-theme-exposure-${fingerprint.slice(7, 23)}`, type: 'create', object: exposure })
          }
          scopeIdentityByFingerprint.set(fingerprint, { canonicalRef, exposureRef: exposure.id })
          if (!scopeIdentityByFingerprint.get(fingerprint)?.exposureRef) return fail('blocked', [`Included Industry ${candidate.candidateId} is missing its fingerprint-bound theme_exposure identity`])
        } else if (canonicalRef) {
          const active = themeExposures.filter((relation) => relation.targetRef === canonicalRef && relation.lifecycle.status === 'active')
          if (active.length > 1) return fail('blocked', [`Theme ${themeRef} has duplicate active exposures for excluded or pending Industry ${canonicalRef}`])
          for (const relation of active) {
            const archived = { ...relation, lifecycle: { ...relation.lifecycle, status: 'archived' as const }, updatedAt: this.clock() }
            exposureOperations.push({ operationId: `archive-theme-exposure-${fingerprint.slice(7, 23)}`, type: 'update', knowledgeId: relation.id, expectedBeforeHash: hashKnowledgeObject(relation), object: archived })
          }
        } else {
          const nameMatches = objects.size === 0 ? [] : [...objects.values()].filter((object) => object.id.startsWith('entity:') && (object as KnowledgeEntityV04).type === 'industry' && normalized((object as KnowledgeIndustryV04).name) === normalized(candidate.name))
          const ambiguousActiveExposure = nameMatches.some((object) => themeExposures.some((relation) => relation.targetRef === object.id && relation.lifecycle.status === 'active'))
          if (ambiguousActiveExposure) return fail('blocked', [`Unbound excluded or pending Industry ${candidate.candidateId} has an active Theme exposure that cannot be safely associated`])
        }
      }

      for (const candidate of includedRelations) scopeIdentityByFingerprint.set(allRelationFingerprints.get(candidate.candidateId)!, { canonicalRef: includedRelationRefs.get(candidate.candidateId)! })
      const confirmedAt = this.clock()
      const scopeDecisions = makeScopeDecisions({
        themeRef,
        expectedBaseRevision: input.expectedBaseRevision,
        confirmedAt,
        decisions: input.decisions,
        industries: indexed.industries,
        relations: indexed.relations,
        industryFingerprints,
        includedIndustryRefs,
        includedRelationRefs,
        scopeIdentityByFingerprint,
        ledgerTheme: priorTheme,
      })
      if (typeof scopeDecisions === 'string') return fail('blocked', [scopeDecisions])
      const scopeBatch: ThemeScopeDecisionBatchV04 = { version: '0.4', themeRef: themeRef as `entity:${string}`, basedOnRevision: input.expectedBaseRevision, decisions: scopeDecisions }
      const scopeValidation = validateThemeScopeDecisionBatchV04(scopeBatch, { previousDecisions })
      if (!scopeValidation.valid) return fail('blocked', scopeValidation.errors.map((issue) => `${issue.code}: ${issue.message}`))

      const operations = [...context.changeSet.operations, ...themePlan.operations, ...exposureOperations]
      const operationIds = new Set<string>()
      const targetIds = new Set<string>()
      for (const operation of operations) {
        if (operationIds.has(operation.operationId)) return fail('blocked', [`Duplicate operationId in atomic ChangeSet: ${operation.operationId}`])
        operationIds.add(operation.operationId)
        const target = operation.type === 'create' ? operation.object.id : operation.knowledgeId
        const key = `${operation.type}:${target}`
        if (targetIds.has(key)) return fail('blocked', [`Atomic ChangeSet contains duplicate ${operation.type} operations for ${target}`])
        targetIds.add(key)
      }
      const decisionDigest = hashKnowledgeObject({
        theme: themeInput,
        decisions: scopeDecisions.map(decisionEvidenceProjection),
      })
      const merged: KnowledgeChangeSetV04 = {
        changeSetId: `changeset-theme-framework-${hashKnowledgeObject({ workflowRunId: input.workflowRunId, decisionDigest, operations }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
        workflowRunId: input.workflowRunId,
        knowledgeBaseId: input.knowledgeBaseId,
        schemaVersion: '0.4',
        storageFormatVersion: '1',
        expectedBaseRevision: input.expectedBaseRevision,
        operations,
        ingestionContext: { producerType: 'theme_framework_confirmed', producerRunId: input.workflowRunId, acceptedDecisionDigest: decisionDigest, themeScope: scopeBatch },
      }
      const validation = await validateKnowledgeChangeSetV04(context.handle, merged, { mode: 'commit', now: this.clock })
      if (!validation.validatedChangeSet) return fail('blocked', validation.report.errors.map((error) => `${error.code}: ${error.message}`))
      const result = await writeKnowledgeBase(context.handle, validation.validatedChangeSet, { registry: this.registry, clock: this.clock }) as KnowledgeWriteResultV04
      committedWriterResult = result
      if (result.status === 'failed' || result.status === 'rejected') {
        const status = /revision|stale|conflict/i.test(`${result.error?.code ?? ''} ${result.error?.message ?? ''}`) ? 'conflict' : 'failed'
        compositionFailure = { status, errors: [result.error?.message ?? 'Shared Writer rejected the atomic Theme Framework ChangeSet'] }
      }
      return result
    }

    let production: Awaited<ReturnType<KnowledgeProductionGateway['submit']>> | undefined
    if (includedIndustries.length > 0) {
      const resolver = ({ proposal, existing }: Parameters<NonNullable<KnowledgeProductionInput['semanticResolver']>>[0]) => {
        const expected = expectedRefByLocalKey.get(proposal.subjectKey)
        const matches = existing.filter((item) => item.canonicalRef === expected)
        return expected && existing.length === 1 && matches.length === 1
          ? { outcome: 'equivalent' as const, reason: 'A2 identity matched the exact producer-supplied canonical Industry ref' }
          : { outcome: 'uncertain' as const, reason: 'A2 cannot establish one exact producer-supplied canonical Industry identity' }
      }
      const gateway = new KnowledgeProductionGateway(this.registry, resolver, commitMerged)
      const productionInput: KnowledgeProductionInput = {
        handle,
        producerType: 'theme_framework_confirmed',
        producerRunId: input.workflowRunId,
        schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
        entity: { localKey: rootLocalKey!, entityType: 'industry', name: rootCandidate!.name, ...(rootCandidate!.existingIndustryRef ? { existingEntityRef: rootCandidate!.existingIndustryRef } : {}) },
        proposals,
        evidenceBindings: [],
        now: this.clock,
        semanticResolver: resolver,
        writeKnowledge: true,
        requireAllResolved: true,
      }
      production = await gateway.submit(productionInput)
      if (compositionFailure) return failure(compositionFailure.status, compositionFailure.errors)
      if (production.status === 'blocked') return failure('blocked', production.errors)
      if (production.status === 'failed') return failure('failed', production.errors)
      if (!committedWriterResult || !['committed', 'already_committed'].includes(committedWriterResult.status)) return failure('failed', ['A2 final commit boundary returned without a committed Writer receipt'])
    } else {
      const contextChangeSet: KnowledgeChangeSetV04 = {
        changeSetId: `changeset-theme-framework-preparation-${hashKnowledgeObject({ workflowRunId: input.workflowRunId, themeRef }).slice('sha256:'.length, 'sha256:'.length + 16)}`,
        workflowRunId: input.workflowRunId,
        knowledgeBaseId: input.knowledgeBaseId,
        schemaVersion: '0.4',
        storageFormatVersion: '1',
        expectedBaseRevision: input.expectedBaseRevision,
        operations: [],
      }
      try {
        await commitMerged({ handle, changeSet: contextChangeSet, entityRefsByLocalKey: {}, relationRefsByProposalId: {} })
      } catch (error) {
        return failure('failed', [error instanceof Error ? error.message : String(error)])
      }
      if (compositionFailure) return failure(compositionFailure.status, compositionFailure.errors)
      if (!committedWriterResult || !['committed', 'already_committed'].includes(committedWriterResult.status)) return failure('failed', ['Theme Framework final commit returned without a committed Writer receipt'])
    }
    const committed = committedWriterResult!
    return success(committed.status === 'already_committed' ? 'already_committed' : 'committed', themeRef, committed.committedRevision)
  }

  private expectedDecisions(
    input: Parameters<ThemeFrameworkAtomicCommitPort['commitThemeFrameworkAtomically']>[0],
    themeRef: string,
    indexed: Extract<ReturnType<typeof indexFramework>, { valid: true }>,
    industryFingerprints: ReadonlyMap<string, ThemeScopeFingerprintV04>,
    relationFingerprints: ReadonlyMap<string, ThemeScopeFingerprintV04>,
    ledger: Awaited<ReturnType<typeof readThemeScopeLedgerV04>>,
  ): ThemeScopeDecisionV04[] {
    const review = input.decisions.map((decision) => {
      const candidate = indexed.industries.get(decision.candidateId) ?? indexed.relations.get(decision.candidateId)
      let scopeCandidate: ThemeScopeIndustryCandidateV04 | ThemeScopeRelationCandidateV04
      let fingerprint: ThemeScopeFingerprintV04
      let branches: string[]
      if (candidate && 'semanticFingerprint' in candidate && 'name' in candidate) {
        fingerprint = industryFingerprints.get(candidate.candidateId)!
        scopeCandidate = { kind: 'industry', name: candidate.name, identityContext: candidate.semanticFingerprint, ...(candidate.existingIndustryRef ? { canonicalRef: candidate.existingIndustryRef as `entity:${string}` } : {}) }
        branches = [branchFor(fingerprint)]
      } else {
        const relation = indexed.relations.get(decision.candidateId)
        const sourceFingerprint = relation ? industryFingerprints.get(relation.sourceIndustryRef) : undefined
        const targetFingerprint = relation ? industryFingerprints.get(relation.targetIndustryRef) : undefined
        fingerprint = relationFingerprints.get(decision.candidateId)!
        scopeCandidate = { kind: 'relation', relationType: relation!.relationType, sourceFingerprint: sourceFingerprint!, targetFingerprint: targetFingerprint! }
        branches = sortedUnique([branchFor(sourceFingerprint!), branchFor(targetFingerprint!)])
      }
      const evidence = evidenceFor(decision)
      if (typeof evidence === 'string') throw new Error(evidence)
      let previous: ThemeScopeDecisionV04 | undefined
      if (ledger.status === 'available') {
        const ledgerTheme = ledger.themes.find((item) => item.themeRef === themeRef)
        const priorHistory = ledgerTheme?.history ?? []
        const priorRunEntry = priorHistory.find((entry) => entry.workflowRunId === input.workflowRunId && entry.decision.candidateFingerprint === fingerprint)
        previous = priorRunEntry?.decision.previousDecisionId
          ? priorHistory.find((entry) => entry.decision.id === priorRunEntry.decision.previousDecisionId)?.decision
          : priorRunEntry ? undefined : ledgerTheme?.currentByCandidateFingerprint[fingerprint]?.decision
      }
      const reopenRefs = indexed.industries.get(decision.candidateId)?.reopenEvidenceRefs ?? indexed.relations.get(decision.candidateId)?.reopenEvidenceRefs ?? []
      const reopenEvidence = previous?.decision === 'exclude' && decision.decision !== 'exclude'
        ? evidence.filter((item) => decision.evidenceBindings.some((binding) => reopenRefs.includes(binding.evidenceId) && binding.sourceRef === item.sourceRef && binding.rawRef === item.rawRef && binding.locator === item.locator))
        : []
      return createThemeScopeDecisionV04({
        version: '0.4',
        themeRef: 'entity:theme-framework-replay' as `entity:${string}`,
        candidate: scopeCandidate,
        candidateFingerprint: fingerprint,
        decision: decision.decision,
        rationale: decision.rationale,
        evidence,
        coverageGaps: [...decision.coverageGaps],
        review: { status: 'human_confirmed', confirmedAt: '2000-01-01T00:00:00.000Z' },
        basedOnRevision: input.expectedBaseRevision,
        ...(reopenEvidence.length ? { reopenBasis: { rationale: 'Accepted Theme Framework review cites new durable evidence for the reopened scope decision.', evidence: reopenEvidence } } : {}),
        affectedBranchKeys: branches,
      })
    })
    return review.sort((left, right) => left.candidateFingerprint.localeCompare(right.candidateFingerprint))
  }
}
