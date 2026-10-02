import { KNOWLEDGE_SCHEMA_V04 } from '../../knowledge/schema/executable-schema-v04.ts'
import type { RawRefV04, SourceRefV04 } from '../../knowledge/schema/domain-v04.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import type { KnowledgeProductionProposal, ProductionEntityInput, SemanticProductionProposal } from '../../knowledge/production/contracts.ts'
import type { StructuredDocument } from '../../plugins/document/contracts.ts'
import type { ClaimCandidate, EntityCandidate, RelationCandidate } from '../../skills/knowledge-curation/contracts.ts'
import type { ConsolidatedExtraction } from './extraction/consolidation.ts'

export interface RawDocumentV04ProposalMappingInput {
  readonly consolidated: ConsolidatedExtraction
  readonly document: StructuredDocument
  readonly sourceRef: SourceRefV04
  readonly rawRef: RawRefV04
  /** Only these extraction candidates may be converted to Knowledge proposals. Defaults to none. */
  readonly approvedCandidateIds?: readonly string[]
}

export type RawDocumentV04MappingDisposition = 'root' | 'mapped' | 'skip' | 'review'

export interface RawDocumentV04MappingDecision {
  readonly candidateId: string
  readonly kind: 'entity' | 'relation' | 'claim' | 'unknown'
  readonly disposition: RawDocumentV04MappingDisposition
  readonly reasonCode: string
  readonly reason: string
  readonly dependencyCandidateIds?: readonly string[]
  readonly unresolvedEvidenceBlockRefs?: readonly string[]
  readonly proposalId?: string
  readonly localKey?: string
}

export interface RawDocumentV04ProposalMappingResult {
  /** Undefined when no explicitly approved, supported Entity can serve as the Gateway root. */
  readonly entity: ProductionEntityInput | undefined
  readonly proposals: readonly KnowledgeProductionProposal[]
  readonly decisions: readonly RawDocumentV04MappingDecision[]
}

const supportedEntityTypes = new Set(['company', 'industry', 'product', 'technology'])
const supportedRelationTypes = new Set<string>(KNOWLEDGE_SCHEMA_V04.relation.types.filter((type) => type !== 'theme_exposure'))
const supportedClaimTypes = new Set(['fact', 'forecast', 'viewpoint', 'trend', 'risk'])
const safeLocalId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function stableSuffix(kind: string, candidateId: string): string {
  return hashKnowledgeObject({ kind, candidateId }).slice(7, 23)
}

function localKey(kind: string, candidateId: string): string {
  return `raw-${kind}-${stableSuffix(kind, candidateId)}`
}

function proposalId(kind: string, candidateId: string): string {
  return `raw-${kind}-${stableSuffix(kind, candidateId)}`
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}

function candidateEvidence(
  refs: readonly string[],
  blockOrder: ReadonlyMap<string, number>,
  sourceRef: SourceRefV04,
  rawRef: RawRefV04,
): { bindings?: SemanticProductionProposal['existingEvidenceBindings']; missing: readonly string[] } {
  const uniqueRefs = [...new Set(refs)]
  if (uniqueRefs.length === 0) return { missing: ['<no-evidence-block-refs>'] }
  const missing = uniqueRefs.filter((ref) => !blockOrder.has(ref)).sort(compareText)
  if (missing.length > 0) return { missing }
  const ordered = uniqueRefs.sort((left, right) => (blockOrder.get(left)! - blockOrder.get(right)!) || compareText(left, right))
  return {
    bindings: ordered.map((blockId) => ({ sourceRef, rawRef, locator: blockId })),
    missing: [],
  }
}

function decision(
  candidateId: string,
  kind: RawDocumentV04MappingDecision['kind'],
  disposition: RawDocumentV04MappingDisposition,
  reasonCode: string,
  reason: string,
  extra: Pick<RawDocumentV04MappingDecision, 'dependencyCandidateIds' | 'unresolvedEvidenceBlockRefs' | 'proposalId' | 'localKey'> = {},
): RawDocumentV04MappingDecision {
  return { candidateId, kind, disposition, reasonCode, reason, ...extra }
}

function companySemanticFields(candidate: EntityCandidate): Record<string, unknown> | undefined {
  const fields = candidate.semanticFields ?? {}
  const allowed = candidate.entityType === 'company' ? new Set(['ticker', 'exchange', 'legalName']) : new Set<string>()
  const unsupported = Object.keys(fields).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) return undefined
  for (const key of Object.keys(fields)) {
    const value = fields[key]
    if (typeof value !== 'string' || value.trim() === '') return undefined
  }
  return Object.fromEntries(Object.entries(fields).sort(([left], [right]) => compareText(left, right)))
}

