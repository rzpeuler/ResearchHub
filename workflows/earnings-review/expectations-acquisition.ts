import type { AcquisitionAttempt, AcquisitionResult, DataRequirement, SourceCandidate, SourcePolicy } from '../research-data-acquisition/index.ts'
import { runResearchDataAcquisition } from '../research-data-acquisition/index.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ResearchCompanyIdentity, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { EarningsEastmoneyExpectationSource } from './contracts.ts'
import { projectAkshareEastmoneyResearchReports } from './expectations-eastmoney-akshare.ts'
import { projectThsInstitutionForecasts, THS_INSTITUTION_FORECAST_INDICATOR } from './expectations-ths.ts'
import type { EstimateProjectionResult } from './expectation-source-eastmoney.ts'

const EASTMONEY_SOURCE_ID = 'eastmoney-individual-research-report'
const THS_SOURCE_ID = 'ths-institution-forecast'
const PROVIDER_LADDER = 'earnings-expectations-source-ladder'
export const EARNINGS_EXPECTATION_METRICS = [
  { metric: 'eps', metricId: 'earnings_expectation_eps' },
  { metric: 'net_profit', metricId: 'earnings_expectation_net_profit' },
] as const

export interface EarningsExpectationAcquisitionRequest {
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly targetFiscalYear: number
  readonly signal?: AbortSignal
}

export interface EarningsExpectationAcquisitionResult {
  readonly projection: EstimateProjectionResult
  readonly results: readonly AcquisitionResult<{ readonly projection: EstimateProjectionResult }>[]
  readonly attempts: readonly AcquisitionAttempt[]
  readonly diagnostics: readonly string[]
  readonly providerOutcomes: readonly ResearchProviderOutcome[]
  readonly status: 'available' | 'partial' | 'unavailable' | 'failed'
  readonly unavailableReason?: AcquisitionResult<unknown>['unavailableReason']
}

export interface EarningsExpectationsAcquisitionSource {
  acquire(request: EarningsExpectationAcquisitionRequest): Promise<EarningsExpectationAcquisitionResult>
}

export interface AkshareEarningsExpectationsSourceOptions {
  readonly akshare: AkshareDataClient
  readonly now?: () => string
  readonly onRequirement?: (requirement: DataRequirement) => void
  /** Legacy source is accepted only as a compatibility fallback when the AKShare EM route is unavailable. */
  readonly legacyEastmoney?: EarningsEastmoneyExpectationSource
}

export function earningsExpectationSourcePolicy(): SourcePolicy {
  const supports = { dataKinds: ['estimate'] as const }
  const ths: SourceCandidate = { sourceId: THS_SOURCE_ID, fallbackLevel: 'PRIMARY', originAuthority: 'S3_AGGREGATOR', originPublisher: 'Tonghuashun / 同花顺', operationId: 'akshare.stock_profit_forecast_ths', supports: { ...supports, metricIds: ['earnings_expectation_eps', 'earnings_expectation_net_profit'] } }
  const eastmoney: SourceCandidate = { sourceId: EASTMONEY_SOURCE_ID, fallbackLevel: 'FALLBACK_1', originAuthority: 'S3_AGGREGATOR', originPublisher: 'EastMoney', operationId: 'akshare.stock_research_report_em', supports: { ...supports, metricIds: ['earnings_expectation_eps'] } }
  return { policyId: 'earnings-expectations-source-ladder-v0.1', requirementMatch: { workflow: 'earnings-review', dataKind: 'estimate', capability: 'earnings_expectations' }, selectionMode: 'FIRST_VALID', candidates: [ths, eastmoney] }
}

