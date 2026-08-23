export const ANNOUNCEMENT_SOURCE_TYPE = 'official' as const

export type AnnouncementSourceType = typeof ANNOUNCEMENT_SOURCE_TYPE

import type { DataProvider } from '../../core/index.ts'
import type { NewsItem as InformationNewsItem } from '../information/index.ts'

/** Canonical Information Layer record produced by an Announcement Provider. */
export type NewsItem = InformationNewsItem & { sourceType: AnnouncementSourceType }

export interface AnnouncementProviderRequest {
  symbol: string
  limit?: number
}

export interface AnnouncementProviderData {
  symbol: string
  items: NewsItem[]
}

/** Source-neutral record returned by an official announcement adapter. */
export interface RawAnnouncementRecord {
  title: string
  content: string
  publishedAt: string
  source: string
  securityCode?: string
  issuerName?: string
  sourceUrl?: string
  confidence?: number
}

export interface AnnouncementSourceRequest {
  symbol: string
  limit: number
}

export interface OfficialAnnouncementSourceAdapter {
  readonly name: string
  fetch(request: AnnouncementSourceRequest): Promise<readonly RawAnnouncementRecord[]>
}

export type AnnouncementNewsProviderData = {
  symbol: string
  items: Array<{
    symbol: string
    headline: string
    content: string
    source: string
    timestamp: string
    confidence: number
  }>
}

export type AnnouncementNewsProvider = DataProvider<
  { symbol: string },
  AnnouncementNewsProviderData
>
