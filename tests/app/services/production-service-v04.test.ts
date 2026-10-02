import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { DocumentInputResolver } from '../../../plugins/document/input-resolver.ts'
import type { DocumentParser, DocumentParserInput, StructuredDocument } from '../../../plugins/document/contracts.ts'
import { MockReasoningExecutor } from '../../../plugins/reasoning/mock/executor.ts'
import { ProductionService } from '../../../app/services/production-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { RawDocumentRightsV04 } from '../../../knowledge/production/raw-document-gateway-v04.ts'
import { createKnowledgeBase } from '../../knowledge/helpers.ts'
import { runRawDocumentKnowledgePreviewV04 } from '../../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { RawDocumentPreviewSnapshotStoreV04, RawDocumentPreviewWorkflowResultV04 } from '../../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import { persistRawDocumentV04PreviewSnapshot } from '../../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const rights: RawDocumentRightsV04 = { accessScope: 'authenticated', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'User supplied this document for personal research processing.' }
const sourceMetadata = { title: 'AI Computing Research', sourceType: 'sell_side_research' as const, sourceReliability: 'medium' as const, publisher: 'Fixture Research' }
const caps = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 1 }
const reportMap = { sourceAssessment: { summary: 'Fixture source' }, researchScope: 'AI computing demand', majorTopics: [{ topicId: 'topic-ai-demand', label: 'AI computing demand', evidenceRefs: [{ kind: 'block', blockId: 'block-ai-demand' }] }], majorEntityMentions: [], majorConclusions: [], sectionSemantics: [], semanticDependencies: [], themeHypotheses: [], uncertainty: [] }
const parser: DocumentParser = {
  id: 'production-service-test-parser', supports: () => true,
  async parse(input: DocumentParserInput): Promise<StructuredDocument> {
    const text = Buffer.from(input.bytes).toString('utf8')
    return { documentId: 'doc-production-preview-test', parser: { id: 'production-service-test-parser', version: '1' }, metadata: { originalFilename: input.filename, mediaType: input.mediaType }, normalizedText: text, sections: [], blocks: [{ blockId: 'block-ai-demand', type: 'paragraph', text: 'AI computing demand is increasing.', sectionRef: null, page: 1, locator: { page: 1 }, order: 1 }], stats: { pageCount: 1, sectionCount: 0, blockCount: 1, normalizedCharacters: text.length, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [] }
  },
}
const partialParser: DocumentParser = {
  ...parser,
  async parse(input: DocumentParserInput): Promise<StructuredDocument> {
    const first = await parser.parse(input)
    const secondText = 'Chip supply is constrained.'
    return { ...first, normalizedText: `${first.normalizedText}\n${secondText}`, blocks: [...first.blocks, { blockId: 'block-chip-supply', type: 'paragraph', text: secondText, sectionRef: null, page: 1, locator: { page: 1 }, order: 2 }], stats: { ...first.stats, blockCount: 2, normalizedCharacters: first.normalizedText.length + secondText.length + 1 } }
  },
}
const plan = { reportMap, extractionPlanProposal: { units: [{ proposedUnitId: 'ai-demand', topic: 'AI computing demand', semanticPurpose: 'Extract evidence-backed knowledge', primaryRefs: [{ kind: 'block', blockId: 'block-ai-demand' }], contextRefs: [] }], excludedRefs: [] } }
const extraction = { entities: [{ candidateId: 'industry-ai-computing', entityType: 'industry', name: 'AI Computing', evidenceBlockRefs: ['block-ai-demand'], reason: 'The source names this industry.' }], relations: [], claims: [{ candidateId: 'claim-demand-growth', claimType: 'fact', statement: 'AI computing demand is increasing.', subjectRefs: [{ candidateRef: 'industry-ai-computing', mention: 'AI computing' }], evidenceBlockRefs: ['block-ai-demand'], reason: 'The source states increasing demand.' }] }

async function fixture(schema: '0.3' | '0.4', run: (root: string) => Promise<void>): Promise<void> {
  const root = schema === '0.3' ? await createKnowledgeBase({ schemaVersion: '0.3', knowledgeBaseId: 'kb-production-service-v03' }) : await mkdtemp(join(tmpdir(), 'rhl-production-service-v04-'))
  try {
    if (schema === '0.4') await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-production-service-v04', now: '2026-10-02T00:00:00.000Z' })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function service(root: string, reasoningExecutor: ReasoningExecutor = new MockReasoningExecutor({ capabilities: caps, responses: { understandAndPlan: plan, extractKnowledge: extraction } }), rawDocumentPreviewRunner: typeof runRawDocumentKnowledgePreviewV04 = runRawDocumentKnowledgePreviewV04, workflowService = new WorkflowService(), snapshotStore?: RawDocumentPreviewSnapshotStoreV04, documentParser: DocumentParser = parser) {
  return new ProductionService({ mountedKnowledgeBaseRoot: root, reasoningExecutor, workflowService, rawDocumentPreviewDocumentResolver: new DocumentInputResolver({ documentParser }), rawDocumentPreviewRunner, ...(snapshotStore === undefined ? {} : { rawDocumentPreviewSnapshotStore: snapshotStore }) })
}

test('V0.4 service returns a durable candidate preview and accepts only explicitly selected IDs', async () => {
  await fixture('0.4', async (root) => {
    let workflowResult: RawDocumentPreviewWorkflowResultV04 | undefined
    const subject = service(root, undefined, async (input) => { workflowResult = await runRawDocumentKnowledgePreviewV04(input); return workflowResult })
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'service-v04-preview', text: 'AI computing demand is increasing. DO_NOT_RETURN_RAW_TEXT', sourceMetadata, rights })
    assert.equal(started.runId, 'service-v04-preview')
    const preview = await started.completion
    assert.equal(preview.status, 'preview_ready', JSON.stringify(workflowResult?.extractionPreview.errors ?? preview))
    assert.equal(preview.committable, true)
    assert.ok(preview.sourceRef?.startsWith('source:'))
    assert.ok(preview.rawRef?.startsWith('raw-sha256-'))
    assert.equal(preview.candidateGroups.length, 2)
    assert.equal(JSON.stringify(preview).includes('DO_NOT_RETURN_RAW_TEXT'), false)
    const durable = await subject.readRawDocumentKnowledgePreviewV04(started.runId)
    assert.equal(durable?.committable, true)
    assert.equal(durable?.candidateGroups[0]?.provenanceRefs.sourceRef, preview.sourceRef)
    const remounted = await service(root).readRawDocumentKnowledgePreviewV04(started.runId)
    assert.equal(remounted?.committable, true)
    assert.equal(remounted?.candidateGroups.length, 2)
    assert.equal(remounted?.extractionCompleteness, 'complete')
    assert.deepEqual(remounted?.incompleteUnits, [])
    const invalid = await subject.acceptRawDocumentV04Candidates({ previewWorkflowRunId: started.runId, acceptedCandidateIds: ['candidate-not-present'] })
    assert.equal(invalid.status, 'blocked', JSON.stringify(invalid))
    assert.equal(invalid.errors[0]?.code, 'ACCEPTED_CANDIDATE_UNKNOWN')
    const candidateId = preview.candidateGroups.find((item) => item.kind === 'entity')!.candidateId
    const accepted = await subject.acceptRawDocumentV04Candidates({ previewWorkflowRunId: started.runId, acceptedCandidateIds: [candidateId] })
    assert.ok(['committed', 'already_committed', 'no_changes'].includes(accepted.status))
    assert.equal(accepted.acceptedCandidateIds[0], candidateId)
    assert.ok(accepted.canonicalRefsByCandidateId[candidateId]?.startsWith('entity:'))
  })
})

