import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  deserializeEvidence,
  deserializePrediction,
  deserializeThesis,
  serializeEvidence,
  serializePrediction,
  serializeThesis,
} from '../../packages/artifacts/index.ts'
import { evaluatePrediction } from '../../packages/evaluation/index.ts'
import { GdeltNewsPlugin } from '../../packages/plugins/adapters/gdelt/index.ts'
import { PluginRegistry } from '../../packages/plugins/registry/index.ts'
import { NewsPlugin } from '../../packages/plugins/news/index.ts'
import { FinancialPlugin, createFinancialPluginComposition } from '../../packages/plugins/financial/index.ts'
import { createLlmEquityResearchAdapters } from '../../dsh/llm-runtime/index.ts'
import { EquityResearchWorkflow, equityResearchWorkflowDefinition, WorkflowRegistry, type EquityResearchStepContext, type EquityResearchWorkflowInput, type EquityResearchWorkflowResult } from '../../packages/workflows/index.ts'
import { ResearchManager } from '../../dsh/research-manager/index.ts'
import { DEEPSEEK_RUNTIME_PROVIDER, DeepSeekProviderAdapter } from '../runtime/deepseek-provider-adapter.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }
const symbol = process.env.REAL_EQUITY_PIPELINE_SYMBOL ?? '600519'

test('PIPELINE-REAL-DATA-001 completes a real Equity Research Pipeline for 600519', {
  skip: realPipelineSkipReason(),
}, async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY!.trim()
  const financialEndpoint = process.env.AKSHARE_FINANCIAL_ENDPOINT!.trim()
  const providerRegistry = new PluginRegistry()
  const newsHandle = providerRegistry.register(new GdeltNewsPlugin({
    timespan: '3m',
    limit: 5,
    endpoint: process.env.GDELT_ENDPOINT,
  }))
  const news = new NewsPlugin(providerRegistry, newsHandle)
  const financialComposition = createFinancialPluginComposition({
    environment: {
      FINANCIAL_PLUGIN_MODE: 'real',
      FINANCIAL_PRIMARY_PLUGIN: 'akshare-financial',
      AKSHARE_FINANCIAL_ENDPOINT: financialEndpoint,
    },
  })
  const financial = new FinancialPlugin(financialComposition.registry, financialComposition.financial)
  const [realNews, realFinancial] = await Promise.all([
    news.search_company_news({ symbol }),
    financial.get_financial_snapshot({ symbol }),
  ])

  assert.ok(realNews.items.length > 0, 'real News Plugin must return at least one record')
  assert.ok(realFinancial.metrics.length > 0, 'real Financial Plugin must return metrics')
  assert.ok(realFinancial.metrics.some(metric => metric.name === 'revenue'))
  assert.ok(realFinancial.metrics.some(metric => metric.name === 'net_profit'))

  const realDataContext = {
    providerNames: { news: 'gdelt-news', financial: realFinancial.plugin },
    news: realNews,
    financial: realFinancial,
  }
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'ResearchHub real equity research pipeline validation.' } })
    const provider = new DeepSeekProviderAdapter({
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      requestTimeoutMs: 90_000,
    })
    ctx.llm.registerAdapter([DEEPSEEK_RUNTIME_PROVIDER], provider)

    const llmSkills = createLlmEquityResearchAdapters({
      llm: ctx.llm,
      provider: DEEPSEEK_RUNTIME_PROVIDER,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      skillRoot: process.env.RESEARCHHUB_SKILL_ROOT,
      artifactIdFactory: (type, ordinal) => `real-pipeline-${type}-${ordinal}`,
    })
    const withRealDataContext = (workflowContext: EquityResearchStepContext) => ({
      ...workflowContext,
      realExternalData: realDataContext,
    })
    const workflow = new EquityResearchWorkflow({
      skills: {
        companyResearch: (input, context) => llmSkills.companyResearch(input, withRealDataContext(context)),
        industryResearch: (input, context) => llmSkills.industryResearch(input, withRealDataContext(context)),
        equityResearch: (input, context) => llmSkills.equityResearch(input, withRealDataContext(context)),
        earningsReview: (input, context) => llmSkills.earningsReview(input, withRealDataContext(context)),
        valuation: (input, context) => llmSkills.valuation(input, withRealDataContext(context)),
      },
      artifactIdFactory: (type, ordinal) => `real-pipeline-${type}-${ordinal}`,
    })
    const workflows = new WorkflowRegistry()
    workflows.register(equityResearchWorkflowDefinition)
    let workflowResult: EquityResearchWorkflowResult | undefined
    const executor = {
      async execute(context: { request: { symbol: string; question: string; sessionId: string; createdAt: string; evaluationPeriod: typeof evaluationPeriod } }) {
        workflowResult = await workflow.run(createWorkflowInput(context))
        return workflowResult.artifacts
      },
    }
    const manager = new ResearchManager(workflows, new Map([['equity-research', executor]]))

    const result = await manager.execute({
      workflowId: 'equity-research',
      symbol,
      question: '分析该公司的投资价值',
      sessionId: 'real-equity-research-pipeline-session',
      createdAt,
      evaluationPeriod,
    })

    assert.equal(result.status, 'completed')
    assert.equal(provider.stats.requests, 5, 'the five configured Skills must execute through the real LLM Runtime')
    assert.ok(provider.requestHistory.every(request => {
      const serialized = JSON.stringify(request.messages)
      return serialized.includes('gdelt-news') && serialized.includes('akshare-financial')
    }), 'every LLM Skill must receive the real provider context')

    assert.ok(workflowResult)
    assert.equal(workflowResult.status, 'success')
    assert.deepEqual(workflowResult.stepStates.map(step => [step.id, step.status]), [
      ['company-understanding', 'completed'],
      ['industry-analysis', 'completed'],
      ['financial-analysis', 'completed'],
      ['earnings-review', 'completed'],
      ['valuation-analysis', 'completed'],
      ['investment-thesis-generation', 'completed'],
    ])
    assert.equal(workflowResult.artifacts.report.workflowId, 'equity-research')
    assert.ok(workflowResult.artifacts.report.sections.length >= 5)
    assert.ok(workflowResult.artifacts.evidence.length >= 5)
    assert.deepEqual(workflowResult.artifacts.thesis.evidenceIds, workflowResult.artifacts.evidence.map(item => item.id))
    assert.equal(workflowResult.artifacts.prediction.thesisId, workflowResult.artifacts.thesis.id)
    assert.deepEqual(result.report.evidenceIds, result.artifacts.evidence.map(item => item.id))
    assert.deepEqual(result.artifacts.evidence.map(item => deserializeEvidence(serializeEvidence(item))), result.artifacts.evidence)
    assert.deepEqual(deserializeThesis(serializeThesis(result.artifacts.thesis)), result.artifacts.thesis)
    assert.deepEqual(deserializePrediction(serializePrediction(result.artifacts.prediction)), result.artifacts.prediction)

    const review = evaluatePrediction(result.artifacts.prediction, {
      description: 'First real equity research pipeline outcome.',
      timestamp: evaluationPeriod.end,
      source: 'real-equity-research-pipeline',
      metrics: { ...result.artifacts.prediction.metrics },
    }, { idFactory: () => 'real-equity-research-pipeline-review-001', clock: () => '2027-02-25T00:00:00.000Z' })
    assert.equal(review.evaluation.status, 'met')
  } finally {
    await ctx.fiber.dispose()
  }
})

