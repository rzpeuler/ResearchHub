export * from './core/index.ts'
export * from './registry/index.ts'
export * from './adapters/index.ts'
export * from './config.ts'
export * from './transport/index.ts'
export * from './market/index.ts'

import { ProviderRegistry } from './registry/index.ts'
import type { ProviderHandle } from './core/index.ts'
import { MockMarketProvider, type MockMarketData, type MockMarketRequest } from './adapters/mock-market-provider.ts'
import { MockNewsProvider, type MockNewsData, type MockNewsRequest } from './adapters/mock-news-provider.ts'

export interface MockProviderComposition {
  readonly registry: ProviderRegistry
  readonly market: ProviderHandle<MockMarketRequest, MockMarketData>
  readonly news: ProviderHandle<MockNewsRequest, MockNewsData>
}

/** Registers the deterministic mock adapters at the application composition boundary. */
export function createMockProviderComposition(): MockProviderComposition {
  const registry = new ProviderRegistry()
  return {
    registry,
    market: registry.register(new MockMarketProvider()),
    news: registry.register(new MockNewsProvider()),
  }
}
