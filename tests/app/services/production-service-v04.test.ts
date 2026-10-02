import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
import type { RawDocumentPreviewWorkflowResultV04 } from '../../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'

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
const plan = { reportMap, extractionPlanProposal: { units: [{ proposedUnitId: 'ai-demand', topic: 'AI computing demand', semanticPurpose: 'Extract evidence-backed knowledge', primaryRefs: [{ kind: 'block', blockId: 'block-ai-demand' }], contextRefs: [] }], excludedRefs: [] } }
const extraction = { entities: [{ candidateId: 'industry-ai-computing', entityType: 'industry', name: 'AI Computing', evidenceBlockRefs: ['block-ai-demand'], reason: 'The source names this industry.' }], relations: [], claims: [{ candidateId: 'claim-demand-growth', claimType: 'fact', statement: 'AI computing demand is increasing.', subjectRefs: [{ candidateRef: 'industry-ai-computing', mention: 'AI computing' }], evidenceBlockRefs: ['block-ai-demand'], reason: 'The source states increasing demand.' }] }

async function fixture(schema: '0.3' | '0.4', run: (root: string) => Promise<void>): Promise<void> {
  const root = schema === '0.3' ? await createKnowledgeBase({ schemaVersion: '0.3', knowledgeBaseId: 'kb-production-service-v03' }) : await mkdtemp(join(tmpdir(), 'rhl-production-service-v04-'))
  try {
    if (schema === '0.4') await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-production-service-v04', now: '2026-10-02T00:00:00.000Z' })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function service(root: string, reasoningExecutor = new MockReasoningExecutor({ capabilities: caps, responses: { understandAndPlan: plan, extractKnowledge: extraction } }), rawDocumentPreviewRunner: typeof runRawDocumentKnowledgePreviewV04 = runRawDocumentKnowledgePreviewV04) {
  return new ProductionService({ mountedKnowledgeBaseRoot: root, reasoningExecutor, workflowService: new WorkflowService(), rawDocumentPreviewDocumentResolver: new DocumentInputResolver({ documentParser: parser }), rawDocumentPreviewRunner })
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
