import test from 'node:test'
import assert from 'node:assert/strict'
import type { StructuredDocument } from '../../../plugins/document/contracts.ts'
import { buildCurationSchemaContext } from '../../../skills/knowledge-curation/model/schema-context.ts'
import { buildUnderstandAndPlanOutputContract, buildExtractKnowledgeOutputContract, buildResolveSemanticCaseOutputContract } from '../../../skills/knowledge-curation/model/output-contracts.ts'
import { UNDERSTAND_AND_PLAN_PROMPT } from '../../../skills/knowledge-curation/prompts/understand-and-plan.ts'
import { EXTRACT_KNOWLEDGE_PROMPT } from '../../../skills/knowledge-curation/prompts/extract-knowledge.ts'
import { KnowledgeCurationSkill } from '../../../skills/knowledge-curation/skill.ts'
import { KnowledgeCurationError } from '../../../skills/knowledge-curation/errors.ts'
import { MockReasoningExecutor } from '../../../plugins/reasoning/mock/executor.ts'
import { normalizeCompanyCandidateIdentity } from '../../../skills/knowledge-curation/identity/company-identity.ts'
import { projectExtractKnowledgeModelInput, projectUnderstandAndPlanModelInput } from '../../../skills/knowledge-curation/model/model-input.ts'

const capabilities = { maxContextTokens: 1000, maxOutputTokens: 500, structuredOutputSupport: true, maxConcurrency: 1 }
const document: StructuredDocument = {
  documentId: 'doc-1', parser: { id: 'test' }, metadata: { originalFilename: 'test.txt', mediaType: 'text/plain' }, normalizedText: 'Alpha makes Beta.',
  sections: [{ sectionId: 'section-1', title: 'Overview', level: 1, parentSectionRef: null, blockRefs: ['block-1', 'block-2'], pageStart: null, pageEnd: null }],
  blocks: [
    { blockId: 'block-1', type: 'paragraph', text: 'Alpha makes Beta.', sectionRef: 'section-1', page: null, locator: { page: null }, order: 0 },
    { blockId: 'block-2', type: 'paragraph', text: 'Beta is a product.', sectionRef: 'section-1', page: null, locator: { page: null }, order: 1 },
  ],
  stats: { pageCount: null, sectionCount: 1, blockCount: 2, normalizedCharacters: 18, tableCount: 0, headingCount: 0, listCount: 0, captionCount: 0 }, warnings: [],
}
const refs = [{ kind: 'block', blockId: 'block-1' }] as const
const reportMap = { sourceAssessment: { summary: 'Direct test source' }, researchScope: 'Products', majorTopics: [{ topicId: 'topic-1', label: 'Products', evidenceRefs: refs }], majorEntityMentions: [], majorConclusions: [], sectionSemantics: [{ sectionRef: 'section-1', summary: 'Overview' }], semanticDependencies: [], themeHypotheses: [], uncertainty: [] }
const unit = { proposedUnitId: 'unit-1', topic: 'Products', semanticPurpose: 'Extract product relationships', primaryRefs: refs, contextRefs: [{ kind: 'block', blockId: 'block-2' }] as const }

test('Schema Context exposes only active slices and derives relation constraints', () => {
  const context = buildCurationSchemaContext('knowledge_extraction')
  assert.deepEqual(context.entityTypes, ['investment_theme', 'industry', 'company', 'product', 'technology'])
  const substitute = context.relationContracts.find((item) => item.relationType === 'substitutes_for')
  assert.equal(substitute?.endpointConstraint, 'same_entity_type_on_both_sides')
  assert.deepEqual(context.relationContracts.find((item) => item.relationType === 'theme_exposure')?.attributes, {
    importance: ['core', 'material', 'adjacent'],
    chainPosition: ['upstream', 'midstream', 'downstream', 'infrastructure', 'cross_chain', 'unknown'],
  })
  assert.deepEqual(context.relationContracts.find((item) => item.relationType === 'business_exposure')?.attributes, {
    exposureBasis: ['direct_operation', 'controlled_subsidiary', 'non_controlling_investment', 'joint_venture', 'project_investment', 'strategic_cooperation', 'announced_transaction', 'other', 'unknown'],
    realizationStage: ['announced', 'transaction_pending', 'pre_revenue', 'commercialized', 'reported', 'unknown'],
    materiality: ['core', 'material', 'minor', 'immaterial', 'unknown'],
    financialContribution: { nullable: true, fields: ['period', 'revenueAmount', 'revenueShare', 'profitAmount', 'profitShare', 'currency', 'separatelyReported'] },
  })
  assert.deepEqual(context.relationContracts.find((item) => item.relationType === 'owns_stake_in')?.attributes, {
    ownershipPct: 'number_0_to_1_or_null',
    controlType: ['controlling', 'significant_influence', 'minority', 'unknown'],
  })
  assert.equal(context.relationContracts.find((item) => item.relationType === 'offers_product')?.attributes, undefined)
  assert.throws(() => buildCurationSchemaContext('schema_gap' as never))
})

