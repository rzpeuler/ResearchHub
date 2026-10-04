export type RuntimeErrorCode = 'invalid_input' | 'not_found' | 'cancelled' | 'failed' | 'conflict' | 'no_kb_mounted' | 'unauthorized_runtime_token'

export interface RuntimeErrorBody { readonly code: RuntimeErrorCode | string; readonly error: string }

export class RuntimeClientError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'RuntimeClientError'
    this.code = code
    this.status = status
  }
}

export interface ConversationSummary { readonly conversationId: string; readonly name?: string; readonly updatedAt: string; readonly messageCount: number; readonly isActive: boolean }
export interface SessionState { readonly conversationId: string; readonly name?: string; readonly isStreaming: boolean; readonly isIdle: boolean; readonly pendingMessageCount: number; readonly thinkingLevel: string; readonly model?: { readonly provider: string; readonly modelId: string } }
export interface ConversationMessage { readonly role: 'user' | 'assistant' | 'tool'; readonly content: string; readonly timestamp?: string; readonly toolName?: string; readonly isError?: boolean }
export interface KnowledgeBaseStatus { readonly knowledgeBaseId: string; readonly rootRef: string; readonly revision: number; readonly status: string; readonly schemaVersion: string; readonly storageFormatVersion: string; readonly counts: Readonly<Record<string, number>> }
export interface RuntimeModelOption { readonly provider: string; readonly modelId: string; readonly name: string; readonly available: boolean; readonly unavailableReason?: string }
export interface RuntimeKnowledgeBaseOption { readonly knowledgeBaseId: string; readonly schemaVersion: string; readonly status: string; readonly revision: number }
export interface RuntimeSettings { readonly revision: number; readonly model: { readonly provider: string; readonly modelId: string }; readonly modelError?: string; readonly models: readonly RuntimeModelOption[]; readonly knowledgeBase?: KnowledgeBaseStatus; readonly knowledgeBaseError?: string; readonly knowledgeBases: readonly RuntimeKnowledgeBaseOption[] }
export interface KnowledgeSearchResult { readonly ref: string; readonly kind: string; readonly semanticType?: string; readonly displayName?: string; readonly summary?: string }
export interface KnowledgeSearchResponse { readonly results: readonly KnowledgeSearchResult[]; readonly total: number; readonly limit: number; readonly truncated: boolean }
export interface KnowledgeObjectResponse { readonly ref: string; readonly kind: string; readonly object: unknown; readonly relatedRelations?: readonly unknown[]; readonly relatedClaims?: readonly unknown[]; readonly supportingSources?: readonly unknown[]; readonly relatedEntities?: readonly unknown[]; readonly truncation?: Readonly<Record<string, { readonly limit: number; readonly total: number; readonly truncated: boolean }>> }
export type KnowledgeGraphEntityType = 'investment_theme' | 'industry' | 'company' | 'product' | 'technology'
export interface KnowledgeGraphNode { readonly ref: string; readonly entityType: KnowledgeGraphEntityType; readonly label: string; readonly secondaryLabel?: string; readonly lifecycleStatus: string; readonly isRoot: boolean }
export interface KnowledgeGraphEdge { readonly ref: string; readonly relationType: string; readonly sourceRef: string; readonly targetRef: string; readonly label: string }
export interface KnowledgeGraphProjection { readonly rootRef: string; readonly profile: string; readonly depth: 1 | 2; readonly nodes: readonly KnowledgeGraphNode[]; readonly edges: readonly KnowledgeGraphEdge[]; readonly nodeTotal: number; readonly edgeTotal: number; readonly nodeLimit: number; readonly edgeLimit: number; readonly truncated: boolean }
export interface KnowledgeDirectoryItem { readonly ref: string; readonly name: string }
export interface KnowledgeDirectorySection { readonly items: readonly KnowledgeDirectoryItem[]; readonly total: number; readonly limit: number; readonly truncated: boolean }
export interface KnowledgeDirectoryProjection { readonly themeGroups: readonly { readonly ref: string; readonly name: string; readonly themes: readonly KnowledgeDirectoryItem[] }[]; readonly industries: KnowledgeDirectorySection; readonly companies: KnowledgeDirectorySection; readonly products: KnowledgeDirectorySection; readonly technologies: KnowledgeDirectorySection }
export interface ThemeWorkspaceProjectionInput { readonly expectedRevision?: number; readonly asOf?: string; readonly maxNodes?: number; readonly maxEdges?: number; readonly maxItemsPerSection?: number; readonly maxCompaniesPerIndustry?: number; readonly maxResponseBytes?: number }
export interface ThemeWorkspaceResponseBounds { readonly maxBytes: number; readonly serializedBytes: number; readonly truncated: boolean }
export interface ThemeWorkspaceFact { readonly ref: string; readonly kind: 'claim' | 'observation' | 'event'; readonly semanticType: string; readonly title: string; readonly statement?: string; readonly value?: string | number | boolean | null; readonly unit?: string; readonly period?: string; readonly confidence?: number; readonly probability?: number }
export interface ThemeWorkspaceTimelineItem { readonly ref: string; readonly title: string; readonly date?: string; readonly dateBasis: string; readonly dateLabel: string }
export type ThemeWorkspaceCompetitionValue = { readonly status: 'available'; readonly displayValue: string; readonly asOf?: string; readonly fiscalYear?: number; readonly currency?: string; readonly unit?: string } | { readonly status: 'unavailable' | 'not_comparable'; readonly reason: string }
export interface ThemeWorkspaceCompetitionCell { readonly columnId: string; readonly value: ThemeWorkspaceCompetitionValue; readonly notComparable: boolean; readonly comparabilityNote?: string }
export interface ThemeWorkspaceCompetitionTable { readonly ref: string; readonly schemaId: string; readonly columns: readonly { readonly id: string; readonly label: string; readonly role: string }[]; readonly rows: readonly { readonly companyRef: string; readonly cells: readonly ThemeWorkspaceCompetitionCell[] }[]; readonly rowTotal: number; readonly truncated: boolean; readonly note?: string }
export interface ThemeWorkspaceContentProjection { readonly factsByType: Readonly<Record<string, readonly ThemeWorkspaceFact[]>>; readonly sectionCatalog: readonly { readonly id: string; readonly title: string }[]; readonly factsBySection: Readonly<Record<string, readonly ThemeWorkspaceFact[]>>; readonly unclassifiedFacts: readonly ThemeWorkspaceFact[]; readonly classification: { readonly status: 'classified' | 'partial' | 'llm_unavailable' | 'llm_failed' | 'invalid_output' | 'bounded_fallback'; readonly method: 'reasoning_executor' | 'deterministic_fallback' | 'not_needed'; readonly revision: number; readonly classifiedCount: number; readonly unclassifiedCount: number; readonly reason?: string; readonly truncated?: boolean }; readonly modules: readonly { readonly ref: string; readonly moduleType: string; readonly schemaId?: string; readonly targetRef: string }[]; readonly competition?: ThemeWorkspaceCompetitionTable; readonly coreViews: { readonly items: readonly ThemeWorkspaceFact[]; readonly defaultCount: 3; readonly total: number; readonly truncated: boolean }; readonly timeline: { readonly historicalEvents: readonly ThemeWorkspaceTimelineItem[]; readonly futureCatalysts: readonly ThemeWorkspaceTimelineItem[]; readonly eventsLimit: { readonly total: number; readonly limit: number; readonly truncated: boolean }; readonly catalystsLimit: { readonly total: number; readonly limit: number; readonly truncated: boolean } }; readonly limited: Readonly<Record<string, { readonly total: number; readonly limit: number; readonly truncated: boolean }>>; readonly omittedRestrictedCount: number }
export interface ThemeWorkspaceProjection { readonly status: 'available'; readonly knowledgeBaseId: string; readonly schemaVersion: '0.4'; readonly revision: number; readonly theme: { readonly ref: string; readonly name: string; readonly themeGroupRef: string; readonly definition?: string }; readonly graph: { readonly nodes: readonly { readonly ref: string; readonly name: string; readonly importance?: 'core' | 'material' | 'adjacent' }[]; readonly edges: readonly { readonly ref: string; readonly relationType: 'upstream_of' | 'depends_on'; readonly sourceRef: string; readonly targetRef: string }[]; readonly nodeTotal: number; readonly edgeTotal: number; readonly nodeLimit: number; readonly edgeLimit: number; readonly truncated: boolean }; readonly scope: { readonly includedIndustryCount: number; readonly includedRelationCount: number; readonly pendingCount: number; readonly excludedCount: number; readonly basedOnRevision: number }; readonly responseBounds: ThemeWorkspaceResponseBounds }
export interface ThemeWorkspaceIndustryProjection { readonly knowledgeBaseId: string; readonly revision: number; readonly themeRef: string; readonly industry: { readonly ref: string; readonly name: string; readonly description?: string; readonly importance?: 'core' | 'material' | 'adjacent' }; readonly sections: ThemeWorkspaceContentProjection; readonly companies: readonly { readonly ref: string; readonly name: string; readonly ticker?: string; readonly exchange?: string }[]; readonly companiesLimit: { readonly total: number; readonly limit: number; readonly truncated: boolean }; readonly responseBounds: ThemeWorkspaceResponseBounds }
export interface ThemeWorkspaceCompanyProjection { readonly knowledgeBaseId: string; readonly revision: number; readonly themeRef: string; readonly industryRef: string; readonly company: { readonly ref: string; readonly name: string; readonly ticker?: string; readonly exchange?: string }; readonly sections: ThemeWorkspaceContentProjection; readonly responseBounds: ThemeWorkspaceResponseBounds }
export type KnowledgeTopicKind = 'relation' | 'claim' | 'observation' | 'event' | 'thesis' | 'module' | 'source' | 'reasoning_edge'
export type KnowledgeTopicScope = 'direct' | 'connected'
export type KnowledgeTopicLifecycleFilter = 'active' | 'all'
export interface KnowledgeTopicFilters { readonly lifecycle?: KnowledgeTopicLifecycleFilter; readonly observationType?: 'metric' | 'estimate' | 'consensus'; readonly claimType?: string; readonly relationType?: string }
export interface KnowledgeTopicSummaryCount { readonly total: number; readonly totalExact: boolean; readonly truncated: boolean }
export interface KnowledgeTopicSummary { readonly knowledgeBaseId: string; readonly schemaVersion: '0.4'; readonly revision: number; readonly theme: { readonly ref: string; readonly name: string; readonly aliases: readonly string[]; readonly description?: string; readonly definition?: string; readonly inclusionCriteria?: readonly string[]; readonly exclusionCriteria?: readonly string[]; readonly themeGroupRef?: string; readonly lifecycleStatus: string }; readonly counts: Readonly<Record<KnowledgeTopicScope, Readonly<Record<KnowledgeTopicKind, KnowledgeTopicSummaryCount>>>>; readonly overview: Readonly<Record<KnowledgeTopicScope, { readonly latestDatedRecord?: { readonly ref: string; readonly kind: KnowledgeTopicKind; readonly dateField: string; readonly dateValue: string }; readonly nonSourceRecordsWithoutExplicitSourceRef: number; readonly totalExact: boolean; readonly truncated: boolean }>>; readonly connected: { readonly depth: 1 | 2; readonly totalExact: boolean; readonly truncated: boolean; readonly focusRefs: readonly string[]; readonly focusRefsTotal?: number; readonly focusRefsTruncated?: boolean } }
export interface KnowledgeTopicPathHop { readonly relationRef: string; readonly sourceRef: string; readonly targetRef: string }
export interface KnowledgeTopicAssociationPath { readonly entityRef: string; readonly hops: readonly KnowledgeTopicPathHop[] }
export interface KnowledgeTopicItem { readonly ref: string; readonly kind: KnowledgeTopicKind; readonly scope: KnowledgeTopicScope; readonly lifecycleStatus: string; readonly label: string; readonly summary?: string; readonly fields: Readonly<Record<string, string | number | boolean | null | readonly string[]>>; readonly date?: { readonly field: string; readonly value: string }; readonly associationPaths?: readonly KnowledgeTopicAssociationPath[] }
export interface KnowledgeTopicPageInput { readonly themeRef: string; readonly kind: KnowledgeTopicKind; readonly scope?: KnowledgeTopicScope; readonly depth?: 1 | 2; readonly limit?: number; readonly cursor?: string; readonly expectedRevision?: number; readonly filters?: KnowledgeTopicFilters }
export interface KnowledgeTopicItemPage { readonly knowledgeBaseId: string; readonly schemaVersion: '0.4'; readonly revision: number; readonly themeRef: string; readonly kind: KnowledgeTopicKind; readonly scope: KnowledgeTopicScope; readonly depth: 1 | 2; readonly filters: { readonly lifecycle: KnowledgeTopicLifecycleFilter; readonly observationType?: 'metric' | 'estimate' | 'consensus'; readonly claimType?: string; readonly relationType?: string }; readonly items: readonly KnowledgeTopicItem[]; readonly total: number; readonly totalExact: boolean; readonly limit: number; readonly nextCursor?: string; readonly truncated: boolean; readonly focusRefs: readonly string[]; readonly focusRefsTotal?: number; readonly focusRefsTruncated?: boolean; readonly responseBounded?: boolean }
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'completed_with_review' | 'blocked' | 'cancelled' | 'failed'
export interface WorkflowRun { readonly runId: string; readonly workflowType: string; readonly objective: string; readonly status: WorkflowStatus; readonly currentStage?: string; readonly progressSummary?: string; readonly startedAt: string; readonly updatedAt: string; readonly completedAt?: string; readonly reviewCount?: number; readonly errorSummary?: string }
export interface ReviewSummary { readonly reviewCaseId: string; readonly producerRunId: string; readonly producerType: string; readonly createdAt: string; readonly category: string; readonly actionability: string; readonly origin: string; readonly rationale: string; readonly proposalKind: string; readonly semanticType: string; readonly dependentProposalCount: number; readonly suggestedNextAction?: string; readonly status: string; readonly decisionState?: string }
export interface ReviewListResponse { readonly cases: readonly ReviewSummary[]; readonly total: number; readonly limit: number; readonly truncated: boolean }
export interface ThesisKillCriterionAssessment { readonly conditionId: string; readonly status: string; readonly targetPropositionRefs: readonly string[]; readonly evidenceRefs: readonly string[]; readonly rationale: string }
export interface ThesisKillCriterionBinding { readonly conditionId: string; readonly revision: number; readonly definitionHash: string; readonly evaluatedValueIdentity: string; readonly evidenceRef: string; readonly value: number; readonly metricRef: string; readonly unit: string; readonly period: string; readonly sourceRef: string; readonly rawRef: string; readonly locator: string; readonly publishedAt: string; readonly targetClaimRefs: readonly string[]; readonly numericValueVersionVerified: true; readonly asOf: string }
export interface ThesisReviewScope { readonly thesisRef: string; readonly rootClaimRef: string; readonly affectedClaimRefs: readonly string[]; readonly evidenceRefs: readonly string[]; readonly reviewedEvidence: readonly { readonly evidenceRef: string; readonly relation: string; readonly targetClaimRefs: readonly string[] }[]; readonly candidateTransition: string; readonly asOf: string; readonly proposedThesisStatus?: string; readonly killCriterionAssessments?: readonly ThesisKillCriterionAssessment[]; readonly killCriterionBindings?: readonly ThesisKillCriterionBinding[] }
export interface ReviewDecisionProjection { readonly state: string; readonly revision: number; readonly actionable: boolean; readonly events: readonly { readonly revision: number; readonly type: string; readonly actor: string; readonly at: string; readonly note?: string; readonly writerRunId?: string; readonly committedRevision?: number }[]; readonly totalEvents: number; readonly eventsTruncated: boolean }
export interface ReviewDetail { readonly reviewCaseId: string; readonly producerRunId: string; readonly producerType: string; readonly createdAt: string; readonly classification: unknown; readonly rootProposal: unknown; readonly evidenceBindings: readonly unknown[]; readonly existingKnowledgeProjections: readonly unknown[]; readonly impact: unknown; readonly thesisScope?: ThesisReviewScope; readonly decision?: ReviewDecisionProjection; readonly advisory?: unknown; readonly state: unknown; readonly totalDependentProposals: number; readonly dependentProposalSamples: readonly unknown[]; readonly dependentProposals: readonly unknown[]; readonly dependentsTruncated: boolean }
export interface ThesisQuerySummary { readonly thesisRef: string; readonly title: string; readonly statement: string; readonly status: string; readonly companySubject: { readonly companyRef: string; readonly name: string }; readonly lastReviewedAt: string | null; readonly propositionCount: number }
export interface ThesisQueryListResult { readonly theses: readonly ThesisQuerySummary[]; readonly total: number; readonly limit: number; readonly truncated: boolean; readonly revision: number }
export interface ThesisQueryProposition { readonly claimRef: string; readonly statement: string; readonly claimType: string; readonly sourceRefs: readonly string[]; readonly membershipEdgeRef: string }
export type ThesisCriterionOrigin = { readonly kind: 'human_rule' } | { readonly kind: 'source_derived'; readonly sourceRef: string; readonly rawRef: string; readonly locator: string; readonly publishedAt: string }
export interface ThesisQueryKillCriterion { readonly conditionId: string; readonly revision: number; readonly state: 'active' | 'superseded'; readonly type: string; readonly definitionVersion: number; readonly definition: Readonly<Record<string, unknown>>; readonly targetClaimRefs: readonly string[]; readonly effectiveAt: string; readonly definitionHash: string; readonly origin: ThesisCriterionOrigin; readonly authority: { readonly workflowRunId: string; readonly confirmedAt: string } }
export interface ThesisQueryDetail extends ThesisQuerySummary { readonly propositions: readonly ThesisQueryProposition[]; readonly propositionRefs: readonly string[]; readonly membershipEdgeRefs: readonly string[]; readonly killCriteria?: readonly ThesisQueryKillCriterion[]; readonly revision: number }
export type ThesisCriterionOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
export interface ThesisCriterionDefinition { readonly metricRef: string; readonly operator: ThesisCriterionOperator; readonly threshold: number; readonly unit: string; readonly period: string }
export interface ThesisCriterionPrepareInput { readonly thesisRef: string; readonly conditionId: string; readonly type?: 'numeric_threshold'; readonly definitionVersion?: 1; readonly definition: ThesisCriterionDefinition; readonly targetClaimRefs: readonly string[]; readonly origin: ThesisCriterionOrigin }
export interface ThesisCriterionPreview { readonly knowledgeBaseId: string; readonly expectedKnowledgeBaseRevision: number; readonly thesisRef: string; readonly conditionId: string; readonly revision: number; readonly type: 'numeric_threshold'; readonly definitionVersion: 1; readonly definition: ThesisCriterionDefinition; readonly targetClaimRefs: readonly string[]; readonly origin: ThesisCriterionOrigin; readonly definitionHash: string; readonly previewHash: string }
export interface ThesisCriterionConfirmInput { readonly preview: ThesisCriterionPreview; readonly previewHash: string; readonly expectedKnowledgeBaseRevision: number; readonly workflowRunId: string }
export interface ThesisCriterionConfirmResult { readonly status: 'confirmed' | 'replayed'; readonly replay: boolean; readonly thesisRef: string; readonly conditionId: string; readonly criterionRevision: number; readonly definitionHash: string; readonly knowledgeBaseId: string; readonly knowledgeBaseRevision: number; readonly committedRevision: number; readonly writerRunId: string }
export type ThesisDecision = 'ACCEPT' | 'REJECT' | 'DEFER'
export interface ThesisDecisionResult { readonly status: string; readonly reviewCaseId: string; readonly decisionState?: string; readonly replay?: boolean; readonly knowledgeBaseRevision?: number; readonly committedRevision?: number; readonly writerRunId?: string; readonly errors: readonly string[] }
export interface AttachmentRef { readonly attachmentId: string; readonly filename: string; readonly mediaType: string; readonly size: number; readonly sha256: string; readonly createdAt: string }
export interface RawDocumentCandidateGroupV04 { readonly candidateId: string; readonly kind: 'entity' | 'relation' | 'claim'; readonly candidate: Readonly<Record<string, unknown>>; readonly provenanceRefs: { readonly sourceRef: string; readonly rawRef: string; readonly evidenceBlockRefs: readonly string[] } }
export type RawDocumentPreviewStatusV04 = 'preview_ready' | 'preview_partial' | 'source_only' | 'blocked' | 'cancelled' | 'incompatible_schema' | 'stale_revision'
export interface RawDocumentIncompleteUnitV04 { readonly unitId: string; readonly proposedUnitId: string; readonly status: 'failed' | 'cancelled'; readonly errorSummary: string }
export interface RawDocumentPreviewV04 { readonly runId: string; readonly status: RawDocumentPreviewStatusV04; readonly knowledgeBaseId?: string; readonly sourceRef?: string; readonly rawRef?: string; readonly documentId?: string; readonly candidateGroups: readonly RawDocumentCandidateGroupV04[]; readonly committable: boolean; readonly errorSummary?: string; readonly statusNote?: string; readonly extractionCompleteness?: 'complete' | 'partial'; readonly incompleteUnits?: readonly RawDocumentIncompleteUnitV04[] }
export interface RawDocumentPreviewPollV04 { readonly runId: string; readonly workflow?: WorkflowRun; readonly preview: RawDocumentPreviewV04 | null; readonly committable: boolean }
export interface RawDocumentAcceptanceV04 { readonly status: string; readonly knowledgeBaseId: string; readonly knowledgeBaseRevision: number; readonly baseRevision: number; readonly previewWorkflowRunId: string; readonly extractionCompleteness?: 'complete' | 'partial'; readonly acceptedCandidateIds: readonly string[]; readonly createdIds: readonly string[]; readonly updatedIds: readonly string[]; readonly errors: readonly { readonly code: string; readonly message: string }[] }
export interface ClientEvent { readonly eventId: string; readonly conversationId: string; readonly timestamp: string; readonly type: string; readonly role?: 'user' | 'assistant'; readonly summary?: string; readonly status?: string; readonly toolCallId?: string; readonly name?: string; readonly isError?: boolean; readonly steeringCount?: number; readonly followUpCount?: number; readonly code?: string }
export interface BootstrapResponse { readonly runtime: { readonly origin: string; readonly runtimeToken: string }; readonly origin: string; readonly session: SessionState; readonly conversations: readonly ConversationSummary[]; readonly knowledgeBase?: KnowledgeBaseStatus; readonly openReviewCases?: number; readonly knowledgeError?: RuntimeErrorBody }
export interface DailyBriefSummary { readonly reportId: string; readonly briefType: 'morning' | 'evening'; readonly tradeDate: string; readonly generatedAt: string; readonly quality: { readonly topCount: number; readonly reportItemWithSourceRatio: number; readonly reportItemCount?: number; readonly claimCount?: number }; readonly sections: readonly { readonly title: string; readonly unavailable?: boolean }[] }
export interface DailyBriefReport extends DailyBriefSummary { readonly asOf: string; readonly timezone: string; readonly revision: number; readonly workflowRunId: string; readonly sections: readonly { readonly id: string; readonly title: string; readonly items: readonly { readonly itemId: string; readonly headline: string; readonly markdown: string; readonly sourceRefs: readonly string[]; readonly claimRefs?: readonly string[]; readonly signalRefs?: readonly string[]; readonly kind: string; readonly rank: number }[]; readonly unavailable?: boolean }[]; readonly consensusStatement: string; readonly committedKnowledgeRefs: readonly string[]; readonly reviewCaseCount: number; readonly calendarConfidence: string; readonly knowledgeBaseRevision?: number }
export type ResearchReportType = 'company_research' | 'earnings_review' | 'valuation' | 'event_research' | 'thesis_red_team' | 'industry_research' | 'thesis_lifecycle'
export interface ResearchReportSummary { readonly reportId: string; readonly reportType: ResearchReportType; readonly subjectRefs: readonly string[]; readonly generatedAt: string; readonly asOf: string; readonly workflowRunId: string; readonly knowledgeBaseRevision: number; readonly sourceCount: number; readonly claimCount: number; readonly sectionCount: number; readonly methodology: string }
export interface ResearchReport extends ResearchReportSummary { readonly sourceRefs: readonly string[]; readonly claimRefs: readonly string[]; readonly sections: readonly { readonly id: string; readonly title: string; readonly markdown: string; readonly sourceRefs?: readonly string[]; readonly claimRefs?: readonly string[]; readonly relationRefs?: readonly string[]; readonly signalRefs?: readonly string[]; readonly evidenceLinks?: readonly string[] }[] }
export interface ResearchStartResponse { readonly accepted: boolean; readonly runId: string; readonly workflow?: WorkflowRun }
export interface WorkflowDefinition { readonly id: string; readonly label: string; readonly intentDescription: string; readonly inputSchema: Readonly<Record<string, unknown>>; readonly requiredInputs: readonly string[]; readonly outputContract: string; readonly knowledgeEffects: readonly string[] }
export type ThemeFrameworkDecision = 'include' | 'exclude' | 'pending'
export type ThemeFrameworkReviewStatus = 'running' | 'awaiting_review' | 'rejected' | 'committed' | 'stale' | 'blocked' | 'failed'
export interface ThemeFrameworkReviewItem {
  readonly candidateId: string
  readonly kind: 'industry' | 'relation'
  readonly recommendation: ThemeFrameworkDecision
  readonly name?: string
  readonly description?: string
  readonly sourceIndustryRef?: string
  readonly targetIndustryRef?: string
  readonly relationType?: string
  readonly topologyRole?: 'main_chain' | 'cross_chain'
  readonly boundaryRationale: string
  readonly relevanceRationale: string
  readonly directionRationale?: string
  readonly evidenceRefs: readonly string[]
  readonly coverageGaps: readonly string[]
}
export interface ThemeFrameworkReviewCandidate {
  readonly knowledgeBaseId: string
  readonly basedOnRevision: number
  readonly refresh?: {
    readonly refreshedFromRunId: string
    readonly sourceBasedOnRevision: number
    readonly targetRevision: number
    readonly validationSummary: { readonly writerReceipts: number; readonly sourceIds: readonly string[]; readonly evidenceBindings: number }
    readonly refreshedAt: string
  }
  readonly theme: { readonly name: string; readonly definition?: string }
  readonly framework: {
    readonly proposedDefinition: { readonly statement: string; readonly status: 'supported' | 'provisional' }
    readonly inclusionPrinciples: readonly string[]
    readonly exclusionPrinciples: readonly string[]
    readonly industryCandidates: readonly ThemeFrameworkReviewItem[]
    readonly relationCandidates: readonly ThemeFrameworkReviewItem[]
    readonly coverageGaps: readonly { readonly gapId: string; readonly question: string; readonly reason: string; readonly affectedCandidateIds: readonly string[] }[]
  }
  readonly acquisitionStatus: string
  readonly diagnostics: readonly string[]
  readonly evidence: readonly { readonly evidenceId: string; readonly summary: string; readonly sourceRef: string }[]
}
export interface ThemeFrameworkReviewResponse {
  readonly status: ThemeFrameworkReviewStatus
  readonly workflowRunId: string
  readonly candidate?: ThemeFrameworkReviewCandidate
  readonly receipt?: { readonly themeRef: string; readonly committedRevision: number; readonly decisionCount: number }
}
export interface ThemeFrameworkReviewSummary { readonly runId: string; readonly themeName: string; readonly basedOnRevision: number; readonly status: 'awaiting_review' | 'stale' | 'committed' }
export interface ThemeFrameworkReviewListResponse { readonly items: readonly ThemeFrameworkReviewSummary[]; readonly total: number; readonly truncated: boolean }
export type ThemeScopeImpactDecision = 'include' | 'exclude' | 'pending' | 'dismiss'
export interface ThemeScopeImpactProposal {
  readonly proposalId: string
  readonly themeRef: string
  readonly candidate: { readonly kind: 'industry'; readonly name: string; readonly identityContext?: string; readonly canonicalRef?: string } | { readonly kind: 'relation'; readonly relationType: string; readonly sourceFingerprint: string; readonly targetFingerprint: string; readonly canonicalRef?: string }
  readonly candidateFingerprint: string
  readonly changeKind: string
  readonly priorDecision?: { readonly id: string; readonly decision: 'include' | 'exclude' | 'pending' }
  readonly rationale: string
  readonly evidenceRefs: readonly string[]
  readonly changedRefs: readonly string[]
  readonly basedOnRevision: number
  readonly status: 'pending' | 'accepted' | 'rejected'
  readonly decision?: 'include' | 'exclude' | 'pending' | 'dismiss'
}
export interface ThemeScopeImpactInboxRecord {
  readonly receiptKey: string
  readonly knowledgeBaseId: string
  readonly baseRevision: number
  readonly committedRevision: number
  readonly status: 'ready' | 'no_changes' | 'stale'
  readonly proposals: readonly ThemeScopeImpactProposal[]
  readonly diagnostics: readonly string[]
}
export interface ThemeScopeImpactInboxResponse { readonly items: readonly ThemeScopeImpactInboxRecord[]; readonly total: number; readonly truncated: boolean }
export interface ThemeFrameworkActionResponse {
  readonly status: string
  readonly workflowRunId: string
  readonly themeRef?: string
  readonly committedRevision?: number
  readonly decisionCount?: number
  readonly diagnostics?: readonly string[]
}
export interface ThemeFrameworkRefreshResult {
  readonly status: 'awaiting_review' | 'already_refreshed' | 'conflict' | 'blocked'
  readonly workflowRunId: string
  readonly refreshedFromRunId: string
  readonly basedOnRevision?: number
  readonly diagnostics?: readonly string[]
}
export interface ResearchRequest { readonly query: string; readonly mode?: { readonly type: 'free_research' } | { readonly type: 'workflow'; readonly workflowId: string }; readonly contextPolicy?: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }; readonly persistencePolicy?: { readonly writeKnowledge: boolean }; readonly attachments?: readonly string[] }
export interface ResearchDispatchDecision { readonly mode: 'workflow' | 'skill_plan' | 'free_research'; readonly workflow?: { readonly id: string; readonly confidence: number; readonly arguments: Readonly<Record<string, unknown>> }; readonly skills: readonly { readonly id: string; readonly purpose: string }[]; readonly entities: readonly { readonly type: string; readonly value: string; readonly confidence: number }[]; readonly missingRequiredInputs: readonly string[]; readonly contextPolicy: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }; readonly persistencePolicy: { readonly writeKnowledge: boolean }; readonly rationale: string }
export interface ResearchExecutionSummary { readonly mode: 'Free Research' | 'Explicit Workflow'; readonly workflowId?: string; readonly workflowLabel?: string; readonly selectedSkillIds: readonly string[]; readonly argumentsStatus: 'not_required' | 'extracted' | 'missing'; readonly argumentKeys: readonly string[]; readonly contextPolicy: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }; readonly persistencePolicy: { readonly writeKnowledge: boolean } }
export interface ResearchDispatchResponse { readonly accepted: boolean; readonly status: 'started' | 'missing_input' | 'free_research' | 'skill_plan'; readonly request: Required<Pick<ResearchRequest, 'query' | 'mode' | 'contextPolicy' | 'persistencePolicy'>> & ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary; readonly runId?: string; readonly workflow?: WorkflowRun }
export interface ResearchBundleSummary { readonly bundleId: string; readonly workflowRunId: string; readonly createdAt: string; readonly status: string; readonly report?: { readonly reportId: string; readonly reportPath?: string }; readonly proposals: readonly { readonly proposalId: string; readonly kind?: string }[]; readonly sourceLibraryHits?: readonly SourceLibraryHit[] }
export interface SourceLibraryHit { readonly sourceLibraryRef: string; readonly rawRef: string; readonly title: string; readonly excerpt: string; readonly contentHash: string; readonly chunkIndex: number; readonly provenance: { readonly rawRef: string } }
export type ResearchEventAnchor = { readonly kind: 'daily_signal'; readonly signalId: string } | { readonly kind: 'article' | 'url'; readonly url: string; readonly title?: string; readonly publishedAt?: string; readonly content?: string } | { readonly kind: 'user_event'; readonly title: string; readonly description: string; readonly eventDate?: string }

