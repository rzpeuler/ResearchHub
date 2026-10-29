/** Private Phase 1 contract. It is intentionally not imported by the production workflow. */

export const SCENARIO_METHOD_CONTRACT_VERSION = 's4-private-contract-v1' as const
export const SCENARIO_METHOD_HASH_SCHEMA = 's4-canonical-json-v1' as const

declare const nonEmptyStringBrand: unique symbol
declare const isoInstantBrand: unique symbol
declare const isoDateBrand: unique symbol
declare const sha256Brand: unique symbol

/** Brands are only emitted by runtime parsers; they are not evidence of source trust. */
export type NonEmptyString = string & { readonly [nonEmptyStringBrand]: true }
export type IsoInstant = string & { readonly [isoInstantBrand]: true }
export type IsoDate = string & { readonly [isoDateBrand]: true }
export type Sha256 = string & { readonly [sha256Brand]: true }

export type ScenarioName = 'BEAR' | 'BASE' | 'BULL'
export type OriginKind = 'FACT' | 'INFERENCE' | 'DERIVED'
export type ValueVersionStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNAVAILABLE' | 'CONFLICTED' | 'NOT_APPLICABLE'
export type Eligibility = 'QUALIFIED' | 'UNVERIFIED' | 'UNAVAILABLE' | 'CONFLICTED' | 'NOT_APPLICABLE'
export type AsOfMode = 'FROZEN_T0' | 'NEW_T1'
export type EvidenceConsumer = 'OPERATING_DRIVER' | 'BULL_BASE_BEAR' | 'VALUATION' | 'VARIANT_PERCEPTION'

export type ValueNormalizationRule =
  | { readonly kind: 'IDENTITY'; readonly formulaVersion: 'identity-v1' }
  | { readonly kind: 'MULTIPLY'; readonly factor: number; readonly formulaVersion: string }
  | { readonly kind: 'DIVIDE'; readonly divisor: number; readonly formulaVersion: string }

export interface ScenarioHorizon {
  readonly analysisAsOf: string
  readonly asOfMode: AsOfMode
  readonly targetFiscalYear: number
  readonly targetPeriodStart: string
  readonly targetPeriodEnd: string
  readonly targetPeriodBasis: 'FY' | 'H1_YTD' | 'QUARTER' | 'OTHER'
  readonly baseFiscalYear: number
  readonly basePeriodEnd: string
  readonly basePeriodBasis: 'FY' | 'H1_YTD' | 'QUARTER' | 'OTHER'
  readonly financialScope: string
  readonly currency: string
  readonly methodId: string
  readonly requiredDriverIds: readonly string[]
  readonly sourceSnapshotHash: string
}

export interface EvidenceBinding {
  readonly sourceCandidateId: string
  readonly sourceLocation: string
  readonly immutableSourceContentHash: string
  /** Exact immutable text payload used for this in-memory validation; never a trust anchor by itself. */
  readonly immutableSourceContent: string
  readonly sourceExcerptText: string
  readonly rawValueToken: string
  readonly normalizedValue: number | string
  readonly normalizationRule: ValueNormalizationRule
  readonly unit: string
  readonly currency: string | null
  readonly metricId: string
  readonly periodStart: string | null
  readonly periodEnd: string
  readonly periodBasis: string
  readonly financialScope: string
  readonly shareBasis: 'BASIC' | 'DILUTED' | 'ADJUSTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED' | null
  readonly rowBindingHash: string
  readonly sourceRetrievedAt: string
}

export interface RightsEvidence {
  readonly recordId: string
  readonly evidenceHash: string
  readonly intendedUse: EvidenceConsumer
  readonly decision: 'ALLOWED' | 'DENIED' | 'UNKNOWN'
  /** Caller claim only. No approved rights authority is currently wired into this private slice. */
  readonly evidenceTextHash: string | null
  readonly evidenceText: string | null
}

