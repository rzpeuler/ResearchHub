import {
  assertNonEmptyString,
  assertTimestamp,
  createEvidence,
  createPrediction,
  createThesis,
  type Evidence,
} from '../../artifacts/index.ts'
import { EquityResearchWorkflowError } from './errors.ts'
import type {
  EquityResearchArtifactIdFactory,
  EquityResearchArtifactBundle,
  EquityResearchReport,
  EquityResearchReportSection,
  EquityResearchSkillAdapters,
  EquityResearchStepContext,
  EquityResearchStepId,
  EquityResearchStepOutputMap,
  EquityResearchStepState,
  EquityResearchWorkflowInput,
  EquityResearchWorkflowResult,
} from './types.ts'
import type { EarningsReviewResult } from '../../skills/earnings-review/types.ts'
import type { EquityResearchResult } from '../../skills/equity-research/types.ts'
import type { IndustryResearchResult } from '../../skills/industry-research/types.ts'
import type { ValuationResult } from '../../skills/valuation/types.ts'

const stepIds: EquityResearchStepId[] = [
  'company-understanding',
  'industry-analysis',
  'financial-analysis',
  'earnings-review',
  'valuation-analysis',
  'investment-thesis-generation',
]

export interface EquityResearchWorkflowOptions {
  skills: EquityResearchSkillAdapters
  artifactIdFactory: EquityResearchArtifactIdFactory
}

export class EquityResearchWorkflow {
  constructor(private readonly options: EquityResearchWorkflowOptions) {}

  async run(input: EquityResearchWorkflowInput): Promise<EquityResearchWorkflowResult> {
    const request = validateInput(input)
    const states: EquityResearchStepState[] = stepIds.map((id) => ({ id, status: 'pending' }))
    const outputs = {} as Partial<EquityResearchStepOutputMap>

    await this.runStep(request, 'company-understanding', states, outputs, async (context) => {
      return this.options.skills.companyResearch({
        symbol: request.symbol,
        sessionId: request.sessionId,
        createdAt: request.createdAt,
        evaluationPeriod: request.evaluationPeriod,
      }, context)
    })
    await this.runStep(request, 'industry-analysis', states, outputs, async (context) => {
      return this.options.skills.industryResearch({
        industry: request.industry,
        geography: request.geography,
        asOf: request.asOf,
        researchQuestion: request.question,
      }, context)
    })
    await this.runStep(request, 'financial-analysis', states, outputs, async (context) => {
      return this.options.skills.equityResearch({
        symbol: request.symbol,
        companyName: request.companyName,
        asOf: request.asOf,
        researchQuestion: request.question,
      }, context)
    })
    await this.runStep(request, 'earnings-review', states, outputs, async (context) => {
      return this.options.skills.earningsReview({
        symbol: request.symbol,
        companyName: request.companyName,
        period: request.earningsPeriod,
        asOf: request.asOf,
      }, context)
    })
    await this.runStep(request, 'valuation-analysis', states, outputs, async (context) => {
      return this.options.skills.valuation({
        symbol: request.symbol,
        companyName: request.companyName,
        asOf: request.asOf,
        ...request.valuation,
      }, context)
    })

    const finalState = states.find((state) => state.id === 'investment-thesis-generation')!
    finalState.status = 'running'
    let artifacts: EquityResearchArtifactBundle
    try {
      artifacts = this.assembleArtifacts(request, outputs as EquityResearchStepOutputMap, states)
      finalState.status = 'completed'
    } catch (error) {
      finalState.status = 'failed'
      finalState.error = error instanceof Error ? error.message : String(error)
      throw new EquityResearchWorkflowError(finalState.id, finalState.error, states, error)
    }

    return {
      status: 'success',
      workflowId: 'equity-research',
      symbol: request.symbol,
      stepStates: states.map((state) => ({ ...state })),
      stageOutputs: outputs as EquityResearchStepOutputMap,
      artifacts,
    }
  }

  private async runStep<T extends Exclude<EquityResearchStepId, 'investment-thesis-generation'>>(
    request: EquityResearchWorkflowInput,
    id: T,
    states: EquityResearchStepState[],
    outputs: Partial<EquityResearchStepOutputMap>,
    execute: (context: EquityResearchStepContext) => Promise<EquityResearchStepOutputMap[T]>,
  ): Promise<void> {
    const state = states.find((item) => item.id === id)!
    state.status = 'running'
    try {
      const output = await execute({
        request: Object.freeze({ ...request }),
        outputs,
        states: states.map((item) => ({ ...item })),
      })
      outputs[id] = output
      state.status = 'completed'
    } catch (error) {
      state.status = 'failed'
      state.error = error instanceof Error ? error.message : String(error)
      throw new EquityResearchWorkflowError(id, state.error, states, error)
    }
  }

