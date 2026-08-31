import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { KNOWLEDGE_SCHEMA_V03 } from '../../../packages/schemas/knowledge/v03/executable-schema.ts'
import { KnowledgeCurationError, KnowledgeCurationSkill, type ExtractKnowledgeInput, type KnowledgeContext, type NormalizedResearchDocument, type ReportUnderstanding } from '../../../packages/skills/knowledge-curation/index.ts'
import { KnowledgeCurationModelAdapter } from '../../../dsh/llm-runtime/knowledge-curation-model-adapter.ts'
import { buildCurationSchemaContext } from '../../../packages/skills/knowledge-curation/schema-context.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../../packages/skills/knowledge-curation/contracts.ts'
import { ScriptedKnowledgeCurationModel } from './scripted-model.ts'

const rawRef = 'raw-sha256-' + 'a'.repeat(64)
const document: NormalizedResearchDocument = {
  rawRef,
  suppliedMetadata: { title: 'Research Report', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', sourceUrl: 'https://example.test/report' },
  normalizedText: 'Example Company operates in semiconductors and revenue increased.',
  chunks: [{ chunkId: 'chunk-0001', text: 'Example Company operates in semiconductors and revenue increased.', section: 'Summary', page: 1, locator: 'p1' }],
}
const existingEntity = { id: 'entity:existing', type: 'company' as const, name: 'Example Company', aliases: ['Example'], lifecycle: { status: 'active' as const } }
const context: KnowledgeContext = { knowledgeBaseId: 'kb-test', schemaVersion: '0.3', existingRefs: ['entity:existing'], themeGroups: [], themes: [], entities: [existingEntity], relations: [], claims: [], sources: [] }
const scope = { workflowRunId: 'run-001', knowledgeBaseId: 'kb-test', document }

function extractionProjectionInput(): ExtractKnowledgeInput {
  const chunks = [
    { chunkId: 'chunk-0001', text: 'CURRENT BATCH TEXT', section: 'Current', page: 1, locator: 'p1' },
    { chunkId: 'chunk-0002', text: 'OUT OF BATCH TEXT', section: 'Other', page: 2, locator: 'p2' },
    { chunkId: 'chunk-0003', text: 'ANOTHER OUT OF BATCH TEXT', section: 'Other', page: 3, locator: 'p3' },
  ]
  const reportUnderstanding = understanding({
    majorEntityMentions: [{ mention: 'Example Company', entityType: 'company', suggestedExistingRef: 'entity:existing', evidenceChunkRefs: ['chunk-0001', 'chunk-0002'], reason: 'Named in report.' }],
    themeHypotheses: [{ mention: 'Current Theme', disposition: 'resolved_existing', existingThemeRefs: ['theme:existing'], reason: 'Theme is in context.', evidenceChunkRefs: ['chunk-0003'] }],
  }) as unknown as ReportUnderstanding
  const knowledgeContext = {
    knowledgeBaseId: 'kb-test',
    schemaVersion: '0.3',
    existingRefs: ['entity:existing', 'theme:existing'],
    themeGroups: [{ id: 'theme-group:existing', name: 'Existing Group', aliases: [] }],
    themes: [{ id: 'theme:existing', name: 'Existing Theme', aliases: [], themeGroupRef: 'theme-group:existing' }],
    entities: [existingEntity],
    relations: [{ id: 'relation:context', sourceRef: 'entity:existing', targetRef: 'entity:existing', type: 'business_exposure', provenance: [{ chunkRef: 'chunk-0002' }] }],
    claims: [{ id: 'claim:context', statement: 'Context claim', provenance: [{ chunkRef: 'chunk-0002', rawRef }] }],
    sources: [{ id: 'source:context', rawRefs: [rawRef] }],
  } as unknown as KnowledgeContext
  return {
    workflowRunId: 'run-projection',
    knowledgeBaseId: 'kb-projection',
    document: { ...document, normalizedText: 'FULL DOCUMENT NORMALIZED TEXT SENTINEL', chunks, sections: [{ sectionId: 'section-all', title: 'All sections', chunkIds: chunks.map((chunk) => chunk.chunkId) }] },
    batch: { batchId: 'batch-0001', sections: [{ sectionId: 'section-current', title: 'Current', chunkIds: ['chunk-0001'] }], chunks: [chunks[0]!] },
    reportUnderstanding,
    knowledgeContext,
  }
}

function understanding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceAssessment: { sourceType: 'official_disclosure', publisher: 'Research House', institution: null, author: 'Analyst', publishedAt: '2026-08-26', primaryOrSecondary: 'secondary', sourceReliability: 'high', sourceIdentityConfidence: 0.9, reasoning: ['Metadata is consistent.'] },
    researchScope: ['semiconductor industry'], majorTopics: ['revenue'], majorEntityMentions: [{ mention: 'Example Company', entityType: 'company', suggestedExistingRef: 'entity:existing', evidenceChunkRefs: ['chunk-0001'], reason: 'Named in report.' }],
    themeHypotheses: [], uncertainty: [], ...overrides,
  }
}
function entity(name = 'New Company'): Record<string, unknown> { return { entityType: 'company', name, aliases: [], description: null, suggestedExistingRef: null, semanticFields: {}, evidenceChunkRefs: ['chunk-0001'], reason: 'Explicitly stated.' } }
function relation(): Record<string, unknown> { return { relationType: 'business_exposure', sourceMention: { text: 'Example Company', entityType: 'company', existingRef: 'entity:existing' }, targetMention: { text: 'Semiconductor', entityType: 'industry', existingRef: null }, attributes: { exposureBasis: 'direct_operation', realizationStage: 'reported', materiality: 'material' }, contextMentions: [], evidenceChunkRefs: ['chunk-0001'], reason: 'The report describes the exposure.' } }
function supplierRelation(sourceType = 'company', targetType = 'company'): Record<string, unknown> { return { relationType: 'supplier_of', sourceMention: { text: 'Supplier', entityType: sourceType, existingRef: null }, targetMention: { text: 'Customer', entityType: targetType, existingRef: null }, attributes: {}, contextMentions: [], evidenceChunkRefs: ['chunk-0001'], reason: 'The report describes the supply relationship.' } }
function substitutesRelation(): Record<string, unknown> { return { relationType: 'substitutes_for', sourceMention: { text: 'Product', entityType: 'product', existingRef: null }, targetMention: { text: 'Technology', entityType: 'technology', existingRef: null }, attributes: {}, contextMentions: [], evidenceChunkRefs: ['chunk-0001'], reason: 'The report describes substitutability.' } }
function claim(): Record<string, unknown> { return { claimType: 'fact', statement: 'Example Company revenue increased.', subjectMentions: [{ text: 'Example Company', entityType: 'company', existingRef: 'entity:existing' }], temporal: null, structuredValue: { metric: 'growth', value: 0.2, unit: 'ratio', comparator: 'approx' }, semanticConfidence: 0.85, evidenceChunkRefs: ['chunk-0001'], reason: 'The report states the change.' } }
function makeSkill(output: unknown, operation: string): { skill: KnowledgeCurationSkill; model: ScriptedKnowledgeCurationModel } { const model = new ScriptedKnowledgeCurationModel().set(operation, output); return { skill: new KnowledgeCurationSkill({ model }), model } }
function errorCode(action: () => Promise<unknown>, code: string): Promise<void> { return assert.rejects(action, (error: unknown) => error instanceof KnowledgeCurationError && error.code === code) as Promise<void> }

