import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput } from '../../../knowledge/production/contracts.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'
import { ThesisQueryService } from '../../../app/services/thesis-query-service.ts'

const NOW = '2026-09-24T12:00:00.000Z'
const clock = () => NOW
function source(candidateId = 'query-source'): NormalizedResearchSource { return { candidate: { candidateId, kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'fixture', publishedAt: '2026-09-20T00:00:00.000Z' }, retrievedAt: NOW, title: 'Annual report', content: 'Published annual report content.', contentHash: 'f'.repeat(64), publisher: 'Fixture Exchange', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } }

async function seed(root: string, entityType: 'company' | 'industry' = 'company') {
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-thesis-query-${entityType}`, now: NOW })
  const registry = new KnowledgeBaseRegistry()
  const gateway = new KnowledgeProductionGateway()
  const initial = await gateway.submit({ handle: await registry.mount(root), producerType: 'fixture', producerRunId: 'query-root', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'subject', entityType, name: entityType === 'company' ? 'Fixture Company' : 'Fixture Industry', ...(entityType === 'company' ? { semanticFields: { ticker: '600519', exchange: 'SSE' } } : {}) }, proposals: [], evidenceBindings: [], now: clock })
  assert.equal(initial.status, 'committed')
  const evidence = source()
  const proposalInput: KnowledgeProductionInput = {
    handle: await new KnowledgeBaseRegistry().mount(root), producerType: 'fixture', producerRunId: 'query-thesis', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'subject', entityType, name: entityType === 'company' ? 'Fixture Company' : 'Fixture Industry', ...(entityType === 'company' ? { semanticFields: { ticker: '600519', exchange: 'SSE' } } : {}), existingEntityRef: initial.entityRefsByLocalKey.subject },
    proposals: [
      { proposalId: 'claim-one', kind: 'claim', subjectKey: 'subject', claimType: 'fact', statement: 'Revenue increased year over year.', sourceCandidateIds: [evidence.candidate.candidateId] },
      { proposalId: 'claim-two', kind: 'claim', subjectKey: 'subject', claimType: 'forecast', statement: 'Earnings are expected to grow.', sourceCandidateIds: [evidence.candidate.candidateId] },
      { proposalId: 'thesis-main', kind: 'thesis', subjectKey: 'subject', thesisTitle: 'Durable growth', statement: 'The company has durable earnings growth.', thesisStatus: 'active' },
      { proposalId: 'edge-one', kind: 'reasoning_edge', sourceProposalId: 'claim-one', targetKey: 'thesis-main', edgeType: 'qualifies', sourceCandidateIds: [evidence.candidate.candidateId] },
      { proposalId: 'edge-two', kind: 'reasoning_edge', sourceProposalId: 'claim-two', targetKey: 'thesis-main', edgeType: 'qualifies', sourceCandidateIds: [evidence.candidate.candidateId] },
      { proposalId: 'thesis-old', kind: 'thesis', subjectKey: 'subject', thesisTitle: 'Archived thesis', statement: 'An archived thesis.', thesisStatus: 'archived' },
    ],
    evidenceBindings: [{ localSourceId: evidence.candidate.candidateId, source: evidence }], asOf: NOW, now: clock,
  }
  const result = await gateway.submit(proposalInput)
  assert.equal(result.status, 'committed', result.errors.join('; '))
  return { thesisRef: result.thesisRefsByProposalId?.['thesis-main']!, registry, claimRefs: result.claimRefsByProposalId }
}

test('Thesis query lists bounded active summaries and returns exact qualifying Claim detail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-query-'))
  try {
    const data = await seed(root)
    const service = new ThesisQueryService(root)
    const list = await service.listTheses(100)
    assert.equal(list.total, 1)
    assert.equal(list.limit, 50)
    assert.equal(list.truncated, false)
    assert.equal(list.theses[0]?.thesisRef, data.thesisRef)
    assert.equal(list.theses[0]?.companySubject.name, 'Fixture Company')
    assert.equal(list.theses[0]?.propositionCount, 2)
    assert.ok(list.revision > 0)

    const detail = await service.getThesis(data.thesisRef)
    assert.equal(detail.propositionCount, 2)
    assert.deepEqual(new Set(detail.propositionRefs), new Set([data.claimRefs['claim-one'], data.claimRefs['claim-two']]))
    assert.equal(detail.membershipEdgeRefs.length, 2)
    assert.ok(detail.propositions.every((item) => item.sourceRefs.length === 1 && item.sourceRefs[0]?.startsWith('source:')))
    assert.deepEqual(detail.killCriteria, [])
    assert.equal(detail.revision, list.revision)
    await assert.rejects(service.getThesis('thesis:missing'), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'not_found')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Thesis query projects only explicitly stored active and superseded Kill Criterion revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-query-criteria-'))
  try {
    const data = await seed(root)
    const assets = await readCanonicalV04Assets(root)
    const thesisAsset = assets.objects.find((item) => item.kind === 'thesis' && item.value.id === data.thesisRef)!
    const criteria = [
      { conditionId: 'margin-floor', revision: 1, state: 'superseded', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'gross_margin', operator: 'lt', threshold: 0.2, unit: 'ratio', period: 'FY2026' }, targetClaimRefs: [data.claimRefs['claim-one']], effectiveAt: NOW, definitionHash: 'old-hash', authority: { workflowRunId: 'criterion-old', confirmedAt: NOW, origin: { kind: 'human_rule' } } },
      { conditionId: 'margin-floor', revision: 2, state: 'active', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef: 'gross_margin', operator: 'lt', threshold: 0.18, unit: 'ratio', period: 'FY2026' }, targetClaimRefs: [data.claimRefs['claim-two']], effectiveAt: NOW, definitionHash: 'active-hash', authority: { workflowRunId: 'criterion-active', confirmedAt: NOW, origin: { kind: 'human_rule' } } },
    ]
    await writeFile(thesisAsset.filePath, JSON.stringify({ ...thesisAsset.value, killCriteria: criteria }))
    const detail = await new ThesisQueryService(root).getThesis(data.thesisRef)
    assert.deepEqual(detail.killCriteria.map((item) => [item.conditionId, item.revision, item.state]), [['margin-floor', 1, 'superseded'], ['margin-floor', 2, 'active']])
    assert.equal(detail.killCriteria[1]?.definitionHash, 'active-hash')
    assert.deepEqual(detail.killCriteria[1]?.targetClaimRefs, [data.claimRefs['claim-two']])
    assert.deepEqual(detail.killCriteria[1]?.origin, { kind: 'human_rule' })
    assert.equal(detail.killCriteria[1]?.authority.workflowRunId, 'criterion-active')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Thesis query blocks unsupported non-Company subject projections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-query-subject-'))
  try {
    await seed(root, 'industry')
    await assert.rejects(new ThesisQueryService(root).listTheses(), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict' && /not an active Company/.test(error.message))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Thesis query blocks malformed active qualifying membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-query-edge-'))
  try {
    await seed(root)
    const assets = await readCanonicalV04Assets(root)
    const edge = assets.objects.find((item) => item.kind === 'reasoning_edge')!
    await writeFile(edge.filePath, JSON.stringify({ ...edge.value, sourceRef: 'claim:missing-claim' }))
    await assert.rejects(new ThesisQueryService(root).listTheses(), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict' && /missing or non-Claim/.test(error.message))
  } finally { await rm(root, { recursive: true, force: true }) }
})
