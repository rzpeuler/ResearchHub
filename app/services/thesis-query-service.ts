import type { ClaimTypeV04, KillCriterionOriginV04, KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEntityV04, KnowledgeReasoningEdgeV04, KnowledgeThesisV04, ThesisRefV04, ThesisStatusV04 } from '../../knowledge/schema/domain-v04.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { loadKnowledgeBaseManifest } from '../../knowledge/storage/manifest-loader.ts'
import { ApplicationServiceError } from './contracts.ts'

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 50
const HARD_PROPOSITION_LIMIT = 40
const HARD_SOURCE_REFS_PER_PROPOSITION = 50
const HARD_STATEMENT_LENGTH = 4_000
const HARD_TITLE_LENGTH = 300
const HARD_KILL_CRITERION_REVISIONS = 100
const CLAIM_TYPES = new Set<ClaimTypeV04>(['fact', 'forecast', 'viewpoint', 'trend', 'risk', 'assumption', 'catalyst'])
const TERMINAL_THESIS_STATUSES = new Set<ThesisStatusV04>(['invalidated', 'archived'])
const LIFECYCLE_STATUSES = new Set(['active', 'expired', 'superseded', 'archived'])

export interface ThesisQuerySummary {
  readonly thesisRef: ThesisRefV04
  readonly title: string
  readonly statement: string
  readonly status: ThesisStatusV04
  readonly companySubject: { readonly companyRef: string; readonly name: string }
  readonly lastReviewedAt: string | null
  readonly propositionCount: number
}

export interface ThesisQueryListResult {
  readonly theses: readonly ThesisQuerySummary[]
  readonly total: number
  readonly limit: number
  readonly truncated: boolean
  readonly revision: number
}

export interface ThesisQueryProposition {
  readonly claimRef: string
  readonly statement: string
  readonly claimType: ClaimTypeV04
  readonly sourceRefs: readonly string[]
  readonly membershipEdgeRef: string
}

export interface ThesisQueryKillCriterion {
  readonly conditionId: string
  readonly revision: number
  readonly state: 'active' | 'superseded'
  readonly type: string
  readonly definitionVersion: number
  readonly definition: Readonly<Record<string, unknown>>
  readonly targetClaimRefs: readonly string[]
  readonly effectiveAt: string
  readonly definitionHash: string
  readonly origin: KillCriterionOriginV04
  readonly authority: { readonly workflowRunId: string; readonly confirmedAt: string }
}

export interface ThesisQueryDetail extends ThesisQuerySummary {
  readonly propositions: readonly ThesisQueryProposition[]
  readonly propositionRefs: readonly string[]
  readonly membershipEdgeRefs: readonly string[]
  readonly killCriteria: readonly ThesisQueryKillCriterion[]
  readonly revision: number
}

interface Snapshot {
  readonly revision: number
  readonly objects: readonly { readonly kind: string; readonly value: KnowledgeAssetV04 }[]
}

function invalid(message: string): never { throw new ApplicationServiceError('conflict', message) }
function active(value: { readonly lifecycle?: { readonly status?: unknown } }): boolean { return value.lifecycle?.status === 'active' }
function checkedText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }

export class ThesisQueryService {
  constructor(private readonly mountedKnowledgeBaseRoot?: string) {}

  private root(): string {
    if (!this.mountedKnowledgeBaseRoot || !this.mountedKnowledgeBaseRoot.trim()) throw new ApplicationServiceError('no_kb_mounted', 'No canonical Knowledge Base is mounted')
    return this.mountedKnowledgeBaseRoot
  }

