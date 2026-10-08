import type { DataRequirement, NumericValueVersionEvidence, SourceAuthority } from './contracts.ts'
import type { IndustryMetricDefinition, IndustryPeriodBasis, IndustryMetricQualifier } from './industry-catalog.ts'
import type { ResearchEvidenceInput } from './research-evidence.ts'

export type IndustryObservationAggregation = 'SUM' | 'AVERAGE' | 'END_OF_PERIOD' | 'NONE'
export type IndustryPublicationPit = 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE'
export type IndustryObservationMissingReason = 'MISSING' | 'NOT_REPORTED' | 'NOT_APPLICABLE' | 'SOURCE_UNAVAILABLE' | 'TRANSPORT_UNAVAILABLE' | 'PARSER_UNAVAILABLE' | 'NO_CANONICAL_METRIC'
export const INDUSTRY_OBSERVATION_MISSING_REASONS: readonly IndustryObservationMissingReason[] = Object.freeze([
  'MISSING', 'NOT_REPORTED', 'NOT_APPLICABLE', 'SOURCE_UNAVAILABLE', 'TRANSPORT_UNAVAILABLE', 'PARSER_UNAVAILABLE', 'NO_CANONICAL_METRIC',
])

export interface IndustryObservationCandidate {
  readonly metricId: string
  readonly value: number
  readonly qualifier: IndustryMetricQualifier
  readonly unit: string
  readonly originalValue: string | number
  readonly periodStart: string
  readonly periodEnd: string
  readonly frequency: string
  readonly periodBasis: IndustryPeriodBasis
  readonly aggregation: IndustryObservationAggregation
  readonly geography: string
  readonly product?: string
  readonly segment?: string
  readonly grade?: string
  readonly publishedAt: string
  readonly retrievedAt: string
  readonly originPublisher: string
  readonly hostPlatform: string
  readonly retrievalProvider: string
  readonly authority: SourceAuthority
  readonly publicationPit: IndustryPublicationPit
  readonly valueVersion: NumericValueVersionEvidence
  readonly sourceIdentity: string
  readonly diagnostics?: readonly string[]
}

export interface IndustryObservationPoint extends Omit<IndustryObservationCandidate, 'unit' | 'value'> {
  readonly value: number
  readonly canonicalUnit: string
  readonly originalUnit: string
  readonly diagnostics: readonly string[]
}

