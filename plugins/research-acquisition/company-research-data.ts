import type { AcquisitionResult, DataRequirement, SourceExecutionResult } from '../../data/contracts.ts'
import { PHASE3_COMMON_SOURCE_POLICIES } from '../../data/company-research-policies.ts'
import { DataResolver } from '../../data/resolver.ts'
import { finalizeResearchEvidence, qualifyResearchEvidenceDate, type ResearchEvidenceBatch, type ResearchEvidenceInput, type UnqualifiedResearchEvidenceBatch } from '../../data/research-evidence.ts'
import { runResearchDataAcquisition } from '../../data/workflow.ts'
import type { AkshareDataClient } from './akshare.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchCompanyIdentity } from './contracts.ts'
import { validateUsableAcquisitionPayload } from './payload-validation.ts'

export interface CompanyProfileSnapshot {
  readonly kind: 'profile'
  readonly fields: readonly { readonly name: string; readonly value: string | number | boolean }[]
  readonly retrievedAt: string
  readonly historicalAvailability: 'UNVERIFIED'
}

export interface CompanyFinancialObservation {
  readonly periodEnd?: string
  readonly publishedAt?: string
  readonly metrics: Readonly<{ revenue?: number; netProfit?: number; grossMargin?: number; basicEps?: number; metric?: number }>
  readonly pointInTimeSafe: boolean
}
export interface CompanyFinancialHistory {
  readonly kind: 'financial'
  readonly rows: readonly CompanyFinancialObservation[]
  readonly retrievedAt: string
  readonly historicalAvailability: 'UNVERIFIED'
}

export interface CompanyMarketObservation {
  readonly observedAt: string
  readonly open?: number
  readonly high?: number
  readonly low?: number
  readonly close?: number
  readonly volume?: number
  readonly pointInTimeSafe: false
}
export interface CompanyMarketHistory {
  readonly kind: 'market'
  readonly rows: readonly CompanyMarketObservation[]
  readonly retrievedAt: string
  readonly historicalAvailability: 'UNVERIFIED'
}

export type CompanyResearchEvidenceBatch = ResearchEvidenceBatch<NormalizedResearchSource>
export type CompanyResearchDataPayload = CompanyProfileSnapshot | CompanyFinancialHistory | CompanyMarketHistory | CompanyResearchEvidenceBatch
type RawCompanyResearchDataPayload = CompanyProfileSnapshot | CompanyFinancialHistory | CompanyMarketHistory | UnqualifiedResearchEvidenceBatch<NormalizedResearchSource>

export interface CompanyResearchDataResolverOptions {
  readonly company: ResearchCompanyIdentity
  readonly akshare?: AkshareDataClient
  readonly officialDisclosure?: ResearchAcquisitionPlugin
  readonly gdelt?: ResearchAcquisitionPlugin
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly limitPerSource?: number
  /** Compatibility seam for Company signal projection, after discovery and before fetch. */
  readonly onCandidatesDiscovered?: (event: { readonly provider: 'CNINFO' | 'GDELT'; readonly candidates: readonly NormalizedResearchSource['candidate'][]; readonly requirement: DataRequirement }) => Promise<void | readonly NormalizedResearchSource['candidate'][]> | void | readonly NormalizedResearchSource['candidate'][]
}

