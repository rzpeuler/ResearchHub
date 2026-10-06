import type { ResearchAcquisitionDiagnostic, ResearchCompanyIdentity, ResearchProviderOutcome, NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { EastmoneyEstimateSourceRequest } from '../../plugins/research-acquisition/expectations/contracts.ts'
import { projectEastmoneyEstimatePoints, type EstimateProjectionResult } from './expectation-source-eastmoney.ts'
import { buildConsensusSnapshot } from '../../skills/earnings-review/expectations/consensus.ts'
import { validateEstimatePoint } from '../../skills/earnings-review/expectations/matching.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import type { EarningsEastmoneyExpectationSource, EarningsReviewExpectationsBundle, EarningsReviewWorkflowInput, EstimateRevisionLink } from './contracts.ts'
import { createAkshareEarningsExpectationsSource } from './expectations-acquisition.ts'

export interface AutomaticExpectationAssemblyInput {
  readonly projection: EstimateProjectionResult
  readonly targetFiscalYear: number
  readonly analysisAsOf: string
  readonly resultPublishedAt?: string
}

export interface AutomaticExpectationAssemblyResult {
  readonly bundle?: EarningsReviewExpectationsBundle
  readonly diagnostics: readonly string[]
  readonly estimateCount: number
  readonly institutionCount: number
  readonly consensusSnapshotCount: number
  readonly revisionLinkCount: number
  readonly preResultInstitutionCount: number
}

export interface ResolvedEarningsExpectations {
  readonly mode: 'none' | 'caller' | 'automatic'
  readonly bundle?: EarningsReviewExpectationsBundle
  readonly diagnostics: readonly string[]
  readonly acquisitionDiagnostics: readonly ResearchAcquisitionDiagnostic[]
  readonly providerOutcome?: ResearchProviderOutcome
  readonly providerOutcomes?: readonly ResearchProviderOutcome[]
  readonly acquisitionStatus: 'not_attempted' | 'available' | 'partial' | 'unavailable' | 'failed'
  readonly estimateCount: number
  readonly institutionCount: number
  readonly consensusSnapshotCount: number
  readonly revisionLinkCount: number
}

interface SourceRegistry {
  readonly sources: ReadonlyMap<string, NormalizedResearchSource>
  readonly rejected: ReadonlySet<string>
}

const EASTMONEY_PROVIDER = 'eastmoney-reportapi'
const MAX_ACQUISITION_DIAGNOSTICS = 32

function text(value: unknown): value is string { return typeof value === 'string' && value.trim() !== '' }
function timestamp(value: unknown): number | undefined { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined }
function uniqueSorted(values: readonly string[]): readonly string[] { return [...new Set(values.filter(text).map((value) => value.trim()))].sort((left, right) => left.localeCompare(right)) }
function sourceIdentity(source: NormalizedResearchSource): string { return JSON.stringify({ content: source.content, contentHash: source.contentHash, provider: source.candidate.provider, url: source.candidate.url ?? '', publishedAt: source.candidate.publishedAt ?? '' }) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

function buildSourceRegistry(sources: readonly NormalizedResearchSource[]): SourceRegistry {
  const grouped = new Map<string, NormalizedResearchSource[]>()
  for (const source of sources) {
    const id = text(source.candidate.candidateId) ? source.candidate.candidateId.trim() : ''
    if (id) grouped.set(id, [...(grouped.get(id) ?? []), source])
  }
  const accepted = new Map<string, NormalizedResearchSource>(); const rejected = new Set<string>()
  for (const [id, values] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (new Set(values.map(sourceIdentity)).size > 1) rejected.add(id)
    else accepted.set(id, values[0]!)
  }
  return { sources: accepted, rejected }
}

function normalizeEstimate(estimate: EstimatePoint, input: AutomaticExpectationAssemblyInput, registry: SourceRegistry, diagnostics: string[]): EstimatePoint | undefined {
  const id = text(estimate.estimateId) ? estimate.estimateId.trim() : 'unknown'
  const validation = validateEstimatePoint(estimate)
  if (validation.length > 0) { diagnostics.push(...validation.map((item) => `automatic_estimate_invalid:${id}:${item}`)); return undefined }
  const supportedUnit = estimate.metric === 'eps' ? 'CNY_per_share' : estimate.metric === 'net_profit' ? 'CNY_yuan' : undefined
  if (supportedUnit === undefined || estimate.unit !== supportedUnit) { diagnostics.push(`automatic_estimate_period_or_unit_invalid:${id}`); return undefined }
  if (estimate.fiscalPeriod !== `${input.targetFiscalYear}-FY`) { diagnostics.push(`automatic_estimate_out_of_target_fiscal_period:${id}`); return undefined }
  const published = timestamp(estimate.publishedAt); const asOf = timestamp(input.analysisAsOf)
  if (published === undefined || asOf === undefined || published > asOf) { diagnostics.push(`automatic_estimate_future:${id}`); return undefined }
  const sourceCandidateIds = uniqueSorted(estimate.sourceCandidateIds)
  if (sourceCandidateIds.some((sourceId) => !registry.sources.has(sourceId))) {
    for (const sourceId of sourceCandidateIds) diagnostics.push(registry.rejected.has(sourceId) ? `automatic_source_ambiguous:${sourceId}` : `automatic_estimate_source_missing:${id}:${sourceId}`)
    return undefined
  }
  return { ...estimate, estimateId: id, sourceCandidateIds }
}

function revisionLinks(estimates: readonly EstimatePoint[]): readonly EstimateRevisionLink[] {
  const groups = new Map<string, EstimatePoint[]>()
  for (const estimate of estimates) {
    const key = `${estimate.institutionKey}|${estimate.metric}|${estimate.fiscalPeriod}|${estimate.unit}`
    groups.set(key, [...(groups.get(key) ?? []), estimate])
  }
  const links: EstimateRevisionLink[] = []
  for (const values of groups.values()) {
    const ordered = values.slice().sort((left, right) => timestamp(left.publishedAt)! - timestamp(right.publishedAt)! || left.estimateId.localeCompare(right.estimateId))
    let latest: EstimateRevisionLink | undefined
    for (let index = 1; index < ordered.length; index += 1) {
      const oldEstimate = ordered[index - 1]!; const newEstimate = ordered[index]!
      if (oldEstimate.value !== newEstimate.value) latest = { oldEstimateId: oldEstimate.estimateId, newEstimateId: newEstimate.estimateId }
    }
    if (latest !== undefined) links.push(latest)
  }
  return links.sort((left, right) => `${left.oldEstimateId}->${left.newEstimateId}`.localeCompare(`${right.oldEstimateId}->${right.newEstimateId}`))
}

function emptyAssembly(diagnostics: readonly string[] = []): AutomaticExpectationAssemblyResult {
  return { diagnostics: uniqueSorted(diagnostics), estimateCount: 0, institutionCount: 0, consensusSnapshotCount: 0, revisionLinkCount: 0, preResultInstitutionCount: 0 }
}

export function assembleAutomaticEarningsExpectations(input: AutomaticExpectationAssemblyInput): AutomaticExpectationAssemblyResult {
  const diagnostics: string[] = [...input.projection.diagnostics]
  const registry = buildSourceRegistry(input.projection.sources)
  const counts = new Map<string, number>()
  for (const estimate of input.projection.estimates) if (text(estimate.estimateId)) counts.set(estimate.estimateId.trim(), (counts.get(estimate.estimateId.trim()) ?? 0) + 1)
  const normalized: EstimatePoint[] = []
  for (const estimate of input.projection.estimates) {
    const id = text(estimate.estimateId) ? estimate.estimateId.trim() : 'unknown'
    if ((counts.get(id) ?? 0) > 1) { diagnostics.push(`automatic_estimate_duplicate_id:${id}`); continue }
    const value = normalizeEstimate(estimate, input, registry, diagnostics)
    if (value !== undefined && finite(value.value)) normalized.push(value)
  }
  const ambiguousKeys = new Set<string>()
  const timestampGroups = new Map<string, EstimatePoint[]>()
  for (const estimate of normalized) {
    const key = `${estimate.institutionKey}|${estimate.metric}|${estimate.fiscalPeriod}|${estimate.publishedAt}`
    timestampGroups.set(key, [...(timestampGroups.get(key) ?? []), estimate])
  }
  for (const [key, values] of timestampGroups) if (values.length > 1) { ambiguousKeys.add(key); diagnostics.push(`automatic_estimate_timestamp_ambiguous:${key}`) }
  const safeEstimates = normalized.filter((estimate) => !ambiguousKeys.has(`${estimate.institutionKey}|${estimate.metric}|${estimate.fiscalPeriod}|${estimate.publishedAt}`)).sort((left, right) => left.estimateId.localeCompare(right.estimateId))
  if (safeEstimates.length === 0) return emptyAssembly(diagnostics)
  const sourceIds = new Set(safeEstimates.flatMap((estimate) => estimate.sourceCandidateIds)); const sources = [...sourceIds].map((id) => registry.sources.get(id)).filter((source): source is NormalizedResearchSource => source !== undefined).sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId))
  const resultTime = input.resultPublishedAt === undefined ? undefined : timestamp(input.resultPublishedAt); const analysisTime = timestamp(input.analysisAsOf); const validResultCutoff = resultTime !== undefined && analysisTime !== undefined && resultTime <= analysisTime
  if (input.resultPublishedAt !== undefined && !validResultCutoff) diagnostics.push(resultTime === undefined ? 'automatic_result_cutoff_invalid' : 'automatic_result_cutoff_after_analysisAsOf')
  if (input.resultPublishedAt === undefined) diagnostics.push('automatic_result_cutoff_unavailable')
  const preResult = validResultCutoff ? safeEstimates.filter((estimate) => timestamp(estimate.publishedAt)! < resultTime!) : []
  const preResultInstitutionKeys = validResultCutoff ? uniqueSorted(preResult.map((estimate) => estimate.institutionKey)) : []
  const consensusSnapshots = []
  if (validResultCutoff) {
    const cutoff = new Date(resultTime! - 1).toISOString()
    const consensus = buildConsensusSnapshot({ estimates: preResult, metric: 'eps', fiscalPeriod: `${input.targetFiscalYear}-FY`, asOf: cutoff, minimumCount: 2 })
    diagnostics.push(...consensus.diagnostics)
    if (consensus.snapshot !== undefined && [consensus.snapshot.mean, consensus.snapshot.median, consensus.snapshot.high, consensus.snapshot.low, consensus.snapshot.dispersion].every(finite)) consensusSnapshots.push(consensus.snapshot)
  }
  const links = revisionLinks(safeEstimates)
  const bundle: EarningsReviewExpectationsBundle = {
    sources,
    estimates: safeEstimates,
    consensusSnapshots,
    priorEstimateInstitutionKeys: preResultInstitutionKeys,
    estimateRevisionLinks: links,
    ...(validResultCutoff ? { resultPublishedAt: input.resultPublishedAt } : {}),
  }
  return { bundle, diagnostics: uniqueSorted(diagnostics), estimateCount: safeEstimates.length, institutionCount: new Set(safeEstimates.map((estimate) => estimate.institutionKey)).size, consensusSnapshotCount: consensusSnapshots.length, revisionLinkCount: links.length, preResultInstitutionCount: preResultInstitutionKeys.length }
}

