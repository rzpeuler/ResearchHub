import { PluginValidationError } from '../../core/index.ts'
import type { PluginHandle } from '../../core/index.ts'
import { PluginRegistry } from '../../registry/index.ts'
import { MediaPlugin, type MediaPluginOptions } from './media-plugin.ts'
import type { MediaNewsPlugin, MediaNewsPluginData } from './types.ts'

/** Projects canonical media NewsItems into the unchanged News Plugin contract. */
class MediaNewsPluginAdapter implements MediaNewsPlugin {
  readonly name = 'media-plugin'

  constructor(private readonly plugin: MediaPlugin) {}

  async fetch(request: { symbol: string }) {
    const result = await this.plugin.fetch(request)
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

  validate(value: unknown): asserts value is MediaNewsPluginData {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new PluginValidationError('expected media News Plugin data to be an object')
    }
    const data = value as Record<string, unknown>
    if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol) || !Array.isArray(data.items)) {
      throw new PluginValidationError('invalid media News Plugin data')
    }
  }
}

export interface MediaPluginComposition {
  readonly plugin: MediaPlugin
  readonly news: PluginHandle<{ symbol: string }, MediaNewsPluginData>
}

export function registerMediaPlugin(
  registry: PluginRegistry,
  options: MediaPluginOptions,
): MediaPluginComposition {
  const plugin = new MediaPlugin(options)
  const news = registry.register(new MediaNewsPluginAdapter(plugin))
  return { plugin, news }
}
