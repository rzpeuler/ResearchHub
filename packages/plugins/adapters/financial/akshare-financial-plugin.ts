import { type FinancialDataMetadata } from '../../core/index.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import { requireHttpEndpoint, safePluginMessage } from '../market-types.ts'
import { FinancialPluginError } from './errors.ts'
import {
  buildFinancialData,
  normalizeFinancialRequest,
  readOptionalField,
  readRequiredField,
  validateFinancialData,
  type NormalizedFinancialRow,
} from './normalization.ts'
import { readAkShareRows, readFinancialJson } from './transport-helpers.ts'
import type { FinancialData, FinancialDataPlugin, FinancialStatementType } from './types.ts'

export interface AkShareFinancialPluginOptions {
  readonly endpoint?: string
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
}

/** AkShare bridge adapter. The bridge keeps the Python-side SDK outside this TypeScript package. */
export class AkShareFinancialPlugin implements FinancialDataPlugin {
  readonly name = 'akshare-financial'

  private readonly endpoint: string
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date

  constructor(options: AkShareFinancialPluginOptions = {}) {
    this.endpoint = requireHttpEndpoint(options.endpoint, this.name)
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(request: Parameters<FinancialDataPlugin['fetch']>[0]) {
    const normalized = normalizeFinancialRequest(request)
    const body = {
      symbol: normalized.symbol,
      statementTypes: normalized.statementTypes,
      periodType: normalized.periodType,
    }
    let payload: unknown
    try {
      const response = await this.transport.request(this.endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      payload = await readFinancialJson(response, this.name, [this.endpoint])
    } catch (cause) {
      if (cause instanceof FinancialPluginError) throw cause
      throw new FinancialPluginError(
        `${this.name} request failed: ${safePluginMessage(cause, this.endpoint)}`,
        cause,
      )
    }

    const normalizedRows = readAkShareRows(payload, this.name)
      .map(row => normalizeAkShareRow(row, normalized.symbol, this.clock))
      .filter(row => normalized.statementTypes.includes(row.statementType))
    const rows = normalized.statementTypes.map((statementType) => normalizedRows.find(row => row.statementType === statementType)).filter((row): row is NormalizedFinancialRow => row !== undefined)
    const data = buildFinancialData(rows)
    if (data.symbol !== normalized.symbol || data.statements.length !== normalized.statementTypes.length) {
      throw new FinancialPluginError('akshare-financial response did not contain the requested statements')
    }
    const firstSource = data.statements[0]?.source
    if (firstSource === undefined) {
      throw new FinancialPluginError('akshare-financial response did not contain source metadata')
    }
    const metadata: FinancialDataMetadata = {
      plugin: this.name,
      source: firstSource.source,
      timestamp: firstSource.retrievedAt,
      quality: firstSource.quality,
      confidence: firstSource.confidence,
    }
    return { data, metadata }
  }

  validate(value: unknown): asserts value is FinancialData {
    validateFinancialData(value)
  }
}

function normalizeAkShareRow(
  row: Record<string, unknown>,
  requestedSymbol: string,
  clock: () => Date,
): NormalizedFinancialRow {
  const symbol = String(readOptionalField(row, ['symbol', 'code', '股票代码']) ?? requestedSymbol).replace(/\.(?:SH|SZ|BJ)$/i, '')
  if (symbol !== requestedSymbol) {
    throw new FinancialPluginError('akshare-financial response symbol does not match the request')
  }
  const statementType = statementTypeFor(row)
  const retrievedAt = clock()
  if (!(retrievedAt instanceof Date) || Number.isNaN(retrievedAt.getTime())) {
    throw new FinancialPluginError('invalid plugin clock timestamp')
  }
  return {
    statementType,
    symbol,
    period: String(readRequiredField(row, ['period', 'end_date', '报告期', '日期'], 'period')),
    reportDate: readOptionalField(row, ['report_date', '公告日期', 'ann_date']) as string | undefined,
    currency: 'CNY',
    unit: 'CNY',
    values: row,
    plugin: 'akshare-financial',
    source: 'akshare',
    retrievedAt: retrievedAt.toISOString(),
    quality: 'medium',
    confidence: 0.8,
  }
}

function statementTypeFor(row: Record<string, unknown>): FinancialStatementType {
  const raw = readOptionalField(row, ['statementType', 'statement_type', 'statement', '报表类型'])
  if (raw === 'income' || raw === 'balance-sheet' || raw === 'cash-flow') return raw
  throw new FinancialPluginError('akshare-financial response is missing statement type')
}
