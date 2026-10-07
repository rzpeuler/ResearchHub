import type { AcquisitionAttempt, AcquisitionResult, DataRequirement, SourcePolicy } from '../../data/contracts.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'
import { PHASE2_COMMON_SOURCE_POLICIES } from '../../data/valuation-earnings-policies.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ResearchCompanyIdentity, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import { createEarningsDataResolver, hasConfiguredEarningsExpectationOperation, type EarningsDataPayload } from '../../plugins/research-acquisition/earnings-data.ts'
import type { EarningsEastmoneyExpectationSource } from './contracts.ts'
import type { EstimateProjectionResult } from './expectation-source-eastmoney.ts'

const THS_SOURCE_ID = 'ths-institution-forecast'
const EASTMONEY_SOURCE_ID = 'eastmoney-individual-research-report'
const LEGACY_SOURCE_ID = 'eastmoney-legacy-report'
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
  readonly metric?: 'eps' | 'net_profit'
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
  readonly akshare?: AkshareDataClient
  readonly now?: () => string
  readonly onRequirement?: (requirement: DataRequirement) => void
  readonly legacyEastmoney?: EarningsEastmoneyExpectationSource
  readonly dataResolver?: DataResolver<EarningsDataPayload>
}

/** Compatibility accessor; the policy itself is owned by the Common Data catalog. */
export function earningsExpectationSourcePolicy(): SourcePolicy {
  return PHASE2_COMMON_SOURCE_POLICIES.find((policy) => policy.requirementMatch.metricId === 'earnings_expectation_eps')!
}

const uniqueSorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right))

function toLegacyResult(item: ResolvedDataItem<EarningsDataPayload>): AcquisitionResult<{ readonly projection: EstimateProjectionResult }> {
  const projection = item.value?.kind === 'expectation' ? item.value.projection : undefined
  return { requirementId: item.acquisition.requirementId, status: item.acquisition.status, source: item.acquisition.source, ...(item.acquisition.sources ? { sources: item.acquisition.sources } : {}), quality: item.acquisition.quality, attempts: item.acquisition.attempts, ...(projection === undefined ? {} : { data: { projection } }), ...(item.acquisition.unavailableReason ? { unavailableReason: item.acquisition.unavailableReason } : {}), ...(item.acquisition.fallbackReason ? { fallbackReason: item.acquisition.fallbackReason } : {}), ...(item.acquisition.policyId ? { policyId: item.acquisition.policyId } : {}) }
}

function failedAttempt(attempt: AcquisitionAttempt): boolean {
  return (attempt.status === 'UNSUPPORTED' || attempt.status === 'SOURCE_ERROR' || attempt.status === 'PARSE_ERROR' || attempt.status === 'TIMEOUT' || attempt.status === 'RATE_LIMITED' || attempt.status === 'ACCESS_DENIED') && !(attempt.sourceId === LEGACY_SOURCE_ID && attempt.diagnostic?.includes('LEGACY_REPORT_ROUTE_UNAVAILABLE'))
}

function providerOutcome(sourceId: string, items: readonly ResolvedDataItem<EarningsDataPayload>[]): ResearchProviderOutcome {
  const ids = sourceId === EASTMONEY_SOURCE_ID ? new Set([EASTMONEY_SOURCE_ID, LEGACY_SOURCE_ID]) : new Set([sourceId])
  const attempts = items.flatMap((item) => item.attempts.filter((attempt) => ids.has(attempt.sourceId)))
  const projections = items.flatMap((item) => item.value?.kind === 'expectation' && ids.has(item.source?.sourceId ?? '') ? [item.value.projection] : [])
  const estimates = projections.flatMap((projection) => projection.estimates)
  return { provider: sourceId, providerAttempted: attempts.length > 0, providerSucceeded: estimates.length > 0, providerEmpty: attempts.length > 0 && estimates.length === 0, providerFailed: attempts.some(failedAttempt), usableSourceCount: new Set(projections.flatMap((projection) => projection.sources.map((source) => source.candidate.candidateId))).size }
}

export class AkshareEarningsExpectationsSource implements EarningsExpectationsAcquisitionSource {
  readonly name = 'akshare-earnings-expectations-source-ladder'
  private readonly now: () => string
  constructor(private readonly options: AkshareEarningsExpectationsSourceOptions) { this.now = options.now ?? (() => new Date().toISOString()) }

