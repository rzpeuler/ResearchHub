import { sha256 } from './hash.ts'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentInputResolver } from '../document/input-resolver.ts'
import type { NormalizedResearchSource, ResearchFetchedSource, ResearchSourceCandidate } from './contracts.ts'
import type { IndustryTargetInput } from '../../skills/industry-research/contracts.ts'
import type { DataDeterminismClass, SourceAuthority } from '../../workflows/research-data-acquisition/contracts.ts'

export type IndustryObservationClass = 'PRODUCTION' | 'TRADE' | 'PRICE'
export type IndustryObservationQualifier = 'EXACT' | 'LOWER_BOUND' | 'UPPER_BOUND'
export type IndustryObservationAggregation = 'PERIOD' | 'YTD' | 'POINT_IN_TIME'
export type IndustryObservationPit = 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE'
export type IndustryObservationMissingness = 'MISSING' | 'NOT_REPORTED' | 'NOT_APPLICABLE' | 'SOURCE_UNAVAILABLE' | 'TRANSPORT_UNAVAILABLE' | 'PARSER_UNAVAILABLE'
export type IndustryOperatingObservationStatus = 'COMPLETED' | 'PARTIAL' | 'SCOPE_UNSUPPORTED' | 'SOURCE_UNAVAILABLE' | 'TRANSPORT_UNAVAILABLE' | 'PARSER_UNAVAILABLE'

export interface IndustryOperatingObservation {
  readonly observationId: string
  readonly metricKey: string
  readonly observationClass: IndustryObservationClass
  readonly value: number
  readonly qualifier: IndustryObservationQualifier
  readonly unit: string
  readonly originalValue: string | number
  readonly originalUnit: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly frequency: string
  readonly aggregation: IndustryObservationAggregation
  readonly geography: string
  readonly productOrSegment: string
  readonly publishedAt: string
  readonly retrievedAt: string
  readonly originPublisher: string
  readonly hostPlatform: string
  readonly retrievalProvider: string
  readonly sourceAuthority: SourceAuthority
  readonly determinismClass: DataDeterminismClass
  readonly sourceCandidateId: string
  readonly sourceRef?: string
  readonly publicationPit: IndustryObservationPit
  readonly valueVersionPit: IndustryObservationPit
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface IndustryOperatingObservationRequest {
  readonly target: IndustryTargetInput
  readonly asOf: string
  readonly now: () => string
  readonly signal?: AbortSignal
}

export interface IndustryOperatingObservationAcquisitionResult {
  readonly status: IndustryOperatingObservationStatus
  readonly observations: readonly IndustryOperatingObservation[]
  readonly sources: readonly NormalizedResearchSource[]
  readonly diagnostics: readonly string[]
}

export interface IndustryOperatingObservationAcquisitionPort {
  acquire(request: IndustryOperatingObservationRequest): Promise<IndustryOperatingObservationAcquisitionResult>
}

export interface IndustryOperatingObservationAcquisitionOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: () => string
  readonly timeoutMs?: number
  readonly maxPayloadBytes?: number
  readonly documentResolver?: Pick<DocumentInputResolver, 'parse'>
  readonly urls?: Partial<{
    readonly nbs: string
    readonly miitH1: string
    readonly miitAnnual: string
    readonly cheaaSeptember2024: string
    readonly cheaaJuly2025: string
  }>
}

export interface ObservationParserContext {
  readonly sourceCandidateId: string
  readonly sourceRef?: string
  readonly publishedAt: string
  readonly retrievedAt: string
  readonly originPublisher: string
  readonly hostPlatform: string
  readonly retrievalProvider: string
  readonly sourceAuthority: SourceAuthority
  readonly determinismClass: DataDeterminismClass
  readonly metadata?: Readonly<Record<string, unknown>>
}

const AUTHORITIES: readonly SourceAuthority[] = ['S0_STATUTORY', 'S1_OFFICIAL', 'S2_PROFESSIONAL', 'S3_AGGREGATOR', 'S4_COMMUNITY']
const DETERMINISM: readonly DataDeterminismClass[] = ['AUTHORITATIVE_NUMERIC', 'EVIDENCE_BACKED_NUMERIC', 'SEMANTIC_QUALITATIVE']
const FREQUENCIES = new Set(['ANNUAL', 'H1', 'QUARTERLY', 'MONTHLY'])
const HTTPS = /^https:\/\//i
const TRACKING_PARAMETERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'source', 'share'])
const DEFAULT_URLS = {
  nbs: 'https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202603/P020260302324456002021.pdf',
  miitH1: 'https://wap.miit.gov.cn/gxsj/tjfx/dzxx/art/2026/art_09763880ab3b4f3da2dcd747b0a4058d.html',
  miitAnnual: 'https://www.miit.gov.cn/gxsj/tjfx/dzxx/art/2025/art_f59c26cfa29d41e299f875c46f66aaff.html',
  cheaaSeptember2024: 'https://www.cheaa.org/upload/file/20241210/6386944728591111044948028.pdf',
  cheaaJuly2025: 'https://www.cheaa.org/upload/file/20250928/6389465323530752764793788.pdf',
} as const