test('a durable V0.4 snapshot remains hidden until its Workflow reaches a terminal state', async () => {
  await fixture('0.4', async (root) => {
    let allowTerminal!: () => void
    let notifySnapshotReady!: () => void
    const terminalGate = new Promise<void>((resolve) => { allowTerminal = resolve })
    const snapshotReady = new Promise<void>((resolve) => { notifySnapshotReady = resolve })
    const runner: typeof runRawDocumentKnowledgePreviewV04 = async (input) => {
      const result = await runRawDocumentKnowledgePreviewV04(input)
      notifySnapshotReady()
      await terminalGate
      return result
    }
    const workflows = new WorkflowService()
    const subject = service(root, undefined, runner, workflows)
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'snapshot-before-terminal', text: 'AI computing demand is increasing. Additional report sections follow.', sourceMetadata, rights })

    await snapshotReady
    assert.equal(workflows.getWorkflowStatus(started.runId)?.status, 'running')
    const early = await subject.readRawDocumentKnowledgePreviewV04(started.runId)
    assert.equal(early?.committable, false)
    assert.deepEqual(early?.candidateGroups, [])

    allowTerminal()
    const completed = await started.completion
    assert.equal(completed.committable, true)
    assert.ok(completed.candidateGroups.length > 0)
  })
})

