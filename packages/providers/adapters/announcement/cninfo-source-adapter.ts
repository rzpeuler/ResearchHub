import { createNativeFetchTransport, type NativeFetchTransport } from '../../transport/index.ts'
import { AnnouncementProviderError } from './errors.ts'
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

export interface CninfoAnnouncementSourceAdapterOptions {
  readonly endpoint?: string
  readonly transport?: NativeFetchTransport
}

/** Official-source adapter for CNINFO's public company announcement query. */
export class CninfoAnnouncementSourceAdapter implements OfficialAnnouncementSourceAdapter {
  readonly name = 'cninfo-announcement-source'

  private readonly endpoint: string
  private readonly transport: NativeFetchTransport

  constructor(options: CninfoAnnouncementSourceAdapterOptions = {}) {
    this.endpoint = requireHttpEndpoint(options.endpoint ?? DEFAULT_CNINFO_ANNOUNCEMENT_ENDPOINT)
    this.transport = options.transport ?? createNativeFetchTransport()
  }

  async fetch(request: AnnouncementSourceRequest): Promise<readonly RawAnnouncementRecord[]> {
    const body = new URLSearchParams({
      stock: request.symbol,
      pageNum: '1',
      pageSize: String(request.limit),
      tabName: 'fulltext',
      column: columnForSymbol(request.symbol),
      plate: '',
      searchkey: '',
      secid: '',
      category: '',
      trade: '',
      isHLtitle: 'true',
    })

    let response: Response
    try {
      response = await this.transport.request(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: body.toString(),
      })
    } catch (cause) {
      throw new AnnouncementProviderError('cninfo announcement request failed', cause)
    }

    if (!response.ok) {
      throw new AnnouncementProviderError(`cninfo announcement request failed with HTTP ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json() as unknown
    } catch (cause) {
      throw new AnnouncementProviderError('cninfo announcement response was not valid JSON', cause)
    }

    return parseCninfoResponse(payload)
  }
}

function parseCninfoResponse(value: unknown): RawAnnouncementRecord[] {
  assertRecord(value, 'cninfo announcement response must be an object')

  if (typeof value.code === 'number' && value.code !== 0) {
    const message = readOptionalString(value, ['msg', 'message'])
    throw new AnnouncementProviderError(`cninfo announcement API error${message === undefined ? '' : `: ${message}`}`)
  }

  const announcements = value.announcements
  if (!Array.isArray(announcements)) {
    throw new AnnouncementProviderError('cninfo announcement response is missing announcements')
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
    throw new AnnouncementProviderError('cninfo announcement endpoint must be a valid HTTP(S) URL without credentials')
  }
}

export function parseCninfoAnnouncementFixture(value: unknown): readonly RawAnnouncementRecord[] {
  if (isRecord(value) && Array.isArray(value.announcements)) {
    return parseCninfoResponse(value)
  }
  if (Array.isArray(value)) {
    return value.map(parseRawAnnouncement)
  }
  throw new AnnouncementProviderError('announcement fixture must be an array or CNINFO response object')
}
