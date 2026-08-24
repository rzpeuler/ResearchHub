import { PluginRegistry } from '../registry/index.ts'
import type { PluginHandle } from '../core/index.ts'
import { PluginConfigurationError } from '../config.ts'
import { createNativeFetchTransport, type NativeFetchTransport } from '../transport/index.ts'
import { AkShareFinancialPlugin, type AkShareFinancialPluginOptions } from '../adapters/financial/akshare/index.ts'
import { TushareFinancialPlugin, type TushareFinancialPluginOptions } from '../adapters/financial/tushare-financial-plugin.ts'
import { validateFinancialData } from '../adapters/financial/normalization.ts'
import type { FinancialData, FinancialDataRequest, FinancialDataPlugin } from '../adapters/financial/types.ts'

export const FINANCIAL_PLUGIN_NAMES = ['tushare-financial', 'akshare-financial'] as const
export type FinancialPluginName = (typeof FINANCIAL_PLUGIN_NAMES)[number]
export const FINANCIAL_PLUGIN_MODES = ['real', 'fixture'] as const
export type FinancialPluginMode = (typeof FINANCIAL_PLUGIN_MODES)[number]

export interface FinancialPluginEnvironment {
  readonly [key: string]: string | undefined
  readonly TUSHARE_TOKEN?: string
  readonly TUSHARE_FINANCIAL_ENDPOINT?: string
  readonly AKSHARE_FINANCIAL_ENDPOINT?: string
  readonly FINANCIAL_PRIMARY_PLUGIN?: string
  readonly FINANCIAL_FALLBACK_PLUGIN?: string
  readonly FINANCIAL_PLUGIN_MODE?: string
}

export interface FinancialPluginConfig {
  readonly mode: FinancialPluginMode
  readonly tushareToken?: string
  readonly tushareEndpoint: string
  readonly akshareEndpoint?: string
  readonly primaryPlugin: FinancialPluginName
  readonly fallbackPlugin?: FinancialPluginName
}

export interface FinancialPluginCompositionOptions {
  readonly environment?: FinancialPluginEnvironment
  readonly transport?: NativeFetchTransport
  readonly clock?: () => Date
  readonly adapters?: Partial<Record<FinancialPluginName, FinancialDataPlugin>>
}

export interface FinancialPluginComposition {
  readonly registry: PluginRegistry
  readonly financial: PluginHandle<FinancialDataRequest, FinancialData>
  readonly primary: FinancialPluginName
  readonly fallback: FinancialPluginName | undefined
}

export class FinancialPluginCompositionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'FinancialPluginCompositionError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function readFinancialPluginConfig(environment: FinancialPluginEnvironment = process.env): FinancialPluginConfig {
  const mode = readAllowed(environment.FINANCIAL_PLUGIN_MODE, FINANCIAL_PLUGIN_MODES, 'FINANCIAL_PLUGIN_MODE', 'real')
  const primaryPlugin = readAllowed(environment.FINANCIAL_PRIMARY_PLUGIN, FINANCIAL_PLUGIN_NAMES, 'FINANCIAL_PRIMARY_PLUGIN', 'akshare-financial')
  const fallbackPlugin = readOptionalAllowed(environment.FINANCIAL_FALLBACK_PLUGIN, FINANCIAL_PLUGIN_NAMES, 'FINANCIAL_FALLBACK_PLUGIN')
  if (fallbackPlugin !== undefined && fallbackPlugin === primaryPlugin) {
    throw new PluginConfigurationError('FINANCIAL_FALLBACK_PLUGIN must differ from FINANCIAL_PRIMARY_PLUGIN')
  }
  const tushareEndpoint = readEndpoint(environment.TUSHARE_FINANCIAL_ENDPOINT, 'https://api.tushare.pro', 'TUSHARE_FINANCIAL_ENDPOINT')
  const akshareEndpoint = readOptionalEndpoint(environment.AKSHARE_FINANCIAL_ENDPOINT, 'AKSHARE_FINANCIAL_ENDPOINT')
  const tushareToken = readOptionalString(environment.TUSHARE_TOKEN)
  if (mode === 'real' && (primaryPlugin === 'tushare-financial' || fallbackPlugin === 'tushare-financial') && tushareToken === undefined) {
    throw new PluginConfigurationError('TUSHARE_TOKEN is required when Tushare is the primary financial plugin')
  }
  if (mode === 'real' && (primaryPlugin === 'akshare-financial' || fallbackPlugin === 'akshare-financial') && akshareEndpoint === undefined) {
    throw new PluginConfigurationError('AKSHARE_FINANCIAL_ENDPOINT is required when AkShare is selected')
  }
  return Object.freeze({ mode, tushareToken, tushareEndpoint, akshareEndpoint, primaryPlugin, fallbackPlugin })
}

