import {
  PluginConfigurationError,
  readMarketPluginConfig,
  type MarketPluginConfig,
  type RealMarketPluginName,
} from '../config.ts'
import { PluginError, type DataPlugin, type PluginHandle } from '../core/index.ts'
import { PluginRegistry } from '../registry/index.ts'
import {
  AkShareMarketPlugin,
  type AkShareMarketPluginOptions,
  TushareMarketPlugin,
  type TushareMarketPluginOptions,
} from '../adapters/index.ts'
import {
  validateMarketAdapterData,
  type MarketAdapterData,
  type MarketPluginRequest,
} from '../adapters/market-types.ts'
import type { NativeFetchTransport } from '../transport/index.ts'

export const MARKET_COMPOSITION_PLUGIN_NAME = 'market-plugin-composition'

type RealMarketPlugin = DataPlugin<MarketPluginRequest, MarketAdapterData>

export interface MarketPluginCompositionAdapters {
  readonly 'tushare-market'?: RealMarketPlugin
  readonly 'akshare-market'?: RealMarketPlugin
}

export interface MarketPluginCompositionOptions {
  /** Replace an adapter in deterministic tests or controlled deployments. */
  readonly adapters?: MarketPluginCompositionAdapters
  readonly tushareTransport?: NativeFetchTransport
  readonly akshareTransport?: NativeFetchTransport
  readonly clock?: () => Date
}

export interface RealMarketPluginComposition {
  readonly registry: PluginRegistry
  readonly market: PluginHandle<MarketPluginRequest, MarketAdapterData>
  readonly primary: PluginHandle<MarketPluginRequest, MarketAdapterData>
  readonly fallback: PluginHandle<MarketPluginRequest, MarketAdapterData> | undefined
}

/** Raised when both configured real Market Plugins fail for one request. */
export class MarketPluginCompositionError extends PluginError {
  readonly primaryPlugin: string
  readonly fallbackPlugin: string

  constructor(primaryPlugin: string, primaryCause: unknown, fallbackPlugin: string, fallbackCause: unknown) {
    super(
      `market plugin composition failed: ${primaryPlugin}: ${formatCause(primaryCause)}; `
      + `${fallbackPlugin}: ${formatCause(fallbackCause)}`,
      new AggregateError([primaryCause, fallbackCause]),
    )
    this.name = 'MarketPluginCompositionError'
    this.primaryPlugin = primaryPlugin
    this.fallbackPlugin = fallbackPlugin
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Composes configured real Market Plugins behind one typed Plugin handle. */
export function createMarketPluginComposition(
  config: MarketPluginConfig = readMarketPluginConfig(),
  options: MarketPluginCompositionOptions = {},
): RealMarketPluginComposition {
  const { primaryPlugin, fallbackPlugin } = validateRealCompositionConfig(config)

  const registry = new PluginRegistry()
  const primaryAdapter = createSelectedPlugin(primaryPlugin, config, options)
  const primary = registry.register(primaryAdapter)

  let fallback: PluginHandle<MarketPluginRequest, MarketAdapterData> | undefined
  if (fallbackPlugin !== undefined) {
    const fallbackAdapter = createSelectedPlugin(fallbackPlugin, config, options)
    fallback = registry.register(fallbackAdapter)
  }

  const market = registry.register({
    name: MARKET_COMPOSITION_PLUGIN_NAME,
    async fetch(request: MarketPluginRequest) {
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
          throw new MarketPluginCompositionError(
            primary.name,
            primaryCause,
            fallback.name,
            fallbackCause,
          )
        }
      }
    },
    validate(value: unknown): asserts value is MarketAdapterData {
      validateMarketAdapterData(value)
    },
  })

  return { registry, market, primary, fallback }
}

export const createRealMarketPluginComposition = createMarketPluginComposition

