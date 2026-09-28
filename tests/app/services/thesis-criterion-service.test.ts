import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput } from '../../../knowledge/production/contracts.ts'
import { loadKnowledgeBaseManifest } from '../../../knowledge/storage/manifest-loader.ts'
import { verifyRaw } from '../../../knowledge/raw/raw-archive.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'
import { ThesisCriterionService } from '../../../app/services/thesis-criterion-service.ts'

const NOW = '2026-09-28T12:00:00.000Z'
const clock = () => NOW
const definition = { metricRef: 'metric:revenue_growth', operator: 'lt' as const, threshold: 0, unit: 'ratio', period: 'FY2027' }
function source(): NormalizedResearchSource {
  return { candidate: { candidateId: 'criterion-fixture-source', kind: 'official_disclosure', tier: 1, title: 'Annual report', provider: 'fixture', publishedAt: '2026-09-20T00:00:00.000Z' }, retrievedAt: NOW, title: 'Annual report', content: 'Published annual report content.', contentHash: 'f'.repeat(64), publisher: 'Fixture Exchange', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

async function seed(root: string) {
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-thesis-criterion-service', now: NOW })
  const gateway = new KnowledgeProductionGateway()
  const registry = new KnowledgeBaseRegistry()
  const initial = await gateway.submit({ handle: await registry.mount(root), producerType: 'criterion-fixture', producerRunId: 'criterion-seed-root', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', semanticFields: { ticker: '600519', exchange: 'SSE' } }, proposals: [], evidenceBindings: [], now: clock })
  assert.equal(initial.status, 'committed', initial.errors.join('; '))
  const evidence = source()
  const created = await gateway.submit({
    handle: await new KnowledgeBaseRegistry().mount(root), producerType: 'criterion-fixture', producerRunId: 'criterion-seed-thesis',
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', semanticFields: { ticker: '600519', exchange: 'SSE' }, existingEntityRef: initial.entityRefsByLocalKey.company },
    proposals: [
      { proposalId: 'proposition', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Revenue grows steadily.', sourceCandidateIds: [evidence.candidate.candidateId] },
      { proposalId: 'thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', statement: 'The company has durable earnings growth.', thesisStatus: 'active' },
      { proposalId: 'membership', kind: 'reasoning_edge', sourceProposalId: 'proposition', targetKey: 'thesis', edgeType: 'qualifies', sourceCandidateIds: [evidence.candidate.candidateId] },
    ],
    evidenceBindings: [{ localSourceId: evidence.candidate.candidateId, source: evidence }], asOf: NOW, now: clock,
  })
  assert.equal(created.status, 'committed', created.errors.join('; '))
  const assets = await readCanonicalV04Assets(root)
  const sourceValue = assets.objects.find((item) => item.kind === 'source')!.value as { id: string; rawRefs: string[]; publishedAt: string | null }
  return { thesisRef: created.thesisRefsByProposalId?.thesis!, claimRef: created.claimRefsByProposalId.proposition!, sourceRef: sourceValue.id, rawRef: sourceValue.rawRefs[0]!, publishedAt: sourceValue.publishedAt! }
}

function prepareInput(data: Awaited<ReturnType<typeof seed>>) {
  return { thesisRef: data.thesisRef, conditionId: 'revenue-floor', type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: [data.claimRef], origin: { kind: 'human_rule' } }
}

test('prepare previews legacy Thesis criterion without writing; confirm persists and same-run replay is durable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-service-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    const initialRevision = (await loadKnowledgeBaseManifest(root)).revision
    const prepared = await service.prepare(prepareInput(data))
    assert.equal(prepared.revision, 1)
    assert.equal(prepared.expectedKnowledgeBaseRevision, 2)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, initialRevision)
    const before = await readCanonicalV04Assets(root)
    const thesisBefore = before.objects.find((item) => item.kind === 'thesis' && item.value.id === data.thesisRef)!.value as { killCriteria?: unknown[] }
    assert.equal(thesisBefore.killCriteria, undefined)
    assert.equal((await service.prepare(prepareInput(data))).previewHash, prepared.previewHash)

    const confirmed = await service.confirm({ preview: prepared, previewHash: prepared.previewHash, expectedKnowledgeBaseRevision: prepared.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-human-confirm-1' })
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.committedRevision, prepared.expectedKnowledgeBaseRevision + 1)
    const after = await readCanonicalV04Assets(root)
    const thesisAfter = after.objects.find((item) => item.kind === 'thesis' && item.value.id === data.thesisRef)!.value as { killCriteria?: Array<{ revision: number; definitionHash: string; authority: { workflowRunId: string } }> }
    assert.deepEqual(thesisAfter.killCriteria?.map((item) => [item.revision, item.definitionHash, item.authority.workflowRunId]), [[1, prepared.definitionHash, 'criterion-human-confirm-1']])

    const replay = await service.confirm({ preview: prepared, previewHash: prepared.previewHash, expectedKnowledgeBaseRevision: prepared.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-human-confirm-1' })
    assert.equal(replay.status, 'replayed')
    assert.equal(replay.replay, true)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, confirmed.committedRevision)
    assert.equal((await readCanonicalV04Assets(root)).objects.find((item) => item.kind === 'thesis' && item.value.id === data.thesisRef)!.value.id, data.thesisRef)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source-derived confirmation sends its exact Source/Raw locator through the Gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-source-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    const prepared = await service.prepare({ ...prepareInput(data), origin: { kind: 'source_derived', sourceRef: data.sourceRef, rawRef: data.rawRef, locator: 'page=4;table=2;cell=RevenueGrowth', publishedAt: data.publishedAt } })
    const result = await service.confirm({ preview: prepared, previewHash: prepared.previewHash, expectedKnowledgeBaseRevision: prepared.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-source-confirm-1' })
    assert.equal(result.status, 'confirmed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('confirm rejects a stale Knowledge revision and a changed payload bound to an existing workflow run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-conflict-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    const prepared = await service.prepare(prepareInput(data))
    const gateway = new KnowledgeProductionGateway()
    const manifestHandle = await new KnowledgeBaseRegistry().mount(root)
    const entity = await readCanonicalV04Assets(root).then((assets) => assets.objects.find((item) => item.kind === 'entity' && item.value.id.startsWith('entity:'))!.value as { id: string; name: string; type: 'company'; ticker: string; exchange: string })
    const update: KnowledgeProductionInput = {
      handle: manifestHandle, producerType: 'criterion-fixture-update', producerRunId: 'criterion-unrelated-update', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: { localKey: 'company', entityType: 'company', name: entity.name, semanticFields: { ticker: entity.ticker, exchange: entity.exchange }, existingEntityRef: entity.id },
      proposals: [{ proposalId: 'thesis-update', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', statement: 'The company has durable earnings growth.', thesisStatus: 'weakening' }], evidenceBindings: [], now: clock,
    }
    const updated = await gateway.submit(update)
    assert.equal(updated.status, 'committed', updated.errors.join('; '))
    await assert.rejects(service.confirm({ preview: prepared, previewHash: prepared.previewHash, expectedKnowledgeBaseRevision: prepared.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-stale-confirm' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')

    const preparedAgain = await service.prepare(prepareInput(data))
    const first = await service.confirm({ preview: preparedAgain, previewHash: preparedAgain.previewHash, expectedKnowledgeBaseRevision: preparedAgain.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-fixed-run' })
    assert.equal(first.status, 'confirmed')
    const changed = await service.prepare({ ...prepareInput(data), definition: { ...definition, threshold: 0.1 } })
    await assert.rejects(service.confirm({ preview: changed, previewHash: changed.previewHash, expectedKnowledgeBaseRevision: changed.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-fixed-run' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('prepare rejects unknown criterion types and evaluator-unsupported deadline definitions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-input-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    await assert.rejects(service.prepare({ ...prepareInput(data), type: 'future_condition' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    await assert.rejects(service.prepare({ ...prepareInput(data), definition: { ...definition, deadline: '2027-01-01T00:00:00.000Z' } }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('prepare rejects malformed target refs and malformed preview target refs as invalid input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-target-input-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    await assert.rejects(service.prepare({ ...prepareInput(data), targetClaimRefs: [null] as never }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    const preview = await service.prepare(prepareInput(data))
    const malformed = structuredClone(preview) as unknown as { targetClaimRefs: unknown[]; [key: string]: unknown }
    malformed.targetClaimRefs = [null]
    await assert.rejects(service.confirm({ preview: malformed as never, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId: 'criterion-malformed-preview' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('prepare requires a full ISO publication timestamp and a canonical Source/Raw binding for source-derived origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-origin-'))
  try {
    const data = await seed(root)
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: root, now: clock })
    const origin = { kind: 'source_derived', sourceRef: data.sourceRef, rawRef: data.rawRef, locator: 'page=4;table=2;cell=RevenueGrowth', publishedAt: data.publishedAt }
    await assert.rejects(service.prepare({ ...prepareInput(data), origin: { ...origin, publishedAt: '2026-09-20' } }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
    await assert.rejects(service.prepare({ ...prepareInput(data), origin: { ...origin, sourceRef: 'source:missing' } }), (error: unknown) => error instanceof ApplicationServiceError && ['invalid_input', 'conflict'].includes(error instanceof ApplicationServiceError ? error.code : ''))
    await assert.rejects(service.prepare({ ...prepareInput(data), origin: { ...origin, publishedAt: '2026-09-29T00:00:00.000Z' } }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'invalid_input')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('prepare rejects source-derived origins when source rights are restricted or bound Raw integrity fails', async () => {
  const rightsRoot = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-rights-'))
  try {
    const data = await seed(rightsRoot)
    const assets = await readCanonicalV04Assets(rightsRoot)
    const sourceAsset = assets.objects.find((item) => item.kind === 'source' && item.value.id === data.sourceRef)!
    const restricted = structuredClone(sourceAsset.value) as unknown as Record<string, unknown>
    restricted.rights = { ...(restricted.rights as Record<string, unknown>), retentionAllowed: false }
    await writeFile(sourceAsset.filePath, JSON.stringify(restricted))
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: rightsRoot, now: clock })
    const origin = { kind: 'source_derived', sourceRef: data.sourceRef, rawRef: data.rawRef, locator: 'page=4;table=2;cell=RevenueGrowth', publishedAt: data.publishedAt }
    await assert.rejects(service.prepare({ ...prepareInput(data), origin }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  } finally { await rm(rightsRoot, { recursive: true, force: true }) }

  const rawRoot = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-raw-'))
  try {
    const data = await seed(rawRoot)
    const handle = await new KnowledgeBaseRegistry().mount(rawRoot)
    const raw = await verifyRaw(handle, data.rawRef)
    await writeFile(raw.originalPath, 'tampered raw bytes')
    const service = new ThesisCriterionService({ mountedKnowledgeBaseRoot: rawRoot, now: clock })
    const origin = { kind: 'source_derived', sourceRef: data.sourceRef, rawRef: data.rawRef, locator: 'page=4;table=2;cell=RevenueGrowth', publishedAt: data.publishedAt }
    await assert.rejects(service.prepare({ ...prepareInput(data), origin }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  } finally { await rm(rawRoot, { recursive: true, force: true }) }
})