  async acquire(request: EarningsExpectationAcquisitionRequest): Promise<EarningsExpectationAcquisitionResult> {
    const resolver = this.options.dataResolver ?? createEarningsDataResolver({ company: request.company, fiscalYear: request.targetFiscalYear, period: 'FY', asOf: request.asOf, now: this.now, signal: request.signal, acquisitionPlugins: [], akshare: this.options.akshare, legacyEastmoney: this.options.legacyEastmoney })
    const selected = EARNINGS_EXPECTATION_METRICS.filter((item) => request.metric === undefined || item.metric === request.metric)
    const requirements = selected.map(({ metric, metricId }) => materializePhase2CommonRequirement(metricId, { workflowId: 'earnings-review', ticker: request.company.symbol, companyId: request.company.name, asOf: request.asOf, period: { fiscalYear: request.targetFiscalYear, fiscalPeriod: `${request.targetFiscalYear}-FY` }, required: false, id: `earnings-expectation-${request.company.symbol}-${request.targetFiscalYear}-${metric}` }))
    for (const requirement of requirements) this.options.onRequirement?.(requirement)
    const items: ResolvedDataItem<EarningsDataPayload>[] = []
    for (const requirement of requirements) items.push(await resolver.resolveOne(requirement))
    const results = items.map(toLegacyResult)
    const successful = items.flatMap((item) => item.value?.kind === 'expectation' ? [item.value.projection] : [])
    const attempts = items.flatMap((item) => item.attempts)
    const diagnostics = selected.flatMap((selectedMetric, index) => {
      const item = items[index]!
      return [...(item.fallbackReason ? [`${selectedMetric.metric}:${item.fallbackReason}`] : []), ...item.attempts.flatMap((attempt) => attempt.diagnostic ? [`${selectedMetric.metric}:${attempt.diagnostic}`] : [])]
    })
    const sources = [...new Map(successful.flatMap((projection) => projection.sources.map((source) => [source.candidate.candidateId, source] as const))).values()].sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId))
    const estimates = successful.flatMap((projection) => projection.estimates).sort((left, right) => left.estimateId.localeCompare(right.estimateId))
    const institutions = [...new Map(successful.flatMap((projection) => projection.institutions.map((institution) => [institution.institutionKey, institution] as const))).values()].sort((left, right) => left.institutionKey.localeCompare(right.institutionKey))
    const projection: EstimateProjectionResult = { sources, estimates, institutions, diagnostics: uniqueSorted([...diagnostics, ...successful.flatMap((item) => item.diagnostics)]), providerOutcome: { provider: PROVIDER_LADDER, providerAttempted: attempts.length > 0, providerSucceeded: estimates.length > 0, providerEmpty: estimates.length === 0, providerFailed: attempts.some(failedAttempt), usableSourceCount: sources.length }, truncated: successful.some((item) => item.truncated) }
    const legacyOnly = this.options.legacyEastmoney !== undefined && !hasConfiguredEarningsExpectationOperation({ akshare: this.options.akshare })
    if (legacyOnly) {
      const legacyAttempts = attempts.filter((attempt) => attempt.sourceId === LEGACY_SOURCE_ID)
      const legacyFailure = legacyAttempts.find((attempt) => attempt.diagnostic?.startsWith('EXECUTOR_THROWN:'))
      const legacyProjection = successful.find((item) => item.providerOutcome.provider === 'eastmoney-reportapi')
      const outcome: ResearchProviderOutcome = legacyProjection?.providerOutcome ?? {
        provider: 'eastmoney-reportapi', providerAttempted: legacyAttempts.length > 0,
        providerSucceeded: estimates.length > 0, providerEmpty: legacyAttempts.length > 0 && estimates.length === 0 && !legacyFailure,
        providerFailed: legacyFailure !== undefined, usableSourceCount: sources.length,
      }
      const legacyDiagnostics = legacyFailure?.diagnostic ? [`automatic_expectation_source_exception:${legacyFailure.diagnostic.replace(/^EXECUTOR_THROWN: /, '')}`] : successful.flatMap((item) => item.diagnostics)
      const legacyProjectionResult = { ...projection, diagnostics: uniqueSorted(legacyDiagnostics), providerOutcome: outcome }
      return { projection: legacyProjectionResult, results, attempts, diagnostics: uniqueSorted(legacyDiagnostics), providerOutcomes: [outcome], status: outcome.providerFailed ? 'failed' : estimates.length === 0 ? 'unavailable' : projection.truncated || legacyDiagnostics.length > 0 ? 'partial' : 'available', ...(items.every((item) => item.unavailableReason !== undefined) ? { unavailableReason: items.find((item) => item.unavailableReason !== undefined)?.unavailableReason } : {}) }
    }
    const providerOutcomes = [providerOutcome(THS_SOURCE_ID, items), providerOutcome(EASTMONEY_SOURCE_ID, items)]
    const hasFallback = items.some((item) => item.fallbackReason !== undefined)
    const failed = attempts.some(failedAttempt) && estimates.length === 0
    return { projection, results, attempts, diagnostics: uniqueSorted([...diagnostics, ...projection.diagnostics]), providerOutcomes, status: estimates.length === 0 ? failed ? 'failed' : 'unavailable' : hasFallback || projection.diagnostics.length > 0 ? 'partial' : 'available', ...(items.every((item) => item.unavailableReason !== undefined) ? { unavailableReason: items.find((item) => item.unavailableReason !== undefined)?.unavailableReason } : {}) }
  }
}

export const createAkshareEarningsExpectationsSource = (options: AkshareEarningsExpectationsSourceOptions): EarningsExpectationsAcquisitionSource => new AkshareEarningsExpectationsSource(options)
