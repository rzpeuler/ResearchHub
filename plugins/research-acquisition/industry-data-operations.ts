import type { DataRequirement, SourceCandidate, SourceExecutionResult } from '../../data/contracts.ts'
import type { IndustryObservationCandidate, IndustryObservationPoint } from '../../data/industry-observations.ts'
import type { ResearchEvidenceInput } from '../../data/research-evidence.ts'
import type { ResearchAcquisitionPlugin, NormalizedResearchSource } from './contracts.ts'
import type { IndustryOperatingObservation } from './industry-operating-observations.ts'
import type { IndustryOperatingObservationAcquisitionPort, IndustryOperatingObservationAcquisitionResult, IndustryOperatingObservationRequest } from './industry-operating-observations.ts'
import type { IndustryTargetInput } from '../../skills/industry-research/contracts.ts'

export const INDUSTRY_DATA_OPERATION_IDS = Object.freeze([
  'industry.evidence.miit',
  'industry.evidence.govcn',
  'industry.evidence.cpca',
  'industry.evidence.eastmoney-board',
  'industry.metric.nbs.room-air-conditioner-production',
  'industry.metric.cheaa.air-conditioner-export-volume',
  'industry.metric.miit.lithium-total-output',
  'industry.metric.miit.lithium-carbonate-average-price',
  'industry.metric.miit.lithium-hydroxide-average-price',
] as const)
export type IndustryDataOperationId = (typeof INDUSTRY_DATA_OPERATION_IDS)[number]

const METRIC_OPERATION: Readonly<Record<string, IndustryDataOperationId>> = Object.freeze({
  'industry:household_air_conditioner:room-air-conditioner-production': 'industry.metric.nbs.room-air-conditioner-production',
  'industry:household_air_conditioner:air-conditioner-export-volume': 'industry.metric.cheaa.air-conditioner-export-volume',
  'industry:lithium_battery:lithium-battery-total-output': 'industry.metric.miit.lithium-total-output',
  'industry:lithium_battery:lithium-carbonate-period-average-price': 'industry.metric.miit.lithium-carbonate-average-price',
  'industry:lithium_battery:lithium-hydroxide-period-average-price': 'industry.metric.miit.lithium-hydroxide-average-price',
})
const LEGACY_METRIC_ID: Readonly<Record<string, string>> = Object.freeze({
  'room_air_conditioner.production': 'industry:household_air_conditioner:room-air-conditioner-production',
  'air_conditioner.export_volume': 'industry:household_air_conditioner:air-conditioner-export-volume',
  'lithium_battery.total_output': 'industry:lithium_battery:lithium-battery-total-output',
  'lithium_battery.lithium_carbonate_average_price': 'industry:lithium_battery:lithium-carbonate-period-average-price',
  'lithium_battery.lithium_hydroxide_average_price': 'industry:lithium_battery:lithium-hydroxide-period-average-price',
})
const EVIDENCE_OPERATIONS = new Set<IndustryDataOperationId>([
  'industry.evidence.miit', 'industry.evidence.govcn', 'industry.evidence.cpca', 'industry.evidence.eastmoney-board',
])
export type IndustryEvidenceOperationId = Extract<IndustryDataOperationId, `industry.evidence.${string}`>

export function industryOperationSupports(operationId: string, requirement: Pick<DataRequirement, 'metricId' | 'dataKind'>): operationId is IndustryDataOperationId {
  if (!INDUSTRY_DATA_OPERATION_IDS.includes(operationId as IndustryDataOperationId)) return false
  if (requirement.metricId === 'industry_research_evidence') return requirement.dataKind === 'evidence' && EVIDENCE_OPERATIONS.has(operationId as IndustryDataOperationId)
  return requirement.dataKind === 'timeseries' && METRIC_OPERATION[requirement.metricId ?? ''] === operationId
}

export function normalizeIndustryObservationCandidate(
  observation: IndustryOperatingObservation,
  requirement: Pick<DataRequirement, 'metricId' | 'dataKind'>,
  operationId: string,
): IndustryObservationCandidate | undefined {
  if (!industryOperationSupports(operationId, requirement) || LEGACY_METRIC_ID[observation.metricKey] !== requirement.metricId) return undefined
  const rawProduct = observation.productOrSegment
  const grade = /微粉级/.test(rawProduct) ? '微粉级' : /电池级/.test(rawProduct) ? '电池级' : undefined
  const product = rawProduct.replace(/[（(](?:微粉级|电池级)[）)]/g, '').replace(/^电池级/, '').trim()
  const periodBasis = observation.frequency === 'H1' ? 'YTD' : observation.aggregation === 'POINT_IN_TIME' ? 'POINT_IN_TIME' : 'PERIOD'
  const sourceIdentity = observation.sourceRef
    ?? industrySourceIdentity(typeof observation.metadata.canonicalUrl === 'string' ? observation.metadata.canonicalUrl : undefined, observation.sourceCandidateId)
  return {
    metricId: requirement.metricId!, value: observation.value, qualifier: observation.qualifier, unit: observation.unit,
    originalValue: observation.originalValue, periodStart: observation.periodStart, periodEnd: observation.periodEnd,
    frequency: observation.frequency, periodBasis,
    aggregation: observation.observationClass === 'PRICE' ? 'AVERAGE' : observation.observationClass === 'PRODUCTION' || observation.observationClass === 'TRADE' ? 'SUM' : 'NONE',
    geography: observation.geography, product, ...(grade ? { grade } : {}),
    publishedAt: observation.publishedAt, retrievedAt: observation.retrievedAt,
    originPublisher: observation.originPublisher, hostPlatform: observation.hostPlatform,
    retrievalProvider: observation.retrievalProvider, authority: observation.sourceAuthority,
    publicationPit: observation.publicationPit,
    valueVersion: { status: 'UNVERIFIED', reason: `Legacy observation value-version status: ${observation.valueVersionPit}` },
    sourceIdentity, diagnostics: ['LEGACY_PLUGIN_PARSER_CANDIDATE'],
  }
}

