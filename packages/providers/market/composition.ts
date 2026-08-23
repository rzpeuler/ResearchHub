import {
  ProviderConfigurationError,
  readMarketProviderConfig,
  type MarketProviderConfig,
  type RealMarketProviderName,
} from '../config.ts'
import { ProviderError, type DataProvider, type ProviderHandle } from '../core/index.ts'
import { ProviderRegistry } from '../registry/index.ts'
import {
  AkShareMarketProvider,
  type AkShareMarketProviderOptions,
  TushareMarketProvider,
  type TushareMarketProviderOptions,
} from '../adapters/index.ts'
import {
  validateMarketProviderData,
  type MarketProviderData,
  type MarketProviderRequest,
} from '../adapters/market-types.ts'
import type { NativeFetchTransport } from '../transport/index.ts'

export const MARKET_COMPOSITION_PROVIDER_NAME = 'market-provider-composition'

type RealMarketProvider = DataProvider<MarketProviderRequest, MarketProviderData>

export interface MarketProviderCompositionAdapters {
  readonly 'tushare-market'?: RealMarketProvider
  readonly 'akshare-market'?: RealMarketProvider
}

export interface MarketProviderCompositionOptions {
  /** Replace an adapter in deterministic tests or controlled deployments. */
  readonly adapters?: MarketProviderCompositionAdapters
  readonly tushareTransport?: NativeFetchTransport
  readonly akshareTransport?: NativeFetchTransport
  readonly clock?: () => Date
}

export interface RealMarketProviderComposition {
  readonly registry: ProviderRegistry
  readonly market: ProviderHandle<MarketProviderRequest, MarketProviderData>
  readonly primary: ProviderHandle<MarketProviderRequest, MarketProviderData>
  readonly fallback: ProviderHandle<MarketProviderRequest, MarketProviderData> | undefined
}

/** Raised when both configured real Market Providers fail for one request. */
export class MarketProviderCompositionError extends ProviderError {
  readonly primaryProvider: string
  readonly fallbackProvider: string

  constructor(primaryProvider: string, primaryCause: unknown, fallbackProvider: string, fallbackCause: unknown) {
    super(
      `market provider composition failed: ${primaryProvider}: ${formatCause(primaryCause)}; `
      + `${fallbackProvider}: ${formatCause(fallbackCause)}`,
      new AggregateError([primaryCause, fallbackCause]),
    )
    this.name = 'MarketProviderCompositionError'
    this.primaryProvider = primaryProvider
    this.fallbackProvider = fallbackProvider
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Composes configured real Market Providers behind one Capability-facing handle. */
export function createMarketProviderComposition(
  config: MarketProviderConfig = readMarketProviderConfig(),
  options: MarketProviderCompositionOptions = {},
): RealMarketProviderComposition {
  const { primaryProvider, fallbackProvider } = validateRealCompositionConfig(config)

  const registry = new ProviderRegistry()
  const primaryAdapter = createSelectedProvider(primaryProvider, config, options)
  const primary = registry.register(primaryAdapter)

  let fallback: ProviderHandle<MarketProviderRequest, MarketProviderData> | undefined
  if (fallbackProvider !== undefined) {
    const fallbackAdapter = createSelectedProvider(fallbackProvider, config, options)
    fallback = registry.register(fallbackAdapter)
  }

  const market = registry.register({
    name: MARKET_COMPOSITION_PROVIDER_NAME,
    async fetch(request: MarketProviderRequest) {
      const primaryResolution = registry.get(primary)
      try {
        return await primaryResolution.fetch(request)
      } catch (primaryCause) {
        if (fallback === undefined) {
          throw primaryCause
        }

        const fallbackResolution = registry.get(fallback)
        try {
          return await fallbackResolution.fetch(request)
        } catch (fallbackCause) {
          throw new MarketProviderCompositionError(
            primary.name,
            primaryCause,
            fallback.name,
            fallbackCause,
          )
        }
      }
    },
    validate(value: unknown): asserts value is MarketProviderData {
      validateMarketProviderData(value)
    },
  })

  return { registry, market, primary, fallback }
}

export const createRealMarketProviderComposition = createMarketProviderComposition

function validateRealCompositionConfig(config: MarketProviderConfig): {
  readonly primaryProvider: RealMarketProviderName
  readonly fallbackProvider: RealMarketProviderName | undefined
} {
  assertConfigObject(config)

  if (config.mode !== 'real') {
    throw new ProviderConfigurationError(
      'real market provider composition requires MARKET_PROVIDER_MODE=real',
    )
  }

  validateEndpoint(config.tushareEndpoint, 'TUSHARE_ENDPOINT', true)
  validateEndpoint(config.akshareEndpoint, 'AKSHARE_ENDPOINT', false)

  const primaryProvider = getRealProviderName(config.primaryProvider, 'primary')
  const fallbackProvider = config.fallbackProvider === undefined
    ? undefined
    : getRealProviderName(config.fallbackProvider, 'fallback')

  if (fallbackProvider === primaryProvider) {
    throw new ProviderConfigurationError(
      'MARKET_FALLBACK_PROVIDER must differ from MARKET_PRIMARY_PROVIDER',
    )
  }

  validateProviderConfiguration(primaryProvider, config)
  if (fallbackProvider !== undefined) {
    validateProviderConfiguration(fallbackProvider, config)
  }

  return { primaryProvider, fallbackProvider }
}

function assertConfigObject(config: unknown): asserts config is MarketProviderConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ProviderConfigurationError('MarketProviderConfig must be an object')
  }
}

