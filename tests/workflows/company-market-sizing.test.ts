import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCompanyMarketSizing } from '../../workflows/company-deep-research/market-sizing.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const source: NormalizedResearchSource = { candidate: { candidateId: 'market-1', kind: 'web_article', tier: 2, provider: 'fixture', title: '市场规模' }, title: '市场规模', publisher: 'Association', retrievedAt: '2026-10-14', contentHash: 'fixture', content: '2025年国内该产品市场规模 1000 亿元。', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
const output = { estimates: [{ marketBoundary: '2025年国内该产品市场', asOf: '2025-12-31', formula: 'sum', outputUnit: '亿元', overlapPolicy: 'non_overlapping_segments', operands: [{ name: '已披露市场规模', value: 1000, unit: '亿元', kind: 'fact', evidence: [{ sourceCandidateId: 'market-1', location: 'paragraph:1' }] }] }], gaps: [] }
const executor = (output: unknown): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 10000, maxOutputTokens: 2000, structuredOutputSupport: true, maxConcurrency: 1 }), execute: async (request) => ({ operation: request.operation, output }) })
const base = { company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], reportSourceCandidateIds: ['market-1'] }

test('TAM preparation invokes arithmetic for a sourced disclosed market estimate preserving period and unit', async () => {
  const result = await prepareCompanyMarketSizing({ ...base, reasoningExecutor: executor(output) })
  assert.equal(result.calculations[0]?.value, 1000)
  assert.equal(result.calculations[0]?.unit, '亿元')
  assert.equal(result.calculations[0]?.asOf, '2025-12-31')
  assert.equal(result.attempts, 1)
})

test('TAM preparation rejects invented numbers and keeps the default operation budget at one', async () => {
  const result = await prepareCompanyMarketSizing({ ...base, reasoningExecutor: executor({ ...output, estimates: [{ ...output.estimates[0], operands: [{ ...output.estimates[0]!.operands[0], value: 2000 }] }] }) })
  assert.equal(result.calculations.length, 0)
  assert.equal(result.attempts, 1)
  assert.equal(result.diagnostics[0]?.code, 'TAM_INPUT_REJECTED')
  assert.ok(result.gaps.length)
})

test('TAM preparation preserves absence of adequate market evidence without creating quantities', async () => {
  const result = await prepareCompanyMarketSizing({ ...base, reasoningExecutor: executor({ estimates: [], gaps: ['只有销量，没有市场金额或有来源单价。'] }) })
  assert.deepEqual(result.calculations, [])
  assert.equal(result.gaps[0], '只有销量，没有市场金额或有来源单价。')
})