/** Explicit AKShare, CNINFO, and GDELT operation composition. */
export function createCompanyResearchDataResolver(options: CompanyResearchDataResolverOptions): DataResolver<CompanyResearchDataPayload> {
  const execute = async (requirement: DataRequirement, operationId: string): Promise<SourceExecutionResult<RawCompanyResearchDataPayload>> => {
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const symbol = requirement.subject.ticker
    if (!symbol) return { status: 'UNSUPPORTED', diagnostic: 'COMPANY_TICKER_REQUIRED' }
    const akshare = options.akshare
    if (operationId === 'akshare.companyBasic' || operationId === 'akshare.financialData' || operationId === 'akshare.historicalMarketData') {
      if (!akshare) return { status: 'UNSUPPORTED', diagnostic: 'AKShare client is unavailable' }
      let raw: unknown
      try {
        raw = operationId === 'akshare.companyBasic' ? await akshare.companyBasic({ symbol })
          : operationId === 'akshare.financialData' ? await akshare.financialData({ symbol })
            : await akshare.historicalMarketData({ symbol, ...(requirement.period?.start ? { startDate: requirement.period.start.slice(0, 10).replace(/-/g, '') } : {}), ...(requirement.period?.end ? { endDate: requirement.period.end.slice(0, 10).replace(/-/g, '') } : {}) })
      } catch (error) {
        if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
        return { status: 'SOURCE_ERROR', diagnostic: boundedError(error) }
      }
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      const validation = validateUsableAcquisitionPayload(raw)
      if (validation.status !== 'usable') return { status: validation.status === 'empty' ? 'NO_DATA' : 'SOURCE_ERROR', diagnostic: validation.reason }
      const retrievedAt = options.now()
      const rows = dataRows(raw)
      if (rows.length === 0) return { status: 'NO_DATA', diagnostic: 'AKShare returned no structured rows' }
      const data = operationId === 'akshare.companyBasic' ? normalizeProfile(rows, retrievedAt)
        : operationId === 'akshare.financialData' ? normalizeFinancial(rows, requirement, retrievedAt)
          : normalizeMarket(rows, requirement, retrievedAt)
      if (data.kind !== 'profile' && data.rows.length === 0) return { status: 'NO_DATA', diagnostic: 'No eligible structured observations' }
      if (data.kind === 'profile' && data.fields.length === 0) return { status: 'NO_DATA', diagnostic: 'No usable company profile fields' }
      return { status: 'SUCCESS', data, source: { retrievalProvider: 'AKShare', retrievedAt, ...(data.kind === 'market' ? { observedAt: data.rows.at(-1)?.observedAt, valueVersion: { status: 'UNVERIFIED', reason: 'Market observation availability is not versioned' } as const } : {}), ...(data.kind === 'financial' ? { valueVersion: { status: 'UNVERIFIED', reason: 'Historical financial value version is not identified' } as const } : {}) } }
    }
    if (operationId === 'cninfo.discoverFetchNormalizeCompanyEvidence' || operationId === 'gdelt.discoverFetchNormalizeCompanyEvidence') {
      const plugin = operationId.startsWith('cninfo.') ? options.officialDisclosure : options.gdelt
      if (!plugin) return { status: 'UNSUPPORTED', diagnostic: `${operationId} plugin is unavailable` }
      return acquireDocuments(plugin, operationId.startsWith('cninfo.') ? 'CNINFO' : 'GDELT', requirement, options)
    }
    return { status: 'UNSUPPORTED', diagnostic: `UNKNOWN_COMPANY_RESEARCH_OPERATION:${operationId}` }
  }
  return new DataResolver<CompanyResearchDataPayload>({
    policies: PHASE3_COMMON_SOURCE_POLICIES,
    now: options.now,
    signal: options.signal,
    // resolveAcquisition below is the sole execution path for these explicit operations.
    executor: async () => ({ status: 'UNSUPPORTED', diagnostic: 'Use the explicit Company research acquisition path' }),
    resolveAcquisition: async (requirement): Promise<AcquisitionResult<CompanyResearchDataPayload>> => {
      const acquired = await runResearchDataAcquisition<RawCompanyResearchDataPayload>({
        requirement, policies: PHASE3_COMMON_SOURCE_POLICIES, now: options.now, signal: options.signal,
        executor: (item, candidate) => execute(item, candidate.operationId),
      })
      if (requirement.metricId !== 'company_research_evidence') return acquired as AcquisitionResult<CompanyResearchDataPayload>
      return finalizeResearchEvidence(requirement, acquired as AcquisitionResult<UnqualifiedResearchEvidenceBatch<NormalizedResearchSource>>)
    },
  })
}