test('understandAndPlan validates typed document references and projects the full document only there', async () => {
  const response = { reportMap, extractionPlanProposal: { units: [unit], excludedRefs: [] } }
  const executor = new MockReasoningExecutor({ capabilities, responses: { understandAndPlan: response } })
  const skill = new KnowledgeCurationSkill({ executor })
  const result = await skill.understandAndPlan({ document })
  assert.equal(result.extractionPlanProposal.units[0]?.proposedUnitId, 'unit-1')
  assert.equal((executor.calls[0]?.input as { document: StructuredDocument }).document.blocks.length, 2)
  const prepared = executor.calls[0]?.input as { capabilities: typeof capabilities; schemaContext: { slice: string } }
  assert.deepEqual(prepared.capabilities, capabilities)
  assert.equal(prepared.schemaContext.slice, 'understand_and_plan')
})

test('understandAndPlan removes only reconstructible document duplicates and leaves extraction provenance intact', () => {
  const tableMarkdown = '| Metric | Value |\n| --- | --- |\n| Capacity | 10 |'
  const sourceDocument: StructuredDocument = {
    ...structuredClone(document),
    documentId: 'doc-projection',
    metadata: { originalFilename: 'source.pdf', mediaType: 'application/pdf', title: 'Source title', parserMetadata: { publisher: 'publisher' } },
    normalizedText: `Title\n\n${tableMarkdown}\n\nTail`,
    sections: [{ sectionId: 'section-projection', title: 'Title', level: 1, parentSectionRef: null, blockRefs: ['block-title', 'block-table', 'block-tail'], pageStart: 1, pageEnd: 2 }],
    blocks: [
      { blockId: 'block-tail', type: 'paragraph', text: 'Tail', sectionRef: 'section-projection', page: 2, locator: { page: 2, parserItemRef: 'item-tail', sectionPath: ['Title'], sourceOrder: 3, boundingBox: { left: 1, top: 2, right: 3, bottom: 4 } }, order: 2, metadata: { originalIndex: 3 } },
      { blockId: 'block-title', type: 'heading', text: 'Title', sectionRef: 'section-projection', page: 1, locator: { page: 1, parserItemRef: 'item-title', sectionPath: ['Title'], sourceOrder: 1, boundingBox: { left: 5, top: 6, right: 7, bottom: 8 } }, order: 0 },
      { blockId: 'block-table', type: 'table', text: tableMarkdown, sectionRef: 'section-projection', page: 1, locator: { page: 1, parserItemRef: 'item-table', sectionPath: ['Title'], sourceOrder: 2 }, order: 1, structuredContent: { kind: 'table', markdown: tableMarkdown } },
    ],
    stats: { pageCount: 2, sectionCount: 1, blockCount: 3, normalizedCharacters: `Title\n\n${tableMarkdown}\n\nTail`.length, tableCount: 1, headingCount: 1, listCount: 0, captionCount: 0 },
  }
  const originalSnapshot = structuredClone(sourceDocument)
  const projected = projectUnderstandAndPlanModelInput({ document: sourceDocument, capabilities, schemaContext: buildCurationSchemaContext('understand_and_plan') }) as { document: Record<string, unknown> }
  const planningDocument = projected.document as { normalizedText?: string; metadata: unknown; sections: unknown; blocks: Array<Record<string, unknown>>; stats: unknown; warnings: unknown }

  assert.equal('normalizedText' in planningDocument, false)
  assert.deepEqual(planningDocument.metadata, sourceDocument.metadata)
  assert.deepEqual(planningDocument.sections, sourceDocument.sections)
  assert.deepEqual(planningDocument.stats, sourceDocument.stats)
  assert.deepEqual(planningDocument.warnings, sourceDocument.warnings)
  assert.deepEqual(planningDocument.blocks.map(({ blockId, text, type, sectionRef, page, order }) => ({ blockId, text, type, sectionRef, page, order })), sourceDocument.blocks.map(({ blockId, text, type, sectionRef, page, order }) => ({ blockId, text, type, sectionRef, page, order })))
  assert.deepEqual(planningDocument.blocks[0]?.locator, { page: 2, sectionPath: ['Title'], sourceOrder: 3 })
  assert.deepEqual(planningDocument.blocks[0]?.metadata, { originalIndex: 3 })
  assert.equal('structuredContent' in (planningDocument.blocks[2] ?? {}), false)
  assert.ok(Buffer.byteLength(JSON.stringify(planningDocument), 'utf8') < Buffer.byteLength(JSON.stringify(sourceDocument), 'utf8'))

  const extractionInput = projectExtractKnowledgeModelInput({ document: sourceDocument, reportMap, unit: { ...unit, primaryRefs: [{ kind: 'block', blockId: 'block-table' }], contextRefs: [{ kind: 'block', blockId: 'block-title' }] }, schemaContext: buildCurationSchemaContext('knowledge_extraction') }) as { blocks: Array<Record<string, unknown>> }
  assert.deepEqual(extractionInput.blocks, [
    { ...sourceDocument.blocks[1], role: 'context' },
    { ...sourceDocument.blocks[2], role: 'primary' },
  ])
  assert.deepEqual(sourceDocument, originalSnapshot)
})

