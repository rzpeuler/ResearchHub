export const MARKET_PROVIDER_NAMES = [
  'tushare-market',
  'akshare-market',
  'mock-market-provider',
] as const

export type MarketProviderName = (typeof MARKET_PROVIDER_NAMES)[number]
export type RealMarketProviderName = Exclude<MarketProviderName, 'mock-market-provider'>

export const MARKET_PROVIDER_MODES = ['real', 'fixture'] as const
export type MarketProviderMode = (typeof MARKET_PROVIDER_MODES)[number]

export const DEFAULT_TUSHARE_ENDPOINT = 'https://api.tushare.pro'

export interface MarketProviderEnvironment {
  readonly [key: string]: string | undefined
  readonly TUSHARE_TOKEN?: string
  readonly TUSHARE_ENDPOINT?: string
  readonly AKSHARE_ENDPOINT?: string
  readonly MARKET_PRIMARY_PROVIDER?: string
  readonly MARKET_FALLBACK_PROVIDER?: string
  readonly MARKET_PROVIDER_MODE?: string
}

export interface MarketProviderConfig {
  readonly tushareToken: string | undefined
  readonly tushareEndpoint: string
  readonly akshareEndpoint: string | undefined
  readonly primaryProvider: MarketProviderName
  readonly fallbackProvider: MarketProviderName | undefined
  readonly mode: MarketProviderMode
}

/** Raised when provider environment configuration is invalid or unsafe to compose. */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigurationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Reads provider configuration without logging or otherwise exposing credentials. */
export function readMarketProviderConfig(
  environment: MarketProviderEnvironment = process.env,
): MarketProviderConfig {
  const mode = readAllowedValue(
    environment.MARKET_PROVIDER_MODE,
    MARKET_PROVIDER_MODES,
    'MARKET_PROVIDER_MODE',
    'real',
  )
  const defaultPrimary = mode === 'fixture' ? 'mock-market-provider' : 'tushare-market'
  const primaryProvider = readAllowedValue(
    environment.MARKET_PRIMARY_PROVIDER,
    MARKET_PROVIDER_NAMES,
    'MARKET_PRIMARY_PROVIDER',
    defaultPrimary,
  )
  const fallbackProvider = readOptionalAllowedValue(
    environment.MARKET_FALLBACK_PROVIDER,
    MARKET_PROVIDER_NAMES,
    'MARKET_FALLBACK_PROVIDER',
  )

  if (mode === 'real' && (primaryProvider === 'mock-market-provider' || fallbackProvider === 'mock-market-provider')) {
    throw new ProviderConfigurationError(
      'MARKET_PROVIDER_MODE=real cannot select mock-market-provider; choose a real market provider',
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
    primaryProvider,
    fallbackProvider,
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
    throw new ProviderConfigurationError(`${variable} must be one of: ${allowedValues.join(', ')}`)
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
    throw new ProviderConfigurationError(`${variable} must be one of: ${allowedValues.join(', ')}`)
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
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL`)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ProviderConfigurationError(`${variable} must not include username/password credentials`)
  }
}
