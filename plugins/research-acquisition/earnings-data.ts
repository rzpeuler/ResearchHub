import { DataResolver } from '../../data/resolver.ts'
import type { SourceExecutionResult } from '../../data/contracts.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import { earningsPeriodSpec, hasUsableExactPeriod, type EarningsPeriod, type NormalizedFinancialData } from '../../skills/earnings-review/financials.ts'
import type { NormalizedFinancialQualityData } from '../../skills/earnings-review/financial-quality/contracts.ts'
import { normalizeAkshareFinancialData, normalizeAksharePeriod } from './earnings-financial-normalization.ts'
import { normalizeFinancialQualityData } from './earnings-financial-quality-normalization.ts'
import { normalizeEastmoneyTimestamp } from './expectations/eastmoney-report.ts'
import { validateUsableAcquisitionPayload } from './payload-validation.ts'
import type { AkshareDataClient } from './akshare.ts'
import type { NormalizedResearchSource, ResearchAcquisitionDiagnostic, ResearchAcquisitionPlugin, ResearchCompanyIdentity, ResearchSourceCandidate } from './contracts.ts'
import type { EastmoneyEstimateSourceRequest, EastmoneyReportAcquisitionResult } from './expectations/contracts.ts'
import { projectThsInstitutionForecasts, THS_INSTITUTION_FORECAST_INDICATOR } from './earnings-expectations-ths.ts'
import { projectAkshareEastmoneyResearchReports } from './earnings-expectations-eastmoney-akshare.ts'
import { projectEastmoneyEstimatePoints, type EstimateProjectionResult } from './earnings-expectation-source-eastmoney.ts'

export interface EarningsFilingSelectionLike {
  readonly candidates: readonly ResearchSourceCandidate[]
  readonly diagnostics: readonly string[]
  readonly exactPeriodMatched: boolean
  readonly futureFilteredCount: number
}

export type EarningsDataPayload =
  | { readonly kind: 'filing'; readonly discovered: readonly ResearchSourceCandidate[]; readonly selection: EarningsFilingSelectionLike; readonly sources: readonly NormalizedResearchSource[]; readonly diagnostics: readonly ResearchAcquisitionDiagnostic[] }
  | { readonly kind: 'actual'; readonly raw: unknown; readonly normalized: NormalizedFinancialData; readonly financialQualityData: NormalizedFinancialQualityData; readonly metric: keyof NonNullable<NormalizedFinancialData['current']>['metrics']; readonly retrievedAt: string }
  | { readonly kind: 'expectation'; readonly projection: EstimateProjectionResult }

export interface EarningsDataCompositionOptions {
  readonly company: ResearchCompanyIdentity
  readonly fiscalYear: number
  readonly period: EarningsPeriod
  readonly asOf: string
  readonly now: () => string
  readonly signal?: AbortSignal
  readonly maxSources?: number
  readonly acquisitionPlugins: readonly ResearchAcquisitionPlugin[]
  readonly officialDisclosurePlugin?: ResearchAcquisitionPlugin
  readonly akshare?: AkshareDataClient
  readonly legacyEastmoney?: { acquire(request: EastmoneyEstimateSourceRequest): Promise<EastmoneyReportAcquisitionResult> }
  /** Exact-period and correction precedence remain Earnings domain logic. */
  readonly selectFilings?: (candidates: readonly ResearchSourceCandidate[], fiscalYear: number, period: EarningsPeriod, asOf: string) => EarningsFilingSelectionLike
}

export function hasConfiguredEarningsExpectationOperation(options: Pick<EarningsDataCompositionOptions, 'akshare' | 'legacyEastmoney'>): boolean {
  return options.akshare?.profitForecastThs !== undefined || options.akshare?.researchReportEm !== undefined || options.legacyEastmoney !== undefined
}

const actualMetricNames = {
  earnings_actual_revenue: 'revenue',
  earnings_actual_net_profit: 'net_profit',
  earnings_actual_gross_margin: 'gross_margin',
  earnings_actual_operating_cash_flow: 'operating_cash_flow',
  earnings_actual_eps: 'eps',
} as const

function rawRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
  if (value !== null && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return rawRows((value as { data: unknown }).data)
  return []
}

function publicationForPeriod(value: unknown, endDate: string): string | undefined {
  const row = rawRows(value).find((item) => normalizeAksharePeriod(item['报告期'] ?? item['报告日期'] ?? item['报告期末'] ?? item['日期'] ?? item.date ?? item.end_date ?? item.report_date ?? item.period) === endDate)
  if (!row) return undefined
  return normalizeEastmoneyTimestamp(row['公告日期'] ?? row['公告日'] ?? row.NOTICE_DATE ?? row.noticeDate ?? row.publishedAt)?.iso
}