async function acquireDocuments(
  plugin: ResearchAcquisitionPlugin,
  provider: 'CNINFO' | 'GDELT',
  requirement: DataRequirement,
  options: CompanyResearchDataResolverOptions,
): Promise<SourceExecutionResult<RawCompanyResearchDataPayload>> {
  const company = requirement.subject.ticker === options.company.symbol ? options.company : { symbol: requirement.subject.ticker!, name: requirement.subject.companyId }
  let discovered: readonly NormalizedResearchSource['candidate'][]
  try {
    discovered = await plugin.discover({ company, asOf: requirement.analysisAsOf ?? requirement.asOf, limitPerKind: Math.max(0, Math.min(20, options.limitPerSource ?? 6)) }, options.signal)
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
    return { status: 'SOURCE_ERROR', diagnostic: boundedError(error) }
  }
  if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
  const selected = await options.onCandidatesDiscovered?.({ provider, candidates: discovered, requirement })
  if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
  const originalCandidates = new Set(discovered)
  const eligible = selected === undefined ? discovered : selected.filter((candidate) => originalCandidates.has(candidate))
  const documents: ResearchEvidenceInput<NormalizedResearchSource>[] = []
  const diagnostics: string[] = []
  let fetched = 0
  let fetchSucceeded = false
  let failed = 0
  let empty = 0
  let rejected = discovered.length - eligible.length
  if (rejected > 0) diagnostics.push(`consumer_pre_fetch_guard_rejected:${rejected}`)
  for (const candidate of eligible.slice(0, Math.max(0, Math.min(20, options.limitPerSource ?? 6)))) {
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const candidateDate = candidate.publishedAt ?? (provider === 'GDELT' && candidate.snippet ? candidate.snippet : undefined)
    const dateStatus = qualifyResearchEvidenceDate(candidateDate, requirement)
    if (dateStatus === 'INVALID' || dateStatus === 'FUTURE' || dateStatus === 'OUTSIDE_PERIOD') { rejected += 1; diagnostics.push(`${candidate.candidateId}:${dateStatus}`); continue }
    try {
      const fetchedSource = await plugin.fetch(candidate, options.signal)
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      fetchSucceeded = true
      const fetchedValidation = validateUsableAcquisitionPayload(fetchedSource.content)
      if (fetchedValidation.status !== 'usable') { fetchedValidation.status === 'empty' ? empty += 1 : failed += 1; diagnostics.push(`${candidate.candidateId}:${fetchedValidation.reason}`); continue }
      const normalized = await plugin.normalize(fetchedSource, options.signal)
      if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
      const normalizedValidation = validateUsableAcquisitionPayload(normalized.content)
      if (normalizedValidation.status !== 'usable') { normalizedValidation.status === 'empty' ? empty += 1 : failed += 1; diagnostics.push(`${candidate.candidateId}:${normalizedValidation.reason}`); continue }
      fetched += 1
      const originPublisher = provider === 'CNINFO' ? 'CNINFO' : reliableOriginalPublisher(candidate)
      documents.push({ record: normalized, publishedAt: candidate.publishedAt, retrievedAt: normalized.retrievedAt, sourceUrl: normalized.canonicalUrl ?? candidate.url, contentHash: normalized.contentHash, retrievalProvider: provider, ...(originPublisher ? { originPublisher } : {}) })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
      failed += 1
      diagnostics.push(`${candidate.candidateId}:${boundedError(error)}`)
    }
  }
  const outcome = { transportSucceeded: true, fetchSucceeded, discovered: discovered.length, fetched, failed, empty, rejected, deduplicated: 0, diagnostics }
  return { status: 'SUCCESS', data: { kind: 'evidence', documents, outcome }, source: { retrievalProvider: provider, retrievedAt: options.now() } }
}

function reliableOriginalPublisher(candidate: NormalizedResearchSource['candidate']): string | undefined {
  const explicit = candidate.metadata?.originalPublisher
  if (typeof explicit === 'string' && explicit.trim() && !/^gdelt$/i.test(explicit.trim())) return explicit.trim()
  return undefined
}

