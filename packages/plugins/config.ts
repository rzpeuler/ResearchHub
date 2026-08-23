export const MARKET_PLUGIN_NAMES = [
  'tushare-market',
  'akshare-market',
  'mock-market-plugin',
] as const

export type MarketPluginName = (typeof MARKET_PLUGIN_NAMES)[number]
export type RealMarketPluginName = Exclude<MarketPluginName, 'mock-market-plugin'>

export const MARKET_PLUGIN_MODES = ['real', 'fixture'] as const
export type MarketPluginMode = (typeof MARKET_PLUGIN_MODES)[number]

export const DEFAULT_TUSHARE_ENDPOINT = 'https://api.tushare.pro'

export interface MarketPluginEnvironment {
  readonly [key: string]: string | undefined
  readonly TUSHARE_TOKEN?: string
  readonly TUSHARE_ENDPOINT?: string
  readonly AKSHARE_ENDPOINT?: string
  readonly MARKET_PRIMARY_PLUGIN?: string
  readonly MARKET_FALLBACK_PLUGIN?: string
  readonly MARKET_PLUGIN_MODE?: string
}

export interface MarketPluginConfig {
  readonly tushareToken: string | undefined
  readonly tushareEndpoint: string
  readonly akshareEndpoint: string | undefined
  readonly primaryPlugin: MarketPluginName
  readonly fallbackPlugin: MarketPluginName | undefined
  readonly mode: MarketPluginMode
}

/** Raised when plugin environment configuration is invalid or unsafe to compose. */
export class PluginConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginConfigurationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Reads plugin configuration without logging or otherwise exposing credentials. */
export function readMarketPluginConfig(
  environment: MarketPluginEnvironment = process.env,
): MarketPluginConfig {
  const mode = readAllowedValue(
    environment.MARKET_PLUGIN_MODE,
    MARKET_PLUGIN_MODES,
    'MARKET_PLUGIN_MODE',
    'real',
  )
  const defaultPrimary = mode === 'fixture' ? 'mock-market-plugin' : 'tushare-market'
  const primaryPlugin = readAllowedValue(
    environment.MARKET_PRIMARY_PLUGIN,
    MARKET_PLUGIN_NAMES,
    'MARKET_PRIMARY_PLUGIN',
    defaultPrimary,
  )
  const fallbackPlugin = readOptionalAllowedValue(
    environment.MARKET_FALLBACK_PLUGIN,
    MARKET_PLUGIN_NAMES,
    'MARKET_FALLBACK_PLUGIN',
  )

  if (mode === 'real' && (primaryPlugin === 'mock-market-plugin' || fallbackPlugin === 'mock-market-plugin')) {
    throw new PluginConfigurationError(
      'MARKET_PLUGIN_MODE=real cannot select mock-market-plugin; choose a real market plugin',
    )
  }

  const tushareEndpoint = readEndpoint(
    environment.TUSHARE_ENDPOINT,
    DEFAULT_TUSHARE_ENDPOINT,
    'TUSHARE_ENDPOINT',
  )
  const akshareEndpoint = readOptionalEndpoint(environment.AKSHARE_ENDPOINT, 'AKSHARE_ENDPOINT')
  const tushareToken = readOptionalString(environment.TUSHARE_TOKEN)

  return Object.freeze({
    tushareToken,
    tushareEndpoint,
    akshareEndpoint,
    primaryPlugin,
    fallbackPlugin,
    mode,
  })
}

function readAllowedValue<const T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  variable: string,
  fallback: T,
): T {
  const normalized = readOptionalString(value) ?? fallback
  if (!(allowedValues as readonly string[]).includes(normalized)) {
    throw new PluginConfigurationError(`${variable} must be one of: ${allowedValues.join(', ')}`)
  }
  return normalized as T
}

function readOptionalAllowedValue<const T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  variable: string,
): T | undefined {
  const normalized = readOptionalString(value)
  if (normalized === undefined) {
    return undefined
  }
  if (!(allowedValues as readonly string[]).includes(normalized)) {
    throw new PluginConfigurationError(`${variable} must be one of: ${allowedValues.join(', ')}`)
  }
  return normalized as T
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function readEndpoint(value: string | undefined, fallback: string, variable: string): string {
  const endpoint = readOptionalString(value) ?? fallback
  validateEndpoint(endpoint, variable)
  return endpoint
}

function readOptionalEndpoint(value: string | undefined, variable: string): string | undefined {
  const endpoint = readOptionalString(value)
  if (endpoint !== undefined) {
    validateEndpoint(endpoint, variable)
  }
  return endpoint
}

function validateEndpoint(endpoint: string, variable: string): void {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new PluginConfigurationError(`${variable} must not include username/password credentials`)
  }
}
