import assert from 'node:assert/strict'
import test from 'node:test'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../../packages/skills/knowledge-curation/index.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../../packages/skills/knowledge-curation/contracts.ts'
import { buildCurationSchemaContext } from '../../../packages/skills/knowledge-curation/schema-context.ts'
import { KNOWLEDGE_SCHEMA_V03 } from '../../../packages/schemas/knowledge/v03/executable-schema.ts'
import { ExpectedSmokeStop, FlashExtractionSmokeModel, SmokeObservingRuntime } from '../../../tools/knowledge-product-validation/run-flash-extraction-smoke.ts'

test('Flash extraction smoke harness stops before the third distinct batch', async () => {
  let delegatedCalls = 0
  const delegate: KnowledgeCurationModel = {
    async invoke(request) {
      delegatedCalls += 1
      return request.operation === 'understandReport'
        ? { majorEntityMentions: [], themeHypotheses: [] }
        : { entities: [], relations: [], claims: [] }
    },
  }
  const runtime = new SmokeObservingRuntime({ async *stream() {} })
  const model = new FlashExtractionSmokeModel(delegate, runtime)

  await model.invoke(request('understandReport'))
  await model.invoke(request('extractKnowledge', 'batch-0001'))
  await model.invoke(request('extractKnowledge', 'batch-0002'))
  await assert.rejects(() => model.invoke(request('extractKnowledge', 'batch-0003')), ExpectedSmokeStop)

  assert.equal(delegatedCalls, 3)
  assert.equal(model.physicalRealModelInvocations, 3)
  assert.deepEqual(model.distinctExtractionBatchIds, ['batch-0001', 'batch-0002', 'batch-0003'])
  assert.equal(model.calls.at(-1)?.delegatedToRealModel, false)

  const observations = model.calls.filter((call) => call.operation === 'extractKnowledge' && call.physicalAttempt === 1).map((call) => call.contractObservation)
  assert.equal(observations[0]?.relationsItemsOneOf, true)
  assert.equal(observations[0]?.branchCount, KNOWLEDGE_SCHEMA_V03.relation.types.length)
  assert.equal(observations[0]?.component_of?.costSharePresent, false)
})

function request(operation: 'understandReport' | 'extractKnowledge', batchId?: string): KnowledgeCurationModelRequest {
  const isUnderstand = operation === 'understandReport'
  return {
    operation,
    instruction: `Operation: ${operation}`,
    input: isUnderstand
      ? { normalizedText: 'fixture', chunks: [] }
      : { batch: { batchId, chunks: [{ chunkId: `${batchId}-chunk`, text: 'fixture' }] }, reportUnderstanding: {}, knowledgeContext: {} },
    schemaContext: buildCurationSchemaContext(isUnderstand ? 'report_understanding' : 'knowledge_extraction'),
    outputContract: isUnderstand ? STRUCTURED_OUTPUT_CONTRACTS.understandReport : STRUCTURED_OUTPUT_CONTRACTS.extractKnowledge,
  }
}