function getRealProviderName(
  providerName: unknown,
  role: 'primary' | 'fallback',
): RealMarketProviderName {
  if (providerName === 'mock-market-provider') {
    throw new ProviderConfigurationError(
      `real market provider composition cannot select mock-market-provider as ${role}`,
    )
  }

  if (providerName !== 'tushare-market' && providerName !== 'akshare-market') {
    const variable = role === 'primary' ? 'MARKET_PRIMARY_PROVIDER' : 'MARKET_FALLBACK_PROVIDER'
    throw new ProviderConfigurationError(
      `${variable} must be one of: tushare-market, akshare-market`,
    )
  }
  return providerName
}

function validateProviderConfiguration(providerName: RealMarketProviderName, config: MarketProviderConfig): void {
  if (providerName === 'tushare-market') {
    if (typeof config.tushareToken !== 'string' || config.tushareToken.trim().length === 0) {
      throw new ProviderConfigurationError(
        'tushare-market requires TUSHARE_TOKEN when selected as a real provider',
      )
    }
    return
  }

  if (config.akshareEndpoint === undefined || config.akshareEndpoint.trim().length === 0) {
    throw new ProviderConfigurationError(
      'akshare-market requires AKSHARE_ENDPOINT when selected as a real provider',
    )
  }
}

function validateEndpoint(value: unknown, variable: string, required: boolean): void {
  if (value === undefined && !required) {
    return
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ProviderConfigurationError(
      `${variable} must not include username/password userinfo`,
    )
  }
}

function createSelectedProvider(
  providerName: RealMarketProviderName,
  config: MarketProviderConfig,
  options: MarketProviderCompositionOptions,
): RealMarketProvider {
  const injected = options.adapters?.[providerName]
  if (injected !== undefined) {
    if (injected.name !== providerName) {
      throw new ProviderConfigurationError(
        `injected adapter for ${providerName} must expose name ${providerName}`,
      )
    }
    return injected
  }

  if (providerName === 'tushare-market') {
    const adapterOptions: TushareMarketProviderOptions = {
      endpoint: config.tushareEndpoint,
      token: config.tushareToken,
      transport: options.tushareTransport,
      clock: options.clock,
    }
    return new TushareMarketProvider(adapterOptions)
  }

  const adapterOptions: AkShareMarketProviderOptions = {
    endpoint: config.akshareEndpoint,
    transport: options.akshareTransport,
    clock: options.clock,
  }
  return new AkShareMarketProvider(adapterOptions)
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