export interface IndustryDataOperationRequest {
  readonly requirement: DataRequirement
  readonly candidate: SourceCandidate
  readonly signal?: AbortSignal
  readonly now: () => string
  readonly target?: IndustryTargetInput
}

export interface IndustryOperationDocument extends ResearchEvidenceInput<unknown> {
  readonly rights: NonNullable<ResearchEvidenceInput<unknown>['rights']>
}

export function industrySourceIdentity(sourceUrl: string | undefined, contentHash: string): string {
  return sourceUrl ? `url:${sourceUrl}` : `hash:${contentHash.trim().toLowerCase()}`
}

export interface IndustryDataOperationPayload {
  readonly documents: readonly IndustryOperationDocument[]
  readonly observationCandidates: readonly IndustryObservationCandidate[]
  /** Populated by the application Data operation boundary after catalog validation. */
  readonly observationPoints?: readonly IndustryObservationPoint[]
  readonly observationDiagnostics?: readonly string[]
  readonly diagnostics: readonly string[]
  readonly outcome: {
    readonly transportSucceeded: boolean
    readonly fetchSucceeded: boolean
    readonly discovered: number
    readonly fetched: number
    readonly failed: number
    readonly empty: number
    readonly rejected: number
    readonly deduplicated: number
  }
}

export type IndustryDataOperation = (request: IndustryDataOperationRequest) => Promise<SourceExecutionResult<IndustryDataOperationPayload>>

function normalizedDocument(source: NormalizedResearchSource): IndustryOperationDocument {
  const parsedUrl = source.canonicalUrl ?? source.candidate.url
  let hostPlatform: string | undefined
  try { hostPlatform = parsedUrl ? new URL(parsedUrl).hostname : undefined } catch { hostPlatform = undefined }
  return {
    record: source,
    publishedAt: source.candidate.publishedAt,
    retrievedAt: source.retrievedAt,
    ...(parsedUrl ? { sourceUrl: parsedUrl } : {}),
    contentHash: source.contentHash,
    sourceIdentity: industrySourceIdentity(parsedUrl, source.contentHash),
    originPublisher: source.publisher,
    ...(hostPlatform ? { hostPlatform } : {}),
    retrievalProvider: source.candidate.provider,
    rights: {
      accessScope: source.rights.accessScope,
      retentionAllowed: source.rights.retentionAllowed,
      aiProcessingAllowed: source.rights.aiProcessingAllowed,
      derivativeKnowledgeAllowed: source.rights.derivativeKnowledgeAllowed,
      redistributionAllowed: source.rights.redistributionAllowed,
    },
  }
}

