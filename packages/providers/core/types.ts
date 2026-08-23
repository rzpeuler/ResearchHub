/** Coarse quality classifications for data supplied by a Provider. */
export const FINANCIAL_DATA_QUALITIES = ['high', 'medium', 'low'] as const

export type FinancialDataQuality = (typeof FINANCIAL_DATA_QUALITIES)[number]

/** Values that can safely cross the Provider JSON boundary. */
export type JsonPrimitive = null | boolean | number | string

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export type JsonObject = {
  [key: string]: JsonValue
}

/** Traceability metadata that accompanies every Provider result. */
export interface FinancialDataMetadata {
  source: string
  timestamp: string
  quality: FinancialDataQuality
  confidence: number
}

/** The value returned by a DataProvider, together with its source context.
 *
 * TData remains open for domain-specific static types, but every fetched value
 * must satisfy the runtime JSON-safe boundary before it leaves the Registry.
 */
export interface ProviderResult<TData> {
  data: TData
  metadata: FinancialDataMetadata
}

/** Stable boundary between a capability and a financial data source. */
export interface DataProvider<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<ProviderResult<TData>>
  validate(value: unknown): asserts value is TData
}

/** Type-safe registration token returned by ProviderRegistry.register(). */
export const PROVIDER_HANDLE = Symbol('ProviderHandle')

/** Runtime marker paired with PROVIDER_HANDLE. */
export const PROVIDER_HANDLE_MARKER = Object.freeze({
  request: <T>(value: T): T => value,
  data: <T>(value: T): T => value,
})

export interface ProviderHandle<TRequest, TData> {
  readonly name: string
  readonly [PROVIDER_HANDLE]: {
    readonly request: (value: TRequest) => TRequest
    readonly data: (value: TData) => TData
  }
}

/** Provider returned by name-only lookup; its data type is intentionally unknown. */
export type UnknownDataProvider = DataProvider<unknown, unknown>
