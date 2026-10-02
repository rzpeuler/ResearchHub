import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { getRaw, readRaw } from '../../knowledge/raw/raw-archive.ts'
import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'
import type { DocumentParser, DocumentParserInput, StructuredDocument } from '../../plugins/document/contracts.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { RawDocumentGatewayV04Input, RawDocumentGatewayV04Result } from '../../knowledge/production/raw-document-gateway-v04.ts'
import { persistRawDocumentV04PreviewSnapshot, RawDocumentV04PreviewStoreError, readRawDocumentV04PreviewSnapshot } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import type { RawDocumentPreviewSkillV04, RawDocumentPreviewWorkflowInputV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import { runRawDocumentKnowledgePreviewV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { ClaimCandidate, EntityCandidate, ReportMap, UnderstandAndPlanOutput, ValidatedExtractKnowledgeResult } from '../../skills/knowledge-curation/contracts.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const RAW_DOCUMENT_TEXT = 'AI computing demand is increasing. Additional market context follows.'
const RIGHTS = {
  accessScope: 'authenticated' as const,
  providerTermsKnown: true,
  retentionAllowed: true,
  aiProcessingAllowed: true,
  derivativeKnowledgeAllowed: true,
  redistributionAllowed: false,
  policyBasis: 'User supplied a report for personal research processing.',
}
const SOURCE_METADATA = {
  title: 'AI Computing Industry Research',
  sourceType: 'sell_side_research' as const,
  sourceReliability: 'medium' as const,
  publisher: 'Fixture Securities',
  institution: 'Fixture Securities',
  author: 'Research Team',
  publishedAt: '2026-09-30T08:00:00.000Z',
  canonicalUrl: 'https://research.example/ai-computing',
}

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-v04-preview-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-v04-preview-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function documentFixture(): StructuredDocument {
  return {
    documentId: 'doc-ai-capacity-fixture',
    parser: { id: 'preview-fixture-parser', version: '1' },
    metadata: { originalFilename: 'ai-capacity.txt', mediaType: 'text/plain', title: 'AI Computing Industry Research' },
    normalizedText: RAW_DOCUMENT_TEXT,
    sections: [],
    blocks: [{ blockId: 'block-ai-demand', type: 'paragraph', text: 'AI computing demand is increasing.', sectionRef: null, page: 1, locator: { page: 1, parserItemRef: 'paragraph-1' }, order: 1 }],
    stats: { pageCount: 1, sectionCount: 0, blockCount: 1, normalizedCharacters: RAW_DOCUMENT_TEXT.length, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 },
    warnings: [],
  }
}

function parser(options: { readonly fail?: boolean } = {}): DocumentParser {
  return {
    id: 'preview-fixture-parser',
    supports: () => true,
    async parse(input: DocumentParserInput) {
      if (options.fail) throw new Error('fixture parser unavailable')
      const value = documentFixture()
      return { ...value, documentId: input.documentId ?? value.documentId, metadata: { ...value.metadata, originalFilename: input.filename, mediaType: input.mediaType } }
    },
  }
}

function reportMap(): ReportMap {
  return {
    sourceAssessment: { summary: 'Fixture report for candidate preview.', sourceType: 'sell_side_research', reliability: 'medium' },
    researchScope: 'AI computing industry candidate preview',
    majorTopics: [],
    majorEntityMentions: [],
    majorConclusions: [],
    sectionSemantics: [],
    semanticDependencies: [],
    themeHypotheses: [],
    uncertainty: [],
  }
}

function validPlan(): UnderstandAndPlanOutput {
  return { reportMap: reportMap(), extractionPlanProposal: { units: [{ proposedUnitId: 'ai-demand-unit', topic: 'AI computing demand', semanticPurpose: 'Extract grounded industry knowledge candidates', primaryRefs: [{ kind: 'block', blockId: 'block-ai-demand' }], contextRefs: [] }], excludedRefs: [] } }
}

function invalidPlan(): UnderstandAndPlanOutput {
  return { reportMap: reportMap(), extractionPlanProposal: { units: [], excludedRefs: [{ kind: 'block', blockId: 'block-ai-demand' }] } }
}

function candidates(): ValidatedExtractKnowledgeResult {
  const industry: EntityCandidate = { candidateId: 'industry-ai-computing', entityType: 'industry', name: 'AI Computing', evidenceBlockRefs: ['block-ai-demand'], reason: 'Named directly in the source report.', confidence: 0.93 }
  const claim: ClaimCandidate = { candidateId: 'claim-demand-growth', claimType: 'fact', statement: 'AI computing demand is increasing.', subjectRefs: [{ candidateRef: industry.candidateId, mention: 'AI computing' }], evidenceBlockRefs: ['block-ai-demand'], reason: 'The source explicitly states rising demand.', confidence: 0.9 }
  return {
    entities: [industry], relations: [], claims: [claim], rejected: [],
    summary: {
      inputCounts: { entity: 1, relation: 0, claim: 1 },
      acceptedCounts: { entity: 1, relation: 0, claim: 1 },
      rejectedCounts: { entity: 0, relation: 0, claim: 0 },
      rejectionCodes: [],
    },
  }
}

function skill(options: {
  readonly plan?: UnderstandAndPlanOutput
  readonly onPlan?: () => void
  readonly onExtract?: () => void
  readonly failExtraction?: boolean
  readonly output?: ValidatedExtractKnowledgeResult
} = {}): RawDocumentPreviewSkillV04 {
  return {
    capabilities: () => ({ maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 2 }),
    async understandAndPlan() { options.onPlan?.(); return options.plan ?? validPlan() },
    async extractKnowledge() {
      options.onExtract?.()
      if (options.failExtraction) throw new Error('fixture extraction unavailable')
      return options.output ?? candidates()
    },
  }
}

function input(handle: KnowledgeBaseHandle, overrides: Partial<RawDocumentPreviewWorkflowInputV04> = {}): RawDocumentPreviewWorkflowInputV04 {
  return {
    handle,
    documentInput: { type: 'text', text: RAW_DOCUMENT_TEXT, originalFilename: 'ai-capacity.txt', mediaType: 'text/plain', documentId: 'doc-ai-capacity-fixture' },
    documentResolver: new DocumentInputResolver({ documentParser: parser() }),
    skill: skill(),
    workflowRunId: 'preview-run-001',
    rights: RIGHTS,
    sourceMetadata: SOURCE_METADATA,
    clock: () => NOW,
    ...overrides,
  }
}

async function mount(root: string) { return new KnowledgeBaseRegistry().mount(root) }

async function within<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Operation did not return within ${timeoutMs} ms`)), timeoutMs) }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function twoBlockDocument(): StructuredDocument {
  const one = documentFixture()
  return {
    ...one,
    normalizedText: `${one.normalizedText}\nA second independent observation.`,
    blocks: [...one.blocks, { blockId: 'block-ai-supply', type: 'paragraph', text: 'A second independent observation.', sectionRef: null, page: 1, locator: { page: 1, parserItemRef: 'paragraph-2' }, order: 2 }],
    stats: { ...one.stats, blockCount: 2, normalizedCharacters: one.normalizedText.length + 34 },
  }
}

function twoUnitPlan(): UnderstandAndPlanOutput {
  return {
    reportMap: reportMap(),
    extractionPlanProposal: {
      units: [
        { proposedUnitId: 'ai-demand-unit', topic: 'AI computing demand', semanticPurpose: 'Extract the first grounded observation', primaryRefs: [{ kind: 'block', blockId: 'block-ai-demand' }], contextRefs: [] },
        { proposedUnitId: 'ai-supply-unit', topic: 'AI computing supply', semanticPurpose: 'Extract the second grounded observation', primaryRefs: [{ kind: 'block', blockId: 'block-ai-supply' }], contextRefs: [] },
      ],
      excludedRefs: [],
    },
  }
}

test('Schema 0.4 workflow persists Source and Raw then returns evidence-linked candidates without canonical knowledge writes', async () => {
  await withFreshKb('candidate-preview', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle))

    assert.equal(result.status, 'preview_ready', JSON.stringify(result.previewSnapshot))
    assert.equal(result.previewSnapshot.status, 'persisted')
    assert.equal(result.previewSnapshot.workflowRunId, input(handle).workflowRunId)
    assert.match(result.previewSnapshot.contentHash ?? '', /^sha256:[0-9a-f]{64}$/u)
    assert.equal(result.previewSnapshot.committable, true)
    assert.equal(result.sourceRaw.status, 'committed')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.sourceRaw.revision, 1)
    assert.ok(result.sourceRaw.sourceRef?.startsWith('source:'))
    assert.ok(result.sourceRaw.rawRef?.startsWith('raw-sha256-'))
    assert.equal(result.extractionPreview.status, 'completed')
    assert.equal(result.extractionPreview.documentId, 'doc-ai-capacity-fixture')
    assert.equal(result.extractionPreview.candidateGroups.length, 2)
    assert.equal(result.extractionPreview.candidateGroups.every((group) => group.candidateId.startsWith('merged-')), true)
    assert.deepEqual(result.extractionPreview.candidateGroups[0]?.provenanceRefs.evidenceBlockRefs, ['block-ai-demand'])
    assert.equal(result.extractionPreview.candidateGroups[0]?.provenanceRefs.sourceRef, result.sourceRaw.sourceRef)
    assert.equal(result.extractionPreview.candidateGroups[0]?.provenanceRefs.rawRef, result.sourceRaw.rawRef)
    assert.equal(result.extractionPreview.candidateCounts.consolidated, 2)
    assert.deepEqual(result.extractionPreview.rejectedCandidates, [])
    assert.equal(result.provenance?.documentId, 'doc-ai-capacity-fixture')
    assert.deepEqual(await readRaw(handle, result.sourceRaw.rawRef!), Buffer.from(RAW_DOCUMENT_TEXT))

    const remounted = await readRawDocumentV04PreviewSnapshot(await mount(root), result.workflowRunId)
    assert.ok(remounted)
    assert.equal(remounted.workflowRunId, result.workflowRunId)
    assert.equal(remounted.knowledgeBaseId, result.knowledgeBaseId)
    assert.equal(remounted.contentHash, result.previewSnapshot.contentHash)
    assert.equal(remounted.sourceRef, result.sourceRaw.sourceRef)
    assert.equal(remounted.rawRef, result.sourceRaw.rawRef)
    assert.equal(remounted.sourceRevision, result.sourceRaw.revision)
    assert.equal(remounted.documentId, result.extractionPreview.documentId)
    assert.deepEqual(remounted.orderedBlocks, [{ blockId: 'block-ai-demand', order: 1 }])
    assert.equal(remounted.candidateGroups.length, 2)
    assert.equal(remounted.extractionCompleteness, 'complete')
    assert.deepEqual(remounted.incompleteUnits, [])

    const replay = await runRawDocumentKnowledgePreviewV04(input(handle))
    assert.equal(replay.status, 'preview_ready')
    assert.equal(replay.sourceRaw.status, 'already_committed')
    assert.equal(replay.previewSnapshot.status, 'already_present')
    assert.equal(replay.previewSnapshot.contentHash, result.previewSnapshot.contentHash)
    assert.equal(replay.previewSnapshot.committable, true)

    const assets = await readCanonicalV04Assets(root)
    assert.deepEqual(assets.objects.map((asset) => asset.kind), ['source'])
    assert.equal(assets.objects.some((asset) => asset.kind === 'theme_group'), false)
    assert.equal(assets.objects.some((asset) => asset.kind === 'entity' || asset.kind === 'relation' || asset.kind === 'claim'), false)
  })
})

test('changed extraction under the same workflowRunId conflicts with the immutable preview and preserves the original', async () => {
  await withFreshKb('candidate-preview-conflict', async (root) => {
    const handle = await mount(root)
    const first = await runRawDocumentKnowledgePreviewV04(input(handle))
    const original = await readRawDocumentV04PreviewSnapshot(handle, first.workflowRunId)
    assert.ok(original)

    const changed = candidates()
    const changedOutput: ValidatedExtractKnowledgeResult = {
      ...changed,
      entities: changed.entities.map((entity) => ({ ...entity, confidence: 0.81 })),
    }
    const conflict = await runRawDocumentKnowledgePreviewV04(input(handle, { skill: skill({ output: changedOutput }) }))

    assert.equal(conflict.status, 'source_only')
    assert.equal(conflict.sourceRaw.persisted, true)
    assert.equal(conflict.sourceRaw.status, 'already_committed')
    assert.equal(conflict.extractionPreview.status, 'completed')
    assert.equal(conflict.extractionPreview.candidateGroups.length, 2)
    assert.equal(conflict.previewSnapshot.status, 'failed')
    assert.equal(conflict.previewSnapshot.committable, false)
    assert.equal(conflict.previewSnapshot.error?.code, 'PREVIEW_CONFLICT')
    assert.match(conflict.extractionPreview.errors.join('\n'), /PREVIEW_CONFLICT/u)
    const afterConflict = await readRawDocumentV04PreviewSnapshot(handle, first.workflowRunId)
    assert.equal(afterConflict?.contentHash, original.contentHash)
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })
})

test('preview store failure preserves extraction telemetry and leaves the candidate preview non-committable', async () => {
  await withFreshKb('candidate-preview-store-failure', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, {
      previewSnapshotStore: {
        async persist() {
          throw new RawDocumentV04PreviewStoreError('PREVIEW_PATH_UNSAFE', 'fixture preview storage failure')
        },
      },
    }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.sourceRaw.status, 'committed')
    assert.equal(result.extractionPreview.status, 'completed')
    assert.equal(result.extractionPreview.candidateGroups.length, 2)
    assert.equal(result.extractionPreview.candidateCounts.consolidated, 2)
    assert.match(result.extractionPreview.errors.join('\n'), /fixture preview storage failure/u)
    assert.equal(result.previewSnapshot.status, 'failed')
    assert.equal(result.previewSnapshot.workflowRunId, result.workflowRunId)
    assert.equal(result.previewSnapshot.contentHash, undefined)
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.previewSnapshot.error?.code, 'PREVIEW_PATH_UNSAFE')
    assert.equal(await readRawDocumentV04PreviewSnapshot(handle, result.workflowRunId), undefined)
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })
})

test('fabricated or mismatched store receipts fail real read-back verification', async () => {
  await withFreshKb('candidate-preview-fabricated-receipt', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, {
      previewSnapshotStore: {
        async persist(_targetHandle, previewInput) {
          return {
            status: 'persisted',
            snapshot: {
              workflowRunId: previewInput.workflowRunId,
              knowledgeBaseId: handle.knowledgeBaseId,
              contentHash: `sha256:${'0'.repeat(64)}`,
            },
          }
        },
      },
    }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'completed')
    assert.equal(result.extractionPreview.candidateGroups.length, 2)
    assert.equal(result.previewSnapshot.status, 'failed')
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.previewSnapshot.error?.code, 'PREVIEW_SNAPSHOT_MISSING')
    assert.equal(await readRawDocumentV04PreviewSnapshot(handle, result.workflowRunId), undefined)
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })

  await withFreshKb('candidate-preview-mismatched-readback', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, {
      previewSnapshotStore: {
        async persist(targetHandle, previewInput) {
          const altered = {
            ...previewInput,
            document: { ...previewInput.document, documentId: 'fabricated-document-id' },
            candidateGroups: previewInput.candidateGroups.map((group) => group.kind === 'entity'
              ? { ...group, candidate: { ...group.candidate, description: 'Altered after extraction.' } }
              : group),
            reviewConstraints: previewInput.reviewConstraints.map((constraint) => ({ ...constraint, reason: 'Altered after extraction.' })),
          }
          return persistRawDocumentV04PreviewSnapshot(targetHandle, altered)
        },
      },
    }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'completed')
    assert.equal(result.previewSnapshot.status, 'failed')
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.previewSnapshot.error?.code, 'PREVIEW_SNAPSHOT_MISMATCH')
    const stored = await readRawDocumentV04PreviewSnapshot(handle, result.workflowRunId)
    assert.equal(stored?.documentId, 'fabricated-document-id')
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })

  await withFreshKb('candidate-preview-mismatched-block-order', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, {
      previewSnapshotStore: {
        async persist(targetHandle, previewInput) {
          const altered = {
            ...previewInput,
            document: {
              ...previewInput.document,
              blocks: previewInput.document.blocks.map((block) => ({ ...block, order: block.order + 100 })),
            },
          }
          return persistRawDocumentV04PreviewSnapshot(targetHandle, altered)
        },
      },
    }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.previewSnapshot.status, 'failed')
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.previewSnapshot.error?.code, 'PREVIEW_SNAPSHOT_MISMATCH')
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })

  await withFreshKb('candidate-preview-forged-hash', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, {
      previewSnapshotStore: {
        async persist(targetHandle, previewInput) {
          const persisted = await persistRawDocumentV04PreviewSnapshot(targetHandle, previewInput)
          return { ...persisted, snapshot: { ...persisted.snapshot, contentHash: `sha256:${'1'.repeat(64)}` } }
        },
      },
    }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.previewSnapshot.status, 'failed')
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.previewSnapshot.error?.code, 'PREVIEW_RECEIPT_MISMATCH')
  })
})

test('cancellation during durable preview persistence reports an unknown state without claiming a commit', async () => {
  await withFreshKb('candidate-preview-cancel-persist', async (root) => {
    const handle = await mount(root)
    const controller = new AbortController()
    const result = await within(runRawDocumentKnowledgePreviewV04(input(handle, {
      signal: controller.signal,
      previewSnapshotStore: {
        async persist(targetHandle, previewInput) {
          void targetHandle
          void previewInput
          setTimeout(() => controller.abort(), 0)
          return new Promise<never>(() => undefined)
        },
      },
    })))

    assert.equal(result.status, 'cancelled')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'completed')
    assert.equal(result.extractionPreview.candidateGroups.length, 2)
    assert.equal(result.previewSnapshot.status, 'unknown')
    assert.equal(result.previewSnapshot.workflowRunId, result.workflowRunId)
    assert.equal(result.previewSnapshot.contentHash, undefined)
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal(result.cancellation?.pendingOperation, 'preview_snapshot_persist')
    assert.equal(result.cancellation?.pendingCallMayContinue, true)
    assert.match(result.cancellation?.message ?? '', /final persistence state is unknown/u)

    assert.equal(await readRawDocumentV04PreviewSnapshot(handle, result.workflowRunId), undefined)
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })
})

test('invalid extraction plan leaves a truthful Source-only result and does not write candidate objects', async () => {
  await withFreshKb('invalid-plan', async (root) => {
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), { skill: skill({ plan: invalidPlan() }), config: { maxPlanAttempts: 1 } }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.sourceRaw.status, 'committed')
    assert.equal(result.extractionPreview.status, 'blocked')
    assert.equal(result.extractionPreview.planAttempts[0]?.status, 'terminal_invalid')
    assert.equal(result.extractionPreview.planAttempts[0]?.validationCode, 'no_primary_content')
    assert.deepEqual(result.extractionPreview.candidateGroups, [])
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })
})

test('InvestmentTheme extraction remains a preview candidate and is routed to Theme Framework review', async () => {
  await withFreshKb('theme-candidate', async (root) => {
    const theme: EntityCandidate = { candidateId: 'theme-ai-computing', entityType: 'investment_theme', name: 'AI Computing', evidenceBlockRefs: ['block-ai-demand'], reason: 'A possible research theme mentioned in the report.', confidence: 0.8 }
    const output: ValidatedExtractKnowledgeResult = {
      entities: [theme], relations: [], claims: [], rejected: [],
      summary: { inputCounts: { entity: 1, relation: 0, claim: 0 }, acceptedCounts: { entity: 1, relation: 0, claim: 0 }, rejectedCounts: { entity: 0, relation: 0, claim: 0 }, rejectionCodes: [] },
    }
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), { skill: skill({ output }) }))

    assert.equal(result.status, 'preview_ready')
    assert.equal(result.extractionPreview.candidateGroups.length, 1)
    assert.equal(result.extractionPreview.reviewConstraints[0]?.category, 'theme_creation')
    assert.equal(result.extractionPreview.reviewConstraints[0]?.blocking, true)
    assert.match(result.extractionPreview.reviewConstraints[0]?.reason ?? '', /Theme Framework workflow/u)
    assert.deepEqual((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind), ['source'])
  })
})

test('parser failure after Source and Raw persistence is reported as a Source-only outcome', async () => {
  await withFreshKb('source-only', async (root) => {
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), { documentResolver: new DocumentInputResolver({ documentParser: parser({ fail: true }) }) }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'blocked')
    assert.match(result.extractionPreview.errors[0] ?? '', /fixture parser unavailable/u)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
  })
})

test('cancellation during planning preserves Source and Raw and reports preview cancellation', async () => {
  await withFreshKb('cancelled', async (root) => {
    const controller = new AbortController()
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), { skill: skill({ onPlan: () => controller.abort() }), signal: controller.signal }))

    assert.equal(result.status, 'cancelled')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'cancelled')
    assert.deepEqual(result.extractionPreview.candidateGroups, [])
    assert.equal(result.previewSnapshot.status, 'not_attempted')
    assert.equal(result.previewSnapshot.committable, false)
    assert.equal((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind).join(','), 'source')
  })
})

test('untrusted Gateway receipts with a mismatched KB, impossible revision, or malformed refs cannot establish Source persistence', async () => {
  const mutations: readonly [string, (receipt: RawDocumentGatewayV04Result) => RawDocumentGatewayV04Result][] = [
    ['kb-identity', (receipt: RawDocumentGatewayV04Result) => ({ ...receipt, knowledgeBaseId: 'kb-forged' })],
    ['revision', (receipt: RawDocumentGatewayV04Result) => ({ ...receipt, knowledgeBaseRevision: receipt.baseRevision + 2 })],
    ['ref-syntax', (receipt: RawDocumentGatewayV04Result) => ({ ...receipt, sourceRef: 'source:../forged' as `source:${string}` })],
  ]
  for (const [name, mutate] of mutations) {
    await withFreshKb(`receipt-${name}`, async (root) => {
      const realGateway = new RawDocumentKnowledgeGatewayV04({ clock: () => NOW })
      const gateway = {
        async submit(request: RawDocumentGatewayV04Input) {
          return mutate(await realGateway.submit(request))
        },
      }
      let planned = false
      const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), {
        gateway,
        skill: skill({ onPlan: () => { planned = true } }),
      }))

      assert.equal(result.status, 'blocked')
      assert.equal(result.sourceRaw.persisted, false)
      assert.equal(result.sourceRaw.status, 'failed')
      assert.equal(planned, false)
      assert.equal(result.provenance, undefined)
    })
  }
})

test('corrupt Raw bytes fail verification before candidate provenance is created', async () => {
  await withFreshKb('raw-corrupt', async (root) => {
    const realGateway = new RawDocumentKnowledgeGatewayV04({ clock: () => NOW })
    const gateway = {
      async submit(request: RawDocumentGatewayV04Input) {
        const receipt = await realGateway.submit(request)
        assert.ok(receipt.rawRef)
        const raw = await getRaw(request.handle, receipt.rawRef)
        await writeFile(raw.originalPath, Buffer.from('tampered bytes'))
        return receipt
      },
    }
    let planned = false
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), {
      gateway,
      skill: skill({ onPlan: () => { planned = true } }),
    }))

    assert.equal(result.status, 'blocked')
    assert.equal(result.sourceRaw.persisted, false)
    assert.equal(result.sourceRaw.status, 'failed')
    assert.match(result.sourceRaw.errors.at(-1)?.message ?? '', /integrity|hash|content/u)
    assert.equal(result.provenance, undefined)
    assert.equal(planned, false)
  })
})

test('cancellation stops waiting for a hanging parser and reports verified Source/Raw with the pending call', async () => {
  await withFreshKb('cancel-parser-pending', async (root) => {
    const controller = new AbortController()
    const baseResolver = new DocumentInputResolver({ documentParser: parser() })
    let forwardedSignal: AbortSignal | undefined
    const documentResolver = {
      acquire: (ref: RawDocumentPreviewWorkflowInputV04['documentInput']) => baseResolver.acquire(ref),
      parse: (_acquired: Parameters<typeof baseResolver.parse>[0], options?: { readonly signal?: AbortSignal }) => {
        forwardedSignal = options?.signal
        setTimeout(() => controller.abort(), 0)
        return new Promise<StructuredDocument>(() => undefined)
      },
    }
    const result = await within(runRawDocumentKnowledgePreviewV04(input(await mount(root), { documentResolver, signal: controller.signal })))

    assert.equal(result.status, 'cancelled')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.extractionPreview.status, 'cancelled')
    assert.equal(forwardedSignal, controller.signal)
    assert.equal(result.cancellation?.pendingOperation, 'document_parse')
    assert.equal(result.cancellation?.pendingCallMayContinue, true)
    assert.match(result.cancellation?.message ?? '', /underlying non-abortable call may still continue/u)
  })
})

test('cancellation stops waiting for a hanging Gateway and reports persistence as unknown', async () => {
  await withFreshKb('cancel-gateway-pending', async (root) => {
    const controller = new AbortController()
    let forwardedSignal: AbortSignal | undefined
    const gateway = {
      submit: (_request: RawDocumentGatewayV04Input, options?: { readonly signal?: AbortSignal }) => {
        forwardedSignal = options?.signal
        setTimeout(() => controller.abort(), 0)
        return new Promise<RawDocumentGatewayV04Result>(() => undefined)
      },
    }
    const result = await within(runRawDocumentKnowledgePreviewV04(input(await mount(root), { gateway, signal: controller.signal })))

    assert.equal(result.status, 'cancelled')
    assert.equal(result.sourceRaw.status, 'unknown')
    assert.equal(result.sourceRaw.persisted, false)
    assert.equal(result.cancellation?.pendingOperation, 'raw_gateway_submit')
    assert.equal(result.cancellation?.pendingCallMayContinue, true)
    assert.match(result.cancellation?.message ?? '', /may still finish and persist/u)
    assert.equal(forwardedSignal, controller.signal)
  })
})

test('a malformed extraction unit fails while valid units remain available as a partial preview', async () => {
  await withFreshKb('malformed-unit', async (root) => {
    const handle = await mount(root)
    const output = candidates()
    const secondOutput: ValidatedExtractKnowledgeResult = {
      ...output,
      entities: output.entities.map((entity) => ({ ...entity, candidateId: 'entity-second-unit', evidenceBlockRefs: ['block-ai-demand'] })),
      claims: [],
      summary: {
        inputCounts: { entity: 1, relation: 0, claim: 0 },
        acceptedCounts: { entity: 1, relation: 0, claim: 0 },
        rejectedCounts: { entity: 0, relation: 0, claim: 0 },
        rejectionCodes: [],
      },
    }
    const plan = twoUnitPlan()
    const testSkill: RawDocumentPreviewSkillV04 = {
      ...skill({ plan }),
      async extractKnowledge(request) {
        return request.unit.proposedUnitId === 'ai-demand-unit'
          ? { ...output, claims: [], summary: { inputCounts: { entity: 1, relation: 0, claim: 0 }, acceptedCounts: { entity: 1, relation: 0, claim: 0 }, rejectedCounts: { entity: 0, relation: 0, claim: 0 }, rejectionCodes: [] } }
          : secondOutput
      },
    }
    const documentResolver = {
      acquire: async (ref: RawDocumentPreviewWorkflowInputV04['documentInput']) => {
        const baseResolver = new DocumentInputResolver({ documentParser: parser() })
        return baseResolver.acquire(ref)
      },
      async parse() { return twoBlockDocument() },
    }
    const result = await runRawDocumentKnowledgePreviewV04(input(handle, { skill: testSkill, documentResolver }))

    assert.equal(result.status, 'preview_partial')
    assert.equal(result.extractionPreview.status, 'partial')
    assert.equal(result.extractionPreview.unitSummaries.find((item) => item.proposedUnitId === 'ai-demand-unit')?.status, 'completed')
    assert.equal(result.extractionPreview.unitSummaries.find((item) => item.proposedUnitId === 'ai-supply-unit')?.status, 'failed')
    assert.match(result.extractionPreview.errors.join('\n'), /not supplied to this extraction unit/u)
    assert.equal(result.extractionPreview.candidateGroups.length, 1)
    assert.match(result.extractionPreview.candidateGroups[0]?.candidateId ?? '', /^merged-entity-/u)
    assert.equal(result.previewSnapshot.status, 'persisted')
    assert.equal(result.previewSnapshot.committable, true)
    const snapshot = await readRawDocumentV04PreviewSnapshot(handle, result.workflowRunId)
    assert.equal(snapshot?.candidateGroups.length, 1)
    assert.equal(snapshot?.candidateGroups[0]?.candidateId, result.extractionPreview.candidateGroups[0]?.candidateId)
    assert.equal(snapshot?.sourceRef, result.sourceRaw.sourceRef)
    assert.equal(snapshot?.rawRef, result.sourceRaw.rawRef)
    assert.equal(snapshot?.extractionCompleteness, 'partial')
    assert.equal(snapshot?.incompleteUnits?.length, 1)
    assert.equal(snapshot?.incompleteUnits?.[0]?.unitId, 'unit-002')
    assert.equal(snapshot?.incompleteUnits?.[0]?.proposedUnitId, 'ai-supply-unit')
    assert.equal(snapshot?.incompleteUnits?.[0]?.status, 'failed')
    assert.match(snapshot?.incompleteUnits?.[0]?.errorSummary ?? '', /not supplied to this extraction unit/u)
  })
})

test('an extraction unit over the candidate-count bound is failed before consolidation', async () => {
  await withFreshKb('candidate-count-bound', async (root) => {
    const template = candidates().entities[0]!
    const count = 257
    const oversized: ValidatedExtractKnowledgeResult = {
      entities: Array.from({ length: count }, (_, index) => ({ ...template, candidateId: `entity-${index}` })),
      relations: [],
      claims: [],
      rejected: [],
      summary: {
        inputCounts: { entity: count, relation: 0, claim: 0 },
        acceptedCounts: { entity: count, relation: 0, claim: 0 },
        rejectedCounts: { entity: 0, relation: 0, claim: 0 },
        rejectionCodes: [],
      },
    }
    const result = await runRawDocumentKnowledgePreviewV04(input(await mount(root), { skill: skill({ output: oversized }) }))

    assert.equal(result.status, 'source_only')
    assert.equal(result.extractionPreview.unitSummaries[0]?.status, 'failed')
    assert.match(result.extractionPreview.errors.join('\n'), /exceeds 256 candidates/u)
    assert.deepEqual(result.extractionPreview.candidateGroups, [])
  })
})

test('cancellation stops waiting for Skill extraction and observes its late rejection without changing results', async () => {
  await withFreshKb('cancel-extraction-pending', async (root) => {
    const controller = new AbortController()
    let forwardedSignal: AbortSignal | undefined
    let lateRejected = false
    const testSkill: RawDocumentPreviewSkillV04 = {
      ...skill(),
      extractKnowledge: (request) => {
        forwardedSignal = request.signal
        setTimeout(() => controller.abort(), 0)
        return new Promise<ValidatedExtractKnowledgeResult>((_resolve, reject) => setTimeout(() => {
          lateRejected = true
          reject(new Error('late Skill failure after Workflow cancellation'))
        }, 20))
      },
    }
    const result = await within(runRawDocumentKnowledgePreviewV04(input(await mount(root), { skill: testSkill, signal: controller.signal })))

    assert.equal(result.status, 'cancelled')
    assert.equal(result.sourceRaw.persisted, true)
    assert.equal(result.cancellation?.pendingOperation, 'extract_knowledge')
    assert.equal(result.cancellation?.pendingCallMayContinue, true)
    assert.equal(forwardedSignal, controller.signal)
    assert.deepEqual(result.extractionPreview.candidateGroups, [])
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(lateRejected, true)
    assert.deepEqual(result.extractionPreview.candidateGroups, [])
  })
})

test('retry after Source-only failure reuses the committed Source and completes the candidate preview', async () => {
  await withFreshKb('source-only-retry', async (root) => {
    const handle = await mount(root)
    const first = await runRawDocumentKnowledgePreviewV04(input(handle, { documentResolver: new DocumentInputResolver({ documentParser: parser({ fail: true }) }) }))

    assert.equal(first.status, 'source_only')
    assert.equal(first.sourceRaw.status, 'committed')
    assert.equal(first.sourceRaw.persisted, true)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)

    const retry = await runRawDocumentKnowledgePreviewV04(input(handle))

    assert.equal(retry.status, 'preview_ready')
    assert.equal(retry.sourceRaw.status, 'already_committed')
    assert.equal(retry.sourceRaw.persisted, true)
    assert.equal(retry.sourceRaw.revision, first.sourceRaw.revision)
    assert.equal(retry.extractionPreview.candidateGroups.length, 2)
    assert.equal((await readCanonicalV04Assets(root)).objects.length, 1)
  })
})

test('Schema 0.3 is explicitly incompatible and blocked before input access', async () => {
  let acquired = false
  const legacyHandle = new KnowledgeBaseHandle({ knowledgeBaseId: 'kb-legacy', rootRef: 'C:\\not-opened', schemaVersion: '0.3', storageFormatVersion: '1', revision: 0, status: 'active' })
  const result = await runRawDocumentKnowledgePreviewV04(input(legacyHandle, {
    documentResolver: { acquire: async () => { acquired = true; throw new Error('must not acquire') }, parse: async () => documentFixture() },
  }))

  assert.equal(result.status, 'incompatible_schema')
  assert.equal(result.compatibility?.requiredSchemaVersion, '0.4')
  assert.equal(result.compatibility?.actualSchemaVersion, '0.3')
  assert.equal(result.sourceRaw.status, 'not_started')
  assert.equal(acquired, false)
  assert.match(result.extractionPreview.errors[0] ?? '', /must be explicitly re-ingested/u)
})
