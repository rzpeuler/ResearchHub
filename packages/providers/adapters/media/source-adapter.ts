import { MediaProviderError } from './errors.ts'
import { MEDIA_SOURCE_TIERS } from '../information/index.ts'
import type { MediaSourceTier } from '../information/index.ts'
import type { ProfessionalMediaSourceAdapter, RawMediaRecord } from './types.ts'

export interface FixtureMediaSourceOptions {
  readonly records?: Readonly<Record<string, readonly RawMediaRecord[]>>
  readonly failure?: Error
}

/** Deterministic source adapter used by the MVP and all default tests. */
export class FixtureProfessionalMediaSourceAdapter implements ProfessionalMediaSourceAdapter {
  readonly name = 'fixture-professional-media-source'

  private readonly records: Readonly<Record<string, readonly RawMediaRecord[]>>
  private readonly failure: Error | undefined

  constructor(options: FixtureMediaSourceOptions = {}) {
    this.records = options.records ?? {}
    this.failure = options.failure
  }

  async fetch(request: { symbol: string; limit: number }): Promise<readonly RawMediaRecord[]> {
    if (this.failure !== undefined) {
      throw this.failure
    }
    return (this.records[request.symbol] ?? []).slice(0, request.limit).map((record) => ({ ...record }))
  }
}

export function normalizeMediaPublishedAt(value: string): string {
  const trimmed = value.trim()
  const localDate = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(trimmed)
  const candidate = localDate === null
    ? trimmed
    : `${localDate[1]}T${localDate[2] ?? '00:00:00'}+08:00`
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) {
    throw new MediaProviderError(`invalid media publication time: ${value}`)
  }
  return parsed.toISOString()
}

export function normalizeMediaSymbol(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const normalized = value.trim().toUpperCase().replace(/^(?:SH|SZ|BJ)[.:]?/, '').replace(/\.(?:SH|SZ|BJ)$/, '')
  return /^\d{6}$/.test(normalized) ? normalized : undefined
}

export function assertMediaTier(value: unknown): asserts value is MediaSourceTier {
  if (typeof value !== 'string' || !(MEDIA_SOURCE_TIERS as readonly string[]).includes(value)) {
    throw new MediaProviderError('media source tier must be tier-1, tier-2, or tier-3')
  }
}

export function assertMediaText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MediaProviderError(`media ${field} must not be empty`)
  }
}