export function createFinancialPluginComposition(options: FinancialPluginCompositionOptions = {}): FinancialPluginComposition {
  const config = readFinancialPluginConfig(options.environment)
  const registry = new PluginRegistry()
  const adapters = options.adapters ?? {}
  const transport = options.transport ?? createNativeFetchTransport()
  const clock = options.clock
  const primaryAdapter = injectedOrConfiguredAdapter(config.primaryPlugin, adapters, config, transport, clock)
  const primaryHandle = registry.register(primaryAdapter)
  const fallbackHandle = config.fallbackPlugin === undefined
    ? undefined
    : registry.register(injectedOrConfiguredAdapter(config.fallbackPlugin, adapters, config, transport, clock))
  const primary = registry.get(primaryHandle)
  const fallback = fallbackHandle === undefined ? undefined : registry.get(fallbackHandle)
  const composition: FinancialDataPlugin = {
    name: 'financial-plugin-composition',
    async fetch(request) {
      try {
        return await primary.fetch(request)
      } catch (primaryCause) {
        if (fallback === undefined) {
          throw new FinancialPluginCompositionError(`${config.primaryPlugin} financial plugin failed`, primaryCause)
        }
        try {
          return await fallback.fetch(request)
        } catch (fallbackCause) {
          throw new FinancialPluginCompositionError(
            `${config.primaryPlugin} failed and ${config.fallbackPlugin} fallback failed`,
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
  return { registry, financial, primary: config.primaryPlugin, fallback: config.fallbackPlugin }
}

function createConfiguredAdapter(
  name: FinancialPluginName,
  config: FinancialPluginConfig,
  transport: NativeFetchTransport,
  clock: (() => Date) | undefined,
): FinancialDataPlugin {
  if (config.mode === 'fixture') {
    throw new PluginConfigurationError(`fixture mode requires an injected ${name} adapter`)
  }
  if (name === 'tushare-financial') {
    const options: TushareFinancialPluginOptions = { endpoint: config.tushareEndpoint, token: config.tushareToken, transport, clock }
    return new TushareFinancialPlugin(options)
  }
  const options: AkShareFinancialPluginOptions = { endpoint: config.akshareEndpoint, transport, clock }
  return new AkShareFinancialPlugin(options)
}

function injectedOrConfiguredAdapter(
  name: FinancialPluginName,
  adapters: Partial<Record<FinancialPluginName, FinancialDataPlugin>>,
  config: FinancialPluginConfig,
  transport: NativeFetchTransport,
  clock: (() => Date) | undefined,
): FinancialDataPlugin {
  const injected = adapters[name]
  if (injected !== undefined) {
    if (injected.name !== name) {
      throw new PluginConfigurationError(`injected adapter for ${name} must expose name ${name}`)
    }
    return injected
  }
  return createConfiguredAdapter(name, config, transport, clock)
}

function readAllowed<const T extends string>(value: string | undefined, allowed: readonly T[], variable: string, fallback: T): T {
  const normalized = readOptionalString(value) ?? fallback
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new PluginConfigurationError(`${variable} must be one of: ${allowed.join(', ')}`)
  }
  return normalized as T
}

function readOptionalAllowed<const T extends string>(value: string | undefined, allowed: readonly T[], variable: string): T | undefined {
  const normalized = readOptionalString(value)
  if (normalized === undefined) return undefined
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new PluginConfigurationError(`${variable} must be one of: ${allowed.join(', ')}`)
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
    throw new PluginConfigurationError(`${variable} must be a valid HTTP(S) URL without credentials`)
  }
}
