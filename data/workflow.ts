import type {
  AcquisitionAttempt,
  AcquisitionExecutor,
  AcquisitionObservation,
  AcquisitionResult,
  AcquisitionSourceMetadata,
  DataRequirement,
  SourceCandidate,
  SourceExecutionResult,
  SourcePolicy,
} from './contracts.ts'
import { candidateEligibility, orderCandidates, resolveSourcePolicy } from './source-policy.ts'
import { assertValidDataRequirement, validateAcquisitionData, validateDataRequirement } from './validation.ts'

export interface ResearchDataAcquisitionOptions<T> {
  readonly requirement: DataRequirement
  readonly policies: readonly SourcePolicy[]
  readonly executor: AcquisitionExecutor<T>
  readonly now?: () => string
  readonly signal?: AbortSignal
}

export async function runResearchDataAcquisition<T>(options: ResearchDataAcquisitionOptions<T>): Promise<AcquisitionResult<T>> {
  const marketEnd = options.requirement.period?.end
  if (options.requirement.metricId === 'valuation_market_price' && marketEnd !== undefined && !validMarketPeriodEnd(marketEnd)) {
    const otherErrors = validateDataRequirement(options.requirement).filter((error) => error !== 'period.end must be a valid date')
    if (otherErrors.length > 0) throw new Error(`INVALID_DATA_REQUIREMENT: ${otherErrors.join('; ')}`)
    return {
      requirementId: options.requirement.id,
      status: 'UNAVAILABLE',
      source: null,
      quality: { ...unavailableQuality(options.requirement), pitDiagnostic: `POINT_IN_TIME_INVALID: invalid market period.end ${marketEnd}` },
      attempts: [],
      unavailableReason: 'NO_ELIGIBLE_POINT_IN_TIME_DATA',
    }
  }
  assertValidDataRequirement(options.requirement)
  const now = options.now ?? (() => new Date().toISOString())
  const resolution = resolveSourcePolicy(options.requirement, options.policies)
  if (resolution.status === 'NO_REGISTERED_POLICY' || resolution.status === 'AMBIGUOUS_POLICY' || !resolution.policy) {
    return {
      requirementId: options.requirement.id,
      status: 'UNAVAILABLE',
      source: null,
      quality: unavailableQuality(options.requirement),
      attempts: [],
      unavailableReason: resolution.status === 'MATCHED' ? 'NO_REGISTERED_POLICY' : resolution.status,
    }
  }

  const policy = resolution.policy
  const candidates = orderCandidates(policy.candidates)
  const eligibility = candidates.map((candidate) => ({ candidate, result: candidateEligibility(options.requirement, candidate) }))
  const eligibleCandidates = eligibility.filter((item) => item.result.eligible).map((item) => item.candidate)
  if (eligibleCandidates.length === 0) {
    const hadAuthorityFailure = eligibility.some((item) => item.result.reason === 'INSUFFICIENT_AUTHORITY')
    return {
      requirementId: options.requirement.id,
      status: 'UNAVAILABLE',
      source: null,
      quality: unavailableQuality(options.requirement),
      attempts: [],
      unavailableReason: hadAuthorityFailure ? 'INSUFFICIENT_AUTHORITY' : 'ALL_FALLBACKS_EXHAUSTED',
      policyId: policy.policyId,
    }
  }

  if (policy.selectionMode === 'FIRST_VALID') return runFirstValid(options.requirement, policy.policyId, eligibleCandidates, options.executor, now, options.signal)
  return runMultiSource(options.requirement, policy.policyId, policy.selectionMode, eligibleCandidates, options.executor, now, options.signal)
}

export const executeResearchDataAcquisition = runResearchDataAcquisition

