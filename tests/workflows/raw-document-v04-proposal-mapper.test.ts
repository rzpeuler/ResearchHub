import assert from 'node:assert/strict'
import test from 'node:test'
import type { SourceRefV04, RawRefV04 } from '../../knowledge/schema/domain-v04.ts'
import type { SemanticProductionProposal } from '../../knowledge/production/contracts.ts'
import type { ConsolidatedExtraction } from '../../workflows/raw-document-knowledge-ingestion/extraction/consolidation.ts'
import { mapRawDocumentExtractionToV04Proposals } from '../../workflows/raw-document-knowledge-ingestion/v04-proposal-mapper.ts'
import type { ClaimCandidate, EntityCandidate, RelationCandidate } from '../../skills/knowledge-curation/contracts.ts'
import type { StructuredDocument } from '../../plugins/document/contracts.ts'

const sourceRef = 'source:document-1' as SourceRefV04
const rawRef = `raw-sha256-${'a'.repeat(64)}` as RawRefV04

function entity(candidateId: string, name: string, entityType: EntityCandidate['entityType'], evidenceBlockRefs: readonly string[] = ['block-1'], extra: Partial<EntityCandidate> = {}): EntityCandidate {
  return { candidateId, name, entityType, evidenceBlockRefs, reason: 'Grounded extraction candidate.', ...extra }
}

function relation(candidateId: string, relationType: RelationCandidate['relationType'], source: string, target: string, evidenceBlockRefs: readonly string[] = ['block-2']): RelationCandidate {
  return { candidateId, relationType, source: { candidateRef: source, mention: source }, target: { candidateRef: target, mention: target }, evidenceBlockRefs, reason: 'Grounded directed relation.' }
}

function claim(candidateId: string, subjectIds: readonly string[], evidenceBlockRefs: readonly string[] = ['block-2']): ClaimCandidate {
  return { candidateId, claimType: 'fact', statement: `Statement for ${candidateId}.`, subjectRefs: subjectIds.map((candidateRef) => ({ candidateRef, mention: candidateRef })), evidenceBlockRefs, reason: 'Grounded claim.' }
}