function validateRealCompositionConfig(config: MarketPluginConfig): {
  readonly primaryPlugin: RealMarketPluginName
  readonly fallbackPlugin: RealMarketPluginName | undefined
} {
  assertConfigObject(config)

  if (config.mode !== 'real') {
    throw new PluginConfigurationError(
      'real market plugin composition requires MARKET_PLUGIN_MODE=real',
    )
  }

  validateEndpoint(config.tushareEndpoint, 'TUSHARE_ENDPOINT', true)
  validateEndpoint(config.akshareEndpoint, 'AKSHARE_ENDPOINT', false)

  const primaryPlugin = getRealPluginName(config.primaryPlugin, 'primary')
  const fallbackPlugin = config.fallbackPlugin === undefined
    ? undefined
    : getRealPluginName(config.fallbackPlugin, 'fallback')

  if (fallbackPlugin === primaryPlugin) {
    throw new PluginConfigurationError(
      'MARKET_FALLBACK_PLUGIN must differ from MARKET_PRIMARY_PLUGIN',
    )
  }

  validatePluginConfiguration(primaryPlugin, config)
  if (fallbackPlugin !== undefined) {
    validatePluginConfiguration(fallbackPlugin, config)
  }

  return { primaryPlugin, fallbackPlugin }
}

function assertConfigObject(config: unknown): asserts config is MarketPluginConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new PluginConfigurationError('MarketPluginConfig must be an object')
  }
}

function getRealPluginName(
  pluginName: unknown,
  role: 'primary' | 'fallback',
): RealMarketPluginName {
  if (pluginName === 'mock-market-plugin') {
    throw new PluginConfigurationError(
      `real market plugin composition cannot select mock-market-plugin as ${role}`,
    )
  }

  if (pluginName !== 'tushare-market' && pluginName !== 'akshare-market') {
    const variable = role === 'primary' ? 'MARKET_PRIMARY_PLUGIN' : 'MARKET_FALLBACK_PLUGIN'
    throw new PluginConfigurationError(
      `${variable} must be one of: tushare-market, akshare-market`,
    )
  }
  return pluginName
}

function validatePluginConfiguration(pluginName: RealMarketPluginName, config: MarketPluginConfig): void {
  if (pluginName === 'tushare-market') {
    if (typeof config.tushareToken !== 'string' || config.tushareToken.trim().length === 0) {
      throw new PluginConfigurationError(
        'tushare-market requires TUSHARE_TOKEN when selected as a real plugin',
      )
    }
    return
  }

  if (config.akshareEndpoint === undefined || config.akshareEndpoint.trim().length === 0) {
    throw new PluginConfigurationError(
      'akshare-market requires AKSHARE_ENDPOINT when selected as a real plugin',
    )
  }
}

function validateEndpoint(value: unknown, variable: string, required: boolean): void {
  if (value === undefined && !required) {
    return
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new PluginConfigurationError(
      `${variable} must not include username/password userinfo`,
    )
  }
}

function createSelectedPlugin(
  pluginName: RealMarketPluginName,
  config: MarketPluginConfig,
  options: MarketPluginCompositionOptions,
): RealMarketPlugin {
  const injected = options.adapters?.[pluginName]
  if (injected !== undefined) {
    if (injected.name !== pluginName) {
      throw new PluginConfigurationError(
        `injected adapter for ${pluginName} must expose name ${pluginName}`,
      )
    }
    return injected
  }

  if (pluginName === 'tushare-market') {
    const adapterOptions: TushareMarketPluginOptions = {
      endpoint: config.tushareEndpoint,
      token: config.tushareToken,
      transport: options.tushareTransport,
      clock: options.clock,
    }
    return new TushareMarketPlugin(adapterOptions)
  }

  const adapterOptions: AkShareMarketPluginOptions = {
    endpoint: config.akshareEndpoint,
    transport: options.akshareTransport,
    clock: options.clock,
  }
  return new AkShareMarketPlugin(adapterOptions)
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