async function runFirstValid<T>(
  requirement: DataRequirement,
  policyId: string,
  candidates: readonly SourceCandidate[],
  executor: AcquisitionExecutor<T>,
  now: () => string,
  signal?: AbortSignal,
): Promise<AcquisitionResult<T>> {
  const attempts: AcquisitionAttempt[] = []
  const failureStatuses: string[] = []
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const startedAt = now()
    let execution: SourceExecutionResult<T>
    try {
      execution = await executor(requirement, candidate)
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw error
      execution = { status: 'UNSUPPORTED', diagnostic: `EXECUTOR_THROWN: ${boundedError(error)}` }
    }
    if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const completedAt = now()
    const evaluated = evaluateExecution(requirement, candidate, execution, completedAt)
    attempts.push({ sourceId: candidate.sourceId, fallbackLevel: candidate.fallbackLevel, status: evaluated.status, startedAt, completedAt, ...(evaluated.diagnostic ? { diagnostic: evaluated.diagnostic } : {}) })
    if (evaluated.status === 'SUCCESS' && evaluated.observation) {
      return {
        requirementId: requirement.id,
        status: 'AVAILABLE',
        data: evaluated.observation.data,
        source: evaluated.observation.source,
        sources: [evaluated.observation.source],
        observations: [evaluated.observation],
        quality: acquisitionQuality(requirement, [evaluated.observation], true, false),
        attempts,
        ...(failureStatuses.length > 0 ? { fallbackReason: failureStatuses.join('|') } : {}),
        policyId,
      }
    }
    failureStatuses.push(`${candidate.fallbackLevel}_${evaluated.status}`)
  }
  return {
    requirementId: requirement.id,
    status: 'UNAVAILABLE',
    source: null,
    quality: unavailableQuality(requirement),
    attempts,
    unavailableReason: terminalUnavailableReason(attempts),
    ...(failureStatuses.length > 0 ? { fallbackReason: failureStatuses.join('|') } : {}),
    policyId,
  }
}

async function runMultiSource<T>(
  requirement: DataRequirement,
  policyId: string,
  mode: 'CROSS_CHECK' | 'COLLECT_DIVERSE',
  candidates: readonly SourceCandidate[],
  executor: AcquisitionExecutor<T>,
  now: () => string,
  signal?: AbortSignal,
): Promise<AcquisitionResult<T>> {
  const attempts: AcquisitionAttempt[] = []
  const observations: AcquisitionObservation<T>[] = []
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const startedAt = now()
    let execution: SourceExecutionResult<T>
    try {
      execution = await executor(requirement, candidate)
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw error
      execution = { status: 'UNSUPPORTED', diagnostic: `EXECUTOR_THROWN: ${boundedError(error)}` }
    }
    if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const completedAt = now()
    const evaluated = evaluateExecution(requirement, candidate, execution, completedAt)
    attempts.push({ sourceId: candidate.sourceId, fallbackLevel: candidate.fallbackLevel, status: evaluated.status, startedAt, completedAt, ...(evaluated.diagnostic ? { diagnostic: evaluated.diagnostic } : {}) })
    if (evaluated.observation) observations.push(evaluated.observation)
  }

  const sources = observations.map((observation) => observation.source)
  if (observations.length === 0) {
    return {
      requirementId: requirement.id,
      status: 'UNAVAILABLE',
      source: null,
      quality: unavailableQuality(requirement),
      attempts,
      unavailableReason: terminalUnavailableReason(attempts),
      policyId,
    }
  }
  if (mode === 'COLLECT_DIVERSE') {
    return {
      requirementId: requirement.id,
      status: observations.length === candidates.length ? 'AVAILABLE' : 'PARTIAL',
      source: sources[0] ?? null,
      sources,
      observations,
      quality: acquisitionQuality(requirement, observations, observations.length === candidates.length, false),
      attempts,
      policyId,
    }
  }

  const crossCheckStatus = observations.length < 2
    ? 'INSUFFICIENT_CROSS_CHECK'
    : observations.every((observation) => stableSerialize(observation.data) === stableSerialize(observations[0]!.data))
      ? 'CONSISTENT'
      : 'CONFLICT'
  return {
    requirementId: requirement.id,
    status: crossCheckStatus === 'CONFLICT' || observations.length < candidates.length ? 'PARTIAL' : 'AVAILABLE',
    data: observations[0]!.data,
    source: observations[0]!.source,
    sources,
    observations,
    quality: acquisitionQuality(requirement, observations, observations.length === candidates.length, observations.length >= 2),
    attempts,
    ...(crossCheckStatus === 'CONFLICT' ? { unavailableReason: 'SOURCE_CONFLICT' as const } : {}),
    crossCheckStatus,
    policyId,
  }
}

