import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeCurationSkill } from '../../../packages/skills/knowledge-curation/index.ts'
import type { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'
import { DefaultResearchReportInputResolver } from '../../../packages/workflows/research-report-knowledge-ingestion/input-resolver.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { ScriptedKnowledgeCurationModel } from '../curation/scripted-model.ts'
import { createLegacyV01KnowledgeBase, createRuntimeKnowledgeBase, removeRuntimeKnowledgeBase } from '../runtime/helpers.ts'

function sourceOutput() {
  return { rawRef: 'model-must-not-control-raw', sourceType: 'sell_side_research', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', primaryOrSecondary: 'secondary', sourceReliability: 'medium', sourceIdentityConfidence: 0.9, reasoning: ['Supplied fixture assessment.'] }
}

function candidateOutput() {
  return { candidateId: 'model-id', workflowRunId: 'model-run', knowledgeBaseId: 'model-kb', candidateType: 'entity', intelligenceType: null, subjectRefs: [], claim: { normalizedStatement: 'NVIDIA is an AI compute company.', originalStatement: 'NVIDIA is an AI compute company.' }, temporal: { asOf: null, periodStart: null, periodEnd: null, forecastHorizon: null }, provenance: { rawRef: 'model-raw', sourceRef: 'model-source', page: null, section: null, locator: null, chunkId: 'chunk-0001' }, sourceAssessmentRef: 'model-assessment', confidence: { score: 0.8, factors: { sourceReliability: 'medium', directness: 0.8, corroboration: 0.4, freshness: 0.8, conflictStatus: 1 }, reasoning: ['Specific company mention.'] }, entityResolution: { mention: 'NVIDIA', suggestedEntityRef: null, confidence: 0.8 }, proposedKnowledge: { object: { id: 'attacker-id', type: 'company', name: 'NVIDIA', sourceRefs: ['attacker-source'] } }, mappingStatus: 'mapped', admission: 'pending', notes: [] }
}

function invalidRelationCandidateOutput() {
  return { ...candidateOutput(), candidateType: 'relation', entityResolution: null, proposedKnowledge: { object: { id: 'attacker-relation', type: 'not-a-relation', source: 'candidate-run-ingest-0001', target: 'segment:gpu' } } }
}

function duplicateEntityCandidateOutput() {
  return { ...candidateOutput(), claim: { normalizedStatement: 'GPU is an AI compute segment.', originalStatement: 'NVIDIA is an AI compute company.' }, entityResolution: { mention: 'GPU', suggestedEntityRef: 'segment:gpu', confidence: 0.99 }, proposedKnowledge: { object: { id: 'duplicate-segment', type: 'segment', name: 'GPU' } } }
}

function buildInvalidCandidateModel(): ScriptedKnowledgeCurationModel {
  return new ScriptedKnowledgeCurationModel()
    .set('assess_source', sourceOutput())
    .set('filter_relevance', [{ chunkId: 'chunk-0001', decision: 'relevant', reason: 'research_relevant' }])
    .set('extract_candidates', [candidateOutput(), invalidRelationCandidateOutput()])
    .queue('assess_admission', [
      { candidateId: 'candidate-run-ingest-0001', decision: 'admit', reason: 'relevant_and_material', reasoning: ['Material entity.'], dimensions: { relevance: 'direct', specificity: 'high', informationGain: 'high', evidenceDensity: 'direct', temporalScopePrecision: 'not-applicable', researchUtility: 'high' } },
      { candidateId: 'candidate-run-ingest-0002', decision: 'admit', reason: 'relevant_and_material', reasoning: ['Candidate relation.'], dimensions: { relevance: 'direct', specificity: 'high', informationGain: 'high', evidenceDensity: 'direct', temporalScopePrecision: 'not-applicable', researchUtility: 'high' } },
    ])
    .set('map_candidates', [
      { candidateId: 'candidate-run-ingest-0001', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'company', name: 'NVIDIA' } } },
      { candidateId: 'candidate-run-ingest-0002', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'not-a-relation', source: 'candidate-run-ingest-0001', target: 'segment:gpu' } } },
    ])
    .queue('analyze_conflicts', [
      { decisionId: 'entity-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0001', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing company match.', decisionConfidence: 0.9, requiresUserReview: false },
      { decisionId: 'relation-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0002', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing relation match.', decisionConfidence: 0.9, requiresUserReview: false },
    ])
    .set('detect_schema_gaps', [])
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
    assert.deepEqual(result.plannedChanges.knowledgeCreate, ['company:nvidia'])
    assert.equal(result.finalRevision, 1)
    const loaded = await setup(root)
    assert.ok(loaded.index.entities.has('company:nvidia'))
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.equal((log.ingestionContext as Record<string, unknown>).workflowVersion, '0.1')
    assert.deepEqual((log.rawArchive as Record<string, unknown>).created, [result.raw.rawRef])
    assert.doesNotMatch(JSON.stringify(log), /NVIDIA is an AI compute company/)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('all-irrelevant reports persist only Raw and do not create a Source', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const model = new ScriptedKnowledgeCurationModel()
      .set('assess_source', sourceOutput())
      .set('filter_relevance', [{ chunkId: 'chunk-0001', decision: 'irrelevant', reason: 'unrelated_content' }])
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }) })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed', JSON.stringify(result))
    assert.equal(result.raw.persisted, true)
    assert.equal(result.source.sourceId, null)
    assert.equal(result.candidates.extracted, 0)
    assert.deepEqual(result.changes, { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 })
    assert.equal(result.finalRevision, 0)
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.deepEqual((log.rawArchive as Record<string, unknown>).created, [result.raw.rawRef])
    assert.deepEqual((log.changes as Record<string, unknown>).sourceCreated, [])
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('Research Report Ingestion refuses a v0.1 target without silently migrating it', async () => {
  const root = await createLegacyV01KnowledgeBase()
  try {
    const beforeManifest = await readFile(join(root, 'manifest.yaml'), 'utf8')
    const request = input('commit')
    request.knowledgeBaseId = 'kb-legacy-test'
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model: buildModel() }) })
    const result = await workflow.execute(request)
    assert.equal(result.status, 'blocked')
    assert.equal(result.errors[0]?.code, 'unsupported_schema')
    assert.equal(await readFile(join(root, 'manifest.yaml'), 'utf8'), beforeManifest)
    await assert.rejects(readFile(join(root, 'logs/ingestion/run-ingest.yaml'), 'utf8'))
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('dry-run validates a readonly Knowledge Base and exposes planned changes without writing', async () => {
  const root = await createRuntimeKnowledgeBase({ status: 'readonly' })
  try {
    const before = JSON.stringify(await readdir(root, { recursive: true }))
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model: buildModel() }) })
    const result = await workflow.execute(input('dry_run'))
    assert.equal(result.status, 'completed')
    assert.equal(result.validation?.status, 'passed')
    assert.equal(result.raw.persisted, false)
    assert.deepEqual(result.plannedChanges.knowledgeCreate, ['company:nvidia'])
    assert.deepEqual(result.changes, { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 })
    assert.equal(JSON.stringify(await readdir(root, { recursive: true })), before)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('dry-run preserves completed_with_review for safe and user-review candidates', async () => {
  const root = await createRuntimeKnowledgeBase({ status: 'readonly' })
  try {
    const before = JSON.stringify(await readdir(root, { recursive: true }))
    const model = buildInvalidCandidateModel()
      .set('extract_candidates', [candidateOutput(), duplicateEntityCandidateOutput()])
      .set('map_candidates', [
        { candidateId: 'candidate-run-ingest-0001', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'company', name: 'NVIDIA' } } },
        { candidateId: 'candidate-run-ingest-0002', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'segment', name: 'GPU' } } },
      ])
      .queue('analyze_conflicts', [
        { decisionId: 'entity-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0001', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing company match.', decisionConfidence: 0.9, requiresUserReview: false },
        { decisionId: 'review-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0002', existingKnowledgeRefs: ['segment:gpu'], conflictType: 'fact_conflict', resolution: 'user_review', comparison: { sameEntity: true, sameMetric: true, samePeriod: true, sameUnit: true, sameRegion: false, sameDefinition: true, sameMethodology: true }, reason: 'Conflicting fact requires review.', decisionConfidence: 0.8, requiresUserReview: true },
      ])
    let writes = 0
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }), writer: { write: async () => { writes += 1; throw new Error('Writer must not run during dry-run') } } })
    const result = await workflow.execute(input('dry_run'))
    assert.equal(result.status, 'completed_with_review', JSON.stringify(result))
    assert.equal(result.userReview.length, 1)
    assert.deepEqual(result.plannedChanges.knowledgeCreate, ['company:nvidia'])
    assert.deepEqual(result.changes, { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 })
    assert.equal(result.raw.persisted, false)
    assert.equal(result.finalRevision, 0)
    assert.equal(result.ingestionLogRef, undefined)
    assert.equal(writes, 0)
    assert.equal(JSON.stringify(await readdir(root, { recursive: true })), before)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('dry-run preserves completed_with_review when a Schema Gap is present', async () => {
  const root = await createRuntimeKnowledgeBase({ status: 'readonly' })
  try {
    const before = JSON.stringify(await readdir(root, { recursive: true }))
    const model = buildModel().set('detect_schema_gaps', [{ candidateRefs: ['candidate-run-ingest-0001'], gapType: 'schema_gap', observedInformation: { description: 'A product attribute is not modeled.', examples: ['memory bandwidth'] }, currentLimitation: { description: 'Current entity schema lacks the attribute.' }, suggestedDirection: { description: 'Review the product schema.' }, affectedKnowledgeTypes: ['entity'], affectedIndustries: ['AI Hardware'], generality: 'local', frequency: 'first_seen', recommendedAction: 'architecture_review' }])
    let writes = 0
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }), writer: { write: async () => { writes += 1; throw new Error('Writer must not run during dry-run') } } })
    const result = await workflow.execute(input('dry_run'))
    assert.equal(result.status, 'completed_with_review', JSON.stringify(result))
    assert.equal(result.schemaGaps.length, 1)
    assert.deepEqual(result.plannedChanges.knowledgeCreate, ['company:nvidia'])
    assert.deepEqual(result.changes, { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 })
    assert.equal(result.raw.persisted, false)
    assert.equal(result.finalRevision, 0)
    assert.equal(result.ingestionLogRef, undefined)
    assert.equal(writes, 0)
    assert.equal(JSON.stringify(await readdir(root, { recursive: true })), before)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('external document resolution keeps exact raw bytes separate from normalized text', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const rawBytes = new Uint8Array([0, 255, 65, 0, 10])
    const resolver = new DefaultResearchReportInputResolver(async () => ({ rawBytes, originalFilename: 'report.pdf', mediaType: 'application/pdf', normalizedText: 'NVIDIA is an AI compute company.', chunks: [{ chunkId: 'chunk-0001', text: 'NVIDIA is an AI compute company.', section: null, locator: 'page:1' }] }))
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, inputResolver: resolver, curation: new KnowledgeCurationSkill({ model: buildModel() }) })
    const externalInput = { ...input('commit'), report: { ...input('commit').report, inputRef: { type: 'file' as const, reference: 'fixture-report.pdf' } } }
    const result = await workflow.execute(externalInput)
    assert.equal(result.status, 'completed')
    const rawRegistry = JSON.parse(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8')) as Record<string, { storageRef: string }>
    const entry = rawRegistry[result.raw.rawRef]
    assert.ok(entry)
    assert.deepEqual([...await readFile(join(root, entry.storageRef))], [...rawBytes])
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('candidate-specific validation rejects one invalid operation and commits safe candidates', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const model = buildInvalidCandidateModel()
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }) })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed', JSON.stringify(result))
    assert.equal(result.changes.knowledgeCreated, 1)
    assert.equal(result.candidates.validationRejected, 1)
    assert.ok((await setup(root)).index.entities.has('company:nvidia'))
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    const context = log.ingestionContext as Record<string, unknown>
    assert.equal((context.candidateSummary as Record<string, unknown>).admitted, 2)
    assert.equal((context.candidateSummary as Record<string, unknown>).mapped, 2)
    assert.equal(log.validationRejects, 1)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('dry-run prunes invalid candidates once, keeps safe plans, and never invokes Writer', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const before = JSON.stringify(await readdir(root, { recursive: true }))
    let writes = 0
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({
      targetResolver: { resolve: async () => setup(root) },
      curation: new KnowledgeCurationSkill({ model: buildInvalidCandidateModel() }),
      writer: { write: async () => { writes += 1; throw new Error('Writer must not be called during dry-run') } },
    })
    const result = await workflow.execute(input('dry_run'))
    assert.equal(result.status, 'completed', JSON.stringify(result))
    assert.equal(result.validation?.status, 'passed')
    assert.equal(result.candidates.validationRejected, 1)
    assert.deepEqual(result.plannedChanges.knowledgeCreate, ['company:nvidia'])
    assert.deepEqual(result.changes, { sourceCreated: 0, sourceMerged: 0, knowledgeCreated: 0, knowledgeUpdated: 0, knowledgeSuperseded: 0, knowledgeSourceMerged: 0 })
    assert.equal(writes, 0)
    assert.equal(JSON.stringify(await readdir(root, { recursive: true })), before)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('safe and user-review candidates commit together and project review into the log', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const model = buildInvalidCandidateModel()
      .set('extract_candidates', [candidateOutput(), duplicateEntityCandidateOutput()])
      .set('map_candidates', [
        { candidateId: 'candidate-run-ingest-0001', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'company', name: 'NVIDIA' } } },
        { candidateId: 'candidate-run-ingest-0002', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'segment', name: 'GPU' } } },
      ])
      .queue('analyze_conflicts', [
        { decisionId: 'entity-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0001', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing company match.', decisionConfidence: 0.9, requiresUserReview: false },
        { decisionId: 'review-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0002', existingKnowledgeRefs: ['segment:gpu'], conflictType: 'fact_conflict', resolution: 'user_review', comparison: { sameEntity: true, sameMetric: true, samePeriod: true, sameUnit: true, sameRegion: false, sameDefinition: true, sameMethodology: true }, reason: 'Conflicting fact requires review.', decisionConfidence: 0.8, requiresUserReview: true },
      ])
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }) })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed_with_review', JSON.stringify(result))
    assert.equal(result.changes.knowledgeCreated, 1)
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.equal(log.status, 'completed_with_review')
    assert.equal((log.ingestionContext as Record<string, unknown>).workflowStatus, 'completed_with_review')
    assert.equal(((log.userReview as Array<Record<string, unknown>>)[0]).candidateId, 'candidate-run-ingest-0002')
    assert.doesNotMatch(JSON.stringify(log), /NVIDIA is an AI compute company/)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('safe and duplicate candidates commit with duplicate audit preserved', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const model = buildInvalidCandidateModel()
      .set('extract_candidates', [candidateOutput(), duplicateEntityCandidateOutput()])
      .set('map_candidates', [
        { candidateId: 'candidate-run-ingest-0001', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'company', name: 'NVIDIA' } } },
        { candidateId: 'candidate-run-ingest-0002', mappingStatus: 'mapped', proposedKnowledge: { object: { type: 'segment', name: 'GPU' } } },
      ])
      .queue('analyze_conflicts', [
        { decisionId: 'entity-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0001', existingKnowledgeRefs: [], conflictType: 'none', resolution: 'create', comparison: { sameEntity: false, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: false, sameMethodology: false }, reason: 'No existing company match.', decisionConfidence: 0.9, requiresUserReview: false },
        { decisionId: 'duplicate-decision', knowledgeBaseId: 'kb-runtime-test', candidateId: 'candidate-run-ingest-0002', existingKnowledgeRefs: ['segment:gpu'], conflictType: 'duplicate', resolution: 'reject', comparison: { sameEntity: true, sameMetric: false, samePeriod: false, sameUnit: false, sameRegion: false, sameDefinition: true, sameMethodology: true }, reason: 'Existing segment is identical.', decisionConfidence: 0.99, requiresUserReview: false },
      ])
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }) })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed', JSON.stringify(result))
    assert.equal(result.changes.knowledgeCreated, 1)
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.equal(((log.ingestionContext as Record<string, unknown>).duplicateSummary as Record<string, unknown>).duplicates, 1)
    assert.equal((log.validationRejects as number | undefined) ?? 0, 0)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('safe candidate commits while Schema Gap remains in the audit', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    const model = buildModel().set('detect_schema_gaps', [{ candidateRefs: ['candidate-run-ingest-0001'], gapType: 'schema_gap', observedInformation: { description: 'A product attribute is not modeled.', examples: ['memory bandwidth'] }, currentLimitation: { description: 'Current entity schema lacks the attribute.' }, suggestedDirection: { description: 'Review the product schema.' }, affectedKnowledgeTypes: ['entity'], affectedIndustries: ['AI Hardware'], generality: 'local', frequency: 'first_seen', recommendedAction: 'architecture_review' }])
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model }) })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'completed_with_review', JSON.stringify(result))
    assert.equal(result.changes.knowledgeCreated, 1)
    const log = JSON.parse(await readFile(join(root, 'logs', 'ingestion', 'run-ingest.yaml'), 'utf8')) as Record<string, unknown>
    assert.equal((log.schemaGaps as Array<Record<string, unknown>>).length, 1)
    assert.equal(((log.ingestionContext as Record<string, unknown>).schemaGaps as Array<Record<string, unknown>>).length, 1)
  } finally { await removeRuntimeKnowledgeBase(root) }
})

test('systemic validation failure blocks the workflow without candidate pruning', async () => {
  const root = await createRuntimeKnowledgeBase()
  try {
    let writes = 0
    const validation = { validateChangeSet: async () => ({ report: { status: 'failed' as const, errors: [{ code: 'STALE_BASE_REVISION', severity: 'error' as const, message: 'base revision changed' }], warnings: [], info: [], timestamp: '2026-08-26T00:00:00.000Z', scope: 'all' as const } }) } as unknown as KnowledgeValidationSkill
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: { resolve: async () => setup(root) }, curation: new KnowledgeCurationSkill({ model: buildModel() }), validation, writer: { write: async () => { writes += 1; throw new Error('Writer must not run after systemic validation failure') } } })
    const result = await workflow.execute(input('commit'))
    assert.equal(result.status, 'blocked')
    assert.equal(result.failureStage, 'validation')
    assert.equal(result.candidates.validationRejected, 0)
    assert.equal(writes, 0)
    assert.equal(result.raw.persisted, true)
    assert.equal((await setup(root)).index.entities.has('company:nvidia'), false)
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
