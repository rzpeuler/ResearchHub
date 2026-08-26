import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { KnowledgeCurationModelAdapter } from './knowledge-curation-model-adapter.ts'

test('Knowledge Curation DSH adapter maps a model stream to JSON', async () => {
  let request: GenerateOptions | undefined
  const llm = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { request = options; yield { type: 'text-delta', index: 0, text: '{"decision":"admit"}' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const adapter = new KnowledgeCurationModelAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })
  const result = await adapter.invoke({ operation: 'assess_admission', instruction: 'Return an admission decision.', input: { candidateId: 'candidate-1' }, expectedOutputContract: 'KnowledgeAdmissionDecision' })
  assert.deepEqual(result, { decision: 'admit' })
  assert.equal(request?.provider, 'fixture-provider')
  assert.match(request?.messages[0]?.content[0]?.type === 'text' ? request.messages[0].content[0].text : '', /assess_admission/)
})

test('Knowledge Curation DSH adapter rejects malformed output', async () => {
  const llm = { async *stream(): AsyncIterable<StreamChunk> { yield { type: 'text-delta', index: 0, text: 'not-json' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const adapter = new KnowledgeCurationModelAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })
  await assert.rejects(() => adapter.invoke({ operation: 'assess_source', instruction: 'Return JSON.', input: {}, expectedOutputContract: 'SourceAssessment' }), /invalid JSON/)
})