test('understandAndPlan preserves normalized text and nonduplicate table content when exact reconstruction fails', () => {
  const sourceDocument: StructuredDocument = {
    ...structuredClone(document),
    normalizedText: 'Leading source text',
    blocks: [{ ...document.blocks[0]!, type: 'table', structuredContent: { kind: 'table', markdown: 'different rendering', rows: [['A', 'B']] } }],
  }
  const projected = projectUnderstandAndPlanModelInput({ document: sourceDocument, capabilities, schemaContext: buildCurationSchemaContext('understand_and_plan') }) as { document: { normalizedText?: string; blocks: Array<Record<string, unknown>> } }
  assert.equal(projected.document.normalizedText, sourceDocument.normalizedText)
  assert.deepEqual(projected.document.blocks[0]?.structuredContent, sourceDocument.blocks[0]?.structuredContent)
})

test('understandAndPlan requires exhaustive excludedRefs and accepts an empty list', async () => {
  const missing = { reportMap, extractionPlanProposal: { units: [unit] } }
  const missingExecutor = new MockReasoningExecutor({ capabilities, responses: { understandAndPlan: missing } })
  await assert.rejects(() => new KnowledgeCurationSkill({ executor: missingExecutor }).understandAndPlan({ document }), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_model_output' && error.message.includes('excludedRefs'))
  const validExecutor = new MockReasoningExecutor({ capabilities, responses: { understandAndPlan: { reportMap, extractionPlanProposal: { units: [unit], excludedRefs: [] } } } })
  const valid = await new KnowledgeCurationSkill({ executor: validExecutor }).understandAndPlan({ document })
  assert.deepEqual(valid.extractionPlanProposal.excludedRefs, [])
})

test('understandAndPlan contract and prompt require exhaustive primary/excluded coverage', () => {
  const contract = buildUnderstandAndPlanOutputContract(buildCurationSchemaContext('understand_and_plan'))
  const root = contract.schema.properties as Record<string, { required?: readonly string[] }>
  const plan = root.extractionPlanProposal
  assert.deepEqual(plan.required, ['units', 'excludedRefs'])
  assert.match(UNDERSTAND_AND_PLAN_PROMPT, /EXHAUSTIVE/)
  assert.match(UNDERSTAND_AND_PLAN_PROMPT, /ContextRefs do not satisfy primary coverage/)
  assert.match(UNDERSTAND_AND_PLAN_PROMPT, /excludedRefs even when it is empty/)
})

test('plan repair input preserves the previous output, feedback, and attempt', async () => {
  const response = { reportMap, extractionPlanProposal: { units: [unit], excludedRefs: [] } }
  const executor = new MockReasoningExecutor({ capabilities, responses: { understandAndPlan: response } })
  const previousOutput = structuredClone(response) as never
  const repair = { previousOutput, feedback: { code: 'uncovered_content' as const, message: 'Repair uncovered content', uncoveredRefs: [{ kind: 'block' as const, blockId: 'block-2' }] }, attempt: 2 }
  await new KnowledgeCurationSkill({ executor }).understandAndPlan({ document, planRepair: repair })
  const prepared = executor.calls[0]?.input as { planRepair: typeof repair }
  assert.deepEqual(prepared.planRepair, repair)
})

test('extractKnowledge isolates invalid, ungrounded, and dependent candidates', async () => {
  const response = {
    entities: [
      { candidateId: 'alpha', entityType: 'company', name: 'Alpha', evidenceBlockRefs: ['block-1'], reason: 'named' },
      { candidateId: 'product-beta', entityType: 'product', name: 'Beta', evidenceBlockRefs: ['block-1'], reason: 'named' },
      { candidateId: 'entity:invented', entityType: 'company', name: 'Bad', evidenceBlockRefs: ['block-1'], reason: 'bad' },
      { candidateId: 'context-only', entityType: 'company', name: 'Context', evidenceBlockRefs: ['block-2'], reason: 'not primary' },
    ],
    relations: [
      { candidateId: 'offers', relationType: 'offers_product', source: { candidateRef: 'alpha', mention: 'Alpha' }, target: { candidateRef: 'product-beta', mention: 'Beta' }, evidenceBlockRefs: ['block-1'], reason: 'statement' },
      { candidateId: 'dependent-bad', relationType: 'offers_product', source: { candidateRef: 'entity:invented', mention: 'Bad' }, target: { candidateRef: 'product-beta', mention: 'Beta' }, evidenceBlockRefs: ['block-1'], reason: 'bad' },
    ],
    claims: [{ candidateId: 'claim-1', claimType: 'fact', statement: 'Alpha makes Beta.', subjectRefs: [{ candidateRef: 'alpha', mention: 'Alpha' }], evidenceBlockRefs: ['block-1'], reason: 'direct statement' }],
  }
  const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: response } })
  const result = await new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  assert.deepEqual(result.entities.map((item) => item.candidateId), ['alpha', 'product-beta'])
  assert.deepEqual(result.relations.map((item) => item.candidateId), ['offers'])
  assert.deepEqual(result.claims.map((item) => item.candidateId), ['claim-1'])
  assert.equal(result.rejected.length, 3)
  assert.ok(result.rejected.some((item) => item.code === 'ungrounded_candidate'))
  assert.ok(result.rejected.some((item) => item.code === 'invalid_reference'))
})

