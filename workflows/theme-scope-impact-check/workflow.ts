import { createHash } from 'node:crypto'
import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import type { ThemeScopeLedgerThemeV04 } from '../../knowledge/governance/theme-scope-ledger-v04.ts'
import { fingerprintThemeScopeCandidateV04, type ThemeScopeCandidateV04, type ThemeScopeDecisionV04, type ThemeScopeFingerprintV04 } from '../../knowledge/governance/theme-scope-v04.ts'

type ChangedAsset = {
  readonly id: string
  readonly type?: string
  readonly name?: string
  readonly sourceRef?: string
  readonly targetRef?: string
  readonly sourceRefs?: readonly string[]
  readonly subjectRefs?: readonly string[]
  readonly lifecycle?: { readonly status?: string }
}

export interface ThemeScopeImpactCheckInput {
  readonly handle: KnowledgeBaseHandle
  /** Revisions reported by the successful canonical write. */
  readonly baseRevision: number
  readonly committedRevision: number
  /** The exact created/updated canonical refs from the write result. */
  readonly changedRefs: readonly string[]
  /** Indexed A4/Writer lookup; returns only Themes affected by these refs. */
  readonly lookupAffectedThemes: (changedRefs: readonly string[], revision: number) => Promise<ThemeScopeImpactLookupResult>
}

export type ThemeScopeImpactLookupResult =
  | { readonly status: 'available'; readonly knowledgeBaseRevision: number; readonly themes: readonly ThemeScopeLedgerThemeV04[] }
  | { readonly status: 'failed'; readonly error: string }

export type ThemeScopeImpactChangeKind =
  | 'new_theme_node'
  | 'new_theme_link'
  | 'confirmed_node_changed'
  | 'confirmed_link_changed'
  | 'excluded_candidate_new_evidence'

export interface ThemeScopeImpactCandidate {
  readonly proposalId: string
  readonly themeRef: string
  readonly candidate: ThemeScopeCandidateV04
  readonly candidateFingerprint: ThemeScopeFingerprintV04
  readonly changeKind: ThemeScopeImpactChangeKind
  readonly priorDecision?: { readonly id: string; readonly decision: ThemeScopeDecisionV04['decision'] }
  readonly rationale: string
  readonly observed: readonly {
    readonly ref: string
    readonly type?: string
    readonly name?: string
    readonly sourceRef?: string
    readonly targetRef?: string
    readonly sourceRefs: readonly string[]
    readonly lifecycleStatus?: string
  }[]
  /** Canonical Knowledge refs to inspect; never raw text or local paths. */
  readonly evidenceRefs: readonly string[]
  readonly changedRefs: readonly string[]
  readonly basedOnRevision: number
}

export type ThemeScopeImpactCheckResult =
  | { readonly status: 'completed'; readonly basedOnRevision: number; readonly candidates: readonly ThemeScopeImpactCandidate[]; readonly diagnostics: readonly string[] }
  | { readonly status: 'no_changes'; readonly basedOnRevision: number; readonly candidates: readonly []; readonly diagnostics: readonly string[] }
  | { readonly status: 'blocked'; readonly code: 'invalid_write_revision' | 'stale_revision' | 'scope_ledger_unavailable' | 'canonical_read_failed'; readonly diagnostics: readonly string[] }

const asAsset = (value: unknown): ChangedAsset | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string') return undefined
  return candidate as ChangedAsset
}
const isActive = (asset: ChangedAsset): boolean => asset.lifecycle?.status === 'active'
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const decisionFor = (theme: ThemeScopeLedgerThemeV04, fingerprint: string): ThemeScopeDecisionV04 | undefined => theme.currentByCandidateFingerprint[fingerprint]?.decision
const sourceRefsOf = (asset: ChangedAsset): string[] => sorted([...(asset.sourceRefs ?? []), ...(asset.sourceRef ? [asset.sourceRef] : [])].filter((ref) => ref.startsWith('source:')))

/**
 * Deterministic, read-only post-write Theme scope impact check.
 *
 * Candidate discovery is driven by changed canonical refs and the bounded A4
 * ledger's canonical bindings. It does not walk every Theme's graph or propose
 * any canonical writes. The current canonical loader still materializes the
 * full registry; only changed refs are inspected for impact.
 */
