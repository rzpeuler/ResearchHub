import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { STRUCTURED_OUTPUT_CONTRACTS } from '../../packages/skills/knowledge-curation/contracts.ts'
import { buildCurationSchemaContext } from '../../packages/skills/knowledge-curation/schema-context.ts'
import type { ActiveCurationOperation } from '../../packages/skills/knowledge-curation/types.ts'
import { KnowledgeCurationModelAdapter } from './knowledge-curation-model-adapter.ts'

function requestFor(operation: ActiveCurationOperation) {
  return { operation, instruction: 'Return the requested JSON.', input: { fixture: true }, schemaContext: buildCurationSchemaContext(sliceFor(operation)), outputContract: STRUCTURED_OUTPUT_CONTRACTS[operation] }
}

function sliceFor(operation: ActiveCurationOperation): 'report_understanding' | 'knowledge_extraction' | 'reconciliation' | 'schema_gap' {
  return ({ understandReport: 'report_understanding', extractKnowledge: 'knowledge_extraction', reconcileKnowledge: 'reconciliation', analyzeSchemaGaps: 'schema_gap' } as const)[operation]
}

function fixtureLlm(output = '{"ok":true}') {
  let request: GenerateOptions | undefined
  const llm = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { request = options; yield { type: 'text-delta', index: 0, text: output }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  return { llm, getRequest: () => request }
}

function promptOf(request: GenerateOptions | undefined): string { return request?.messages[0]?.content[0]?.type === 'text' ? request.messages[0].content[0].text : '' }

test('understandReport propagates the v0.3 Schema Context and Output Contract', async () => {
  const fixture = fixtureLlm()
  const adapter = new KnowledgeCurationModelAdapter({ llm: fixture.llm, provider: 'fixture-provider', model: 'fixture-model' })
  const result = await adapter.invoke(requestFor('understandReport'))
  const prompt = promptOf(fixture.getRequest())
  assert.deepEqual(result, { ok: true })
  assert.match(prompt, /Operation: understandReport/)
  assert.match(prompt, /Schema Context:/)
  assert.match(prompt, /report_understanding/)
  assert.match(prompt, /Output Contract:/)
  assert.match(prompt, /majorEntityMentions/)
  assert.match(prompt, /"additionalProperties":false/)
  const retiredContractLabel = ['expected', 'OutputContract'].join('')
  assert.doesNotMatch(prompt, new RegExp(retiredContractLabel))
  assert.doesNotMatch(prompt, /undefined/)
})

test('all four active operations propagate their mapped slice and contract', async () => {
  for (const operation of ['understandReport', 'extractKnowledge', 'reconcileKnowledge', 'analyzeSchemaGaps'] as const) {
    const fixture = fixtureLlm()
    const adapter = new KnowledgeCurationModelAdapter({ llm: fixture.llm, provider: 'fixture-provider', model: 'fixture-model' })
    await adapter.invoke(requestFor(operation))
    const prompt = promptOf(fixture.getRequest())
    assert.match(prompt, new RegExp(`Operation: ${operation}`))
    assert.match(prompt, new RegExp(sliceFor(operation)))
    assert.match(prompt, /Output Contract:/)
    assert.doesNotMatch(prompt, /undefined/)
  }
})

test('missing Schema Context or Output Contract fails before model invocation', async () => {
  let calls = 0
  const llm = { async *stream(): AsyncIterable<StreamChunk> { calls += 1; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const adapter = new KnowledgeCurationModelAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })
  await assert.rejects(() => adapter.invoke({ ...requestFor('understandReport'), schemaContext: undefined } as never), /requires schemaContext/)
  await assert.rejects(() => adapter.invoke({ ...requestFor('understandReport'), outputContract: undefined } as never), /requires outputContract/)
  assert.equal(calls, 0)
})

test('malformed JSON remains rejected at the transport boundary', async () => {
  const fixture = fixtureLlm('not-json')
  const adapter = new KnowledgeCurationModelAdapter({ llm: fixture.llm, provider: 'fixture-provider', model: 'fixture-model' })
  await assert.rejects(() => adapter.invoke(requestFor('understandReport')), /invalid JSON/)
})
