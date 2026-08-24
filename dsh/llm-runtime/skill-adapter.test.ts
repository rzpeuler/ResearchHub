import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmSkillAdapter } from './skill-adapter.ts'

const response = JSON.stringify({
  skillId: 'equity-research',
  subject: 'Fixture Co (600519)',
  asOf: '2026-08-24T00:00:00.000Z',
  summary: 'The fixture company has a reviewable operating thesis.',
  findings: ['Revenue quality is observable in the supplied context.'],
  keyRisks: ['Evidence may become stale.'],
  openQuestions: ['What changes in the next reporting period?'],
  evidence: [{ id: 'llm-evidence-1', source: 'fixture-context', asOf: '2026-08-24T00:00:00.000Z', claim: 'Fixture evidence', details: { sourceType: 'fixture' }, confidence: 0.8 }],
  data: {},
})

test('LLM Skill Adapter loads the Skill prompt and validates Harness stream output', async () => {
  let request: GenerateOptions | undefined
  const llm = {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      request = options
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: response }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const adapter = new LlmSkillAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })

  const result = await adapter.request('equity-research', { symbol: '600519' }, { prior: 'context' })

  assert.equal(result.skillId, 'equity-research')
  assert.equal(result.evidence[0]?.source, 'fixture-context')
  assert.equal(request?.provider, 'fixture-provider')
  assert.equal(request?.model, 'fixture-model')
  assert.match(request?.messages[0]?.content[0]?.type === 'text' ? request.messages[0].content[0].text : '', /Equity Research Analysis Prompt/)
})

test('LLM Skill Adapter rejects a response from the wrong Skill', async () => {
  const llm = {
    async *stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: response.replace('equity-research', 'industry-research') }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const adapter = new LlmSkillAdapter({ llm, provider: 'fixture-provider', model: 'fixture-model' })
  await assert.rejects(() => adapter.request('equity-research', {}, {}), /response id mismatch/)
})
