import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../packages/plugins/adapters/financial/normalization.ts'
import { FinancialPlugin } from '../../packages/plugins/financial/index.ts'
import { MarketPlugin } from '../../packages/plugins/market/index.ts'
import { NewsPlugin } from '../../packages/plugins/news/index.ts'
import type { NewsPluginData } from '../../packages/plugins/news/index.ts'
import { EventAnalysisWorkflow } from '../../packages/skills/event-analysis/index.ts'
import { EventAnalysisWorkflowExecutor } from '../../packages/workflows/event-analysis.ts'
import { eventAnalysisWorkflowDefinition } from '../../packages/workflows/definitions.ts'
import { WorkflowRegistry } from '../../packages/workflows/registry.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import type { FinancialData, FinancialDataPlugin } from '../../packages/plugins/adapters/financial/types.ts'
import { ResearchManager, ResearchManagerValidationError } from './index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'

function newsPlugin(name: string, source: string, headline: string): { name: string; fetch: (request: { symbol: string }) => Promise<{ data: NewsPluginData; metadata: { plugin: string; source: string; timestamp: string; quality: 'high'; confidence: number } }>; validate(value: unknown): asserts value is NewsPluginData } {
  return {
    name,
    async fetch(request: { symbol: string }) {
      return {
        data: { symbol: request.symbol, items: [{ symbol: request.symbol, headline, content: `${headline} content`, source, timestamp: createdAt, confidence: 0.9 }] },
        metadata: { plugin: name, source, timestamp: createdAt, quality: 'high' as const, confidence: 0.9 },
      }
    },
    validate(value: unknown): asserts value is NewsPluginData {
      if (value === null || typeof value !== 'object') throw new Error('invalid fixture')
    },
  }
}

function financialPlugin(): FinancialDataPlugin {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31',
    values: { total_revenue: 1000, operate_profit: 300, n_income: 250 },
    plugin: 'fixture-financial', source: 'fixture-financial', retrievedAt: createdAt, quality: 'high', confidence: 0.9,
  }]
  const data = buildFinancialData(rows)
  return {
    name: 'fixture-financial',
    async fetch() { return { data, metadata: { plugin: 'fixture-financial', source: 'fixture-financial', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
}

test('ResearchManager selects event-analysis and returns a Report View over generated Artifacts', async () => {
  const plugins = new PluginRegistry()
  const market = plugins.register({
    name: 'fixture-market',
    async fetch(request: { symbol: string }) { return { data: { symbol: request.symbol, price: 100, change: 1, volume: 10, source: 'fixture-market' }, metadata: { plugin: 'fixture-market', source: 'fixture-market', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    validate() {},
  })
  const announcement = plugins.register(newsPlugin('announcement-plugin', 'official-fixture', 'Official announcement'))
  const media = plugins.register(newsPlugin('media-plugin', 'media-fixture', 'Professional media'))
  const financial = plugins.register(financialPlugin())
  const eventWorkflow = new EventAnalysisWorkflow({
    marketPlugin: new MarketPlugin(plugins, market),
    newsPlugin: new NewsPlugin(plugins, announcement),
    announcementPlugin: new NewsPlugin(plugins, announcement),
    mediaPlugin: new NewsPlugin(plugins, media),
    financialPlugin: new FinancialPlugin(plugins, financial),
    artifactIdFactory: (type, ordinal) => `workflow-${type}-${ordinal}`,
  })
  const registry = new WorkflowRegistry()
  registry.register(eventAnalysisWorkflowDefinition)
  const manager = new ResearchManager(registry, new Map([
    ['event-analysis', new EventAnalysisWorkflowExecutor(eventWorkflow)],
  ]))

  const result = await manager.execute({
    workflowId: 'event-analysis',
    symbol: '600519',
    question: 'What evidence explains the current event?',
    sessionId: 'workflow-session-001',
    createdAt,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.artifacts.evidence.length, 6)
  assert.equal(result.report.workflowId, 'event-analysis')
  assert.equal(result.report.question, 'What evidence explains the current event?')
  assert.deepEqual(result.report.evidenceIds, result.artifacts.evidence.map(item => item.id))
  assert.deepEqual(result.report.thesisIds, [result.artifacts.thesis.id])
  assert.deepEqual(result.report.predictionIds, [result.artifacts.prediction.id])
  assert.ok(result.artifacts.evidence.every(item => item.sessionId === 'workflow-session-001'))
  assert.deepEqual(result.artifacts.prediction.evaluationPeriod, {
    start: createdAt,
    end: '2026-09-23T00:00:00.000Z',
  })
})

test('ResearchManager rejects requests without a registered workflow executor', async () => {
  const registry = new WorkflowRegistry()
  registry.register(eventAnalysisWorkflowDefinition)
  const manager = new ResearchManager(registry, new Map())
  await assert.rejects(manager.execute({
    workflowId: 'event-analysis', symbol: '600519', question: 'question', sessionId: 'session', createdAt,
    evaluationPeriod: { start: createdAt, end: '2026-09-24T00:00:00.000Z' },
  }), ResearchManagerValidationError)
})
