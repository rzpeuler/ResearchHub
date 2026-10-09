import type { EntityTypeV03, RelationTypeV03 } from '../../knowledge/schema/domain.ts'
import type { IndustryObservationPoint } from '../../data/industry-observations.ts'
import type { RawDocumentMetadataV04, RawDocumentRightsV04 } from '../../knowledge/production/raw-document-gateway-v04.ts'
import type { RawDocumentCandidateGroupV04, RawDocumentPreviewWorkflowResultV04 } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts'
import type { RawDocumentV04CandidateAcceptanceResult } from '../../workflows/raw-document-knowledge-ingestion/v04-candidate-acceptance.ts'
import type { RawDocumentV04IncompleteExtractionUnit } from '../../workflows/raw-document-knowledge-ingestion/v04-preview-store.ts'
import type { EarningsFinancialQualitySummary } from '../../skills/earnings-review/financial-quality/contracts.ts'
import type { EarningsExpectationAnalysis } from '../../workflows/earnings-review/expectations-contracts.ts'
import type { ResearchQualityGateStatus } from '../../workflows/research-quality-gate.ts'

export type ApplicationErrorCode = 'not_found' | 'invalid_input' | 'cancelled' | 'failed' | 'conflict' | 'executor_unavailable' | 'no_kb_mounted' | 'unauthorized_runtime_token'

export class ApplicationServiceError extends Error {
  readonly code: ApplicationErrorCode
  constructor(code: ApplicationErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'ApplicationServiceError'
    this.code = code
  }
}

export type ApplicationKnowledgeKind = 'ThemeGroup' | 'Entity' | 'Relation' | 'Claim' | 'Source' | 'Module' | 'Event' | 'Observation' | 'Thesis' | 'ReasoningEdge'
export interface ApplicationLimit { readonly limit: number; readonly total: number; readonly truncated: boolean }

export interface KnowledgeSearchInput {
  readonly query: string
  readonly entityType?: EntityTypeV03 | 'person' | 'institution' | 'security'
  readonly limit?: number
}
export interface ApplicationKnowledgeSearchResult {
  readonly ref: string
  readonly kind: ApplicationKnowledgeKind
  readonly semanticType?: string
  readonly displayName?: string
  readonly summary?: string
}
export interface KnowledgeSearchResult {
  readonly results: readonly ApplicationKnowledgeSearchResult[]
  readonly total: number
  readonly limit: number
  readonly truncated: boolean
}

export interface KnowledgeBaseStatusView {
  readonly knowledgeBaseId: string
  readonly rootRef: string
  readonly revision: number
  readonly status: string
  readonly schemaVersion: string
  readonly storageFormatVersion: string
  readonly counts: Readonly<Record<string, number>>
}
export interface KnowledgeObjectView {
  readonly ref: string
  readonly kind: ApplicationKnowledgeKind
  readonly object: unknown
  readonly relatedRelations?: readonly unknown[]
  readonly relatedClaims?: readonly unknown[]
  readonly supportingSources?: readonly unknown[]
  readonly relatedEntities?: readonly unknown[]
  readonly truncation?: Readonly<Record<string, ApplicationLimit>>
}

