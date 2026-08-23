import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CompanyResearchWorkflow } from './index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('CompanyResearchWorkflow calls injected Capabilities and creates linked Artifacts', async () => {
  const calls = { market: 0, information: 0, financial: 0 }
  const workflow = new CompanyResearchWorkflow({
    marketCapability: {
      async get_market_snapshot(input) {
        calls.market += 1
        return {
          symbol: input.symbol,
          price: 100,
          change: 1,
          volume: 1000,
          source: 'fixture-market',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.9,
        }
      },
    },
    informationCapability: {
      async search_company_news(input) {
        calls.information += 1
        return {
          symbol: input.symbol,
          items: [{
            symbol: input.symbol,
            headline: 'Company operating update',
            content: 'Fixture information evidence.',
            source: 'fixture-information',
            timestamp: createdAt,
            confidence: 0.8,
          }],
          source: 'fixture-information',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.8,
        }
      },
    },
    financialCapability: {
      async get_financial_snapshot(input) {
        calls.financial += 1
        return {
          symbol: input.symbol,
          statements: [],
          metrics: [{
            name: 'net_profit',
            value: 100,
            unit: 'CNY',
            period: { start: '2025-01-01', end: '2025-12-31', periodType: 'annual' as const },
            calculationBasis: 'reported',
            confidence: 0.9,
            sourceStatementIds: ['statement-1'],
            source: {
              provider: 'fixture-financial',
              source: 'fixture-financial',
              publishedAt: createdAt,
              retrievedAt: createdAt,
              quality: 'high' as const,
              confidence: 0.9,
              sourceStatementIds: ['statement-1'],
            },
          }],
          provider: 'fixture-financial',
          source: 'fixture-financial',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.9,
        }
      },
    },
    artifactIdFactory: (type, ordinal) => `company-${type}-${ordinal}`,
  })

  const result = await workflow.run({ symbol: '600519', sessionId: 'company-session-001', createdAt, evaluationPeriod })

  assert.deepEqual(calls, { market: 1, information: 1, financial: 1 })
  assert.equal(result.status, 'success')
  assert.equal(result.artifacts.evidence.length, 3)
  assert.equal(result.artifacts.thesis.evidenceIds.length, 3)
  assert.equal(result.artifacts.prediction.thesisId, result.artifacts.thesis.id)
  assert.equal(result.artifacts.prediction.metrics.validation_metric, 'company_research_evidence_review')
  assert.deepEqual(result.artifacts.prediction.evaluationPeriod, evaluationPeriod)
  assert.ok(result.artifacts.evidence.every((item) => item.sessionId === 'company-session-001'))
  assert.deepEqual(result.artifacts.thesis.metadata.modules, [
    'business-understanding',
    'industry-position',
    'competitive-advantage',
    'growth-drivers',
    'financial-quality',
    'capital-allocation',
    'risk-analysis',
  ])
})

test('CompanyResearchWorkflow rejects invalid symbols and evaluation periods', async () => {
  const workflow = new CompanyResearchWorkflow({
    marketCapability: { async get_market_snapshot() { throw new Error('not called') } },
    informationCapability: { async search_company_news() { throw new Error('not called') } },
    financialCapability: { async get_financial_snapshot() { throw new Error('not called') } },
    artifactIdFactory: (type, ordinal) => `${type}-${ordinal}`,
  })

  await assert.rejects(() => workflow.run({ symbol: 'bad', sessionId: 'session', createdAt, evaluationPeriod }), /six-digit/)
  await assert.rejects(() => workflow.run({
    symbol: '600519', sessionId: 'session', createdAt,
    evaluationPeriod: { start: '2027-01-01T00:00:00.000Z', end: createdAt },
  }), /must not be after/)
})
