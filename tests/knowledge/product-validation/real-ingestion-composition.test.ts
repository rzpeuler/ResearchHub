import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createRealKnowledgeCurationModel } from '../../../tools/knowledge-product-validation/deepseek-composition.ts'
import { loadLocalRuntimeConfig } from '../../../dsh/llm-runtime/local-runtime-config.ts'

test('real curation composition stays provider-neutral at the Skill boundary with an injected fixture runtime', async () => {
  let request: GenerateOptions | undefined
  const llm = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { request = options; yield { type: 'text-delta', index: 0, text: '{"decision":"admit"}' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const config = loadLocalRuntimeConfig({ RESEARCHHUB_REAL_LLM_ENABLED: 'false', RESEARCHHUB_LLM_PROVIDER: 'deepseek-official', RESEARCHHUB_LLM_MODEL: 'fixture-model' }, process.cwd())
  const runtime = await createRealKnowledgeCurationModel(config, llm)
  try {
    const value = await runtime.model.invoke({ operation: 'assess_admission', instruction: 'Return JSON.', input: { candidateId: 'candidate-1' }, expectedOutputContract: 'KnowledgeAdmissionDecision' })
    assert.deepEqual(value, { decision: 'admit' })
    assert.equal(request?.provider, 'deepseek-official')
    assert.equal(request?.model, 'fixture-model')
  } finally { await runtime.close() }
})
