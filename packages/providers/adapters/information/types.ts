export const NEWS_SOURCE_TYPES = ['official', 'media', 'community'] as const

export type NewsSourceType = (typeof NEWS_SOURCE_TYPES)[number]

export const MEDIA_SOURCE_TIERS = ['tier-1', 'tier-2', 'tier-3'] as const

export type MediaSourceTier = (typeof MEDIA_SOURCE_TIERS)[number]

/** Shared Information Layer record consumed by capabilities and research workflows. */
export interface NewsItem {
  title: string
  content: string
  publishedAt: string
  source: string
  sourceType: NewsSourceType
  symbols: string[]
  confidence: number
}

export interface MediaSourceMetadata {
  publisher: string
  tier: MediaSourceTier
  confidence: number
}

/** NewsItem extension carrying professional-media attribution metadata. */
export interface MediaNewsItem extends NewsItem {
  sourceType: 'media'
  metadata: MediaSourceMetadata
}
