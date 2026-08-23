import { ProviderValidationError } from '../../core/index.ts'
import type { ProviderHandle } from '../../core/index.ts'
import { ProviderRegistry } from '../../registry/index.ts'
import { AnnouncementProvider, type AnnouncementProviderOptions } from './announcement-provider.ts'
import type { AnnouncementNewsProvider, AnnouncementNewsProviderData } from './types.ts'

/** Projects canonical NewsItems into the unchanged News Capability contract. */
class AnnouncementNewsCapabilityAdapter implements AnnouncementNewsProvider {
  readonly name = 'announcement-provider'

  constructor(private readonly provider: AnnouncementProvider) {}

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

  validate(value: unknown): asserts value is AnnouncementNewsProviderData {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProviderValidationError('expected announcement News Capability data to be an object')
    }
    const data = value as Record<string, unknown>
    if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol) || !Array.isArray(data.items)) {
      throw new ProviderValidationError('invalid announcement News Capability data')
    }
  }
}

export interface AnnouncementProviderComposition {
  readonly provider: AnnouncementProvider
  readonly news: ProviderHandle<{ symbol: string }, AnnouncementNewsProviderData>
}

export function registerAnnouncementProvider(
  registry: ProviderRegistry,
  options: AnnouncementProviderOptions,
): AnnouncementProviderComposition {
  const provider = new AnnouncementProvider(options)
  const news = registry.register(new AnnouncementNewsCapabilityAdapter(provider))
  return { provider, news }
}