interface ValueVersionProofBase {
  readonly proofId: string
  /** Frozen source-evidence manifest reference; checked against the canonical input manifest. */
  readonly evidenceManifestHash: string
  readonly claimedProofStatus: 'VERIFIED' | 'UNVERIFIED' | 'UNAVAILABLE' | 'CONFLICTED'
  readonly sourceCandidateId: string
  readonly sourceLocation: string
  readonly immutableSourceContentHash: string
  readonly rawValueToken: string
  readonly normalizedValue: number | string
  readonly normalizationRule: ValueNormalizationRule
  readonly unit: string
  readonly currency: string | null
  readonly epsBasis: 'BASIC' | 'DILUTED' | 'ADJUSTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED' | null
  readonly metricId: string
  readonly periodStart: string | null
  readonly periodEnd: string
  readonly periodBasis: string
  readonly financialScope: string
  readonly rowBindingHash: string
  readonly valueVersionId: string | null
  readonly valueVersionAvailableAt: string | null
  readonly sourcePublishedAt: string | null
  readonly observedAt: string | null
  readonly retrievedAt: string | null
  readonly revisionStatus: 'COMPLETE' | 'UNKNOWN' | 'CONFLICTED'
  readonly revisionChainHash: string | null
  readonly rights: RightsEvidence
  readonly analysisAsOf: string
  readonly trustRoot: string | null
  readonly proofReference: string | null
}

export interface OfficialDocumentVersionProof extends ValueVersionProofBase {
  readonly method: 'OFFICIAL_PUBLISHED_DOCUMENT'
  readonly publicationRecordReference: string | null
  readonly snapshotCapturedAt: null
  readonly snapshotSealedAt: null
  readonly signatureVerificationReference: null
}

export interface ImmutableProviderVintageProof extends ValueVersionProofBase {
  readonly method: 'IMMUTABLE_PROVIDER_VINTAGE'
  readonly publicationRecordReference: null
  readonly snapshotCapturedAt: string | null
  readonly snapshotSealedAt: string | null
  readonly signatureVerificationReference: null
}

export interface TrustedSealedSnapshotProof extends ValueVersionProofBase {
  readonly method: 'TRUSTED_SEALED_SNAPSHOT'
  readonly publicationRecordReference: null
  readonly snapshotCapturedAt: string | null
  readonly snapshotSealedAt: string | null
  readonly signatureVerificationReference: string | null
}

export type ValueVersionProof = OfficialDocumentVersionProof | ImmutableProviderVintageProof | TrustedSealedSnapshotProof

export interface ObservationBase {
  readonly observationId: string
  readonly companySymbol: string
  readonly driverId: string
  readonly metricId: string
  readonly atomicSkillOwner: string
  readonly consumer: EvidenceConsumer
  readonly economicScope: string
  readonly financialScope: string
  readonly periodStart: string | null
  readonly periodEnd: string | null
  readonly fiscalYear: number | null
  readonly periodBasis: string | null
  readonly flowOrStock: 'FLOW' | 'STOCK' | 'RATE' | 'COUNT' | 'TEXT'
  readonly unit: string | null
  readonly currency: string | null
  readonly shareBasis: 'BASIC' | 'DILUTED' | 'ADJUSTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED' | null
  readonly observedAt: string | null
  readonly sourcePublishedAt: string | null
  readonly retrievedAt: string | null
  readonly analysisAsOf: string
  readonly asOfMode: AsOfMode
  readonly evidenceManifestHash: string
  readonly sourceConflicts: readonly string[]
}

/** Caller-supplied status fields are claims. Validators recompute outcome from evidence. */
export interface QualifiedFactObservation extends ObservationBase {
  readonly kind: 'FACT'
  readonly originKind: 'FACT'
  readonly claimedValueVersionStatus: ValueVersionStatus
  readonly claimedEligibility: Eligibility
  readonly evidence: EvidenceBinding
  readonly rights: RightsEvidence
  readonly valueVersionProof: ValueVersionProof | null
}