function clean(value: string, max = 1000): string { return value.normalize('NFKC').replace(/[\u00a0\t ]+/g, ' ').trim().slice(0, max) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function parseNumber(value: string): number | undefined {
  const normalized = value.normalize('NFKC').replace(/[，,\s]/g, '').replace(/[％%]$/, '')
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}
function dateOnlyEndOfDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 15, 59, 59, 999)).toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}
export function normalizePitDate(value: string): string { return dateOnlyEndOfDay(value) }
export function isPublishedBy(publishedAt: string, asOf: string): boolean {
  const publication = Date.parse(normalizePitDate(publishedAt)); const cutoff = Date.parse(normalizePitDate(asOf))
  return !Number.isNaN(publication) && !Number.isNaN(cutoff) && publication <= cutoff
}
function iso(value: string): boolean { return !Number.isNaN(Date.parse(value)) }
function canonicalUrl(value: string): string {
  const url = new URL(value); url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key)
  return url.toString()
}
function slotOf(observation: IndustryOperatingObservation): string { return stable({ metricKey: observation.metricKey, periodStart: observation.periodStart, periodEnd: observation.periodEnd, aggregation: observation.aggregation, geography: observation.geography, productOrSegment: observation.productOrSegment }) }

export function deterministicIndustryObservationId(input: Pick<IndustryOperatingObservation, 'metricKey' | 'periodStart' | 'periodEnd' | 'aggregation' | 'geography' | 'productOrSegment' | 'sourceCandidateId'>): string {
  return `observation-${sha256(stable({ metricKey: input.metricKey, periodStart: input.periodStart, periodEnd: input.periodEnd, aggregation: input.aggregation, geography: input.geography, productOrSegment: input.productOrSegment, sourceCandidateId: input.sourceCandidateId })).slice(0, 24)}`
}

export function validateIndustryOperatingObservation(value: unknown): IndustryOperatingObservation {
  if (!isRecord(value)) throw new TypeError('IndustryOperatingObservation must be an object')
  const requiredStrings = ['observationId', 'metricKey', 'unit', 'originalUnit', 'periodStart', 'periodEnd', 'frequency', 'geography', 'productOrSegment', 'publishedAt', 'retrievedAt', 'originPublisher', 'hostPlatform', 'retrievalProvider', 'sourceCandidateId']
  for (const key of requiredStrings) if (typeof value[key] !== 'string' || !String(value[key]).trim()) throw new TypeError(`IndustryOperatingObservation.${key} is required`)
  if (!['PRODUCTION', 'TRADE', 'PRICE'].includes(String(value.observationClass))) throw new TypeError('Unsupported observationClass')
  if (!['EXACT', 'LOWER_BOUND', 'UPPER_BOUND'].includes(String(value.qualifier))) throw new TypeError('Unsupported qualifier')
  if (!['PERIOD', 'YTD', 'POINT_IN_TIME'].includes(String(value.aggregation))) throw new TypeError('Unsupported aggregation')
  if (!FREQUENCIES.has(String(value.frequency))) throw new TypeError('Unsupported frequency')
  if (!Number.isFinite(value.value)) throw new TypeError('Observation value must be finite')
  if (typeof value.originalValue !== 'string' && typeof value.originalValue !== 'number') throw new TypeError('originalValue is required')
  if (!AUTHORITIES.includes(value.sourceAuthority as SourceAuthority)) throw new TypeError('Unsupported sourceAuthority')
  if (!DETERMINISM.includes(value.determinismClass as DataDeterminismClass)) throw new TypeError('Unsupported determinismClass')
  if (!['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE'].includes(String(value.publicationPit))) throw new TypeError('Unsupported publicationPit')
  if (!['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE'].includes(String(value.valueVersionPit))) throw new TypeError('Unsupported valueVersionPit')
  if (!iso(String(value.periodStart)) || !iso(String(value.periodEnd)) || Date.parse(String(value.periodEnd)) < Date.parse(String(value.periodStart))) throw new TypeError('Invalid observation period')
  if (!iso(String(value.publishedAt)) || !iso(String(value.retrievedAt))) throw new TypeError('Invalid observation timestamps')
  if (!isRecord(value.metadata)) throw new TypeError('metadata is required')
  const expected = deterministicIndustryObservationId(value as unknown as Pick<IndustryOperatingObservation, 'metricKey' | 'periodStart' | 'periodEnd' | 'aggregation' | 'geography' | 'productOrSegment' | 'sourceCandidateId'>)
  if (value.observationId !== expected) throw new TypeError('observationId is not deterministic for the observation identity')
  return value as unknown as IndustryOperatingObservation
}

export function createIndustryOperatingObservation(input: Omit<IndustryOperatingObservation, 'observationId'>): IndustryOperatingObservation {
  const observation = { ...input, observationId: deterministicIndustryObservationId(input) }
  return validateIndustryOperatingObservation(observation)
}

