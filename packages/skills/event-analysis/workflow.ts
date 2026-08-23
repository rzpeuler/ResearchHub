import {
  createEvidence,
  createPrediction,
  createThesis,
  assertNonEmptyString,
  assertTimestamp,
  type Evidence,
  type Prediction,
  type Thesis,
} from '../../artifacts/index.ts'
import { type MarketPlugin, type MarketSnapshot } from '../../plugins/market/index.ts'
import { type NewsPlugin, type NewsEvidence } from '../../plugins/news/index.ts'
import { type FinancialPlugin, createFinancialEvidence } from '../../plugins/financial/index.ts'
import type { ArtifactIdFactory, EventAnalysisInput, EventAnalysisResult } from './types.ts'

type MarketPluginPort = Pick<MarketPlugin, 'get_market_snapshot'>
type NewsPluginPort = Pick<NewsPlugin, 'search_company_news'>
type FinancialPluginPort = Pick<FinancialPlugin, 'get_financial_snapshot'>

export interface EventAnalysisWorkflowOptions {
  marketPlugin: MarketPluginPort
  newsPlugin: NewsPluginPort
  announcementPlugin?: NewsPluginPort
  mediaPlugin?: NewsPluginPort
  financialPlugin?: FinancialPluginPort
  artifactIdFactory: ArtifactIdFactory
}

/** Orchestrates plugins into a neutral, structured research artifact bundle. */
export class EventAnalysisWorkflow {
  constructor(private readonly options: EventAnalysisWorkflowOptions) {}

  async run(input: EventAnalysisInput): Promise<EventAnalysisResult> {
    const normalized = validateInput(input)
    const marketSnapshot = await this.options.marketPlugin.get_market_snapshot({ symbol: normalized.symbol })

    let evidenceOrdinal = 0
    const evidence: Evidence[] = [createMarketEvidence(
      this.options.artifactIdFactory('evidence', evidenceOrdinal++),
      normalized,
      marketSnapshot,
    )]

    if (this.options.announcementPlugin !== undefined
      && this.options.mediaPlugin !== undefined
      && this.options.financialPlugin !== undefined) {
      const announcementResult = await this.options.announcementPlugin.search_company_news({ symbol: normalized.symbol })
      evidence.push(...announcementResult.items.map((item) => createNewsEvidence(
        this.options.artifactIdFactory('evidence', evidenceOrdinal++),
        normalized,
        item,
      )))

      const mediaResult = await this.options.mediaPlugin.search_company_news({ symbol: normalized.symbol })
      evidence.push(...mediaResult.items.map((item) => createNewsEvidence(
        this.options.artifactIdFactory('evidence', evidenceOrdinal++),
        normalized,
        item,
      )))

      const financialSnapshot = await this.options.financialPlugin.get_financial_snapshot({ symbol: normalized.symbol })
      const financialEvidence = createFinancialEvidence(financialSnapshot, {
        sessionId: normalized.sessionId,
        createdAt: normalized.createdAt,
        idFactory: (_kind, ordinal) => this.options.artifactIdFactory('evidence', evidenceOrdinal + ordinal),
      })
      evidence.push(...financialEvidence)
      evidenceOrdinal += financialEvidence.length
    } else {
      const newsResult = await this.options.newsPlugin.search_company_news({ symbol: normalized.symbol })
      evidence.push(...newsResult.items.map((item) => createNewsEvidence(
        this.options.artifactIdFactory('evidence', evidenceOrdinal++),
        normalized,
        item,
      )))
    }

    const thesis: Thesis = createThesis({
      id: this.options.artifactIdFactory('thesis', 0),
      createdAt: normalized.createdAt,
      sessionId: normalized.sessionId,
      metadata: { symbol: normalized.symbol, workflow: 'event-analysis' },
      statement: `Collected market and company-news evidence for ${normalized.symbol}; causal interpretation requires further review.`,
      evidenceIds: evidence.map((item) => item.id),
      confidence: 0.5,
      risks: ['Evidence is deterministic mock data.', 'Causal attribution requires further validation.'],
    })

    const prediction: Prediction = createPrediction({
      id: this.options.artifactIdFactory('prediction', 0),
      createdAt: normalized.createdAt,
      sessionId: normalized.sessionId,
      metadata: { symbol: normalized.symbol, workflow: 'event-analysis' },
      thesisId: thesis.id,
      expectation: 'Hypothesis: the collected evidence set remains the accepted explanation during the specified evaluation period; no directional outcome is asserted.',
      evaluationPeriod: normalized.evaluationPeriod,
      metrics: { validation_metric: 'evidence_review', evidenceCount: evidence.length },
    })

    return {
      status: 'success',
      symbol: normalized.symbol,
      artifacts: { evidence, thesis, prediction },
    }
  }
}

function validateInput(input: unknown): EventAnalysisInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('event analysis input must be an object')
  }

  const record = input as Record<string, unknown>
  assertNonEmptyString(record.symbol, '$.symbol')
  const symbol = record.symbol.trim().toUpperCase()
  assertNonEmptyString(record.sessionId, '$.sessionId')
  assertTimestamp(record.createdAt, '$.createdAt')

  if (record.evaluationPeriod === null || typeof record.evaluationPeriod !== 'object' || Array.isArray(record.evaluationPeriod)) {
    throw new TypeError('event analysis evaluationPeriod must be an object')
  }

  const evaluationPeriod = record.evaluationPeriod as Record<string, unknown>
  assertTimestamp(evaluationPeriod.start, '$.evaluationPeriod.start')
  assertTimestamp(evaluationPeriod.end, '$.evaluationPeriod.end')
  if (Date.parse(evaluationPeriod.start) > Date.parse(evaluationPeriod.end)) {
    throw new RangeError('evaluation period start must not be after end')
  }

  return {
    symbol,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    evaluationPeriod: { start: evaluationPeriod.start, end: evaluationPeriod.end },
  }
}

function createMarketEvidence(id: string, input: EventAnalysisInput, snapshot: MarketSnapshot): Evidence {
  return createEvidence({
    id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: { symbol: input.symbol, plugin: 'get_market_snapshot' },
    source: 'market-plugin',
    content: JSON.stringify(snapshot),
    timestamp: input.createdAt,
    confidence: 0.5,
  })
}

function createNewsEvidence(id: string, input: EventAnalysisInput, item: NewsEvidence): Evidence {
  return createEvidence({
    id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    metadata: { symbol: input.symbol, plugin: 'search_company_news' },
    source: item.source,
    content: `${item.headline}: ${item.content}`,
    timestamp: item.timestamp,
    confidence: item.confidence,
  })
}