type FetchResponseLike = Pick<Response, 'ok' | 'status' | 'json'>
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<FetchResponseLike>
type HeaderBag = { set: (name: string, value: string) => void; has: (name: string) => boolean; forEach: (callback: (value: string, key: string) => void) => void }
type EventSourceLike = { onopen: ((event: Event) => void) | null; onerror: ((event: Event) => void) | null; close: () => void; addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => void; removeEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => void }
type EventSourceFactory = (url: string) => EventSourceLike

function createHeaders(input?: HeadersInit): HeaderBag {
  const constructor = globalThis.Headers
  if (typeof constructor === 'function') return new constructor(input)
  const values = new Map<string, string>()
  const add = (name: string, value: string): void => { values.set(name.toLowerCase(), value) }
  if (Array.isArray(input)) input.forEach(([name, value]) => add(name, value))
  else if (input !== undefined) Object.entries(input).forEach(([name, value]) => add(name, String(value)))
  return { set: (name, value) => add(name, value), has: (name) => values.has(name.toLowerCase()), forEach: (callback) => values.forEach((value, key) => callback(value, key)) }
}

function xhrFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<FetchResponseLike> {
  const constructor = globalThis.XMLHttpRequest
  if (typeof constructor !== 'function') return Promise.reject(new Error('Browser network APIs are unavailable'))
  return new Promise((resolve, reject) => {
    const request = new constructor()
    request.open(init.method ?? 'GET', String(input), true)
    createHeaders(init.headers).forEach((value, key) => request.setRequestHeader(key, value))
    request.onload = () => resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, json: async () => JSON.parse(request.responseText) })
    request.onerror = () => reject(new Error('ResearchHub Runtime network request failed'))
    request.ontimeout = () => reject(new Error('ResearchHub Runtime network request timed out'))
    request.send(init.body as XMLHttpRequestBodyInit | null | undefined)
  })
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<FetchResponseLike> {
  const fetchFunction = globalThis.fetch
  if (typeof fetchFunction === 'function') return fetchFunction(input, init)
  return xhrFetch(input, init)
}

