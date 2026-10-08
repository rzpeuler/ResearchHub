import type { KnowledgeBaseHandle } from '../../knowledge/storage/handle.ts'
import type { ResolutionIntentSummary } from '../../knowledge/production/contracts.ts'
import type { EventResearchSignalStore } from '../../plugins/daily-intelligence/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchCompanyIdentity, ResearchProviderOutcome, NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import type { DataResolver } from '../../data/resolver.ts'
import type { AcquisitionSourceMetadata, DataRequirement } from '../../data/contracts.ts'
import type { CompanyResearchDataPayload } from '../../plugins/research-acquisition/company-research-data.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { EventAnchor } from '../../app/services/contracts.ts'
import type { EventEvidenceAssessmentOutput, EventImpactAssessment, EventResearchSection, EventResearchSynthesisOutput, EventResearchReasoningTelemetry, EventVerificationResult } from '../../skills/event-research/contracts.ts'
import type { ResearchQualityGateResult } from '../research-quality-gate.ts'

export type EventSourceRole = 'anchor_context' | 'verification' | 'supporting' | 'contradicting' | 'background'

export interface EventResearchResolvedAnchor {
  readonly context: import('../../skills/event-research/contracts.ts').EventResearchAnchorContext
  readonly sourceSignal?: import('../../plugins/daily-intelligence/contracts.ts').DailyResearchSignal
  readonly identity: string
}

export interface EventResearchProviderOutcome extends ResearchProviderOutcome {
  readonly transportSucceeded: boolean
  readonly fetchSucceeded: boolean
}

export interface EventAcquiredSource {
  readonly source: NormalizedResearchSource
  readonly role: EventSourceRole
  readonly provenance: AcquisitionSourceMetadata & { readonly contentHash?: string }
  readonly dateStatus: 'QUALIFIED' | 'UNKNOWN'
  readonly pointInTimeSafe: boolean
}

export interface EventResearchWorkflowInput {
  readonly workflowRunId: string
  readonly handle: KnowledgeBaseHandle
  readonly company: ResearchCompanyIdentity
  readonly anchor: EventAnchor
  readonly acquisitionPlugins: readonly ResearchAcquisitionPlugin[]
  /** Builds a per-run resolver so Event-owned candidate guards run before fetch. */
  readonly dataResolverFactory?: (context: EventResearchDataResolverContext) => DataResolver<CompanyResearchDataPayload>
  readonly signalStore?: EventResearchSignalStore
  readonly dailySignalStore?: EventResearchSignalStore
  readonly reportRoot: string
  readonly reasoningExecutor?: ReasoningExecutor
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly asOf?: string
  readonly eventWindowDays?: number
  readonly writeKnowledge?: boolean
  readonly useStructuredKnowledge?: boolean
}