test('Claim temporal validation uses Schema 0.3 date-like semantics and preserves semantic labels', async () => {
  const makeResponse = (temporal: unknown, includeTemporal = true) => ({
    entities: [{ candidateId: 'alpha', entityType: 'company', name: 'Alpha', evidenceBlockRefs: ['block-1'], reason: 'named' }],
    relations: [],
    claims: [{ candidateId: 'claim-1', claimType: 'fact', statement: 'Alpha has the stated outlook.', subjectRefs: [{ candidateRef: 'alpha', mention: 'Alpha' }], ...(includeTemporal ? { temporal } : {}), evidenceBlockRefs: ['block-1'], reason: 'direct statement' }],
  })
  const validTemporal = { asOf: '2026-08-05', scope: { type: 'period', start: '2026-01-01', end: '2026-12-31', label: '2026E' } }
  const valid = await new KnowledgeCurationSkill({ executor: new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: makeResponse(validTemporal) } }) }).extractKnowledge({ document, reportMap, unit })
  assert.deepEqual(valid.claims[0]?.temporal, validTemporal)
  assert.equal(valid.rejected.length, 0)
  for (const [field, temporal] of [
    ['asOf', { asOf: '2026E', scope: { type: 'period', start: null, end: null, label: null } }],
    ['scope.start', { asOf: null, scope: { type: 'period', start: '2026E', end: null, label: null } }],
    ['scope.end', { asOf: null, scope: { type: 'period', start: null, end: '未来三年', label: null } }],
    ['scope.start empty', { asOf: null, scope: { type: 'period', start: '', end: null, label: null } }],
    ['scope.type', { asOf: null, scope: { type: 'forecast', start: null, end: null, label: null } }],
    ['incomplete temporal', { asOf: null }],
    ['incomplete scope', { asOf: null, scope: { type: 'period', start: null, end: null } }],
  ] as const) {
    const result = await new KnowledgeCurationSkill({ executor: new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: makeResponse(temporal) } }) }).extractKnowledge({ document, reportMap, unit })
    assert.equal(result.claims.length, 0, `${field} should be rejected`)
    assert.equal(result.rejected[0]?.kind, 'claim')
    assert.equal(result.rejected[0]?.code, 'invalid_semantics', field)
  }
  const nullTemporal = await new KnowledgeCurationSkill({ executor: new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: makeResponse(null) } }) }).extractKnowledge({ document, reportMap, unit })
  assert.equal(nullTemporal.claims[0]?.temporal, null)
  const omittedTemporal = await new KnowledgeCurationSkill({ executor: new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: makeResponse(undefined, false) } }) }).extractKnowledge({ document, reportMap, unit })
  assert.equal('temporal' in (omittedTemporal.claims[0] ?? {}), false)
  assert.match(EXTRACT_KNOWLEDGE_PROMPT, /semantic periods.*scope\.label/i)
  assert.match(EXTRACT_KNOWLEDGE_PROMPT, /publication time.*Claim temporal/i)
})

test('semanticFields recursively reject durable canonical namespace values', async () => {
  const response = { entities: [{ candidateId: 'alpha', entityType: 'company', name: 'Alpha', semanticFields: { nested: { durable: 'entity:already-canonical' } }, evidenceBlockRefs: ['block-1'], reason: 'named' }], relations: [], claims: [] }
  const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: response } })
  const result = await new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  assert.equal(result.entities.length, 0)
  assert.equal(result.rejected[0]?.code, 'invalid_reference')
})

test('skill rejects invalid JSON from a non-native structured-output host without retrying', async () => {
  const executor = new MockReasoningExecutor({ capabilities: { ...capabilities, structuredOutputSupport: false }, responses: { extractKnowledge: 'not json' } })
  await assert.rejects(() => new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit }), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_model_output')
  assert.equal(executor.calls.length, 1)
})

