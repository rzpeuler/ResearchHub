import assert from 'node:assert/strict'
import test from 'node:test'
import { runValuationCommand } from './index.ts'

const asOf = '2026-08-24T00:00:00.000Z'
const input = {
  symbol: '600519',
  companyName: 'Fixture Co',
  asOf,
  forecasts: [
    { year: 2027, revenue: 1000, ebitda: 250, freeCashFlow: 120 },
    { year: 2028, revenue: 1100, ebitda: 280, freeCashFlow: 140 },
  ],
  assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 },
}

test('valuation combines peer statistics with DCF sensitivity analysis', async () => {
  const result = await runValuationCommand(input, {
    peers: { list_peer_valuations: async () => [
      { symbol: '000001', name: 'Peer A', evRevenue: 3, evEbitda: 12, pe: 20, source: 'fixture-peers', asOf },
      { symbol: '000002', name: 'Peer B', evRevenue: 5, evEbitda: 16, pe: 24, source: 'fixture-peers', asOf },
    ] },
  })
  assert.equal(result.skillId, 'valuation')
  assert.equal(result.statistics.find((item) => item.metric === 'evEbitda')?.median, 14)
  assert.equal(result.dcf.sensitivity.length, 9)
  assert.ok(result.dcf.impliedSharePrice > 0)
})

test('valuation rejects a terminal growth rate above WACC', async () => {
  await assert.rejects(() => runValuationCommand({ ...input, assumptions: { ...input.assumptions, terminalGrowth: 0.2 } }, { peers: { list_peer_valuations: async () => [] } }), /assumptions are invalid/)
})
