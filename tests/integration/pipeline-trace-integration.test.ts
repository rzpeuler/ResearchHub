import assert from 'node:assert/strict'
import test from 'node:test'
import { createEvidence, createPrediction, createThesis } from '../../packages/artifacts/index.ts'
import type { CompanyResearchResult } from '../../packages/skills/company-research/types.ts'
import type { EarningsReviewResult } from '../../packages/skills/earnings-review/types.ts'
import type { EquityResearchResult } from '../../packages/skills/equity-research/types.ts'
import type { IndustryResearchResult } from '../../packages/skills/industry-research/types.ts'
import type { ValuationResult } from '../../packages/skills/valuation/types.ts'
import { EquityResearchWorkflow } from '../../packages/workflows/equity-research/workflow.ts'

const createdAt = '2026-08-24T00:00:00.000Z'
const evaluationPeriod = { start: createdAt, end: '2027-02-24T00:00:00.000Z' }

test('PIPELINE-TRACE-INTEGRATION-001 creates and queries a complete Equity Research Trace Graph', async () => {
  const workflow = new EquityResearchWorkflow({
    skills: adapters(),
    artifactIdFactory: (type, ordinal) => `trace-pipeline-${type}-${ordinal}`,
  })

  const result = await workflow.run({
    symbol: '600519',
    companyName: 'Fixture Co',
    industry: 'Beverages',
    geography: 'China',
    question: 'Assess the company equity research thesis.',
    asOf: createdAt,
    sessionId: 'pipeline-trace-session',
    createdAt,
    evaluationPeriod,
    earningsPeriod: '2026-Q2',
    valuation: {
      forecasts: [{ year: 2027, revenue: 1000, ebitda: 250, freeCashFlow: 120 }],
      assumptions: { wacc: 0.1, terminalGrowth: 0.03, netDebt: 50, sharesOutstanding: 100 },
    },
  })

  const reportId = 'report:equity-research:pipeline-trace-session'
  const lineage = workflow.traceStore.queryLineage(reportId)
  const artifactIds = new Set(lineage.artifacts.map((artifact) => artifact.artifactId))

  assert.equal(result.status, 'success')
  assert.equal(result.artifacts.evidence.length, 5)
  assert.equal(result.artifacts.prediction.thesisId, result.artifacts.thesis.id)
  assert.ok(artifactIds.has(reportId))
  assert.ok(artifactIds.has(result.artifacts.thesis.id))
  assert.ok(artifactIds.has(result.artifacts.prediction.id))
  for (const evidence of result.artifacts.evidence) assert.ok(artifactIds.has(evidence.id))

  assert.equal(lineage.events.filter((event) => event.eventType === 'artifact_created').length, 5)
  assert.equal(lineage.events.filter((event) => event.eventType === 'artifact_derived').length, 2)
  assert.equal(lineage.events.filter((event) => event.eventType === 'artifact_linked').length, 1)
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'contains' && relation.from.artifactId === reportId && relation.to.artifactId === result.artifacts.thesis.id))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'contains' && relation.from.artifactId === reportId && relation.to.artifactId === result.artifacts.prediction.id))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'supports' && relation.to.artifactId === result.artifacts.thesis.id))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'derived_from' && relation.from.artifactId === result.artifacts.evidence[0]?.id && relation.to.artifactId === result.artifacts.thesis.id))
  assert.ok(lineage.relations.some((relation) => relation.relationType === 'derived_from' && relation.from.artifactId === result.artifacts.thesis.id && relation.to.artifactId === result.artifacts.prediction.id))
})

test('Equity Research TraceStore is isolated per Workflow instance', () => {
  const first = new EquityResearchWorkflow({ skills: adapters(), artifactIdFactory: (type, ordinal) => `${type}-${ordinal}` })
  const second = new EquityResearchWorkflow({ skills: adapters(), artifactIdFactory: (type, ordinal) => `${type}-${ordinal}` })

  assert.notEqual(first.traceStore, second.traceStore)
  assert.deepEqual(second.traceStore.queryByArtifact('report:equity-research:pipeline-trace-session'), [])
})

function adapters() {
  return {
    companyResearch: async (): Promise<CompanyResearchResult> => {
      const evidence = createEvidence({
        id: 'company-evidence-001',
        createdAt,
        sessionId: 'pipeline-trace-session',
        metadata: { skill: 'company-research', provider: 'fixture-company' },
        source: 'fixture-company',
        content: 'Company evidence.',
        timestamp: createdAt,
        confidence: 0.9,
      })
      const thesis = createThesis({
        id: 'company-thesis-001',
        createdAt,
        sessionId: 'pipeline-trace-session',
        metadata: { skill: 'company-research' },
        statement: 'Company understanding fixture.',
        evidenceIds: [evidence.id],
        confidence: 0.8,
        risks: ['Fixture risk'],
      })
      const prediction = createPrediction({
        id: 'company-prediction-001',
        createdAt,
        sessionId: 'pipeline-trace-session',
        metadata: { skill: 'company-research' },
        thesisId: thesis.id,
        expectation: 'Company evidence remains reviewable.',
        evaluationPeriod,
        metrics: { source: 'fixture' },
      })
      return { status: 'success', symbol: '600519', artifacts: { evidence: [evidence], thesis, prediction } }
    },
    industryResearch: async (): Promise<IndustryResearchResult> => ({ ...reportBase('industry-research'), skillId: 'industry-research', peerMetrics: [] } as IndustryResearchResult),
    equityResearch: async (): Promise<EquityResearchResult> => ({ ...reportBase('equity-research'), skillId: 'equity-research', thesis: { statement: 'Equity fixture thesis.', drivers: [], risks: [], evidenceIds: [] } } as EquityResearchResult),
    earningsReview: async (): Promise<EarningsReviewResult> => ({ ...reportBase('earnings-review'), skillId: 'earnings-review', variances: [], guidance: 'maintained', thesisImpact: 'neutral' } as EarningsReviewResult),
    valuation: async (): Promise<ValuationResult> => ({ ...reportBase('valuation'), skillId: 'valuation', peers: [], statistics: [], dcf: { enterpriseValue: 100, equityValue: 90, impliedSharePrice: 9, presentValueOfForecasts: 40, presentValueOfTerminalValue: 60, terminalValueShare: 0.6, sensitivity: [] } } as ValuationResult),
  }
}

function reportBase(skillId: string) {
  return {
    skillId,
    subject: 'Fixture Co (600519)',
    asOf: createdAt,
    template: `${skillId}-report`,
    sections: [{ id: `${skillId}-section`, title: `${skillId} section`, findings: [`${skillId} finding`], evidenceIds: [] }],
    evidence: [{ id: `${skillId}-evidence`, source: `${skillId}-fixture`, asOf: createdAt, claim: `${skillId} claim`, details: {}, confidence: 0.8 }],
    keyRisks: [`${skillId} risk`],
    openQuestions: [`${skillId} question`],
  }
}