test('resolveSemanticCase validates a bounded EntityBinding outcome', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { resolveSemanticCase: { outcome: 'equivalent_to', targetAlias: 'existing-001', rationale: 'The bounded evidence identifies the same company.' } } })
  const skill = new KnowledgeCurationSkill({ executor })
  const result = await skill.resolveSemanticCase({ resolutionCase: { caseId: 'case-1', caseKind: 'EntityBindingCase', candidateProjection: { name: 'Alpha' }, existingProjections: [{ alias: 'existing-001', projection: { name: 'Alpha Corporation' } }], evidence: [], sourceContext: {}, schemaContextSlice: {}, allowedOutcomes: ['equivalent_to', 'distinct_from_all', 'uncertain'] } })
  assert.equal(result.outcome, 'equivalent_to')
  assert.equal(result.targetAlias, 'existing-001')
})

test('resolveSemanticCase rejects an unsupported mutation vocabulary', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { resolveSemanticCase: { outcome: 'create', rationale: 'not a semantic outcome' } } })
  await assert.rejects(() => new KnowledgeCurationSkill({ executor }).resolveSemanticCase({ resolutionCase: { caseId: 'case-1', caseKind: 'ClaimConflictCase', candidateProjection: {}, existingProjections: [{ alias: 'existing-001', projection: {} }], evidence: [], sourceContext: {}, schemaContextSlice: {}, allowedOutcomes: ['equivalent', 'supersedes', 'coexists', 'contradicts', 'invalid', 'uncertain'] } }), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_semantics')
})

test('resolveSemanticCase rejects durable IDs and writer fields', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { resolveSemanticCase: { outcome: 'distinct_from_all', rationale: 'new', caseId: 'entity:secret' } } })
  await assert.rejects(() => new KnowledgeCurationSkill({ executor }).resolveSemanticCase({ resolutionCase: { caseId: 'case-1', caseKind: 'EntityBindingCase', candidateProjection: {}, existingProjections: [], evidence: [], sourceContext: {}, schemaContextSlice: {}, allowedOutcomes: ['equivalent_to', 'distinct_from_all', 'uncertain'] } }), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_reference')
})

test('resolveSemanticCase rejects embedded durable canonical and RawRef tokens but accepts ordinary words', async () => {
  for (const rationale of ['This appears related to entity:company-test.', 'This mentions claim:test.', 'Evidence came from source:test.', `Evidence came from raw-sha256-${'a'.repeat(64)}.`]) {
    const executor = new MockReasoningExecutor({ capabilities, responses: { resolveSemanticCase: { outcome: 'uncertain', rationale } } })
    await assert.rejects(() => new KnowledgeCurationSkill({ executor }).resolveSemanticCase({ resolutionCase: { caseId: 'case-embedded', caseKind: 'EntityBindingCase', candidateProjection: {}, existingProjections: [], evidence: [], sourceContext: {}, schemaContextSlice: {}, allowedOutcomes: ['equivalent_to', 'distinct_from_all', 'uncertain'] } }), (error: unknown) => error instanceof KnowledgeCurationError && error.code === 'invalid_reference')
  }
  const executor = new MockReasoningExecutor({ capabilities, responses: { resolveSemanticCase: { outcome: 'uncertain', rationale: 'This ordinary entity source claim prose is safe.' } } })
  const result = await new KnowledgeCurationSkill({ executor }).resolveSemanticCase({ resolutionCase: { caseId: 'case-words', caseKind: 'EntityBindingCase', candidateProjection: {}, existingProjections: [], evidence: [], sourceContext: {}, schemaContextSlice: {}, allowedOutcomes: ['equivalent_to', 'distinct_from_all', 'uncertain'] } })
  assert.equal(result.outcome, 'uncertain')
})

test('every operation derives trusted Schema Context internally and ignores caller-shaped overrides', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: { entities: [], relations: [], claims: [] } } })
  const shapedOverride = { slice: 'knowledge_extraction', relationContracts: [{ relationType: 'offers_product', allowedSourceTypes: ['industry'], allowedTargetTypes: ['industry'] }] }
  await new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit, ...({ schemaContext: shapedOverride } as Record<string, unknown>) })
  const request = executor.calls[0]?.input as { schemaContext: { relationContracts: readonly { relationType: string; allowedSourceTypes: readonly string[] }[] } }
  const offers = request.schemaContext.relationContracts.find((item) => item.relationType === 'offers_product')
  assert.deepEqual(offers?.allowedSourceTypes, ['company'])
})

test('relations outside Schema 0.3 and relations with invalid endpoint types remain rejected', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: {
    entities: [
      { candidateId: 'industry', entityType: 'industry', name: 'Industry', evidenceBlockRefs: ['block-1'], reason: 'named' },
      { candidateId: 'product', entityType: 'product', name: 'Product', evidenceBlockRefs: ['block-1'], reason: 'named' },
    ],
    relations: [
      { candidateId: 'not-schema', relationType: 'not_schema', source: { candidateRef: 'industry', mention: 'Industry' }, target: { candidateRef: 'product', mention: 'Product' }, evidenceBlockRefs: ['block-1'], reason: 'invalid' },
      { candidateId: 'wrong-endpoints', relationType: 'offers_product', source: { candidateRef: 'product', mention: 'Product' }, target: { candidateRef: 'product', mention: 'Product' }, evidenceBlockRefs: ['block-1'], reason: 'invalid' },
    ],
    claims: [],
  } } })
  const result = await new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  assert.equal(result.relations.length, 0)
  assert.equal(result.rejected.filter((item) => item.kind === 'relation').length, 2)
  assert.ok(result.rejected.every((item) => item.code === 'invalid_semantics'))
})

