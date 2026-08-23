import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProviderRegistry } from '../../registry/index.ts'
import { validateFinancialData, buildFinancialData, type NormalizedFinancialRow } from './normalization.ts'
import { AkShareFinancialProvider } from './akshare-financial-provider.ts'
import { TushareFinancialProvider } from './tushare-financial-provider.ts'
import { createFinancialProviderComposition } from '../../financial/index.ts'
import type { FinancialData, FinancialProvider } from './types.ts'

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

test('Tushare financial provider maps income, balance sheet, and cash flow fields', async () => {
  const calls: string[] = []
  const provider = new TushareFinancialProvider({
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

  const result = await provider.fetch({ symbol: '600519' })
  assert.deepEqual(calls, ['income', 'balancesheet', 'cashflow'])
  assert.equal(result.metadata.provider, 'tushare-financial')
  assert.equal(result.metadata.source, 'tushare')
  assert.equal(result.data.symbol, '600519')
  assert.deepEqual(result.data.metrics.map(metric => metric.name), [
    'revenue', 'operating_profit', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow',
  ])
  assert.equal(result.data.metrics[0]?.value, 1000)
  assert.doesNotThrow(() => provider.validate(result.data))
})

test('AkShare financial provider normalizes the same statement schema without network dependency', async () => {
  const provider = new AkShareFinancialProvider({
    endpoint: 'https://akshare-bridge.example.test/financial',
    clock,
    transport: {
      async request() {
        return response({ data: statementRows() })
      },
    },
  })
  const result = await provider.fetch({ symbol: '600519' })
  assert.equal(result.metadata.provider, 'akshare-financial')
  assert.equal(result.metadata.source, 'akshare')
  assert.equal(result.data.statements[1]?.statementType, 'balance-sheet')
  assert.equal(result.data.metrics.find(metric => metric.name === 'operating_cash_flow')?.value, 400)
  assert.doesNotThrow(() => provider.validate(result.data))
})

test('financial provider composition falls back from the primary provider', async () => {
  const data = createSampleData()
  const failing: FinancialProvider = {
    name: 'tushare-financial',
    async fetch() { throw new Error('fixture primary failure') },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const fallback: FinancialProvider = {
    name: 'akshare-financial',
    async fetch() { return { data, metadata: { provider: 'akshare-financial', source: 'akshare', timestamp: clock().toISOString(), quality: 'medium' as const, confidence: 0.8 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const composition = createFinancialProviderComposition({
    environment: {
      FINANCIAL_PROVIDER_MODE: 'fixture',
      FINANCIAL_PRIMARY_PROVIDER: 'tushare-financial',
      FINANCIAL_FALLBACK_PROVIDER: 'akshare-financial',
    },
    adapters: { 'tushare-financial': failing, 'akshare-financial': fallback },
  })
  const result = await composition.registry.get(composition.financial).fetch({ symbol: '600519' })
  assert.equal(result.metadata.provider, 'akshare-financial')
})

test('financial provider data remains JSON-safe through ProviderRegistry', async () => {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1 },
    provider: 'fixture', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'low', confidence: 0.4,
  }]
  const provider: FinancialProvider = {
    name: 'fixture-financial',
    async fetch() { return { data: buildFinancialData(rows), metadata: { provider: 'fixture-financial', source: 'fixture', timestamp: clock().toISOString(), quality: 'low' as const, confidence: 0.4 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new ProviderRegistry()
  const handle = registry.register(provider)
  const result = await registry.get(handle).fetch({ symbol: '600519' })
  assert.equal(result.data.metrics[0]?.name, 'revenue')
})

function createSampleData(): FinancialData {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1000 },
    provider: 'fixture', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'medium', confidence: 0.8,
  }]
  return buildFinancialData(rows)
}