function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)) }
function filterProjection(projection: EstimateProjectionResult, metric: string): EstimateProjectionResult {
  const estimates = projection.estimates.filter((estimate) => estimate.metric === metric)
  const sourceIds = new Set(estimates.flatMap((estimate) => estimate.sourceCandidateIds))
  return { ...projection, estimates, sources: projection.sources.filter((source) => sourceIds.has(source.candidate.candidateId)) }
}
function providerOutcome(provider: string, results: readonly AcquisitionResult<{ readonly projection: EstimateProjectionResult }>[], projections: readonly (EstimateProjectionResult | undefined)[]): ResearchProviderOutcome {
  const attempted = results.some((result) => result.attempts.some((attempt) => attempt.sourceId === provider))
  const prefixes = provider === THS_SOURCE_ID ? ['ths-institution-'] : ['eastmoney-akshare-report-', 'eastmoney-report-']
  const providerProjections = projections.filter((projection): projection is EstimateProjectionResult => projection !== undefined && projection.estimates.some((estimate) => estimate.sourceCandidateIds.some((sourceId) => prefixes.some((prefix) => sourceId.startsWith(prefix)))))
  const estimates = providerProjections.reduce((count, projection) => count + projection.estimates.length, 0)
  const attempts = results.flatMap((result) => result.attempts.filter((attempt) => attempt.sourceId === provider))
  return { provider, providerAttempted: attempted, providerSucceeded: estimates > 0, providerEmpty: attempted && estimates === 0, providerFailed: attempts.some((attempt) => attempt.status === 'UNSUPPORTED' || attempt.status === 'PARSE_ERROR'), usableSourceCount: new Set(providerProjections.flatMap((projection) => projection.sources.map((source) => source.candidate.candidateId))).size }
}

export class AkshareEarningsExpectationsSource implements EarningsExpectationsAcquisitionSource {
  readonly name = 'akshare-earnings-expectations-source-ladder'
  private readonly now: () => string
  constructor(private readonly options: AkshareEarningsExpectationsSourceOptions) { this.now = options.now ?? (() => new Date().toISOString()) }

