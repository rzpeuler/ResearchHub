import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import { readRaw } from '../../knowledge/raw/raw-archive.ts'
import { DocumentInputResolver } from '../../plugins/document/input-resolver.ts'
import type { DocumentParser, DocumentParserInput, StructuredDocument } from '../../plugins/document/contracts.ts'
import type { RawDocumentPreviewSkillV04, RawDocumentPreviewWorkflowInputV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import { runRawDocumentKnowledgePreviewV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { ClaimCandidate, EntityCandidate, ReportMap, UnderstandAndPlanOutput, ValidatedExtractKnowledgeResult } from '../../skills/knowledge-curation/contracts.ts'

const NOW = '2026-10-02T00:00:00.000Z'
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
    normalizedText: 'AI computing demand is increasing.',
    sections: [],
    blocks: [{ blockId: 'block-ai-demand', type: 'paragraph', text: 'AI computing demand is increasing.', sectionRef: null, page: 1, locator: { page: 1, parserItemRef: 'paragraph-1' }, order: 1 }],
    stats: { pageCount: 1, sectionCount: 0, blockCount: 1, normalizedCharacters: 36, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 },
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
    documentInput: { type: 'text', text: 'AI computing demand is increasing.', originalFilename: 'ai-capacity.txt', mediaType: 'text/plain', documentId: 'doc-ai-capacity-fixture' },
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

test('Schema 0.4 workflow persists Source and Raw then returns evidence-linked candidates without canonical knowledge writes', async () => {
  await withFreshKb('candidate-preview', async (root) => {
    const handle = await mount(root)
    const result = await runRawDocumentKnowledgePreviewV04(input(handle))

    assert.equal(result.status, 'preview_ready')
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
    assert.deepEqual(await readRaw(handle, result.sourceRaw.rawRef!), Buffer.from('AI computing demand is increasing.'))

    const assets = await readCanonicalV04Assets(root)
    assert.deepEqual(assets.objects.map((asset) => asset.kind), ['source'])
    assert.equal(assets.objects.some((asset) => asset.kind === 'theme_group'), false)
    assert.equal(assets.objects.some((asset) => asset.kind === 'entity' || asset.kind === 'relation' || asset.kind === 'claim'), false)
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
    assert.equal((await readCanonicalV04Assets(root)).objects.map((asset) => asset.kind).join(','), 'source')
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
