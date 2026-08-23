import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FinancialPlugin, createFinancialEvidence } from '../../packages/plugins/financial/index.ts'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../packages/plugins/adapters/financial/normalization.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import type { FinancialData, FinancialDataPlugin } from '../../packages/plugins/adapters/financial/types.ts'

test('financial plugin integration creates session-linked Evidence from fixture Plugin data', async () => {
  const data = buildFinancialData([{
    statementType: 'income',
    symbol: '600519',
    period: '2025-12-31',
    values: { total_revenue: 1000, operate_profit: 300, n_income: 250 },
    plugin: 'fixture-financial',
    source: 'fixture',
    retrievedAt: '2026-08-24T00:00:00.000Z',
    quality: 'high',
    confidence: 0.9,
  } satisfies NormalizedFinancialRow])
  const plugin: FinancialDataPlugin = {
    name: 'fixture-financial',
    async fetch() {
      return {
        data,
        metadata: {
          plugin: 'fixture-financial', source: 'fixture', timestamp: '2026-08-24T00:00:00.000Z', quality: 'high' as const, confidence: 0.9,
        },
      }
    },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
  const registry = new PluginRegistry()
  const handle = registry.register(plugin)
  const operation = new FinancialPlugin(registry, handle)
  const snapshot = await operation.get_financial_snapshot({ symbol: '600519' })
  const artifacts = createFinancialEvidence(snapshot, {
    sessionId: 'session-financial-integration-001',
    createdAt: '2026-08-24T00:01:00.000Z',
  })

  assert.equal(snapshot.plugin, 'fixture-financial')
  assert.equal(snapshot.metrics.length, 3)
  assert.equal(artifacts.length, 3)
  assert.ok(artifacts.every(artifact => artifact.sessionId === 'session-financial-integration-001'))
  assert.ok(artifacts.every(artifact => artifact.metadata.plugin === 'fixture-financial'))
})
