import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvidence, validateEvidence } from '../../artifacts/index.ts'
import { PluginRegistry } from '../../plugins/index.ts'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../plugins/adapters/financial/normalization.ts'
import { FinancialPlugin, createFinancialEvidence } from './plugin.ts'
import type { FinancialData, FinancialDataPlugin } from '../../plugins/adapters/financial/types.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function sampleData(): FinancialData {
  const rows: NormalizedFinancialRow[] = [
    {
      statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1000, n_income: 250 },
      plugin: 'fixture-financial', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'high', confidence: 0.9,
    },
  ]
  return buildFinancialData(rows)
}

test('FinancialPlugin returns normalized financial data and plugin metadata', async () => {
  const data = sampleData()
  const plugin: FinancialDataPlugin = {
    name: 'fixture-financial',
    async fetch() { return { data, metadata: { plugin: 'fixture-financial', source: 'fixture', timestamp: clock().toISOString(), quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new PluginRegistry()
  const operation = new FinancialPlugin(registry, registry.register(plugin))
  const result = await operation.get_financial_snapshot({ symbol: ' 600519 ' })
  assert.equal(result.symbol, '600519')
  assert.equal(result.plugin, 'fixture-financial')
  assert.equal(result.metrics[0]?.name, 'revenue')
  assert.equal(result.metrics[0]?.source.plugin, 'fixture-financial')
})

test('FinancialPlugin rejects malformed symbols before plugin execution', async () => {
  let called = false
  const plugin: FinancialDataPlugin = {
    name: 'fixture-financial',
    async fetch() { called = true; return { data: sampleData(), metadata: { plugin: 'fixture', source: 'fixture', timestamp: clock().toISOString(), quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new PluginRegistry()
  const operation = new FinancialPlugin(registry, registry.register(plugin))
  await assert.rejects(operation.get_financial_snapshot({ symbol: 'ABC' }), /six-digit/)
  assert.equal(called, false)
})

test('financial data is converted into serializable Evidence artifacts', () => {
  const evidence = createFinancialEvidence(sampleData(), {
    sessionId: 'session-financial-001',
    createdAt: clock().toISOString(),
    idFactory: (_kind, index) => `evidence-${index + 1}`,
  })
  assert.equal(evidence.length, 2)
  assert.equal(evidence[0]?.sessionId, 'session-financial-001')
  assert.equal(evidence[0]?.source, 'fixture')
  assert.equal(evidence[0]?.timestamp, clock().toISOString())
  assert.match(evidence[0]?.content ?? '', /revenue/)
  evidence.forEach(item => {
    assert.doesNotThrow(() => validateEvidence(item))
    assert.doesNotThrow(() => createEvidence(item))
  })
})
