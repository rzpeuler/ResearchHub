import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deserializeEvidence, deserializePrediction, deserializeThesis, serializeEvidence, serializePrediction, serializeThesis } from '../../packages/artifacts/index.ts'
import { evaluatePrediction } from '../../packages/evaluation/index.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import { GdeltNewsPlugin } from '../../packages/plugins/adapters/gdelt/index.ts'
import { NewsPlugin } from '../../packages/plugins/news/index.ts'
import { CompanyResearchWorkflow } from '../../packages/skills/company-research/index.ts'
import { CompanyResearchWorkflowExecutor, companyResearchWorkflowDefinition, WorkflowRegistry } from '../../packages/workflows/index.ts'
import { ResearchManager } from '../../dsh/research-manager/index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('PLUGIN-VALIDATION-001 runs real GDELT News through Company Research and Evaluation', {
  skip: process.env.RUN_REAL_NEWS_PLUGIN === '1' ? false : 'set RUN_REAL_NEWS_PLUGIN=1 to opt in to a real GDELT network call',
}, async () => {
  const registry = new PluginRegistry()
  const newsHandle = registry.register(new GdeltNewsPlugin({
    timespan: '3m',
    limit: 5,
    endpoint: process.env.GDELT_ENDPOINT,
  }))
  const news = new NewsPlugin(registry, newsHandle)
  const workflow = new CompanyResearchWorkflow({
    marketPlugin: {
      async get_market_snapshot(input) {
        return { symbol: input.symbol, price: 100, change: 1, volume: 1000, source: 'fixture-market', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 }
      },
    },
    informationPlugin: news,
    financialPlugin: {
      async get_financial_snapshot(input) {
        return { symbol: input.symbol, statements: [], metrics: [], plugin: 'fixture-financial', source: 'fixture-financial', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 }
      },
    },
    artifactIdFactory: (type, ordinal) => `real-news-${type}-${ordinal}`,
  })
  const workflows = new WorkflowRegistry()
  workflows.register(companyResearchWorkflowDefinition)
  const manager = new ResearchManager(workflows, new Map([
    ['company-research', new CompanyResearchWorkflowExecutor(workflow)],
  ]))

  const result = await manager.execute({
    workflowId: 'company-research',
    symbol: '600519',
    question: 'Collect recent external news evidence for the company research review.',
    sessionId: 'real-news-plugin-validation-session',
    createdAt,
    evaluationPeriod,
  })

  assert.equal(result.status, 'completed')
  assert.ok(result.artifacts.evidence.length >= 3, 'external news must contribute Evidence alongside Market and Financial Evidence')
  assert.ok(result.artifacts.evidence.some((item) => item.source !== 'fixture-market' && item.source !== 'fixture-financial'))
  assert.deepEqual(result.artifacts.evidence.map((item) => deserializeEvidence(serializeEvidence(item))), result.artifacts.evidence)
  assert.deepEqual(deserializeThesis(serializeThesis(result.artifacts.thesis)), result.artifacts.thesis)
  assert.deepEqual(deserializePrediction(serializePrediction(result.artifacts.prediction)), result.artifacts.prediction)

  const review = evaluatePrediction(result.artifacts.prediction, {
    description: 'Real News Plugin validation outcome.',
    timestamp: evaluationPeriod.end,
    source: 'real-news-plugin-validation',
    metrics: { ...result.artifacts.prediction.metrics },
  }, { idFactory: () => 'real-news-review-001', clock: () => '2027-02-25T00:00:00.000Z' })
  assert.equal(review.evaluation.status, 'met')
})
