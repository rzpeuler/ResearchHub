import assert from 'node:assert/strict'
import test from 'node:test'
import { createEvidence, createPrediction, createThesis } from '../../artifacts/index.ts'
import type { CompanyResearchResult } from '../../skills/company-research/types.ts'
import type { EarningsReviewResult } from '../../skills/earnings-review/types.ts'
import type { EquityResearchResult } from '../../skills/equity-research/types.ts'
import type { IndustryResearchResult } from '../../skills/industry-research/types.ts'
import type { ValuationResult } from '../../skills/valuation/types.ts'
import { EquityResearchWorkflow } from './workflow.ts'
import { EquityResearchWorkflowError } from './errors.ts'

const asOf = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: asOf, end: '2027-02-24T00:00:00.000Z' }

function companyResult(): CompanyResearchResult {
  const evidence = createEvidence({ id: 'company-evidence-1', createdAt: asOf, sessionId: 'session', metadata: { skill: 'company-research' }, source: 'company-fixture', content: 'Company evidence', timestamp: asOf, confidence: 0.9 })
  const thesis = createThesis({ id: 'company-thesis-1', createdAt: asOf, sessionId: 'session', metadata: { skill: 'company-research' }, statement: 'Company understanding fixture.', evidenceIds: [evidence.id], confidence: 0.7, risks: ['Company evidence requires review.'] })
  const prediction = createPrediction({ id: 'company-prediction-1', createdAt: asOf, sessionId: 'session', metadata: { skill: 'company-research' }, thesisId: thesis.id, expectation: 'Company evidence remains reviewable.', evaluationPeriod, metrics: { source: 'fixture' } })
  return { status: 'success', symbol: '600519', artifacts: { evidence: [evidence], thesis, prediction } }
}

function reportBase(skillId: string) {
  return {
    skillId,
    subject: 'Fixture Co (600519)',
    asOf,
    template: `${skillId}-report`,
    sections: [{ id: `${skillId}-section`, title: `${skillId} section`, findings: [`${skillId} finding`], evidenceIds: [] }],
    evidence: [{ id: `${skillId}-evidence`, source: `${skillId}-fixture`, asOf, claim: `${skillId} claim`, details: {}, confidence: 0.8 }],
    keyRisks: [`${skillId} risk`],
    openQuestions: [`${skillId} question`],
  }
}

function adapters(calls: string[], failAt?: string) {
  const maybeFail = (skillId: string) => {
    if (failAt === skillId) throw new Error(`${skillId} fixture failure`)
  }
  return {
    companyResearch: async (_input: never, context: { outputs: Record<string, unknown> }) => { calls.push('company-research'); maybeFail('company-research'); assert.deepEqual(Object.keys(context.outputs), []); return companyResult() },
    industryResearch: async (_input: never, context: { outputs: Record<string, unknown> }) => { calls.push('industry-research'); maybeFail('industry-research'); assert.ok(context.outputs['company-understanding']); return { ...reportBase('industry-research'), skillId: 'industry-research' as const, peerMetrics: [] } as IndustryResearchResult },
    equityResearch: async (_input: never, context: { outputs: Record<string, unknown> }) => { calls.push('equity-research'); maybeFail('equity-research'); assert.ok(context.outputs['industry-analysis']); return { ...reportBase('equity-research'), skillId: 'equity-research' as const, thesis: { statement: 'Equity fixture thesis.', drivers: [], risks: [], evidenceIds: [] } } as EquityResearchResult },
    earningsReview: async (_input: never, context: { outputs: Record<string, unknown> }) => { calls.push('earnings-review'); maybeFail('earnings-review'); assert.ok(context.outputs['financial-analysis']); return { ...reportBase('earnings-review'), skillId: 'earnings-review' as const, variances: [], guidance: 'maintained' as const, thesisImpact: 'neutral' as const } as EarningsReviewResult },
    valuation: async (_input: never, context: { outputs: Record<string, unknown> }) => { calls.push('valuation'); maybeFail('valuation'); assert.ok(context.outputs['earnings-review']); return { ...reportBase('valuation'), skillId: 'valuation' as const, peers: [], statistics: [], dcf: { enterpriseValue: 100, equityValue: 90, impliedSharePrice: 9, presentValueOfForecasts: 40, presentValueOfTerminalValue: 60, terminalValueShare: 0.6, sensitivity: [] } } as ValuationResult },
  }
}

function input() {
  return {
    symbol: '600519', companyName: 'Fixture Co', industry: 'Beverages', geography: 'China',
    question: 'Assess the company equity research thesis.', asOf, sessionId: 'session', createdAt: asOf,
    evaluationPeriod, earningsPeriod: '2026-Q2',
    valuation: { forecasts: [{ year: 2027, revenue: 1000, ebitda: 250, freeCashFlow: 120 }], assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 } },
  }
}

test('EquityResearchWorkflow composes five Skills and assembles a research bundle', async () => {
  const calls: string[] = []
  const workflow = new EquityResearchWorkflow({ skills: adapters(calls), artifactIdFactory: (type, ordinal) => `equity-${type}-${ordinal}` })
  const result = await workflow.run(input())

  assert.deepEqual(calls, ['company-research', 'industry-research', 'equity-research', 'earnings-review', 'valuation'])
  assert.ok(result.stepStates.every((state) => state.status === 'completed'))
  assert.equal(result.artifacts.prediction.metrics.completedStepCount, 6)
  assert.equal(result.artifacts.report.workflowId, 'equity-research')
  assert.equal(result.artifacts.report.evidence.length, 5)
  assert.equal(result.artifacts.thesis.evidenceIds.length, 5)
  assert.equal(result.artifacts.prediction.thesisId, result.artifacts.thesis.id)
  assert.equal(result.artifacts.report.thesisId, result.artifacts.thesis.id)
  assert.equal(result.artifacts.report.predictionId, result.artifacts.prediction.id)
  assert.equal(result.artifacts.report.sections.some((section) => section.stepId === 'valuation-analysis'), true)
})

test('EquityResearchWorkflow records a failed Skill and leaves later steps pending', async () => {
  const workflow = new EquityResearchWorkflow({ skills: adapters([], 'earnings-review'), artifactIdFactory: (type, ordinal) => `${type}-${ordinal}` })
  await assert.rejects(() => workflow.run(input()), (error: unknown) => {
    assert.ok(error instanceof EquityResearchWorkflowError)
    assert.equal(error.stepId, 'earnings-review')
    assert.equal(error.states.find((state) => state.id === 'earnings-review')?.status, 'failed')
    assert.equal(error.states.find((state) => state.id === 'valuation-analysis')?.status, 'pending')
    return true
  })
})
