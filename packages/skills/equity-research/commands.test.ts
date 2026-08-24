import assert from 'node:assert/strict'
import test from 'node:test'
import { runEquityResearchCommand } from './index.ts'

const asOf = '2026-08-24T00:00:00.000Z'

test('equity research runs through injected Plugin ports and returns linked sections', async () => {
  const result = await runEquityResearchCommand({ symbol: '600519', companyName: 'Fixture Co', asOf }, {
    market: { get_market_snapshot: async () => ({ price: 100, source: 'fixture-market' }) },
    financial: { get_financial_snapshot: async () => ({ revenue: 1000, margin: 0.2, source: 'fixture-financial' }) },
    information: { search_company_news: async () => ({ items: [], source: 'fixture-information' }) },
  })
  assert.equal(result.skillId, 'equity-research')
  assert.equal(result.sections.length, 6)
  assert.deepEqual(result.thesis.evidenceIds, ['equity-market-1', 'equity-financial-1', 'equity-information-1'])
})

test('equity research rejects malformed symbols', async () => {
  await assert.rejects(() => runEquityResearchCommand({ symbol: 'ABC', companyName: 'Fixture Co', asOf }, {} as never), /six-digit symbol/)
})
