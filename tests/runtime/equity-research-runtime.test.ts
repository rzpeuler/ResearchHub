import assert from 'node:assert/strict'
import test from 'node:test'
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
import { evaluatePrediction } from '../../packages/artifacts/index.ts'
import { ResearchManager } from '../../dsh/research-manager/index.ts'
import { createLlmEquityResearchAdapters } from '../../dsh/llm-runtime/index.ts'
import { EquityResearchWorkflow, EquityResearchWorkflowExecutor, equityResearchWorkflowDefinition, WorkflowRegistry } from '../../packages/workflows/index.ts'
import { DEEPSEEK_RUNTIME_PROVIDER, DeepSeekProviderAdapter } from './deepseek-provider-adapter.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('LLM-RUNTIME-VALIDATION-001 executes Equity Research through the real Harness LLM runtime', {
  skip: realRuntimeSkipReason(),
}, async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY
  assert.ok(apiKey)
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'ResearchHub real LLM runtime validation.' } })
    const provider = new DeepSeekProviderAdapter({ apiKey, baseUrl: process.env.DEEPSEEK_BASE_URL, requestTimeoutMs: 90_000 })
    ctx.llm.registerAdapter([DEEPSEEK_RUNTIME_PROVIDER], provider)

    const workflow = new EquityResearchWorkflow({
      skills: createLlmEquityResearchAdapters({
        llm: ctx.llm,
        provider: DEEPSEEK_RUNTIME_PROVIDER,
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        skillRoot: process.env.RESEARCHHUB_SKILL_ROOT,
        artifactIdFactory: (type, ordinal) => `llm-runtime-${type}-${ordinal}`,
      }),
      artifactIdFactory: (type, ordinal) => `llm-runtime-${type}-${ordinal}`,
    })
    const workflows = new WorkflowRegistry()
    workflows.register(equityResearchWorkflowDefinition)
    const manager = new ResearchManager(workflows, new Map([
      ['equity-research', new EquityResearchWorkflowExecutor(workflow, (context) => ({
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
      }))],
    ]))

    const result = await manager.execute({
      workflowId: 'equity-research',
      symbol: '600519',
      question: 'Assess the company equity research thesis and its reviewable risks.',
      sessionId: 'llm-runtime-validation-session',
      createdAt,
      evaluationPeriod,
    })

    assert.equal(result.status, 'completed')
    assert.equal(provider.stats.requests, 5)
    assert.equal(result.artifacts.thesis.evidenceIds.length, result.artifacts.evidence.length)
    assert.ok(result.artifacts.report.sections.length >= 5)
    assert.ok(provider.requestHistory.every((request) => request.provider === DEEPSEEK_RUNTIME_PROVIDER))
    assert.ok(provider.requestHistory.every((request) => request.messages[0]?.content[0]?.type === 'text'))
    assert.match(provider.requestHistory[1]?.messages[0]?.content[0]?.type === 'text' ? provider.requestHistory[1].messages[0].content[0].text : '', /industry-research/)
    assert.match(provider.requestHistory[1]?.messages[0]?.content[0]?.type === 'text' ? provider.requestHistory[1].messages[0].content[0].text : '', /company-understanding|company-research/)

    assert.deepEqual(result.artifacts.evidence.map((item) => deserializeEvidence(serializeEvidence(item))), result.artifacts.evidence)
    assert.deepEqual(deserializeThesis(serializeThesis(result.artifacts.thesis)), result.artifacts.thesis)
    assert.deepEqual(deserializePrediction(serializePrediction(result.artifacts.prediction)), result.artifacts.prediction)

    const review = evaluatePrediction(result.artifacts.prediction, {
      description: 'Runtime validation outcome.',
      timestamp: evaluationPeriod.end,
      source: 'runtime-validation',
      metrics: { ...result.artifacts.prediction.metrics },
    }, { idFactory: () => 'llm-runtime-review-001', clock: () => '2027-02-25T00:00:00.000Z' })
    assert.equal(review.evaluation.status, 'met')
  } finally {
    await ctx.fiber.dispose()
  }
})

function realRuntimeSkipReason(): string | undefined {
  if (process.env.RESEARCHHUB_RUN_REAL_LLM !== '1') return 'set RESEARCHHUB_RUN_REAL_LLM=1 to opt in to a billable network call'
  if (typeof process.env.DEEPSEEK_API_KEY !== 'string' || process.env.DEEPSEEK_API_KEY.trim().length === 0) return 'DEEPSEEK_API_KEY is not configured'
  return undefined
}
