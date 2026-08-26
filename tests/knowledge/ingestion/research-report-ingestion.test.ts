import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeCurationSkill } from '../../../packages/skills/knowledge-curation/index.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { ScriptedKnowledgeCurationModel } from '../curation/scripted-model.ts'
import { createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from '../runtime/helpers.ts'

function sourceOutput() {
  return { rawRef: 'model-must-not-control-raw', sourceType: 'sell_side_research', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', primaryOrSecondary: 'secondary', sourceReliability: 'medium', sourceIdentityConfidence: 0.9, reasoning: ['Supplied fixture assessment.'] }
}

function candidateOutput() {
  return { candidateId: 'model-id', workflowRunId: 'model-run', knowledgeBaseId: 'model-kb', candidateType: 'entity', intelligenceType: null, subjectRefs: [], claim: { normalizedStatement: 'NVIDIA is an AI compute company.', originalStatement: 'NVIDIA is an AI compute company.' }, temporal: { asOf: null, periodStart: null, periodEnd: null, forecastHorizon: null }, provenance: { rawRef: 'model-raw', sourceRef: 'model-source', page: null, section: null, locator: null, chunkId: 'chunk-0001' }, sourceAssessmentRef: 'model-assessment', confidence: { score: 0.8, factors: { sourceReliability: 'medium', directness: 0.8, corroboration: 0.4, freshness: 0.8, conflictStatus: 1 }, reasoning: ['Specific company mention.'] }, entityResolution: { mention: 'NVIDIA', suggestedEntityRef: null, confidence: 0.8 }, proposedKnowledge: { object: { id: 'attacker-id', type: 'company', name: 'NVIDIA', sourceRefs: ['attacker-source'] } }, mappingStatus: 'mapped', admission: 'pending', notes: [] }
}

function buildModel(): ScriptedKnowledgeCurationModel {
  return new ScriptedKnowledgeCurationModel()
    .set('assess_source', sourceOutput())
    .set('filter_relevance', [{ chunkId: 'chunk-0001', decision: 'relevant', reason: 'research_relevant' }])
    .set('extract_candidates', [candidateOutput()])
    .set('assess_admission', { candidateId: 'candidate-run-ingest-0001', decision: 'admit', reason: 'relevant_and_material', reasoning: ['Material entity.'], dimensions: { relevance: 'direct', specificity: 'high', informationGain: 'high', evidenceDensity: 'direct', temporalScopePrecision: 'not-applicable', researchUtility: 'high' } })
    .set('map_candidates', [{ candidateId: 'candidate-run-ingest-0001', mappingStatus: 'mapped', proposedKnowledge: { object: { id: 'attacker-id', type: 'company', name: 'NVIDIA', sourceRefs: ['attacker-source'] } } }])
    .set('analyze_conflicts', { decisionId: 'model-decision', knowledgeBaseId: 'model-kb', candidateId: 'candidate-run-ingest-0001', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing company match.', decisionConfidence: 0.9, requiresUserReview: false })
    .set('detect_schema_gaps', [])
}

function input(mode: 'commit' | 'dry_run', reprocess = false) {
  return { workflowRunId: 'run-ingest', knowledgeBaseId: 'kb-runtime-test', report: { inputRef: { type: 'text' as const, text: 'NVIDIA is an AI compute company.' }, suppliedMetadata: { title: 'AI Hardware Outlook', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', sourceUrl: 'https://example.test/report' } }, options: { mode, reprocess } }
}

async function setup(root: string) {
  const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
  const handle = await loader.mount(root)
  const index = await loader.load(handle)
  return { handle, index }
}

test('Research report ingestion commits Raw, Source, Entity and a structured log', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const targetResolver = { resolve: async () => setup(root) }
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver, curation: new KnowledgeCurationSkill({ model: buildModel() }), clock: () => '2026-08-26T00:00:00.000Z' })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed', JSON.stringify(result.errors))
    assert.equal(result.raw.persisted, true)
    assert.equal(result.changes.knowledgeCreated, 1)
    assert.equal(result.finalRevision, 1)
    const loaded = await setup(root)
    assert.ok(loaded.index.entities.has('company:nvidia'))
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.equal((log.ingestionContext as Record<string, unknown>).workflowVersion, '0.1')
    assert.doesNotMatch(JSON.stringify(log), /NVIDIA is an AI compute company/)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('dry-run does not create Raw, logs, assets, or revision changes', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const before = JSON.stringify(await readdir(root, { recursive: true }))
    const { handle } = await setup(root)
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model: buildModel() }) })
    const result = await workflow.execute(input('dry_run'))
    assert.equal(result.status, 'completed')
    assert.equal(result.raw.persisted, false)
    assert.equal(result.finalRevision, handle.revision)
    assert.equal(JSON.stringify(await readdir(root, { recursive: true })), before)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('successful ingestion is idempotent when reprocess is false', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const targetResolver = { resolve: async () => setup(root) }
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver, curation: new KnowledgeCurationSkill({ model: buildModel() }), clock: () => '2026-08-26T00:00:00.000Z' })
    const first = await workflow.execute(input('commit'))
    const second = await workflow.execute(input('commit'))
    assert.equal(first.status, 'completed')
    assert.equal(second.status, 'completed', JSON.stringify(second))
    assert.equal(second.finalRevision, first.finalRevision)
    assert.equal(second.changes.knowledgeCreated, 0)
  } finally { await removeRuntimeKnowledgeBase(root) }
})
