export * from './core/index.ts'
export * from './registry/index.ts'
export * from './adapters/index.ts'
export * from './config.ts'
export * from './transport/index.ts'
export * from './market/index.ts'
export * from './financial/index.ts'

import { PluginRegistry } from './registry/index.ts'
import type { PluginHandle } from './core/index.ts'
import { MockMarketPlugin, type MockMarketData, type MockMarketRequest } from './adapters/mock-market-plugin.ts'
import { MockNewsPlugin, type MockNewsData, type MockNewsRequest } from './adapters/mock-news-plugin.ts'

export interface MockPluginComposition {
  readonly registry: PluginRegistry
  readonly market: PluginHandle<MockMarketRequest, MockMarketData>
  readonly news: PluginHandle<MockNewsRequest, MockNewsData>
}

/** Registers the deterministic mock adapters at the application composition boundary. */
export function createMockPluginComposition(): MockPluginComposition {
  const registry = new PluginRegistry()
  return {
    registry,
    market: registry.register(new MockMarketPlugin()),
    news: registry.register(new MockNewsPlugin()),
  }
}
