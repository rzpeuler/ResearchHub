import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import { AnnouncementPluginError } from './errors.ts'
import {
  assertRecord,
  isRecord,
  parseRawAnnouncement,
  readOptionalString,
} from './source-adapter.ts'
import type {
  AnnouncementSourceRequest,
  OfficialAnnouncementSourceAdapter,
  RawAnnouncementRecord,
} from './types.ts'

export const DEFAULT_CNINFO_ANNOUNCEMENT_ENDPOINT = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
export const DEFAULT_CNINFO_STOCK_DIRECTORY_ENDPOINT = 'https://www.cninfo.com.cn/new/data/szse_stock.json'

export interface CninfoAnnouncementSourceAdapterOptions {
  readonly endpoint?: string
  readonly stockDirectoryEndpoint?: string
  readonly transport?: NativeFetchTransport
}

/** Official-source adapter for CNINFO's public company announcement query. */
export class CninfoAnnouncementSourceAdapter implements OfficialAnnouncementSourceAdapter {
  readonly name = 'cninfo-announcement-source'

  private readonly endpoint: string
  private readonly stockDirectoryEndpoint: string
  private readonly transport: NativeFetchTransport
  private stockDirectoryPromise: Promise<ReadonlyMap<string, string>> | undefined

  constructor(options: CninfoAnnouncementSourceAdapterOptions = {}) {
    this.endpoint = requireHttpEndpoint(options.endpoint ?? DEFAULT_CNINFO_ANNOUNCEMENT_ENDPOINT)
    this.stockDirectoryEndpoint = requireHttpEndpoint(options.stockDirectoryEndpoint ?? DEFAULT_CNINFO_STOCK_DIRECTORY_ENDPOINT)
    this.transport = options.transport ?? createNativeFetchTransport()
  }

  async fetch(request: AnnouncementSourceRequest): Promise<readonly RawAnnouncementRecord[]> {
    const symbol = normalizeSymbol(request.symbol)
    const orgId = (await this.loadStockDirectory()).get(symbol)
    if (orgId === undefined) {
      throw new AnnouncementPluginError(`cninfo stock directory has no organization id for ${symbol}`)
    }

    const body = new URLSearchParams({
      stock: `${symbol},${orgId}`,
      pageNum: '1',
      pageSize: String(request.limit),
      tabName: 'fulltext',
      column: columnForSymbol(symbol),
      plate: '',
      searchkey: '',
      secid: '',
      category: '',
      trade: '',
      isHLtitle: 'true',
      ...(request.startTime === undefined && request.endTime === undefined
        ? {}
        : { seDate: toCninfoDateRange(request.startTime, request.endTime) }),
    })

    let response: Response
    try {
      response = await this.transport.request(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          origin: 'https://www.cninfo.com.cn',
          referer: 'https://www.cninfo.com.cn/',
          'user-agent': 'Mozilla/5.0 (ResearchHub; NEWS-PROVIDER-FIX-001)',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: body.toString(),
      })
    } catch (cause) {
      throw new AnnouncementPluginError('cninfo announcement request failed', cause)
    }

    if (!response.ok) {
      throw new AnnouncementPluginError(`cninfo announcement request failed with HTTP ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json() as unknown
    } catch (cause) {
      throw new AnnouncementPluginError('cninfo announcement response was not valid JSON', cause)
    }

    return parseCninfoResponse(payload)
  }

  private async loadStockDirectory(): Promise<ReadonlyMap<string, string>> {
    if (this.stockDirectoryPromise === undefined) {
      this.stockDirectoryPromise = this.fetchStockDirectory()
    }
    return this.stockDirectoryPromise
  }

  private async fetchStockDirectory(): Promise<ReadonlyMap<string, string>> {
    let response: Response
    try {
      response = await this.transport.request(this.stockDirectoryEndpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          referer: 'https://www.cninfo.com.cn/',
          'user-agent': 'Mozilla/5.0 (ResearchHub; NEWS-PROVIDER-FIX-001)',
        },
      })
    } catch (cause) {
      throw new AnnouncementPluginError('cninfo stock directory request failed', cause)
    }
    if (!response.ok) {
      throw new AnnouncementPluginError(`cninfo stock directory request failed with HTTP ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json() as unknown
    } catch (cause) {
      throw new AnnouncementPluginError('cninfo stock directory response was not valid JSON', cause)
    }
    return parseStockDirectory(payload)
  }
}

function parseCninfoResponse(value: unknown): RawAnnouncementRecord[] {
  assertRecord(value, 'cninfo announcement response must be an object')

  if (typeof value.code === 'number' && value.code !== 0) {
    const message = readOptionalString(value, ['msg', 'message'])
    throw new AnnouncementPluginError(`cninfo announcement API error${message === undefined ? '' : `: ${message}`}`)
  }

  const announcements = value.announcements
  if (announcements === null && value.totalAnnouncement === 0) return []
  if (!Array.isArray(announcements)) {
    throw new AnnouncementPluginError('cninfo announcement response is missing announcements')
  }

  return announcements.map(parseRawAnnouncement)
}

function columnForSymbol(symbol: string): string {
  if (/^(?:6|68)/.test(symbol)) {
    return 'sse'
  }
  if (/^(?:0|2|3)/.test(symbol)) {
    return 'szse'
  }
  return 'bjse'
}

function normalizeSymbol(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/^(?:SH|SZ|BJ)[.:]?/, '').replace(/\.(?:SH|SZ|BJ)$/, '')
  if (!/^\d{6}$/.test(normalized)) {
    throw new AnnouncementPluginError('cninfo announcement request requires a six-digit A-share symbol')
  }
  return normalized
}

function toCninfoDateRange(startTime: string | undefined, endTime: string | undefined): string {
  const start = startTime === undefined ? '' : toCninfoDate(startTime, 'startTime')
  const end = endTime === undefined ? '' : toCninfoDate(endTime, 'endTime')
  return `${start}~${end}`
}

function toCninfoDate(value: string, field: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new AnnouncementPluginError(`cninfo ${field} must be a valid timestamp`)
  return parsed.toISOString().slice(0, 10)
}

function parseStockDirectory(value: unknown): ReadonlyMap<string, string> {
  assertRecord(value, 'cninfo stock directory response must be an object')
  if (!Array.isArray(value.stockList)) {
    throw new AnnouncementPluginError('cninfo stock directory response is missing stockList')
  }
  const entries = new Map<string, string>()
  for (const item of value.stockList) {
    if (!isRecord(item)) continue
    const code = readOptionalString(item, ['code'])
    const orgId = readOptionalString(item, ['orgId', 'orgID'])
    if (code !== undefined && orgId !== undefined && /^\d{6}$/.test(code)) entries.set(code, orgId)
  }
  return entries
}

function requireHttpEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint.trim())
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username.length > 0
      || parsed.password.length > 0) {
      throw new Error('invalid endpoint')
    }
    return parsed.toString()
  } catch {
    throw new AnnouncementPluginError('cninfo announcement endpoint must be a valid HTTP(S) URL without credentials')
  }
}

export function parseCninfoAnnouncementFixture(value: unknown): readonly RawAnnouncementRecord[] {
  if (isRecord(value) && Array.isArray(value.announcements)) {
    return parseCninfoResponse(value)
  }
  if (Array.isArray(value)) {
    return value.map(parseRawAnnouncement)
  }
  throw new AnnouncementPluginError('announcement fixture must be an array or CNINFO response object')
}