function dataRows(raw: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
  if (typeof raw === 'object' && raw !== null) {
    const object = raw as Record<string, unknown>
    for (const key of ['data', 'rows', 'records', 'results', 'items']) if (Array.isArray(object[key])) return dataRows(object[key])
    return [object]
  }
  return []
}

function normalizeProfile(rows: readonly Record<string, unknown>[], retrievedAt: string): CompanyProfileSnapshot {
  const fields: { name: string; value: string | number | boolean }[] = []
  for (const row of rows) {
    const fieldName = text(row.item) ?? text(row.name) ?? text(row.字段)
    const fieldValue = scalar(row.value ?? row.值)
    if (fieldName && fieldValue !== undefined) fields.push({ name: fieldName, value: fieldValue })
    else for (const [name, raw] of Object.entries(row)) {
      const value = scalar(raw)
      if (value !== undefined) fields.push({ name, value })
    }
  }
  return { kind: 'profile', fields, retrievedAt, historicalAvailability: 'UNVERIFIED' }
}

function normalizeFinancial(rows: readonly Record<string, unknown>[], requirement: DataRequirement, retrievedAt: string): CompanyFinancialHistory {
  const observations: CompanyFinancialObservation[] = []
  for (const row of rows) {
    const periodEnd = normalizeProviderDate(row.report_date ?? row.REPORT_DATE ?? row.reportDate, true)
    const publishedAt = normalizeProviderDate(row.publication_date ?? row.NOTICE_DATE ?? row.publicationDate)
    if (publishedAt && !['QUALIFIED', 'UNKNOWN'].includes(qualifyResearchEvidenceDate(publishedAt, requirement))) continue
    if (periodEnd && !['QUALIFIED', 'UNKNOWN'].includes(qualifyResearchEvidenceDate(periodEnd, requirement))) continue
    const metrics = { revenue: numeric(row.operating_revenue ?? row.TOTALOPERATEREVE), netProfit: numeric(row.net_profit ?? row.PARENTNETPROFIT), grossMargin: numeric(row.gross_margin ?? row.XSMLL), basicEps: numeric(row.basic_eps ?? row.EPSJB), metric: numeric(row.metric ?? row.value) }
    if (Object.values(metrics).every((value) => value === undefined)) continue
    observations.push({ ...(periodEnd ? { periodEnd } : {}), ...(publishedAt ? { publishedAt } : {}), metrics, pointInTimeSafe: false })
  }
  return { kind: 'financial', rows: observations, retrievedAt, historicalAvailability: 'UNVERIFIED' }
}

function normalizeMarket(rows: readonly Record<string, unknown>[], requirement: DataRequirement, retrievedAt: string): CompanyMarketHistory {
  const observations: CompanyMarketObservation[] = []
  for (const row of rows) {
    const observedAt = normalizeProviderDate(row.date ?? row.日期 ?? row.trade_date ?? row.交易日期, true)
    if (!observedAt || qualifyResearchEvidenceDate(observedAt, requirement) !== 'QUALIFIED') continue
    const values = { open: numeric(row.open ?? row.开盘), high: numeric(row.high ?? row.最高), low: numeric(row.low ?? row.最低), close: numeric(row.close ?? row.收盘), volume: numeric(row.volume ?? row.成交量) }
    if (Object.values(values).every((value) => value === undefined)) continue
    observations.push({ observedAt, ...values, pointInTimeSafe: false })
  }
  return { kind: 'market', rows: observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt)), retrievedAt, historicalAvailability: 'UNVERIFIED' }
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function normalizeProviderDate(value: unknown, calendarOnly = false): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? String(value) : calendarOnly ? date.toISOString().slice(0, 10) : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return undefined
  const raw = value.trim()
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const calendar = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(raw)
  if (calendar) return calendarOnly || !calendar[2] ? calendar[1] : `${calendar[1]}T${calendar[2]}+08:00`
  return raw
}
function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return typeof value === 'boolean' ? value : undefined
}
function numeric(value: unknown): number | undefined { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/,/g, '').replace(/%$/, '')) : Number.NaN; return Number.isFinite(parsed) ? parsed : undefined }
function boundedError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 240) }
