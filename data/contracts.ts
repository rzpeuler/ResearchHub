import type { MarketCloseFreshness } from './point-in-time.ts'

export type DataDeterminismClass =
  | 'AUTHORITATIVE_NUMERIC'
  | 'EVIDENCE_BACKED_NUMERIC'
  | 'SEMANTIC_QUALITATIVE'

export type LlmWebFallbackMode =
  | 'FORBIDDEN'
  | 'DISCOVERY_ONLY'
  | 'EXTRACT_WITH_PROVENANCE'
  | 'FULL_EVIDENCE_RESEARCH'

export type DataRequirementKind = 'metric' | 'estimate' | 'document' | 'event' | 'timeseries' | 'evidence'

export interface IndustryEvidenceQueryContext {
  readonly displayTarget: string
  readonly searchTerms: readonly string[]
  readonly purpose: string
  readonly start?: string
  readonly end?: string
}

/** Exact, bounded identity candidates supplied to the trusted security directory lookup. */
export interface SecurityIdentityQueryContext {
  readonly requestedName?: string
  readonly requestedSymbol?: string
  readonly requestedExchange?: string
}

export interface DataRequirement {
  readonly id: string
  readonly consumer: {
    readonly workflow: string
    readonly skill?: string
    /** Optional compatibility field for matching legacy workflow SourcePolicies. */
    readonly capability?: string
  }
  readonly subject: {
    readonly companyId?: string
    readonly industryId?: string
    readonly productId?: string
    readonly technologyId?: string
    readonly ticker?: string
    readonly geography?: string
  }
  readonly dataKind: DataRequirementKind
  readonly metricId?: string
  readonly metricFamily?: string
  /** Bounded provider-neutral query for cross-industry Industry document evidence. */
  readonly industryEvidenceQueryContext?: IndustryEvidenceQueryContext
  /** Bounded identity candidates; provider routing remains in SourcePolicy. */
  readonly securityIdentityQueryContext?: SecurityIdentityQueryContext
  readonly period?: {
    readonly start?: string
    readonly end?: string
    readonly fiscalPeriod?: string
    readonly fiscalYear?: number
  }
  readonly asOf: string
  /** Explicit consumer cutoff; mirrors legacy asOf when supplied. */
  readonly analysisAsOf?: string
  /** Distinguishes an unqualified live snapshot from a historical reconstruction request. */
  readonly asOfMode?: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'
  /** Historical numeric inputs require an identified version available by the cutoff. */
  readonly requireValueVersionProof?: boolean
  readonly determinismClass: DataDeterminismClass
  readonly requiredFields?: readonly string[]
  readonly minimumAuthority?: SourceAuthority
  readonly llmWebFallback: LlmWebFallbackMode
  /** Consumer-facing bundle completeness; omitted means required for compatibility. */
  readonly required?: boolean
}

export type SourceAuthority =
  | 'S0_STATUTORY'
  | 'S1_OFFICIAL'
  | 'S2_PROFESSIONAL'
  | 'S3_AGGREGATOR'
  | 'S4_COMMUNITY'

export type FallbackLevel = 'PRIMARY' | 'FALLBACK_1' | 'FALLBACK_2' | 'LLM_WEB'

export interface SourceCandidate {
  readonly sourceId: string
  readonly fallbackLevel: FallbackLevel
  readonly originAuthority: SourceAuthority
  readonly originPublisher?: string
  readonly operationId: string
  readonly supports: {
    readonly dataKinds: readonly DataRequirementKind[]
    readonly metricIds?: readonly string[]
    readonly metricFamilies?: readonly string[]
  }
}

export type SourceSelectionMode = 'FIRST_VALID' | 'CROSS_CHECK' | 'COLLECT_DIVERSE'

export interface SourcePolicy {
  readonly policyId: string
  readonly requirementMatch: {
    readonly workflow?: string
    readonly dataKind?: DataRequirementKind
    readonly metricId?: string
    readonly metricFamily?: string
    readonly capability?: string
  }
  readonly selectionMode: SourceSelectionMode
  readonly candidates: readonly SourceCandidate[]
}

export type AcquisitionAttemptStatus =
  | 'SUCCESS'
  | 'NO_DATA'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'ACCESS_DENIED'
  | 'SOURCE_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'STALE'
  | 'POINT_IN_TIME_INVALID'
  | 'UNSUPPORTED'

export interface AcquisitionAttempt {
  readonly sourceId: string
  readonly fallbackLevel: FallbackLevel
  readonly status: AcquisitionAttemptStatus
  readonly startedAt: string
  readonly completedAt: string
  readonly diagnostic?: string
}

