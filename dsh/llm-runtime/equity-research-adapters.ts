import {
  createEvidence,
  createPrediction,
  createThesis,
  type Evidence,
  type Prediction,
} from '../../packages/artifacts/index.ts'
import type { CompanyResearchInput, CompanyResearchResult } from '../../packages/skills/company-research/types.ts'
import type { EarningsReviewInput, EarningsReviewResult, EarningsVariance } from '../../packages/skills/earnings-review/types.ts'
import type { EquityResearchInput, EquityResearchResult } from '../../packages/skills/equity-research/types.ts'
import type { IndustryResearchInput, IndustryResearchResult, IndustryPeerRecord } from '../../packages/skills/industry-research/types.ts'
import type { ValuationInput, ValuationPeer, ValuationResult, ValuationStatistic, DcfResult } from '../../packages/skills/valuation/types.ts'
import type { ResearchReport, ResearchSection } from '../../packages/skills/shared/research-report.ts'
import type {
  EquityResearchArtifactIdFactory,
  EquityResearchSkillAdapters,
} from '../../packages/workflows/equity-research/types.ts'
import { LlmSkillAdapter } from './skill-adapter.ts'
import type { LlmSkillResponse, LlmSkillRuntimeOptions } from './types.ts'

export interface LlmEquityResearchAdapterOptions extends LlmSkillRuntimeOptions {
  artifactIdFactory: EquityResearchArtifactIdFactory
}

export function createLlmEquityResearchAdapters(options: LlmEquityResearchAdapterOptions): EquityResearchSkillAdapters {
  const adapter = new LlmSkillAdapter(options)
  return {
    companyResearch: (input, context) => adapter.execute('company-research', input, context, (response, value) => companyResult(response, value, options.artifactIdFactory)),
    industryResearch: (input, context) => adapter.execute('industry-research', input, context, (response, value) => industryResult(response, value)),
    equityResearch: (input, context) => adapter.execute('equity-research', input, context, (response, value) => equityResult(response, value)),
    earningsReview: (input, context) => adapter.execute('earnings-review', input, context, (response, value) => earningsResult(response, value)),
    valuation: (input, context) => adapter.execute('valuation', input, context, (response, value) => valuationResult(response, value)),
  }
}

function companyResult(response: LlmSkillResponse, input: CompanyResearchInput, artifactIdFactory: EquityResearchArtifactIdFactory): CompanyResearchResult {
  const evidence = response.evidence.map((item, index) => createEvidence({
    id: artifactIdFactory('evidence', index),
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: { skill: 'company-research', llmEvidenceId: item.id, details: JSON.stringify(item.details) },
    source: item.source,
    content: item.claim,
    timestamp: item.asOf,
    confidence: item.confidence,
  }))
  const thesis = createThesis({
    id: artifactIdFactory('thesis', 0),
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: { skill: 'company-research', runtime: 'llm' },
    statement: response.summary,
    evidenceIds: evidence.map((item) => item.id),
    confidence: averageConfidence(evidence),
    risks: response.keyRisks,
  })
  const prediction: Prediction = createPrediction({
    id: artifactIdFactory('prediction', 0),
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: { skill: 'company-research', runtime: 'llm' },
    thesisId: thesis.id,
    expectation: `Review whether the LLM-generated Company Research thesis remains supported during the evaluation period: ${response.summary}`,
    evaluationPeriod: input.evaluationPeriod,
    metrics: { validation_metric: 'llm_company_research_review', evidenceCount: evidence.length, findingCount: response.findings.length },
  })
  return { status: 'success', symbol: input.symbol, artifacts: { evidence, thesis, prediction } }
}

function industryResult(response: LlmSkillResponse, input: IndustryResearchInput): IndustryResearchResult {
  return {
    ...baseReport(response, 'industry-research', input.asOf, ['market-overview', 'industry-structure', 'competitive-landscape', 'valuation-context', 'investment-implications'] as const),
    skillId: 'industry-research',
    subject: response.subject || `${input.industry} - ${input.geography}`,
    peerMetrics: parseIndustryPeers(response.data?.peerMetrics),
  }
}

function equityResult(response: LlmSkillResponse, input: EquityResearchInput): EquityResearchResult {
  return {
    ...baseReport(response, 'equity-research', input.asOf, ['business-understanding', 'industry-position', 'competitive-advantage', 'financial-quality', 'growth-drivers', 'risk-analysis'] as const),
    skillId: 'equity-research',
    subject: response.subject || `${input.companyName} (${input.symbol})`,
    thesis: {
      statement: response.summary,
      drivers: response.findings,
      risks: response.keyRisks,
      evidenceIds: response.evidence.map((item) => item.id),
    },
  }
}

function earningsResult(response: LlmSkillResponse, input: EarningsReviewInput): EarningsReviewResult {
  const data = response.data
  return {
    ...baseReport(response, 'earnings-review', input.asOf, ['results-snapshot', 'beat-miss', 'guidance', 'thesis-impact', 'sources'] as const),
    skillId: 'earnings-review',
    subject: response.subject || `${input.companyName} ${input.period}`,
    variances: parseEarningsVariances(data?.variances),
    guidance: parseEnum(data?.guidance, ['raised', 'maintained', 'lowered', 'not-provided'] as const, 'not-provided'),
    thesisImpact: parseEnum(data?.thesisImpact, ['positive', 'negative', 'neutral', 'undetermined'] as const, 'undetermined'),
  }
}

