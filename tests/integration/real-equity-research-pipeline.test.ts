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
import {
  OfficialAnnouncementFetcher,
  OfficialAnnouncementSearchProvider,
  NewsAcquisitionLayer,
  type NewsAcquisitionResult,
  type NewsSearchResult,
} from '../../packages/plugins/news/index.ts'
import { CninfoAnnouncementSourceAdapter } from '../../packages/plugins/adapters/announcement/index.ts'
import { FinancialPlugin, createFinancialPluginComposition } from '../../packages/plugins/financial/index.ts'
import { createLlmEquityResearchAdapters } from '../../dsh/llm-runtime/index.ts'
import { EquityResearchWorkflow, equityResearchWorkflowDefinition, WorkflowRegistry, type EquityResearchStepContext, type EquityResearchWorkflowInput, type EquityResearchWorkflowResult } from '../../packages/workflows/index.ts'
import { ResearchManager } from '../../dsh/research-manager/index.ts'
import { DEEPSEEK_RUNTIME_PROVIDER, DeepSeekProviderAdapter } from '../runtime/deepseek-provider-adapter.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }
const symbol = process.env.REAL_EQUITY_PIPELINE_SYMBOL ?? '600519'

test('PIPELINE-REAL-DATA-003 completes a real Equity Research Pipeline with CNINFO and AKShare for 600519', {
  skip: realPipelineSkipReason(),
}, async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY!.trim()
  const financialEndpoint = process.env.AKSHARE_FINANCIAL_ENDPOINT!.trim()
  const sessionId = 'real-equity-research-pipeline-003-session'
  const newsAcquisition = new NewsAcquisitionLayer({
    searchProvider: new OfficialAnnouncementSearchProvider({
      sourceAdapter: new CninfoAnnouncementSourceAdapter({
        endpoint: process.env.CNINFO_ANNOUNCEMENT_ENDPOINT,
        stockDirectoryEndpoint: process.env.CNINFO_STOCK_DIRECTORY_ENDPOINT,
      }),
    }),
    fetcher: new OfficialAnnouncementFetcher({ timeoutMs: 30_000 }),
    evidenceIdFactory: (ordinal) => `real-pipeline-news-evidence-${ordinal + 1}`,
  })
  const financialComposition = createFinancialPluginComposition({
    environment: {
      FINANCIAL_PLUGIN_MODE: 'real',
      FINANCIAL_PRIMARY_PLUGIN: 'akshare-financial',
      AKSHARE_FINANCIAL_ENDPOINT: financialEndpoint,
    },
  })
  const financial = new FinancialPlugin(financialComposition.registry, financialComposition.financial)
  const [newsAcquisitionResult, realFinancial] = await Promise.all([
    newsAcquisition.acquire({ query: `${symbol} official announcement`, entity: symbol, limit: 3 }, {
      createdAt,
      sessionId,
      entity: symbol,
      provider: 'cninfo-official-search/official-announcement-fetcher',
    }),
    financial.get_financial_snapshot({ symbol }),
  ])
  const realNews = toNewsSearchResult(symbol, newsAcquisitionResult, 'cninfo-official-search/official-announcement-fetcher')

  assert.ok(newsAcquisitionResult.searchResults.length > 0, 'News Acquisition SearchProvider must return candidates')
  assert.ok(newsAcquisitionResult.documents.length > 0, 'News Acquisition WebFetcher must fetch at least one document')
  assert.ok(newsAcquisitionResult.articles.length > 0, 'News Acquisition Normalizer must produce at least one article')
  assert.ok(newsAcquisitionResult.evidence.length > 0, 'News Acquisition EvidenceBuilder must produce Evidence')
  assert.equal(newsAcquisitionResult.articles.length, newsAcquisitionResult.evidence.length)
  assert.equal(newsAcquisitionResult.searchResults.length, newsAcquisitionResult.documents.length + newsAcquisitionResult.errors.length)
  assert.ok(realNews.items.length > 0, 'real News Plugin must return at least one record')
  assert.ok(realFinancial.metrics.length > 0, 'real Financial Plugin must return metrics')
  assert.ok(realFinancial.metrics.some(metric => metric.name === 'revenue'))
  assert.ok(realFinancial.metrics.some(metric => metric.name === 'net_profit'))

  const realDataContext = {
    providerNames: { news: 'cninfo-official-search/official-announcement-fetcher', financial: realFinancial.plugin },
    news: realNews,
    financial: realFinancial,
    newsAcquisition: {
      searchProvider: 'cninfo-official-search',
      fetcher: 'official-announcement-fetcher',
      searchResultCount: newsAcquisitionResult.searchResults.length,
      fetchedDocumentCount: newsAcquisitionResult.documents.length,
      normalizedArticleCount: newsAcquisitionResult.articles.length,
      evidence: newsAcquisitionResult.evidence.map((item) => ({
        id: item.id,
        source: item.source,
        timestamp: item.timestamp,
        confidence: item.confidence,
        metadata: item.metadata,
      })),
      errors: newsAcquisitionResult.errors,
    },
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
      sessionId,
      createdAt,
      evaluationPeriod,
    })

    assert.equal(result.status, 'completed')
    assert.equal(provider.stats.requests, 5, 'the five configured Skills must execute through the real LLM Runtime')
    assert.ok(provider.requestHistory.every(request => {
      const serialized = JSON.stringify(request.messages)
      return serialized.includes('cninfo-official-search') && serialized.includes('official-announcement-fetcher') && serialized.includes('akshare-financial')
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
    assert.ok(newsAcquisitionResult.evidence.some((item) => item.source === 'cninfo'))
    assert.ok(newsAcquisitionResult.evidence.every((item) => item.metadata.acquisition !== undefined))
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

    console.log(`[PIPELINE-REAL-DATA-003] ${JSON.stringify({
      workflow: result.workflowId,
      providers: {
        search: 'cninfo-official-search',
        fetcher: 'official-announcement-fetcher',
        financial: realFinancial.plugin,
        llm: DEEPSEEK_RUNTIME_PROVIDER,
      },
      acquisition: {
        searchResults: newsAcquisitionResult.searchResults.length,
        documents: newsAcquisitionResult.documents.length,
        articles: newsAcquisitionResult.articles.length,
        evidence: newsAcquisitionResult.evidence.length,
        evidenceSources: newsAcquisitionResult.evidence.map((item) => item.source),
        errors: newsAcquisitionResult.errors,
      },
      workflowSteps: workflowResult.stepStates,
      skills: summarizeSkillOutputs(workflowResult),
      artifacts: {
        evidenceCount: workflowResult.artifacts.evidence.length,
        thesis: { id: workflowResult.artifacts.thesis.id, evidenceIds: workflowResult.artifacts.thesis.evidenceIds },
        prediction: { id: workflowResult.artifacts.prediction.id, thesisId: workflowResult.artifacts.prediction.thesisId },
        report: { workflowId: workflowResult.artifacts.report.workflowId, sectionCount: workflowResult.artifacts.report.sections.length },
        evidenceExample: workflowResult.artifacts.evidence[0],
      },
      evaluation: review.evaluation.status,
    })}`)
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

function toNewsSearchResult(symbol: string, acquisition: NewsAcquisitionResult, source: string): NewsSearchResult {
  const items = acquisition.articles.map((article, index) => ({
    symbol,
    headline: article.title,
    content: article.content,
    source,
    timestamp: article.publishedAt,
    confidence: acquisition.evidence[index]?.confidence ?? 0.75,
  }))
  const timestamp = items[0]?.timestamp ?? '2026-08-24T00:00:00.000Z'
  const confidence = items.length === 0
    ? 0
    : Number((items.reduce((total, item) => total + item.confidence, 0) / items.length).toFixed(4))
  return {
    symbol,
    items,
    source,
    timestamp,
    quality: items.length === 0 ? 'low' : 'medium',
    confidence,
  }
}

function summarizeSkillOutputs(workflowResult: EquityResearchWorkflowResult) {
  const company = workflowResult.stageOutputs['company-understanding']
  const industry = workflowResult.stageOutputs['industry-analysis']
  const financial = workflowResult.stageOutputs['financial-analysis']
  const earnings = workflowResult.stageOutputs['earnings-review']
  const valuation = workflowResult.stageOutputs['valuation-analysis']
  return [
    { stepId: 'company-understanding', skillId: 'company-research', evidenceCount: company.artifacts.evidence.length, outputSummary: company.artifacts.thesis.statement.slice(0, 160) },
    { stepId: 'industry-analysis', skillId: industry.skillId, evidenceCount: industry.evidence.length, sectionCount: industry.sections.length, outputSummary: industry.sections[0]?.findings[0] ?? '' },
    { stepId: 'financial-analysis', skillId: financial.skillId, evidenceCount: financial.evidence.length, sectionCount: financial.sections.length, outputSummary: financial.sections[0]?.findings[0] ?? '' },
    { stepId: 'earnings-review', skillId: earnings.skillId, evidenceCount: earnings.evidence.length, sectionCount: earnings.sections.length, outputSummary: earnings.sections[0]?.findings[0] ?? '' },
    { stepId: 'valuation-analysis', skillId: valuation.skillId, evidenceCount: valuation.evidence.length, sectionCount: valuation.sections.length, outputSummary: valuation.sections[0]?.findings[0] ?? '' },
  ]
}

function realPipelineSkipReason(): string | undefined {
  if (process.env.RUN_REAL_EQUITY_PIPELINE !== '1') return 'set RUN_REAL_EQUITY_PIPELINE=1 to opt in to real News Acquisition, Financial, and LLM calls'
  if (typeof process.env.DEEPSEEK_API_KEY !== 'string' || process.env.DEEPSEEK_API_KEY.trim().length === 0) return 'DEEPSEEK_API_KEY is not configured'
  if (typeof process.env.AKSHARE_FINANCIAL_ENDPOINT !== 'string' || process.env.AKSHARE_FINANCIAL_ENDPOINT.trim().length === 0) return 'AKSHARE_FINANCIAL_ENDPOINT is not configured'
  return undefined
}
