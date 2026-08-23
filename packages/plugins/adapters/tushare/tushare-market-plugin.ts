import { type DataPlugin } from '../../core/index.ts'
import { DEFAULT_TUSHARE_ENDPOINT } from '../../config.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import {
  canonicalMarketSymbol,
  MarketPluginError,
  normalizeMarketPluginRequest,
  readFiniteNumber,
  readRequiredField,
  requireHttpEndpoint,
  safePluginMessage,
  timestampFromSource,
  validateMarketAdapterData,
  type MarketAdapterData,
  type MarketPluginRequest,
} from '../market-types.ts'

export interface TushareMarketPluginOptions {
  readonly endpoint?: string
  readonly token?: string
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
}

/** Native HTTP adapter for Tushare's documented POST `daily` endpoint. */
export class TushareMarketPlugin implements DataPlugin<MarketPluginRequest, MarketAdapterData> {
  readonly name = 'tushare-market'

  private readonly endpoint: string
  private readonly token: string | undefined
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date

  constructor(options: TushareMarketPluginOptions = {}) {
    const configuredEndpoint = options.endpoint ?? DEFAULT_TUSHARE_ENDPOINT
    this.endpoint = requireHttpEndpoint(configuredEndpoint.trim(), this.name)
    this.token = options.token?.trim() || undefined
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(request: MarketPluginRequest) {
    const normalizedRequest = normalizeMarketPluginRequest(request)
    if (this.token === undefined) {
      throw new MarketPluginError('tushare-market plugin is unavailable: TUSHARE_TOKEN is not configured')
    }

    const tsCode = toTushareCode(normalizedRequest.symbol)
    const body = {
      api_name: 'daily',
      token: this.token,
      params: { ts_code: tsCode },
    }

    let response: Response
    try {
      response = await this.transport.request(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      const safeCause = new Error(safePluginMessage(cause, [this.token, this.endpoint]))
      throw new MarketPluginError(
        `tushare-market request failed: ${safePluginMessage(cause, [this.token, this.endpoint])}`,
        safeCause,
      )
    }

    if (!response.ok) {
      throw new MarketPluginError(`tushare-market request failed with HTTP ${response.status}`)
    }

    const payload = await readJson(response, this.token, this.endpoint)
    return normalizeTushareResponse(payload, normalizedRequest.symbol, this.clock, this.token, this.endpoint)
  }

  validate(value: unknown): asserts value is MarketAdapterData {
    validateMarketAdapterData(value)
  }
}

function toTushareCode(symbol: string): string {
  if (/^\d{6}\.(?:SH|SZ|BJ)$/.test(symbol)) {
    return symbol
  }

  if (!/^\d{6}$/.test(symbol)) {
    throw new MarketPluginError(`unsupported A-share symbol: ${symbol}`)
  }

  if (/^(?:6|68)/.test(symbol)) {
    return `${symbol}.SH`
  }
  if (/^(?:0|2|3)/.test(symbol)) {
    return `${symbol}.SZ`
  }
  if (/^(?:4|8)/.test(symbol)) {
    return `${symbol}.BJ`
  }

  throw new MarketPluginError(`unsupported A-share symbol: ${symbol}`)
}

async function readJson(response: Response, token: string, endpoint: string): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch (cause) {
    const safeCause = new Error(safePluginMessage(cause, [token, endpoint]))
    throw new MarketPluginError(
      `tushare-market response was not valid JSON: ${safePluginMessage(cause, [token, endpoint])}`,
      safeCause,
    )
  }
}

function normalizeTushareResponse(
  value: unknown,
  requestedSymbol: string,
  clock: () => Date,
  token: string,
  endpoint: string,
): { data: MarketAdapterData; metadata: { plugin: string; source: string; timestamp: string; quality: 'high'; confidence: number } } {
  if (!isRecord(value) || value.code !== 0) {
    const message = isRecord(value) && typeof value.msg === 'string' && value.msg.trim().length > 0
      ? value.msg.trim()
      : 'Tushare API returned an error'
    throw new MarketPluginError(`tushare-market API error: ${safePluginMessage(message, [token, endpoint])}`)
  }

  if (!isRecord(value.data)) {
    throw new MarketPluginError('tushare-market response is malformed: missing data envelope')
  }

  const row = readTushareRow(value.data)
  const responseSymbol = canonicalMarketSymbol(readRequiredField(row, ['ts_code'], 'ts_code'))
  if (responseSymbol !== canonicalMarketSymbol(requestedSymbol)) {
    throw new MarketPluginError('tushare-market response symbol does not match the request')
  }

  const change = readRequiredField(row, ['pct_chg', 'change'], 'change')
  const timestamp = timestampFromSource(row.trade_date, clock)
  const data: MarketAdapterData = {
    symbol: requestedSymbol,
    price: readFiniteNumber(readRequiredField(row, ['close'], 'close'), 'close'),
    change: readFiniteNumber(change, 'change'),
    volume: readFiniteNumber(readRequiredField(row, ['vol'], 'vol'), 'vol'),
    source: 'tushare',
  }

  return {
    data,
    metadata: {
      plugin: 'tushare-market',
      source: 'tushare',
      timestamp,
      quality: 'high',
      confidence: 0.9,
    },
  }
}

function readTushareRow(data: Record<string, unknown>): Record<string, unknown> {
  const items = data.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new MarketPluginError('tushare-market response is empty')
  }

  const firstItem = items[0]
  if (isRecord(firstItem)) {
    return firstItem
  }
  if (!Array.isArray(firstItem) || !Array.isArray(data.fields) || data.fields.length === 0) {
    throw new MarketPluginError('tushare-market response is malformed: invalid row')
  }

  const row: Record<string, unknown> = {}
  for (let index = 0; index < data.fields.length; index += 1) {
    const field = data.fields[index]
    if (typeof field !== 'string' || field.trim().length === 0) {
      throw new MarketPluginError('tushare-market response is malformed: invalid field list')
    }
    row[field] = firstItem[index]
  }
  return row
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