export type KnowledgeGraphEntityType = 'investment_theme' | 'industry' | 'company' | 'product' | 'technology'
export type KnowledgeGraphProfile = 'theme_context' | 'industry_context' | 'company_context' | 'product_context' | 'technology_context'
export interface KnowledgeGraphProjectionInput { readonly rootRef: string; readonly depth?: 1 | 2; readonly maxNodes?: number; readonly maxEdges?: number }
export interface KnowledgeGraphNode { readonly ref: string; readonly entityType: KnowledgeGraphEntityType; readonly label: string; readonly secondaryLabel?: string; readonly lifecycleStatus: string; readonly isRoot: boolean }
export interface KnowledgeGraphEdge { readonly ref: string; readonly relationType: RelationTypeV03; readonly sourceRef: string; readonly targetRef: string; readonly label: string }
export interface KnowledgeGraphProjection {
  readonly rootRef: string
  readonly profile: KnowledgeGraphProfile
  readonly depth: 1 | 2
  readonly nodes: readonly KnowledgeGraphNode[]
  readonly edges: readonly KnowledgeGraphEdge[]
  readonly nodeTotal: number
  readonly edgeTotal: number
  readonly nodeLimit: number
  readonly edgeLimit: number
  readonly truncated: boolean
}
export interface KnowledgeDirectoryItem { readonly ref: string; readonly name: string }
export interface KnowledgeDirectorySection { readonly items: readonly KnowledgeDirectoryItem[]; readonly total: number; readonly limit: number; readonly truncated: boolean }
export interface KnowledgeDirectoryThemeGroup { readonly ref: string; readonly name: string; readonly themes: readonly KnowledgeDirectoryItem[] }
export interface KnowledgeDirectoryProjection {
  readonly themeGroups: readonly KnowledgeDirectoryThemeGroup[]
  readonly industries: KnowledgeDirectorySection
  readonly companies: KnowledgeDirectorySection
  readonly products: KnowledgeDirectorySection
  readonly technologies: KnowledgeDirectorySection
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'completed_with_review' | 'blocked' | 'cancelled' | 'failed'
export type TerminalWorkflowStatus = Exclude<WorkflowStatus, 'pending' | 'running'>
export type WorkflowBundleStatus = 'pending' | 'available' | 'failed' | 'unavailable'
export interface WorkflowExecutionResultProjection {
  readonly runId: string
  /** Canonical ResearchDispatch registry ID, independent of a service's internal workflowType alias. */
  readonly workflowId: string
  readonly executionStatus: WorkflowStatus
  readonly terminalStatus?: TerminalWorkflowStatus
  readonly summary?: string
  readonly reportRef?: string
  readonly bundleRef?: string
  readonly reviewRef?: { readonly kind: 'review_case' | 'theme_framework_candidate' | 'daily_brief'; readonly id: string }
  readonly blockedReason?: string
  /** Safe diagnostic codes only. Raw errors, stack traces, credentials, and paths are excluded. */
  readonly diagnostics: readonly string[]
  readonly bundleStatus: WorkflowBundleStatus
}
export interface WorkflowRunView {
  readonly runId: string
  readonly workflowType: string
  readonly objective: string
  readonly status: WorkflowStatus
  readonly currentStage?: string
  readonly progressSummary?: string
  readonly startedAt: string
  readonly updatedAt: string
  readonly completedAt?: string
  readonly reviewCount?: number
  readonly errorSummary?: string
  readonly executionResult?: WorkflowExecutionResultProjection
}
export interface WorkflowCancelResult {
  readonly runId: string
  readonly status: WorkflowStatus
  readonly cancelled: boolean
  readonly reason?: 'cancelled' | 'not_running' | 'already_terminal'
}

export interface ReviewCaseListInput {
  readonly limit?: number
  readonly actionability?: 'knowledge_decision' | 'research_followup' | 'schema_design'
  readonly category?: string
  readonly producerRunId?: string
}
export interface ReviewCaseSummary {
  readonly reviewCaseId: string
  readonly producerRunId: string
  readonly producerType: string
  readonly createdAt: string
  readonly category: string
  readonly actionability: string
  readonly origin: string
  readonly rationale: string
  readonly proposalKind: string
  readonly semanticType: string
  readonly dependentProposalCount: number
  readonly suggestedNextAction?: string
  readonly status: string
  readonly decisionState?: import('../../knowledge/review/decision-store.ts').ReviewDecisionState
}
export interface ReviewCaseListResult {
  readonly cases: readonly ReviewCaseSummary[]
  readonly total: number
  readonly limit: number
  readonly truncated: boolean
}
export interface ReviewCaseDetail {
  readonly reviewCaseId: string
  readonly producerRunId: string
  readonly producerType: string
  readonly createdAt: string
  readonly classification: unknown
  readonly rootProposal: unknown
  readonly evidenceBindings: readonly unknown[]
  readonly existingKnowledgeProjections: readonly unknown[]
  readonly impact: unknown
  readonly advisory?: unknown
  readonly state: unknown
  readonly thesisScope?: import('../../knowledge/review/contracts.ts').ThesisReviewScope
  readonly decision?: ReviewDecisionDetail
  readonly totalDependentProposals: number
  readonly dependentProposalSamples: readonly unknown[]
  readonly dependentProposals: readonly unknown[]
  readonly dependentsTruncated: boolean
}

export interface ReviewDecisionEventView {
  readonly revision: number
  readonly type: import('../../knowledge/review/decision-store.ts').ReviewDecisionEventType
  readonly actor: 'local_user'
  readonly at: string
  readonly note?: string
  readonly writerRunId?: string
  readonly committedRevision?: number
}
export interface ReviewDecisionDetail {
  readonly state: import('../../knowledge/review/decision-store.ts').ReviewDecisionState
  readonly revision: number
  readonly actionable: boolean
  readonly events: readonly ReviewDecisionEventView[]
  readonly totalEvents: number
  readonly eventsTruncated: boolean
}

export interface IngestDocumentInput {
  readonly workflowRunId: string
  readonly text?: string
  readonly workspaceFile?: string
  readonly originalFilename?: string
  readonly mediaType?: string
  readonly instructions?: string
  readonly sourceMetadata?: { readonly title?: string | null; readonly institution?: string | null; readonly author?: string | null; readonly publishedAt?: string | null; readonly sourceUrl?: string | null }
}
export interface RawDocumentPreviewV04Input {
  readonly workflowRunId: string
  readonly text?: string
  readonly workspaceFile?: string
  readonly originalFilename?: string
  readonly mediaType?: string
  readonly instructions?: string
  readonly sourceMetadata: RawDocumentMetadataV04
  readonly rights: RawDocumentRightsV04
}
export interface ApplicationRawDocumentPreviewV04 {
  readonly runId: string
  readonly status: RawDocumentPreviewWorkflowResultV04['status'] | 'stale_revision'
  readonly knowledgeBaseId?: string
  readonly sourceRef?: string
  readonly rawRef?: string
  readonly documentId?: string
  readonly candidateGroups: readonly RawDocumentCandidateGroupV04[]
  readonly committable: boolean
  readonly errorSummary?: string
  readonly statusNote?: string
  readonly extractionCompleteness?: 'complete' | 'partial'
  readonly incompleteUnits?: readonly RawDocumentV04IncompleteExtractionUnit[]
}
export interface ApplicationRawDocumentPreviewAcceptanceInput {
  readonly previewWorkflowRunId: string
  readonly acceptedCandidateIds: readonly string[]
}
export type ApplicationRawDocumentPreviewAcceptanceResult = RawDocumentV04CandidateAcceptanceResult
export interface ApplicationProductionResult {
  readonly runId: string
  readonly status: WorkflowStatus
  readonly knowledgeBaseId?: string
  readonly rawRef?: string
  readonly documentId?: string
  readonly changeSetId?: string
  readonly baseRevision?: number
  readonly committedRevision?: number
  readonly reviewCount: number
  readonly reviewCaseIds: readonly string[]
  readonly summary: string
  readonly errorSummary?: string
}
export interface ResearchCompanyInput { readonly workflowRunId: string; readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationResearchResult { readonly runId: string; readonly status: WorkflowStatus; readonly knowledgeBaseId: string; readonly reportId?: string; readonly reportPath?: string; readonly committedIds: readonly string[]; readonly proposalCount: number; readonly summary: string; readonly errorSummary?: string }
export interface IndustryResearchInput { readonly workflowRunId: string; readonly name: string; readonly aliases?: readonly string[]; readonly canonicalRef?: string; readonly searchTerms?: readonly string[]; readonly asOf?: string; readonly asOfMode?: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'; readonly maxSources?: number; readonly maxEvidencePerModule?: number; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationIndustryResearchResult extends ApplicationResearchResult { readonly providerOutcomes: readonly unknown[]; readonly acquisitionDiagnostics: readonly string[]; readonly operatingObservations: readonly IndustryObservationPoint[]; readonly operatingObservationStatus: 'COMPLETED' | 'PARTIAL' | 'SCOPE_UNSUPPORTED' | 'UNAVAILABLE' | 'SOURCE_UNAVAILABLE' | 'TRANSPORT_UNAVAILABLE' | 'PARSER_UNAVAILABLE'; readonly operatingObservationDiagnostics: readonly string[]; readonly dataRequirementGaps: readonly string[]; readonly requirementCoverage: 'COMPLETE' | 'PARTIAL' }
export type EarningsReviewPeriod = 'Q1' | 'H1' | 'Q3' | 'FY'
export interface EarningsReviewInput { readonly workflowRunId: string; readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly fiscalYear: number; readonly period: EarningsReviewPeriod; readonly asOf?: string; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationEarningsReviewResult extends ApplicationResearchResult { readonly telemetry: unknown; readonly blockedReason?: string; readonly providerOutcomes: readonly unknown[]; readonly acquisitionDiagnostics: readonly unknown[]; readonly selectionDiagnostics: readonly string[]; readonly financialQuality?: EarningsFinancialQualitySummary; readonly expectationAnalysis?: EarningsExpectationAnalysis; readonly qualityGateStatus?: ResearchQualityGateStatus }
export type ValuationMethod = 'PE' | 'PB' | 'EV_EBITDA'
export interface ValuationInput { readonly workflowRunId: string; readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string; readonly methods?: readonly ValuationMethod[]; readonly targetFiscalYear?: number; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationValuationResult extends ApplicationResearchResult { readonly telemetry: unknown; readonly blockedReason?: string; readonly providerOutcome?: unknown; readonly automaticCompsResult?: unknown; readonly crosscheck?: unknown }
export type EventAnchor =
  | { readonly kind: 'daily_signal'; readonly signalId: string }
  | { readonly kind: 'article'; readonly url: string; readonly title?: string; readonly publishedAt?: string; readonly content?: string }
  | { readonly kind: 'url'; readonly url: string; readonly title?: string; readonly publishedAt?: string }
  | { readonly kind: 'user_event'; readonly title: string; readonly description: string; readonly eventDate?: string }
export interface EventResearchInput { readonly workflowRunId: string; readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly anchor: EventAnchor; readonly asOf?: string; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationEventResearchResult extends ApplicationResearchResult { readonly telemetry: unknown; readonly blockedReason?: string }
export interface ThesisRedTeamInput { readonly workflowRunId: string; readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly thesisRef: string; readonly lookbackDays?: number; readonly writeKnowledge?: boolean; readonly useStructuredKnowledge?: boolean; readonly sourceLibraryContext?: readonly import('./source-library.ts').SourceLibraryHit[] }
export interface ApplicationThesisRedTeamResult extends ApplicationResearchResult { readonly telemetry: unknown; readonly blockedReason?: string }