const defaultEventSourceFactory: EventSourceFactory = (url) => {
  const constructor = globalThis.EventSource
  if (typeof constructor !== 'function') return { onopen: null, onerror: null, close: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined }
  return new constructor(url)
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function safeErrorMessage(value: unknown): string { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : 'ResearchHub runtime operation failed' }

function safeEvent(value: unknown): ClientEvent | undefined {
  if (!isRecord(value) || typeof value.eventId !== 'string' || typeof value.conversationId !== 'string' || typeof value.timestamp !== 'string' || typeof value.type !== 'string') return undefined
  const allowed = new Set(['agent.started', 'agent.completed', 'message.started', 'message.delta', 'message.completed', 'tool.started', 'tool.updated', 'tool.completed', 'queue.updated', 'session.changed', 'thinking.status', 'error'])
  if (!allowed.has(value.type)) return undefined
  const role = stringValue(value.role)
  const event: ClientEvent = {
    eventId: value.eventId,
    conversationId: value.conversationId,
    timestamp: value.timestamp,
    type: value.type,
    ...(role === 'user' || role === 'assistant' ? { role } : {}),
    ...(stringValue(value.summary) === undefined ? {} : { summary: stringValue(value.summary) }),
    ...(stringValue(value.status) === undefined ? {} : { status: stringValue(value.status) }),
    ...(stringValue(value.toolCallId) === undefined ? {} : { toolCallId: stringValue(value.toolCallId) }),
    ...(stringValue(value.name) === undefined ? {} : { name: stringValue(value.name) }),
    ...(typeof value.isError === 'boolean' ? { isError: value.isError } : {}),
    ...(Number.isSafeInteger(value.steeringCount) ? { steeringCount: value.steeringCount as number } : {}),
    ...(Number.isSafeInteger(value.followUpCount) ? { followUpCount: value.followUpCount as number } : {}),
    ...(stringValue(value.code) === undefined ? {} : { code: stringValue(value.code) }),
  }
  return event
}

export function parseClientEvent(data: string): ClientEvent | undefined { try { return safeEvent(JSON.parse(data)) } catch { return undefined } }

export class RuntimeClient {
  private readonly fetchImpl: FetchLike
  private runtimeToken?: string

  constructor(fetchImpl: FetchLike = defaultFetch) { this.fetchImpl = fetchImpl }

  private async request<T>(path: string, init: RequestInit = {}, mutation = false, acceptedStatuses: readonly number[] = []): Promise<T> {
    const headers = createHeaders(init.headers)
    headers.set('Accept', 'application/json')
    if (mutation) {
      if (this.runtimeToken === undefined) throw new RuntimeClientError('unauthorized_runtime_token', 'Runtime authorization is not ready', 401)
      headers.set('X-ResearchHub-Runtime-Token', this.runtimeToken)
    }
    const isFormData = typeof globalThis.FormData === 'function' && init.body instanceof globalThis.FormData
    if (init.body !== undefined && !headers.has('Content-Type') && !isFormData) headers.set('Content-Type', 'application/json')
    const response = await this.fetchImpl(path, { ...init, headers: headers as unknown as HeadersInit })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      const error = isRecord(body) ? body as unknown as RuntimeErrorBody : undefined
      const message = response.status === 401 ? 'ResearchHub Runtime authorization expired. Reload the page.' : safeErrorMessage(error?.error)
      throw new RuntimeClientError(error?.code ?? 'failed', message, response.status)
    }
    return body as T
  }

  async bootstrap(): Promise<BootstrapResponse> { const value = await this.request<BootstrapResponse>('/api/bootstrap'); this.runtimeToken = value.runtime.runtimeToken; return value }
  async getSettings(): Promise<RuntimeSettings> { return this.request('/api/settings') }
  async setModel(provider: string, modelId: string): Promise<RuntimeSettings> { return this.mutate('/api/settings/model', { provider, modelId }) }
  async setKnowledgeBase(knowledgeBaseId?: string): Promise<RuntimeSettings> { return this.mutate('/api/settings/knowledge-base', knowledgeBaseId === undefined ? {} : { knowledgeBaseId }) }
  clearToken(): void { this.runtimeToken = undefined }
  async listConversations(): Promise<readonly ConversationSummary[]> { return (await this.request<{ conversations: readonly ConversationSummary[] }>('/api/conversations')).conversations }
  async currentSession(): Promise<SessionState> { return this.request<SessionState>('/api/conversations/current') }
  async messages(): Promise<{ readonly conversationId: string; readonly messages: readonly ConversationMessage[] }> { return this.request('/api/conversations/messages') }
  async newConversation(name?: string): Promise<SessionState> { return this.mutate<SessionState>('/api/conversations/new', { ...(name ? { name } : {}) }) }
  async switchConversation(conversationId: string): Promise<SessionState> { return this.mutate<SessionState>('/api/conversations/switch', { conversationId }) }
  async command(operation: 'prompt' | 'steer' | 'follow_up', text: string, options: { readonly researchBundleId?: string; readonly researchPolicy?: { readonly contextPolicy: { readonly structuredKnowledge: boolean; readonly sourceLibrary: boolean }; readonly persistencePolicy: { readonly writeKnowledge: boolean } } } = {}): Promise<{ readonly accepted: boolean; readonly conversationId: string; readonly run: { readonly runId: string; readonly operation: string } }> { return this.mutate(operation === 'follow_up' ? '/api/conversations/follow_up' : `/api/conversations/${operation}`, { text, ...(operation === 'prompt' && options.researchBundleId === undefined ? {} : { researchBundleId: options.researchBundleId }), ...(operation === 'prompt' && options.researchPolicy === undefined ? {} : { researchPolicy: options.researchPolicy }) }) }
  async abort(): Promise<{ readonly accepted: boolean; readonly aborted: boolean }> { return this.mutate('/api/conversations/abort', {}) }
  async searchKnowledge(query: string, entityType?: string): Promise<KnowledgeSearchResponse> { const params = new URLSearchParams({ query }); if (entityType) params.set('entityType', entityType); return this.request(`/api/knowledge/search?${params.toString()}`) }
  async getKnowledgeObject(ref: string): Promise<KnowledgeObjectResponse> { return this.request(`/api/knowledge/object?${new URLSearchParams({ ref }).toString()}`) }
  async getKnowledgeDirectory(): Promise<KnowledgeDirectoryProjection> { return this.request('/api/knowledge/directory') }
  async getKnowledgeGraph(input: { readonly rootRef: string; readonly depth?: 1 | 2; readonly maxNodes?: number; readonly maxEdges?: number }): Promise<KnowledgeGraphProjection> { const params = new URLSearchParams({ rootRef: input.rootRef }); if (input.depth !== undefined) params.set('depth', String(input.depth)); if (input.maxNodes !== undefined) params.set('maxNodes', String(input.maxNodes)); if (input.maxEdges !== undefined) params.set('maxEdges', String(input.maxEdges)); return this.request(`/api/knowledge/graph?${params.toString()}`) }
  async getThemeWorkspaceOverview(themeRef: string, input: Omit<ThemeWorkspaceProjectionInput, 'themeRef'> = {}): Promise<ThemeWorkspaceProjection> {
    if (!isSafeTopicThemeRef(themeRef)) throw new RuntimeClientError('invalid_input', 'A canonical InvestmentTheme ref is required', 400)
    const params = new URLSearchParams()
    if (input.expectedRevision !== undefined) params.set('expectedRevision', String(input.expectedRevision))
    if (input.asOf !== undefined) params.set('asOf', input.asOf)
    if (input.maxNodes !== undefined) params.set('maxNodes', String(input.maxNodes))
    if (input.maxEdges !== undefined) params.set('maxEdges', String(input.maxEdges))
    if (input.maxResponseBytes !== undefined) params.set('maxResponseBytes', String(input.maxResponseBytes))
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return this.request(`/api/knowledge/themes/${encodeURIComponent(themeRef)}/overview${query}`)
  }
  async getThemeWorkspaceIndustry(themeRef: string, industryRef: string, input: Omit<ThemeWorkspaceProjectionInput, 'themeRef'> = {}): Promise<ThemeWorkspaceIndustryProjection> {
    if (!isSafeTopicThemeRef(themeRef) || !isSafeTopicThemeRef(industryRef)) throw new RuntimeClientError('invalid_input', 'Canonical Theme and Industry refs are required', 400)
    const params = new URLSearchParams()
    if (input.expectedRevision !== undefined) params.set('expectedRevision', String(input.expectedRevision))
    if (input.asOf !== undefined) params.set('asOf', input.asOf)
    if (input.maxItemsPerSection !== undefined) params.set('maxItemsPerSection', String(input.maxItemsPerSection))
    if (input.maxCompaniesPerIndustry !== undefined) params.set('maxCompaniesPerIndustry', String(input.maxCompaniesPerIndustry))
    if (input.maxResponseBytes !== undefined) params.set('maxResponseBytes', String(input.maxResponseBytes))
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return this.request(`/api/knowledge/themes/${encodeURIComponent(themeRef)}/industries/${encodeURIComponent(industryRef)}${query}`)
  }
  async getThemeWorkspaceCompany(themeRef: string, industryRef: string, companyRef: string, input: Omit<ThemeWorkspaceProjectionInput, 'themeRef'> = {}): Promise<ThemeWorkspaceCompanyProjection> {
    if (!isSafeTopicThemeRef(themeRef) || !isSafeTopicThemeRef(industryRef) || !isSafeTopicThemeRef(companyRef)) throw new RuntimeClientError('invalid_input', 'Canonical Theme, Industry, and Company refs are required', 400)
    const params = new URLSearchParams()
    if (input.expectedRevision !== undefined) params.set('expectedRevision', String(input.expectedRevision))
    if (input.asOf !== undefined) params.set('asOf', input.asOf)
    if (input.maxItemsPerSection !== undefined) params.set('maxItemsPerSection', String(input.maxItemsPerSection))
    if (input.maxResponseBytes !== undefined) params.set('maxResponseBytes', String(input.maxResponseBytes))
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return this.request(`/api/knowledge/themes/${encodeURIComponent(themeRef)}/industries/${encodeURIComponent(industryRef)}/companies/${encodeURIComponent(companyRef)}${query}`)
  }
  async getTopicSummary(themeRef: string, depth: 1 | 2 = 1): Promise<KnowledgeTopicSummary> { if (!isSafeTopicThemeRef(themeRef)) throw new RuntimeClientError('invalid_input', 'A canonical InvestmentTheme ref is required', 400); return this.request(`/api/knowledge/topics/${encodeURIComponent(themeRef)}/summary?depth=${depth}`) }
  async listTopicItems(input: KnowledgeTopicPageInput): Promise<KnowledgeTopicItemPage> {
    if (!isSafeTopicThemeRef(input.themeRef)) throw new RuntimeClientError('invalid_input', 'A canonical InvestmentTheme ref is required', 400)
    const params = new URLSearchParams({ kind: input.kind, scope: input.scope ?? 'direct', depth: String(input.depth ?? 1) })
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    if (input.cursor !== undefined) params.set('cursor', input.cursor)
    if (input.expectedRevision !== undefined) params.set('expectedRevision', String(input.expectedRevision))
    if (input.filters?.lifecycle !== undefined) params.set('lifecycle', input.filters.lifecycle)
    if (input.filters?.observationType !== undefined) params.set('observationType', input.filters.observationType)
    if (input.filters?.claimType !== undefined) params.set('claimType', input.filters.claimType)
    if (input.filters?.relationType !== undefined) params.set('relationType', input.filters.relationType)
    return this.request(`/api/knowledge/topics/${encodeURIComponent(input.themeRef)}/items?${params.toString()}`)
  }
  async listReviews(): Promise<ReviewListResponse> { return this.request('/api/reviews') }
  async getReview(reviewCaseId: string): Promise<ReviewDetail> { return this.request(`/api/reviews/${encodeURIComponent(reviewCaseId)}`) }
  async listTheses(limit = 20): Promise<ThesisQueryListResult> { return this.request(`/api/knowledge/theses?limit=${encodeURIComponent(String(limit))}`) }
  async getThesis(thesisRef: string): Promise<ThesisQueryDetail> { return this.request(`/api/knowledge/theses/${encodeURIComponent(thesisRef)}`) }
  async prepareThesisCriterion(input: ThesisCriterionPrepareInput): Promise<ThesisCriterionPreview> { return this.mutate('/api/production/thesis-lifecycle/criteria/prepare', input) }
  async confirmThesisCriterion(input: ThesisCriterionConfirmInput): Promise<ThesisCriterionConfirmResult> { return this.mutate('/api/production/thesis-lifecycle/criteria/confirm', input) }
  async startThesisLifecycleCreate(input: { readonly workflowRunId?: string; readonly companyRef: string; readonly thesisTitle: string; readonly narrative: string; readonly evidenceRefs: readonly string[]; readonly asOf: string }): Promise<ResearchStartResponse> { return this.mutate('/api/production/thesis-lifecycle/create', input) }
  async startThesisLifecycleRefresh(input: { readonly thesisRef: string; readonly asOf: string; readonly evidenceRefs?: readonly string[] }): Promise<ResearchStartResponse> { return this.mutate('/api/production/thesis-lifecycle/refresh', input) }
  async getThesisReview(reviewCaseId: string): Promise<ReviewDetail> { return this.request(`/api/review-cases/${encodeURIComponent(reviewCaseId)}`) }
  async decideThesisReview(reviewCaseId: string, decision: ThesisDecision, note?: string): Promise<ThesisDecisionResult> { return this.mutate(`/api/review-cases/${encodeURIComponent(reviewCaseId)}/decision`, { decision, ...(note === undefined ? {} : { note }) }) }
  async workflow(runId: string): Promise<WorkflowRun> { return this.request(`/api/workflows/${encodeURIComponent(runId)}`) }
  async cancelWorkflow(runId: string): Promise<unknown> { return this.mutate('/api/workflows/cancel', { runId }) }
  async uploadAttachment(file: File): Promise<AttachmentRef> { const form = new FormData(); form.append('file', file, file.name); const value = await this.request<{ attachment: AttachmentRef }>('/api/attachments', { method: 'POST', body: form }, true); return value.attachment }
  async startProduction(attachmentId: string): Promise<{ readonly accepted: boolean; readonly runId: string; readonly workflow?: WorkflowRun }> { return this.mutate('/api/production/ingest', { attachmentId }) }
  async startRawDocumentPreviewV04(input: { readonly attachmentId: string; readonly sourceMetadata: Readonly<Record<string, unknown>>; readonly rights: Readonly<Record<string, unknown>> }): Promise<{ readonly accepted: boolean; readonly runId: string; readonly committable: false; readonly workflow?: WorkflowRun }> { return this.mutate('/api/production/raw-document-preview-v04', input) }
  async getRawDocumentPreviewV04(runId: string): Promise<RawDocumentPreviewPollV04> { return this.request(`/api/production/raw-document-preview-v04/${encodeURIComponent(runId)}`) }
  async acceptRawDocumentPreviewV04(previewWorkflowRunId: string, acceptedCandidateIds: readonly string[]): Promise<RawDocumentAcceptanceV04> {
    const value = await this.request<unknown>('/api/production/raw-document-preview-v04/accept', { method: 'POST', body: JSON.stringify({ previewWorkflowRunId, acceptedCandidateIds }) }, true, [409, 422])
    if (isRecord(value) && typeof value.status === 'string') return value as unknown as RawDocumentAcceptanceV04
    if (isRecord(value)) throw new RuntimeClientError(typeof value.code === 'string' ? value.code : 'failed', safeErrorMessage(value.error), 422)
    throw new RuntimeClientError('failed', 'Candidate acceptance returned an invalid response', 422)
  }
  async listDailyBriefs(limit = 10): Promise<readonly DailyBriefSummary[]> { return (await this.request<{ briefs: readonly DailyBriefSummary[] }>(`/api/daily-briefs?limit=${limit}`)).briefs }
  async getDailyBrief(reportId: string): Promise<DailyBriefReport> { return this.request(`/api/daily-briefs/${encodeURIComponent(reportId)}`) }
  async listResearchReports(limit = 20): Promise<readonly ResearchReportSummary[]> { return (await this.request<{ reports: readonly ResearchReportSummary[] }>(`/api/research-reports?limit=${limit}`)).reports }
  async getResearchReport(reportId: string): Promise<ResearchReport> { return this.request(`/api/research-reports/${encodeURIComponent(reportId)}`) }
  async listWorkflowDefinitions(): Promise<readonly WorkflowDefinition[]> { return (await this.request<{ workflows: readonly WorkflowDefinition[] }>('/api/research/workflows')).workflows }
  async dispatchResearch(input: ResearchRequest): Promise<ResearchDispatchResponse> { return this.mutate('/api/research/dispatch', input) }
  async getThemeFrameworkRun(runId: string): Promise<ThemeFrameworkReviewResponse> { return this.request(`/api/theme-framework/runs/${encodeURIComponent(runId)}`, {}, true) }
  async listThemeFrameworkReviews(limit = 50): Promise<ThemeFrameworkReviewListResponse> { return this.request(`/api/theme-framework/reviews?limit=${encodeURIComponent(String(limit))}`, {}, true) }
  async refreshThemeFrameworkRun(runId: string): Promise<ThemeFrameworkRefreshResult> { return this.request(`/api/theme-framework/runs/${encodeURIComponent(runId)}/refresh`, { method: 'POST', body: '{}' }, true, [409, 422]) }
  async acceptThemeFrameworkRun(runId: string, decisions: Readonly<Record<string, ThemeFrameworkDecision>>, decisionRationales?: Readonly<Record<string, string>>): Promise<ThemeFrameworkActionResponse> {
    return this.mutate(`/api/theme-framework/runs/${encodeURIComponent(runId)}/accept`, { decisions, ...(decisionRationales ? { decisionRationales } : {}) })
  }
  async rejectThemeFrameworkRun(runId: string): Promise<ThemeFrameworkActionResponse> { return this.mutate(`/api/theme-framework/runs/${encodeURIComponent(runId)}/reject`, {}) }
  async listThemeScopeImpactInbox(limit = 50): Promise<ThemeScopeImpactInboxResponse> { return this.request(`/api/theme-scope-impact?limit=${encodeURIComponent(String(limit))}`, {}, true) }
  async getThemeScopeImpactRecord(receiptKey: string): Promise<ThemeScopeImpactInboxRecord> { return this.request(`/api/theme-scope-impact/records/${encodeURIComponent(receiptKey)}`, {}, true) }
  async decideThemeScopeImpactBatch(input: { readonly receiptKey: string; readonly workflowRunId: string; readonly decisions: readonly { readonly proposalId: string; readonly decision: Exclude<ThemeScopeImpactDecision, 'dismiss'>; readonly rationale?: string }[] }): Promise<ThemeScopeImpactInboxRecord> {
    return this.mutate(`/api/theme-scope-impact/records/${encodeURIComponent(input.receiptKey)}/decisions`, { workflowRunId: input.workflowRunId, decisions: input.decisions })
  }
  async dismissThemeScopeImpact(input: { readonly receiptKey: string; readonly proposalId: string; readonly workflowRunId: string }): Promise<ThemeScopeImpactProposal> {
    return this.mutate(`/api/theme-scope-impact/records/${encodeURIComponent(input.receiptKey)}/proposals/${encodeURIComponent(input.proposalId)}/dismiss`, { workflowRunId: input.workflowRunId })
  }
  async listResearchBundles(limit = 20): Promise<readonly ResearchBundleSummary[]> { return (await this.request<{ bundles: readonly ResearchBundleSummary[] }>(`/api/research/bundles?limit=${limit}`)).bundles }
  async getResearchBundle(bundleId: string): Promise<ResearchBundleSummary & { readonly structuredResult: unknown; readonly sourceLibraryHits: readonly SourceLibraryHit[] }> { return this.request(`/api/research/bundles/${encodeURIComponent(bundleId)}`) }
  async searchSourceLibrary(query: string, sourceLibrary = true): Promise<{ readonly enabled: boolean; readonly hits: readonly SourceLibraryHit[] }> { return this.mutate('/api/research/source-library/search', { query, contextPolicy: { sourceLibrary } }) }
  async startResearchCompany(input: { readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string }): Promise<ResearchStartResponse> { return this.mutate('/api/production/research-company', input) }
  async startResearchIndustry(input: { readonly name: string; readonly aliases?: readonly string[]; readonly canonicalRef?: string; readonly searchTerms?: readonly string[]; readonly asOf?: string; readonly maxSources?: number; readonly maxEvidencePerModule?: number }): Promise<ResearchStartResponse> { return this.mutate('/api/production/research-industry', input) }
  async startEarningsReview(input: { readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string; readonly fiscalYear: number; readonly period: 'Q1' | 'H1' | 'Q3' | 'FY' }): Promise<ResearchStartResponse> { return this.mutate('/api/production/review-earnings', input) }
  async startValuation(input: { readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string; readonly methods?: readonly ('PE' | 'PB' | 'EV_EBITDA')[]; readonly targetFiscalYear?: number }): Promise<ResearchStartResponse> { return this.mutate('/api/production/analyze-valuation', input) }
  async startEventResearch(input: { readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly asOf?: string; readonly anchor: ResearchEventAnchor }): Promise<ResearchStartResponse> { return this.mutate('/api/production/research-event', input) }
  async startThesisRedTeam(input: { readonly symbol: string; readonly name?: string; readonly exchange?: string; readonly thesisRef: string; readonly lookbackDays?: number }): Promise<ResearchStartResponse> { return this.mutate('/api/production/red-team-thesis', input) }
  openEvents(onEvent: (event: ClientEvent) => void, onReconnect: () => void, eventSourceFactory: EventSourceFactory = defaultEventSourceFactory): () => void {
    const source = eventSourceFactory('/api/events')
    const eventTypes = ['agent.started', 'agent.completed', 'message.started', 'message.delta', 'message.completed', 'tool.started', 'tool.updated', 'tool.completed', 'queue.updated', 'session.changed', 'thinking.status', 'error']
    const listener = (event: MessageEvent<string>) => { const parsed = parseClientEvent(event.data); if (parsed) onEvent(parsed) }
    source.onopen = onReconnect
    eventTypes.forEach((type) => source.addEventListener(type, listener))
    return () => { source.close(); eventTypes.forEach((type) => source.removeEventListener(type, listener)); source.onopen = null; source.onerror = null }
  }
  private mutate<T>(path: string, value: unknown): Promise<T> { return this.request<T>(path, { method: 'POST', body: JSON.stringify(value) }, true) }
}

function isSafeTopicThemeRef(value: string): boolean { return /^entity:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/.test(value) }