export interface InferenceObservation extends ObservationBase {
  readonly kind: 'INFERENCE'
  readonly originKind: 'INFERENCE'
  readonly claimedValueVersionStatus: ValueVersionStatus
  readonly claimedEligibility: Eligibility
  readonly inferenceInputRefs: readonly string[]
  readonly inferenceRule: string
  readonly evidenceManifestHash: string
}

export interface DerivedObservation extends ObservationBase {
  readonly kind: 'DERIVED'
  readonly originKind: 'DERIVED'
  readonly claimedValueVersionStatus: 'NOT_APPLICABLE'
  readonly claimedEligibility: Eligibility
  readonly derivation: {
    readonly operation: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'PERCENT_CHANGE'
    readonly purpose: 'OBSERVED_ARITHMETIC_ONLY'
    readonly inputObservationIds: readonly string[]
    readonly result: number
    readonly formulaVersion: string
  }
}

export interface MissingObservation extends ObservationBase {
  readonly kind: 'MISSING'
  readonly originKind: OriginKind
  readonly claimedValueVersionStatus: 'UNAVAILABLE' | 'UNVERIFIED' | 'CONFLICTED' | 'NOT_APPLICABLE'
  readonly claimedEligibility: 'UNAVAILABLE' | 'UNVERIFIED' | 'CONFLICTED' | 'NOT_APPLICABLE'
  readonly missingFields: readonly string[]
  readonly rejectionReasons: readonly string[]
  readonly evidence: null
  readonly rights: null
  readonly valueVersionProof: null
  readonly normalizedValue: null
}

export type EconomicDriverObservation = QualifiedFactObservation | InferenceObservation | DerivedObservation | MissingObservation

export interface ResearchAssumptionProposal {
  readonly proposalId: string
  readonly companySymbol: string
  readonly scenario: ScenarioName
  readonly driverId: string
  readonly originKind: 'RESEARCH_ASSUMPTION'
  readonly authorId: string
  readonly targetFiscalYear: number
  readonly targetPeriodStart: string
  readonly targetPeriodEnd: string
  readonly financialScope: string
  readonly unit: string
  readonly currency: string | null
  /** A proposed value is validated, never generated by this module. */
  readonly proposedValue: number | null
  readonly mechanism: string
  readonly calibrationRefs: readonly string[]
  readonly counterEvidenceRefs: readonly string[]
  readonly falsifiableTrigger: string
  readonly inputObservationRefs: readonly string[]
  readonly proposalVersion: string
}

export interface BridgeAdjustment {
  readonly adjustmentId: string
  readonly kind: 'NON_RECURRING' | 'CONSOLIDATION' | 'ELIMINATION' | 'RECLASSIFICATION' | 'RESIDUAL'
  readonly description: string
  readonly evidenceRefs: readonly string[]
  readonly disposition: 'INCLUDED_ONCE' | 'EXCLUDED' | 'UNRESOLVED'
}

export interface ScenarioForecastBridge {
  readonly scenario: ScenarioName
  readonly horizon: ScenarioHorizon
  readonly companySymbol: string
  readonly financialScope: string
  readonly currency: string
  readonly methodId: string
  readonly requiredDriverIds: readonly string[]
  readonly driverProposalRefs: readonly string[]
  readonly driverObservationRefs: readonly string[]
  readonly residualPolicy: 'EXPLICIT' | 'NOT_REQUIRED' | 'UNAVAILABLE'
  readonly residualDescription: string | null
  readonly adjustments: readonly BridgeAdjustment[]
}

export interface BearBaseBullSet {
  /** Must be exactly [BEAR, BASE, BULL]. */
  readonly scenarios: readonly [ScenarioForecastBridge, ScenarioForecastBridge, ScenarioForecastBridge]
  readonly proposals: readonly ResearchAssumptionProposal[]
  readonly requiredDriverIds: readonly string[]
}