  async acquire(request: EarningsExpectationAcquisitionRequest): Promise<EarningsExpectationAcquisitionResult> {
    const results: AcquisitionResult<{ readonly projection: EstimateProjectionResult }>[] = []
    const diagnostics: string[] = []
    for (const { metric, metricId } of EARNINGS_EXPECTATION_METRICS) {
      const requirement: DataRequirement = { id: `earnings-expectation-${request.company.symbol}-${request.targetFiscalYear}-${metric}`, consumer: { workflow: 'earnings-review', capability: 'earnings_expectations' }, subject: { ticker: request.company.symbol, companyId: request.company.name }, dataKind: 'estimate', metricId, asOf: request.asOf, determinismClass: 'AUTHORITATIVE_NUMERIC', minimumAuthority: 'S3_AGGREGATOR', llmWebFallback: 'FORBIDDEN' }
      this.options.onRequirement?.(requirement)
      const result = await runResearchDataAcquisition({ requirement, policies: [earningsExpectationSourcePolicy()], signal: request.signal, executor: async (_requirement, candidate) => {
        if (candidate.sourceId === THS_SOURCE_ID) {
          if (this.options.akshare.profitForecastThs === undefined) throw new Error('AKSHARE_THS_ROUTE_UNAVAILABLE')
          const raw = await this.options.akshare.profitForecastThs({ symbol: request.company.symbol, indicator: THS_INSTITUTION_FORECAST_INDICATOR })
          const projection = filterProjection(projectThsInstitutionForecasts({ payload: raw, company: request.company, asOf: request.asOf, retrievedAt: this.now() }), metric)
          if (projection.estimates.length === 0) return { status: 'NO_DATA' as const, diagnostic: projection.diagnostics.join('|') || 'ths_no_usable_estimates' }
          return { status: 'SUCCESS' as const, data: { projection }, source: { originPublisher: 'Tonghuashun / 同花顺', retrievalProvider: 'AKShare', retrievedAt: this.now() } }
        }
        if (candidate.sourceId === EASTMONEY_SOURCE_ID) {
          if (this.options.akshare.researchReportEm !== undefined) {
            const raw = await this.options.akshare.researchReportEm({ symbol: request.company.symbol })
            const projection = filterProjection(projectAkshareEastmoneyResearchReports({ payload: raw, company: request.company, asOf: request.asOf, retrievedAt: this.now() }), metric)
            if (projection.estimates.length === 0) return { status: 'NO_DATA' as const, diagnostic: projection.diagnostics.join('|') || 'eastmoney_akshare_no_usable_estimates' }
            return { status: 'SUCCESS' as const, data: { projection }, source: { originPublisher: 'EastMoney', retrievalProvider: 'AKShare', retrievedAt: this.now() } }
          }
          if (this.options.legacyEastmoney !== undefined) {
            const acquisition = await this.options.legacyEastmoney.acquire({ company: request.company, asOf: request.asOf, targetFiscalYear: request.targetFiscalYear })
            if (acquisition.records.length > 0) {
              const { projectEastmoneyEstimatePoints } = await import('./expectation-source-eastmoney.ts')
              const legacyProjection = filterProjection(projectEastmoneyEstimatePoints({ acquisition, targetFiscalYear: request.targetFiscalYear }), metric)
              if (legacyProjection.estimates.length > 0) return { status: 'SUCCESS' as const, data: { projection: legacyProjection }, source: { originPublisher: 'EastMoney', retrievalProvider: 'legacy-eastmoney-reportapi', retrievedAt: this.now() } }
            }
            return { status: 'NO_DATA' as const, diagnostic: acquisition.diagnostics.join('|') || 'eastmoney_legacy_no_usable_estimates' }
          }
          throw new Error('AKSHARE_EASTMONEY_RESEARCH_REPORT_ROUTE_UNAVAILABLE')
        }
        return { status: 'UNSUPPORTED' as const, diagnostic: `UNKNOWN_SOURCE_CANDIDATE:${candidate.sourceId}` }
      }, now: this.now })
      results.push(result)
      if (result.fallbackReason) diagnostics.push(`${metric}:${result.fallbackReason}`)
      for (const attempt of result.attempts) if (attempt.diagnostic) diagnostics.push(`${metric}:${attempt.diagnostic}`)
    }
    const resultProjections = results.map((result) => result.data?.projection)
    const successfulProjections = resultProjections.flatMap((projection) => projection === undefined ? [] : [projection])
    const projection: EstimateProjectionResult = {
      sources: [...new Map(successfulProjections.flatMap((item) => item.sources.map((source) => [source.candidate.candidateId, source] as const))).values()].sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId)),
      estimates: successfulProjections.flatMap((item) => item.estimates).sort((left, right) => left.estimateId.localeCompare(right.estimateId)),
      institutions: [...new Map(successfulProjections.flatMap((item) => item.institutions.map((institution) => [institution.institutionKey, institution] as const))).values()].sort((left, right) => left.institutionKey.localeCompare(right.institutionKey)),
      diagnostics: uniqueSorted([...diagnostics, ...successfulProjections.flatMap((item) => item.diagnostics)]),
      providerOutcome: { provider: PROVIDER_LADDER, providerAttempted: results.length > 0, providerSucceeded: successfulProjections.some((item) => item.estimates.length > 0), providerEmpty: successfulProjections.every((item) => item.estimates.length === 0), providerFailed: results.some((result) => result.attempts.some((attempt) => attempt.status === 'UNSUPPORTED' || attempt.status === 'PARSE_ERROR')), usableSourceCount: new Set(successfulProjections.flatMap((item) => item.sources.map((source) => source.candidate.candidateId))).size },
      truncated: successfulProjections.some((item) => item.truncated),
    }
    const attempts = results.flatMap((result) => result.attempts)
    const providerOutcomes = [providerOutcome(THS_SOURCE_ID, results, resultProjections), providerOutcome(EASTMONEY_SOURCE_ID, results, resultProjections)]
    const hasEstimates = projection.estimates.length > 0
    const hasFallback = results.some((result) => result.fallbackReason !== undefined)
    const failed = attempts.some((attempt) => attempt.status === 'UNSUPPORTED' || attempt.status === 'PARSE_ERROR') && !hasEstimates
    return { projection, results, attempts, diagnostics: uniqueSorted([...diagnostics, ...projection.diagnostics]), providerOutcomes, status: !hasEstimates ? (failed ? 'failed' : 'unavailable') : hasFallback || projection.diagnostics.length > 0 ? 'partial' : 'available', ...(results.every((result) => result.unavailableReason !== undefined) ? { unavailableReason: results.find((result) => result.unavailableReason !== undefined)?.unavailableReason } : {}) }
  }
}

export const createAkshareEarningsExpectationsSource = (options: AkshareEarningsExpectationsSourceOptions): EarningsExpectationsAcquisitionSource => new AkshareEarningsExpectationsSource(options)
