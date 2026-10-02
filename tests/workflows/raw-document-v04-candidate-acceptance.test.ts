import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { getRaw } from '../../knowledge/raw/raw-archive.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { ConsolidatedExtraction } from '../../workflows/raw-document-knowledge-ingestion/extraction/consolidation.ts'
import {
  persistRawDocumentV04PreviewSnapshot,
  readRawDocumentV04PreviewSnapshot,
  type PersistRawDocumentV04PreviewInput,
} from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import { acceptRawDocumentV04Candidates } from '../../workflows/raw-document-knowledge-ingestion/v04-candidate-acceptance.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const RAW_TEXT = 'AI computing demand is increasing across the industry.'
const RIGHTS = {
  accessScope: 'authenticated' as const,
  providerTermsKnown: true,
  retentionAllowed: true,
  aiProcessingAllowed: true,
  derivativeKnowledgeAllowed: true,
  redistributionAllowed: false,
  policyBasis: 'User supplied the report for personal research processing.',
}
const SOURCE = {
  title: 'AI Computing Research',
  sourceType: 'sell_side_research' as const,
  sourceReliability: 'medium' as const,
  publisher: 'Fixture Securities',
  institution: 'Fixture Securities',
  author: 'Research Team',
  publishedAt: '2026-09-30T08:00:00.000Z',
  canonicalUrl: 'https://research.example/ai-computing',
}

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-v04-acceptance-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-v04-acceptance-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function persistSource(root: string, runId: string) {
  const registry = new KnowledgeBaseRegistry()
  const handle = await registry.mount(root)
  const result = await new RawDocumentKnowledgeGatewayV04({ registry, clock: () => NOW }).submit({
    handle,
    workflowRunId: runId,
    bytes: Buffer.from(RAW_TEXT, 'utf8'),
    filename: `${runId}.txt`,
    mediaType: 'text/plain',
    source: SOURCE,
    rights: RIGHTS,
  })
  assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
  assert.ok(result.sourceRef)
  assert.ok(result.rawRef)
  return {
    handle: await registry.refresh(root),
    sourceRef: result.sourceRef!,
    rawRef: result.rawRef!,
    sourceRevision: result.knowledgeBaseRevision,
  }
}

function previewInput(
  source: Awaited<ReturnType<typeof persistSource>>,
  overrides: Partial<PersistRawDocumentV04PreviewInput> = {},
): PersistRawDocumentV04PreviewInput {
  const entityId = 'industry-ai-computing'
  const candidateGroups: ConsolidatedExtraction['groups'] = [
    {
      candidateId: entityId,
      kind: 'entity',
      candidate: {
        candidateId: entityId,
        entityType: 'industry',
        name: 'AI Computing',
        aliases: ['AI compute'],
        description: 'The industry supported by this source.',
        evidenceBlockRefs: ['block-ai-demand'],
        reason: 'The source directly describes this industry.',
        confidence: 0.92,
      },
    },
    {
      candidateId: 'claim-demand-growth',
      kind: 'claim',
      candidate: {
        candidateId: 'claim-demand-growth',
        claimType: 'fact',
        statement: 'AI computing demand is increasing.',
        subjectRefs: [{ candidateRef: entityId, mention: 'AI computing', entityType: 'industry' }],
        evidenceBlockRefs: ['block-ai-demand'],
        reason: 'The source explicitly states rising demand.',
        confidence: 0.9,
      },
    },
  ]
  return {
    workflowRunId: 'acceptance-preview-001',
    sourceRef: source.sourceRef,
    rawRef: source.rawRef,
    sourceRevision: source.sourceRevision,
    document: {
      documentId: 'document-ai-computing',
      blocks: [{ blockId: 'block-ai-demand', type: 'paragraph', text: RAW_TEXT, sectionRef: null, page: 1, locator: { page: 1 }, order: 1 }],
    },
    candidateGroups,
    reviewConstraints: [],
    candidateSupport: new Map([[entityId, { supportingCandidateCount: 2, supportingUnitIds: ['unit-001'], evidenceBlockRefs: ['block-ai-demand'] }]]),
    extractionCompleteness: 'complete',
    incompleteUnits: [],
    ...overrides,
  }
}