function callerCounts(bundle: EarningsReviewExpectationsBundle): Pick<ResolvedEarningsExpectations, 'estimateCount' | 'institutionCount' | 'consensusSnapshotCount' | 'revisionLinkCount'> {
  return { estimateCount: bundle.estimates?.length ?? 0, institutionCount: new Set(bundle.estimates?.map((estimate) => estimate.institutionKey) ?? []).size, consensusSnapshotCount: bundle.consensusSnapshots?.length ?? 0, revisionLinkCount: bundle.estimateRevisionLinks?.length ?? 0 }
}

function acquisitionDiagnostics(diagnostics: readonly string[], outcome: ResearchProviderOutcome, estimateCount: number): readonly ResearchAcquisitionDiagnostic[] {
  const status = outcome.providerFailed ? 'failed' : outcome.providerEmpty || estimateCount === 0 ? 'empty' : 'usable'
  const reasons = uniqueSorted(diagnostics.length > 0 ? diagnostics : [`automatic_expectations_${status}`]).slice(0, MAX_ACQUISITION_DIAGNOSTICS)
  return reasons.map((reason) => ({ provider: outcome.provider, kind: 'structured_data', status, reason }))
}

function acquisitionDiagnosticsForProviders(diagnostics: readonly string[], outcomes: readonly ResearchProviderOutcome[], estimateCount: number): readonly ResearchAcquisitionDiagnostic[] {
  if (outcomes.length === 0) return []
  return outcomes.filter((outcome) => outcome.providerAttempted).flatMap((outcome) => acquisitionDiagnostics(diagnostics, outcome, estimateCount)).slice(0, MAX_ACQUISITION_DIAGNOSTICS)
}