test('exposes exactly four public operations and no legacy aliases', () => {
  const methods = Object.getOwnPropertyNames(KnowledgeCurationSkill.prototype).filter((name) => name !== 'constructor' && name !== 'invoke' && !name.startsWith('_')).sort()
  assert.deepEqual(methods, ['analyzeSchemaGaps', 'extractKnowledge', 'reconcileKnowledge', 'understandReport'])
})

test('understandReport sends the v0.3 request shape and automatic report slice', async () => {
  const { skill: curation, model } = makeSkill(understanding(), 'understandReport')
  await curation.understandReport({ ...scope, themeContext: context })
  const request = model.requests[0]!
  assert.deepEqual(Object.keys(request).sort(), ['input', 'instruction', 'operation', 'outputContract', 'schemaContext'].sort())
  assert.equal(request.operation, 'understandReport'); assert.equal(request.schemaContext?.slice, 'report_understanding')
  assert.equal(request.outputContract?.format, 'json'); assert.equal(typeof request.outputContract?.schema, 'object'); assert.equal(request.instruction.includes('REPORT CONTENT'), false); const schema = request.outputContract?.schema as { properties: { sourceAssessment: { properties: { sourceType: { canonicalEnumRef: string } } } } }; assert.equal(schema.properties.sourceAssessment.properties.sourceType.canonicalEnumRef, 'schema.source.types')
})