export async function runThemeScopeImpactCheck(input: ThemeScopeImpactCheckInput): Promise<ThemeScopeImpactCheckResult> {
  if (!Number.isSafeInteger(input.baseRevision) || !Number.isSafeInteger(input.committedRevision)
    || input.baseRevision < 0 || input.committedRevision < input.baseRevision
    || input.committedRevision - input.baseRevision > 1
    || (input.changedRefs.length > 0 && input.committedRevision !== input.baseRevision + 1)
    || (input.changedRefs.length === 0 && input.committedRevision !== input.baseRevision)) {
    return { status: 'blocked', code: 'invalid_write_revision', diagnostics: ['Canonical write outcome has an invalid or non-contiguous revision transition.'] }
  }

  const changedRefs = sorted(input.changedRefs)
  if (new Set(input.changedRefs).size !== input.changedRefs.length || changedRefs.some((ref) => !/^(entity|relation|claim|observation|event|source|module|thesis|reasoning-edge|theme-group):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref))) {
    return { status: 'blocked', code: 'invalid_write_revision', diagnostics: ['Changed canonical refs must be unique, well-formed Knowledge refs from the write result.'] }
  }
  if (changedRefs.length === 0) {
    return { status: 'no_changes', basedOnRevision: input.committedRevision, candidates: [], diagnostics: ['Canonical write reported no changed refs; scope impact was not expanded.'] }
  }

  let lookup: ThemeScopeImpactLookupResult
  try { lookup = await input.lookupAffectedThemes(changedRefs, input.committedRevision) }
  catch (error) {
    return { status: 'blocked', code: 'scope_ledger_unavailable', diagnostics: [`Affected Theme lookup failed: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (lookup.status === 'failed') {
    return { status: 'blocked', code: 'scope_ledger_unavailable', diagnostics: [`Affected Theme lookup failed: ${lookup.error}`] }
  }
  if (lookup.knowledgeBaseRevision !== input.committedRevision) {
    return { status: 'blocked', code: 'stale_revision', diagnostics: [`Scope impact check expected committed revision ${input.committedRevision}, but the affected Theme lookup is at ${lookup.knowledgeBaseRevision}.`] }
  }

  let assets: Awaited<ReturnType<typeof readCanonicalV04Assets>>
  try { assets = await readCanonicalV04Assets(input.handle.rootRef) }
  catch (error) {
    return { status: 'blocked', code: 'canonical_read_failed', diagnostics: [`Changed canonical refs could not be inspected: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const wanted = new Set(changedRefs)
  const changed = new Map<string, ChangedAsset>()
  for (const entry of assets.objects) {
    if (!wanted.has(entry.value.id)) continue
    const asset = asAsset(entry.value)
    if (asset) changed.set(entry.value.id, asset)
  }
  if (changedRefs.some((ref) => !changed.has(ref))) {
    return { status: 'blocked', code: 'canonical_read_failed', diagnostics: [`One or more changed refs do not resolve in canonical state at revision ${lookup.knowledgeBaseRevision}.`] }
  }

  const allDecisions = lookup.themes.flatMap((theme) => Object.values(theme.currentByCandidateFingerprint).map((entry) => ({ theme, decision: entry.decision })))
  const decisionsByCanonicalRef = new Map<string, Array<{ theme: ThemeScopeLedgerThemeV04; decision: ThemeScopeDecisionV04 }>>()
  for (const item of allDecisions) {
    const canonicalRef = item.decision.candidate.canonicalRef
    if (!canonicalRef) continue
    decisionsByCanonicalRef.set(canonicalRef, [...(decisionsByCanonicalRef.get(canonicalRef) ?? []), item])
  }

  const proposals = new Map<string, ThemeScopeImpactCandidate>()
  const addCandidate = (options: {
    theme: ThemeScopeLedgerThemeV04
    candidate: ThemeScopeCandidateV04
    changeKind: ThemeScopeImpactChangeKind
    rationale: string
    evidenceRefs: readonly string[]
    changedRefs: readonly string[]
  }): void => {
    const candidateFingerprint = fingerprintThemeScopeCandidateV04(options.candidate)
    const prior = decisionFor(options.theme, candidateFingerprint)
    const evidenceRefs = sorted(options.evidenceRefs)
    if (['new_theme_node', 'new_theme_link'].includes(options.changeKind) && !evidenceRefs.some((ref) => ref.startsWith('source:'))) return
    if (prior) {
      if (prior.decision === 'exclude' && options.changeKind === 'excluded_candidate_new_evidence') {
        const priorSources = new Set(prior.evidence.map((item) => item.sourceRef))
        if (!evidenceRefs.some((ref) => ref.startsWith('source:') && !priorSources.has(ref as `source:${string}`))) return
      } else if (prior.decision !== 'include' || !['confirmed_node_changed', 'confirmed_link_changed'].includes(options.changeKind)) return
    }
    const proposalId = `theme-scope-impact:${digest(`${options.theme.themeRef}|${candidateFingerprint}|${evidenceRefs.join('|')}`).slice(0, 40)}`
    const observed = sorted(options.changedRefs).flatMap((ref) => {
      const asset = changed.get(ref)
      return asset ? [{
        ref,
        ...(asset.type === undefined ? {} : { type: asset.type }),
        ...(asset.name === undefined ? {} : { name: asset.name }),
        ...(asset.sourceRef === undefined ? {} : { sourceRef: asset.sourceRef }),
        ...(asset.targetRef === undefined ? {} : { targetRef: asset.targetRef }),
        sourceRefs: sourceRefsOf(asset),
        ...(asset.lifecycle?.status === undefined ? {} : { lifecycleStatus: asset.lifecycle.status }),
      }] : []
    })
    proposals.set(proposalId, {
      proposalId,
      themeRef: options.theme.themeRef,
      candidate: options.candidate,
      candidateFingerprint,
      changeKind: prior?.decision === 'exclude' ? 'excluded_candidate_new_evidence' : options.changeKind,
      ...(prior ? { priorDecision: { id: prior.id, decision: prior.decision } } : {}),
      rationale: options.rationale,
      observed,
      evidenceRefs,
      changedRefs: sorted(options.changedRefs),
      basedOnRevision: lookup.knowledgeBaseRevision,
    })
  }

  for (const ref of changedRefs) {
    const asset = changed.get(ref)!
    const boundDecisions = [
      ...(decisionsByCanonicalRef.get(ref) ?? []),
      ...(asset.subjectRefs ?? []).flatMap((subjectRef) => decisionsByCanonicalRef.get(subjectRef) ?? []),
      ...(asset.sourceRef ? decisionsByCanonicalRef.get(asset.sourceRef) ?? [] : []),
      ...(asset.targetRef ? decisionsByCanonicalRef.get(asset.targetRef) ?? [] : []),
    ]
    for (const { theme, decision } of boundDecisions) {
      const inactive = !isActive(asset)
      if (inactive && decision.decision === 'include') {
        addCandidate({ theme, candidate: decision.candidate, changeKind: decision.candidate.kind === 'industry' ? 'confirmed_node_changed' : 'confirmed_link_changed', rationale: `A previously included canonical ${decision.candidate.kind} changed lifecycle state and may no longer match the confirmed Theme scope.`, evidenceRefs: [...sourceRefsOf(asset), ref], changedRefs: [ref] })
      } else if (decision.decision === 'exclude') {
        addCandidate({ theme, candidate: decision.candidate, changeKind: 'excluded_candidate_new_evidence', rationale: 'New canonical evidence is now attached to a previously excluded candidate; review only if its source is absent from the exclusion decision.', evidenceRefs: [...sourceRefsOf(asset), ref], changedRefs: [ref] })
      }
    }

    if (!ref.startsWith('relation:')) continue
    const relation = asset
    if (relation.type === 'theme_exposure' && typeof relation.sourceRef === 'string' && typeof relation.targetRef === 'string') {
      const theme = lookup.themes.find((item) => item.themeRef === relation.sourceRef)
      const industry = changed.get(relation.targetRef) ?? asAsset(assets.objects.find((item) => item.value.id === relation.targetRef)?.value)
      if (!theme || industry?.type !== 'industry') continue
      const candidate: ThemeScopeCandidateV04 = { kind: 'industry', name: industry.name ?? relation.targetRef, canonicalRef: relation.targetRef as `entity:${string}` }
      const fp = fingerprintThemeScopeCandidateV04(candidate)
      const current = decisionFor(theme, fp)
      if (!isActive(relation)) {
        if (current?.decision === 'include') addCandidate({ theme, candidate, changeKind: 'confirmed_node_changed', rationale: 'A previously active Theme exposure was removed or deactivated; the confirmed Theme node may no longer be in scope.', evidenceRefs: [...sourceRefsOf(relation), relation.id, relation.targetRef], changedRefs: [ref, relation.targetRef] })
        continue
      }
      if (!current) {
        addCandidate({ theme, candidate, changeKind: 'new_theme_node', rationale: 'A newly active Theme exposure links this canonical Industry to the Theme.', evidenceRefs: [...sourceRefsOf(relation), relation.id, relation.targetRef], changedRefs: [ref, relation.targetRef] })
      } else if (current.decision === 'exclude') {
        addCandidate({ theme, candidate, changeKind: 'excluded_candidate_new_evidence', rationale: 'A newly active Theme exposure provides new evidence for a previously excluded Industry.', evidenceRefs: [...sourceRefsOf(relation), relation.id, relation.targetRef], changedRefs: [ref, relation.targetRef] })
      }
      continue
    }

    if ((relation.type !== 'upstream_of' && relation.type !== 'depends_on') || typeof relation.sourceRef !== 'string' || typeof relation.targetRef !== 'string') continue
    const sourceBindings = decisionsByCanonicalRef.get(relation.sourceRef) ?? []
    const targetBindings = decisionsByCanonicalRef.get(relation.targetRef) ?? []
    if (!isActive(relation)) continue
    for (const { theme, decision: sourceDecision } of sourceBindings) {
      if (sourceDecision.candidate.kind !== 'industry' || sourceDecision.decision !== 'include') continue
      const targetDecision = targetBindings.find((item) => item.theme.themeRef === theme.themeRef && item.decision.candidate.kind === 'industry' && item.decision.decision === 'include')?.decision
      if (!targetDecision) continue
      const candidate: ThemeScopeCandidateV04 = { kind: 'relation', relationType: relation.type, sourceFingerprint: sourceDecision.candidateFingerprint, targetFingerprint: targetDecision.candidateFingerprint, canonicalRef: relation.id as `relation:${string}` }
      const prior = decisionFor(theme, fingerprintThemeScopeCandidateV04(candidate))
      addCandidate({ theme, candidate, changeKind: prior?.decision === 'exclude' ? 'excluded_candidate_new_evidence' : 'new_theme_link', rationale: 'A changed canonical Industry relation connects two currently included Theme nodes and may alter the confirmed network.', evidenceRefs: [...sourceRefsOf(relation), relation.id], changedRefs: [ref, relation.sourceRef, relation.targetRef] })
    }
    const relevantThemes = new Set([...sourceBindings, ...targetBindings].map((item) => item.theme.themeRef))
    for (const themeRef of relevantThemes) {
      const theme = lookup.themes.find((item) => item.themeRef === themeRef)
      if (!theme) continue
      const sourceIncluded = sourceBindings.find((item) => item.theme.themeRef === themeRef && item.decision.candidate.kind === 'industry' && item.decision.decision === 'include')
      const targetIncluded = targetBindings.find((item) => item.theme.themeRef === themeRef && item.decision.candidate.kind === 'industry' && item.decision.decision === 'include')
      if (!sourceIncluded && !targetIncluded) continue
      if (Boolean(sourceIncluded) === Boolean(targetIncluded)) continue
      const newRef = sourceIncluded ? relation.targetRef : relation.sourceRef
      const newIndustry = changed.get(newRef) ?? asAsset(assets.objects.find((item) => item.value.id === newRef)?.value)
      if (newIndustry?.type !== 'industry') continue
      const candidate: ThemeScopeCandidateV04 = { kind: 'industry', name: newIndustry.name ?? newRef, canonicalRef: newRef as `entity:${string}` }
      const prior = decisionFor(theme, fingerprintThemeScopeCandidateV04(candidate))
      addCandidate({ theme, candidate, changeKind: prior?.decision === 'exclude' ? 'excluded_candidate_new_evidence' : 'new_theme_node', rationale: 'A newly changed, evidence-backed Industry relation reaches a canonical Industry without an active included scope decision.', evidenceRefs: [...sourceRefsOf(relation), relation.id], changedRefs: [ref, newRef] })
    }
  }

  for (const ref of changedRefs) {
    const relation = changed.get(ref)!
    if (!ref.startsWith('relation:')) continue
    for (const { theme, decision } of decisionsByCanonicalRef.get(ref) ?? []) {
      if (decision.decision !== 'include' || decision.candidate.kind !== 'relation') continue
      const relationCandidate = decision.candidate
      const sourceDecision = allDecisions.find((item) => item.theme.themeRef === theme.themeRef && item.decision.candidateFingerprint === relationCandidate.sourceFingerprint)?.decision
      const targetDecision = allDecisions.find((item) => item.theme.themeRef === theme.themeRef && item.decision.candidateFingerprint === relationCandidate.targetFingerprint)?.decision
      if (sourceDecision?.candidate.kind !== 'industry' || targetDecision?.candidate.kind !== 'industry') continue
      const bindingChanged = !isActive(relation)
        || relation.type !== relationCandidate.relationType
        || relation.sourceRef !== sourceDecision.candidate.canonicalRef
        || relation.targetRef !== targetDecision.candidate.canonicalRef
      if (bindingChanged) addCandidate({ theme, candidate: relationCandidate, changeKind: 'confirmed_link_changed', rationale: 'A canonical Relation bound to a confirmed Theme link now has different endpoints or relation type.', evidenceRefs: [...sourceRefsOf(relation), ref], changedRefs: [ref] })
    }
  }

  // Also evaluate written/updated Theme exposures whose Industry node was not
  // included in changedRefs (for example an already-existing canonical node).
  const result = [...proposals.values()].sort((left, right) => left.themeRef.localeCompare(right.themeRef)
    || left.candidateFingerprint.localeCompare(right.candidateFingerprint) || left.proposalId.localeCompare(right.proposalId))
  return { status: 'completed', basedOnRevision: lookup.knowledgeBaseRevision, candidates: result, diagnostics: [] }
}