function filterProjection(projection: EstimateProjectionResult, metric: 'eps' | 'net_profit'): EstimateProjectionResult {
  const estimates = projection.estimates.filter((estimate) => estimate.metric === metric)
  const sourceIds = new Set(estimates.flatMap((estimate) => estimate.sourceCandidateIds))
  return { ...projection, estimates, sources: projection.sources.filter((source) => sourceIds.has(source.candidate.candidateId)) }
}

function latestPublication(projection: EstimateProjectionResult): string | undefined {
  return projection.estimates.map((estimate) => estimate.publishedAt).sort().at(-1)
}

/** Explicit Plugin operations consumed only through Data-owned Common policies. */
export function createEarningsDataResolver(options: EarningsDataCompositionOptions): DataResolver<EarningsDataPayload> {
  let financialPending: Promise<{ raw: unknown; normalized: NormalizedFinancialData; financialQualityData: NormalizedFinancialQualityData; retrievedAt: string; publishedAt?: string }> | undefined
  const loadFinancial = () => financialPending ??= (async () => {
    if (!options.akshare) throw new Error('AKShare client is unavailable')
    const raw = await options.akshare.financialData({ symbol: options.company.symbol })
    const retrievedAt = options.now()
    const requested = earningsPeriodSpec(options.fiscalYear, options.period)
    const normalized = normalizeAkshareFinancialData(raw, requested, `akshare-earnings-${options.company.symbol}-${requested.key}`)
    const financialQualityData = normalizeFinancialQualityData(raw, requested, `akshare-earnings-${options.company.symbol}-${requested.key}`)
    const publishedAt = publicationForPeriod(raw, requested.endDate)
    return { raw, normalized, financialQualityData, retrievedAt, ...(publishedAt ? { publishedAt } : {}) }
  })()
  const loadThs = async () => {
    if (!options.akshare?.profitForecastThs) throw new Error('AKSHARE_THS_ROUTE_UNAVAILABLE')
    const raw = await options.akshare.profitForecastThs({ symbol: options.company.symbol, indicator: THS_INSTITUTION_FORECAST_INDICATOR })
    return { raw, retrievedAt: options.now() }
  }
  return new DataResolver<EarningsDataPayload>({
    policies: PHASE2_COMMON_SOURCE_POLICIES,
    now: options.now,
    signal: options.signal,
    executor: async (requirement, candidate): Promise<SourceExecutionResult<EarningsDataPayload>> => {
      if (requirement.subject.ticker !== options.company.symbol) return { status: 'UNSUPPORTED', diagnostic: 'EARNINGS_SUBJECT_MISMATCH' }
      if (candidate.operationId === 'official.discoverFetchNormalize') {
        const plugin = options.officialDisclosurePlugin ?? options.acquisitionPlugins.find((item) => item.name.toLowerCase().includes('official'))
        if (!plugin) return { status: 'UNSUPPORTED', diagnostic: 'Official disclosure plugin is not configured' }
        if (!options.selectFilings) return { status: 'UNSUPPORTED', diagnostic: 'Earnings filing selector is not configured' }
        const discovered = await plugin.discover({ company: options.company, asOf: requirement.asOf, limitPerKind: Math.min(options.maxSources ?? 20, 20) }, options.signal)
        const selection = options.selectFilings(discovered, options.fiscalYear, options.period, requirement.asOf)
        const diagnostics: ResearchAcquisitionDiagnostic[] = []
        const sources: NormalizedResearchSource[] = []
        for (const item of selection.candidates) {
          if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
          try {
            const fetched = await plugin.fetch(item, options.signal)
            const payload = validateUsableAcquisitionPayload(fetched.content)
            if (payload.status !== 'usable') { diagnostics.push({ provider: item.provider, candidateId: item.candidateId, kind: item.kind, status: payload.status, reason: payload.reason }); continue }
            sources.push(await plugin.normalize(fetched, options.signal))
          } catch (error) {
            diagnostics.push({ provider: item.provider, candidateId: item.candidateId, kind: item.kind, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
          }
        }
        if (sources.length === 0) return { status: 'NO_DATA', diagnostic: selection.futureFilteredCount > 0 ? `EARNINGS_FUTURE_FILINGS:${selection.futureFilteredCount}` : selection.diagnostics.join('|') || diagnostics.map((item) => item.reason).join('|') || 'earnings_official_filing_unavailable' }
        const publishedAt = sources.map((item) => item.candidate.publishedAt).filter((item): item is string => item !== undefined).sort().at(-1)
        return { status: 'SUCCESS', data: { kind: 'filing', discovered, selection, sources, diagnostics }, source: { originPublisher: 'CNINFO', retrievalProvider: plugin.name, retrievedAt: options.now(), ...(publishedAt ? { publishedAt } : {}) } }
      }
      if (candidate.operationId === 'akshare.financialData') {
        const metric = actualMetricNames[requirement.metricId as keyof typeof actualMetricNames]
        const requested = earningsPeriodSpec(options.fiscalYear, options.period)
        if (!metric || requirement.period?.fiscalYear !== options.fiscalYear || requirement.period?.fiscalPeriod !== requested.key || requirement.period.end !== requested.endDate) return { status: 'NO_DATA', diagnostic: 'EARNINGS_ACTUAL_PERIOD_OR_METRIC_MISMATCH' }
        if (!options.akshare) return { status: 'UNSUPPORTED', diagnostic: 'AKShare client is unavailable' }
        const snapshot = await loadFinancial()
        if (!hasUsableExactPeriod(snapshot.normalized) || snapshot.normalized.current?.metrics[metric] === undefined) return { status: 'NO_DATA', diagnostic: snapshot.normalized.diagnostics.join('|') || `earnings_${metric}_unavailable` }
        return { status: 'SUCCESS', data: { kind: 'actual', raw: snapshot.raw, normalized: snapshot.normalized, financialQualityData: snapshot.financialQualityData, metric, retrievedAt: snapshot.retrievedAt }, source: { originPublisher: 'EastMoney', retrievalProvider: 'AKShare', retrievedAt: snapshot.retrievedAt, ...(snapshot.publishedAt ? { publishedAt: snapshot.publishedAt } : {}), valueVersion: { status: 'UNVERIFIED', reason: 'Aggregator financial numeric revision is not identified' } } }
      }
      if (candidate.operationId === 'akshare.stock_profit_forecast_ths' || candidate.operationId === 'akshare.stock_research_report_em' || candidate.operationId === 'legacy.eastmoneyResearchReport') {
        const metric = requirement.metricId === 'earnings_expectation_eps' ? 'eps' : requirement.metricId === 'earnings_expectation_net_profit' ? 'net_profit' : undefined
        if (!metric || requirement.period?.fiscalYear === undefined || requirement.period.fiscalPeriod !== `${requirement.period.fiscalYear}-FY`) return { status: 'NO_DATA', diagnostic: 'EARNINGS_EXPECTATION_PERIOD_OR_METRIC_MISMATCH' }
        let projection: EstimateProjectionResult
        let retrievedAt: string
        let provider: string
        if (candidate.operationId === 'akshare.stock_profit_forecast_ths') {
          if (!options.akshare?.profitForecastThs) return { status: 'UNSUPPORTED', diagnostic: 'AKSHARE_THS_ROUTE_UNAVAILABLE' }
          const snapshot = await loadThs(); retrievedAt = snapshot.retrievedAt; provider = 'AKShare'
          projection = filterProjection(projectThsInstitutionForecasts({ payload: snapshot.raw, company: options.company, asOf: requirement.asOf, retrievedAt }), metric)
        } else if (candidate.operationId === 'akshare.stock_research_report_em') {
          if (!options.akshare?.researchReportEm) return { status: 'UNSUPPORTED', diagnostic: 'AKSHARE_EASTMONEY_RESEARCH_REPORT_ROUTE_UNAVAILABLE' }
          const raw = await options.akshare.researchReportEm({ symbol: options.company.symbol }); retrievedAt = options.now(); provider = 'AKShare'
          projection = filterProjection(projectAkshareEastmoneyResearchReports({ payload: raw, company: options.company, asOf: requirement.asOf, retrievedAt }), metric)
        } else {
          if (!options.legacyEastmoney) return { status: 'UNSUPPORTED', diagnostic: 'EASTMONEY_LEGACY_REPORT_ROUTE_UNAVAILABLE' }
          const acquisition = await options.legacyEastmoney.acquire({ company: options.company, asOf: requirement.asOf, targetFiscalYear: requirement.period.fiscalYear }); retrievedAt = options.now(); provider = 'legacy-eastmoney-reportapi'
          projection = filterProjection(projectEastmoneyEstimatePoints({ acquisition, targetFiscalYear: requirement.period.fiscalYear }), metric)
        }
        if (projection.estimates.length === 0) return { status: 'NO_DATA', diagnostic: projection.diagnostics.join('|') || `${metric}_no_usable_estimates` }
        return { status: 'SUCCESS', data: { kind: 'expectation', projection }, source: { originPublisher: candidate.originPublisher, retrievalProvider: provider, retrievedAt, ...(latestPublication(projection) ? { publishedAt: latestPublication(projection) } : {}) } }
      }
      return { status: 'UNSUPPORTED', diagnostic: `EARNINGS_UNKNOWN_SOURCE_OPERATION:${candidate.operationId}` }
    },
  })
}