export interface IndustryOperationDocument extends ResearchEvidenceInput<unknown> {
  readonly rights: NonNullable<ResearchEvidenceInput<unknown>['rights']>
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

export interface IndustryObservationValidationResult {
  readonly status: 'VALID' | 'INVALID'
  readonly point?: IndustryObservationPoint
  readonly diagnostics: readonly string[]
}

const CONVERSION: Readonly<Record<string, (value: number) => number>> = Object.freeze({
  TEN_THOUSAND_CNY_TO_CNY: (value) => value * 10_000,
  CNY_TO_TEN_THOUSAND_CNY: (value) => value / 10_000,
})
const timestamp = (value: string): number | undefined => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const sameDayOrInstant = (actual: string, expected: string): boolean => actual.slice(0, 10) === expected.slice(0, 10)

export function validateIndustryObservation(
  candidate: IndustryObservationCandidate,
  definition: IndustryMetricDefinition,
  requirement: DataRequirement,
): IndustryObservationValidationResult {
  const diagnostics: string[] = []
  const invalid = (code: string): void => { if (!diagnostics.includes(code)) diagnostics.push(code) }
  if (definition.lifecycleStatus !== 'CANONICAL') invalid('INDUSTRY_METRIC_NOT_CANONICAL')
  if (candidate.metricId !== definition.metricId || (requirement.metricId !== undefined && requirement.metricId !== definition.metricId)) invalid('INDUSTRY_METRIC_ID_MISMATCH')
  if (requirement.subject.industryId !== undefined && requirement.subject.industryId !== definition.industryId) invalid('INDUSTRY_ID_MISMATCH')
  if (requirement.dataKind !== definition.dataKind) invalid('INDUSTRY_DATA_KIND_MISMATCH')
  if (!Number.isFinite(candidate.value)) invalid('INDUSTRY_VALUE_NOT_FINITE')
  if (!definition.requiredQualifiers?.includes(candidate.qualifier)) invalid('INDUSTRY_QUALIFIER_NOT_ALLOWED')
  const conversion = definition.unitConversions?.find((item) => item.sourceUnit === candidate.unit && item.targetUnit === definition.canonicalUnit)
  const convert = candidate.unit === definition.canonicalUnit ? (value: number) => value : conversion ? CONVERSION[conversion.conversionId] : undefined
  if (!definition.acceptedSourceUnits?.includes(candidate.unit) || !convert) invalid('UNSUPPORTED_INDUSTRY_UNIT')
  if (candidate.frequency !== definition.frequency || candidate.periodBasis !== definition.periodBasis || candidate.aggregation !== definition.aggregation) invalid('INDUSTRY_PERIOD_SEMANTICS_MISMATCH')
  if (!candidate.geography || (definition.geography && candidate.geography !== definition.geography)) invalid('INDUSTRY_GEOGRAPHY_MISMATCH')
  if (definition.product && candidate.product !== definition.product) invalid('INDUSTRY_PRODUCT_MISMATCH')
  if (definition.segment && candidate.segment !== definition.segment) invalid('INDUSTRY_SEGMENT_MISMATCH')
  if (definition.grade && candidate.grade !== definition.grade) invalid('INDUSTRY_GRADE_MISMATCH')
  if (timestamp(candidate.periodStart) === undefined || timestamp(candidate.periodEnd) === undefined || timestamp(candidate.periodStart)! > timestamp(candidate.periodEnd)!) invalid('INDUSTRY_PERIOD_INVALID')
  if (requirement.period?.start && !sameDayOrInstant(candidate.periodStart, requirement.period.start)) invalid('INDUSTRY_PERIOD_START_MISMATCH')
  if (requirement.period?.end && !sameDayOrInstant(candidate.periodEnd, requirement.period.end)) invalid('INDUSTRY_PERIOD_END_MISMATCH')
  const published = timestamp(candidate.publishedAt)
  const retrieved = timestamp(candidate.retrievedAt)
  const cutoff = timestamp(requirement.analysisAsOf ?? requirement.asOf)
  if (retrieved === undefined || published === undefined || cutoff === undefined) invalid('INDUSTRY_PIT_TIMESTAMP_INVALID')
  if (published !== undefined && cutoff !== undefined && published > cutoff) invalid('INDUSTRY_PUBLICATION_AFTER_CUTOFF')
  const authorityRank: Readonly<Record<SourceAuthority, number>> = { S0_STATUTORY: 0, S1_OFFICIAL: 1, S2_PROFESSIONAL: 2, S3_AGGREGATOR: 3, S4_COMMUNITY: 4 }
  if (requirement.minimumAuthority && authorityRank[candidate.authority] > authorityRank[requirement.minimumAuthority]) invalid('INDUSTRY_AUTHORITY_BELOW_REQUIREMENT')
  if (definition.pitPolicy?.publicationPit === 'REQUIRED' && candidate.publicationPit !== 'VERIFIED') invalid('INDUSTRY_PUBLICATION_PIT_UNVERIFIED')
  if (requirement.asOfMode === 'HISTORICAL' || requirement.requireValueVersionProof) {
    if (candidate.valueVersion.status !== 'VERIFIED') invalid('INDUSTRY_VALUE_VERSION_UNVERIFIED')
    else if (timestamp(candidate.valueVersion.availableAt) === undefined) invalid('INDUSTRY_VALUE_VERSION_TIMESTAMP_INVALID')
    else if (cutoff !== undefined && timestamp(candidate.valueVersion.availableAt)! > cutoff) invalid('INDUSTRY_VALUE_VERSION_AFTER_CUTOFF')
  }
  if (!candidate.originPublisher.trim() || !candidate.hostPlatform.trim() || !candidate.retrievalProvider.trim() || !candidate.sourceIdentity.trim()) invalid('INDUSTRY_PROVENANCE_INCOMPLETE')
  if (diagnostics.length) return { status: 'INVALID', diagnostics: Object.freeze(diagnostics) }
  const converted = convert!(candidate.value)
  if (!Number.isFinite(converted)) return { status: 'INVALID', diagnostics: ['INDUSTRY_CONVERSION_NOT_FINITE'] }
  const { unit, ...candidatePoint } = candidate
  const point: IndustryObservationPoint = Object.freeze({
    ...candidatePoint,
    value: converted,
    canonicalUnit: definition.canonicalUnit!,
    originalUnit: unit,
    diagnostics: Object.freeze([...(candidate.diagnostics ?? [])]),
  })
  return { status: 'VALID', point, diagnostics: Object.freeze([]) }
}

export interface IndustryObservationConflict {
  readonly slotIdentity: string
  readonly sourceIdentities: readonly string[]
  readonly values: readonly number[]
}
export interface IndustryObservationMergeResult {
  readonly points: readonly IndustryObservationPoint[]
  readonly conflicts: readonly IndustryObservationConflict[]
}
function slotIdentity(point: IndustryObservationPoint): string {
  return JSON.stringify([point.metricId, point.periodStart, point.periodEnd, point.periodBasis, point.frequency, point.aggregation, point.geography, point.product ?? '', point.segment ?? '', point.grade ?? '', point.qualifier])
}
export function mergeIndustryObservationPoints(points: readonly IndustryObservationPoint[]): IndustryObservationMergeResult {
  const slots = new Map<string, IndustryObservationPoint[]>()
  for (const point of points) {
    const identity = slotIdentity(point)
    const group = slots.get(identity) ?? []
    group.push(point)
    slots.set(identity, group)
  }
  const conflicts = [...slots.entries()].flatMap(([identity, group]) => {
    if (new Set(group.map((point) => point.value)).size < 2) return []
    return [{ slotIdentity: identity, sourceIdentities: [...new Set(group.map((point) => point.sourceIdentity))].sort(), values: [...new Set(group.map((point) => point.value))].sort((left, right) => left - right) }]
  })
  return { points: Object.freeze([...points]), conflicts: Object.freeze(conflicts.map((item) => Object.freeze({ ...item, sourceIdentities: Object.freeze(item.sourceIdentities), values: Object.freeze(item.values) }))) }
}
