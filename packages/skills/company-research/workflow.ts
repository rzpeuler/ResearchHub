import {
  assertNonEmptyString,
  assertTimestamp,
  createEvidence,
  createPrediction,
  createThesis,
  type Evidence,
  type Prediction,
  type Thesis,
} from '../../artifacts/index.ts'
import type { FinancialCapability } from '../../capabilities/financial/index.ts'
import type { MarketCapability, MarketSnapshot } from '../../capabilities/market/index.ts'
import type { NewsCapability, NewsEvidence } from '../../capabilities/news/index.ts'
import { createFinancialEvidence } from '../../capabilities/financial/index.ts'
import type {
  CompanyResearchArtifactIdFactory,
  CompanyResearchInput,
  CompanyResearchResult,
} from './types.ts'

type MarketCapabilityPort = Pick<MarketCapability, 'get_market_snapshot'>
type InformationCapabilityPort = Pick<NewsCapability, 'search_company_news'>
type FinancialCapabilityPort = Pick<FinancialCapability, 'get_financial_snapshot'>

export interface CompanyResearchWorkflowOptions {
  marketCapability: MarketCapabilityPort
  informationCapability: InformationCapabilityPort
  financialCapability: FinancialCapabilityPort
  artifactIdFactory: CompanyResearchArtifactIdFactory
}

const researchModules = [
  'business-understanding',
  'industry-position',
  'competitive-advantage',
  'growth-drivers',
  'financial-quality',
  'capital-allocation',
  'risk-analysis',
] as const

/** Executes the Company Research methodology through injected Capabilities. */
export class CompanyResearchWorkflow {
  constructor(private readonly options: CompanyResearchWorkflowOptions) {}

  async run(input: CompanyResearchInput): Promise<CompanyResearchResult> {
    const normalized = validateInput(input)
    const marketSnapshot = await this.options.marketCapability.get_market_snapshot({ symbol: normalized.symbol })
    const informationResult = await this.options.informationCapability.search_company_news({ symbol: normalized.symbol })
    const financialSnapshot = await this.options.financialCapability.get_financial_snapshot({ symbol: normalized.symbol })

    let evidenceOrdinal = 0
    const evidence: Evidence[] = [createMarketEvidence(
      this.options.artifactIdFactory('evidence', evidenceOrdinal++),
      normalized,
      marketSnapshot,
    )]

    evidence.push(...informationResult.items.map((item) => createInformationEvidence(
      this.options.artifactIdFactory('evidence', evidenceOrdinal++),
      normalized,
      item,
    )))

    const financialEvidence = createFinancialEvidence(financialSnapshot, {
      sessionId: normalized.sessionId,
      createdAt: normalized.createdAt,
      idFactory: (_kind, ordinal) => this.options.artifactIdFactory('evidence', evidenceOrdinal + ordinal),
    }).map((item) => ({
      ...item,
      metadata: { ...item.metadata, researchArea: 'financial-quality' },
    }))
    evidence.push(...financialEvidence)

    const thesis: Thesis = createThesis({
      id: this.options.artifactIdFactory('thesis', 0),
      createdAt: normalized.createdAt,
      sessionId: normalized.sessionId,
      metadata: {
        symbol: normalized.symbol,
        skill: 'company-research',
        workflow: 'company-research',
        modules: [...researchModules],
      },
      statement: `Company research evidence for ${normalized.symbol} covers business context, industry position, competitive advantage, growth, financial quality, capital allocation, and risk; durable conclusions require continued review.`,
      evidenceIds: evidence.map((item) => item.id),
      confidence: 0.5,
      risks: [
        'The MVP uses the available Market, Information, and Financial Capability evidence only.',
        'Long-term competitive advantage and growth assumptions require future period review.',
      ],
    })

    const prediction: Prediction = createPrediction({
      id: this.options.artifactIdFactory('prediction', 0),
      createdAt: normalized.createdAt,
      sessionId: normalized.sessionId,
      metadata: {
        symbol: normalized.symbol,
        skill: 'company-research',
        workflow: 'company-research',
      },
      thesisId: thesis.id,
      expectation: 'Hypothesis: the company-research Thesis remains supported by observable business, information, and financial facts during the evaluation period; no investment recommendation is asserted.',
      evaluationPeriod: normalized.evaluationPeriod,
      metrics: {
        validation_metric: 'company_research_evidence_review',
        evidenceCount: evidence.length,
        moduleCount: researchModules.length,
      },
    })

    return {
      status: 'success',
      symbol: normalized.symbol,
      artifacts: { evidence, thesis, prediction },
    }
  }
}

function validateInput(input: unknown): CompanyResearchInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('company research input must be an object')
  }

  const record = input as Record<string, unknown>
  assertNonEmptyString(record.symbol, '$.symbol')
  const symbol = record.symbol.trim().toUpperCase()
  if (!/^\d{6}$/.test(symbol)) throw new TypeError('company research symbol must be a six-digit A-share symbol')
  assertNonEmptyString(record.sessionId, '$.sessionId')
  assertTimestamp(record.createdAt, '$.createdAt')

  if (record.evaluationPeriod === null || typeof record.evaluationPeriod !== 'object' || Array.isArray(record.evaluationPeriod)) {
    throw new TypeError('company research evaluationPeriod must be an object')
  }
  const evaluationPeriod = record.evaluationPeriod as Record<string, unknown>
  assertTimestamp(evaluationPeriod.start, '$.evaluationPeriod.start')
  assertTimestamp(evaluationPeriod.end, '$.evaluationPeriod.end')
  if (Date.parse(evaluationPeriod.start) > Date.parse(evaluationPeriod.end)) {
    throw new RangeError('company research evaluation period start must not be after end')
  }

  return {
    symbol,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    evaluationPeriod: { start: evaluationPeriod.start, end: evaluationPeriod.end },
  }
}

function createMarketEvidence(id: string, input: CompanyResearchInput, snapshot: MarketSnapshot): Evidence {
  return createEvidence({
    id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: {
      symbol: input.symbol,
      provider: snapshot.source,
      quality: snapshot.quality,
      confidence: snapshot.confidence,
      capability: 'get_market_snapshot',
      researchArea: 'industry-position',
    },
    source: snapshot.source,
    content: JSON.stringify(snapshot),
    timestamp: snapshot.timestamp,
    confidence: snapshot.confidence,
  })
}

function createInformationEvidence(id: string, input: CompanyResearchInput, item: NewsEvidence): Evidence {
  return createEvidence({
    id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: {
      symbol: input.symbol,
      provider: item.source,
      quality: 'medium',
      confidence: item.confidence,
      capability: 'search_company_news',
      researchArea: 'business-understanding',
    },
    source: item.source,
    content: `${item.headline}: ${item.content}`,
    timestamp: item.timestamp,
    confidence: item.confidence,
  })
}