function hasAkshareExpectationsCapability(client: NonNullable<EarningsReviewWorkflowInput['akshare']>): boolean {
  return client.profitForecastThs !== undefined || client.researchReportEm !== undefined
}

export async function resolveEarningsExpectations(input: { readonly workflow: EarningsReviewWorkflowInput; readonly company: ResearchCompanyIdentity; readonly analysisAsOf: string; readonly resultPublishedAt?: string }): Promise<ResolvedEarningsExpectations> {
  const caller = input.workflow.expectations
  if (caller !== undefined) {
    const counts = callerCounts(caller)
    return { mode: 'caller', bundle: caller, diagnostics: [], acquisitionDiagnostics: [], acquisitionStatus: 'not_attempted', ...counts }
  }
  const expectationsSource = input.workflow.earningsExpectationsSource ?? (input.workflow.akshare !== undefined && hasAkshareExpectationsCapability(input.workflow.akshare) ? createAkshareEarningsExpectationsSource({ akshare: input.workflow.akshare, now: input.workflow.now }) : undefined)
  if (expectationsSource !== undefined) {
    try {
      const acquisition = await expectationsSource.acquire({ company: input.company, asOf: input.analysisAsOf, targetFiscalYear: input.workflow.fiscalYear, signal: input.workflow.signal })
      const assembly = assembleAutomaticEarningsExpectations({ projection: acquisition.projection, targetFiscalYear: input.workflow.fiscalYear, analysisAsOf: input.analysisAsOf, ...(input.resultPublishedAt === undefined ? {} : { resultPublishedAt: input.resultPublishedAt }) })
      const diagnostics = uniqueSorted([...acquisition.diagnostics, ...assembly.diagnostics, ...(assembly.bundle === undefined ? ['automatic_expectations_unavailable'] : [])])
      const outcomes = acquisition.providerOutcomes
      const primaryOutcome = outcomes[0] ?? acquisition.projection.providerOutcome
      const assemblyDiagnostics = diagnostics.filter((diagnostic) => !diagnostic.startsWith('automatic_estimate_out_of_target_fiscal_period:'))
      const acquisitionStatus = acquisition.status === 'failed' ? 'failed' : assembly.bundle === undefined ? 'unavailable' : acquisition.status === 'partial' || assemblyDiagnostics.length > 0 ? 'partial' : 'available'
      return { mode: 'automatic', ...(assembly.bundle === undefined ? {} : { bundle: assembly.bundle }), diagnostics, acquisitionDiagnostics: acquisitionDiagnosticsForProviders(diagnostics, outcomes, assembly.estimateCount), providerOutcome: primaryOutcome, providerOutcomes: outcomes, acquisitionStatus, estimateCount: assembly.estimateCount, institutionCount: assembly.institutionCount, consensusSnapshotCount: assembly.consensusSnapshotCount, revisionLinkCount: assembly.revisionLinkCount }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const providerOutcome: ResearchProviderOutcome = { provider: 'akshare-earnings-expectations-source-ladder', providerAttempted: true, providerSucceeded: false, providerEmpty: false, providerFailed: true, usableSourceCount: 0 }
      const diagnostics = [`automatic_expectation_source_exception:${reason}`]
      return { mode: 'automatic', diagnostics, acquisitionDiagnostics: acquisitionDiagnostics(diagnostics, providerOutcome, 0), providerOutcome, providerOutcomes: [providerOutcome], acquisitionStatus: 'failed', estimateCount: 0, institutionCount: 0, consensusSnapshotCount: 0, revisionLinkCount: 0 }
    }
  }
  const source: EarningsEastmoneyExpectationSource | undefined = input.workflow.eastmoneyExpectationSource
  if (source === undefined) return { mode: 'none', diagnostics: [], acquisitionDiagnostics: [], acquisitionStatus: 'not_attempted', estimateCount: 0, institutionCount: 0, consensusSnapshotCount: 0, revisionLinkCount: 0 }
  const request: EastmoneyEstimateSourceRequest = { company: input.company, asOf: input.analysisAsOf, targetFiscalYear: input.workflow.fiscalYear }
  try {
    const acquisition = await source.acquire(request)
    const projection = projectEastmoneyEstimatePoints({ acquisition, targetFiscalYear: input.workflow.fiscalYear })
    const assembly = assembleAutomaticEarningsExpectations({ projection, targetFiscalYear: input.workflow.fiscalYear, analysisAsOf: input.analysisAsOf, ...(input.resultPublishedAt === undefined ? {} : { resultPublishedAt: input.resultPublishedAt }) })
    const diagnostics = uniqueSorted([...assembly.diagnostics, ...(assembly.bundle === undefined ? ['automatic_expectations_unavailable'] : [])])
    const acquisitionStatus = acquisition.providerOutcome.providerFailed ? 'failed' : assembly.bundle === undefined ? 'unavailable' : acquisition.truncated || diagnostics.length > 0 ? 'partial' : 'available'
    return { mode: 'automatic', ...(assembly.bundle === undefined ? {} : { bundle: assembly.bundle }), diagnostics, acquisitionDiagnostics: acquisitionDiagnostics(diagnostics, acquisition.providerOutcome, assembly.estimateCount), providerOutcome: acquisition.providerOutcome, providerOutcomes: [acquisition.providerOutcome], acquisitionStatus, estimateCount: assembly.estimateCount, institutionCount: assembly.institutionCount, consensusSnapshotCount: assembly.consensusSnapshotCount, revisionLinkCount: assembly.revisionLinkCount }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const providerOutcome: ResearchProviderOutcome = { provider: EASTMONEY_PROVIDER, providerAttempted: true, providerSucceeded: false, providerEmpty: false, providerFailed: true, usableSourceCount: 0 }
    const diagnostics = [`automatic_expectation_source_exception:${reason}`]
    return { mode: 'automatic', diagnostics, acquisitionDiagnostics: acquisitionDiagnostics(diagnostics, providerOutcome, 0), providerOutcome, providerOutcomes: [providerOutcome], acquisitionStatus: 'failed', estimateCount: 0, institutionCount: 0, consensusSnapshotCount: 0, revisionLinkCount: 0 }
  }
}
