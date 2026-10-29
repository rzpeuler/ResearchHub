/** Schema-neutral research contracts for point-in-time earnings expectations. */

export type ExpectationMetric = 'revenue' | 'net_profit' | 'eps' | 'gross_margin' | (string & {})

export const EPS_PER_SHARE_UNIT = 'CNY_per_share' as const

export interface EstimatePoint {
  readonly estimateId: string
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly value: number
  readonly unit: string
  readonly institutionKey: string
  readonly analystKey?: string
  readonly publishedAt: string
  readonly estimateHorizon?: string
  readonly sourceCandidateIds: readonly string[]
}

export interface ConsensusSnapshot {
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly unit: string
  readonly asOf: string
  readonly mean: number
  readonly median: number
  readonly high: number
  readonly low: number
  readonly count: number
  readonly dispersion?: number
  readonly contributingEstimateIds: readonly string[]
}

export interface ActualMetricPoint {
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly value: number
  readonly unit: string
  readonly sourceCandidateIds: readonly string[]
}

export type ExpectationBenchmarkType = 'consensus' | 'prior_estimate' | 'guidance_midpoint'
export type ExpectationDirection = 'above' | 'below' | 'in_line'

export interface ExpectationBenchmark {
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly value: number
  readonly unit: string
  readonly benchmarkType: ExpectationBenchmarkType
}

export interface ActualVsExpectationResult {
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly actual: number
  readonly benchmark: number
  readonly absoluteDelta: number
  readonly relativeDelta?: number
  readonly direction: ExpectationDirection
  readonly benchmarkType: ExpectationBenchmarkType
}

export interface EstimateRevisionResult {
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly institutionKey: string
  readonly oldValue: number
  readonly newValue: number
  readonly absoluteRevision: number
  readonly relativeRevision?: number
  readonly oldPublishedAt: string
  readonly newPublishedAt: string
}

export interface EstimateSelectionInput {
  readonly estimates: readonly EstimatePoint[]
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly asOf: string
}

export interface EstimateSelectionResult {
  readonly selected: readonly EstimatePoint[]
  readonly excludedEstimateIds: readonly string[]
  readonly diagnostics: readonly string[]
}

export interface ConsensusCalculationInput extends EstimateSelectionInput {
  readonly minimumCount: number
}

export interface ConsensusCalculationResult {
  readonly snapshot?: ConsensusSnapshot
  readonly selectedEstimates: readonly EstimatePoint[]
  readonly diagnostics: readonly string[]
}

export interface PriorEstimateSelectionInput {
  readonly estimates: readonly EstimatePoint[]
  readonly metric: ExpectationMetric
  readonly fiscalPeriod: string
  readonly institutionKey: string
  readonly beforePublishedAt: string
  readonly analysisAsOf: string
}

export interface ActualVsPriorEstimateInput {
  readonly actual: ActualMetricPoint
  readonly estimates: readonly EstimatePoint[]
  readonly institutionKey: string
  readonly comparisonCutoff: string
}

export interface EstimateRevisionInput {
  readonly oldEstimate: EstimatePoint
  readonly newEstimate: EstimatePoint
}

export type GuidanceType = 'range' | 'minimum' | 'maximum' | 'point' | 'qualitative'

export interface GuidanceRange {
  readonly guidanceId: string
  readonly metric: string
  readonly fiscalPeriod: string
  readonly low?: number
  readonly high?: number
  readonly midpoint?: number
  readonly unit?: string
  readonly guidanceType: GuidanceType
  readonly publishedAt: string
  readonly sourceCandidateIds: readonly string[]
  readonly qualifiers: readonly string[]
}

export interface PriorGuidanceSelectionInput {
  readonly guidances: readonly GuidanceRange[]
  readonly metric: string
  readonly fiscalPeriod: string
  readonly beforePublishedAt: string
  readonly analysisAsOf: string
}

export interface PriorGuidanceSelectionResult {
  readonly selected?: GuidanceRange
  readonly diagnostics: readonly string[]
}

export interface NumericRevision {
  readonly oldValue: number
  readonly newValue: number
  readonly absoluteRevision: number
  readonly relativeRevision?: number
}

export interface GuidanceRevisionInput {
  readonly oldGuidance: GuidanceRange
  readonly newGuidance: GuidanceRange
}

export interface GuidanceRevisionResult {
  readonly metric: string
  readonly fiscalPeriod: string
  readonly unit: string
  readonly oldGuidanceId: string
  readonly newGuidanceId: string
  readonly oldGuidanceType: GuidanceType
  readonly newGuidanceType: GuidanceType
  readonly oldPublishedAt: string
  readonly newPublishedAt: string
  readonly lowEndRevision?: NumericRevision
  readonly highEndRevision?: NumericRevision
  readonly midpointRevision?: NumericRevision
  readonly rangeWidthChange?: NumericRevision
}

export type GuidanceConsensusRelationship =
  | 'below_range'
  | 'inside_range'
  | 'above_range'
  | 'below_minimum'
  | 'at_or_above_minimum'
  | 'at_or_below_maximum'
  | 'above_maximum'
  | 'below_point'
  | 'at_point'
  | 'above_point'

export interface GuidanceVsConsensusResult {
  readonly metric: string
  readonly fiscalPeriod: string
  readonly unit: string
  readonly guidanceId: string
  readonly guidanceType: GuidanceType
  readonly guidancePublishedAt: string
  readonly consensusAsOf: string
  readonly consensusMean: number
  readonly relationship: GuidanceConsensusRelationship
  readonly guidanceMidpoint?: number
  readonly absoluteDelta?: number
  readonly relativeDelta?: number
  readonly direction?: ExpectationDirection
}

export interface GuidanceConsensusComparisonInput {
  readonly guidance: GuidanceRange
  readonly consensus: ConsensusSnapshot
  readonly analysisAsOf: string
}

export interface SegmentKpiPoint {
  readonly segmentKey: string
  readonly metric: string
  readonly fiscalPeriod: string
  readonly value: number
  readonly unit: string
  readonly sourceCandidateIds: readonly string[]
}

export interface SegmentKpiDeltaInput {
  readonly current: SegmentKpiPoint
  readonly priorComparable?: SegmentKpiPoint
  readonly expectation?: SegmentKpiPoint
}

export interface NumericDelta {
  readonly benchmark: number
  readonly actual: number
  readonly absoluteDelta: number
  readonly relativeDelta?: number
  readonly direction: ExpectationDirection
}

export interface SegmentKpiDeltaResult {
  readonly segmentKey: string
  readonly metric: string
  readonly unit: string
  readonly currentPeriod: string
  readonly currentValue: number
  readonly priorPeriod?: string
  readonly priorComparison?: NumericDelta
  readonly expectationPeriod?: string
  readonly expectationComparison?: NumericDelta
}