function document(blockIds: readonly string[] = ['block-1', 'block-2']): StructuredDocument {
  const blocks = blockIds.map((blockId, index) => ({ blockId, type: 'paragraph' as const, text: `Evidence ${blockId}`, sectionRef: null, page: index + 1, locator: { page: index + 1, parserItemRef: `item-${index + 1}` }, order: index + 1 }))
  return {
    documentId: 'document-1', parser: { id: 'fixture' }, metadata: { originalFilename: 'report.pdf', mediaType: 'application/pdf' }, normalizedText: blocks.map((block) => block.text).join('\n'), sections: [], blocks,
    stats: { pageCount: blocks.length, sectionCount: 0, blockCount: blocks.length, normalizedCharacters: 0, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [],
  }
}

function consolidated(...groups: ConsolidatedExtraction['groups']): ConsolidatedExtraction {
  const entities = groups.filter((group) => group.kind === 'entity').map((group) => [group.candidateId, group.candidate as EntityCandidate] as const)
  return {
    groups,
    reviewConstraints: [],
    rejected: [],
    candidateCounts: { entity: entities.length, relation: 0, claim: 0, consolidated: groups.length, rejected: 0 },
    candidateAliases: new Map(),
    entityCandidates: new Map(entities),
    candidateSupport: new Map(entities.map(([id, candidate]) => [id, { supportingCandidateCount: id.includes('industry') ? 3 : 1, supportingUnitIds: ['unit-1'], evidenceBlockRefs: candidate.evidenceBlockRefs }])),
  }
}

function group(candidate: EntityCandidate | RelationCandidate | ClaimCandidate, kind: 'entity' | 'relation' | 'claim') {
  return { candidateId: candidate.candidateId, kind, candidate } as const
}

function map(input: Partial<Parameters<typeof mapRawDocumentExtractionToV04Proposals>[0]> & { consolidated: ConsolidatedExtraction }) {
  return mapRawDocumentExtractionToV04Proposals({ consolidated: input.consolidated, document: input.document ?? document(), sourceRef, rawRef, ...(input.approvedCandidateIds === undefined ? {} : { approvedCandidateIds: input.approvedCandidateIds }) })
}

test('unselected extraction candidates stay skipped and default approval set is empty', () => {
  const industry = entity('industry-ai', 'AI Computing', 'industry')
  const statement = claim('claim-growth', [industry.candidateId])
  const source = consolidated(group(industry, 'entity'), group(statement, 'claim'))

  const withoutSelection = map({ consolidated: source })
  assert.equal(withoutSelection.entity, undefined)
  assert.deepEqual(withoutSelection.proposals, [])
  assert.deepEqual(withoutSelection.decisions.map((item) => item.disposition), ['skip', 'skip'])

  const selectedEntity = map({ consolidated: source, approvedCandidateIds: [industry.candidateId] })
  assert.ok(selectedEntity.entity)
  assert.equal(selectedEntity.proposals.length, 1)
  assert.equal(selectedEntity.decisions.find((item) => item.candidateId === statement.candidateId)?.reasonCode, 'not_explicitly_approved')
})

test('approved InvestmentTheme candidates are routed to Theme Framework review and never become raw-ingestion roots', () => {
  const theme = entity('theme-ai', 'AI Computing', 'investment_theme')
  const result = map({ consolidated: consolidated(group(theme, 'entity')), approvedCandidateIds: [theme.candidateId] })
  assert.equal(result.entity, undefined)
  assert.deepEqual(result.proposals, [])
  assert.equal(result.decisions[0]?.disposition, 'review')
  assert.equal(result.decisions[0]?.reasonCode, 'theme_requires_framework_workflow')
})

test('approved candidates with missing document evidence are retained as review decisions', () => {
  const company = entity('company-alpha', 'Alpha Systems', 'company', ['missing-block'])
  const result = map({ consolidated: consolidated(group(company, 'entity')), approvedCandidateIds: [company.candidateId] })
  assert.equal(result.entity, undefined)
  assert.deepEqual(result.proposals, [])
  assert.deepEqual(result.decisions[0]?.unresolvedEvidenceBlockRefs, ['missing-block'])
  assert.equal(result.decisions[0]?.reasonCode, 'unresolved_evidence')
})

test('blocking consolidation conflicts hold the candidate and its Relation and Claim dependents for review', () => {
  const conflicted = entity('industry-ai', 'AI Computing', 'industry')
  const other = entity('industry-other', 'Advanced Packaging', 'industry', ['block-2'])
  const edge = relation('relation-upstream', 'upstream_of', conflicted.candidateId, other.candidateId)
  const statement = claim('claim-industry', [conflicted.candidateId])
  const source = consolidated(group(conflicted, 'entity'), group(other, 'entity'), group(edge, 'relation'), group(statement, 'claim'))
  const withBlockingConflict: ConsolidatedExtraction = {
    ...source,
    reviewConstraints: [{ candidateId: conflicted.candidateId, reason: 'Conflicting legal identity across extraction units.', conflictingFields: ['name'], blocking: true, category: 'reconciliation_review', reviewKey: 'identity-conflict' }],
  }
  const result = map({ consolidated: withBlockingConflict, approvedCandidateIds: [conflicted.candidateId, other.candidateId, edge.candidateId, statement.candidateId] })

  assert.equal(result.entity?.name, 'Advanced Packaging')
  assert.equal(result.proposals.some((proposal) => proposal.kind === 'entity' && proposal.entityName === 'AI Computing'), false)
  assert.equal(result.proposals.some((proposal) => proposal.kind === 'relation'), false)
  assert.equal(result.proposals.some((proposal) => proposal.kind === 'claim'), false)
  assert.equal(result.decisions.find((item) => item.candidateId === conflicted.candidateId)?.reasonCode, 'blocking_consolidation_constraint')
  assert.equal(result.decisions.find((item) => item.candidateId === edge.candidateId)?.reasonCode, 'relation_dependency_not_approved')
  assert.equal(result.decisions.find((item) => item.candidateId === statement.candidateId)?.reasonCode, 'claim_subject_not_approved')
})

test('a Relation is held for review until both endpoint candidates are explicitly approved', () => {
  const upstream = entity('industry-upstream', 'Chip Materials', 'industry')
  const downstream = entity('industry-downstream', 'Advanced Packaging', 'industry')
  const edge = relation('relation-upstream', 'upstream_of', upstream.candidateId, downstream.candidateId)
  const source = consolidated(group(upstream, 'entity'), group(downstream, 'entity'), group(edge, 'relation'))

  const partial = map({ consolidated: source, approvedCandidateIds: [upstream.candidateId, edge.candidateId] })
  assert.equal(partial.proposals.some((proposal) => proposal.kind === 'relation'), false)
  assert.deepEqual(partial.decisions.find((item) => item.candidateId === edge.candidateId)?.dependencyCandidateIds, [downstream.candidateId])
  assert.equal(partial.decisions.find((item) => item.candidateId === edge.candidateId)?.reasonCode, 'relation_dependency_not_approved')

  const complete = map({ consolidated: source, approvedCandidateIds: [upstream.candidateId, downstream.candidateId, edge.candidateId] })
  const relationProposal = complete.proposals.find((proposal) => proposal.kind === 'relation')
  assert.equal(relationProposal?.kind, 'relation')
  if (relationProposal?.kind === 'relation') {
    const entityProposals = complete.proposals.filter((proposal): proposal is SemanticProductionProposal => proposal.kind === 'entity')
    assert.equal(relationProposal.subjectKey, entityProposals.find((proposal) => proposal.entityName === 'Chip Materials')?.subjectKey)
    assert.equal(relationProposal.targetKey, entityProposals.find((proposal) => proposal.entityName === 'Advanced Packaging')?.subjectKey)
  }
})

test('multi-subject Claim remains in review without falling back to the selected root', () => {
  const company = entity('company-alpha', 'Alpha Systems', 'company')
  const industry = entity('industry-ai', 'AI Computing', 'industry')
  const multiSubject = claim('claim-multi', [company.candidateId, industry.candidateId])
  const result = map({ consolidated: consolidated(group(company, 'entity'), group(industry, 'entity'), group(multiSubject, 'claim')), approvedCandidateIds: [company.candidateId, industry.candidateId, multiSubject.candidateId] })
  assert.equal(result.proposals.some((proposal) => proposal.kind === 'claim'), false)
  assert.equal(result.decisions.find((item) => item.candidateId === multiSubject.candidateId)?.reasonCode, 'claim_subject_cardinality')
})

test('valid Company and Industry proposals retain exact source, raw, and block locators', () => {
  const industry = entity('industry-ai', 'AI Computing', 'industry', ['block-2'])
  const company = entity('company-alpha', 'Alpha Systems', 'company', ['block-1'], { aliases: ['Alpha'], semanticFields: { ticker: '600001', exchange: 'SSE' } })
  const fact = claim('claim-capacity', [industry.candidateId], ['block-1', 'block-2'])
  const result = map({ consolidated: consolidated(group(company, 'entity'), group(industry, 'entity'), group(fact, 'claim')), approvedCandidateIds: [company.candidateId, industry.candidateId, fact.candidateId] })

  assert.equal(result.entity?.entityType, 'industry')
  assert.equal(result.proposals.filter((proposal) => proposal.kind === 'entity').length, 2)
  const claimProposal = result.proposals.find((proposal) => proposal.kind === 'claim')
  assert.equal(claimProposal?.kind, 'claim')
  assert.deepEqual(claimProposal?.existingEvidenceBindings, [
    { sourceRef, rawRef, locator: 'block-1' },
    { sourceRef, rawRef, locator: 'block-2' },
  ])
  const companyProposal = result.proposals.find((proposal) => proposal.kind === 'entity' && proposal.entityName === 'Alpha Systems')
  assert.deepEqual(companyProposal?.existingEvidenceBindings, [{ sourceRef, rawRef, locator: 'block-1' }])
  assert.deepEqual(result.decisions.filter((item) => item.kind === 'entity').map((item) => item.disposition).sort(), ['mapped', 'root'])
})

test('a Claim may retain an explicitly approved Relation as its sole subject', () => {
  const upstream = entity('industry-upstream', 'Chip Materials', 'industry')
  const downstream = entity('industry-downstream', 'Advanced Packaging', 'industry')
  const edge = relation('relation-supply', 'upstream_of', upstream.candidateId, downstream.candidateId)
  const relationClaim = claim('claim-dependency', [edge.candidateId])
  const result = map({ consolidated: consolidated(group(upstream, 'entity'), group(downstream, 'entity'), group(edge, 'relation'), group(relationClaim, 'claim')), approvedCandidateIds: [upstream.candidateId, downstream.candidateId, edge.candidateId, relationClaim.candidateId] })
  const relationProposal = result.proposals.find((proposal) => proposal.kind === 'relation')
  const claimProposal = result.proposals.find((proposal) => proposal.kind === 'claim')
  assert.ok(relationProposal)
  assert.equal(claimProposal?.kind, 'claim')
  assert.equal(claimProposal?.subjectKey, relationProposal?.proposalId)
})
