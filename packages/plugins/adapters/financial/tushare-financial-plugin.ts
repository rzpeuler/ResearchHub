import { type FinancialDataMetadata } from '../../core/index.ts'
import { DEFAULT_TUSHARE_ENDPOINT } from '../../config.ts'
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
import { readFinancialJson, readTushareRows } from './transport-helpers.ts'
import type { FinancialData, FinancialDataPlugin, FinancialStatementType } from './types.ts'

export interface TushareFinancialPluginOptions {
  readonly endpoint?: string
  readonly token?: string
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
}

/** Tushare adapter; it only maps documented statement responses into ResearchHub's schema. */
export class TushareFinancialPlugin implements FinancialDataPlugin {
  readonly name = 'tushare-financial'

  private readonly endpoint: string
  private readonly token: string | undefined
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date

  constructor(options: TushareFinancialPluginOptions = {}) {
    this.endpoint = requireHttpEndpoint(options.endpoint ?? DEFAULT_TUSHARE_ENDPOINT, this.name)
    this.token = options.token?.trim() || undefined
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(request: Parameters<FinancialDataPlugin['fetch']>[0]) {
    const normalized = normalizeFinancialRequest(request)
    if (this.token === undefined) {
      throw new FinancialPluginError('tushare-financial plugin is unavailable: TUSHARE_TOKEN is not configured')
    }

    const rows: NormalizedFinancialRow[] = []
    for (const statementType of normalized.statementTypes) {
      const response = await this.requestStatement(normalized.symbol, statementType)
      const sourceRows = readTushareRows(response, this.name, [this.token, this.endpoint])
      const latestRow = sourceRows[0]
      if (latestRow === undefined) {
        throw new FinancialPluginError(`${this.name} response is empty for ${statementType}`)
      }
      rows.push(normalizeTushareRow(latestRow, normalized.symbol, statementType, this.clock))
    }
    const data = buildFinancialData(rows)
    if (data.symbol !== normalized.symbol || data.statements.length !== normalized.statementTypes.length) {
      throw new FinancialPluginError('tushare-financial response did not contain the requested statements')
    }
    const firstSource = data.statements[0]?.source
    if (firstSource === undefined) {
      throw new FinancialPluginError('tushare-financial response did not contain source metadata')
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

  private async requestStatement(symbol: string, statementType: FinancialStatementType): Promise<unknown> {
    const body = {
      api_name: apiNameFor(statementType),
      token: this.token,
      params: { ts_code: toTushareCode(symbol) },
    }
    try {
      const response = await this.transport.request(this.endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await readFinancialJson(response, this.name, [this.token, this.endpoint])
    } catch (cause) {
      if (cause instanceof FinancialPluginError) {
        throw cause
      }
      throw new FinancialPluginError(
        `${this.name} request failed: ${safePluginMessage(cause, [this.token, this.endpoint])}`,
        cause,
      )
    }
  }
}

function normalizeTushareRow(
  row: Record<string, unknown>,
  symbol: string,
  statementType: FinancialStatementType,
  clock: () => Date,
): NormalizedFinancialRow {
  const responseSymbol = String(readOptionalField(row, ['ts_code', 'symbol', 'code']) ?? symbol)
  if (toSixDigitSymbol(responseSymbol) !== symbol) {
    throw new FinancialPluginError('tushare-financial response symbol does not match the request')
  }
  const retrievedAt = clock()
  if (!(retrievedAt instanceof Date) || Number.isNaN(retrievedAt.getTime())) {
    throw new FinancialPluginError('invalid plugin clock timestamp')
  }
  return {
    statementType,
    symbol,
    period: String(readRequiredField(row, ['end_date', 'period', 'report_date'], 'period')),
    reportDate: readOptionalField(row, ['ann_date', 'f_ann_date', 'report_date']) as string | undefined,
    currency: 'CNY',
    unit: 'CNY',
    values: row,
    plugin: 'tushare-financial',
    source: 'tushare',
    retrievedAt: retrievedAt.toISOString(),
    quality: 'high',
    confidence: 0.9,
  }
}

function apiNameFor(statementType: FinancialStatementType): string {
  switch (statementType) {
    case 'income': return 'income'
    case 'balance-sheet': return 'balancesheet'
    case 'cash-flow': return 'cashflow'
  }
}

function toTushareCode(symbol: string): string {
  if (/^\d{6}\.(?:SH|SZ|BJ)$/.test(symbol)) {
    return symbol
  }
  if (/^(?:6|68)/.test(symbol)) return `${symbol}.SH`
  if (/^(?:0|2|3)/.test(symbol)) return `${symbol}.SZ`
  if (/^(?:4|8)/.test(symbol)) return `${symbol}.BJ`
  throw new FinancialPluginError(`unsupported A-share symbol: ${symbol}`)
}

function toSixDigitSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(?:SH|SZ|BJ)$/, '')
}
