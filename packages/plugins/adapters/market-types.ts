import { PluginError, PluginValidationError } from '../core/index.ts'

/** Stable request shape shared by Market data adapters without importing a Plugin. */
export interface MarketPluginRequest {
  symbol: string
}

/** Common normalized Market snapshot returned by every Market data adapter. */
export interface MarketAdapterData {
  symbol: string
  price: number
  change: number
  volume: number
  source: string
}

export function normalizeMarketPluginRequest(value: MarketPluginRequest): MarketPluginRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected a Market plugin request')
  }

  const symbol = value.symbol
  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    throw new PluginValidationError('expected a non-empty symbol', '$.symbol')
  }

  return { symbol: symbol.trim().toUpperCase() }
}

export function validateMarketAdapterData(value: unknown): asserts value is MarketAdapterData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected Market plugin data to be an object')
  }

  const data = value as Record<string, unknown>
  assertAllowedFields(data, new Set(['symbol', 'price', 'change', 'volume', 'source']))
  assertNonEmptyString(data.symbol, '$.symbol')
  assertFiniteNumber(data.price, '$.price')
  assertFiniteNumber(data.change, '$.change')
  assertFiniteNumber(data.volume, '$.volume')
  assertNonEmptyString(data.source, '$.source')
}

export function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value
    }
  } else if (typeof value === 'string') {
    const normalized = value.trim().replaceAll(',', '')
    if (normalized.length > 0) {
      const parsed = Number(normalized)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  throw new MarketPluginError(`invalid numeric field: ${field}`)
}

export function readRequiredField(
  row: Record<string, unknown>,
  aliases: readonly string[],
  field: string,
): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== undefined && row[alias] !== null) {
      return row[alias]
    }
  }

  throw new MarketPluginError(`missing required field: ${field}`)
}

export function readOptionalField(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== undefined && row[alias] !== null) {
      return row[alias]
    }
  }

  return undefined
}

export function canonicalMarketSymbol(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MarketPluginError('invalid market symbol in plugin response')
  }

  return value.trim().toUpperCase().replace(/\.(?:SH|SZ|BJ)$/, '')
}

export function timestampFromSource(value: unknown, clock: () => Date): string {
  if (value !== undefined && value !== null && String(value).length > 0) {
    return parseStrictPluginTimestamp(String(value)).toISOString()
  }

  const retrievalTime = clock()
  if (!(retrievalTime instanceof Date) || Number.isNaN(retrievalTime.getTime())) {
    throw new MarketPluginError('invalid plugin clock timestamp')
  }
  return retrievalTime.toISOString()
}

function createUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new MarketPluginError('invalid plugin timestamp')
  }
  return date
}

function parseStrictPluginTimestamp(value: string): Date {
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (match !== null) {
    return createUtcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }

  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match !== null) {
    return createUtcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }

  match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (match === null) {
    throw new MarketPluginError('invalid plugin timestamp')
  }

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (hour > 23 || minute > 59 || second > 59) {
    throw new MarketPluginError('invalid plugin timestamp')
  }

  const milliseconds = fractionToMilliseconds(match[7])
  const utcDate = createUtcDateTime(year, month, day, hour, minute, second, milliseconds)
  const timezone = match[8]
  if (timezone === 'Z') {
    return utcDate
  }

  const timezoneMatch = /^([+-])(\d{2}):(\d{2})$/.exec(timezone)
  if (timezoneMatch === null) {
    throw new MarketPluginError('invalid plugin timestamp')
  }
  const offsetHours = Number(timezoneMatch[2])
  const offsetMinutes = Number(timezoneMatch[3])
  if (offsetHours > 23 || offsetMinutes > 59) {
    throw new MarketPluginError('invalid plugin timestamp')
  }

  const signedOffset = (offsetHours * 60 + offsetMinutes) * (timezoneMatch[1] === '+' ? 1 : -1)
  const timestamp = utcDate.getTime() - signedOffset * 60 * 1000
  const normalized = new Date(timestamp)
  if (Number.isNaN(normalized.getTime())) {
    throw new MarketPluginError('invalid plugin timestamp')
  }
  return normalized
}

function createUtcDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  milliseconds: number,
): Date {
  const date = createUtcDate(year, month, day)
  date.setUTCHours(hour, minute, second, milliseconds)
  if (
    date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== milliseconds
  ) {
    throw new MarketPluginError('invalid plugin timestamp')
  }
  return date
}

function fractionToMilliseconds(fraction: string | undefined): number {
  if (fraction === undefined) {
    return 0
  }
  return Number(fraction.slice(0, 3).padEnd(3, '0'))
}

export class MarketPluginError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'MarketPluginError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function requireHttpEndpoint(endpoint: string | undefined, pluginName: string): string {
  if (endpoint === undefined || endpoint.trim().length === 0) {
    throw new MarketPluginError(`${pluginName} plugin is disabled: endpoint is not configured`)
  }

  const normalized = endpoint.trim()
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      throw new MarketPluginError(`${pluginName} endpoint must not include username/password credentials`)
    }
  } catch {
    if (endpointHasUserinfo(normalized)) {
      throw new MarketPluginError(`${pluginName} endpoint must not include username/password credentials`)
    }
    throw new MarketPluginError(`${pluginName} endpoint must be a valid HTTP(S) URL`)
  }

  return normalized
}

export function safePluginMessage(value: unknown, secrets?: string | readonly (string | undefined)[]): string {
  let message = value instanceof Error ? value.message : String(value)
  const values = secrets === undefined ? [] : Array.isArray(secrets) ? secrets : [secrets]
  for (const secret of values) {
    if (secret !== undefined && secret.length > 0) {
      message = message.replaceAll(secret, '[REDACTED]')
    }
  }
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+@/gi, '$1[REDACTED]@')
}

function endpointHasUserinfo(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint)
    return parsed.username.length > 0 || parsed.password.length > 0
  } catch {
    return false
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new PluginValidationError(`unknown field: ${key}`, `$.${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginValidationError('expected a non-empty string', path)
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PluginValidationError('expected a finite number', path)
  }
}
