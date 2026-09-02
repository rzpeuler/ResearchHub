import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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
import { runEarningsReviewCommand } from '../../packages/skills/earnings-review/index.ts'
import { runEquityResearchCommand } from '../../packages/skills/equity-research/index.ts'
import { runIndustryResearchCommand } from '../../packages/skills/industry-research/index.ts'
import { runValuationCommand } from '../../packages/skills/valuation/index.ts'
import { CompanyResearchWorkflow } from '../../packages/skills/company-research/index.ts'
import { EquityResearchWorkflow } from '../../packages/workflows/equity-research/index.ts'
import type { FinancialMetricName } from '../../packages/plugins/adapters/financial/types.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }
const symbol = process.env.FINANCIAL_TEST_SYMBOL ?? '600519'

test('PLUGIN-VALIDATION-003 runs real AKShare data through Financial Plugin and Equity Research Workflow', {
  skip: process.env.RUN_REAL_AKSHARE_FINANCIAL === '1' && Boolean(process.env.AKSHARE_FINANCIAL_ENDPOINT?.trim())
    ? false
    : 'set RUN_REAL_AKSHARE_FINANCIAL=1 and AKSHARE_FINANCIAL_ENDPOINT to opt in to a real AKShare Bridge call',
}, async () => {
  const endpoint = process.env.AKSHARE_FINANCIAL_ENDPOINT!.trim()
  const composition = createFinancialPluginComposition({
    environment: {
      FINANCIAL_PLUGIN_MODE: 'real',
      FINANCIAL_PRIMARY_PLUGIN: 'akshare-financial',
      AKSHARE_FINANCIAL_ENDPOINT: endpoint,
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
    assert.ok(snapshot.metrics.some(metric => metric.name === name), `AKShare data must include ${name}`)
  }

  const financialEvidence = createFinancialEvidence(snapshot, {
    sessionId: 'real-akshare-financial-validation-session',
    createdAt,
  })
  assert.ok(financialEvidence.length >= requiredMetrics.length)
  assert.ok(financialEvidence.every(item => item.metadata.plugin === 'akshare-financial'))

  const financialSnapshotPort = {
    async get_financial_snapshot(input: { symbol: string }) {
      return financial.get_financial_snapshot(input)
    },
  }
  const financialResearchPort = {
    async get_financial_snapshot(input: { symbol: string }) {
      return financial.get_financial_snapshot(input) as unknown as Record<string, unknown>
    },
  }
  const companyWorkflow = new CompanyResearchWorkflow({
    marketPlugin: { async get_market_snapshot(input) { return { symbol: input.symbol, price: 1400, change: 1, volume: 1000, source: 'fixture-market', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    informationPlugin: { async search_company_news(input) { return { symbol: input.symbol, items: [], source: 'fixture-information', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    financialPlugin: financialSnapshotPort,
    artifactIdFactory: (type, ordinal) => `real-akshare-${type}-${ordinal}`,
  })
  const workflow = new EquityResearchWorkflow({
    skills: {
      companyResearch: input => companyWorkflow.run(input),
      industryResearch: input => runIndustryResearchCommand(input, { research: {
        search_industry: async () => [{ source: 'fixture-industry', title: 'Industry context', content: 'Fixture industry context.', asOf: createdAt, confidence: 0.8 }],
        list_peer_metrics: async () => [{ name: 'Fixture Peer', source: 'fixture-industry', asOf: createdAt, revenueGrowth: 0.1 }],
      } }),
      equityResearch: input => runEquityResearchCommand(input, {
        market: { get_market_snapshot: async () => ({ price: 1400, source: 'fixture-market' }) },
        financial: financialResearchPort,
        information: { search_company_news: async () => ({ items: [], source: 'fixture-information' }) },
      }),
      earningsReview: input => runEarningsReviewCommand(input, { earnings: {
        get_earnings_snapshot: async () => ({ symbol: input.symbol, period: input.period, actual: { revenue: 110, eps: 2 }, consensus: { revenue: 100, eps: 1.9 }, guidance: 'maintained', source: 'fixture-earnings', asOf: createdAt }),
      } }),
      valuation: input => runValuationCommand(input, { peers: {
        list_peer_valuations: async () => [{ symbol: '000001', name: 'Fixture Peer', evRevenue: 3, evEbitda: 12, pe: 20, source: 'fixture-peers', asOf: createdAt }],
      } }),
    },
    artifactIdFactory: (type, ordinal) => `real-akshare-${type}-${ordinal}`,
  })

  const result = await workflow.run({
    symbol,
    companyName: 'Kweichow Moutai',
    industry: 'Beverages',
    geography: 'China',
    question: 'Validate real AKShare financial facts in the Equity Research Workflow.',
    sessionId: 'real-akshare-financial-validation-session',
    createdAt,
    asOf: createdAt,
    earningsPeriod: '2025-Q4',
    evaluationPeriod,
    valuation: {
      forecasts: [{ year: 2027, revenue: 1100, ebitda: 350, freeCashFlow: 220 }],
      assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 0, sharesOutstanding: 1000 },
    },
  })

  assert.equal(result.status, 'success')
  assert.ok(result.stepStates.every(state => state.status === 'completed'))
  assert.ok(result.artifacts.evidence.length >= 5)
  const financialStage = result.stageOutputs['financial-analysis']
  assert.deepEqual(
    withoutVolatileTimestamps(financialStage.evidence.find(item => item.id === 'equity-financial-1')?.details),
    withoutVolatileTimestamps(snapshot),
  )
  assert.deepEqual(financialEvidence.map(item => deserializeEvidence(serializeEvidence(item))), financialEvidence)
  assert.deepEqual(deserializeThesis(serializeThesis(result.artifacts.thesis)), result.artifacts.thesis)
  assert.deepEqual(deserializePrediction(serializePrediction(result.artifacts.prediction)), result.artifacts.prediction)

  const review = evaluatePrediction(result.artifacts.prediction, {
    description: 'Real AKShare Financial Provider validation outcome.',
    timestamp: evaluationPeriod.end,
    source: 'real-akshare-financial-validation',
    metrics: { ...result.artifacts.prediction.metrics },
  }, { idFactory: () => 'real-akshare-financial-review-001', clock: () => '2027-02-25T00:00:00.000Z' })
  assert.equal(review.evaluation.status, 'met')
})

function withoutVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileTimestamps)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'timestamp' && key !== 'retrievedAt')
      .map(([key, nested]) => [key, withoutVolatileTimestamps(nested)]))
  }
  return value
}