export interface EventResearchCandidateReference {
  readonly candidateId: string
  readonly url?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface EventResearchDataResolverContext {
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly period?: DataRequirement['period']
  readonly signal?: AbortSignal
  readonly onCandidatesDiscovered: (event: {
    readonly provider: 'CNINFO' | 'GDELT'
    readonly candidates: readonly EventResearchCandidateReference[]
    readonly requirement: DataRequirement
  }) => readonly EventResearchCandidateReference[]
}

export interface EventResearchTelemetry {
  readonly companyCoverageResolved: boolean
  readonly anchorResolved: boolean
  readonly eventFingerprint: string
  readonly eventDate?: string
  readonly eventWindowDays: number
  readonly discoveredCount: number
  readonly selectedCount: number
  readonly normalizedCount: number
  readonly deduplicatedCount: number
  readonly futureFilteredCount: number
  readonly outsideWindowFilteredCount: number
  readonly unknownDateCount: number
  readonly sourceRoleCounts: Readonly<Record<EventSourceRole, number>>
  readonly providerTransportSucceeded: Readonly<Record<string, boolean>>
  readonly providerFetchSucceeded: Readonly<Record<string, boolean>>
  readonly providerSucceeded: Readonly<Record<string, boolean>>
  readonly providerFailed: Readonly<Record<string, boolean>>
  readonly providerUsableSourceCounts: Readonly<Record<string, number>>
  readonly assessment: EventResearchReasoningTelemetry
  readonly synthesis: EventResearchReasoningTelemetry
  readonly verification: EventVerificationResult
  readonly verifiedFactCount: number
  readonly contradictionCount: number
  readonly existingKnowledgeCount: number
  readonly proposalCandidateCount: number
  readonly acceptedModelProposalCount: number
  readonly proposalRejectionDiagnostics: readonly string[]
  readonly acceptedProposalCount: number
  readonly eventOccurrenceProposalCount: number
  readonly canonicalSourceCount: number
  readonly canonicalClaimCount: number
  readonly canonicalDeltaCount: number
  readonly directImpactCount: number
  readonly secondOrderImpactCount: number
  readonly assumptionImpactCount: number
  readonly thesisImpactCount: number
  readonly riskImpactCount: number
  readonly catalystImpactCount: number
  readonly affectedExistingClaimCount: number
  readonly modelDerivedInterpretiveSectionCount: number
  readonly eventOccurrenceProposalIncluded: boolean
  readonly reportPersistence: 'persisted'
  readonly diagnostics: readonly string[]
  readonly stageADiagnostics: readonly string[]
  readonly stageBDiagnostics: readonly string[]
  readonly stageBFirstAttemptShape?: import('../../skills/event-research/contracts.ts').EventReasoningShape
  readonly stageBRepairAttemptShape?: import('../../skills/event-research/contracts.ts').EventReasoningShape
}

export interface EventResearchReport {
  readonly reportId: string
  readonly reportType: 'event_research'
  readonly subjectRefs: readonly string[]
  readonly generatedAt: string
  readonly asOf: string
  readonly workflowRunId: string
  readonly knowledgeBaseRevision: number
  readonly sourceRefs: readonly string[]
  readonly claimRefs: readonly string[]
  readonly methodology: string
  readonly sections: readonly import('../../app/services/research-report.ts').ResearchReportSection[]
  readonly outputPath: string
  readonly anchor: EventAnchor
  readonly eventFingerprint: string
  readonly eventDate?: string
}

export interface EventResearchWorkflowResult {
  readonly workflowRunId: string
  readonly status: 'completed' | 'blocked' | 'cancelled' | 'failed'
  readonly knowledgeBaseId: string
  readonly knowledgeBaseRevision: number
  readonly report?: EventResearchReport
  readonly proposalIds: readonly string[]
  readonly committedIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly claimIds: readonly string[]
  readonly errors: readonly string[]
  readonly blockedReason?: 'COMPANY_COVERAGE_NOT_FOUND' | 'COMPANY_COVERAGE_AMBIGUOUS' | 'EVENT_SIGNAL_NOT_FOUND' | 'EVENT_SIGNAL_COMPANY_MISMATCH' | 'EVENT_ASOF_IN_FUTURE' | 'EVENT_DATE_INVALID' | 'EVENT_ANCHOR_INVALID'
  readonly diagnostics: readonly string[]
  readonly providerOutcomes: readonly EventResearchProviderOutcome[]
  readonly acquiredSources: readonly EventAcquiredSource[]
  readonly existingKnowledge: readonly Record<string, unknown>[]
  readonly evidence?: EventEvidenceAssessmentOutput
  readonly verification?: EventVerificationResult
  readonly sections: readonly EventResearchSection[]
  readonly assessments: readonly EventImpactAssessment[]
  readonly synthesis?: EventResearchSynthesisOutput
  readonly resolutionIntents: readonly ResolutionIntentSummary[]
  readonly telemetry: EventResearchTelemetry
  readonly qualityGate?: ResearchQualityGateResult
}

/**
 * Task 3 deliberately does not edit app/services/research-report.ts. Task 4
 * must add `event_research` to ResearchReport.reportType, the title renderer,
 * and validateResearchReport's accepted report types before this draft can be
 * persisted through writeResearchReport.
 */
export const EVENT_RESEARCH_REPORT_CONTRACT_NOTE = 'ResearchReport accepts event_research and is persisted through the existing report writer.'
