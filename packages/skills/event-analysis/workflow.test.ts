import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarketSnapshot } from '../../plugins/market/index.ts'
import type { NewsSearchResult } from '../../plugins/news/index.ts'
import { createEventAnalysisToolDefinition } from './harness-tool.ts'
import type { EventAnalysisInput, EventAnalysisResult } from './types.ts'
import { EventAnalysisWorkflow } from './workflow.ts'

const createdAt = '2026-08-23T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2026-09-23T00:00:00.000Z' }

function makeWorkflow(calls: { market: string[]; news: string[] }): EventAnalysisWorkflow {
  const marketSnapshot: MarketSnapshot = {
    symbol: '600519',
    price: 1500,
    change: 0,
    volume: 1000,
    source: 'mock',
    timestamp: createdAt,
    quality: 'high',
    confidence: 0.95,
  }
  const newsResult: NewsSearchResult = {
    symbol: '600519',
    items: [{
      symbol: '600519',
      headline: 'Company update',
      content: 'A deterministic test news item.',
      source: 'mock-news',
      timestamp: createdAt,
      confidence: 0.7,
    }],
    source: 'mock-news',
    timestamp: createdAt,
    quality: 'high',
    confidence: 0.7,
  }

  return new EventAnalysisWorkflow({
    marketPlugin: {
      async get_market_snapshot(input) {
        calls.market.push(input.symbol)
        return marketSnapshot
      },
    },
    newsPlugin: {
      async search_company_news(input) {
        calls.news.push(input.symbol)
        return newsResult
      },
    },
    artifactIdFactory: (type, ordinal) => `${type}-${ordinal}`,
  })
}

function input(sessionId = 'session-event-001'): EventAnalysisInput {
  return { symbol: ' 600519 ', sessionId, createdAt, evaluationPeriod }
}

test('EventAnalysisWorkflow calls both plugins and creates linked artifacts', async () => {
  const calls = { market: [] as string[], news: [] as string[] }
  const result = await makeWorkflow(calls).run(input())

  assert.deepEqual(calls, { market: ['600519'], news: ['600519'] })
  assert.equal(result.status, 'success')
  assert.equal(result.artifacts.evidence.length, 2)
  assert.deepEqual(result.artifacts.evidence.map((item) => item.id), ['evidence-0', 'evidence-1'])
  assert.equal(result.artifacts.evidence[0]?.source, 'market-plugin')
  assert.equal(result.artifacts.evidence[1]?.source, 'mock-news')
  assert.deepEqual(result.artifacts.thesis.evidenceIds, ['evidence-0', 'evidence-1'])
  assert.equal(result.artifacts.prediction.thesisId, 'thesis-0')
  assert.equal(result.artifacts.prediction.metrics.validation_metric, 'evidence_review')
})

test('EventAnalysisWorkflow shares sessionId and remains deterministic for injected IDs', async () => {
  const first = await makeWorkflow({ market: [], news: [] }).run(input('session-fixed'))
  const second = await makeWorkflow({ market: [], news: [] }).run(input('session-fixed'))
  const artifacts = [
    ...first.artifacts.evidence,
    first.artifacts.thesis,
    first.artifacts.prediction,
  ]

  assert.deepEqual(first, second)
  assert.ok(artifacts.every((artifact) => artifact.sessionId === 'session-fixed'))
})

test('run_event_analysis derives sessionId from exec.agent.id and uses the injected clock', async () => {
  const workflow = makeWorkflow({ market: [], news: [] })
  const tool = createEventAnalysisToolDefinition(workflow, () => createdAt)
  const exec = { agent: { id: 'agent-session-001' } } as never

  assert.equal(tool.name, 'run_event_analysis')
  const result = await tool.execute({ symbol: '600519', evaluationPeriod }, exec) as EventAnalysisResult

  assert.equal(result.artifacts.evidence[0]?.sessionId, 'agent-session-001')
  assert.equal(result.artifacts.thesis.createdAt, createdAt)
  assert.equal(result.artifacts.prediction.createdAt, createdAt)
})
