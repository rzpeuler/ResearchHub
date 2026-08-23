import { ProviderRegistry } from '../registry/index.ts'
import type { ProviderHandle } from '../core/index.ts'
import { ProviderConfigurationError } from '../config.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../transport/index.ts'
import { AkShareFinancialProvider, type AkShareFinancialProviderOptions } from '../adapters/financial/akshare-financial-provider.ts'
import { TushareFinancialProvider, type TushareFinancialProviderOptions } from '../adapters/financial/tushare-financial-provider.ts'
import { validateFinancialData } from '../adapters/financial/normalization.ts'
import type { FinancialData, FinancialDataRequest, FinancialProvider } from '../adapters/financial/types.ts'

export const FINANCIAL_PROVIDER_NAMES = ['tushare-financial', 'akshare-financial'] as const
export type FinancialProviderName = (typeof FINANCIAL_PROVIDER_NAMES)[number]
export const FINANCIAL_PROVIDER_MODES = ['real', 'fixture'] as const
export type FinancialProviderMode = (typeof FINANCIAL_PROVIDER_MODES)[number]

export interface FinancialProviderEnvironment {
  readonly [key: string]: string | undefined
  readonly TUSHARE_TOKEN?: string
  readonly TUSHARE_FINANCIAL_ENDPOINT?: string
  readonly AKSHARE_FINANCIAL_ENDPOINT?: string
  readonly FINANCIAL_PRIMARY_PROVIDER?: string
  readonly FINANCIAL_FALLBACK_PROVIDER?: string
  readonly FINANCIAL_PROVIDER_MODE?: string
}

export interface FinancialProviderConfig {
  readonly mode: FinancialProviderMode
  readonly tushareToken?: string
  readonly tushareEndpoint: string
  readonly akshareEndpoint?: string
  readonly primaryProvider: FinancialProviderName
  readonly fallbackProvider?: FinancialProviderName
}

export interface FinancialProviderCompositionOptions {
  readonly environment?: FinancialProviderEnvironment
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
  readonly adapters?: Partial<Record<FinancialProviderName, FinancialProvider>>
}

export interface FinancialProviderComposition {
  readonly registry: ProviderRegistry
  readonly financial: ProviderHandle<FinancialDataRequest, FinancialData>
  readonly primary: FinancialProviderName
  readonly fallback: FinancialProviderName | undefined
}

export class FinancialProviderCompositionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'FinancialProviderCompositionError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function readFinancialProviderConfig(environment: FinancialProviderEnvironment = process.env): FinancialProviderConfig {
  const mode = readAllowed(environment.FINANCIAL_PROVIDER_MODE, FINANCIAL_PROVIDER_MODES, 'FINANCIAL_PROVIDER_MODE', 'real')
  const primaryProvider = readAllowed(environment.FINANCIAL_PRIMARY_PROVIDER, FINANCIAL_PROVIDER_NAMES, 'FINANCIAL_PRIMARY_PROVIDER', 'tushare-financial')
  const fallbackProvider = readOptionalAllowed(environment.FINANCIAL_FALLBACK_PROVIDER, FINANCIAL_PROVIDER_NAMES, 'FINANCIAL_FALLBACK_PROVIDER')
  if (fallbackProvider !== undefined && fallbackProvider === primaryProvider) {
    throw new ProviderConfigurationError('FINANCIAL_FALLBACK_PROVIDER must differ from FINANCIAL_PRIMARY_PROVIDER')
  }
  const tushareEndpoint = readEndpoint(environment.TUSHARE_FINANCIAL_ENDPOINT, 'https://api.tushare.pro', 'TUSHARE_FINANCIAL_ENDPOINT')
  const akshareEndpoint = readOptionalEndpoint(environment.AKSHARE_FINANCIAL_ENDPOINT, 'AKSHARE_FINANCIAL_ENDPOINT')
  const tushareToken = readOptionalString(environment.TUSHARE_TOKEN)
  if (mode === 'real' && (primaryProvider === 'tushare-financial' || fallbackProvider === 'tushare-financial') && tushareToken === undefined) {
    throw new ProviderConfigurationError('TUSHARE_TOKEN is required when Tushare is the primary financial provider')
  }
  if (mode === 'real' && (primaryProvider === 'akshare-financial' || fallbackProvider === 'akshare-financial') && akshareEndpoint === undefined) {
    throw new ProviderConfigurationError('AKSHARE_FINANCIAL_ENDPOINT is required when AkShare is selected')
  }
  return Object.freeze({ mode, tushareToken, tushareEndpoint, akshareEndpoint, primaryProvider, fallbackProvider })
}

