import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deserializeEvidence,
  deserializePrediction,
  deserializeThesis,
  serializeEvidence,
  serializePrediction,
  serializeThesis,
} from '../../packages/artifacts/index.ts'
import { evaluatePrediction } from '../../packages/evaluation/index.ts'
import { CompanyResearchWorkflow } from '../../packages/skills/company-research/index.ts'
import { CompanyResearchWorkflowExecutor, companyResearchWorkflowDefinition, WorkflowRegistry } from '../../packages/workflows/index.ts'
import { ResearchManager } from '../../dsh/research-manager/index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('PIPELINE-VALIDATION-001 runs the minimum company equity research pipeline end to end', async () => {
  const pluginCalls: string[] = []
  const workflow = new CompanyResearchWorkflow({
    marketPlugin: {
      async get_market_snapshot(input) {
        pluginCalls.push(`market:${input.symbol}`)
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
        pluginCalls.push(`news:${input.symbol}`)
        return {
          symbol: input.symbol,
          items: [{
            symbol: input.symbol,
            headline: 'Company operating update',
            content: 'Fixture evidence for the company research request.',
            source: 'fixture-news',
            timestamp: createdAt,
            confidence: 0.8,
          }],
          source: 'fixture-news',
          timestamp: createdAt,
          quality: 'high' as const,
          confidence: 0.8,
        }
      },
    },
    financialPlugin: {
      async get_financial_snapshot(input) {
        pluginCalls.push(`financial:${input.symbol}`)
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
    artifactIdFactory: (type, ordinal) => `pipeline-${type}-${ordinal}`,
  })

  const workflows = new WorkflowRegistry()
  workflows.register(companyResearchWorkflowDefinition)
  const manager = new ResearchManager(workflows, new Map([
    ['company-research', new CompanyResearchWorkflowExecutor(workflow)],
  ]))

  const result = await manager.execute({
    workflowId: 'company-research',
    symbol: '600519',
    question: '请完成贵州茅台的公司股权研究，评估商业质量、竞争优势、增长驱动和主要风险。',
    sessionId: 'pipeline-validation-session',
    createdAt,
    evaluationPeriod,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.workflowId, 'company-research')
  assert.equal(result.report.question, '请完成贵州茅台的公司股权研究，评估商业质量、竞争优势、增长驱动和主要风险。')
  assert.deepEqual(pluginCalls, ['market:600519', 'news:600519', 'financial:600519'])

  const steps = workflows.get('company-research').steps
  assert.equal(steps.length, 9)
  assert.ok(steps.every((step) => step.skill === 'company-research'))
  assert.deepEqual(steps.map((step) => step.id), [
    'business-understanding',
    'industry-position',
    'competitive-advantage',
    'growth-drivers',
    'financial-quality',
    'capital-allocation',
    'risk-analysis',
    'generate-company-thesis',
    'generate-company-prediction',
  ])
  assert.ok(steps.slice(1).every((step, index) => step.dependsOn.length > 0 && steps[index]!.id === step.dependsOn[0]))

  const { evidence, thesis, prediction } = result.artifacts
  assert.equal(evidence.length, 3)
  assert.deepEqual(thesis.evidenceIds, evidence.map((item) => item.id))
  assert.equal(prediction.thesisId, thesis.id)
  assert.deepEqual(result.report.evidenceIds, evidence.map((item) => item.id))
  assert.deepEqual(result.report.thesisIds, [thesis.id])
  assert.deepEqual(result.report.predictionIds, [prediction.id])

  const serializedEvidence = evidence.map(serializeEvidence)
  const serializedThesis = serializeThesis(thesis)
  const serializedPrediction = serializePrediction(prediction)
  assert.deepEqual(serializedEvidence.map(deserializeEvidence), evidence)
  assert.deepEqual(deserializeThesis(serializedThesis), thesis)
  assert.deepEqual(deserializePrediction(serializedPrediction), prediction)

  const review = evaluatePrediction(
    prediction,
    {
      description: 'Fixture company research outcome.',
      timestamp: evaluationPeriod.end,
      source: 'fixture-evaluation',
      metrics: { ...prediction.metrics },
    },
    { idFactory: () => 'pipeline-review-001', clock: () => '2027-02-25T00:00:00.000Z' },
  )
  assert.equal(review.evaluation.status, 'met')
  assert.equal(review.predictionId, prediction.id)
})