test('each operation maps to its frozen C1 slice and each invocation is one model call', async () => {
  const u = new ScriptedKnowledgeCurationModel().set('understandReport', understanding()); await new KnowledgeCurationSkill({ model: u }).understandReport({ ...scope, themeContext: context }); assert.equal(u.requests[0]?.schemaContext?.slice, 'report_understanding')
  const e = new ScriptedKnowledgeCurationModel().set('extractKnowledge', { entities: [], relations: [], claims: [] }); await new KnowledgeCurationSkill({ model: e }).extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }); assert.equal(e.requests[0]?.schemaContext?.slice, 'knowledge_extraction')
  const r = new ScriptedKnowledgeCurationModel().set('reconcileKnowledge', { decisions: [] }); await new KnowledgeCurationSkill({ model: r }).reconcileKnowledge({ ...scope, groups: [], sourceAssessment: understanding().sourceAssessment as never }); assert.equal(r.requests[0]?.schemaContext?.slice, 'reconciliation')
  const g = new ScriptedKnowledgeCurationModel().set('analyzeSchemaGaps', { gaps: [] }); await new KnowledgeCurationSkill({ model: g }).analyzeSchemaGaps({ ...scope, candidates: [], knowledgeContext: context }); assert.equal(g.requests[0]?.schemaContext?.slice, 'schema_gap')
  assert.deepEqual(KNOWLEDGE_SCHEMA_V03.claim.types, [...KNOWLEDGE_SCHEMA_V03.claim.types])
})
function sliceOf(operation: string): string { return ({ understandReport: 'report_understanding', extractKnowledge: 'knowledge_extraction', reconcileKnowledge: 'reconciliation', analyzeSchemaGaps: 'schema_gap' } as Record<string, string>)[operation]! }

test('extractKnowledge projects only the current batch and least-privilege semantic context', async () => {
  const input = extractionProjectionInput()
  const before = structuredClone(input)
  const model = new ScriptedKnowledgeCurationModel().set('extractKnowledge', { entities: [entity()], relations: [], claims: [] })
  const result = await new KnowledgeCurationSkill({ model }).extractKnowledge(input)
  const projected = model.requests[0]?.input as Record<string, any>
  const serialized = JSON.stringify(projected)
  const visibleDocumentChunkIds = input.document.chunks.map((chunk) => chunk.chunkId).filter((chunkId) => serialized.includes(chunkId))
  assert.deepEqual(visibleDocumentChunkIds, ['chunk-0001'])
  assert.equal(projected.workflowRunId, undefined)
  assert.equal(projected.knowledgeBaseId, undefined)
  assert.equal(projected.document, undefined)
  assert.equal(serialized.includes('FULL DOCUMENT NORMALIZED TEXT SENTINEL'), false)
  assert.equal(serialized.includes('OUT OF BATCH TEXT'), false)
  assert.equal(projected.batch.batchId, 'batch-0001')
  assert.equal(projected.batch.chunks[0].text, 'CURRENT BATCH TEXT')
  assert.deepEqual(projected.reportUnderstanding.majorEntityMentions[0].evidenceChunkRefs, ['chunk-0001'])
  assert.deepEqual(projected.reportUnderstanding.themeHypotheses[0].evidenceChunkRefs, [])
  assert.equal(projected.knowledgeContext.schemaVersion, '0.3')
  assert.deepEqual(projected.knowledgeContext.existingRefs, ['entity:existing', 'theme:existing'])
  assert.equal(projected.knowledgeContext.entities[0].id, 'entity:existing')
  assert.equal(projected.knowledgeContext.relations, undefined)
  assert.equal(projected.knowledgeContext.claims, undefined)
  assert.equal(projected.knowledgeContext.sources, undefined)
  assert.equal(result.entities[0]?.candidateId, 'candidate-batch-0001-entity-0001')
  assert.deepEqual(input, before)
})

