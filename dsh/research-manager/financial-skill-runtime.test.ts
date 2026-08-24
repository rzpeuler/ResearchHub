import assert from 'node:assert/strict'
import test from 'node:test'
import { runEarningsReviewCommand } from '../../packages/skills/earnings-review/index.ts'
import { runEquityResearchCommand } from '../../packages/skills/equity-research/index.ts'
import { runIndustryResearchCommand } from '../../packages/skills/industry-research/index.ts'
import { runValuationCommand } from '../../packages/skills/valuation/index.ts'

const asOf = '2026-08-24T00:00:00.000Z'

test('DSH runtime can invoke runtime-neutral financial research skills', async () => {
  const equity = await runEquityResearchCommand({ symbol: '600519', companyName: 'Fixture Co', asOf }, {
    market: { get_market_snapshot: async () => ({ price: 100 }) },
    financial: { get_financial_snapshot: async () => ({ revenue: 1000, margin: 0.25 }) },
    information: { search_company_news: async () => ({ headline: 'Fixture update' }) },
  })
  const industry = await runIndustryResearchCommand({ industry: 'Beverages', geography: 'China', asOf }, {
    research: {
      search_industry: async () => [{ source: 'fixture', title: 'Industry note', content: 'Market context', asOf, confidence: 0.9 }],
      list_peer_metrics: async () => [{ name: 'Peer A', source: 'fixture', asOf }],
    },
  })
  const earnings = await runEarningsReviewCommand({ symbol: '600519', companyName: 'Fixture Co', period: '2026-Q2', asOf }, {
    earnings: { get_earnings_snapshot: async () => ({ symbol: '600519', period: '2026-Q2', actual: { revenue: 110 }, consensus: { revenue: 100 }, guidance: 'maintained', source: 'fixture', asOf }) },
  })
  const valuation = await runValuationCommand({
    symbol: '600519', companyName: 'Fixture Co', asOf,
    forecasts: [{ year: 2027, revenue: 1000, ebitda: 250, freeCashFlow: 120 }],
    assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 },
  }, { peers: { list_peer_valuations: async () => [{ symbol: '000001', name: 'Peer A', evRevenue: 3, evEbitda: 12, pe: 20, source: 'fixture', asOf }] } })

  assert.equal(equity.skillId, 'equity-research')
  assert.equal(industry.skillId, 'industry-research')
  assert.equal(earnings.thesisImpact, 'positive')
  assert.equal(valuation.skillId, 'valuation')
})
