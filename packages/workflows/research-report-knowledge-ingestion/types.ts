import type { KnowledgeCurationSkill, AnalyzeSchemaGapsOutput, ClaimCandidate, EntityCandidate, ExtractKnowledgeOutput, KnowledgeContext, NormalizedResearchDocument, ReconcileKnowledgeOutput, ReconciliationGroup, ReportUnderstanding, RelationCandidate, SchemaGapProposal, CurationValidationFeedbackCode } from '../../skills/knowledge-curation/index.ts'
import type { KnowledgeBaseHandle } from '../../shared/knowledge-base/index.ts'
import type { KnowledgeIndexV03 } from '../../shared/knowledge-base/knowledge-index-v03.ts'
import type { KnowledgeSourceV03 } from '../../schemas/knowledge/v03/domain.ts'
import type { KnowledgeChangeSetV03, ValidatedKnowledgeChangeSetV03 } from '../../schemas/knowledge/v03/mutation.ts'
import type { KnowledgeWriteResult } from '../../schemas/knowledge/mutation.ts'
import type { ValidationReport, ChangeSetValidationResultV03 } from '../../skills/knowledge-validation/types.ts'

export type ResearchReportInputRef =
  | { type: 'text'; text: string; originalFilename?: string | null; mediaType?: string }
  | { type: 'file'; reference: string }
  | { type: 'document_reference'; reference: string }

export interface ResearchReportKnowledgeIngestionInput {
  workflowRunId: string
  knowledgeBaseId: string
  report: { inputRef: ResearchReportInputRef; suppliedMetadata: { title: string | null; publisher: string | null; institution: string | null; author: string | null; publishedAt: string | null; sourceUrl: string | null } }
  options: { mode: 'commit' | 'dry_run'; reprocess: boolean }
}

export interface ResolvedResearchReportInput { rawBytes: Uint8Array; originalFilename: string | null; mediaType: string; normalizedText: string; chunks: Array<{ chunkId: string; text: string; page?: string | number | null; section?: string | null; locator?: string | null }> }
export interface ResearchReportInputResolver { resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> }
export interface KnowledgeBaseTarget { handle: KnowledgeBaseHandle; index: KnowledgeIndexV03 }
export interface KnowledgeBaseTargetResolver { resolve(knowledgeBaseId: string): Promise<KnowledgeBaseTarget> }

export interface SourceProposal { sourceId: string; source: KnowledgeSourceV03; resolution: 'source_create' | 'source_merge' | 'review' }
export interface ThemeHandling { dispositions: Record<'resolved_existing' | 'resolved_multiple' | 'provisional_unresolved' | 'proposed_new' | 'ambiguous', number>; reviewItems: Array<{ category: string; mention: string; reason: string }> }
export interface SectionBatchSummary { sectionCount: number; batchCount: number; chunkCount: number; chunkIds: string[]; batches: Array<{ batchId: string; sectionIds: string[]; chunkIds: string[]; characterCount: number }> }
export interface ExtractionSummary { entities: number; relations: number; claims: number; batchesAttempted: number; batchesSucceeded: number; batchesFailed: number }
export interface ConsolidationSummary { before: number; after: number; duplicatesMerged: number }
export interface ResolutionSummary { existing_ref: number; new_object_key: number; ambiguous: number; invalid: number }
export interface ReconciliationSummary { groups: number; candidates: number; decisions: Record<string, number>; classifications: Record<string, number> }
export interface ModelCallValidationFailure { attempt: 1 | 2; code: CurationValidationFeedbackCode; message: string }
export interface ModelCallRecord { operation: string; groupId?: string; attempted: boolean; succeeded: boolean; retryCount: 0 | 1; validationFailures?: ModelCallValidationFailure[] }
export interface ReviewItem { candidateId?: string; category: string; reason: string; dependencyIds: string[] }

export interface ResearchReportKnowledgeIngestionResult {
  workflowRunId: string
  ingestionIdentity: string
  knowledgeBaseId: string
  mode: 'commit' | 'dry_run'
  status: 'completed' | 'completed_with_review' | 'blocked'
  baseRevision: number
  finalRevision: number
  raw: { rawRef: string; persisted: boolean; created: boolean; reused: boolean }
  source: SourceProposal | null
  reportUnderstanding: ReportUnderstanding | null
  themeHandling: ThemeHandling
  batches: SectionBatchSummary
  extraction: ExtractionSummary
  consolidation: ConsolidationSummary
  referenceResolution: ResolutionSummary
  reconciliation: ReconciliationSummary
  schemaGaps: SchemaGapProposal[]
  reviewItems: ReviewItem[]
  plannedChanges: { sourceCreate: string[]; sourceMerge: string[]; knowledgeCreate: string[]; knowledgeUpdate: string[]; knowledgeSupersede: string[]; knowledgeSourceMerge: string[] }
  committedChanges: { sourceCreated: number; sourceMerged: number; knowledgeCreated: number; knowledgeUpdated: number; knowledgeSuperseded: number; knowledgeSourceMerged: number }
  validation: ValidationReport | ChangeSetValidationResultV03['report'] | null
  modelCalls: ModelCallRecord[]
  continuationRef?: string
  failureStage?: string
  errors: Array<{ code: string; message: string }>
}

export interface ResearchReportKnowledgeIngestionWorkflowOptions {
  targetResolver: KnowledgeBaseTargetResolver
  inputResolver?: ResearchReportInputResolver
  curation: KnowledgeCurationSkill
  validation?: { validateChangeSet(handle: KnowledgeBaseHandle, changeSet: KnowledgeChangeSetV03, options?: { mode?: 'commit' | 'dry_run'; virtualRawRefs?: string[] }): Promise<{ report: ChangeSetValidationResultV03['report']; validatedChangeSet?: ValidatedKnowledgeChangeSetV03 }> }
  writer?: { write(handle: KnowledgeBaseHandle, receipt: ValidatedKnowledgeChangeSetV03): Promise<KnowledgeWriteResult> }
  clock?: () => string
}

export interface IngestionTrace {
  document: NormalizedResearchDocument
  knowledgeContext: KnowledgeContext
  reportUnderstanding: ReportUnderstanding
  themeHandling: ThemeHandling
  batches: SectionBatchSummary
  extraction: ExtractKnowledgeOutput
  candidates: Array<EntityCandidate | RelationCandidate | ClaimCandidate>
  consolidation: ConsolidationSummary
  resolution: Array<{ candidateId: string; kind: 'entity' | 'relation' | 'claim'; outcome: 'existing_ref' | 'new_object_key' | 'ambiguous' | 'invalid'; refs: string[]; objectKey?: string; candidate: EntityCandidate | RelationCandidate | ClaimCandidate }>
  preciseGroups: ReconciliationGroup[]
  reconciliation: ReconcileKnowledgeOutput
  schemaGaps: AnalyzeSchemaGapsOutput
  reviewItems: ReviewItem[]
}

export type { KnowledgeChangeSetV03, KnowledgeContext, NormalizedResearchDocument, ReportUnderstanding, SchemaGapProposal }
