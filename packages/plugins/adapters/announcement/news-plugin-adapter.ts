import { PluginValidationError } from '../../core/index.ts'
import type { PluginHandle } from '../../core/index.ts'
import { PluginRegistry } from '../../registry/index.ts'
import { AnnouncementPlugin, type AnnouncementPluginOptions } from './announcement-plugin.ts'
import type { AnnouncementNewsPlugin, AnnouncementNewsPluginData } from './types.ts'

/** Projects canonical NewsItems into the unchanged News Plugin contract. */
class AnnouncementNewsPluginAdapter implements AnnouncementNewsPlugin {
  readonly name = 'announcement-plugin'

  constructor(private readonly plugin: AnnouncementPlugin) {}

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

  validate(value: unknown): asserts value is AnnouncementNewsPluginData {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new PluginValidationError('expected announcement News Plugin data to be an object')
    }
    const data = value as Record<string, unknown>
    if (typeof data.symbol !== 'string' || !/^\d{6}$/.test(data.symbol) || !Array.isArray(data.items)) {
      throw new PluginValidationError('invalid announcement News Plugin data')
    }
  }
}

export interface AnnouncementPluginComposition {
  readonly plugin: AnnouncementPlugin
  readonly news: PluginHandle<{ symbol: string }, AnnouncementNewsPluginData>
}

export function registerAnnouncementPlugin(
  registry: PluginRegistry,
  options: AnnouncementPluginOptions,
): AnnouncementPluginComposition {
  const plugin = new AnnouncementPlugin(options)
  const news = registry.register(new AnnouncementNewsPluginAdapter(plugin))
  return { plugin, news }
}
