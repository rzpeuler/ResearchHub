import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createPrediction,
  createThesis,
  deserializeEvidence,
  deserializePrediction,
  deserializeThesis,
  serializeEvidence,
  serializePrediction,
  serializeThesis,
} from '../../packages/artifacts/index.ts'
import { evaluatePrediction } from '../../packages/artifacts/index.ts'
import { FinancialPlugin, createFinancialEvidence } from '../../packages/plugins/financial/index.ts'
import { createFinancialPluginComposition } from '../../packages/plugins/financial/composition-index.ts'
import { runEquityResearchCommand } from '../../packages/skills/equity-research/index.ts'
import { runValuationCommand } from '../../packages/skills/valuation/index.ts'
import type { FinancialMetricName } from '../../packages/plugins/adapters/financial/types.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }
const symbol = process.env.FINANCIAL_TEST_SYMBOL ?? '600519'

test('PLUGIN-VALIDATION-002 runs real Tushare financial facts through Equity Research, Valuation, and Evaluation', {
  skip: process.env.RUN_REAL_FINANCIAL_PLUGIN === '1' && Boolean(process.env.TUSHARE_TOKEN?.trim())
    ? false
    : 'set RUN_REAL_FINANCIAL_PLUGIN=1 and TUSHARE_TOKEN to opt in to a real Tushare network call',
}, async () => {
  const token = process.env.TUSHARE_TOKEN!.trim()
  const composition = createFinancialPluginComposition({
    environment: {
      FINANCIAL_PLUGIN_MODE: 'real',
      FINANCIAL_PRIMARY_PLUGIN: 'tushare-financial',
      TUSHARE_TOKEN: token,
      TUSHARE_FINANCIAL_ENDPOINT: process.env.TUSHARE_FINANCIAL_ENDPOINT,
    },
  })
  const financial = new FinancialPlugin(composition.registry, composition.financial)
  const snapshot = await financial.get_financial_snapshot({ symbol })

  const requiredMetrics: FinancialMetricName[] = [
    'revenue',
    'net_profit',
    'gross_margin',
    'net_profit_margin',
    'eps',
    'current_ratio',
    'quick_ratio',
    'debt_to_assets',
  ]
  for (const name of requiredMetrics) {
    assert.ok(snapshot.metrics.some(metric => metric.name === name), `Tushare data must include ${name}`)
  }

  const financialEvidence = createFinancialEvidence(snapshot, {
    sessionId: 'real-financial-plugin-validation-session',
    createdAt,
  })
  assert.ok(financialEvidence.length >= requiredMetrics.length)
  assert.ok(financialEvidence.every(item => item.metadata.plugin === 'tushare-financial'))

  const equity = await runEquityResearchCommand({
    symbol,
    companyName: 'Kweichow Moutai',
    asOf: createdAt,
    researchQuestion: 'Validate that real financial facts reach the Equity Research Skill.',
  }, {
    market: { get_market_snapshot: async () => ({ symbol, price: 1400, source: 'fixture-market', timestamp: createdAt }) },
    financial: { get_financial_snapshot: async input => financial.get_financial_snapshot(input) as unknown as Record<string, unknown> },
    information: { search_company_news: async () => ({ items: [], source: 'fixture-information', timestamp: createdAt }) },
  })
  assert.equal(equity.skillId, 'equity-research')
  assert.deepEqual(equity.evidence.find(item => item.id === 'equity-financial-1')?.details, snapshot)

  const valuation = await runValuationCommand({
    symbol,
    companyName: 'Kweichow Moutai',
    asOf: createdAt,
    forecasts: [
      { year: 2027, revenue: metricValue(snapshot, 'revenue') * 1.1, ebitda: metricValue(snapshot, 'revenue') * 0.35, freeCashFlow: metricValue(snapshot, 'revenue') * 0.2 },
      { year: 2028, revenue: metricValue(snapshot, 'revenue') * 1.2, ebitda: metricValue(snapshot, 'revenue') * 0.38, freeCashFlow: metricValue(snapshot, 'revenue') * 0.22 },
    ],
    assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 0, sharesOutstanding: 1000 },
  }, {
    peers: { list_peer_valuations: async () => [
      { symbol: '000001', name: 'Fixture Peer', evRevenue: 3, evEbitda: 12, pe: 20, source: 'fixture-peers', asOf: createdAt },
    ] },
  })
  assert.equal(valuation.skillId, 'valuation')
  assert.equal(valuation.evidence.length, 2)
  assert.ok(Number.isFinite(valuation.dcf.impliedSharePrice))

  const thesis = createThesis({
    id: 'real-financial-thesis-001',
    createdAt,
    sessionId: 'real-financial-plugin-validation-session',
    metadata: { source: 'real-financial-plugin-validation' },
    statement: 'Real financial facts were normalized and consumed by independent research Skills.',
    evidenceIds: financialEvidence.map(item => item.id),
    confidence: 0.9,
    risks: ['Provider freshness and data permissions require ongoing review.'],
  })
  const prediction = createPrediction({
    id: 'real-financial-prediction-001',
    createdAt,
    sessionId: thesis.sessionId,
    metadata: { source: 'real-financial-plugin-validation' },
    thesisId: thesis.id,
    expectation: 'The normalized EPS and margin facts remain traceable to the Tushare source.',
    evaluationPeriod,
    metrics: {
      eps: metricValue(snapshot, 'eps'),
      gross_margin: metricValue(snapshot, 'gross_margin'),
    },
  })

  assert.deepEqual(financialEvidence.map(item => deserializeEvidence(serializeEvidence(item))), financialEvidence)
  assert.deepEqual(deserializeThesis(serializeThesis(thesis)), thesis)
  assert.deepEqual(deserializePrediction(serializePrediction(prediction)), prediction)

  const review = evaluatePrediction(prediction, {
    description: 'Real Financial Plugin validation outcome.',
    timestamp: evaluationPeriod.end,
    source: 'real-financial-plugin-validation',
    metrics: { ...prediction.metrics },
  }, { idFactory: () => 'real-financial-review-001', clock: () => '2027-02-25T00:00:00.000Z' })
  assert.equal(review.evaluation.status, 'met')
})

function metricValue(snapshot: { metrics: Array<{ name: FinancialMetricName; value: number }> }, name: FinancialMetricName): number {
  const metric = snapshot.metrics.find(item => item.name === name)
  assert.ok(metric, `missing normalized metric ${name}`)
  return metric.value
}
