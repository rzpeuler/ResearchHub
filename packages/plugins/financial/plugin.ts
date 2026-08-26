import { createEvidence, type Evidence } from '../../artifacts/evidence/index.ts'
import type { PluginHandle, PluginRegistry } from '../../plugins/index.ts'
import { validateFinancialData, type FinancialData, type FinancialDataRequest } from '../../plugins/adapters/financial/index.ts'
import {
  PluginExecutionError,
  type PluginDefinition,
} from '../core/index.ts'

export interface FinancialSnapshotInput {
  symbol: string
}

export type FinancialSnapshot = FinancialData & {
  plugin: string
  source: string
  timestamp: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}

export type FinancialPluginHandle = PluginHandle<FinancialDataRequest, FinancialData>

export const financialSnapshotDefinition: PluginDefinition<FinancialSnapshotInput, FinancialSnapshot> = {
  name: 'get_financial_snapshot',
  description: 'Return structured reported financial statements and metrics for an A-share symbol.',
  inputSchema: {
    symbol: { type: 'string', required: true, description: 'Six-digit A-share stock symbol.' },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      symbol: { type: 'string', required: true },
      statements: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
      metrics: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
      plugin: { type: 'string', required: true },
      source: { type: 'string', required: true },
      timestamp: { type: 'string', required: true },
      quality: { type: 'string', required: true },
      confidence: { type: 'number', required: true },
    },
  },
}

export function normalizeFinancialSnapshotInput(input: FinancialSnapshotInput): FinancialSnapshotInput {
  if (input === null || typeof input !== 'object' || typeof input.symbol !== 'string') {
    throw new TypeError('get_financial_snapshot input must contain a symbol string')
  }
  const symbol = input.symbol.trim().toUpperCase()
  if (!/^\d{6}$/.test(symbol)) {
    throw new TypeError('get_financial_snapshot symbol must be a six-digit A-share symbol')
  }
  return { symbol }
}

export class FinancialPlugin {
  readonly definition = financialSnapshotDefinition

  constructor(
    private readonly registry: PluginRegistry,
    private readonly pluginHandle: FinancialPluginHandle,
  ) {}

  async get_financial_snapshot(input: FinancialSnapshotInput): Promise<FinancialSnapshot> {
    const normalizedInput = normalizeFinancialSnapshotInput(input)
    try {
      const plugin = this.registry.get(this.pluginHandle)
      const result = await plugin.fetch({ symbol: normalizedInput.symbol })
      validateFinancialData(result.data)
      if (result.data.symbol !== normalizedInput.symbol) {
        throw new TypeError('get_financial_snapshot Plugin result symbol must match the request')
      }
      return {
        ...result.data,
        plugin: result.metadata.plugin,
        source: result.metadata.source,
        timestamp: result.metadata.timestamp,
        quality: result.metadata.quality,
        confidence: result.metadata.confidence,
      }
    } catch (cause) {
      throw new PluginExecutionError({
        operationName: this.definition.name,
        pluginName: this.pluginHandle.name,
        input: normalizedInput,
        cause,
      })
    }
  }
}

export interface FinancialEvidenceOptions {
  sessionId: string
  createdAt: string
  idFactory?: (kind: 'financial-statement' | 'financial-metric', ordinal: number) => string
}

/** Converts reported metrics to Evidence; it deliberately does not write Memory or produce a thesis. */
export function createFinancialEvidence(snapshot: FinancialSnapshot | FinancialData, options: FinancialEvidenceOptions): Evidence[] {
  const idFactory = options.idFactory ?? ((kind, ordinal) => `financial-${kind}-${ordinal + 1}`)
  return snapshot.metrics.map((metric, index) => createEvidence({
    id: idFactory('financial-metric', index),
    createdAt: options.createdAt,
    sessionId: options.sessionId,
    metadata: {
      symbol: snapshot.symbol,
      metric: metric.name,
      period: { start: metric.period.start, end: metric.period.end, periodType: metric.period.periodType },
      plugin: metric.source.plugin,
      sourceStatementIds: metric.sourceStatementIds,
    },
    source: metric.source.source,
    content: JSON.stringify({
      symbol: snapshot.symbol,
      metric: metric.name,
      value: metric.value,
      unit: metric.unit,
      period: metric.period,
      calculationBasis: metric.calculationBasis,
    }),
    timestamp: metric.source.publishedAt ?? metric.source.retrievedAt,
    confidence: metric.confidence,
  }))
}