/** Bind one existing acquisition adapter to a named Data policy operation. */
export function createIndustryEvidenceOperation(operationId: IndustryEvidenceOperationId, plugin: ResearchAcquisitionPlugin): IndustryDataOperation {
  return async ({ requirement, candidate, signal, now }) => {
    if (candidate.operationId !== operationId || !industryOperationSupports(candidate.operationId, requirement)) return { status: 'UNSUPPORTED', diagnostic: 'INDUSTRY_OPERATION_REQUIREMENT_MISMATCH' }
    const query = requirement.industryEvidenceQueryContext
    if (!query) return { status: 'UNSUPPORTED', diagnostic: 'INDUSTRY_EVIDENCE_QUERY_CONTEXT_REQUIRED' }
    if (signal?.aborted) return { status: 'SOURCE_ERROR', diagnostic: 'WORKFLOW_CANCELLED' }
    try {
      const discovered = await plugin.discover({
        industry: { name: query.displayTarget, searchTerms: [...query.searchTerms] },
        asOf: requirement.analysisAsOf ?? requirement.asOf,
        limitPerKind: 12,
      }, signal)
      const documents: IndustryOperationDocument[] = []
      const diagnostics: string[] = []
      let failed = 0
      for (const sourceCandidate of discovered.slice(0, 12)) {
        if (signal?.aborted) return { status: 'SOURCE_ERROR', diagnostic: 'WORKFLOW_CANCELLED' }
        try {
          const fetched = await plugin.fetch(sourceCandidate, signal)
          const normalized = await plugin.normalize(fetched, signal)
          documents.push(normalizedDocument(normalized))
        } catch (error) {
          failed += 1
          diagnostics.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (!documents.length && failed) return { status: 'SOURCE_ERROR', diagnostic: diagnostics.slice(0, 8).join('|') }
      if (!documents.length) return { status: 'NO_DATA', diagnostic: discovered.length ? 'INDUSTRY_EVIDENCE_NO_USABLE_DOCUMENTS' : 'INDUSTRY_EVIDENCE_NO_MATCHES' }
      return {
        status: 'SUCCESS',
        data: { documents, observationCandidates: [], diagnostics: diagnostics.slice(0, 16), outcome: { transportSucceeded: true, fetchSucceeded: true, discovered: discovered.length, fetched: documents.length, failed, empty: discovered.length === 0 ? 1 : 0, rejected: 0, deduplicated: 0 } },
        source: {
          originAuthority: candidate.originAuthority,
          retrievalProvider: plugin.name,
          retrievedAt: now(),
        },
      }
    } catch (error) {
      return { status: 'SOURCE_ERROR', diagnostic: error instanceof Error ? error.message : String(error) }
    }
  }
}

export interface NamedIndustryMetricAcquisitionPort extends IndustryOperatingObservationAcquisitionPort {
  acquireNamed(request: IndustryOperatingObservationRequest, metricId: string): Promise<IndustryOperatingObservationAcquisitionResult>
}

/** Run the source operation selected by the metric-scoped Data policy. */
export function createIndustryMetricOperation(acquisition: NamedIndustryMetricAcquisitionPort): IndustryDataOperation {
  return async ({ requirement, candidate, signal, now, target }) => {
    if (!industryOperationSupports(candidate.operationId, requirement)) return { status: 'UNSUPPORTED', diagnostic: 'INDUSTRY_OPERATION_REQUIREMENT_MISMATCH' }
    if (!requirement.metricId?.startsWith('industry:') || !target) return { status: 'UNSUPPORTED', diagnostic: 'INDUSTRY_METRIC_TARGET_REQUIRED' }
    try {
      const acquired = await acquisition.acquireNamed({
        target, asOf: requirement.analysisAsOf ?? requirement.asOf, now, ...(signal ? { signal } : {}),
        metricId: requirement.metricId, ...(requirement.period ? { period: requirement.period } : {}),
      }, requirement.metricId)
      const documents = acquired.sources.map(normalizedDocument)
      const eligibleSourceIdentities = new Set(documents.filter((document) => document.rights.accessScope === 'public'
        && document.rights.retentionAllowed && document.rights.aiProcessingAllowed && document.rights.derivativeKnowledgeAllowed)
        .map((document) => document.sourceIdentity))
      const observations = acquired.observations.map((observation) => normalizeIndustryObservationCandidate(observation, requirement, candidate.operationId))
        .filter((item): item is IndustryObservationCandidate => item !== undefined && eligibleSourceIdentities.has(item.sourceIdentity))
      const deniedSources = documents.length - eligibleSourceIdentities.size
      const rightsRejected = acquired.sources.length > 0 && deniedSources === acquired.sources.length
      const diagnostics = [...acquired.diagnostics, ...(deniedSources > 0 ? ['INDUSTRY_METRIC_SOURCE_RIGHTS_REJECTED'] : [])]
      if (!observations.length && rightsRejected) return { status: 'ACCESS_DENIED', diagnostic: diagnostics.join('|') }
      if (!observations.length && !documents.length) {
        return { status: acquired.status === 'TRANSPORT_UNAVAILABLE' ? 'SOURCE_ERROR' : acquired.status === 'PARSER_UNAVAILABLE' ? 'PARSE_ERROR' : 'NO_DATA', diagnostic: acquired.diagnostics.join('|') || 'INDUSTRY_METRIC_NO_USABLE_OBSERVATION' }
      }
      const first = acquired.observations[0]
      return {
        status: 'SUCCESS',
        data: { documents, observationCandidates: observations, diagnostics: diagnostics.slice(0, 16), outcome: { transportSucceeded: !diagnostics.some((item) => /HTTP_|TRANSPORT|TIMEOUT/.test(item)), fetchSucceeded: documents.length > 0 || observations.length > 0, discovered: acquired.sources.length, fetched: documents.length, failed: acquired.diagnostics.length, empty: acquired.sources.length === 0 ? 1 : 0, rejected: deniedSources, deduplicated: 0 } },
        source: {
          originAuthority: candidate.originAuthority,
          ...(first ? { originPublisher: first.originPublisher, hostPlatform: first.hostPlatform, retrievalProvider: first.retrievalProvider, publishedAt: first.publishedAt, retrievedAt: first.retrievedAt, valueVersion: { status: 'UNVERIFIED', reason: 'Current source does not expose archived value revisions.' } } : {}),
          ...(documents[0]?.sourceUrl ? { sourceUrl: documents[0].sourceUrl } : {}),
        },
      }
    } catch (error) {
      return { status: error instanceof Error && error.message === 'WORKFLOW_CANCELLED' ? 'SOURCE_ERROR' : 'PARSE_ERROR', diagnostic: error instanceof Error ? error.message : String(error) }
    }
  }
}