  private async snapshot(): Promise<Snapshot> {
    const root = this.root()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await loadKnowledgeBaseManifest(root)
      if (before.schemaVersion !== '0.4' || before.storageFormatVersion !== '1') throw new ApplicationServiceError('failed', 'Thesis queries require a mounted Schema 0.4 / Storage Format 1 Knowledge Base')
      const collection = await readCanonicalV04Assets(root)
      const after = await loadKnowledgeBaseManifest(root)
      if (before.revision === after.revision && before.knowledgeBaseId === after.knowledgeBaseId && before.schemaVersion === after.schemaVersion) return { revision: after.revision, objects: collection.objects }
    }
    throw new ApplicationServiceError('conflict', 'Knowledge Base changed while loading the Thesis projection')
  }

  private project(snapshot: Snapshot, thesisRef: string): ThesisQueryDetail | undefined {
    const byId = new Map<string, { kind: string; value: KnowledgeAssetV04 }>(snapshot.objects.map((item) => [item.value.id, item]))
    const loadedThesis = byId.get(thesisRef)
    if (!loadedThesis || loadedThesis.kind !== 'thesis') return undefined
    const thesis = loadedThesis.value as KnowledgeThesisV04
    if (!active(thesis) || TERMINAL_THESIS_STATUSES.has(thesis.status)) return undefined
    if (!checkedText(thesis.title) || thesis.title.length > HARD_TITLE_LENGTH || !checkedText(thesis.statement) || thesis.statement.length > HARD_STATEMENT_LENGTH || !Array.isArray(thesis.subjectRefs) || thesis.subjectRefs.length !== 1 || typeof thesis.subjectRefs[0] !== 'string') invalid(`Thesis has malformed identity or unsupported subject: ${thesisRef}`)
    const subject = byId.get(thesis.subjectRefs[0])
    if (!subject || subject.kind !== 'entity') invalid(`Thesis subject is missing or is not an Entity: ${thesisRef}`)
    const company = subject.value as KnowledgeEntityV04
    if (company.type !== 'company' || !active(company) || !checkedText(company.name)) invalid(`Thesis subject is not an active Company: ${thesisRef}`)

    const candidates = snapshot.objects.filter((item) => item.kind === 'reasoning_edge' && (item.value as KnowledgeReasoningEdgeV04).type === 'qualifies' && (item.value as KnowledgeReasoningEdgeV04).targetRef === thesisRef)
    const propositions: ThesisQueryProposition[] = []
    const claimsSeen = new Set<string>()
    for (const item of candidates) {
      const edge = item.value as KnowledgeReasoningEdgeV04
      if (!edge.lifecycle || !LIFECYCLE_STATUSES.has(edge.lifecycle.status)) invalid(`Thesis has malformed qualifying membership lifecycle: ${edge.id}`)
      if (!active(edge)) continue
      if (!checkedText(edge.id) || typeof edge.sourceRef !== 'string' || !edge.sourceRef.startsWith('claim:') || edge.targetRef !== thesisRef) invalid(`Thesis has malformed qualifying membership edge: ${edge.id}`)
      const claimAsset = byId.get(edge.sourceRef)
      if (!claimAsset || claimAsset.kind !== 'claim') invalid(`Thesis membership references a missing or non-Claim source: ${edge.id}`)
      const claim = claimAsset.value as KnowledgeClaimV04
      if (!claim.lifecycle || !LIFECYCLE_STATUSES.has(claim.lifecycle.status)) invalid(`Thesis membership has malformed Claim lifecycle: ${claim.id}`)
      if (!claim || claim.id !== edge.sourceRef || !active(claim)) continue
      if (claimsSeen.has(claim.id)) invalid(`Thesis has ambiguous duplicate qualifying membership for Claim: ${claim.id}`)
      claimsSeen.add(claim.id)
      if (!checkedText(claim.statement) || claim.statement.length > HARD_STATEMENT_LENGTH || !CLAIM_TYPES.has(claim.claimType) || claim.claimType === 'thesis' || !Array.isArray(claim.subjectRefs) || claim.subjectRefs.length !== 1 || claim.subjectRefs[0] !== company.id || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length > HARD_SOURCE_REFS_PER_PROPOSITION || claim.sourceRefs.some((ref) => typeof ref !== 'string' || !ref.startsWith('source:')) || new Set(claim.sourceRefs).size !== claim.sourceRefs.length) invalid(`Thesis membership has a malformed or mis-scoped Claim: ${claim.id}`)
      for (const sourceRef of claim.sourceRefs) if (byId.get(sourceRef)?.kind !== 'source') invalid(`Thesis Claim references a missing Source: ${claim.id}`)
      propositions.push({ claimRef: claim.id, statement: claim.statement, claimType: claim.claimType, sourceRefs: [...claim.sourceRefs], membershipEdgeRef: edge.id })
    }
    propositions.sort((left, right) => left.claimRef.localeCompare(right.claimRef))
    if (propositions.length > HARD_PROPOSITION_LIMIT) invalid(`Thesis has more than ${HARD_PROPOSITION_LIMIT} active propositions: ${thesisRef}`)
    const canonicalCriteria = thesis.killCriteria ?? []
    if (!Array.isArray(canonicalCriteria) || canonicalCriteria.length > HARD_KILL_CRITERION_REVISIONS) invalid(`Thesis has a malformed or oversized Kill Criterion history: ${thesisRef}`)
    const killCriteria: ThesisQueryKillCriterion[] = canonicalCriteria.map((criterion) => {
      if (!criterion || typeof criterion.conditionId !== 'string' || !Number.isSafeInteger(criterion.revision) || criterion.revision < 1 || (criterion.state !== 'active' && criterion.state !== 'superseded') || typeof criterion.type !== 'string' || !Number.isSafeInteger(criterion.definitionVersion) || !criterion.definition || typeof criterion.definition !== 'object' || Array.isArray(criterion.definition) || !Array.isArray(criterion.targetClaimRefs) || criterion.targetClaimRefs.length > 32 || typeof criterion.effectiveAt !== 'string' || typeof criterion.definitionHash !== 'string' || !criterion.authority || typeof criterion.authority.workflowRunId !== 'string' || typeof criterion.authority.confirmedAt !== 'string' || !criterion.authority.origin || typeof criterion.authority.origin !== 'object') invalid(`Thesis has a malformed Kill Criterion revision: ${thesisRef}`)
      return {
        conditionId: criterion.conditionId, revision: criterion.revision, state: criterion.state, type: criterion.type,
        definitionVersion: criterion.definitionVersion, definition: { ...criterion.definition },
        targetClaimRefs: [...criterion.targetClaimRefs], effectiveAt: criterion.effectiveAt,
        definitionHash: criterion.definitionHash, origin: { ...criterion.authority.origin },
        authority: { workflowRunId: criterion.authority.workflowRunId, confirmedAt: criterion.authority.confirmedAt },
      }
    }).sort((left, right) => left.conditionId.localeCompare(right.conditionId) || left.revision - right.revision)
    return {
      thesisRef: thesis.id, title: thesis.title, statement: thesis.statement, status: thesis.status,
      companySubject: { companyRef: company.id, name: company.name }, lastReviewedAt: thesis.lastReviewedAt ?? null,
      propositionCount: propositions.length, propositions, propositionRefs: propositions.map((item) => item.claimRef),
      membershipEdgeRefs: propositions.map((item) => item.membershipEdgeRef), killCriteria, revision: snapshot.revision,
    }
  }

  async listTheses(limit?: number): Promise<ThesisQueryListResult> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ApplicationServiceError('invalid_input', `limit must be a positive integer up to ${HARD_LIMIT}`)
    const boundedLimit = Math.min(limit ?? DEFAULT_LIMIT, HARD_LIMIT)
    const snapshot = await this.snapshot()
    const refs = snapshot.objects.filter((item) => item.kind === 'thesis' && active(item.value as KnowledgeThesisV04) && !TERMINAL_THESIS_STATUSES.has((item.value as KnowledgeThesisV04).status)).map((item) => item.value.id).sort((a, b) => a.localeCompare(b))
    const theses = refs.map((ref) => this.project(snapshot, ref)!).filter(Boolean)
    return { theses: theses.slice(0, boundedLimit), total: theses.length, limit: boundedLimit, truncated: theses.length > boundedLimit, revision: snapshot.revision }
  }

  async getThesis(thesisRef: string): Promise<ThesisQueryDetail> {
    if (typeof thesisRef !== 'string' || !/^thesis:[A-Za-z0-9._-]+$/.test(thesisRef)) throw new ApplicationServiceError('invalid_input', 'thesisRef must be an exact canonical Thesis reference')
    const snapshot = await this.snapshot()
    const result = this.project(snapshot, thesisRef)
    if (!result) throw new ApplicationServiceError('not_found', `Active Thesis not found: ${thesisRef}`)
    return result
  }
}
