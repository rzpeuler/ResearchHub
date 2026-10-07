import { sha256 } from './hash.ts'
import type { CninfoManagementCommunicationRecord } from './management-communication.ts'
import type { ManagementCommunicationAcquisitionRequest, ExchangeQAPair, ManagementCommunicationDocument, NormalizationBatch, CommunicationProvenance, ManagementCommunicationDocumentType } from './management-communication-contracts.ts'

type Row = Readonly<Record<string, unknown>>

const DOCUMENT_TYPE_TOKENS: readonly [string, ManagementCommunicationDocumentType][] = [
  ['投资者关系活动记录表', 'INVESTOR_RELATIONS_RECORD'],
  ['投资者关系活动记录', 'INVESTOR_RELATIONS_RECORD'],
  ['业绩说明会召开情况', 'EARNINGS_BRIEFING'],
  ['业绩说明会活动记录', 'EARNINGS_BRIEFING'],
  ['业绩说明会投资者问答', 'EARNINGS_BRIEFING'],
]

export function normalizeCninfoDocuments(
  records: readonly CninfoManagementCommunicationRecord[],
  request: ManagementCommunicationAcquisitionRequest,
): NormalizationBatch<ManagementCommunicationDocument> {
  const diagnostics: string[] = []
  const values: ManagementCommunicationDocument[] = []
  for (const record of records) {
    const documentType = mapDocumentType(record.title)
    if (documentType === undefined) {
      diagnostics.push(`unmapped_documentType:cninfo:${record.title.slice(0, 120)}`)
      continue
    }
    const publishedAt = normalizeSourceTimestamp(record.publishedAt, 'CNINFO', 'publication')
    const retrievedAt = normalizeSourceTimestamp(record.retrievedAt, 'CNINFO', 'retrieval')
    if (publishedAt === undefined) {
      diagnostics.push(`invalid_publishedAt:cninfo:${record.sourceNativeId ?? record.sourceUrl}`)
      continue
    }
    if (retrievedAt === undefined) {
      diagnostics.push(`invalid_retrievedAt:cninfo:${record.sourceNativeId ?? record.sourceUrl}`)
      continue
    }
    if (isAfterAsOf(publishedAt, request.asOf)) {
      diagnostics.push(`future_publishedAt:cninfo:${record.sourceNativeId ?? record.sourceUrl}`)
      continue
    }
    if (record.content.trim() === '') {
      diagnostics.push(`empty_content:cninfo:${record.sourceNativeId ?? record.sourceUrl}`)
      continue
    }
    const source: CommunicationProvenance = {
      originPublisher: record.originPublisher ?? request.companyName ?? request.ticker,
      hostPlatform: 'CNINFO',
      retrievalProvider: 'cninfo-official-client',
      authority: 'S1_OFFICIAL',
      disclosureClass: 'OFFICIAL_IR',
      sourceUrl: record.sourceUrl,
      ...(record.sourceNativeId === undefined ? {} : { sourceNativeId: record.sourceNativeId }),
    }
    const idIdentity = record.sourceNativeId ?? `${request.ticker}|${publishedAt}|${record.title}|${record.sourceUrl}`
    values.push({
      id: `management-communication:cninfo:${sha256(idIdentity).slice(0, 32)}`,
      ticker: request.ticker,
      documentType,
      publishedAt,
      retrievedAt,
      title: record.title,
      content: record.content,
      source,
    })
  }
  return { values, diagnostics: boundedDiagnostics(diagnostics) }
}