export interface ScenarioMethodContractInput {
  readonly horizon: ScenarioHorizon
  readonly observations: readonly EconomicDriverObservation[]
  readonly scenarioSet: BearBaseBullSet
  readonly methodVersion: string
  readonly rubricVersion: string
}

export type ReviewProcessState = 'REVIEW_REQUIRED' | 'UNAVAILABLE' | 'REJECTED' | 'STALE_REVIEW'

export interface AssumptionReviewRecord {
  readonly state: ReviewProcessState
  readonly authorId: string
  readonly reviewerId: string | null
  readonly reviewPacketHash: string
  readonly reviewerDecisionReference: string | null
  readonly independentOfAuthorClaim: boolean
}

export type ScenarioMethodDiagnosticCode =
  | 'STRUCTURAL_INVALID'
  | 'SOURCE_UNVERIFIED'
  | 'SOURCE_RIGHTS_UNVERIFIED'
  | 'VALUE_VERSION_UNPROVEN'
  | 'HISTORICAL_CUTOFF_VIOLATION'
  | 'SCOPE_MISMATCH'
  | 'PERIOD_MISMATCH'
  | 'UNIT_MISMATCH'
  | 'CLASS_PRICE_MISSING'
  | 'REVIEW_REQUIRED'
  | 'STALE_REVIEW'
  | 'MISSING_REQUIRED_DRIVER'
  | 'SOURCE_BINDING_MISMATCH'
  | 'SOURCE_LOCATION_UNVERIFIED'
  | 'DERIVATION_MISMATCH'
  | 'CONFLICTED_EVIDENCE'

export interface ScenarioMethodDiagnostic {
  readonly code: ScenarioMethodDiagnosticCode
  readonly subjectId: string
  readonly downstream: readonly EvidenceConsumer[]
  readonly reason: string
}

export interface ScenarioMethodResult {
  readonly contractVersion: typeof SCENARIO_METHOD_CONTRACT_VERSION
  readonly structuralStatus: 'STRUCTURALLY_VALID' | 'STRUCTURAL_INVALID'
  readonly methodStatus: 'REVIEW_REQUIRED' | 'UNAVAILABLE' | 'REJECTED' | 'STALE_REVIEW'
  readonly evidenceManifestHash: Sha256
  readonly valueVersionProofSetHash: Sha256
  readonly reviewPacketHash: Sha256
  readonly reportEligible: false
  readonly diagnostics: readonly ScenarioMethodDiagnostic[]
  readonly observationAssessments: readonly ObservationAssessment[]
}

export interface ObservationAssessment {
  readonly observationId: string
  readonly originKind: OriginKind
  readonly claimedValueVersionStatus: ValueVersionStatus
  readonly valueVersionStatus: ValueVersionStatus
  readonly claimedEligibility: Eligibility
  readonly eligibility: Eligibility
  readonly diagnostics: readonly ScenarioMethodDiagnostic[]
}

export interface ScenarioReviewFreshness {
  readonly state: 'REVIEW_REQUIRED' | 'STALE_REVIEW'
  readonly staleFields: readonly string[]
  readonly expectedReviewPacketHash: Sha256
  readonly actualReviewPacketHash: Sha256 | null
}

export interface EquityClassMarketInput {
  readonly classId: string
  readonly listedSecurityUnit: string
  readonly underlyingSharesPerListedUnit: number | null
  readonly quoteCurrency: string
  readonly closePrice: number | null
  readonly closeAvailableAt: string | null
  readonly closeTradingDate: string | null
  readonly closeTimeZone: string | null
  readonly fxToReportingCurrency: number | null
  readonly fxAvailableAt: string | null
  readonly fxTradingDate: string | null
  readonly fxTimeZone: string | null
  readonly issuedShares: number | null
  readonly issuedShareBasis: 'POST_CANCELLATION_ISSUED' | 'PRE_CANCELLATION_ISSUED' | 'UNKNOWN'
  readonly cancelledShares: number | null
  readonly cancellationEffectiveAt: string | null
  readonly treasuryShares: number | null
  readonly repurchasedHeldShares: number | null
  readonly treasuryIncludesRepurchasedShares: boolean | null
  readonly shareCountAvailableAt: string | null
  readonly shareCountAsOf: string | null
  readonly targetDateDilutedShares: number | null
  readonly dilutedShareTargetDate: string | null
  readonly dilutedSharesAvailableAt: string | null
  readonly classRightsReference: string | null
}