test('Relation attribute validation is early, selective, and preserves valid candidates', async () => {
  const relationEntities = [
    { candidateId: 'theme', entityType: 'investment_theme', name: 'Theme', evidenceBlockRefs: ['block-1'], reason: 'named' },
    { candidateId: 'company', entityType: 'company', name: 'Company', evidenceBlockRefs: ['block-1'], reason: 'named' },
    { candidateId: 'other-company', entityType: 'company', name: 'Other Company', evidenceBlockRefs: ['block-1'], reason: 'named' },
    { candidateId: 'industry', entityType: 'industry', name: 'Industry', evidenceBlockRefs: ['block-1'], reason: 'named' },
    { candidateId: 'product', entityType: 'product', name: 'Product', evidenceBlockRefs: ['block-1'], reason: 'named' },
  ]
  const relation = (candidateId: string, relationType: string, source: string, target: string, attributes?: unknown) => ({ candidateId, relationType, source: { candidateRef: source, mention: source }, target: { candidateRef: target, mention: target }, ...(attributes === undefined ? {} : { attributes }), evidenceBlockRefs: ['block-1'], reason: 'supported' })
  const run = async (relations: readonly unknown[]) => {
    const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: { entities: relationEntities, relations, claims: [] } } })
    return new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  }

  const validTheme = await run([relation('theme-relation', 'theme_exposure', 'theme', 'industry', { importance: 'core', chainPosition: 'upstream' })])
  assert.equal(validTheme.relations.length, 1)
  const invalidEnum = await run([relation('bad-enum', 'theme_exposure', 'theme', 'industry', { importance: 'important' })])
  assert.equal(invalidEnum.relations.length, 0)
  assert.equal(invalidEnum.rejected[0]?.code, 'invalid_semantics')
  assert.match(invalidEnum.rejected[0]?.message ?? '', /relations\[0\]\.importance/)
  const undeclared = await run([relation('bad-key', 'offers_product', 'company', 'product', { importance: 'core' })])
  assert.equal(undeclared.relations.length, 0)
  assert.equal(undeclared.rejected[0]?.code, 'invalid_semantics')
  const validOwnership = await run([relation('owns', 'owns_stake_in', 'company', 'other-company', { ownershipPct: 0.5, controlType: 'minority' })])
  assert.equal(validOwnership.relations.length, 1)
  for (const value of [0, 1, null]) {
    const valid = await run([relation(`valid-ownership-${String(value)}`, 'owns_stake_in', 'company', 'other-company', { ownershipPct: value })])
    assert.equal(valid.relations.length, 1)
  }
  const invalidControlType = await run([relation('bad-control', 'owns_stake_in', 'company', 'other-company', { controlType: 'controlled' })])
  assert.equal(invalidControlType.relations.length, 0)
  assert.equal(invalidControlType.rejected[0]?.code, 'invalid_semantics')
  for (const value of [-0.01, 1.01, '0.5']) {
    const invalid = await run([relation(`bad-ownership-${String(value)}`, 'owns_stake_in', 'company', 'other-company', { ownershipPct: value })])
    assert.equal(invalid.relations.length, 0)
    assert.equal(invalid.rejected[0]?.code, 'invalid_semantics')
  }
  const validBusiness = await run([relation('business', 'business_exposure', 'company', 'industry', { exposureBasis: 'direct_operation', realizationStage: 'reported', materiality: 'material', financialContribution: { period: 'FY2025', revenueAmount: 10, revenueShare: 0.2, profitAmount: null, profitShare: 0, currency: 'USD', separatelyReported: true } })])
  assert.equal(validBusiness.relations.length, 1)
  for (const attributes of [{ materiality: 'important' }, { financialContribution: { unknown: true } }, { financialContribution: { revenueShare: 1.1 } }, { financialContribution: { revenueAmount: '10' } }, { financialContribution: { separatelyReported: 'yes' } }]) {
    const invalid = await run([relation('bad-business', 'business_exposure', 'company', 'industry', attributes)])
    assert.equal(invalid.relations.length, 0)
    assert.equal(invalid.rejected[0]?.code, 'invalid_semantics')
  }
})

