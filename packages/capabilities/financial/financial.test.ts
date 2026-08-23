import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvidence, validateEvidence } from '../../artifacts/index.ts'
import { ProviderRegistry } from '../../providers/index.ts'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../providers/adapters/financial/normalization.ts'
import { FinancialCapability, createFinancialEvidence } from './provider.ts'
import type { FinancialData, FinancialProvider } from '../../providers/adapters/financial/types.ts'

const clock = () => new Date('2026-08-24T00:00:00.000Z')

function sampleData(): FinancialData {
  const rows: NormalizedFinancialRow[] = [
    {
      statementType: 'income', symbol: '600519', period: '2025-12-31', values: { total_revenue: 1000, n_income: 250 },
      provider: 'fixture-financial', source: 'fixture', retrievedAt: clock().toISOString(), quality: 'high', confidence: 0.9,
    },
  ]
  return buildFinancialData(rows)
}

test('FinancialCapability returns normalized financial data and provider metadata', async () => {
  const data = sampleData()
  const provider: FinancialProvider = {
    name: 'fixture-financial',
    async fetch() { return { data, metadata: { provider: 'fixture-financial', source: 'fixture', timestamp: clock().toISOString(), quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new ProviderRegistry()
  const capability = new FinancialCapability(registry, registry.register(provider))
  const result = await capability.get_financial_snapshot({ symbol: ' 600519 ' })
  assert.equal(result.symbol, '600519')
  assert.equal(result.provider, 'fixture-financial')
  assert.equal(result.metrics[0]?.name, 'revenue')
  assert.equal(result.metrics[0]?.source.provider, 'fixture-financial')
})

test('FinancialCapability rejects malformed symbols before provider execution', async () => {
  let called = false
  const provider: FinancialProvider = {
    name: 'fixture-financial',
    async fetch() { called = true; return { data: sampleData(), metadata: { provider: 'fixture', source: 'fixture', timestamp: clock().toISOString(), quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new ProviderRegistry()
  const capability = new FinancialCapability(registry, registry.register(provider))
  await assert.rejects(capability.get_financial_snapshot({ symbol: 'ABC' }), /six-digit/)
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
  assert.match(evidence[0]?.content ?? '', /revenue/)
  evidence.forEach(item => {
    assert.doesNotThrow(() => validateEvidence(item))
    assert.doesNotThrow(() => createEvidence(item))
  })
})