test('V0.4 service rejects missing rights and reports explicit incompatibility for a Schema 0.3 KB', async () => {
  await fixture('0.4', async (root) => {
    const subject = service(root)
    assert.throws(() => subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'rights-missing', text: 'test', sourceMetadata, rights: undefined as never }), /rights must be supplied explicitly/)
  })
  await fixture('0.3', async (root) => {
    const preview = await service(root).startRawDocumentKnowledgePreviewV04({ workflowRunId: 'schema-v03-preview', text: 'AI computing demand is increasing.', sourceMetadata, rights }).completion
    assert.equal(preview.status, 'incompatible_schema')
    assert.equal(preview.committable, false)
    assert.equal(preview.candidateGroups.length, 0)
  })
})

test('V0.4 service observes cancellation while reasoning is pending', async () => {
  await fixture('0.4', async (root) => {
    let entered!: () => void
    const enteredReasoning = new Promise<void>((resolve) => { entered = resolve })
    const executor = {
      capabilities: () => caps,
      execute: async (_request: unknown, signal?: AbortSignal) => {
        entered()
        return new Promise<{ output: unknown }>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled by test')), { once: true }))
      },
    }
    const subject = service(root, executor as never)
    const controller = new AbortController()
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'cancel-v04-preview', text: 'AI computing demand is increasing.', sourceMetadata, rights }, controller.signal)
    await enteredReasoning
    controller.abort()
    const result = await started.completion
    assert.equal(result.status, 'cancelled')
    assert.equal(result.committable, false)
    assert.equal(subject['options'].workflowService.getWorkflowStatus(started.runId)?.status, 'cancelled')
  })
})

test('cached success is not committable after its durable sidecar disappears or KB becomes incompatible', async () => {
  await fixture('0.4', async (root) => {
    let workflowResult: RawDocumentPreviewWorkflowResultV04 | undefined
    const subject = service(root, undefined, async (input) => { workflowResult = await runRawDocumentKnowledgePreviewV04(input); return workflowResult })
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'missing-sidecar', text: 'AI computing demand is increasing. Additional report sections follow.', sourceMetadata, rights })
    assert.equal((await started.completion).committable, true, JSON.stringify({ preview: await subject.readRawDocumentKnowledgePreviewV04(started.runId), errors: workflowResult?.extractionPreview.errors, snapshot: workflowResult?.previewSnapshot }))
    await unlink(join(root, 'logs', 'ingestion', 'v04-preview', `${started.runId}.json`))
    const missing = await subject.readRawDocumentKnowledgePreviewV04(started.runId)
    assert.equal(missing?.committable, false)
    assert.deepEqual(missing?.candidateGroups, [])

    const second = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'incompatible-after-preview', text: 'AI computing demand is increasing. Additional report sections follow.', sourceMetadata, rights })
    assert.equal((await second.completion).committable, true)
    const manifestPath = join(root, 'manifest.yaml')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: '0.3' }) + '\n')
    const incompatible = await subject.readRawDocumentKnowledgePreviewV04(second.runId)
    assert.equal(incompatible?.committable, false)
    assert.deepEqual(incompatible?.candidateGroups, [])
  })
})