test('Invalid Relation attributes do not fail the whole extraction response', async () => {
  const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: {
    entities: [
      { candidateId: 'company', entityType: 'company', name: 'Company', evidenceBlockRefs: ['block-1'], reason: 'named' },
      { candidateId: 'product', entityType: 'product', name: 'Product', evidenceBlockRefs: ['block-1'], reason: 'named' },
    ],
    relations: [
      { candidateId: 'valid-relation', relationType: 'offers_product', source: { candidateRef: 'company', mention: 'Company' }, target: { candidateRef: 'product', mention: 'Product' }, evidenceBlockRefs: ['block-1'], reason: 'supported' },
      { candidateId: 'invalid-relation', relationType: 'offers_product', source: { candidateRef: 'company', mention: 'Company' }, target: { candidateRef: 'product', mention: 'Product' }, attributes: { importance: 'core' }, evidenceBlockRefs: ['block-1'], reason: 'invalid attribute' },
    ],
    claims: [{ candidateId: 'claim', claimType: 'fact', statement: 'Company offers Product.', subjectRefs: [{ candidateRef: 'company', mention: 'Company' }], evidenceBlockRefs: ['block-1'], reason: 'supported' }],
  } } })
  const result = await new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  assert.deepEqual(result.relations.map((item) => item.candidateId), ['valid-relation'])
  assert.equal(result.claims.length, 1)
  assert.deepEqual(result.rejected.map((item) => [item.candidateId, item.code]), [['invalid-relation', 'invalid_semantics']])
})

test('structured output contracts fully describe nested objects and Schema 0.3 vocabularies', () => {
  const context = buildCurationSchemaContext('knowledge_extraction')
  const understand = buildUnderstandAndPlanOutputContract(buildCurationSchemaContext('understand_and_plan'))
  const understandRoot = understand.schema.properties as Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean }>
  const plan = understandRoot.extractionPlanProposal.properties as Record<string, { items?: { properties?: Record<string, unknown>; additionalProperties?: boolean } }>
  const unitSchema = plan.units.items!
  assert.equal(unitSchema.additionalProperties, false)
  const refs = unitSchema.properties!.primaryRefs as { items: { oneOf: readonly { additionalProperties?: boolean }[] } }
  assert.equal(refs.items.oneOf.length, 2)
  assert.equal(refs.items.oneOf.every((item) => item.additionalProperties === false), true)
  const extract = buildExtractKnowledgeOutputContract(context)
  const extractRoot = extract.schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: readonly string[]; minimum?: number; maximum?: number }>; } }>
  assert.deepEqual(extractRoot.entities.items?.properties?.entityType.enum, context.entityTypes)
  assert.deepEqual(extractRoot.relations.items?.properties?.relationType.enum, context.relationTypes)
  assert.deepEqual(extractRoot.claims.items?.properties?.claimType.enum, context.claimTypes)
  const entityProperties = extractRoot.entities.items?.properties
  assert.equal(entityProperties?.confidence?.minimum, 0)
  assert.equal(entityProperties?.confidence?.maximum, 1)
  const structuredValue = extractRoot.claims.items?.properties?.structuredValue as { oneOf: readonly [{ properties: Record<string, { oneOf?: readonly { enum?: readonly string[]; type?: string }[] }> }, { type: string }] }
  const comparator = structuredValue.oneOf[0].properties.comparator.oneOf!
  assert.deepEqual(comparator[0]?.enum, context.claimComparators)
  assert.deepEqual(comparator[1], { type: 'null' })
  assert.equal((comparator[0]?.enum as readonly string[] | undefined)?.includes('greater_than'), false)
  const semantic = buildResolveSemanticCaseOutputContract({ caseKind: 'ClaimConflictCase', allowedOutcomes: ['equivalent', 'supersedes', 'coexists', 'contradicts', 'invalid', 'uncertain'], existingAliases: ['existing-001'] })
  const semanticSchema = semantic.schema.properties as Record<string, { enum?: readonly string[]; additionalProperties?: boolean }>
  assert.deepEqual(semanticSchema.outcome.enum, ['equivalent', 'supersedes', 'coexists', 'contradicts', 'invalid', 'uncertain'])
  assert.equal(semanticSchema.caseKind.additionalProperties, undefined)
})

test('Curation Schema Context projects Company identity fields from Schema 0.3', () => {
  const context = buildCurationSchemaContext('knowledge_extraction')
  assert.deepEqual(context.entityContracts.find((item) => item.entityType === 'company')?.semanticFields, ['ticker', 'exchange', 'legalName'])
  assert.equal(context.entityContracts.find((item) => item.entityType === 'product')?.semanticFields, undefined)
})