function createWorkflowInput(context: { request: { symbol: string; question: string; sessionId: string; createdAt: string; evaluationPeriod: typeof evaluationPeriod } }): EquityResearchWorkflowInput {
  return {
    symbol: context.request.symbol,
    companyName: 'Kweichow Moutai',
    industry: 'Baijiu and spirits',
    geography: 'China',
    question: context.request.question,
    asOf: context.request.createdAt,
    sessionId: context.request.sessionId,
    createdAt: context.request.createdAt,
    evaluationPeriod: context.request.evaluationPeriod,
    earningsPeriod: '2026-Q2',
    valuation: {
      forecasts: [{ year: 2027, revenue: 1000, ebitda: 300, freeCashFlow: 200 }],
      assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 },
    },
  }
}

function realPipelineSkipReason(): string | undefined {
  if (process.env.RUN_REAL_EQUITY_PIPELINE !== '1') return 'set RUN_REAL_EQUITY_PIPELINE=1 to opt in to real News, Financial, and LLM calls'
  if (typeof process.env.DEEPSEEK_API_KEY !== 'string' || process.env.DEEPSEEK_API_KEY.trim().length === 0) return 'DEEPSEEK_API_KEY is not configured'
  if (typeof process.env.AKSHARE_FINANCIAL_ENDPOINT !== 'string' || process.env.AKSHARE_FINANCIAL_ENDPOINT.trim().length === 0) return 'AKSHARE_FINANCIAL_ENDPOINT is not configured'
  return undefined
}
