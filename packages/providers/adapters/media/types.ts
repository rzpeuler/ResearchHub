import type { DataProvider } from '../../core/index.ts'
import type { MediaNewsItem, MediaSourceTier } from '../information/index.ts'

export { MEDIA_SOURCE_TIERS } from '../information/index.ts'
export type { MediaNewsItem, MediaSourceMetadata, MediaSourceTier } from '../information/index.ts'

export interface MediaProviderRequest {
  symbol: string
  limit?: number
}

export interface MediaProviderData {
  symbol: string
  items: MediaNewsItem[]
}

/** Source-neutral media record returned by a professional-media adapter. */
export interface RawMediaRecord {
  title: string
  content: string
  publishedAt: string
  source: string
  publisher: string
  tier: MediaSourceTier
  confidence: number
  metadataConfidence?: number
  securityCode?: string
  issuerName?: string
}

export interface MediaSourceRequest {
  symbol: string
  limit: number
}

export interface ProfessionalMediaSourceAdapter {
  readonly name: string
  fetch(request: MediaSourceRequest): Promise<readonly RawMediaRecord[]>
}

export interface MediaNewsProviderData {
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

export type MediaNewsProvider = DataProvider<
  { symbol: string },
  MediaNewsProviderData
>
