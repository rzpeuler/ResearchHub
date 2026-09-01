import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeCurationError, KnowledgeCurationSkill, type KnowledgeContext, type NormalizedResearchDocument } from '../../../packages/skills/knowledge-curation/index.ts'
import { ScriptedKnowledgeCurationModel } from './scripted-model.ts'

const document: NormalizedResearchDocument = {
  rawRef: 'raw-sha256-' + 'a'.repeat(64),
  suppliedMetadata: { title: 'Validation fixture', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', sourceUrl: null },
  normalizedText: 'Company and industry evidence.',
  chunks: [{ chunkId: 'chunk-0001', text: 'Company and industry evidence.', section: 'Summary', page: 1, locator: 'p1' }],
}
const context: KnowledgeContext = {
  knowledgeBaseId: 'kb-test',
  schemaVersion: '0.3',
  existingRefs: ['entity:existing'],
  themeGroups: [],
  themes: [],
  entities: [{ id: 'entity:existing', type: 'company', name: 'Existing Company', aliases: [], lifecycle: { status: 'active' } }],
  relations: [],
  claims: [],
  sources: [],
}
const reportUnderstanding = {
  sourceAssessment: { sourceType: 'official_disclosure', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', primaryOrSecondary: 'secondary', sourceReliability: 'high', sourceIdentityConfidence: 0.9, reasoning: ['Fixture context.'] },
  researchScope: ['semiconductor'],
  majorTopics: ['validation'],
  majorEntityMentions: [{ mention: 'Existing Company', entityType: 'company', suggestedExistingRef: 'entity:existing', evidenceChunkRefs: ['chunk-0001'], reason: 'Fixture context.' }],
  themeHypotheses: [],
  uncertainty: [],
}
const input = {
  workflowRunId: 'run-validation',
  knowledgeBaseId: 'kb-test',
  document,
  batch: { batchId: 'batch-0013', sections: [], chunks: document.chunks },
  reportUnderstanding,
  knowledgeContext: context,
}

function entity(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { entityType: 'company', name, aliases: [], description: null, suggestedExistingRef: null, semanticFields: {}, evidenceChunkRefs: ['chunk-0001'], reason: 'Evidence supports the entity.', ...overrides }
}
function relation(relationType: 'upstream_of' | 'supplier_of' | 'business_exposure' = 'supplier_of', sourceType = 'company', targetType = 'company', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { relationType, sourceMention: { text: 'Source', entityType: sourceType, existingRef: null }, targetMention: { text: 'Target', entityType: targetType, existingRef: null }, attributes: relationType === 'business_exposure' ? { exposureBasis: 'direct_operation', realizationStage: 'reported', materiality: 'material' } : {}, contextMentions: [], evidenceChunkRefs: ['chunk-0001'], reason: 'Evidence supports the relation.', ...overrides }
}
function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { claimType: 'fact', statement: 'The stated fact is supported.', subjectMentions: [{ text: 'Source', entityType: 'company', existingRef: null }], temporal: null, structuredValue: { metric: 'value', value: 1, unit: 'ratio', comparator: 'approx' }, semanticConfidence: 0.85, evidenceChunkRefs: ['chunk-0001'], reason: 'Evidence supports the claim.', ...overrides }
}
function skill(output: unknown): { skill: KnowledgeCurationSkill; model: ScriptedKnowledgeCurationModel } {
  const model = new ScriptedKnowledgeCurationModel().set('extractKnowledge', output)
  return { skill: new KnowledgeCurationSkill({ model }), model }
}

test('isolates local Entity, Relation, and Claim failures while preserving ordinals', async () => {
  const { skill: curation, model } = skill({
    entities: [entity('Accepted Entity'), entity('Rejected Entity', { evidenceChunkRefs: ['chunk-missing'] })],
    relations: [
      relation('supplier_of', 'industry', 'company'),
      relation('supplier_of'),
      relation('not-a-relation' as never),
      relation('supplier_of'),
    ],
    claims: [claim({ semanticConfidence: 2 }), claim()],
  })
  const result = await curation.extractKnowledge(input)
  assert.deepEqual(result.entities.map((item) => item.candidateId), ['candidate-batch-0013-entity-0001'])
  assert.deepEqual(result.relations.map((item) => item.candidateId), ['candidate-batch-0013-relation-0002', 'candidate-batch-0013-relation-0004'])
  assert.deepEqual(result.claims.map((item) => item.candidateId), ['candidate-batch-0013-claim-0002'])
  assert.deepEqual(result.validationRejections.map((item) => [item.candidateKind, item.originalOrdinal, item.code]), [
    ['entity', 2, 'invalid_reference'],
    ['relation', 1, 'invalid_semantics'],
    ['relation', 3, 'invalid_semantics'],
    ['claim', 1, 'invalid_confidence'],
  ])
  assert.deepEqual(result.validationSummary.accepted, { entity: 1, relation: 2, claim: 1 })
  assert.deepEqual(result.validationSummary.rejected, { entity: 1, relation: 2, claim: 1 })
  assert.deepEqual(result.validationSummary.rejectionCountsByCode, { invalid_reference: 1, invalid_semantics: 2, invalid_confidence: 1 })
  assert.equal(model.requests.length, 1)
  assert.equal(result.validationRejections.some((item) => item.message.includes('Source') || item.message.includes('Target')), false)
})

test('accepts only the frozen upstream_of Industry to Industry variant without coercion', async () => {
  const { skill: curation } = skill({
    entities: [],
    relations: [
      relation('upstream_of', 'company', 'industry'),
      relation('upstream_of', 'industry', 'industry'),
      relation('business_exposure', 'industry', 'industry'),
    ],
    claims: [],
  })
  const result = await curation.extractKnowledge(input)
  assert.deepEqual(result.relations.map((item) => item.candidateId), ['candidate-batch-0013-relation-0002'])
  assert.deepEqual(result.relations.map((item) => [item.relationType, item.sourceMention.entityType, item.targetMention.entityType]), [['upstream_of', 'industry', 'industry']])
  assert.deepEqual(result.validationRejections.map((item) => [item.originalOrdinal, item.code, item.relationType]), [[1, 'invalid_semantics', 'upstream_of'], [3, 'invalid_semantics', 'business_exposure']])
})

test('trusted candidate fields and malformed top-level extraction remain operation-fatal', async () => {
  for (const output of [
    { entities: [entity('Attacker', { id: 'entity:attacker' })], relations: [], claims: [] },
    { entities: [], relations: 'not-an-array', claims: [] },
    { entities: [], claims: [] },
    { entities: [], relations: [], claims: [], extra: true },
  ]) {
    const { skill: curation } = skill(output)
    await assert.rejects(() => curation.extractKnowledge(input), (error: unknown) => error instanceof KnowledgeCurationError && (error.code === 'invalid_reference' || error.code === 'invalid_model_output'))
  }
})

test('empty extraction arrays are valid and do not create validation rejections', async () => {
  const { skill: curation, model } = skill({ entities: [], relations: [], claims: [] })
  const result = await curation.extractKnowledge(input)
  assert.deepEqual(result.entities, [])
  assert.deepEqual(result.relations, [])
  assert.deepEqual(result.claims, [])
  assert.deepEqual(result.validationRejections, [])
  assert.deepEqual(result.validationSummary, { accepted: { entity: 0, relation: 0, claim: 0 }, rejected: { entity: 0, relation: 0, claim: 0 }, rejectionCountsByCode: {}, rejections: [] })
  assert.equal(model.requests.length, 1)
})

test('all local failures are surfaced as candidate_set_exhausted with sanitized rejection metadata', async () => {
  const { skill: curation } = skill({ entities: [entity('Rejected', { evidenceChunkRefs: ['chunk-missing'] })], relations: [], claims: [] })
  await assert.rejects(() => curation.extractKnowledge(input), (error: unknown) => {
    return error instanceof KnowledgeCurationError &&
      error.code === 'candidate_set_exhausted' &&
      error.candidateValidationRejections?.length === 1 &&
      error.candidateValidationRejections[0]?.code === 'invalid_reference' &&
      error.candidateValidationRejections[0]?.message.includes('EntityCandidate[1]')
  })
})
