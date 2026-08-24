import assert from 'node:assert/strict'
import test from 'node:test'
import { ResearchManager } from './index.ts'
import { CompanyResearchWorkflow } from '../../packages/skills/company-research/index.ts'
import { runEarningsReviewCommand } from '../../packages/skills/earnings-review/index.ts'
import { runEquityResearchCommand } from '../../packages/skills/equity-research/index.ts'
import { runIndustryResearchCommand } from '../../packages/skills/industry-research/index.ts'
import { runValuationCommand } from '../../packages/skills/valuation/index.ts'
import { EquityResearchWorkflow, EquityResearchWorkflowExecutor, equityResearchWorkflowDefinition, WorkflowRegistry } from '../../packages/workflows/index.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('ResearchManager discovers and executes the Equity Research Workflow with five Skill adapters', async () => {
  const companyWorkflow = new CompanyResearchWorkflow({
    marketPlugin: { async get_market_snapshot(input) { return { symbol: input.symbol, price: 100, change: 2, volume: 1000, source: 'fixture-market', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    informationPlugin: { async search_company_news(input) { return { symbol: input.symbol, items: [{ symbol: input.symbol, headline: 'Company update', content: 'Fixture company evidence.', source: 'fixture-news', timestamp: createdAt, confidence: 0.8 }], source: 'fixture-news', timestamp: createdAt, quality: 'high' as const, confidence: 0.8 } } },
    financialPlugin: { async get_financial_snapshot(input) { return { symbol: input.symbol, statements: [], metrics: [], plugin: 'fixture-financial', source: 'fixture-financial', timestamp: createdAt, quality: 'high' as const, confidence: 0.9 } } },
    artifactIdFactory: (type, ordinal) => `dsh-equity-${type}-${ordinal}`,
  })
  const workflow = new EquityResearchWorkflow({
    skills: {
      companyResearch: (input, _context) => companyWorkflow.run(input),
      industryResearch: (input) => runIndustryResearchCommand(input, { research: {
        search_industry: async () => [{ source: 'fixture-industry', title: 'Industry note', content: 'Fixture industry evidence.', asOf: createdAt, confidence: 0.8 }],
        list_peer_metrics: async () => [{ name: 'Peer A', source: 'fixture-industry', asOf: createdAt, revenueGrowth: 0.1 }],
      } }),
      equityResearch: (input) => runEquityResearchCommand(input, { market: { get_market_snapshot: async () => ({ price: 100 }) }, financial: { get_financial_snapshot: async () => ({ revenue: 1000 }) }, information: { search_company_news: async () => ({ headline: 'Equity update' }) } }),
      earningsReview: (input) => runEarningsReviewCommand(input, { earnings: { get_earnings_snapshot: async () => ({ symbol: input.symbol, period: input.period, actual: { revenue: 110, eps: 2 }, consensus: { revenue: 100, eps: 1.9 }, guidance: 'maintained', source: 'fixture-earnings', asOf: createdAt }) } }),
      valuation: (input) => runValuationCommand(input, { peers: { list_peer_valuations: async () => [{ symbol: '000001', name: 'Peer A', evRevenue: 3, evEbitda: 12, pe: 20, source: 'fixture-peers', asOf: createdAt }] } }),
    },
    artifactIdFactory: (type, ordinal) => `dsh-equity-${type}-${ordinal}`,
  })
  const workflows = new WorkflowRegistry()
  workflows.register(equityResearchWorkflowDefinition)
  const manager = new ResearchManager(workflows, new Map([
    ['equity-research', new EquityResearchWorkflowExecutor(workflow, (context) => ({
      symbol: context.request.symbol,
      companyName: 'Fixture Co',
      industry: 'Beverages',
      geography: 'China',
      question: context.request.question,
      asOf: context.request.createdAt,
      sessionId: context.request.sessionId,
      createdAt: context.request.createdAt,
      evaluationPeriod: context.request.evaluationPeriod,
      earningsPeriod: '2026-Q2',
      valuation: { forecasts: [{ year: 2027, revenue: 1000, ebitda: 250, freeCashFlow: 120 }], assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 } },
    }))],
  ]))

  const result = await manager.execute({ workflowId: 'equity-research', symbol: '600519', question: 'Assess the company equity research thesis.', sessionId: 'dsh-equity-session', createdAt, evaluationPeriod })

  assert.equal(result.status, 'completed')
  assert.equal(result.workflowId, 'equity-research')
  assert.equal(result.report.question, 'Assess the company equity research thesis.')
  assert.ok(result.artifacts.evidence.length >= 5)
  assert.equal(result.artifacts.prediction.thesisId, result.artifacts.thesis.id)
  assert.deepEqual(result.report.thesisIds, [result.artifacts.thesis.id])
  assert.deepEqual(result.report.predictionIds, [result.artifacts.prediction.id])
})