test('a cancelled preview that persists late becomes reviewable only after durable read-back', async () => {
  await fixture('0.4', async (root) => {
    let allowPersist!: () => void
    let enteredPersist!: () => void
    const persistGate = new Promise<void>((resolve) => { allowPersist = resolve })
    const persistEntered = new Promise<void>((resolve) => { enteredPersist = resolve })
    const snapshotStore: RawDocumentPreviewSnapshotStoreV04 = { async persist(handle, input) { enteredPersist(); await persistGate; return persistRawDocumentV04PreviewSnapshot(handle, input) } }
    const workflows = new WorkflowService()
    const subject = service(root, undefined, runRawDocumentKnowledgePreviewV04, workflows, snapshotStore)
    const controller = new AbortController()
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'cancel-during-persist', text: 'AI computing demand is increasing. Additional report sections follow.', sourceMetadata, rights }, controller.signal)
    await persistEntered
    controller.abort()
    const initial = await started.completion
    assert.equal(initial.status, 'cancelled')
    assert.equal(initial.committable, false)
    assert.equal(workflows.getWorkflowStatus(started.runId)?.status, 'cancelled')
    allowPersist()

    let recovered = await subject.readRawDocumentKnowledgePreviewV04(started.runId)
    for (let attempt = 0; attempt < 50 && !recovered?.committable; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      recovered = await subject.readRawDocumentKnowledgePreviewV04(started.runId)
    }
    assert.equal(recovered?.committable, true, JSON.stringify(recovered))
    assert.equal(recovered?.status, 'preview_ready')
    assert.match(recovered?.statusNote ?? '', /cancelled.*persisted later.*read-back verification/i)
    assert.equal(workflows.getWorkflowStatus(started.runId)?.status, 'cancelled')
  })
})

test('WorkflowService error summary never contains raw executor/provider error text', async () => {
  await fixture('0.4', async (root) => {
    const secret = 'SOURCE_SNIPPET_MUST_NOT_LEAK_7811'
    const workflows = new WorkflowService()
    const failingRunner: typeof runRawDocumentKnowledgePreviewV04 = async () => { throw new Error(secret) }
    const subject = service(root, undefined, failingRunner, workflows)
    const started = subject.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'safe-error-summary', text: secret, sourceMetadata, rights })
    await assert.rejects(started.completion, /failed during a bounded processing stage/)
    const workflow = workflows.getWorkflowStatus(started.runId)
    assert.equal(workflow?.status, 'failed')
    assert.equal((workflow?.errorSummary ?? '').includes(secret), false)
    assert.equal((workflow?.progressSummary ?? '').includes(secret), false)
  })
})

test('remounted partial snapshot returns bounded incomplete-unit metadata without provider errors', async () => {
  await fixture('0.4', async (root) => {
    const partialPlan = { reportMap: { ...reportMap, majorTopics: [
      { topicId: 'topic-ai-demand', label: 'AI computing demand', evidenceRefs: [{ kind: 'block', blockId: 'block-ai-demand' }] },
      { topicId: 'topic-chip-supply', label: 'Chip supply', evidenceRefs: [{ kind: 'block', blockId: 'block-chip-supply' }] },
    ] }, extractionPlanProposal: { units: [
      { proposedUnitId: 'ai-demand', topic: 'AI computing demand', semanticPurpose: 'Extract evidence-backed knowledge', primaryRefs: [{ kind: 'block', blockId: 'block-ai-demand' }], contextRefs: [] },
      { proposedUnitId: 'chip-supply', topic: 'Chip supply', semanticPurpose: 'Extract evidence-backed knowledge', primaryRefs: [{ kind: 'block', blockId: 'block-chip-supply' }], contextRefs: [] },
    ], excludedRefs: [] } }
    const secret = 'PROVIDER_ERROR_CONTAINS_SOURCE_SNIPPET_92'
    let extractionCall = 0
    const partialExecutor: ReasoningExecutor = {
      capabilities: () => caps,
      async execute(request: ReasoningRequest): Promise<ReasoningResult> {
        if (request.operation === 'understandAndPlan') return { operation: request.operation, output: partialPlan }
        extractionCall += 1
        if (extractionCall > 1) throw new Error(secret)
        return { operation: request.operation, output: extraction }
      },
    }
    const startedService = service(root, partialExecutor, runRawDocumentKnowledgePreviewV04, new WorkflowService(), undefined, partialParser)
    const started = startedService.startRawDocumentKnowledgePreviewV04({ workflowRunId: 'partial-snapshot-remount', text: 'AI computing demand is increasing.\nChip supply is constrained.', sourceMetadata, rights })
    const preview = await started.completion
    assert.equal(preview.status, 'preview_partial')
    assert.equal(preview.committable, true)
    const remounted = await service(root).readRawDocumentKnowledgePreviewV04(started.runId)
    assert.equal(remounted?.committable, true)
    assert.equal(remounted?.extractionCompleteness, 'partial')
    assert.equal(remounted?.incompleteUnits?.length, 1)
    assert.equal(remounted?.incompleteUnits?.[0]?.status, 'failed')
    assert.equal(remounted?.incompleteUnits?.[0]?.errorSummary.includes(secret), false)
  })
})