export interface EquityMarketInput {
  readonly mode: 'FIXTURE_ONLY'
  readonly analysisAsOf: string
  readonly marketDate: string
  readonly targetDate: string
  readonly reportingCurrency: string
  readonly classes: readonly EquityClassMarketInput[]
  readonly companyRightsAllocationReference: string | null
  readonly expectedClassIds: readonly string[]
}

export interface EquityMarketAssessment {
  readonly status: 'UNAVAILABLE' | 'STRUCTURALLY_VALID_FIXTURE_ONLY'
  readonly reportEligible: false
  readonly missingClassIds: readonly string[]
  readonly shareCountTreatments: readonly {
    readonly classId: string
    readonly issuedSharesRule: 'USE_POST_CANCELLATION_AS_IS' | 'SUBTRACT_PROVEN_CANCELLATIONS' | 'UNAVAILABLE'
    readonly heldSharesRule: 'SUBTRACT_TREASURY_ONCE' | 'SUBTRACT_TREASURY_PLUS_NONOVERLAPPING_REPURCHASES' | 'UNAVAILABLE'
    readonly listedUnitConversionAppliedOnce: true
    readonly targetDilutedDenominatorSeparate: true
  }[]
  readonly diagnostics: readonly ScenarioMethodDiagnostic[]
}

export type BridgeAmountEvidence =
  | { readonly status: 'KNOWN'; readonly amount: number; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'KNOWN_ZERO'; readonly amount: 0; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'NOT_APPLICABLE'; readonly reason: string; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string }

export interface EnterpriseValueBridgeConsistencyInput {
  readonly mode: 'FIXTURE_ONLY'
  readonly debtBasis: 'GROSS_DEBT' | 'NET_DEBT'
  readonly grossDebt: BridgeAmountEvidence
  readonly netDebt: BridgeAmountEvidence
  readonly separatelySubtractedCash: BridgeAmountEvidence
  readonly grossDebtIncludesLeases: boolean | null
  readonly leaseClaimsIncluded: boolean
  readonly leaseAmount: BridgeAmountEvidence
  readonly leaseInEarningsBasis: boolean | null
  readonly preferredAndConvertibleClaims: BridgeAmountEvidence
  readonly nonControllingClaims: BridgeAmountEvidence
  readonly otherSeniorClaims: BridgeAmountEvidence
  readonly adjustments: readonly BridgeAdjustment[]
  readonly classAllocationReference: string | null
  readonly allocatedClassEquityValues: Readonly<Record<string, number>> | null
  readonly totalEquityValue: BridgeAmountEvidence
  readonly market: EquityMarketInput
}

// S4-007B-002-B: private, synthetic-only accounting bridge contracts. These are
// deliberately separate from ScenarioForecastBridge and the EV amount contract.
export type EconomicValueEvidence =
  | { readonly status: 'KNOWN'; readonly value: number; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'KNOWN_ZERO'; readonly value: 0; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'NOT_APPLICABLE'; readonly reason: string; readonly evidenceRefs: readonly [string, ...string[]] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string }

export interface CalibrationRange {
  readonly calibrationId: string
  readonly lower: EconomicValueEvidence
  readonly upper: EconomicValueEvidence
  readonly dimension: 'CURRENCY_AMOUNT' | 'CURRENCY_PER_UNIT' | 'COUNT' | 'RATE' | 'CURRENCY_AMOUNT_PER_PERIOD'
  readonly unit: string
  readonly currency: string | null
  readonly periodBasis: string
  readonly financialScope: string
  readonly economicScope: string
  readonly method: string | null
  readonly evidenceRefs: readonly string[]
  readonly category: 'OPERATIONAL_MECHANISM' | 'HISTORICAL_OR_INDUSTRY_ENVELOPE'
  readonly status: 'CALIBRATED' | 'UNVERIFIED' | 'MISSING'
}

