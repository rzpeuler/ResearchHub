import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluatePrediction } from '../../packages/evaluation/index.ts'
import { CompanyResearchWorkflow } from '../../packages/skills/company-research/index.ts'
import { CompanyResearchWorkflowExecutor, companyResearchWorkflowDefinition, WorkflowRegistry } from '../../packages/workflows/index.ts'
import { ResearchManager } from '../../packages/dsh/research-manager/index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'

test('Company Research runs from Research Request through Manager, Workflow, Skill, Plugins, Artifacts, and Evaluation', async () => {
  const workflow = new CompanyResearchWorkflow({
    marketPlugin: {
      async get_market_snapshot(input) {
        return {
          symbol: input.symbol,
          price: 100,
          change: 2,
          volume: 1000,
          source: 'fixture-market',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.9,
        }
      },
    },
    informationPlugin: {
      async search_company_news(input) {
        return {
          symbol: input.symbol,
          items: [{
            symbol: input.symbol,
            headline: 'Company strategy update',
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
    financialPlugin: {
      async get_financial_snapshot(input) {
        return {
          symbol: input.symbol,
          statements: [],
          metrics: [{
            name: 'revenue',
            value: 1000,
            unit: 'CNY',
            period: { start: '2025-01-01', end: '2025-12-31', periodType: 'annual' as const },
            calculationBasis: 'reported',
            confidence: 0.9,
            sourceStatementIds: ['statement-1'],
            source: {
              plugin: 'fixture-financial',
              source: 'fixture-financial',
              publishedAt: createdAt,
              retrievedAt: createdAt,
              quality: 'high' as const,
              confidence: 0.9,
              sourceStatementIds: ['statement-1'],
            },
          }],
          plugin: 'fixture-financial',
          source: 'fixture-financial',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.9,
        }
      },
    },
    artifactIdFactory: (type, ordinal) => `company-e2e-${type}-${ordinal}`,
  })
  const workflows = new WorkflowRegistry()
  workflows.register(companyResearchWorkflowDefinition)
  const manager = new ResearchManager(workflows, new Map([
    ['company-research', new CompanyResearchWorkflowExecutor(workflow)],
  ]))

  const result = await manager.execute({
    workflowId: 'company-research',
    symbol: '600519',
    question: 'What is the long-term business quality of this company?',
    sessionId: 'company-e2e-session',
    createdAt,
    evaluationPeriod: { start: createdAt, end: '2027-02-24T00:00:00.000Z' },
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.workflowId, 'company-research')
  assert.equal(result.report.workflowId, 'company-research')
  assert.equal(result.artifacts.evidence.length, 3)
  assert.deepEqual(result.report.evidenceIds, result.artifacts.evidence.map((item) => item.id))
  assert.deepEqual(result.report.thesisIds, [result.artifacts.thesis.id])
  assert.deepEqual(result.report.predictionIds, [result.artifacts.prediction.id])
  assert.equal(result.artifacts.prediction.thesisId, result.artifacts.thesis.id)

  const review = evaluatePrediction(
    result.artifacts.prediction,
    {
      description: 'Fixture company research outcome.',
      timestamp: '2027-02-24T00:00:00.000Z',
      source: 'fixture-outcome',
      metrics: { ...result.artifacts.prediction.metrics },
    },
    { idFactory: () => 'company-review-001', clock: () => '2027-02-25T00:00:00.000Z' },
  )
  assert.equal(review.predictionId, result.artifacts.prediction.id)
  assert.equal(review.evaluation.status, 'met')
})