function valuationResult(response: LlmSkillResponse, input: ValuationInput): ValuationResult {
  return {
    ...baseReport(response, 'valuation', input.asOf, ['peer-selection', 'operating-benchmarks', 'dcf', 'cross-checks', 'risks'] as const),
    skillId: 'valuation',
    subject: response.subject || `${input.companyName} (${input.symbol})`,
    peers: parseValuationPeers(response.data?.peers),
    statistics: parseValuationStatistics(response.data?.statistics),
    dcf: parseDcf(response.data?.dcf),
  }
}

function baseReport<T extends string>(response: LlmSkillResponse, skillId: string, asOf: string, sectionIds: readonly T[]): Omit<ResearchReport, 'sections'> & { sections: Array<ResearchSection & { id: T }> } {
  const evidence = response.evidence.map((item) => ({ ...item }))
  return {
    skillId,
    subject: response.subject,
    asOf: response.asOf || asOf,
    template: `llm-${skillId}-report`,
    sections: sectionIds.map((id, index) => ({
      id,
      title: titleCase(id),
      findings: [response.findings[index % Math.max(response.findings.length, 1)] ?? response.summary],
      evidenceIds: evidence.map((item) => item.id),
    } as ResearchSection & { id: T })),
    evidence,
    keyRisks: response.keyRisks,
    openQuestions: response.openQuestions,
  }
}

function parseIndustryPeers(value: unknown): IndustryPeerRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).filter((item) => typeof item.name === 'string' && typeof item.source === 'string' && typeof item.asOf === 'string').map((item) => ({
    name: item.name as string,
    source: item.source as string,
    asOf: item.asOf as string,
    revenueGrowth: numberOrUndefined(item.revenueGrowth),
    ebitdaMargin: numberOrUndefined(item.ebitdaMargin),
    marketShare: numberOrUndefined(item.marketShare),
    valuationMultiple: numberOrUndefined(item.valuationMultiple),
  }))
}

function parseEarningsVariances(value: unknown): EarningsVariance[] {
  if (!Array.isArray(value)) return []
  const metrics = ['revenue', 'eps', 'grossMargin', 'operatingMargin'] as const
  const statuses = ['beat', 'miss', 'inline', 'unavailable'] as const
  return value.filter(isRecord).filter((item) => metrics.includes(item.metric as typeof metrics[number]) && statuses.includes(item.status as typeof statuses[number])).map((item) => ({
    metric: item.metric as EarningsVariance['metric'],
    actual: numberOrUndefined(item.actual),
    consensus: numberOrUndefined(item.consensus),
    variance: numberOrUndefined(item.variance),
    status: item.status as EarningsVariance['status'],
  }))
}

function parseValuationPeers(value: unknown): ValuationPeer[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).filter((item) => typeof item.symbol === 'string' && typeof item.name === 'string' && typeof item.source === 'string' && typeof item.asOf === 'string').map((item) => ({
    symbol: item.symbol as string,
    name: item.name as string,
    source: item.source as string,
    asOf: item.asOf as string,
    evRevenue: numberOrUndefined(item.evRevenue),
    evEbitda: numberOrUndefined(item.evEbitda),
    pe: numberOrUndefined(item.pe),
    revenueGrowth: numberOrUndefined(item.revenueGrowth),
    ebitdaMargin: numberOrUndefined(item.ebitdaMargin),
  }))
}

function parseValuationStatistics(value: unknown): ValuationStatistic[] {
  if (!Array.isArray(value)) return []
  const metrics = ['evRevenue', 'evEbitda', 'pe', 'revenueGrowth', 'ebitdaMargin'] as const
  return value.filter(isRecord).filter((item) => metrics.includes(item.metric as typeof metrics[number]) && typeof item.count === 'number').map((item) => ({
    metric: item.metric as ValuationStatistic['metric'],
    count: item.count as number,
    min: numberOrUndefined(item.min),
    percentile25: numberOrUndefined(item.percentile25),
    median: numberOrUndefined(item.median),
    percentile75: numberOrUndefined(item.percentile75),
    max: numberOrUndefined(item.max),
  }))
}

function parseDcf(value: unknown): DcfResult {
  if (!isRecord(value)) return { enterpriseValue: 0, equityValue: 0, impliedSharePrice: 0, presentValueOfForecasts: 0, presentValueOfTerminalValue: 0, terminalValueShare: 0, sensitivity: [] }
  return {
    enterpriseValue: numberOrZero(value.enterpriseValue),
    equityValue: numberOrZero(value.equityValue),
    impliedSharePrice: numberOrZero(value.impliedSharePrice),
    presentValueOfForecasts: numberOrZero(value.presentValueOfForecasts),
    presentValueOfTerminalValue: numberOrZero(value.presentValueOfTerminalValue),
    terminalValueShare: numberOrZero(value.terminalValueShare),
    sensitivity: Array.isArray(value.sensitivity) ? value.sensitivity.filter(isRecord).filter((item) => typeof item.wacc === 'number' && typeof item.terminalGrowth === 'number' && typeof item.impliedSharePrice === 'number').map((item) => ({ wacc: item.wacc as number, terminalGrowth: item.terminalGrowth as number, impliedSharePrice: item.impliedSharePrice as number })) : [],
  }
}

function parseEnum<const T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberOrZero(value: unknown): number {
  return numberOrUndefined(value) ?? 0
}

function averageConfidence(evidence: Evidence[]): number {
  return evidence.reduce((total, item) => total + item.confidence, 0) / evidence.length
}

function titleCase(value: string): string {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
