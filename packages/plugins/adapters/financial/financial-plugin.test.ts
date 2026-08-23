import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PluginRegistry } from '../../registry/index.ts'
import { validateFinancialData, buildFinancialData, type NormalizedFinancialRow } from './normalization.ts'
import { AkShareFinancialPlugin } from './akshare-financial-plugin.ts'
import { TushareFinancialPlugin } from './tushare-financial-plugin.ts'
import { createFinancialPluginComposition } from '../../financial/index.ts'
import type { FinancialData, FinancialDataPlugin } from './types.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function statementRows(): Record<string, unknown> {
  return {
    income: [{ ts_code: '600519.SH', end_date: '20251231', ann_date: '20260301', total_revenue: 1000, operate_profit: 300, n_income: 250 }],
    'balance-sheet': [{ symbol: '600519', period: '2025-12-31', total_assets: 5000, total_liab: 2000 }],
    'cash-flow': [{ code: '600519', end_date: '20251231', n_cashflow_act: 400 }],
  }
}

test('Tushare financial plugin maps income, balance sheet, and cash flow fields', async () => {
  const calls: string[] = []
  const plugin = new TushareFinancialPlugin({
    token: 'secret-token',
    clock,
    transport: {
      async request(_input, init) {
        const body = JSON.parse(String(init?.body)) as { api_name: string }
        calls.push(body.api_name)
        const rows = statementRows()
        const row = rows[body.api_name === 'balancesheet' ? 'balance-sheet' : body.api_name === 'cashflow' ? 'cash-flow' : 'income']
        return response({ code: 0, data: { items: row } })
      },
    },
  })

  const result = await plugin.fetch({ symbol: '600519' })
  assert.deepEqual(calls, ['income', 'balancesheet', 'cashflow'])
  assert.equal(result.metadata.plugin, 'tushare-financial')
  assert.equal(result.metadata.source, 'tushare')
  assert.equal(result.data.symbol, '600519')
  assert.deepEqual(result.data.metrics.map(metric => metric.name), [
    'revenue', 'operating_profit', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow',
  ])
  assert.equal(result.data.metrics[0]?.value, 1000)
  assert.doesNotThrow(() => plugin.validate(result.data))
})

test('AkShare financial plugin normalizes the same statement schema without network dependency', async () => {
  const plugin = new AkShareFinancialPlugin({
    endpoint: 'https://akshare-bridge.example.test/financial',
    clock,
    transport: {
      async request() {
        return response({ data: statementRows() })
      },
    },
  })
  const result = await plugin.fetch({ symbol: '600519' })
  assert.equal(result.metadata.plugin, 'akshare-financial')
  assert.equal(result.metadata.source, 'akshare')
  assert.equal(result.data.statements[1]?.statementType, 'balance-sheet')
  assert.equal(result.data.metrics.find(metric => metric.name === 'operating_cash_flow')?.value, 400)
  assert.doesNotThrow(() => plugin.validate(result.data))
})

test('financial plugin composition falls back from the primary plugin', async () => {
  const data = createSampleData()
  const failing: FinancialDataPlugin = {
    name: 'tushare-financial',
    async fetch() { throw new Error('fixture primary failure') },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const fallback: FinancialDataPlugin = {
    name: 'akshare-financial',
    async fetch() { return { data, metadata: { plugin: 'akshare-financial', source: 'akshare', timestamp: clock().toISOString(), quality: 'medium' as const, confidence: 0.8 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const composition = createFinancialPluginComposition({
    environment: {
      FINANCIAL_PLUGIN_MODE: 'fixture',
      FINANCIAL_PRIMARY_PLUGIN: 'tushare-financial',
      FINANCIAL_FALLBACK_PLUGIN: 'akshare-financial',
    },
    adapters: { 'tushare-financial': failing, 'akshare-financial': fallback },
  })
  const result = await composition.registry.get(composition.financial).fetch({ symbol: '600519' })
  assert.equal(result.metadata.plugin, 'akshare-financial')
})

test('financial plugin data remains JSON-safe through PluginRegistry', async () => {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1 },
    plugin: 'fixture', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'low', confidence: 0.4,
  }]
  const plugin: FinancialDataPlugin = {
    name: 'fixture-financial',
    async fetch() { return { data: buildFinancialData(rows), metadata: { plugin: 'fixture-financial', source: 'fixture', timestamp: clock().toISOString(), quality: 'low' as const, confidence: 0.4 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new PluginRegistry()
  const handle = registry.register(plugin)
  const result = await registry.get(handle).fetch({ symbol: '600519' })
  assert.equal(result.data.metrics[0]?.name, 'revenue')
})

function createSampleData(): FinancialData {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1000 },
    plugin: 'fixture', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'medium', confidence: 0.8,
  }]
  return buildFinancialData(rows)
}
