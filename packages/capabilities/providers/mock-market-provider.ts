import type { CapabilityProvider } from '../core/index.ts'
import type { MarketSnapshot, MarketSnapshotInput } from '../market/provider.ts'

const MOCK_SNAPSHOTS: Readonly<Record<string, MarketSnapshot>> = {
  '600519': {
    symbol: '600519',
    price: 1680.0,
    change: 12.5,
    volume: 100000,
    source: 'mock',
  },
  '000001': {
    symbol: '000001',
    price: 12.34,
    change: -0.12,
    volume: 250000,
    source: 'mock',
  },
}

/** Deterministic in-memory provider used only until a real source is selected. */
export class MockMarketProvider implements CapabilityProvider<MarketSnapshotInput, MarketSnapshot> {
  readonly name = 'mock-market-provider'

  async execute(input: MarketSnapshotInput): Promise<MarketSnapshot> {
    const snapshot = MOCK_SNAPSHOTS[input.symbol]
    if (snapshot === undefined) {
      throw new Error(`mock market data is unavailable for symbol: ${input.symbol}`)
    }

    return { ...snapshot }
  }
}
