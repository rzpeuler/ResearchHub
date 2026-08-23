import { AnnouncementPluginError } from './errors.ts'
import type { RawAnnouncementRecord } from './types.ts'

export function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnnouncementPluginError(message)
  }
}

export function readRequiredString(
  value: Record<string, unknown>,
  aliases: readonly string[],
  field: string,
): string {
  for (const alias of aliases) {
    const candidate = value[alias]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  throw new AnnouncementPluginError(`announcement source response is missing ${field}`)
}

export function readOptionalString(value: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const candidate = value[alias]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return undefined
}

export function readOptionalConfidence(value: Record<string, unknown>): number | undefined {
  const candidate = value.confidence
  if (candidate === undefined || candidate === null || candidate === '') {
    return undefined
  }

  const confidence = typeof candidate === 'number' ? candidate : Number(candidate)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AnnouncementPluginError('announcement source confidence must be between 0 and 1')
  }
  return confidence
}

export function normalizePublishedAt(value: string): string {
  const trimmed = value.trim()
  const localDate = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(trimmed)
  const candidate = localDate === null
    ? trimmed
    : `${localDate[1]}T${localDate[2] ?? '00:00:00'}+08:00`
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) {
    throw new AnnouncementPluginError(`invalid announcement publication time: ${value}`)
  }
  return parsed.toISOString()
}

export function normalizeSourceUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (/^https?:\/\//i.test(value)) {
    return value
  }
  return `https://static.cninfo.com.cn/${value.replace(/^\/+/, '')}`
}

export function parseRawAnnouncement(value: unknown): RawAnnouncementRecord {
  assertRecord(value, 'announcement source item must be an object')
  const sourceUrl = normalizeSourceUrl(readOptionalString(value, [
    'sourceUrl',
    'contentUrl',
    'announcementUrl',
    'adjunctUrl',
    'url',
  ]))
  const content = readOptionalString(value, [
    'content',
    'announcementContent',
    'contentText',
  ]) ?? sourceUrl

  if (content === undefined) {
    throw new AnnouncementPluginError('announcement source item is missing content or source URL')
  }

  return {
    title: readRequiredString(value, ['title', 'announcementTitle', 'announcement_title'], 'title'),
    content,
    publishedAt: normalizePublishedAt(readRequiredString(
      value,
      ['publishedAt', 'publishTime', 'announcementTime', 'announcement_time'],
      'publishedAt',
    )),
    source: readOptionalString(value, ['source', 'sourceName']) ?? 'cninfo',
    securityCode: readOptionalString(value, ['securityCode', 'secCode', 'stockCode', 'code', 'stock_code']),
    issuerName: readOptionalString(value, ['issuerName', 'secName', 'stockName', 'stock_name']),
    sourceUrl,
    confidence: readOptionalConfidence(value),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