export function normalizeExchangeQaRows(
  raw: unknown,
  request: ManagementCommunicationAcquisitionRequest,
  platform: ExchangeQAPair['platform'],
  retrievedAtValue: string,
): NormalizationBatch<ExchangeQAPair> {
  const diagnostics: string[] = []
  const values: ExchangeQAPair[] = []
  const timestampSource = platform === 'SZSE_HUDONGYI' ? 'SZSE_HUDONGYI' : 'SSE_EINTERACTION'
  const retrievedAt = normalizeSourceTimestamp(retrievedAtValue, timestampSource, 'retrieval')
  if (retrievedAt === undefined) return { values: [], diagnostics: [`invalid_retrievedAt:${platform}`] }
  for (const row of rows(raw)) {
    const ticker = normalizeTicker(read(row, ['股票代码', '证券代码', '代码', 'stockCode', 'SECURITY_CODE', 'ticker']))
    if (ticker === undefined) {
      diagnostics.push(`missing_ticker:${platform}`)
      continue
    }
    if (ticker !== request.ticker) {
      diagnostics.push(`ticker_mismatch:${platform}:${ticker}`)
      continue
    }
    const question = text(read(row, ['提问', '问题', 'question', 'questionContent', 'mainContent']))
    const answer = text(read(row, ['回答', '回答内容', '答复', 'answer', 'replyContent', 'attachedContent']))
    if (question === undefined) {
      diagnostics.push(`empty_question:${platform}`)
      continue
    }
    if (answer === undefined) {
      diagnostics.push(`empty_answer:${platform}`)
      continue
    }
    const questionAtValue = read(row, ['提问时间', '问题时间', 'questionAt', 'questionDate'])
    const questionAt = questionAtValue === undefined ? undefined : normalizeSourceTimestamp(questionAtValue, timestampSource, 'event')
    if (questionAtValue !== undefined && questionAt === undefined) {
      diagnostics.push(`invalid_questionAt:${platform}`)
      continue
    }
    const answeredAtValue = read(row, ['回答时间', '答复时间', '更新时间', 'answeredAt', 'replyDate', 'attachedPubDate'])
    const answeredAt = normalizeSourceTimestamp(answeredAtValue, timestampSource, 'event')
    if (answeredAt === undefined) {
      diagnostics.push(`missing_or_invalid_answeredAt:${platform}`)
      continue
    }
    const rawPublishedAt = read(row, ['publishedAt', 'publicAt', 'publicationTime', '发布时间'])
    const explicitPublishedAt = rawPublishedAt === undefined ? undefined : normalizeSourceTimestamp(rawPublishedAt, timestampSource, 'publication')
    if (rawPublishedAt !== undefined && explicitPublishedAt === undefined) {
      diagnostics.push(`invalid_publishedAt:${platform}`)
      continue
    }
    // These exchange endpoints expose answer/update time as the public reply time;
    // only this concrete source rule permits the deterministic equivalence.
    const publishedAt = explicitPublishedAt ?? normalizeSourceTimestamp(answeredAtValue, timestampSource, 'publication') ?? answeredAt
    if (isAfterAsOf(publishedAt, request.asOf)) {
      diagnostics.push(`future_publishedAt:${platform}:${publishedAt}`)
      continue
    }
    const sourceNativeId = text(read(row, ['问题编号', '回答ID', 'indexId', 'attachedId', 'questionId', 'id', '序号']))
    const source: CommunicationProvenance = {
      originPublisher: request.companyName ?? request.ticker,
      hostPlatform: platform === 'SZSE_HUDONGYI' ? 'CNINFO' : 'SSE_EINTERACTION',
      retrievalProvider: 'AKShare',
      authority: 'S1_OFFICIAL',
      disclosureClass: 'EXCHANGE_INTERACTION',
      sourceUrl: sourceNativeId === undefined
        ? platform === 'SZSE_HUDONGYI' ? 'https://irm.cninfo.com.cn/' : 'https://sns.sseinfo.com/'
        : platform === 'SZSE_HUDONGYI' ? `https://irm.cninfo.com.cn/ircs/question/questionDetail?questionId=${encodeURIComponent(sourceNativeId)}` : 'https://sns.sseinfo.com/',
      ...(sourceNativeId === undefined ? {} : { sourceNativeId }),
    }
    const identity = sourceNativeId === undefined ? `${platform}|${ticker}|${publishedAt}|${question}|${answer}` : `${platform}|${sourceNativeId}`
    values.push({
      id: `exchange-qa:${platform === 'SZSE_HUDONGYI' ? 'szse' : 'sse'}:${sha256(identity).slice(0, 32)}`,
      ticker,
      question,
      ...(questionAt === undefined ? {} : { questionAt }),
      answer,
      answeredAt,
      publishedAt,
      retrievedAt,
      platform,
      source,
    })
  }
  return { values, diagnostics: boundedDiagnostics(diagnostics) }
}

export function mapDocumentType(title: string): ManagementCommunicationDocumentType | undefined {
  const normalized = title.normalize('NFKC').replace(/\s+/g, '')
  if (normalized.includes('关于召开') || normalized.includes('召开') && normalized.includes('通知') || normalized.includes('通知') || normalized.includes('邀请') || normalized.includes('预告') || normalized.includes('问题征集')) return undefined
  return DOCUMENT_TYPE_TOKENS.find(([token]) => normalized.includes(token))?.[1]
}

function rows(value: unknown): readonly Row[] {
  if (Array.isArray(value)) return value.filter(isRow)
  if (isRow(value) && Array.isArray(value.data)) return value.data.filter(isRow)
  return []
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function read(row: Row, aliases: readonly string[]): unknown {
  for (const alias of aliases) if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias]
  return undefined
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized === '' ? undefined : normalized
}

function normalizeTicker(value: unknown): string | undefined {
  const valueText = text(value)
  if (valueText === undefined) return undefined
  const digits = valueText.replace(/\.0+$/, '')
  return /^\d{6}$/.test(digits) ? digits : undefined
}

export type CommunicationTimestampSource = 'CNINFO' | 'SZSE_HUDONGYI' | 'SSE_EINTERACTION' | 'EastMoney'
export type CommunicationTimestampRole = 'publication' | 'event' | 'retrieval'

export function normalizeSourceTimestamp(value: unknown, source: CommunicationTimestampSource, role: CommunicationTimestampRole): string | undefined {
  const offsetHours = ({ CNINFO: 8, SZSE_HUDONGYI: 8, SSE_EINTERACTION: 8, EastMoney: 8 } as const)[source]
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeEpoch(value)
  const raw = text(value)
  if (raw === undefined) return undefined
  if (/^\d{10,13}$/.test(raw)) return normalizeEpoch(Number(raw))
  const chinese = /^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (chinese) {
    const year = Number(chinese[1]); const month = Number(chinese[2]); const day = Number(chinese[3])
    if (chinese[4] === undefined) {
      if (role === 'event') return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return localSourceIso(year, month, day, 23, 59, 59, 999, offsetHours)
    }
    return localSourceIso(year, month, day, Number(chinese[4]), Number(chinese[5]), Number(chinese[6] ?? 0), 0, offsetHours)
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw)
  if (local && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return localSourceIso(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] ?? 0), Number((local[7] ?? '').padEnd(3, '0') || 0), offsetHours)
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

function localSourceIso(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number, offsetHours: number): string | undefined {
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetHours * 60 * 60 * 1000)
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
}

function normalizeEpoch(value: number): string | undefined {
  const date = new Date(Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function isAfterAsOf(publishedAt: string, asOf: string): boolean {
  const published = Date.parse(publishedAt)
  const cutoff = Date.parse(asOf)
  return Number.isNaN(published) || Number.isNaN(cutoff) || published > cutoff
}

function boundedDiagnostics(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right)).slice(0, 64)
}
