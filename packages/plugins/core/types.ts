/** Coarse quality classifications for data supplied by a Plugin. */
export const FINANCIAL_DATA_QUALITIES = ['high', 'medium', 'low'] as const

export type FinancialDataQuality = (typeof FINANCIAL_DATA_QUALITIES)[number]

/** Values that can safely cross the Plugin JSON boundary. */
export type JsonPrimitive = null | boolean | number | string

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export type JsonObject = {
  [key: string]: JsonValue
}

/** Traceability metadata that accompanies every Plugin result. */
export interface FinancialDataMetadata {
  plugin: string
  source: string
  timestamp: string
  quality: FinancialDataQuality
  confidence: number
}

/** The value returned by a DataPlugin, together with its source context.
 *
 * TData remains open for domain-specific static types, but every fetched value
 * must satisfy the runtime JSON-safe boundary before it leaves the Registry.
 */
export interface PluginResult<TData> {
  data: TData
  metadata: FinancialDataMetadata
}

/** Stable boundary between a Plugin operation and an external data source. */
export interface DataPlugin<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<PluginResult<TData>>
  validate(value: unknown): asserts value is TData
}

/** Type-safe registration token returned by PluginRegistry.register(). */
export const PLUGIN_HANDLE = Symbol('PluginHandle')

/** Runtime marker paired with PLUGIN_HANDLE. */
export const PLUGIN_HANDLE_MARKER = Object.freeze({
  request: <T>(value: T): T => value,
  data: <T>(value: T): T => value,
})

export interface PluginHandle<TRequest, TData> {
  readonly name: string
  readonly [PLUGIN_HANDLE]: {
    readonly request: (value: TRequest) => TRequest
    readonly data: (value: TData) => TData
  }
}

/** Plugin returned by name-only lookup; its data type is intentionally unknown. */
export type UnknownDataPlugin = DataPlugin<unknown, unknown>