export function mergeIndustryOperatingObservations(observations: readonly IndustryOperatingObservation[]): { readonly observations: readonly IndustryOperatingObservation[]; readonly diagnostics: readonly string[] } {
  const byId = new Map<string, IndustryOperatingObservation>(); const bySlot = new Map<string, IndustryOperatingObservation[]>(); const diagnostics: string[] = []
  for (const observation of observations) {
    validateIndustryOperatingObservation(observation)
    if (!byId.has(observation.observationId)) byId.set(observation.observationId, observation)
    const slot = slotOf(observation); const list = bySlot.get(slot) ?? []; list.push(observation); bySlot.set(slot, list)
  }
  for (const [slot, list] of bySlot) {
    const values = new Set(list.map((item) => `${item.value}|${item.qualifier}|${item.unit}`))
    if (values.size > 1) diagnostics.push(`OBSERVATION_CONFLICT:${slot}`)
  }
  return { observations: [...byId.values()].sort((a, b) => a.observationId.localeCompare(b.observationId)), diagnostics: diagnostics.sort() }
}

function parserContext(context: ObservationParserContext | undefined, fallback: Partial<ObservationParserContext> = {}): ObservationParserContext {
  return {
    sourceCandidateId: context?.sourceCandidateId ?? fallback.sourceCandidateId ?? 'fixture-source',
    ...(context?.sourceRef ?? fallback.sourceRef ? { sourceRef: context?.sourceRef ?? fallback.sourceRef } : {}),
    publishedAt: context?.publishedAt ?? fallback.publishedAt ?? '2026-01-01T00:00:00.000Z',
    retrievedAt: context?.retrievedAt ?? fallback.retrievedAt ?? '2026-01-01T00:00:00.000Z',
    originPublisher: context?.originPublisher ?? fallback.originPublisher ?? 'Unknown',
    hostPlatform: context?.hostPlatform ?? fallback.hostPlatform ?? 'Unknown',
    retrievalProvider: context?.retrievalProvider ?? fallback.retrievalProvider ?? 'ResearchHub direct HTTPS',
    sourceAuthority: context?.sourceAuthority ?? fallback.sourceAuthority ?? 'S1_OFFICIAL',
    determinismClass: context?.determinismClass ?? fallback.determinismClass ?? 'EVIDENCE_BACKED_NUMERIC',
    metadata: { ...(fallback.metadata ?? {}), ...(context?.metadata ?? {}) },
  }
}
function contextWith(ctx: ObservationParserContext, metadata: Record<string, unknown>): ObservationParserContext { return { ...ctx, metadata: { ...(ctx.metadata ?? {}), ...metadata } } }
function base(ctx: ObservationParserContext, values: Omit<IndustryOperatingObservation, 'observationId' | 'publishedAt' | 'retrievedAt' | 'originPublisher' | 'hostPlatform' | 'retrievalProvider' | 'sourceAuthority' | 'determinismClass' | 'sourceCandidateId' | 'sourceRef' | 'publicationPit' | 'valueVersionPit' | 'metadata'> & { readonly metadata?: Readonly<Record<string, unknown>> }): IndustryOperatingObservation {
  return createIndustryOperatingObservation({ ...values, publishedAt: normalizePitDate(ctx.publishedAt), retrievedAt: ctx.retrievedAt, originPublisher: ctx.originPublisher, hostPlatform: ctx.hostPlatform, retrievalProvider: ctx.retrievalProvider, sourceAuthority: ctx.sourceAuthority, determinismClass: ctx.determinismClass, sourceCandidateId: ctx.sourceCandidateId, ...(ctx.sourceRef === undefined ? {} : { sourceRef: ctx.sourceRef }), publicationPit: 'VERIFIED', valueVersionPit: 'UNVERIFIED', metadata: { ...(ctx.metadata ?? {}), ...(values.metadata ?? {}) } })
}

