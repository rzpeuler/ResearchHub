import assert from 'node:assert/strict'
import test from 'node:test'
import { runEarningsReviewCommand } from './index.ts'

const asOf = '2026-08-24T00:00:00.000Z'

test('earnings review calculates beat/miss and thesis impact from an injected Plugin', async () => {
  const result = await runEarningsReviewCommand({ symbol: '600519', companyName: 'Fixture Co', period: 'Q2 2026', asOf }, {
    earnings: { get_earnings_snapshot: async () => ({ symbol: '600519', period: 'Q2 2026', actual: { revenue: 110, eps: 2 }, consensus: { revenue: 100, eps: 1.9 }, guidance: 'raised', source: 'fixture-earnings', asOf }) },
  })
  assert.equal(result.variances.find((item) => item.metric === 'revenue')?.status, 'beat')
  assert.equal(result.thesisImpact, 'positive')
  assert.equal(result.guidance, 'raised')
})

test('earnings review rejects a mismatched Plugin snapshot', async () => {
  await assert.rejects(() => runEarningsReviewCommand({ symbol: '600519', companyName: 'Fixture Co', period: 'Q2 2026', asOf }, {
    earnings: { get_earnings_snapshot: async () => ({ symbol: '000001', period: 'Q2 2026', actual: {}, guidance: 'not-provided', source: 'fixture', asOf }) },
  }), /does not match/)
})