function evaluateExecution<T>(
  requirement: DataRequirement,
  candidate: SourceCandidate,
  execution: SourceExecutionResult<T>,
  completedAt: string,
): { readonly status: AcquisitionAttempt['status']; readonly observation?: AcquisitionObservation<T>; readonly diagnostic?: string } {
  if (execution.status !== 'SUCCESS') return { status: execution.status, ...(execution.diagnostic ? { diagnostic: execution.diagnostic } : {}) }
  const fieldErrors = validateAcquisitionData(requirement, execution.data)
  if (fieldErrors.length > 0) return { status: 'VALIDATION_ERROR', diagnostic: `INCOMPLETE_REQUIRED_FIELDS: ${fieldErrors.join(',')}` }
  if (candidate.fallbackLevel === 'LLM_WEB' && requirement.llmWebFallback === 'EXTRACT_WITH_PROVENANCE') {
    const provenance = execution.source
    if (!provenance?.originPublisher || !provenance.sourceUrl || !provenance.publishedAt || !provenance.retrievedAt || Number.isNaN(Date.parse(provenance.publishedAt)) || Number.isNaN(Date.parse(provenance.retrievedAt))) return { status: 'VALIDATION_ERROR', diagnostic: 'LLM_WEB_PROVENANCE_REQUIRED: originPublisher, sourceUrl, publishedAt, and retrievedAt are required' }
  }
  const publishedAt = execution.source?.publishedAt
  const cutoff = requirement.analysisAsOf ?? requirement.asOf
  if (publishedAt !== undefined && (!validDate(publishedAt) || Date.parse(publishedAt) > Date.parse(cutoff))) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `publishedAt ${publishedAt} is invalid or after analysisAsOf ${cutoff}` }
  const valueVersion = execution.source?.valueVersion
  const observedAt = execution.source?.observedAt
  const observationAvailableAt = execution.source?.observationAvailableAt
  if (requirement.metricId === 'valuation_market_price') {
    if (!requirement.period?.end || !validMarketPeriodEnd(requirement.period.end) || !observedAt || !observationAvailableAt || !validMarketDate(observedAt) || !validDate(observationAvailableAt)) return { status: 'POINT_IN_TIME_INVALID', diagnostic: 'NO_ELIGIBLE_POINT_IN_TIME_DATA: valid market period, observation date, and close availability are required' }
    const dailyClose = Date.parse(`${observedAt}T15:00:00+08:00`)
    if (Date.parse(observationAvailableAt) < dailyClose) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `observationAvailableAt ${observationAvailableAt} precedes the daily close for ${observedAt}` }
  }
  if (observedAt !== undefined && (!validDate(observedAt) || Date.parse(observedAt) > Date.parse(cutoff))) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `observedAt ${observedAt} is invalid or after analysisAsOf ${cutoff}` }
  if (observedAt !== undefined && requirement.period?.end !== undefined && afterRequestedPeriod(observedAt, requirement.period.end)) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `observedAt ${observedAt} is after requested period ${requirement.period.end}` }
  if (observationAvailableAt !== undefined && (!validDate(observationAvailableAt) || Date.parse(observationAvailableAt) > Date.parse(cutoff))) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `observationAvailableAt ${observationAvailableAt} is invalid or after analysisAsOf ${cutoff}` }
  if (valueVersion?.status === 'VERIFIED' && (!valueVersion.versionId.trim() || !validDate(valueVersion.availableAt) || Date.parse(valueVersion.availableAt) > Date.parse(cutoff))) return { status: 'POINT_IN_TIME_INVALID', diagnostic: `valueVersion is invalid or after analysisAsOf ${cutoff}` }
  const industryNumericSeries = requirement.dataKind === 'timeseries' && requirement.metricId?.startsWith('industry:') === true
  const numericMetric = (requirement.dataKind === 'metric' || industryNumericSeries) && requirement.determinismClass !== 'SEMANTIC_QUALITATIVE'
  if ((requirement.requireValueVersionProof || (industryNumericSeries && requirement.asOfMode === 'HISTORICAL')) && numericMetric && (valueVersion?.status !== 'VERIFIED' || publishedAt === undefined)) return { status: 'POINT_IN_TIME_INVALID', diagnostic: 'NO_ELIGIBLE_POINT_IN_TIME_DATA: numeric value version or publication unverified' }
  const source: AcquisitionSourceMetadata = {
    sourceId: candidate.sourceId,
    fallbackLevel: candidate.fallbackLevel,
    originAuthority: candidate.originAuthority,
    ...(execution.source?.originPublisher ?? candidate.originPublisher ? { originPublisher: execution.source?.originPublisher ?? candidate.originPublisher } : {}),
    ...(execution.source?.retrievalProvider ? { retrievalProvider: execution.source.retrievalProvider } : {}),
    ...(execution.source?.sourceUrl ? { sourceUrl: execution.source.sourceUrl } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    retrievedAt: execution.source?.retrievedAt ?? completedAt,
    ...(observedAt ? { observedAt } : {}),
    ...(observationAvailableAt ? { observationAvailableAt } : {}),
    ...(valueVersion ? { valueVersion } : {}),
  }
  return { status: 'SUCCESS', observation: { data: execution.data, source } }
}

