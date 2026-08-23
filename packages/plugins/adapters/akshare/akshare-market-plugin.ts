import { type DataPlugin } from '../../core/index.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import {
  canonicalMarketSymbol,
  MarketPluginError,
  normalizeMarketPluginRequest,
  readFiniteNumber,
  readOptionalField,
  readRequiredField,
  requireHttpEndpoint,
  safePluginMessage,
  timestampFromSource,
  validateMarketAdapterData,
  type MarketAdapterData,
  type MarketPluginRequest,
} from '../market-types.ts'

export interface AkShareMarketPluginOptions {
  readonly endpoint?: string
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
}

/** HTTP-bridge adapter for AkShare-shaped data; it has no Python or SDK dependency. */
export class AkShareMarketPlugin implements DataPlugin<MarketPluginRequest, MarketAdapterData> {
  readonly name = 'akshare-market'

  private readonly endpoint: string | undefined
  private readonly transport: NativeFetchTransport
  private readonly clock: () => Date

  constructor(options: AkShareMarketPluginOptions = {}) {
    this.endpoint = options.endpoint?.trim() || undefined
    this.transport = options.transport ?? createNativeFetchTransport()
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(request: MarketPluginRequest) {
    const normalizedRequest = normalizeMarketPluginRequest(request)
    const endpoint = requireHttpEndpoint(this.endpoint, this.name)

    let response: Response
    try {
      response = await this.transport.request(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ symbol: normalizedRequest.symbol }),
      })
    } catch (cause) {
      const safeCause = new Error(safePluginMessage(cause, [this.endpoint]))
      throw new MarketPluginError(
        `akshare-market request failed: ${safePluginMessage(cause, [this.endpoint])}`,
        safeCause,
      )
    }

    if (!response.ok) {
      throw new MarketPluginError(`akshare-market request failed with HTTP ${response.status}`)
    }

    const payload = await readJson(response, endpoint)
    return normalizeAkShareResponse(payload, normalizedRequest.symbol, this.clock)
  }

  validate(value: unknown): asserts value is MarketAdapterData {
    validateMarketAdapterData(value)
  }
}

async function readJson(response: Response, endpoint: string): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch (cause) {
    const safeCause = new Error(safePluginMessage(cause, [endpoint]))
    throw new MarketPluginError(
      `akshare-market response was not valid JSON: ${safePluginMessage(cause, [endpoint])}`,
      safeCause,
    )
  }
}

function normalizeAkShareResponse(
  value: unknown,
  requestedSymbol: string,
  clock: () => Date,
): { data: MarketAdapterData; metadata: { plugin: string; source: string; timestamp: string; quality: 'medium'; confidence: number } } {
  const row = readAkShareRow(value)
  const responseSymbol = canonicalMarketSymbol(readRequiredField(row, ['code', '代码', '证券代码', 'symbol', 'ts_code'], 'code'))
  if (responseSymbol !== canonicalMarketSymbol(requestedSymbol)) {
    throw new MarketPluginError('akshare-market response symbol does not match the request')
  }

  const change = readRequiredField(
    row,
    ['涨跌幅', '涨跌幅(%)', '涨跌幅（%）', 'pct_chg', 'change', '涨跌', '涨跌额', '涨跌额(元)', '涨跌额（元）'],
    'change',
  )
  const data: MarketAdapterData = {
    symbol: requestedSymbol,
    price: readFiniteNumber(readRequiredField(row, ['收盘', '收盘价', 'close', 'price', '最新价'], 'price'), 'price'),
    change: readFiniteNumber(change, 'change'),
    volume: readFiniteNumber(readRequiredField(row, ['成交量', '成交量(手)', '成交量（手）', 'volume', 'vol'], 'volume'), 'volume'),
    source: 'akshare-bridge',
  }

  return {
    data,
    metadata: {
      plugin: 'akshare-market',
      source: 'akshare-bridge',
      timestamp: timestampFromSource(
        readOptionalField(row, ['日期', '交易日期', 'trade_date', 'date', '更新时间', 'timestamp', 'time']),
        clock,
      ),
      quality: 'medium',
      confidence: 0.8,
    },
  }
}

function readAkShareRow(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return readFirstRow(value)
  }
  if (!isRecord(value)) {
    throw new MarketPluginError('akshare-market response is malformed')
  }

  for (const key of ['data', 'items', 'rows', 'result']) {
    const nested = value[key]
    if (Array.isArray(nested)) {
      return readFirstRow(nested)
    }
    if (isRecord(nested) && hasMarketFields(nested)) {
      return nested
    }
  }

  if (hasMarketFields(value)) {
    return value
  }
  throw new MarketPluginError('akshare-market response is malformed: missing row')
}

function readFirstRow(rows: unknown[]): Record<string, unknown> {
  if (rows.length === 0 || !isRecord(rows[0])) {
    throw new MarketPluginError('akshare-market response is empty or malformed')
  }
  return rows[0]
}

function hasMarketFields(value: Record<string, unknown>): boolean {
  return ['code', '代码', '证券代码', 'symbol', 'ts_code'].some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