export function createFinancialProviderComposition(options: FinancialProviderCompositionOptions = {}): FinancialProviderComposition {
  const config = readFinancialProviderConfig(options.environment)
  const registry = new ProviderRegistry()
  const adapters = options.adapters ?? {}
  const transport = options.transport ?? createNativeFetchTransport()
  const clock = options.clock
  const primaryAdapter = injectedOrConfiguredAdapter(config.primaryProvider, adapters, config, transport, clock)
  const primaryHandle = registry.register(primaryAdapter)
  const fallbackHandle = config.fallbackProvider === undefined
    ? undefined
    : registry.register(injectedOrConfiguredAdapter(config.fallbackProvider, adapters, config, transport, clock))
  const primary = registry.get(primaryHandle)
  const fallback = fallbackHandle === undefined ? undefined : registry.get(fallbackHandle)
  const composition: FinancialProvider = {
    name: 'financial-provider-composition',
    async fetch(request) {
      try {
        return await primary.fetch(request)
      } catch (primaryCause) {
        if (fallback === undefined) {
          throw new FinancialProviderCompositionError(`${config.primaryProvider} financial provider failed`, primaryCause)
        }
        try {
          return await fallback.fetch(request)
        } catch (fallbackCause) {
          throw new FinancialProviderCompositionError(
            `${config.primaryProvider} failed and ${config.fallbackProvider} fallback failed`,
            new AggregateError([primaryCause, fallbackCause]),
          )
        }
      }
    },
    validate(value: unknown): asserts value is FinancialData {
      validateFinancialData(value)
    },
  }
  const financial = registry.register(composition)
  return { registry, financial, primary: config.primaryProvider, fallback: config.fallbackProvider }
}

function createConfiguredAdapter(
  name: FinancialProviderName,
  config: FinancialProviderConfig,
  transport: NativeFetchTransport,
  clock: (() => Date) | undefined,
): FinancialProvider {
  if (config.mode === 'fixture') {
    throw new ProviderConfigurationError(`fixture mode requires an injected ${name} adapter`)
  }
  if (name === 'tushare-financial') {
    const options: TushareFinancialProviderOptions = { endpoint: config.tushareEndpoint, token: config.tushareToken, transport, clock }
    return new TushareFinancialProvider(options)
  }
  const options: AkShareFinancialProviderOptions = { endpoint: config.akshareEndpoint, transport, clock }
  return new AkShareFinancialProvider(options)
}

function injectedOrConfiguredAdapter(
  name: FinancialProviderName,
  adapters: Partial<Record<FinancialProviderName, FinancialProvider>>,
  config: FinancialProviderConfig,
  transport: NativeFetchTransport,
  clock: (() => Date) | undefined,
): FinancialProvider {
  const injected = adapters[name]
  if (injected !== undefined) {
    if (injected.name !== name) {
      throw new ProviderConfigurationError(`injected adapter for ${name} must expose name ${name}`)
    }
    return injected
  }
  return createConfiguredAdapter(name, config, transport, clock)
}

function readAllowed<const T extends string>(value: string | undefined, allowed: readonly T[], variable: string, fallback: T): T {
  const normalized = readOptionalString(value) ?? fallback
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new ProviderConfigurationError(`${variable} must be one of: ${allowed.join(', ')}`)
  }
  return normalized as T
}

function readOptionalAllowed<const T extends string>(value: string | undefined, allowed: readonly T[], variable: string): T | undefined {
  const normalized = readOptionalString(value)
  if (normalized === undefined) return undefined
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new ProviderConfigurationError(`${variable} must be one of: ${allowed.join(', ')}`)
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
  if (endpoint !== undefined) validateEndpoint(endpoint, variable)
  return endpoint
}

function validateEndpoint(endpoint: string, variable: string): void {
  try {
    const parsed = new URL(endpoint)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username.length > 0 || parsed.password.length > 0) throw new Error()
  } catch {
    throw new ProviderConfigurationError(`${variable} must be a valid HTTP(S) URL without credentials`)
  }
}