function validDate(value: string): boolean { return !Number.isNaN(Date.parse(value)) }

function afterRequestedPeriod(observedAt: string, periodEnd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
    ? observedAt.slice(0, 10) > periodEnd
    : Date.parse(observedAt) > Date.parse(periodEnd)
}

function validMarketDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validMarketPeriodEnd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(value) && validMarketDate(value.slice(0, 10)) && validDate(value)
}

function unavailableQuality(requirement: DataRequirement): AcquisitionResult<unknown>['quality'] {
  const numericMetric = (requirement.dataKind === 'metric' || (requirement.dataKind === 'timeseries' && requirement.metricId?.startsWith('industry:') === true)) && requirement.determinismClass !== 'SEMANTIC_QUALITATIVE'
  return { pointInTimeSafe: false, complete: false, crossChecked: false, ...(numericMetric ? { valueVersionStatus: 'UNVERIFIED' as const, pitDiagnostic: 'NUMERIC_VALUE_VERSION_UNVERIFIED_OR_PUBLICATION_MISSING' } : {}) }
}

function acquisitionQuality<T>(requirement: DataRequirement, observations: readonly AcquisitionObservation<T>[], complete: boolean, crossChecked: boolean): AcquisitionResult<T>['quality'] {
  const numericMetric = (requirement.dataKind === 'metric' || (requirement.dataKind === 'timeseries' && requirement.metricId?.startsWith('industry:') === true)) && requirement.determinismClass !== 'SEMANTIC_QUALITATIVE'
  const versionVerified = numericMetric && observations.length > 0 && observations.every((observation) => observation.source.valueVersion?.status === 'VERIFIED')
  const temporalEvidence = observations.length > 0 && observations.every((observation) => requirement.dataKind === 'timeseries'
    ? observation.source.observedAt !== undefined && observation.source.observationAvailableAt !== undefined && requirement.period?.end !== undefined
    : observation.source.publishedAt !== undefined)
  const pointInTimeSafe = numericMetric ? versionVerified && temporalEvidence : temporalEvidence
  return {
    pointInTimeSafe,
    complete,
    crossChecked,
    ...(numericMetric ? { valueVersionStatus: versionVerified ? 'VERIFIED' as const : 'UNVERIFIED' as const } : {}),
    ...(!pointInTimeSafe ? { pitDiagnostic: numericMetric ? 'NUMERIC_VALUE_VERSION_UNVERIFIED_OR_PUBLICATION_MISSING' : 'PUBLICATION_OR_MARKET_PERIOD_UNVERIFIED' } : {}),
  }
}

function terminalUnavailableReason(attempts: readonly AcquisitionAttempt[]): AcquisitionResult<unknown>['unavailableReason'] {
  if (attempts.length === 0) return 'ALL_FALLBACKS_EXHAUSTED'
  const diagnostics = attempts.map((attempt) => attempt.diagnostic ?? '')
  if (diagnostics.some((diagnostic) => diagnostic.includes('NO_ELIGIBLE_POINT_IN_TIME_DATA')) || attempts.every((attempt) => attempt.status === 'POINT_IN_TIME_INVALID')) return 'NO_ELIGIBLE_POINT_IN_TIME_DATA'
  if (diagnostics.some((diagnostic) => diagnostic.includes('INCOMPLETE_REQUIRED_FIELDS')) || attempts.every((attempt) => attempt.status === 'VALIDATION_ERROR')) return 'INCOMPLETE_REQUIRED_FIELDS'
  if (attempts.every((attempt) => attempt.status === 'NO_DATA')) return 'DATA_NOT_PUBLISHED'
  return 'ALL_FALLBACKS_EXHAUSTED'
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 240)
}
