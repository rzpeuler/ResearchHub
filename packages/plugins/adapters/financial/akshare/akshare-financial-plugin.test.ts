import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AkShareFinancialPlugin } from './akshare-financial-plugin.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

test('AKShare Financial Provider normalizes required metrics from row-based Bridge data', async () => {
  const plugin = new AkShareFinancialPlugin({
    endpoint: 'https://akshare-bridge.example.test/financial',
    clock,
    transport: {
      async request() {
        return response({ data: {
          statements: [
            { statementType: 'income', symbol: '600519', period: '2025-12-31', report_date: '2026-03-01', total_revenue: 1000, n_income: 250, gross_margin: 40, netprofit_margin: 25, eps: 2.5, current_ratio: 1.8, quick_ratio: 1.4, debt_to_assets: 30 },
            { statementType: 'balance-sheet', symbol: '600519', period: '2025-12-31', total_assets: 5000, total_liab: 2000 },
            { statementType: 'cash-flow', symbol: '600519', period: '2025-12-31', n_cashflow_act: 400 },
          ],
        } })
      },
    },
  })

  const result = await plugin.fetch({ symbol: '600519' })
  assert.equal(result.metadata.plugin, 'akshare-financial')
  assert.equal(result.metadata.source, 'akshare')
  assert.deepEqual(result.data.metrics.map(metric => metric.name), [
    'revenue', 'net_profit', 'gross_margin', 'net_profit_margin', 'eps', 'current_ratio', 'quick_ratio', 'debt_to_assets',
    'total_assets', 'total_liabilities', 'operating_cash_flow',
  ])
  assert.equal(result.data.metrics.find(metric => metric.name === 'eps')?.unit, 'CNY/share')
  assert.equal(result.data.metrics.find(metric => metric.name === 'current_ratio')?.unit, 'ratio')
  assert.doesNotThrow(() => plugin.validate(result.data))
})

test('AKShare Financial Provider rejects a Bridge response with the wrong symbol', async () => {
  const plugin = new AkShareFinancialPlugin({
    endpoint: 'https://akshare-bridge.example.test/financial',
    clock,
    transport: {
      async request() {
        return response({ data: { statements: [{ statementType: 'income', symbol: '000001', period: '2025-12-31', total_revenue: 1000 }] } })
      },
    },
  })

  await assert.rejects(() => plugin.fetch({ symbol: '600519' }), /response symbol does not match/)
})