export interface AcquisitionSourceMetadata {
  readonly sourceId: string
  readonly fallbackLevel: FallbackLevel
  readonly originPublisher?: string
  /** The public host/platform serving the source, distinct from publisher and retriever. */
  readonly hostPlatform?: string
  readonly originAuthority: SourceAuthority
  readonly retrievalProvider?: string
  readonly sourceUrl?: string
  readonly publishedAt?: string
  readonly retrievedAt: string
  /** Timestamp of the selected market observation, independent of retrieval. */
  readonly observedAt?: string
  /** When the selected observation became available, independent of its date and publication. */
  readonly observationAvailableAt?: string
  readonly valueVersion?: NumericValueVersionEvidence
  /** Data-owned market freshness decision carried from trusted acquisition. */
  readonly marketFreshness?: MarketCloseFreshness
}

export type NumericValueVersionEvidence =
  | { readonly status: 'VERIFIED'; readonly versionId: string; readonly availableAt: string }
  | { readonly status: 'UNVERIFIED'; readonly reason?: string }

export interface AcquisitionQuality {
  readonly pointInTimeSafe: boolean
  readonly complete: boolean
  readonly crossChecked: boolean
  readonly valueVersionStatus?: NumericValueVersionEvidence['status']
  readonly pitDiagnostic?: string
}

export interface AcquisitionObservation<T> {
  readonly data: T
  readonly source: AcquisitionSourceMetadata
}

export type AcquisitionCrossCheckStatus = 'CONSISTENT' | 'CONFLICT' | 'INSUFFICIENT_CROSS_CHECK'

export type AcquisitionUnavailableReason =
  | 'SOURCE_UNAVAILABLE'
  | 'PARSER_UNAVAILABLE'
  | 'PIT_INVALID'
  | 'UNIT_INVALID'
  | 'PERIOD_MISMATCH'
  | 'RIGHTS_REJECTED'
  | 'DATA_NOT_PUBLISHED'
  | 'NO_ELIGIBLE_POINT_IN_TIME_DATA'
  | 'INSUFFICIENT_AUTHORITY'
  | 'INCOMPLETE_REQUIRED_FIELDS'
  | 'SOURCE_CONFLICT'
  | 'NO_REGISTERED_POLICY'
  | 'AMBIGUOUS_POLICY'
  | 'ALL_FALLBACKS_EXHAUSTED'

export interface AcquisitionResult<T> {
  readonly requirementId: string
  readonly status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
  readonly data?: T
  readonly source: AcquisitionSourceMetadata | null
  readonly sources?: readonly AcquisitionSourceMetadata[]
  readonly observations?: readonly AcquisitionObservation<T>[]
  readonly quality: AcquisitionQuality
  readonly attempts: readonly AcquisitionAttempt[]
  readonly unavailableReason?: AcquisitionUnavailableReason
  readonly fallbackReason?: string
  readonly crossCheckStatus?: AcquisitionCrossCheckStatus
  readonly policyId?: string
}

export interface SourceExecutionSourceMetadata {
  readonly originPublisher?: string
  readonly retrievalProvider?: string
  readonly sourceUrl?: string
  readonly publishedAt?: string
  readonly retrievedAt?: string
  readonly hostPlatform?: string
  readonly observedAt?: string
  readonly observationAvailableAt?: string
  readonly valueVersion?: NumericValueVersionEvidence
  readonly marketFreshness?: MarketCloseFreshness
}

export type SourceExecutionFailureStatus = Exclude<AcquisitionAttemptStatus, 'SUCCESS' | 'VALIDATION_ERROR' | 'POINT_IN_TIME_INVALID'>

export type SourceExecutionResult<T> =
  | {
      readonly status: 'SUCCESS'
      readonly data: T
      readonly source?: SourceExecutionSourceMetadata
    }
  | {
      readonly status: SourceExecutionFailureStatus
      readonly diagnostic?: string
      readonly source?: SourceExecutionSourceMetadata
    }

export type AcquisitionExecutor<T> = (
  requirement: DataRequirement,
  candidate: SourceCandidate,
) => Promise<SourceExecutionResult<T>>

export interface SourcePolicyMatchResult {
  readonly status: 'MATCHED' | 'NO_REGISTERED_POLICY' | 'AMBIGUOUS_POLICY'
  readonly policy?: SourcePolicy
  readonly specificity?: number
  readonly candidatePolicyIds?: readonly string[]
}