test('Company identity normalizer parses securities decorations and preserves safe labels', () => {
  const candidate = (name: string, semanticFields?: Record<string, unknown>) => ({ candidateId: name, entityType: 'company' as const, name, ...(semanticFields === undefined ? {} : { semanticFields }), evidenceBlockRefs: ['block-1'], reason: 'test' })
  const sh = normalizeCompanyCandidateIdentity(candidate('上海新阳（300236.SZ）'))
  assert.equal(sh.diagnostics.length, 0)
  assert.equal(sh.candidate.name, '上海新阳')
  assert.deepEqual(sh.candidate.semanticFields, { ticker: '300236', exchange: 'SZ' })
  const half = normalizeCompanyCandidateIdentity(candidate('中巨芯(688549.sh)', { ticker: '688549', exchange: 'SH' }))
  assert.equal(half.diagnostics.length, 0)
  assert.equal(half.candidate.name, '中巨芯')
  assert.deepEqual(half.candidate.semanticFields, { ticker: '688549', exchange: 'SH' })
  assert.deepEqual(normalizeCompanyCandidateIdentity(candidate('达诺尔（833189.NQ）')).candidate.semanticFields, { ticker: '833189', exchange: 'NQ' })
  const sse = normalizeCompanyCandidateIdentity(candidate('Example（600000.SSE）'))
  assert.equal(sse.candidate.name, 'Example')
  assert.deepEqual(sse.candidate.semanticFields, { ticker: '600000', exchange: 'SH' })
  const lowercase = normalizeCompanyCandidateIdentity(candidate('Example 300000.sz'))
  assert.equal(lowercase.candidate.name, 'Example')
  assert.deepEqual(lowercase.candidate.semanticFields, { ticker: '300000', exchange: 'SZ' })
  for (const name of ['某公司（123456.XY）', '某公司（123456.AI）', 'Example(123456.NYSE)', 'Example（2026.SH）']) {
    const result = normalizeCompanyCandidateIdentity(candidate(name))
    assert.equal(result.candidate.name, name)
    assert.equal(result.candidate.semanticFields, undefined)
  }
  const explicitNyse = normalizeCompanyCandidateIdentity(candidate('Acme', { ticker: 'ACM', exchange: 'NYSE' }))
  assert.equal(explicitNyse.diagnostics.length, 0)
  assert.deepEqual(explicitNyse.candidate.semanticFields, { ticker: 'ACM', exchange: 'NYSE' })
  const bilingual = normalizeCompanyCandidateIdentity(candidate('霍尼韦尔（Honeywell）'))
  assert.equal(bilingual.candidate.name, '霍尼韦尔')
  assert.deepEqual(bilingual.candidate.aliases, ['Honeywell'])
  assert.equal(normalizeCompanyCandidateIdentity(candidate('彤程新材（北京科华）')).candidate.name, '彤程新材（北京科华）')
  assert.equal(normalizeCompanyCandidateIdentity(candidate('AXT / 北京通美')).candidate.name, 'AXT / 北京通美')
})

test('Company identity normalizer rejects disagreement and cleans semantic fields', () => {
  const candidate = (name: string, semanticFields: Record<string, unknown>) => ({ candidateId: 'c', entityType: 'company' as const, name, semanticFields, evidenceBlockRefs: ['block-1'], reason: 'test' })
  const disagreement = normalizeCompanyCandidateIdentity(candidate('中巨芯（688549.SH）', { ticker: '300236', exchange: 'SZ' }))
  assert.deepEqual(disagreement.diagnostics.map((item) => item.code), ['invalid_semantics', 'invalid_semantics'])
  const empty = normalizeCompanyCandidateIdentity(candidate('Acme', { ticker: ' ', exchange: '', legalName: ' Acme Corporation ' }))
  assert.deepEqual(empty.candidate.semanticFields, { legalName: 'Acme Corporation' })
  const unsupported = normalizeCompanyCandidateIdentity(candidate('Acme', { ticker: '1', foo: 'bar' }))
  assert.equal(unsupported.diagnostics[0]?.code, 'invalid_semantics')
})

test('Company Candidate validation applies normalization and rejects non-company identity fields', async () => {
  const run = async (entity: unknown) => {
    const executor = new MockReasoningExecutor({ capabilities, responses: { extractKnowledge: { entities: [entity], relations: [], claims: [] } } })
    return new KnowledgeCurationSkill({ executor }).extractKnowledge({ document, reportMap, unit })
  }
  const accepted = await run({ candidateId: 'company', entityType: 'company', name: '中巨芯（688549.SH）', evidenceBlockRefs: ['block-1'], reason: 'named' })
  assert.equal(accepted.entities[0]?.name, '中巨芯')
  assert.deepEqual(accepted.entities[0]?.semanticFields, { ticker: '688549', exchange: 'SH' })
  const nonCompany = await run({ candidateId: 'industry', entityType: 'industry', name: 'Industry', semanticFields: { ticker: '688549' }, evidenceBlockRefs: ['block-1'], reason: 'bad' })
  assert.equal(nonCompany.entities.length, 0)
  assert.equal(nonCompany.rejected[0]?.code, 'invalid_semantics')
  const badType = await run({ candidateId: 'bad-type', entityType: 'company', name: 'Acme', semanticFields: { ticker: 300236 }, evidenceBlockRefs: ['block-1'], reason: 'bad' })
  assert.equal(badType.entities.length, 0)
  assert.equal(badType.rejected[0]?.code, 'invalid_semantics')
})
