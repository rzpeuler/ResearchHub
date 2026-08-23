import { ProviderValidationError } from '../../core/index.ts'
import type { ProviderHandle } from '../../core/index.ts'
import { ProviderRegistry } from '../../registry/index.ts'
import { MediaProvider, type MediaProviderOptions } from './media-provider.ts'
import type { MediaNewsProvider, MediaNewsProviderData } from './types.ts'

/** Projects canonical media NewsItems into the unchanged News Capability contract. */
class MediaNewsCapabilityAdapter implements MediaNewsProvider {
  readonly name = 'media-provider'

  constructor(private readonly provider: MediaProvider) {}

  async fetch(request: { symbol: string }) {
    const result = await this.provider.fetch(request)
    return {
      data: {
        symbol: result.data.symbol,
        items: result.data.items.map((item) => ({
          symbol: request.symbol,
          headline: item.title,
          content: item.content,
          source: item.source,
          timestamp: item.publishedAt,
          confidence: item.confidence,
        })),
      },
      metadata: result.metadata,
    }
  }

  validate(value: unknown): asserts value is MediaNewsProviderData {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProviderValidationError('expected media News Capability data to be an object')
    }
    const data = value as Record<string, unknown>
    if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol) || !Array.isArray(data.items)) {
      throw new ProviderValidationError('invalid media News Capability data')
    }
  }
}

export interface MediaProviderComposition {
  readonly provider: MediaProvider
  readonly news: ProviderHandle<{ symbol: string }, MediaNewsProviderData>
}

export function registerMediaProvider(
  registry: ProviderRegistry,
  options: MediaProviderOptions,
): MediaProviderComposition {
  const provider = new MediaProvider(options)
  const news = registry.register(new MediaNewsCapabilityAdapter(provider))
  return { provider, news }
}
