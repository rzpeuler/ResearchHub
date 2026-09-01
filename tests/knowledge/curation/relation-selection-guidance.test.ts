import assert from 'node:assert/strict'
import test from 'node:test'
import { KNOWLEDGE_SCHEMA_V03 } from '../../../packages/schemas/knowledge/v03/executable-schema.ts'
import { KnowledgeCurationSkill, type ExtractKnowledgeInput, type ReportUnderstanding } from '../../../packages/skills/knowledge-curation/index.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../../packages/skills/knowledge-curation/contracts.ts'
import { EXTRACT_KNOWLEDGE_PROMPT } from '../../../packages/skills/knowledge-curation/prompts/extract-knowledge.ts'
import { buildRelationSelectionGuidance, RELATION_SELECTION_GUIDANCE } from '../../../packages/skills/knowledge-curation/prompts/relation-selection-guidance.ts'
import { ScriptedKnowledgeCurationModel } from './scripted-model.ts'

test('relation selection guidance has exact executable-Schema parity and stable order', () => {
  const guidance = buildRelationSelectionGuidance()
  assert.equal(guidance, RELATION_SELECTION_GUIDANCE)
  const entries = guidance.split('\n').filter((line) => line.startsWith('- ') && line.includes(': ') && line.includes('semanticDescription='))
  assert.equal(entries.length, KNOWLEDGE_SCHEMA_V03.relation.types.length)
  assert.equal(new Set(entries.map((entry) => entry.slice(2, entry.indexOf(': ')))).size, entries.length)
  for (const [index, relationType] of KNOWLEDGE_SCHEMA_V03.relation.types.entries()) {
    const definition = KNOWLEDGE_SCHEMA_V03.relation.definitions[relationType]
    const constraint = definition.endpointConstraint ? `; endpointConstraint=${definition.endpointConstraint}` : ''
    assert.equal(entries[index], `- ${relationType}: ${definition.sourceTypes.join('|')} -> ${definition.targetTypes.join('|')}; semanticDescription=${JSON.stringify(definition.semanticDescription)}${constraint}`)
  }
  const upstream = entries.find((entry) => entry.startsWith('- upstream_of:'))
  assert.equal(upstream, `- upstream_of: ${KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.sourceTypes.join('|')} -> ${KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.targetTypes.join('|')}; semanticDescription=${JSON.stringify(KNOWLEDGE_SCHEMA_V03.relation.definitions.upstream_of.semanticDescription)}`)
  assert.doesNotMatch(upstream ?? '', /product\s*->/)
  assert.match(entries.find((entry) => entry.startsWith('- substitutes_for:')) ?? '', new RegExp(`endpointConstraint=${KNOWLEDGE_SCHEMA_V03.relation.definitions.substitutes_for.endpointConstraint}`))
  assert.ok(guidance.length < 4000)
  assert.match(guidance, /endpoint types first/)
  assert.match(guidance, /do not emit a RelationCandidate/)
  assert.match(guidance, /do not force a Relation merely to preserve every relational phrase/)
  assert.match(guidance, /Do not select a Relation type solely because report wording resembles its name/)
  assert.match(guidance, /Never change or coerce an endpoint Entity type/)
})

test('extraction retry preserves identical relation guidance and adds only bounded feedback', async () => {
  const model = new ScriptedKnowledgeCurationModel().set('extractKnowledge', { entities: [], relations: [], claims: [] })
  const skill = new KnowledgeCurationSkill({ model })
  const input = extractionInput()
  await skill.extractKnowledge(input)
  await skill.extractKnowledge(input, { validationFeedback: { attempt: 2, code: 'invalid_semantics', message: 'validator-detail-'.repeat(40) } })
  const first = model.requests[0]?.instruction ?? ''
  const retry = model.requests[1]?.instruction ?? ''
  assert.equal(first, EXTRACT_KNOWLEDGE_PROMPT)
  assert.equal(first.slice(-RELATION_SELECTION_GUIDANCE.length), RELATION_SELECTION_GUIDANCE)
  assert.equal(retry.slice(0, first.length), first)
  assert.equal((retry.match(/Canonical relation compatibility/g) ?? []).length, 1)
  assert.match(retry.slice(first.length), /Validation code: invalid_semantics/)
  assert.equal(retry.slice(first.length).includes('validator-detail-'.repeat(40)), false)
  assert.deepEqual(model.requests[0]?.input, model.requests[1]?.input)
  assert.deepEqual(model.requests[0]?.outputContract, STRUCTURED_OUTPUT_CONTRACTS.extractKnowledge)
})

function extractionInput(): ExtractKnowledgeInput {
  const chunk = { chunkId: 'chunk-0001', text: 'Current batch evidence.', section: 'Summary', page: 1, locator: 'p1' }
  return {
    workflowRunId: 'run-guidance',
    knowledgeBaseId: 'kb-guidance',
    document: { rawRef: `raw-sha256-${'a'.repeat(64)}`, suppliedMetadata: { title: 'Guidance fixture', publisher: null, institution: null, author: null, publishedAt: null, sourceUrl: null }, normalizedText: chunk.text, chunks: [chunk] },
    batch: { batchId: 'batch-0001', sections: [], chunks: [chunk] },
    reportUnderstanding: { sourceAssessment: {}, researchScope: [], majorTopics: [], majorEntityMentions: [], themeHypotheses: [], uncertainty: [] } as unknown as ReportUnderstanding,
    knowledgeContext: { knowledgeBaseId: 'kb-guidance', schemaVersion: '0.3', existingRefs: [], themeGroups: [], themes: [], entities: [] },
  }
}