async function persistPreview(source: Awaited<ReturnType<typeof persistSource>>, overrides: Partial<PersistRawDocumentV04PreviewInput> = {}) {
  const input = previewInput(source, overrides)
  const stored = await persistRawDocumentV04PreviewSnapshot(source.handle, input)
  return { input, snapshot: stored.snapshot }
}

const selectedBoth = ['industry-ai-computing', 'claim-demand-growth']

test('explicitly accepts mapped candidates through Gateway and returns durable preview and canonical refs', async () => {
  await withFreshKb('success', async (root) => {
    const source = await persistSource(root, 'source-success')
    const { snapshot } = await persistPreview(source)
    const result = await acceptRawDocumentV04Candidates({ handle: source.handle, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: selectedBoth, now: () => NOW })

    assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
    assert.equal(result.previewSnapshotHash, snapshot.contentHash)
    assert.equal(result.extractionCompleteness, 'complete')
    assert.deepEqual(result.acceptedCandidateIds, selectedBoth)
    assert.equal(result.canonicalRefsByCandidateId['industry-ai-computing']?.startsWith('entity:'), true)
    assert.equal(result.canonicalRefsByCandidateId['claim-demand-growth']?.startsWith('claim:'), true)
    assert.ok(result.producerRunId)

    const assets = await readCanonicalV04Assets(root)
    const claim = assets.objects.find((item) => item.value.id === result.canonicalRefsByCandidateId['claim-demand-growth'])
    assert.ok(claim)
    assert.deepEqual((claim.value as { sourceRefs: readonly string[] }).sourceRefs, [source.sourceRef])
    assert.deepEqual((claim.value as { provenance: readonly { sourceRef: string; rawRef: string; locator: string | null }[] }).provenance, [{ sourceRef: source.sourceRef, rawRef: source.rawRef, locator: 'block-ai-demand', chunkRef: null }])
  })
})

