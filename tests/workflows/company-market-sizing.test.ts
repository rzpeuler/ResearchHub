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

test('TAM input discovery retains a bounded annual vehicle-volume market size without calling it company TAM', async () => {
  const industrySource: NormalizedResearchSource = { ...source, candidate: { ...source.candidate, candidateId: 'market-volume-1' }, content: '2024年中国新能源汽车全年销量达到1286.6万辆。' }
  const unitEstimate = { estimates: [{ marketBoundary: '2024年中国新能源汽车年度销量规模（单位口径行业规模，不代表比亚迪公司TAM）', asOf: '2024-12-31', formula: 'sum', outputUnit: '万辆/年', overlapPolicy: 'non_overlapping_segments', operands: [{ name: '中国新能源汽车年度销量', value: 1286.6, unit: '万辆/年', kind: 'fact', evidence: [{ sourceCandidateId: 'market-volume-1', location: 'paragraph:1' }] }] }], gaps: ['缺少公司可服务地域、产品边界及可复算金额TAM的行业单价。'] }
  let instruction = ''
  const result = await prepareCompanyMarketSizing({ ...base, sources: [industrySource], reportSourceCandidateIds: ['market-volume-1'], reasoningExecutor: { ...executor(unitEstimate), execute: async (request) => { instruction = request.instruction; return { operation: request.operation, output: unitEstimate } } } })
  assert.equal(result.calculations[0]?.value, 1286.6)
  assert.equal(result.calculations[0]?.unit, '万辆/年')
  assert.match(instruction, /销量\/出货量作为“单位口径行业规模”/)
  assert.match(instruction, /不是公司的TAM/)
  assert.match(instruction, /不得以销量份额乘行业总量，除非来源明确确认/)
  assert.match(result.gaps[0]!, /缺少公司可服务地域/)
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

test('a future-year market forecast published before the research cutoff is retained as forecast background', async () => {
  const forecastSource: NormalizedResearchSource = { ...source, candidate: { ...source.candidate, candidateId: 'forecast-1', publishedAt: '2026-04-21T16:00:00Z' }, title: '2025年年度报告', content: 'Prismark预测2026年全球PCB市场规模为958亿美元。' }
  const estimate = { ...output.estimates[0], marketBoundary: '全球PCB市场', asOf: '2026-12-31', forecastTargetPeriod: '2026全年', outputUnit: '亿美元', operands: [{ name: '2026年全球PCB市场规模预测', value: 958, unit: '亿美元', kind: 'fact', evidence: [{ sourceCandidateId: 'forecast-1', location: 'paragraph:1' }] }] }
  const result = await prepareCompanyMarketSizing({ ...base, sources: [forecastSource], reportSourceCandidateIds: ['forecast-1'], asOf: '2026-10-15', reasoningExecutor: executor({ estimates: [estimate], gaps: [] }) })
  assert.equal(result.calculations[0]?.value, 958, JSON.stringify(result))
  assert.equal(result.calculations[0]?.forecastTargetPeriod, '2026全年')
  assert.equal(result.calculations[0]?.asOf, '2026-12-31')
})

test('forecast sourcing fails closed for post-cutoff or unknown publication dates', async () => {
  const publishedLate: NormalizedResearchSource = { ...source, candidate: { ...source.candidate, candidateId: 'forecast-1', publishedAt: '2026-11-01T00:00:00Z' }, content: '预测2026年全球PCB市场规模为958亿美元。' }
  const publicationUnknown: NormalizedResearchSource = { ...source, candidate: { ...source.candidate, candidateId: 'forecast-1', publishedAt: undefined }, content: '预测2026年全球PCB市场规模为958亿美元。' }
  const estimate = { ...output.estimates[0], marketBoundary: '全球PCB市场', asOf: '2026-12-31', forecastTargetPeriod: '2026全年', outputUnit: '亿美元', operands: [{ name: '2026年全球PCB市场规模预测', value: 958, unit: '亿美元', kind: 'fact', evidence: [{ sourceCandidateId: 'forecast-1', location: 'paragraph:1' }] }] }
  for (const candidate of [publishedLate, publicationUnknown]) {
    const result = await prepareCompanyMarketSizing({ ...base, sources: [candidate], reportSourceCandidateIds: ['forecast-1'], asOf: '2026-10-15', reasoningExecutor: executor({ estimates: [estimate], gaps: [] }) })
    assert.deepEqual(result.calculations, [])
    assert.match(result.diagnostics[0]?.message ?? '', /publication date is unknown or after research cutoff/)
  }
})

test('forecast labels require source wording and matching target year; unlabeled future values remain rejected', async () => {
  const forecastSource: NormalizedResearchSource = { ...source, candidate: { ...source.candidate, candidateId: 'forecast-1', publishedAt: '2026-04-21T16:00:00Z' }, content: '2026年全球PCB市场规模为958亿美元。' }
  const baseEstimate = { ...output.estimates[0], marketBoundary: '全球PCB市场', asOf: '2026-12-31', forecastTargetPeriod: '2026全年', outputUnit: '亿美元', operands: [{ name: '2026年全球PCB市场规模', value: 958, unit: '亿美元', kind: 'fact', evidence: [{ sourceCandidateId: 'forecast-1', location: 'paragraph:1' }] }] }
  const noForecastWording = await prepareCompanyMarketSizing({ ...base, sources: [forecastSource], reportSourceCandidateIds: ['forecast-1'], asOf: '2026-10-15', reasoningExecutor: executor({ estimates: [baseEstimate], gaps: [] }) })
  assert.match(noForecastWording.diagnostics[0]?.message ?? '', /requires the target period and forecast wording/)
  const mismatchedTarget = await prepareCompanyMarketSizing({ ...base, sources: [forecastSource], reportSourceCandidateIds: ['forecast-1'], asOf: '2026-10-15', reasoningExecutor: executor({ estimates: [{ ...baseEstimate, forecastTargetPeriod: '2027全年' }], gaps: [] }) })
  assert.match(mismatchedTarget.diagnostics[0]?.message ?? '', /does not match the estimate period/)
  const unlabeled = await prepareCompanyMarketSizing({ ...base, sources: [forecastSource], reportSourceCandidateIds: ['forecast-1'], asOf: '2026-10-15', reasoningExecutor: executor({ estimates: [{ ...baseEstimate, forecastTargetPeriod: undefined }], gaps: [] }) })
  assert.match(unlabeled.diagnostics[0]?.message ?? '', /requires an explicit forecast label/)
})