export interface EconomicBridgeLine {
  readonly lineId: string
  readonly economicLineKey: string
  readonly bridgeId: string
  readonly companySymbol: string
  readonly scenario: ScenarioName
  readonly fromMetric: string
  readonly toMetric: string
  readonly operation: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'RECLASSIFY'
  readonly inputRefs: readonly string[]
  readonly amount: EconomicValueEvidence
  readonly dimension: CalibrationRange['dimension']
  readonly unit: string
  readonly currency: string | null
  readonly periodStart: string
  readonly periodEnd: string
  readonly periodBasis: string
  readonly flowOrStock: 'FLOW' | 'STOCK' | 'RATE' | 'COUNT'
  readonly shareBasis?: 'BASIC' | 'DILUTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED'
  readonly financialScope: string
  readonly economicScope: string
  readonly originKind: 'FACT' | 'DERIVED' | 'INFERENCE' | 'RESEARCH_ASSUMPTION'
  readonly formulaVersion: string
  readonly evidenceRefs: readonly string[]
  readonly adjustmentRefs: readonly string[]
  readonly disposition: 'INCLUDED_ONCE' | 'CROSS_CHECK_ONLY' | 'EXCLUDED' | 'UNRESOLVED'
}

export interface EconomicBridgeScalar {
  readonly value: EconomicValueEvidence
  readonly companySymbol: string
  readonly metricId: string
  readonly dimension: CalibrationRange['dimension']
  readonly unit: string
  readonly currency: string | null
  readonly periodStart: string
  readonly periodEnd: string
  readonly periodBasis: string
  readonly flowOrStock: 'FLOW' | 'STOCK' | 'RATE' | 'COUNT'
  readonly financialScope: string
  readonly economicScope: string
  readonly sourceId: string
  readonly accountId?: string
  readonly mappingRole?: string
  readonly signConvention?: 'SIGNED_AMOUNT' | 'POSITIVE_EXPENSE' | 'POSITIVE_CASH_OUTFLOW'
  readonly shareBasis?: 'BASIC' | 'DILUTED' | 'NOT_APPLICABLE' | 'UNSPECIFIED'
}