test('partial preview can accept an explicit safe subset and keeps completeness visible after remount', async () => {
  await withFreshKb('partial', async (root) => {
    const source = await persistSource(root, 'source-partial')
    const { snapshot } = await persistPreview(source, {
      workflowRunId: 'acceptance-preview-partial',
      extractionCompleteness: 'partial',
      incompleteUnits: [{ unitId: 'unit-002', proposedUnitId: 'supply-unit', status: 'failed', errorSummary: 'Bounded extraction retry was exhausted.' }],
    })
    const remounted = await new KnowledgeBaseRegistry().mount(root)
    const restored = await readRawDocumentV04PreviewSnapshot(remounted, snapshot.workflowRunId)
    assert.equal(restored?.extractionCompleteness, 'partial')
    assert.equal(restored?.incompleteUnits?.[0]?.unitId, 'unit-002')

    const result = await acceptRawDocumentV04Candidates({ handle: remounted, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'], now: () => NOW })
    assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
    assert.equal(result.extractionCompleteness, 'partial')
    assert.deepEqual(result.acceptedCandidateIds, ['industry-ai-computing'])
  })
})

test('replay sorts the accepted set for a stable producer run and does not duplicate Knowledge', async () => {
  await withFreshKb('replay', async (root) => {
    const source = await persistSource(root, 'source-replay')
    const { snapshot } = await persistPreview(source)
    const first = await acceptRawDocumentV04Candidates({ handle: source.handle, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: selectedBoth, now: () => NOW })
    assert.equal(first.status, 'committed')
    const manifestAfterFirst = (await new KnowledgeBaseRegistry().mount(root)).revision
    const second = await acceptRawDocumentV04Candidates({ handle: await new KnowledgeBaseRegistry().mount(root), previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: [...selectedBoth].reverse(), now: () => NOW })
    assert.ok(second.status === 'already_committed' || second.status === 'no_changes', JSON.stringify(second))
    assert.equal(second.producerRunId, first.producerRunId)
    assert.equal((await new KnowledgeBaseRegistry().mount(root)).revision, manifestAfterFirst)
    assert.deepEqual(second.canonicalRefsByCandidateId, first.canonicalRefsByCandidateId)
  })
})

test('a pre-existing same-name Entity is not treated as this acceptance replay', async () => {
  await withFreshKb('same-name-conflict', async (root) => {
    const seedSource: NormalizedResearchSource = {
      candidate: { candidateId: 'seed-industry-source', kind: 'structured_data', tier: 2, title: 'Seed Industry', provider: 'fixture' },
      retrievedAt: NOW,
      title: 'Seed Industry',
      content: 'Earlier, unrelated source material.',
      contentHash: 'a'.repeat(64),
      publisher: 'Fixture Data',
      rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
    }
    const seeded = await new KnowledgeProductionGateway().submit({
      handle: await new KnowledgeBaseRegistry().mount(root),
      producerType: 'fixture_seed',
      producerRunId: 'same-name-seed',
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: { localKey: 'industry', entityType: 'industry', name: 'AI Computing' },
      proposals: [],
      evidenceBindings: [{ localSourceId: 'seed-industry-source', source: seedSource }],
      now: () => NOW,
    })
    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))

    const source = await persistSource(root, 'source-same-name-conflict')
    const { snapshot } = await persistPreview(source)
    const result = await acceptRawDocumentV04Candidates({ handle: source.handle, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'], now: () => NOW })
    assert.equal(result.status, 'blocked')
    assert.match(result.resolutionIntents.map((item) => item.reason).join('; '), /Name similarity alone cannot establish/i)
    assert.equal(result.acceptedCandidateIds.length, 0)
    assert.equal((await new KnowledgeBaseRegistry().mount(root)).revision, source.handle.revision)
    assert.equal((await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'entity').length, 1)
  })
})

test('empty, duplicate, unknown and review-constrained selections fail before canonical writes', async () => {
  await withFreshKb('selection-rejections', async (root) => {
    const source = await persistSource(root, 'source-selection-rejections')
    const { snapshot } = await persistPreview(source)
    const beforeRevision = source.handle.revision
    const cases = [
      { ids: [], code: 'ACCEPTED_CANDIDATES_REQUIRED' },
      { ids: ['industry-ai-computing', 'industry-ai-computing'], code: 'ACCEPTED_CANDIDATE_DUPLICATE' },
      { ids: ['unknown-candidate'], code: 'ACCEPTED_CANDIDATE_UNKNOWN' },
      { ids: ['claim-demand-growth'], code: 'ACCEPTED_CANDIDATE_REQUIRES_REVIEW' },
    ] as const
    for (const item of cases) {
      const result = await acceptRawDocumentV04Candidates({ handle: source.handle, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: item.ids, now: () => NOW })
      assert.equal(result.status, 'blocked')
      assert.equal(result.errors[0]?.code, item.code)
      if (item.ids[0] === 'claim-demand-growth') assert.equal(result.mappingDecisions.find((decision) => decision.candidateId === 'claim-demand-growth')?.reasonCode, 'claim_subject_not_approved')
    }

    const constrained = await persistPreview(source, {
      workflowRunId: 'acceptance-preview-constrained',
      reviewConstraints: [{ candidateId: 'industry-ai-computing', reason: 'Entity name has a blocking identity conflict.', conflictingFields: ['name'], blocking: true, category: 'reconciliation_review', reviewKey: 'identity-conflict:industry-ai-computing' }],
    })
    const blocked = await acceptRawDocumentV04Candidates({ handle: source.handle, previewWorkflowRunId: constrained.snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'], now: () => NOW })
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.errors[0]?.code, 'ACCEPTED_CANDIDATE_REQUIRES_REVIEW')
    assert.equal((await new KnowledgeBaseRegistry().mount(root)).revision, beforeRevision)
    assert.equal((await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'entity').length, 0)
  })
})

test('missing accepted dependencies block the entire selection before writing its valid root', async () => {
  await withFreshKb('dependency', async (root) => {
    const source = await persistSource(root, 'source-dependency')
    const extraGroups: ConsolidatedExtraction['groups'] = [
      {
        candidateId: 'industry-ai-computing-peer', kind: 'entity',
        candidate: { candidateId: 'industry-ai-computing-peer', entityType: 'industry', name: 'AI Hardware Supply', evidenceBlockRefs: ['block-ai-demand'], reason: 'Fixture peer.' },
      },
      {
        candidateId: 'relation-ai-supply', kind: 'relation',
        candidate: { candidateId: 'relation-ai-supply', relationType: 'upstream_of', source: { candidateRef: 'industry-ai-computing', mention: 'AI Computing', entityType: 'industry' }, target: { candidateRef: 'industry-ai-computing-peer', mention: 'AI Hardware Supply', entityType: 'industry' }, evidenceBlockRefs: ['block-ai-demand'], reason: 'Fixture relation.' },
      },
    ]
    const base = previewInput(source)
    const candidateGroups = [...base.candidateGroups, ...extraGroups]
    const { snapshot } = await persistPreview(source, { workflowRunId: 'acceptance-preview-missing-dependency', candidateGroups })
    const result = await acceptRawDocumentV04Candidates({
      handle: source.handle,
      previewWorkflowRunId: snapshot.workflowRunId,
      acceptedCandidateIds: ['industry-ai-computing', 'relation-ai-supply'],
      now: () => NOW,
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.errors[0]?.code, 'ACCEPTED_CANDIDATE_REQUIRES_REVIEW')
    assert.deepEqual(result.mappingDecisions.find((item) => item.candidateId === 'relation-ai-supply')?.dependencyCandidateIds, ['industry-ai-computing-peer'])
    assert.equal((await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'entity').length, 0)
  })
})

test('Schema 0.3, wrong KB identity, stale handles, and corrupted Raw are rejected truthfully', async () => {
  await withFreshKb('integrity', async (root) => {
    const source = await persistSource(root, 'source-integrity')
    const { snapshot } = await persistPreview(source)
    const incompatible = new KnowledgeBaseHandle({ ...source.handle, schemaVersion: '0.3' })
    const oldSchema = await acceptRawDocumentV04Candidates({ handle: incompatible, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'] })
    assert.equal(oldSchema.status, 'incompatible_schema')

    const wrongKb = new KnowledgeBaseHandle({ ...source.handle, knowledgeBaseId: 'kb-wrong-preview-owner' })
    const wrongOwner = await acceptRawDocumentV04Candidates({ handle: wrongKb, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'] })
    assert.equal(wrongOwner.status, 'blocked')
    assert.equal(wrongOwner.errors[0]?.code, 'KNOWLEDGE_BASE_IDENTITY_MISMATCH')

    const stale = source.handle
    await persistSource(root, 'source-integrity-advance')
    const staleResult = await acceptRawDocumentV04Candidates({ handle: stale, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'] })
    assert.equal(staleResult.status, 'stale_revision')

    const currentHandle = await new KnowledgeBaseRegistry().mount(root)
    const raw = await getRaw(currentHandle, source.rawRef)
    await writeFile(raw.originalPath, 'modified bytes which no longer match the canonical Raw hash.', 'utf8')
    const corrupted = await acceptRawDocumentV04Candidates({ handle: currentHandle, previewWorkflowRunId: snapshot.workflowRunId, acceptedCandidateIds: ['industry-ai-computing'] })
    assert.equal(corrupted.status, 'blocked')
    assert.equal(corrupted.errors[0]?.code, 'RAW_INTEGRITY_INVALID')
    assert.equal((await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'entity').length, 0)
  })
})