function entityFields(candidate: EntityCandidate): Record<string, unknown> | undefined {
  const semantic = companySemanticFields(candidate)
  if (semantic === undefined) return undefined
  const aliases = [...new Set((candidate.aliases ?? []).map((value) => value.trim()).filter(Boolean))].sort(compareText)
  const description = typeof candidate.description === 'string' && candidate.description.trim() !== '' ? candidate.description.trim() : undefined
  return {
    ...(aliases.length === 0 ? {} : { aliases }),
    ...(description === undefined ? {} : { description }),
    ...semantic,
  }
}

function asEntityCandidate(candidate: unknown): candidate is EntityCandidate {
  if (typeof candidate !== 'object' || candidate === null) return false
  const value = candidate as Partial<EntityCandidate>
  return typeof value.candidateId === 'string' && typeof value.entityType === 'string' && typeof value.name === 'string'
}

function asRelationCandidate(candidate: unknown): candidate is RelationCandidate {
  if (typeof candidate !== 'object' || candidate === null) return false
  const value = candidate as Partial<RelationCandidate>
  return typeof value.candidateId === 'string' && typeof value.relationType === 'string' && typeof value.source === 'object' && value.source !== null && typeof value.target === 'object' && value.target !== null
}

function asClaimCandidate(candidate: unknown): candidate is ClaimCandidate {
  if (typeof candidate !== 'object' || candidate === null) return false
  const value = candidate as Partial<ClaimCandidate>
  return typeof value.candidateId === 'string' && typeof value.claimType === 'string' && typeof value.statement === 'string' && Array.isArray(value.subjectRefs)
}

function rootRank(candidate: EntityCandidate, consolidated: ConsolidatedExtraction): readonly [number, number, string, string] {
  const support = consolidated.candidateSupport.get(candidate.candidateId)?.supportingCandidateCount ?? 0
  const typePriority: Record<string, number> = { industry: 0, company: 1, technology: 2, product: 3 }
  return [-support, typePriority[candidate.entityType] ?? 99, candidate.name.trim().toLocaleLowerCase(), candidate.candidateId]
}

function compareRank(left: readonly [number, number, string, string], right: readonly [number, number, string, string]): number {
  return left[0] - right[0] || left[1] - right[1] || compareText(left[2], right[2]) || compareText(left[3], right[3])
}

/**
 * Converts only explicitly accepted, evidence-grounded extraction candidates to
 * producer-facing Schema 0.4 proposals. It performs no IO, Gateway call, or write.
 */
