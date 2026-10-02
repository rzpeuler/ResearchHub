import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import type { ConsolidatedExtraction } from '../../workflows/raw-document-knowledge-ingestion/extraction/consolidation.ts'
import { mapRawDocumentExtractionToV04Proposals } from '../../workflows/raw-document-knowledge-ingestion/v04-proposal-mapper.ts'
import {
  RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS,
  RawDocumentV04PreviewStoreError,
  persistRawDocumentV04PreviewSnapshot,
  rawDocumentV04PreviewToProposalMappingInput,
  readRawDocumentV04PreviewSnapshot,
  type PersistRawDocumentV04PreviewInput,
} from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const RAW_TEXT = 'FULL RAW REPORT TEXT: AI computing demand continues to grow across the industry.'
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
  const root = await mkdtemp(join(tmpdir(), 'rhl-v04-preview-store-' + name + '-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-v04-preview-store-' + name, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function persistSource(root: string, bytes: string, runId: string) {
  const registry = new KnowledgeBaseRegistry()
  const handle = await registry.mount(root)
  const result = await new RawDocumentKnowledgeGatewayV04({ registry, clock: () => NOW }).submit({
    handle,
    workflowRunId: runId,
    bytes: Buffer.from(bytes, 'utf8'),
    filename: runId + '.txt',
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
  const entityId = 'merged-entity-ai-computing'
  const candidateGroups: ConsolidatedExtraction['groups'] = [
    {
      candidateId: entityId,
      kind: 'entity',
      candidate: {
        candidateId: entityId,
        entityType: 'industry',
        name: 'AI Computing',
        aliases: ['AI compute'],
        description: 'An industry supported by the report.',
        evidenceBlockRefs: ['block-2'],
        reason: 'Repeated evidence across extracted units.',
        confidence: 0.91,
      },
    },
    {
      candidateId: 'merged-claim-demand',
      kind: 'claim',
      candidate: {
        candidateId: 'merged-claim-demand',
        claimType: 'trend',
        statement: 'AI computing demand is increasing.',
        subjectRefs: [{ candidateRef: entityId, mention: 'AI Computing', entityType: 'industry' }],
        evidenceBlockRefs: ['block-1'],
        reason: 'Directly supported by the report.',
      },
    },
  ]
  const reviewConstraints = [{
    candidateId: entityId,
    reason: 'A potential new Theme must be reviewed in the Theme Framework workflow.',
    conflictingFields: [],
    blocking: true,
    category: 'theme_creation' as const,
    reviewKey: 'theme-framework-required:' + entityId,
  }]
  return {
    workflowRunId: 'preview-run-001',
    sourceRef: source.sourceRef,
    rawRef: source.rawRef,
    sourceRevision: source.sourceRevision,
    document: {
      documentId: 'document-ai-computing',
      blocks: [
        { blockId: 'block-2', type: 'paragraph', text: RAW_TEXT, sectionRef: null, page: 2, locator: { page: 2 }, order: 9 },
        { blockId: 'block-1', type: 'paragraph', text: RAW_TEXT, sectionRef: null, page: 1, locator: { page: 1 }, order: 2 },
      ],
    },
    candidateGroups,
    reviewConstraints,
    candidateSupport: new Map([[entityId, { supportingCandidateCount: 3, supportingUnitIds: ['unit-a', 'unit-b'], evidenceBlockRefs: ['block-1', 'block-2'] }]]),
    ...overrides,
  }
}

async function assertStoreError(promise: Promise<unknown>, code: RawDocumentV04PreviewStoreError['code']): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RawDocumentV04PreviewStoreError && error.code === code)
}

test('durable preview round-trips the pure mapper input without storing document text', async () => {
  await withFreshKb('roundtrip', async (root) => {
    const source = await persistSource(root, RAW_TEXT, 'source-run-roundtrip')
    const input = previewInput(source)
    const textLeak = previewInput(source, {
      candidateGroups: input.candidateGroups.map((group) => group.kind === 'claim'
        ? { ...group, candidate: { ...group.candidate, statement: RAW_TEXT } }
        : group),
    })
    await assertStoreError(persistRawDocumentV04PreviewSnapshot(source.handle, textLeak), 'PREVIEW_MALFORMED')
    const written = await persistRawDocumentV04PreviewSnapshot(source.handle, input)
    assert.equal(written.status, 'persisted')
    assert.equal(written.snapshot.knowledgeBaseId, source.handle.knowledgeBaseId)
    assert.equal(written.snapshot.sourceRevision, source.sourceRevision)
    assert.deepEqual(written.snapshot.orderedBlocks, [{ blockId: 'block-2', order: 9 }, { blockId: 'block-1', order: 2 }])
    assert.deepEqual(written.snapshot.candidateSupport, [{ candidateId: 'merged-entity-ai-computing', supportingCandidateCount: 3 }])
    assert.equal(written.snapshot.blockingReviewConstraints.length, 1)

    const path = join(root, 'logs', 'ingestion', 'v04-preview', 'preview-run-001.json')
    const encoded = await readFile(path, 'utf8')
    assert.equal(encoded.includes(RAW_TEXT), false)
    const restored = await readRawDocumentV04PreviewSnapshot(source.handle, 'preview-run-001')
    assert.ok(restored)
    const mappingInput = rawDocumentV04PreviewToProposalMappingInput(restored)
    assert.deepEqual(mappingInput.document.blocks.map((block) => ({ blockId: block.blockId, order: block.order })), written.snapshot.orderedBlocks)
    assert.deepEqual(mappingInput.consolidated.groups, input.candidateGroups)
    assert.deepEqual(mappingInput.consolidated.reviewConstraints, input.reviewConstraints)
    assert.equal(mappingInput.consolidated.candidateSupport.get('merged-entity-ai-computing')?.supportingCandidateCount, 3)

    const mapped = mapRawDocumentExtractionToV04Proposals({ ...mappingInput, approvedCandidateIds: ['merged-entity-ai-computing'] })
    assert.equal(mapped.decisions[0]?.reasonCode, 'blocking_consolidation_constraint')
  })
})

test('same run and content hash replays idempotently while changed content conflicts', async () => {
  await withFreshKb('replay', async (root) => {
    const source = await persistSource(root, RAW_TEXT, 'source-run-replay')
    const input = previewInput(source)
    const first = await persistRawDocumentV04PreviewSnapshot(source.handle, input)
    const replay = await persistRawDocumentV04PreviewSnapshot(source.handle, input)
    assert.equal(first.status, 'persisted')
    assert.equal(replay.status, 'already_present')
    assert.equal(replay.snapshot.contentHash, first.snapshot.contentHash)

    const changed = previewInput(source, { document: { ...input.document, documentId: 'changed-document-id' } })
    await assertStoreError(persistRawDocumentV04PreviewSnapshot(source.handle, changed), 'PREVIEW_CONFLICT')
  })
})

test('tampered and oversized sidecars fail closed', async () => {
  await withFreshKb('tamper', async (root) => {
    const source = await persistSource(root, RAW_TEXT, 'source-run-tamper')
    await persistRawDocumentV04PreviewSnapshot(source.handle, previewInput(source))
    const path = join(root, 'logs', 'ingestion', 'v04-preview', 'preview-run-001.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    value.documentId = 'tampered-document'
    await writeFile(path, JSON.stringify(value), 'utf8')
    await assertStoreError(readRawDocumentV04PreviewSnapshot(source.handle, 'preview-run-001'), 'PREVIEW_CHECKSUM_INVALID')
  })

  await withFreshKb('oversized', async (root) => {
    const source = await persistSource(root, RAW_TEXT, 'source-run-oversized')
    await persistRawDocumentV04PreviewSnapshot(source.handle, previewInput(source))
    const path = join(root, 'logs', 'ingestion', 'v04-preview', 'preview-run-001.json')
    await writeFile(path, Buffer.alloc(RAW_DOCUMENT_V04_PREVIEW_STORE_LIMITS.maxSnapshotBytes + 1, 0x20))
    await assertStoreError(readRawDocumentV04PreviewSnapshot(source.handle, 'preview-run-001'), 'PREVIEW_SIZE_LIMIT')
  })
})

test('symlinked preview ancestors are rejected', async () => {
  await withFreshKb('symlink', async (root) => {
    const source = await persistSource(root, RAW_TEXT, 'source-run-symlink')
    const outside = await mkdtemp(join(tmpdir(), 'rhl-v04-preview-store-outside-'))
    try {
      await mkdir(join(root, 'logs', 'ingestion'), { recursive: true })
      await symlink(outside, join(root, 'logs', 'ingestion', 'v04-preview'), 'junction')
      await assertStoreError(readRawDocumentV04PreviewSnapshot(source.handle, 'preview-run-001'), 'PREVIEW_PATH_UNSAFE')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

test('Source and Raw must still match, while an older canonical source revision remains readable', async () => {
  await withFreshKb('source-raw', async (root) => {
    const original = await persistSource(root, 'first report', 'source-run-first')
    const later = await persistSource(root, 'second report', 'source-run-second')
    const mismatched = previewInput({ ...later, sourceRef: original.sourceRef, sourceRevision: later.sourceRevision })
    await assertStoreError(persistRawDocumentV04PreviewSnapshot(later.handle, mismatched), 'SOURCE_RAW_MISMATCH')

    const staleButCanonical = previewInput(original, { workflowRunId: 'preview-run-stale-source' })
    const result = await persistRawDocumentV04PreviewSnapshot(later.handle, staleButCanonical)
    assert.equal(result.status, 'persisted')
    assert.equal(result.snapshot.sourceRevision, original.sourceRevision)
    assert.ok(await readRawDocumentV04PreviewSnapshot(later.handle, 'preview-run-stale-source'))
  })
})