test('extractKnowledge retains Validator defense against hidden out-of-batch references', async () => {
  const input = extractionProjectionInput()
  const model = new ScriptedKnowledgeCurationModel().set('extractKnowledge', { entities: [{ ...entity(), evidenceChunkRefs: ['chunk-0002'] }], relations: [], claims: [] })
  await errorCode(() => new KnowledgeCurationSkill({ model }).extractKnowledge(input), 'invalid_reference')
  assert.equal(JSON.stringify(model.requests[0]?.input).includes('chunk-0002'), false)
})

test('extractKnowledge retry preserves the C8 projection and adds only bounded validation feedback', async () => {
  const input = extractionProjectionInput()
  const invalid = { entities: [], relations: [{ ...relation(), targetMention: { text: 'Company', entityType: 'company', existingRef: null } }], claims: [] }
  const longMessage = 'validator-detail-'.repeat(40)
  const model = new ScriptedKnowledgeCurationModel().queue('extractKnowledge', [invalid, { entities: [entity()], relations: [], claims: [] }])
  const skill = new KnowledgeCurationSkill({ model })
  await assert.rejects(skill.extractKnowledge(input), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_semantics')
  const result = await skill.extractKnowledge(input, { validationFeedback: { attempt: 2, code: 'invalid_semantics', message: longMessage } })
  assert.equal(result.entities.length, 1)
  assert.equal(model.requests.length, 2)
  assert.deepEqual(model.requests[0]?.input, model.requests[1]?.input)
  const firstInput = model.requests[0]?.input as Record<string, any>
  assert.equal(firstInput.document, undefined)
  assert.equal(JSON.stringify(firstInput).includes('chunk-0002'), false)
  assert.equal(model.requests[0]?.instruction.includes('Validation code:'), false)
  assert.match(model.requests[1]?.instruction ?? '', /Validation code: invalid_semantics/)
  assert.match(model.requests[1]?.instruction ?? '', /validator-detail-/)
  assert.equal((model.requests[1]?.instruction.match(/validator-detail-/g) ?? []).length, 14)
  assert.equal(model.requests[1]?.instruction.includes(longMessage), false)
})

test('non-extraction operations retain their authoritative model input shape', async () => {
  const understandModel = new ScriptedKnowledgeCurationModel().set('understandReport', understanding())
  await new KnowledgeCurationSkill({ model: understandModel }).understandReport({ ...scope, themeContext: context })
  assert.match(JSON.stringify(understandModel.requests[0]?.input), /run-001/)
  assert.match(JSON.stringify(understandModel.requests[0]?.input), /normalizedText/)
  const reconcileModel = new ScriptedKnowledgeCurationModel().set('reconcileKnowledge', { decisions: [] })
  await new KnowledgeCurationSkill({ model: reconcileModel }).reconcileKnowledge({ ...scope, groups: [], sourceAssessment: understanding().sourceAssessment as never })
  assert.match(JSON.stringify(reconcileModel.requests[0]?.input), /run-001/)
  const gapModel = new ScriptedKnowledgeCurationModel().set('analyzeSchemaGaps', { gaps: [] })
  await new KnowledgeCurationSkill({ model: gapModel }).analyzeSchemaGaps({ ...scope, candidates: [], knowledgeContext: context })
  assert.match(JSON.stringify(gapModel.requests[0]?.input), /normalizedText/)
})

test('understandReport validates source and semantic understanding', async () => { const { skill: curation } = makeSkill(understanding({ themeHypotheses: [{ mention: 'New Theme', disposition: 'proposed_new', existingThemeRefs: [], reason: 'Not in catalog.', evidenceChunkRefs: ['chunk-0001'] }], newThemeProposal: { name: 'New Theme', definition: 'A new theme.', reason: 'Report focus.' } }), 'understandReport'); const result = await curation.understandReport({ ...scope, themeContext: context }); assert.equal(result.sourceAssessment.sourceType, KNOWLEDGE_SCHEMA_V03.source.types[0]); assert.equal(result.themeHypotheses[0]?.disposition, 'proposed_new') })
test('invalid source type and reliability are rejected through schema context', async () => { for (const field of ['sourceType', 'sourceReliability']) { const output = understanding({ sourceAssessment: { ...understanding().sourceAssessment as object, [field]: 'not-frozen' } }); const { skill: curation } = makeSkill(output, 'understandReport'); await errorCode(() => curation.understandReport({ ...scope, themeContext: context }), 'invalid_semantics') } })
test('trusted workflow, KB, raw, and canonical IDs in model output fail', async () => { const { skill: curation } = makeSkill({ ...understanding(), rawRef }, 'understandReport'); await errorCode(() => curation.understandReport({ ...scope, themeContext: context }), 'invalid_reference') })

test('extractKnowledge returns separated Entity, Relation, and Claim candidates', async () => { const { skill: curation } = makeSkill({ entities: [entity()], relations: [relation()], claims: [claim()] }, 'extractKnowledge'); const result = await curation.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [{ sectionId: 'section-0001', title: 'Summary', chunkIds: ['chunk-0001'] }], chunks: document.chunks }, reportUnderstanding: await new KnowledgeCurationSkill({ model: new ScriptedKnowledgeCurationModel().set('understandReport', understanding()) }).understandReport({ ...scope, themeContext: context }), knowledgeContext: context }); assert.equal(result.entities.length, 1); assert.equal(result.relations.length, 1); assert.equal(result.claims.length, 1); assert.deepEqual(result.entities[0]?.candidateId, 'candidate-batch-0001-entity-0001') })
test('relation endpoint diagnostics are schema-derived and identify the failing candidate', async () => { const { skill } = makeSkill({ entities: [], relations: [supplierRelation('industry', 'company')], claims: [] }, 'extractKnowledge'); let error: KnowledgeCurationError | undefined; await assert.rejects(() => skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), (value: unknown) => { if (value instanceof KnowledgeCurationError) error = value; return value instanceof KnowledgeCurationError && value.code === 'invalid_semantics' }); assert.ok(error); const definition = KNOWLEDGE_SCHEMA_V03.relation.definitions.supplier_of; assert.match(error.message, /RelationCandidate\[1\] supplier_of endpoint types invalid/); assert.match(error.message, /received industry->company/); assert.match(error.message, new RegExp(`allowed source=\\[${definition.sourceTypes.join(',')}\\],target=\\[${definition.targetTypes.join(',')}\\]`)); assert.doesNotMatch(error.message, /Supplier|Customer/); assert.ok(error.message.length < 200) })
test('valid supplier_of relation remains accepted', async () => { const { skill } = makeSkill({ entities: [], relations: [supplierRelation()], claims: [] }, 'extractKnowledge'); const result = await skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }); assert.equal(result.relations[0]?.relationType, 'supplier_of') })
test('business_exposure diagnostics report received and allowed endpoint types', async () => { const invalid = relation(); invalid.sourceMention = { text: 'Company', entityType: 'industry', existingRef: null }; invalid.targetMention = { text: 'Industry', entityType: 'industry', existingRef: null }; const { skill } = makeSkill({ entities: [], relations: [invalid], claims: [] }, 'extractKnowledge'); let error: KnowledgeCurationError | undefined; await assert.rejects(() => skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), (value: unknown) => { if (value instanceof KnowledgeCurationError) error = value; return value instanceof KnowledgeCurationError && value.code === 'invalid_semantics' }); assert.ok(error); const definition = KNOWLEDGE_SCHEMA_V03.relation.definitions.business_exposure; assert.match(error.message, /business_exposure/); assert.match(error.message, /received industry->industry/); assert.match(error.message, new RegExp(`allowed source=\\[${definition.sourceTypes.join(',')}\\],target=\\[${definition.targetTypes.join(',')}\\]`)) })
test('same-type relation diagnostics preserve the frozen constraint', async () => { const { skill } = makeSkill({ entities: [], relations: [substitutesRelation()], claims: [] }, 'extractKnowledge'); let error: KnowledgeCurationError | undefined; await assert.rejects(() => skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), (value: unknown) => { if (value instanceof KnowledgeCurationError) error = value; return value instanceof KnowledgeCurationError && value.code === 'invalid_semantics' }); assert.ok(error); const definition = KNOWLEDGE_SCHEMA_V03.relation.definitions.substitutes_for; assert.match(error.message, /substitutes_for endpoints must share the same Entity type/); assert.match(error.message, /received product->technology/); assert.match(error.message, new RegExp(`allowed source=\\[${definition.sourceTypes.join(',')}\\],target=\\[${definition.targetTypes.join(',')}\\]`)); assert.doesNotMatch(error.message, /Product|Technology/) })
test('candidate IDs are assigned after validation and are deterministic', async () => { const input = { ...scope, batch: { batchId: 'batch-0007', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }; const a = makeSkill({ entities: [entity('A'), entity('B')], relations: [], claims: [] }, 'extractKnowledge'); const b = makeSkill({ entities: [entity('A'), entity('B')], relations: [], claims: [] }, 'extractKnowledge'); const left = await a.skill.extractKnowledge(input); const right = await b.skill.extractKnowledge(input); assert.deepEqual(left.entities.map((item) => item.candidateId), right.entities.map((item) => item.candidateId)); assert.equal(Object.keys(entity()).includes('candidateId'), false) })
test('evidence refs and suggested existing refs must belong to supplied context', async () => { const badChunk = { entities: [{ ...entity(), evidenceChunkRefs: ['chunk-unknown'] }], relations: [], claims: [] }; const a = makeSkill(badChunk, 'extractKnowledge'); await errorCode(() => a.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_reference'); const badRef = { entities: [{ ...entity(), suggestedExistingRef: 'entity:unknown' }], relations: [], claims: [] }; const b = makeSkill(badRef, 'extractKnowledge'); await errorCode(() => b.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_reference') })
test('invalid relation vocabulary, endpoint semantics, and attributes are rejected', async () => { for (const bad of [{ ...relation(), relationType: 'contains' }, { ...relation(), targetMention: { text: 'Company', entityType: 'company', existingRef: null } }, { ...relation(), attributes: { unsupported: true } }]) { const a = makeSkill({ entities: [], relations: [bad], claims: [] }, 'extractKnowledge'); await errorCode(() => a.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_semantics') } })
test('invalid business exposure and claim temporal/value/confidence fail without coercion', async () => { const badRelation = { ...relation(), attributes: { exposureBasis: 'wrong', realizationStage: 'reported', materiality: 'material' } }; const r = makeSkill({ entities: [], relations: [badRelation], claims: [] }, 'extractKnowledge'); await errorCode(() => r.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_semantics'); const badClaim = { ...claim(), temporal: { asOf: 1, scope: { type: 'point', start: null, end: null, label: null } }, semanticConfidence: 2 }; const c = makeSkill({ entities: [], relations: [], claims: [badClaim] }, 'extractKnowledge'); await errorCode(() => c.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_semantics') })
test('valid point and period claim temporal values are preserved', async () => { const temporals = [{ asOf: '2026-08-26T00:00:00.000Z', scope: { type: 'point', start: null, end: null, label: null } }, { asOf: '2026-08-26T00:00:00.000Z', scope: { type: 'period', start: '2026-01-01T00:00:00.000Z', end: '2026-06-30T23:59:59.000Z', label: '2026H1' } }]; for (const temporal of temporals) { const { skill } = makeSkill({ entities: [], relations: [], claims: [{ ...claim(), temporal }] }, 'extractKnowledge'); const result = await skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }); assert.deepEqual(result.claims[0]?.temporal, temporal) } })
test('invalid claim temporal shape and datetime values are rejected without coercion', async () => { const validTemporal = { asOf: '2026-08-26T00:00:00.000Z', scope: { type: 'point', start: null, end: null, label: null } }; const invalidTemporals: Array<[Record<string, unknown>, string]> = [[{ ...validTemporal, asOf: 1 }, 'invalid_semantics'], [{ ...validTemporal, asOf: 'not-a-datetime' }, 'invalid_semantics'], [{ ...validTemporal, scope: { ...validTemporal.scope, start: 'not-a-datetime' } }, 'invalid_semantics'], [{ ...validTemporal, scope: { ...validTemporal.scope, end: 'not-a-datetime' } }, 'invalid_semantics'], [{ ...validTemporal, scope: { ...validTemporal.scope, type: 'instant' } }, 'invalid_semantics'], [{ ...validTemporal, scope: { ...validTemporal.scope, label: 1 } }, 'invalid_semantics'], [{ ...validTemporal, extra: true }, 'invalid_model_output'], [{ ...validTemporal, scope: { ...validTemporal.scope, extra: true } }, 'invalid_model_output']]; for (const [temporal, expectedCode] of invalidTemporals) { const { skill } = makeSkill({ entities: [], relations: [], claims: [{ ...claim(), temporal }] }, 'extractKnowledge'); await errorCode(() => skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), expectedCode) } })
test('model durable candidate IDs and malformed nested output are rejected', async () => { const a = makeSkill({ entities: [{ ...entity(), candidateId: 'candidate:attacker' }], relations: [], claims: [] }, 'extractKnowledge'); await errorCode(() => a.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_reference'); const b = makeSkill({ entities: [{ ...entity(), semanticFields: { nested: undefined } }], relations: [], claims: [] }, 'extractKnowledge'); await errorCode(() => b.skill.extractKnowledge({ ...scope, batch: { batchId: 'batch-0001', sections: [], chunks: document.chunks }, reportUnderstanding: understanding() as never, knowledgeContext: context }), 'invalid_model_output') })

function reconciliationInput(candidateIds = ['candidate-1']) { return { ...scope, groups: [{ groupId: 'group-0001', candidateIds, candidates: candidateIds.map((candidateId) => ({ candidateId, kind: 'entity' as const, semantic: { name: 'New Company' }, existingRefs: ['entity:existing'] })), existingKnowledge: [{ id: 'entity:existing', type: 'company' }] }], sourceAssessment: understanding().sourceAssessment as never } }
test('reconcileKnowledge enforces exact decision/classification vocabulary and coverage', async () => { const valid = { decisions: [{ candidateId: 'candidate-1', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'New semantic object.', requiresUserReview: false }] }; const a = makeSkill(valid, 'reconcileKnowledge'); const result = await a.skill.reconcileKnowledge(reconciliationInput()); assert.equal(result.decisions[0]?.decision, 'create'); for (const key of ['decision', 'classification']) { const bad = { decisions: [{ ...valid.decisions[0], [key]: 'not-frozen' }] }; const b = makeSkill(bad, 'reconcileKnowledge'); await errorCode(() => b.skill.reconcileKnowledge(reconciliationInput()), 'invalid_semantics') } })
test('reconciliation requires each candidate exactly once and rejects unknown refs', async () => { const missing = makeSkill({ decisions: [] }, 'reconcileKnowledge'); await errorCode(() => missing.skill.reconcileKnowledge(reconciliationInput()), 'invalid_reference'); const unknown = makeSkill({ decisions: [{ candidateId: 'candidate-unknown', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'bad', requiresUserReview: false }] }, 'reconcileKnowledge'); await errorCode(() => unknown.skill.reconcileKnowledge(reconciliationInput()), 'invalid_reference'); const outside = makeSkill({ decisions: [{ candidateId: 'candidate-1', decision: 'merge_source', classification: 'complementary', existingRefs: ['entity:outside'], reason: 'bad', requiresUserReview: false }] }, 'reconcileKnowledge'); await errorCode(() => outside.skill.reconcileKnowledge(reconciliationInput()), 'invalid_reference'); const duplicate = makeSkill({ decisions: [{ candidateId: 'candidate-1', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'first', requiresUserReview: false }, { candidateId: 'candidate-1', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'duplicate', requiresUserReview: false }] }, 'reconcileKnowledge'); await errorCode(() => duplicate.skill.reconcileKnowledge(reconciliationInput()), 'invalid_reference'); const duplicateAndMissing = makeSkill({ decisions: [{ candidateId: 'candidate-1', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'duplicate', requiresUserReview: false }, { candidateId: 'candidate-1', decision: 'create', classification: 'complementary', existingRefs: [], reason: 'duplicate again', requiresUserReview: false }] }, 'reconcileKnowledge'); await errorCode(() => duplicateAndMissing.skill.reconcileKnowledge(reconciliationInput(['candidate-1', 'candidate-2'])), 'invalid_reference') })
test('reconciliation accepts exactly one decision per candidate in reversed order', async () => { const decision = (candidateId: string) => ({ candidateId, decision: 'create', classification: 'complementary', existingRefs: [], reason: 'No duplicate.', requiresUserReview: false }); const { skill } = makeSkill({ decisions: [decision('candidate-2'), decision('candidate-1')] }, 'reconcileKnowledge'); const result = await skill.reconcileKnowledge(reconciliationInput(['candidate-1', 'candidate-2'])); assert.deepEqual(result.decisions.map((item) => item.candidateId), ['candidate-2', 'candidate-1']) })
test('analyzeSchemaGaps accepts only governance gap classes and supplied candidates', async () => { const input = { ...scope, candidates: [{ candidateId: 'candidate-1' }], knowledgeContext: context }; const a = makeSkill({ gaps: [{ candidateRefs: ['candidate-1'], gapType: 'schema', observedInformation: { description: 'Missing field.', examples: ['x'] }, currentLimitation: { description: 'No field.' }, suggestedDirection: { description: 'Review schema.' }, affectedKnowledgeTypes: ['entity'], affectedIndustries: ['semiconductor'], generality: 'local', frequency: 'first_seen', recommendedAction: 'review' }] }, 'analyzeSchemaGaps'); const valid = await a.skill.analyzeSchemaGaps(input); assert.equal(valid.gaps[0]?.gapType, 'schema'); const b = makeSkill({ gaps: [{ ...valid.gaps[0]!, gapType: 'new_enum' }] }, 'analyzeSchemaGaps'); await errorCode(() => b.skill.analyzeSchemaGaps(input), 'invalid_semantics') })
test('malformed output performs no hidden retry and reports one model call', async () => { const model = new ScriptedKnowledgeCurationModel().set('understandReport', { sourceAssessment: null }); const curation = new KnowledgeCurationSkill({ model }); await errorCode(() => curation.understandReport({ ...scope, themeContext: context }), 'invalid_model_output'); assert.equal(model.requests.length, 1) })

test('Skill to DSH adapter boundary preserves v0.3 Schema Context and Output Contract', async () => {
  let request: GenerateOptions | undefined
  const llm = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { request = options; yield { type: 'text-delta', index: 0, text: JSON.stringify(understanding()) }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const adapter = new KnowledgeCurationModelAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })
  const curation = new KnowledgeCurationSkill({ model: adapter })
  await curation.understandReport({ ...scope, themeContext: context })
  const prompt = request?.messages[0]?.content[0]?.type === 'text' ? request.messages[0].content[0].text : ''
  assert.equal(request?.reasoningEffort, 'off')
  assert.match(prompt, /Operation: understandReport/)
  assert.match(prompt, /report_understanding/)
  assert.match(prompt, /majorEntityMentions/)
  assert.match(prompt, /"additionalProperties":false/)
  assert.doesNotMatch(prompt, /undefined/)
  assert.equal(JSON.stringify(buildCurationSchemaContext('report_understanding')).includes('majorEntityMentions'), false)
  assert.equal(JSON.stringify(STRUCTURED_OUTPUT_CONTRACTS.understandReport).includes('majorEntityMentions'), true)
})
