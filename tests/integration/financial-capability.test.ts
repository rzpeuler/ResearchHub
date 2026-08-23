import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FinancialCapability, createFinancialEvidence } from '../../packages/capabilities/financial/index.ts'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../packages/providers/adapters/financial/normalization.ts'
import { ProviderRegistry } from '../../packages/providers/registry/index.ts'
import type { FinancialData, FinancialProvider } from '../../packages/providers/adapters/financial/types.ts'

test('financial capability integration creates session-linked Evidence from fixture Provider data', async () => {
  const data = buildFinancialData([{
    statementType: 'income',
    symbol: '600519',
    period: '2025-12-31',
    values: { total_revenue: 1000, operate_profit: 300, n_income: 250 },
    provider: 'fixture-financial',
    source: 'fixture',
    retrievedAt: '2026-08-24T00:00:00.000Z',
    quality: 'high',
    confidence: 0.9,
  } satisfies NormalizedFinancialRow])
  const provider: FinancialProvider = {
    name: 'fixture-financial',
    async fetch() {
      return {
        data,
        metadata: {
          provider: 'fixture-financial', source: 'fixture', timestamp: '2026-08-24T00:00:00.000Z', quality: 'high' as const, confidence: 0.9,
        },
      }
    },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new ProviderRegistry()
  const handle = registry.register(provider)
  const capability = new FinancialCapability(registry, handle)
  const snapshot = await capability.get_financial_snapshot({ symbol: '600519' })
  const artifacts = createFinancialEvidence(snapshot, {
    sessionId: 'session-financial-integration-001',
    createdAt: '2026-08-24T00:01:00.000Z',
  })

  assert.equal(snapshot.provider, 'fixture-financial')
  assert.equal(snapshot.metrics.length, 3)
  assert.equal(artifacts.length, 3)
  assert.ok(artifacts.every(artifact => artifact.sessionId === 'session-financial-integration-001'))
  assert.ok(artifacts.every(artifact => artifact.metadata.provider === 'fixture-financial'))
})