  private assembleArtifacts(
    request: EquityResearchWorkflowInput,
    outputs: EquityResearchStepOutputMap,
    states: EquityResearchStepState[],
  ): EquityResearchArtifactBundle {
    const companyArtifacts = outputs['company-understanding'].artifacts
    const evidence: Evidence[] = [...companyArtifacts.evidence]
    const reportSections: EquityResearchReportSection[] = [companySection(outputs['company-understanding'])]
    let evidenceOrdinal = evidence.length

    for (const [stepId, output] of [
      ['industry-analysis', outputs['industry-analysis']],
      ['financial-analysis', outputs['financial-analysis']],
      ['earnings-review', outputs['earnings-review']],
      ['valuation-analysis', outputs['valuation-analysis']],
    ] as const) {
      const evidenceId = this.options.artifactIdFactory('evidence', evidenceOrdinal++)
      evidence.push(createEvidence({
        id: evidenceId,
        createdAt: request.createdAt,
        sessionId: request.sessionId,
        metadata: { workflow: 'equity-research', stepId, skillId: output.skillId },
        source: `skill:${output.skillId}`,
        content: JSON.stringify(output),
        timestamp: output.asOf,
        confidence: averageConfidence(output),
      }))
      reportSections.push(...reportSectionsFor(stepId, output, [evidenceId]))
    }

    const evidenceIds = evidence.map((item) => item.id)
    const reportEvidence = [
      ...companyArtifacts.evidence.map((item) => ({ id: item.id, source: item.source, asOf: item.timestamp, claim: item.content, details: item.metadata, confidence: item.confidence })),
      ...Object.values(outputs).flatMap((output) => 'evidence' in output ? output.evidence : []),
    ]
    const risks = [
      ...outputs['company-understanding'].artifacts.thesis.risks,
      ...Object.values(outputs).flatMap((output) => 'keyRisks' in output ? output.keyRisks : []),
    ]
    const thesis = createThesis({
      id: this.options.artifactIdFactory('thesis', 0),
      createdAt: request.createdAt,
      sessionId: request.sessionId,
      metadata: { workflow: 'equity-research', symbol: request.symbol, skills: ['company-research', 'industry-research', 'equity-research', 'earnings-review', 'valuation'] },
      statement: `Equity research synthesis for ${request.companyName} combines five independent research Skill outputs; conclusions remain subject to evidence and risk review.`,
      evidenceIds,
      confidence: 0.5,
      risks: [...new Set(risks)],
    })
    const prediction = createPrediction({
      id: this.options.artifactIdFactory('prediction', 0),
      createdAt: request.createdAt,
      sessionId: request.sessionId,
      metadata: { workflow: 'equity-research', symbol: request.symbol },
      thesisId: thesis.id,
      expectation: 'Hypothesis: the synthesized equity research Thesis remains supported by reviewable evidence during the evaluation period; no investment recommendation is asserted.',
      evaluationPeriod: request.evaluationPeriod,
      metrics: { workflow: 'equity-research', completedStepCount: states.filter((state) => state.status === 'completed').length + 1, evidenceCount: evidence.length },
    })
    const report: EquityResearchReport = {
      skillId: 'equity-research',
      workflowId: 'equity-research',
      subject: `${request.companyName} (${request.symbol})`,
      symbol: request.symbol,
      question: request.question,
      asOf: request.asOf,
      template: 'equity-research-workflow-report',
      sections: reportSections,
      evidence: reportEvidence,
      keyRisks: [...new Set(risks)],
      openQuestions: [...new Set(Object.values(outputs).flatMap((output) => 'openQuestions' in output ? output.openQuestions : []))],
      thesisId: thesis.id,
      predictionId: prediction.id,
    }
    return { evidence, thesis, prediction, report }
  }
}

function validateInput(input: EquityResearchWorkflowInput): EquityResearchWorkflowInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('equity research workflow input must be an object')
  assertNonEmptyString(input.symbol, '$.symbol')
  if (!/^\d{6}$/.test(input.symbol.trim())) throw new TypeError('$.symbol must be a six-digit symbol')
  assertNonEmptyString(input.companyName, '$.companyName')
  assertNonEmptyString(input.industry, '$.industry')
  assertNonEmptyString(input.geography, '$.geography')
  assertNonEmptyString(input.question, '$.question')
  assertNonEmptyString(input.sessionId, '$.sessionId')
  assertTimestamp(input.asOf, '$.asOf')
  assertTimestamp(input.createdAt, '$.createdAt')
  assertNonEmptyString(input.earningsPeriod, '$.earningsPeriod')
  if (!input.valuation || !Array.isArray(input.valuation.forecasts) || input.valuation.forecasts.length === 0) throw new TypeError('$.valuation.forecasts must be a non-empty array')
  return { ...input, symbol: input.symbol.trim().toUpperCase(), companyName: input.companyName.trim(), industry: input.industry.trim(), geography: input.geography.trim(), question: input.question.trim(), sessionId: input.sessionId.trim(), earningsPeriod: input.earningsPeriod.trim() }
}

type ReportStageOutput = IndustryResearchResult | EquityResearchResult | EarningsReviewResult | ValuationResult

function averageConfidence(output: ReportStageOutput): number {
  if (output.evidence.length === 0) return 0.5
  return output.evidence.reduce((sum, item) => sum + item.confidence, 0) / output.evidence.length
}

function companySection(output: EquityResearchStepOutputMap['company-understanding']): EquityResearchReportSection {
  return {
    stepId: 'company-understanding',
    skillId: 'company-research',
    id: 'company-understanding',
    title: 'Company Understanding',
    findings: [output.artifacts.thesis.statement],
    evidenceIds: output.artifacts.evidence.map((item) => item.id),
  }
}

function reportSectionsFor(stepId: Exclude<EquityResearchStepId, 'company-understanding' | 'investment-thesis-generation'>, output: ReportStageOutput, evidenceIds: string[]): EquityResearchReportSection[] {
  return output.sections.map((section) => ({
    stepId,
    skillId: output.skillId,
    id: section.id,
    title: section.title,
    findings: [...section.findings],
    evidenceIds,
  }))
}
