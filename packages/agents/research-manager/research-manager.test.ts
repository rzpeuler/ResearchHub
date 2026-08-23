import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../providers/adapters/financial/normalization.ts'
import { FinancialCapability } from '../../capabilities/financial/index.ts'
import { MarketCapability } from '../../capabilities/market/index.ts'
import { NewsCapability } from '../../capabilities/news/index.ts'
import type { NewsProviderData } from '../../capabilities/news/index.ts'
import { EventAnalysisWorkflow } from '../../skills/event-analysis/index.ts'
import { EventAnalysisWorkflowExecutor } from '../../workflows/event-analysis.ts'
import { eventAnalysisWorkflowDefinition } from '../../workflows/definitions.ts'
import { WorkflowRegistry } from '../../workflows/registry.ts'
import { ProviderRegistry } from '../../providers/registry/index.ts'
import type { FinancialData, FinancialProvider } from '../../providers/adapters/financial/types.ts'
import { ResearchManager, ResearchManagerValidationError } from './index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'

function newsProvider(name: string, source: string, headline: string): { name: string; fetch: (request: { symbol: string }) => Promise<{ data: NewsProviderData; metadata: { provider: string; source: string; timestamp: string; quality: 'high'; confidence: number } }>; validate(value: unknown): asserts value is NewsProviderData } {
  return {
    name,
    async fetch(request: { symbol: string }) {
      return {
        data: { symbol: request.symbol, items: [{ symbol: request.symbol, headline, content: `${headline} content`, source, timestamp: createdAt, confidence: 0.9 }] },
        metadata: { provider: name, source, timestamp: createdAt, quality: 'high' as const, confidence: 0.9 },
      }
    },
    validate(value: unknown): asserts value is NewsProviderData {
      if (value === null || typeof value !== 'object') throw new Error('invalid fixture')
    },
  }
}

function financialProvider(): FinancialProvider {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31',
    values: { total_revenue: 1000, operate_profit: 300, n_income: 250 },
    provider: 'fixture-financial', source: 'fixture-financial', retrievedAt: createdAt, quality: 'high', confidence: 0.9,
  }]
  const data = buildFinancialData(rows)
  return {
    name: 'fixture-financial',
    async fetch() { return { data, metadata: { provider: 'fixture-financial', source: 'fixture-financial', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
}

test('ResearchManager selects event-analysis and returns a Report View over generated Artifacts', async () => {
  const providers = new ProviderRegistry()
  const market = providers.register({
    name: 'fixture-market',
    async fetch(request: { symbol: string }) { return { data: { symbol: request.symbol, price: 100, change: 1, volume: 10, source: 'fixture-market' }, metadata: { provider: 'fixture-market', source: 'fixture-market', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    validate() {},
  })
  const announcement = providers.register(newsProvider('announcement-provider', 'official-fixture', 'Official announcement'))
  const media = providers.register(newsProvider('media-provider', 'media-fixture', 'Professional media'))
  const financial = providers.register(financialProvider())
  const eventWorkflow = new EventAnalysisWorkflow({
    marketCapability: new MarketCapability(providers, market),
    newsCapability: new NewsCapability(providers, announcement),
    announcementCapability: new NewsCapability(providers, announcement),
    mediaCapability: new NewsCapability(providers, media),
    financialCapability: new FinancialCapability(providers, financial),
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