export interface EconomicBridgeInput {
  readonly mode: 'FIXTURE_ONLY'
  readonly companySymbol: string
  readonly bridgeId: string
  readonly analysisAsOf: string
  readonly horizon: { readonly scenario: ScenarioName; readonly periodStart: string; readonly periodEnd: string; readonly periodBasis: string }
  readonly formulaVersion: string
  readonly rightsVersionClaim: string
  readonly valueVersionClaim: string
  readonly sourceTimeClaims: { readonly sourcePublishedAt: string | null; readonly retrievedAt: string | null; readonly valueVersionAvailableAt: string | null; readonly snapshotCapturedAt: string | null; readonly snapshotSealedAt: string | null }
  readonly revenue: {
    readonly lines: readonly EconomicBridgeLine[]
    readonly selectedRoute: 'DISCLOSED_SEGMENT_REVENUE' | 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP'
    readonly volume: EconomicBridgeScalar | null
    readonly realizedNetAsp: EconomicBridgeScalar | null
    readonly reportedConsolidatedRevenue: EconomicBridgeScalar
    readonly adjustments: readonly { readonly adjustmentId: string; readonly accountId: string; readonly kind: 'ACQUISITION' | 'DISPOSAL' | 'RECLASSIFICATION' | 'ELIMINATION'; readonly signedAmount: EconomicBridgeScalar; readonly overlapsLineId: string | null; readonly evidenceRefs: readonly string[] }[]
  }
  readonly profit: {
    readonly cogs: EconomicBridgeScalar
    readonly operatingExpenses: readonly EconomicBridgeScalar[]
    readonly otherOperatingIncome: readonly EconomicBridgeScalar[]
    readonly signedNetFinanceItems: EconomicBridgeScalar
    readonly signedNonOperatingItems: EconomicBridgeScalar
    readonly incomeTaxExpense: EconomicBridgeScalar
    readonly profitAttributableToNci: EconomicBridgeScalar
    readonly nciBasis: 'CONSOLIDATED_TO_PARENT' | 'MISSING' | 'MIXED'
    readonly ebit: EconomicBridgeScalar
    readonly nonRecurringItems: readonly { readonly adjustmentId: string; readonly accountId: string; readonly amount: EconomicBridgeScalar; readonly treatment: 'INCLUDED_IN_OPERATING_EXPENSES' | 'EXCLUDED_FROM_OPERATING_PROFIT' | 'UNRESOLVED'; readonly overlapsAccountId: string | null }[]
  }
  readonly fcff: {
    readonly unleveredEbit: EconomicBridgeScalar
    readonly taxRate: EconomicBridgeScalar
    readonly taxConvention: string | null
    readonly da: EconomicBridgeScalar
    readonly capex: EconomicBridgeScalar
    readonly nwcStart: readonly EconomicBridgeScalar[]
    readonly nwcEnd: readonly EconomicBridgeScalar[]
    readonly nwcComplete: boolean
    readonly excludedOperatingCapitalIds: readonly string[]
    readonly leaseTreatment: string | null
    readonly acquisitionTreatment: string | null
    readonly taxTreatment: string | null
    readonly cfo: EconomicBridgeScalar | null
    readonly purchasesOfLongTermAssets: EconomicBridgeScalar | null
  }
  readonly calibrationProposals: readonly {
    readonly scenario: ScenarioName
    readonly driverId: string
    readonly baseline: string | null
    readonly proposedValue: number | null
    readonly mechanism: string | null
    readonly calibration: CalibrationRange | null
    readonly strongestCounterevidence: string | null
    readonly trigger: string | null
    readonly author: string | null
  }[]
}

export type EconomicBridgeDiagnosticCode =
  | 'DOUBLE_COUNTED_REVENUE_PATH' | 'SCOPE_MISMATCH' | 'PERIOD_MISMATCH' | 'UNIT_MISMATCH'
  | 'MISSING_REQUIRED_OPERAND' | 'DUPLICATE_ADJUSTMENT' | 'RESIDUAL_UNVERIFIED'
  | 'ACCOUNT_MAPPING_OVERLAP' | 'NCI_SCOPE_MISSING' | 'FCFF_INPUTS_MISSING'
  | 'HISTORICAL_ENVELOPE_NOT_CALIBRATION' | 'REVIEW_REQUIRED' | 'INVALID_NUMBER'
  | 'NEGATIVE_PHYSICAL_QUANTITY' | 'INVALID_STRUCTURE' | 'NON_RECURRING_UNRESOLVED'

export interface EconomicBridgeDiagnostic {
  readonly code: EconomicBridgeDiagnosticCode
  readonly subjectId: string
  readonly reason: string
}

export interface EconomicBridgeComponent {
  readonly status: 'KNOWN' | 'UNAVAILABLE'
  readonly value?: number
  readonly formulaVersion: string
  readonly lineageIds: readonly string[]
  readonly reason?: string
}

export interface EconomicBridgeResult {
  readonly status: 'STRUCTURALLY_VALID_FIXTURE_ONLY' | 'UNAVAILABLE'
  readonly reportEligible: false
  readonly inputHash: string
  readonly bridgeHash: string
  readonly components: Readonly<Record<string, EconomicBridgeComponent>>
  readonly residual: EconomicBridgeComponent
  readonly cashFlowDifference: EconomicBridgeComponent
  readonly assumptionReviewStatus: 'REVIEW_REQUIRED'
  readonly diagnostics: readonly EconomicBridgeDiagnostic[]
}