export function mapRawDocumentExtractionToV04Proposals(input: RawDocumentV04ProposalMappingInput): RawDocumentV04ProposalMappingResult {
  if (!/^source:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.sourceRef)) throw new TypeError('sourceRef must be a canonical Source ref')
  if (!/^raw-sha256-[0-9a-f]{64}$/.test(input.rawRef)) throw new TypeError('rawRef must be a canonical SHA-256 Raw ref')

  const blockOrder = new Map<string, number>()
  for (const block of input.document.blocks) {
    if (blockOrder.has(block.blockId)) throw new TypeError(`StructuredDocument has duplicate blockId: ${block.blockId}`)
    blockOrder.set(block.blockId, block.order)
  }

  const groups = [...input.consolidated.groups].sort((left, right) => compareText(left.candidateId, right.candidateId))
  const groupsById = new Map(groups.map((group) => [group.candidateId, group]))
  const approvedIds = new Set(input.approvedCandidateIds ?? [])
  const decisions = new Map<string, RawDocumentV04MappingDecision>()
  const acceptedEntities = new Map<string, EntityCandidate>()
  const entityBindings = new Map<string, NonNullable<SemanticProductionProposal['existingEvidenceBindings']>>()
  const acceptedRelations = new Map<string, string>()

  for (const group of groups) {
    if (!approvedIds.has(group.candidateId)) {
      decisions.set(group.candidateId, decision(group.candidateId, group.kind, 'skip', 'not_explicitly_approved', 'Candidate was not explicitly approved for canonical Knowledge production.'))
      continue
    }
    if (group.kind !== 'entity') continue
    if (!asEntityCandidate(group.candidate)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'invalid_entity_candidate', 'Approved candidate does not satisfy the Entity candidate contract.'))
      continue
    }
    const candidate = group.candidate
    if (candidate.entityType === 'investment_theme') {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'theme_requires_framework_workflow', 'Raw document ingestion cannot create or initialize an InvestmentTheme; use the Theme Framework workflow.'))
      continue
    }
    if (!supportedEntityTypes.has(candidate.entityType)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'unsupported_entity_type', `Entity type ${candidate.entityType} is not supported by this raw document mapper.`))
      continue
    }
    if (!candidate.name.trim() || !safeLocalId.test(candidate.candidateId)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'invalid_entity_identity', 'Approved Entity must have a non-empty name and a safe local candidate ID.'))
      continue
    }
    const fields = entityFields(candidate)
    if (fields === undefined) {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'unsupported_entity_fields', 'Entity contains semantic fields that this Schema 0.4 proposal contract cannot safely persist.'))
      continue
    }
    const evidence = candidateEvidence(candidate.evidenceBlockRefs, blockOrder, input.sourceRef, input.rawRef)
    if (!evidence.bindings) {
      decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'review', 'unresolved_evidence', 'Every approved Entity evidence block must resolve to an exact StructuredDocument block.', { unresolvedEvidenceBlockRefs: evidence.missing }))
      continue
    }
    acceptedEntities.set(group.candidateId, candidate)
    entityBindings.set(group.candidateId, evidence.bindings)
    decisions.set(group.candidateId, decision(group.candidateId, 'entity', 'mapped', 'entity_candidate_accepted', 'Approved Entity is eligible for the Gateway proposal set.', { proposalId: proposalId('entity', group.candidateId), localKey: localKey('entity', group.candidateId) }))
  }

  const rootCandidate = [...acceptedEntities.values()].sort((left, right) => compareRank(rootRank(left, input.consolidated), rootRank(right, input.consolidated)))[0]
  const entity: ProductionEntityInput | undefined = rootCandidate === undefined ? undefined : {
    localKey: localKey('entity', rootCandidate.candidateId),
    entityType: rootCandidate.entityType as ProductionEntityInput['entityType'],
    name: rootCandidate.name.trim(),
    aliases: [...new Set((rootCandidate.aliases ?? []).map((value) => value.trim()).filter(Boolean))].sort(compareText),
    ...(Object.keys(entityFields(rootCandidate) ?? {}).length === 0 ? {} : { semanticFields: entityFields(rootCandidate) }),
  }
  if (rootCandidate) decisions.set(rootCandidate.candidateId, decision(rootCandidate.candidateId, 'entity', 'root', 'selected_as_root_entity', 'Deterministic root Entity selected by support count, type priority, name, and candidate ID.', { proposalId: proposalId('entity', rootCandidate.candidateId), localKey: localKey('entity', rootCandidate.candidateId) }))

  const proposals: KnowledgeProductionProposal[] = []
  for (const [candidateId, candidate] of [...acceptedEntities.entries()].sort(([left], [right]) => compareText(left, right))) {
    const fields = entityFields(candidate) ?? {}
    const proposal: SemanticProductionProposal = {
      proposalId: proposalId('entity', candidateId),
      kind: 'entity',
      subjectKey: localKey('entity', candidateId),
      entityType: candidate.entityType as SemanticProductionProposal['entityType'],
      entityName: candidate.name.trim(),
      ...(Object.keys(fields).length === 0 ? {} : { structuredValue: fields }),
      ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
      existingEvidenceBindings: entityBindings.get(candidateId),
    }
    proposals.push(proposal)
  }

  for (const group of groups.filter((item) => item.kind === 'relation')) {
    if (!approvedIds.has(group.candidateId)) continue
    if (!asRelationCandidate(group.candidate)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'relation', 'review', 'invalid_relation_candidate', 'Approved candidate does not satisfy the Relation candidate contract.'))
      continue
    }
    const candidate = group.candidate
    if (!supportedRelationTypes.has(candidate.relationType)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'relation', 'review', 'unsupported_relation_type', `Relation type ${candidate.relationType} is unavailable to the Schema 0.4 raw document mapper.`))
      continue
    }
    const dependencyIds = [...new Set([candidate.source.candidateRef, candidate.target.candidateRef])].sort(compareText)
    const unresolvedDependencies = dependencyIds.filter((id) => !acceptedEntities.has(id))
    if (unresolvedDependencies.length > 0) {
      decisions.set(group.candidateId, decision(group.candidateId, 'relation', 'review', 'relation_dependency_not_approved', 'Relation endpoints must each be explicitly approved, supported, and evidence-grounded Entity candidates.', { dependencyCandidateIds: unresolvedDependencies }))
      continue
    }
    const evidence = candidateEvidence(candidate.evidenceBlockRefs, blockOrder, input.sourceRef, input.rawRef)
    if (!evidence.bindings) {
      decisions.set(group.candidateId, decision(group.candidateId, 'relation', 'review', 'unresolved_evidence', 'Every approved Relation evidence block must resolve to an exact StructuredDocument block.', { unresolvedEvidenceBlockRefs: evidence.missing, dependencyCandidateIds: dependencyIds }))
      continue
    }
    const id = proposalId('relation', group.candidateId)
    proposals.push({
      proposalId: id,
      kind: 'relation',
      subjectKey: localKey('entity', candidate.source.candidateRef),
      targetKey: localKey('entity', candidate.target.candidateRef),
      relationType: candidate.relationType,
      ...(candidate.attributes === undefined ? {} : { attributes: candidate.attributes }),
      ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
      existingEvidenceBindings: evidence.bindings,
    })
    acceptedRelations.set(group.candidateId, id)
    decisions.set(group.candidateId, decision(group.candidateId, 'relation', 'mapped', 'directed_relation_mapped', 'Approved directed Relation preserves its source and target candidate order.', { dependencyCandidateIds: dependencyIds, proposalId: id }))
  }

  for (const group of groups.filter((item) => item.kind === 'claim')) {
    if (!approvedIds.has(group.candidateId)) continue
    if (!asClaimCandidate(group.candidate)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'invalid_claim_candidate', 'Approved candidate does not satisfy the Claim candidate contract.'))
      continue
    }
    const candidate = group.candidate
    if (!supportedClaimTypes.has(candidate.claimType)) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'unsupported_claim_type', `Claim type ${candidate.claimType} is not supported by raw document Knowledge production.`))
      continue
    }
    if (candidate.subjectRefs.length !== 1) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'claim_subject_cardinality', 'A canonical Claim must resolve to exactly one Entity subject.'))
      continue
    }
    const subjectId = candidate.subjectRefs[0]!.candidateRef
    const subjectKey = acceptedEntities.has(subjectId)
      ? localKey('entity', subjectId)
      : acceptedRelations.get(subjectId)
    if (!subjectKey) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'claim_subject_not_approved', 'Claim subject must resolve to an explicitly approved, supported, evidence-grounded Entity or Relation; no root fallback is permitted.', { dependencyCandidateIds: [subjectId] }))
      continue
    }
    if (!candidate.statement.trim()) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'invalid_claim_statement', 'Approved Claim must have a non-empty statement.'))
      continue
    }
    const evidence = candidateEvidence(candidate.evidenceBlockRefs, blockOrder, input.sourceRef, input.rawRef)
    if (!evidence.bindings) {
      decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'review', 'unresolved_evidence', 'Every approved Claim evidence block must resolve to an exact StructuredDocument block.', { unresolvedEvidenceBlockRefs: evidence.missing, dependencyCandidateIds: [subjectId] }))
      continue
    }
    const id = proposalId('claim', group.candidateId)
    proposals.push({
      proposalId: id,
      kind: 'claim',
      subjectKey,
      claimType: candidate.claimType as SemanticProductionProposal['claimType'],
      statement: candidate.statement.trim(),
      ...(candidate.temporal == null ? {} : { temporal: candidate.temporal }),
      ...(candidate.structuredValue == null ? {} : { structuredValue: candidate.structuredValue }),
      ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
      existingEvidenceBindings: evidence.bindings,
    })
    decisions.set(group.candidateId, decision(group.candidateId, 'claim', 'mapped', 'claim_mapped', 'Approved Claim is bound to its single approved Entity or Relation subject and exact source blocks.', { dependencyCandidateIds: [subjectId], proposalId: id }))
  }

  for (const candidateId of [...approvedIds].sort(compareText)) {
    if (groupsById.has(candidateId)) continue
    decisions.set(candidateId, decision(candidateId, 'unknown', 'review', 'approved_candidate_not_found', 'An explicitly approved candidate ID is absent from consolidated extraction.'))
  }

  const kindOrder: Record<RawDocumentV04MappingDecision['kind'], number> = { entity: 0, relation: 1, claim: 2, unknown: 3 }
  const orderedDecisions = [...decisions.values()].sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || compareText(left.candidateId, right.candidateId))
  const orderedProposals = proposals.sort((left, right) => compareText(left.proposalId, right.proposalId))
  return { entity, proposals: orderedProposals, decisions: orderedDecisions }
}