interface TextParserContext { readonly context?: ObservationParserContext; readonly periodStart?: string; readonly periodEnd?: string; readonly publishedAt?: string; readonly retrievedAt?: string }
function textContext(context?: ObservationParserContext, overrides: TextParserContext = {}): ObservationParserContext {
  return parserContext(context, { publishedAt: overrides.publishedAt, retrievedAt: overrides.retrievedAt })
}
function linesOf(text: string): string[] { return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean) }
function cellsOf(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((cell) => clean(cell)).filter(Boolean)
  if (line.includes('\t')) return line.split('\t').map((cell) => clean(cell)).filter(Boolean)
  return line.split(/\s{2,}/).map((cell) => clean(cell)).filter(Boolean)
}
function yearPeriod(year: number): { readonly periodStart: string; readonly periodEnd: string } { return { periodStart: `${year}-01-01T00:00:00.000Z`, periodEnd: `${year}-12-31T23:59:59.999Z` } }
function monthPeriod(period: string): { readonly periodStart: string; readonly periodEnd: string } | undefined {
  const match = /^(20\d{2})[-年\/](0?[1-9]|1[0-2])$/.exec(period.trim()); if (!match) return undefined
  const year = Number(match[1]); const month = Number(match[2]); const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { periodStart: `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`, periodEnd: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z` }
}

export function parseNbsAnnualAirConditionerProduction(text: string, context?: ObservationParserContext): IndustryOperatingObservation | undefined {
  const rows = linesOf(text); const rowIndex = rows.findIndex((line) => /房间空气调节器/.test(line)); if (rowIndex < 0) return undefined
  const headerWindow = rows.slice(Math.max(0, rowIndex - 8), rowIndex).join(' ')
  const row = cellsOf(rows[rowIndex]!)
  const unitIndex = row.findIndex((cell) => /万台|台/.test(cell)); const numericCells = row.map((cell, index) => ({ value: parseNumber(cell), index })).filter((item): item is { value: number; index: number } => item.value !== undefined)
  const year = /表\s*3\s*2025\s*年|2025\s*年\s*规模以上工业主要产品产量/i.test(text) || /2025(?:年|\b)/.test(headerWindow) || /2025/.test(rows[rowIndex]!) ? 2025 : undefined
  let unit = unitIndex >= 0 ? row[unitIndex]!.match(/万台|台/)?.[0] : undefined
  let numeric = unitIndex >= 0 ? numericCells.find((item) => item.index > unitIndex)?.value : numericCells[0]?.value
  let originalValue = numericCells.find((item) => item.value === numeric)?.value === undefined ? undefined : row[numericCells.find((item) => item.value === numeric)!.index]
  if (!unit || numeric === undefined) {
    const productHeaderIndex = rows.slice(0, rowIndex).map((line, index) => ({ line, index })).reverse().find((item) => /产品名称/.test(item.line))?.index
    const verticalUnitHeaderIndex = productHeaderIndex === undefined ? undefined : rows.findIndex((line, index) => index > productHeaderIndex && /^(单位|计量单位)$/.test(line))
    const unitHeaderIndex = verticalUnitHeaderIndex ?? -1
    const productionHeaderIndex = unitHeaderIndex < 0 ? -1 : rows.findIndex((line, index) => index > unitHeaderIndex && /^产量$/.test(line))
    if (productHeaderIndex !== undefined && unitHeaderIndex >= 0 && productionHeaderIndex >= 0) {
      const productEntries = rows.slice(productHeaderIndex + 1, unitHeaderIndex).filter((line) => !/^\[\s*\d+\s*\]$/.test(line))
      const productOffset = productEntries.findIndex((line) => /房间空气调节器/.test(line))
      const units = rows.slice(unitHeaderIndex + 1, productionHeaderIndex).filter((line) => !/^\[\s*\d+\s*\]$/.test(line))
      const values = rows.slice(productionHeaderIndex + 1).filter((line) => !/^\[\s*\d+\s*\]$/.test(line))
      unit = productOffset >= 0 ? units[productOffset]?.match(/万台|台/)?.[0] : undefined
      numeric = productOffset >= 0 ? parseNumber(values[productOffset] ?? '') : undefined
      originalValue = productOffset >= 0 ? values[productOffset] : undefined
    }
  }
  if (numeric === undefined) return undefined
  if (year !== 2025 || !unit || !/(产品|指标|项目|单位|产量|工业产品)/.test(`${headerWindow} ${text}`) || !/(2025|年度|年)/.test(text)) return undefined
  const ctx = textContext(context, { publishedAt: context?.publishedAt, retrievedAt: context?.retrievedAt }); const period = yearPeriod(year)
  return base(ctx, { metricKey: 'room_air_conditioner.production', observationClass: 'PRODUCTION', value: numeric, qualifier: 'EXACT', unit, originalValue: originalValue ?? String(numeric), originalUnit: unit, ...period, frequency: 'ANNUAL', aggregation: 'PERIOD', geography: 'China national', productOrSegment: '房间空气调节器' })
}

function miitPeriod(text: string, periodHint = ''): { readonly periodStart: string; readonly periodEnd: string; readonly frequency: string; readonly aggregation: IndustryObservationAggregation } | undefined {
  if (/2026\s*(年)?\s*(上半年|H1|1\s*[—-]\s*6月|January\s*(?:to|-)\s*June)/i.test(text)) return { periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-06-30T23:59:59.999Z', frequency: 'H1', aggregation: 'YTD' }
  if (periodHint.trim() === '2024' || /2024\s*年(?:全国|锂离子电池|锂电池)/i.test(text) || /2024\s*(年)?\s*(全年|年度|full[- ]year|annual)/i.test(text)) return { ...yearPeriod(2024), frequency: 'ANNUAL', aggregation: 'PERIOD' }
  return undefined
}
function miitNumber(text: string, pattern: RegExp): { readonly value: number; readonly raw: string; readonly qualifier: IndustryObservationQualifier } | undefined {
  const match = pattern.exec(text); if (!match) return undefined; const value = parseNumber(match[1]!.replace(/[>＞]/g, '')); if (value === undefined) return undefined
  const valueIndex = match[0]!.lastIndexOf(match[1]!); const localText = match[0]!.slice(Math.max(0, valueIndex - 40), valueIndex + match[1]!.length + 12)
  return { value, raw: match[1]!, qualifier: /[>＞]|超过|above|more than|over/i.test(localText) ? 'LOWER_BOUND' : /[<＜]|低于|below|less than/i.test(localText) ? 'UPPER_BOUND' : 'EXACT' }
}

export function parseMiitLithiumOperatingObservations(text: string, context?: ObservationParserContext): readonly IndustryOperatingObservation[] {
  if (!/(锂离子电池|lithium[- ]ion battery|lithium battery)/i.test(text)) return []
  const period = miitPeriod(text, String(context?.metadata?.period ?? '')); if (!period) return []
  const ctx = textContext(context); const output: IndustryOperatingObservation[] = []
  const production = miitNumber(text, /(?:锂离子电池|锂电池|lithium[- ]ion battery)[\s\S]{0,220}?(?:产量|产出|output)[\s\S]{0,100}?(?:超过|大于|above|over|>)?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(GWh|吉瓦时)/i)
  if (production) output.push(base(ctx, { metricKey: 'lithium_battery.total_output', observationClass: 'PRODUCTION', value: production.value, qualifier: production.qualifier, unit: 'GWh', originalValue: production.raw, originalUnit: 'GWh', ...period, geography: 'China national', productOrSegment: '锂离子电池', metadata: { ...(ctx.metadata ?? {}), sourceMethod: 'MIIT official article', qualifierText: 'article-reported output threshold' } }))
  const price = (label: RegExp, metricKey: string, productOrSegment: string): IndustryOperatingObservation | undefined => {
    let match = label.exec(text); let raw = match?.[1]; let matchedText = match?.[0] ?? ''
    const pair = /(?:电池级)?碳酸锂和氢氧化锂\s*[（(]?\s*(微粉级)?\s*[）)]?[\s\S]{0,32}?(?:均价|平均价格)分别为\s*([0-9][0-9,.]*)\s*(万元\/吨|元\/吨)[\s\S]{0,30}?和\s*([0-9][0-9,.]*)\s*(万元\/吨|元\/吨)/i.exec(text)
    const carbonateMetric = metricKey.endsWith('carbonate_average_price')
    const selected = pair ? carbonateMetric ? [pair[2], pair[3]] : [pair[4], pair[5]] : undefined
    if (selected) { raw = selected[0]; matchedText = `${selected[0]}${selected[1]}` }
    if (!raw) return undefined
    const numeric = parseNumber(raw); if (numeric === undefined) return undefined
    const unit = /万元\/吨|10,?000 yuan\/tonne|10000 yuan\/tonne/i.test(matchedText) ? '万元/吨' : /元\/吨|yuan\/tonne/i.test(matchedText) ? '元/吨' : undefined
    if (!unit) return undefined
    const pairedProduct = pair ? carbonateMetric ? '电池级碳酸锂' : `氢氧化锂${pair[1] ? `（${pair[1]}）` : ''}` : productOrSegment
    return base(contextWith(ctx, { priceMethod: 'article-period average price', priceNot: ['spot', 'futures', 'ASP', 'daily'] }), { metricKey, observationClass: 'PRICE', value: numeric, qualifier: 'EXACT', unit, originalValue: raw, originalUnit: unit, periodStart: period.periodStart, periodEnd: period.periodEnd, frequency: period.frequency, aggregation: 'PERIOD', geography: 'China national', productOrSegment: pairedProduct })
  }
  const carbonate = price(/(?:电池级)?(?:碳酸锂|lithium carbonate)[\s\S]{0,180}?(?:平均价格|均价|average price)[^\d]{0,30}([0-9][0-9,.]*)\s*(万元\/吨|元\/吨|10,?000 yuan\/tonne|yuan\/tonne)/i, 'lithium_battery.lithium_carbonate_average_price', 'battery-grade lithium carbonate')
  const hydroxide = price(/(?:氢氧化锂|lithium hydroxide)[\s\S]{0,180}?(?:平均价格|均价|average price)[^\d]{0,30}([0-9][0-9,.]*)\s*(万元\/吨|元\/吨|10,?000 yuan\/tonne|yuan\/tonne)/i, 'lithium_battery.lithium_hydroxide_average_price', 'lithium hydroxide')
  if (carbonate) output.push(carbonate); if (hydroxide) output.push(hydroxide)
  return output
}

export function parseCheaaHouseholdAirConditionerExport(text: string, context?: ObservationParserContext, periodHint?: string): IndustryOperatingObservation | undefined {
  const rows = linesOf(text); const headerIndex = rows.findIndex((line) => /当月数量\s*[（(]\s*台\s*[）)]/.test(line) && /累计数量/.test(line) && /当月金额/.test(line)); if (headerIndex < 0) return undefined
  const header = cellsOf(rows[headerIndex]!); const monthlyIndex = header.findIndex((cell) => /当月数量\s*[（(]\s*台\s*[）)]/.test(cell)); if (monthlyIndex < 0) return undefined
  const rowIndex = rows.findIndex((line, index) => index > headerIndex && /家用空调器/.test(line)); if (rowIndex < 0) return undefined
  const row = cellsOf(rows[rowIndex]!); let rawValue = row[monthlyIndex]
  let value = parseNumber(rawValue ?? '')
  if (value === undefined) {
    const horizontalMatch = /家用空调器\s+([0-9][0-9,]*)/.exec(rows[rowIndex]!)
    if (horizontalMatch) { rawValue = horizontalMatch[1]; value = parseNumber(rawValue) }
  }
  if (value === undefined) {
    const verticalValues = rows.slice(rowIndex + 1).filter((line) => !/^\[\s*\d+\s*\]$/.test(line)).slice(0, 6)
    rawValue = verticalValues[0]; value = parseNumber(rawValue ?? '')
  }
  if (value === undefined || rawValue === undefined) return undefined
  const periodValue = periodHint ?? String(context?.metadata?.period ?? '')
  const period = monthPeriod(periodValue); if (!period) return undefined
  const ctx = contextWith(textContext(context), { ...(context?.metadata ?? {}), sourceDataLabel: 'GACC', upstreamDataSource: 'GACC' })
  return base(ctx, { metricKey: 'air_conditioner.export_volume', observationClass: 'TRADE', value, qualifier: 'EXACT', unit: '台', originalValue: rawValue, originalUnit: '台', ...period, frequency: 'MONTHLY', aggregation: 'PERIOD', geography: 'China national exports', productOrSegment: '家用空调器' })
}

function candidate(spec: { readonly id: string; readonly url: string; readonly title: string; readonly provider: string; readonly kind: ResearchSourceCandidate['kind']; readonly tier: ResearchSourceCandidate['tier']; readonly publishedAt: string; readonly metadata?: Readonly<Record<string, unknown>> }): ResearchSourceCandidate {
  return { candidateId: spec.id, kind: spec.kind, tier: spec.tier, title: spec.title, url: canonicalUrl(spec.url), provider: spec.provider, publishedAt: spec.publishedAt, metadata: spec.metadata }
}
function allowedHost(url: string): boolean { try { const host = new URL(url).hostname.toLowerCase(); return host === 'stats.gov.cn' || host.endsWith('.stats.gov.cn') || host === 'miit.gov.cn' || host.endsWith('.miit.gov.cn') || host === 'cheaa.org' || host.endsWith('.cheaa.org') } catch { return false } }
async function readBounded(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) { const bytes = new TextEncoder().encode(await response.text()); if (bytes.byteLength > max) throw new Error('OPERATING_PAYLOAD_TOO_LARGE'); return bytes }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  for (;;) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; if (total > max) { await reader.cancel(); throw new Error('OPERATING_PAYLOAD_TOO_LARGE') } chunks.push(item.value) }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength } return bytes
}
async function pdfTextFallback(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'researchhub-d4-pdf-')); const path = join(directory, 'document.pdf'); await writeFile(path, bytes)
  const executable = process.env.RESEARCHHUB_PYTHON_EXECUTABLE?.trim() || 'python'; const script = "from pypdf import PdfReader; import sys; sys.stdout.reconfigure(encoding='utf-8'); reader=PdfReader(sys.argv[1]); print('\\n'.join((page.extract_text() or '') for page in reader.pages))"
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ['-c', script, path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (value: string) => { stdout += value }); child.stderr.on('data', (value: string) => { stderr += value }); child.on('error', (error) => reject(new Error(`PDF_TEXT_FALLBACK_FAILED:${error.message}`))); child.on('close', (code) => code === 0 && stdout.trim() ? resolve(stdout) : reject(new Error(`PDF_TEXT_FALLBACK_FAILED:${stderr.trim().slice(0, 240) || `exit_${code ?? 'unknown'}`}`)))
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED') }
function sourceFromFetched(fetched: ResearchFetchedSource, candidateValue: ResearchSourceCandidate, url: string): NormalizedResearchSource {
  return { candidate: { ...candidateValue, url }, retrievedAt: fetched.retrievedAt, title: candidateValue.title, content: fetched.content, canonicalUrl: url, contentHash: fetched.contentHash ?? sha256(fetched.rawBytes ?? new TextEncoder().encode(fetched.content)), rawBytes: fetched.rawBytes, publisher: String(candidateValue.metadata?.originPublisher ?? candidateValue.provider), rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } }
}

interface OperatingSourceSpec { readonly key: 'nbs' | 'miitH1' | 'miitAnnual' | 'cheaaSeptember2024' | 'cheaaJuly2025'; readonly candidate: ResearchSourceCandidate; readonly originPublisher: string; readonly hostPlatform: string; readonly sourceAuthority: SourceAuthority; readonly determinismClass: DataDeterminismClass; readonly expected: 'pdf' | 'html'; readonly period?: string }

export const INDUSTRY_OPERATING_SOURCE_URLS = DEFAULT_URLS

export class IndustryOperatingObservationAcquisition implements IndustryOperatingObservationAcquisitionPort {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly maxPayloadBytes: number
  private readonly resolver: Pick<DocumentInputResolver, 'parse'>
  private readonly urls: Record<keyof typeof DEFAULT_URLS, string>
  constructor(options: IndustryOperatingObservationAcquisitionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? (() => new Date().toISOString()); this.timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 15_000)); this.maxPayloadBytes = Math.min(16 * 1024 * 1024, Math.max(1024, options.maxPayloadBytes ?? 12 * 1024 * 1024)); this.resolver = options.documentResolver ?? new DocumentInputResolver(); this.urls = { ...DEFAULT_URLS, ...(options.urls ?? {}) }
  }
  private specs(target: IndustryTargetInput): readonly OperatingSourceSpec[] {
    const labels = [target.name, ...(target.aliases ?? [])].map((value) => value.trim().replace(/\s+/g, ' ').toLowerCase())
    const lithiumTarget = labels.some((label) => /^(?:锂电池|锂离子电池)(?:行业)?$/.test(label) || /^lithium(?:-ion)? battery(?: industry)?$/.test(label))
    if (lithiumTarget) return [
      { key: 'miitH1', candidate: candidate({ id: `d4-miit-h1-${sha256(canonicalUrl(this.urls.miitH1)).slice(0, 16)}`, url: this.urls.miitH1, title: 'MIIT 2026 H1 lithium-ion battery industry operation', provider: 'miit-d4', kind: 'official_disclosure', tier: 1, publishedAt: '2026-09-15T14:43:00.000Z', metadata: { originPublisher: 'MIIT', period: '2026-H1' } }), originPublisher: 'MIIT', hostPlatform: 'MIIT official web', sourceAuthority: 'S1_OFFICIAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', expected: 'html' },
      { key: 'miitAnnual', candidate: candidate({ id: `d4-miit-annual-${sha256(canonicalUrl(this.urls.miitAnnual)).slice(0, 16)}`, url: this.urls.miitAnnual, title: 'MIIT 2024 annual lithium-ion battery industry operation', provider: 'miit-d4', kind: 'official_disclosure', tier: 1, publishedAt: '2025-02-27T15:06:00.000Z', metadata: { originPublisher: 'MIIT', period: '2024' } }), originPublisher: 'MIIT', hostPlatform: 'MIIT official web', sourceAuthority: 'S1_OFFICIAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', expected: 'html' },
    ]
    const airConditionerTarget = labels.some((label) => /^(?:家用空调器|家用空调|房间空气调节器)(?:行业)?$/.test(label) || /^(?:household air conditioner|room air conditioner|air conditioner)(?: industry)?$/.test(label))
    if (airConditionerTarget) return [
      { key: 'nbs', candidate: candidate({ id: `d4-nbs-annual-${sha256(canonicalUrl(this.urls.nbs)).slice(0, 16)}`, url: this.urls.nbs, title: 'NBS 2025 annual statistical report', provider: 'nbs-d4', kind: 'official_disclosure', tier: 1, publishedAt: '2026-03-02T15:59:59.999Z', metadata: { originPublisher: 'National Bureau of Statistics', period: '2025' } }), originPublisher: 'National Bureau of Statistics', hostPlatform: 'NBS official web/PDF host', sourceAuthority: 'S0_STATUTORY', determinismClass: 'EVIDENCE_BACKED_NUMERIC', expected: 'pdf' },
      { key: 'cheaaSeptember2024', period: '2024-09', candidate: candidate({ id: `d4-cheaa-2024-09-${sha256(canonicalUrl(this.urls.cheaaSeptember2024)).slice(0, 16)}`, url: this.urls.cheaaSeptember2024, title: 'CHEAA September 2024 household air-conditioner export table', provider: 'cheaa-d4', kind: 'official_disclosure', tier: 2, publishedAt: '2024-11-08T15:59:59.999Z', metadata: { originPublisher: 'CHEAA', period: '2024-09', upstreamDataSource: 'GACC' } }), originPublisher: 'CHEAA', hostPlatform: 'CHEAA official web/PDF host', sourceAuthority: 'S2_PROFESSIONAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', expected: 'pdf' },
      { key: 'cheaaJuly2025', period: '2025-07', candidate: candidate({ id: `d4-cheaa-2025-07-${sha256(canonicalUrl(this.urls.cheaaJuly2025)).slice(0, 16)}`, url: this.urls.cheaaJuly2025, title: 'CHEAA July 2025 household air-conditioner export table', provider: 'cheaa-d4', kind: 'official_disclosure', tier: 2, publishedAt: '2025-09-08T15:59:59.999Z', metadata: { originPublisher: 'CHEAA', period: '2025-07', upstreamDataSource: 'GACC' } }), originPublisher: 'CHEAA', hostPlatform: 'CHEAA official web/PDF host', sourceAuthority: 'S2_PROFESSIONAL', determinismClass: 'EVIDENCE_BACKED_NUMERIC', expected: 'pdf' },
    ]
    return []
  }
  private async fetchSource(spec: OperatingSourceSpec, signal?: AbortSignal): Promise<NormalizedResearchSource> {
    const url = spec.candidate.url!; if (!HTTPS.test(url) || !allowedHost(url)) throw new Error('OPERATING_SOURCE_HOST_NOT_ALLOWED')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); const forward = () => controller.abort(); signal?.addEventListener('abort', forward, { once: true })
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept: spec.expected === 'pdf' ? 'application/pdf,application/octet-stream' : 'text/html,application/xhtml+xml,text/plain' } })
      const finalUrl = canonicalUrl(response.url || url); if (!allowedHost(finalUrl) || !HTTPS.test(finalUrl)) throw new Error('OPERATING_REDIRECT_HOST_NOT_ALLOWED')
      if (response.status === 403 && spec.key.startsWith('miit')) throw new Error('HTTP_403_ACCESS_GATE')
      if (!response.ok) throw new Error(`OPERATING_HTTP_${response.status}`)
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase(); if (spec.expected === 'pdf' && contentType && contentType !== 'application/pdf' && !/\.pdf$/i.test(finalUrl)) throw new Error('OPERATING_CONTENT_TYPE_INVALID'); if (spec.expected === 'html' && contentType && !['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) throw new Error('OPERATING_CONTENT_TYPE_INVALID')
      const bytes = await readBounded(response, this.maxPayloadBytes); const fetched: ResearchFetchedSource = { candidate: { ...spec.candidate, url: finalUrl }, retrievedAt: this.now(), content: new TextDecoder().decode(bytes), contentType, mediaType: spec.expected === 'pdf' ? 'application/pdf' : contentType || 'text/html', rawBytes: bytes, contentHash: sha256(bytes) }; return sourceFromFetched(fetched, spec.candidate, finalUrl)
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', forward) }
  }
  private async documentText(source: NormalizedResearchSource, expected: OperatingSourceSpec['expected']): Promise<string> {
    const bytes = source.rawBytes ?? new TextEncoder().encode(source.content)
    try { const document = await this.resolver.parse({ bytes: Uint8Array.from(bytes), filename: expected === 'pdf' ? 'source.pdf' : 'source.html', mediaType: expected === 'pdf' ? 'application/pdf' : 'text/html', documentId: `d4-${source.candidate.candidateId}` }); return document.normalizedText } catch (error) {
      if (expected !== 'pdf' || !(error instanceof Error) || !/document_parser_environment_not_ready/i.test(error.message)) throw error
      return pdfTextFallback(bytes)
    }
  }
  async acquire(request: IndustryOperatingObservationRequest): Promise<IndustryOperatingObservationAcquisitionResult> {
    const diagnostics: string[] = []; const sources: NormalizedResearchSource[] = []; const observations: IndustryOperatingObservation[] = []; const specs = this.specs(request.target)
    if (!specs.length) return { status: 'SCOPE_UNSUPPORTED', observations: [], sources: [], diagnostics: ['SCOPE_UNSUPPORTED'] }
    for (const spec of specs.slice(0, 6)) {
      abortIfNeeded(request.signal); if (spec.candidate.publishedAt && !isPublishedBy(spec.candidate.publishedAt, request.asOf)) { diagnostics.push(`PIT_SOURCE_NOT_FETCHED:${spec.candidate.candidateId}`); continue }
      try {
        const fetchedSource = await this.fetchSource(spec, request.signal); const text = await this.documentText(fetchedSource, spec.expected); const source = { ...fetchedSource, content: text }; sources.push(source); const ctx: ObservationParserContext = { sourceCandidateId: source.candidate.candidateId, publishedAt: source.candidate.publishedAt ?? request.now(), retrievedAt: source.retrievedAt, originPublisher: spec.originPublisher, hostPlatform: spec.hostPlatform, retrievalProvider: 'ResearchHub direct HTTPS', sourceAuthority: spec.sourceAuthority, determinismClass: spec.determinismClass, metadata: { ...(source.candidate.metadata ?? {}), canonicalUrl: source.canonicalUrl } }
        const parsed = spec.key === 'nbs' ? (parseNbsAnnualAirConditionerProduction(text, ctx) ? [parseNbsAnnualAirConditionerProduction(text, ctx)!] : []) : spec.key.startsWith('miit') ? parseMiitLithiumOperatingObservations(text, ctx) : (parseCheaaHouseholdAirConditionerExport(text, ctx, spec.period) ? [parseCheaaHouseholdAirConditionerExport(text, ctx, spec.period)!] : [])
        if (!parsed.length) diagnostics.push(`PARSER_SCHEMA_DRIFT:${source.candidate.candidateId}`); observations.push(...parsed)
      } catch (error) { const message = error instanceof Error ? error.message : String(error); diagnostics.push(`${spec.candidate.candidateId}:${message}`); if (message === 'WORKFLOW_CANCELLED') throw error }
    }
    const merged = mergeIndustryOperatingObservations(observations); diagnostics.push(...merged.diagnostics)
    const hasTransport = diagnostics.some((item) => /HTTP_|ACCESS_GATE|TRANSPORT|TIMEOUT|HOST_NOT_ALLOWED|CONTENT_TYPE/.test(item)); const hasParser = diagnostics.some((item) => /PARSER/.test(item)); const status: IndustryOperatingObservationStatus = merged.observations.length ? (diagnostics.length ? 'PARTIAL' : 'COMPLETED') : hasTransport ? 'TRANSPORT_UNAVAILABLE' : hasParser ? 'PARSER_UNAVAILABLE' : 'SOURCE_UNAVAILABLE'
    return { status, observations: merged.observations, sources, diagnostics: [...new Set(diagnostics)].slice(0, 64) }
  }
}

export function createDefaultIndustryOperatingObservationAcquisition(options: IndustryOperatingObservationAcquisitionOptions = {}): IndustryOperatingObservationAcquisitionPort { return new IndustryOperatingObservationAcquisition(options) }
