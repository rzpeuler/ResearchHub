import type { KnowledgeBaseHandle, KnowledgeIndex } from '../../shared/knowledge-base/index.ts'
import type { KnowledgeChangeSet, KnowledgeWriteResult } from '../../schemas/knowledge/index.ts'
import type { KnowledgeAccessSkill } from '../../skills/knowledge-access/index.ts'
import type { KnowledgeCurationSkill } from '../../skills/knowledge-curation/index.ts'
import type { KnowledgeCandidate, KnowledgeMappingResult, KnowledgeScopeContext, NormalizedResearchDocument, SourceAssessment, ContentRelevanceDecision, KnowledgeAdmissionDecision, ConflictDecision, SchemaGapProposal, ResearchDocumentChunk } from '../../skills/knowledge-curation/index.ts'
import type { KnowledgeValidationSkill, ValidationReport } from '../../skills/knowledge-validation/index.ts'
import type { ChangeSetValidationResult } from '../../skills/knowledge-validation/types.ts'

export type ResearchReportInputRef =
  | { type: 'text'; text: string; originalFilename?: string | null; mediaType?: string }
  | { type: 'file'; reference: string }
  | { type: 'document_reference'; reference: string }

export interface ResearchReportKnowledgeIngestionInput {
  workflowRunId: string
  knowledgeBaseId: string
  report: {
    inputRef: ResearchReportInputRef
    suppliedMetadata: {
      title: string | null
      publisher: string | null
      institution: string | null
      author: string | null
      publishedAt: string | null
      sourceUrl: string | null
    }
  }
  options: { mode: 'commit' | 'dry_run'; reprocess: boolean }
}

export interface ResolvedResearchReportInput {
  rawBytes: Uint8Array
  originalFilename: string | null
  mediaType: string
  normalizedText: string
  chunks: ResearchDocumentChunk[]
}

export interface ResearchReportInputResolver {
  resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput>
}

export interface KnowledgeBaseTarget {
  handle: KnowledgeBaseHandle
  index: KnowledgeIndex
}

export interface KnowledgeBaseTargetResolver {
  resolve(knowledgeBaseId: string): Promise<KnowledgeBaseTarget>
}

export interface IngestionAuditContext {
  [key: string]: unknown
  workflowVersion: string
  ingestionIdentity: string
  rawArchive: { rawRefs: string[]; created: string[]; reused: string[] }
  sourceSummary: Record<string, unknown>
  filterSummary: { total: number; relevant: number; contextual: number; irrelevant: number }
  candidateSummary: Record<string, number>
  admissionSummary: Record<string, number>
  duplicateSummary: { duplicates: number }
  validationRejects: number
  userReview: Array<Record<string, unknown>>
  schemaGaps: Array<Record<string, unknown>>
  workflowStatus: string
}

export interface ResearchReportKnowledgeIngestionResult {
  workflowRunId: string
  knowledgeBaseId: string
  mode: 'commit' | 'dry_run'
  status: 'completed' | 'completed_with_review' | 'blocked'
  baseRevision: number
  finalRevision: number
  raw: { rawRef: string; persisted: boolean; created: boolean; reused: boolean }
  source: { sourceId: string | null; assessment: Record<string, unknown> | null }
  filtering: { total: number; relevant: number; contextual: number; irrelevant: number }
  candidates: { extracted: number; admitted: number; rejected: number; mapped: number; partiallyMapped: number; unmapped: number; duplicates: number; validationRejected: number }
  changes: { sourceCreated: number; sourceMerged: number; knowledgeCreated: number; knowledgeUpdated: number; knowledgeSuperseded: number; knowledgeSourceMerged: number }
  plannedChanges: { sourceCreate: string[]; sourceMerge: string[]; knowledgeCreate: string[]; knowledgeUpdate: string[]; knowledgeSupersede: string[]; knowledgeSourceMerge: string[] }
  userReview: Array<Record<string, unknown>>
  schemaGaps: SchemaGapProposal[]
  validation: ValidationReport | ChangeSetValidationResult['report'] | null
  ingestionLogRef?: string
  failureStage?: string
  errors: Array<{ code: string; message: string }>
}

export interface ResearchReportKnowledgeIngestionWorkflowOptions {
  targetResolver: KnowledgeBaseTargetResolver
  inputResolver?: ResearchReportInputResolver
  curation: KnowledgeCurationSkill
  validation?: KnowledgeValidationSkill
  writer?: { write(handle: KnowledgeBaseHandle, receipt: import('../../schemas/knowledge/index.ts').ValidatedKnowledgeChangeSet): Promise<KnowledgeWriteResult> }
  accessFactory?: (target: KnowledgeBaseTarget) => KnowledgeAccessSkill
  clock?: () => string
}

export interface IngestionTrace {
  document: NormalizedResearchDocument
  context: KnowledgeScopeContext
  sourceAssessment: SourceAssessment
  relevance: ContentRelevanceDecision[]
  candidates: KnowledgeCandidate[]
  admissions: KnowledgeAdmissionDecision[]
  mappings: KnowledgeMappingResult[]
  conflicts: ConflictDecision[]
  schemaGaps: SchemaGapProposal[]
  plans: ResolvedCandidatePlan[]
}

export interface ResolvedCandidatePlan {
  candidate: KnowledgeCandidate
  mapping: KnowledgeMappingResult
  resolvedObject: Record<string, unknown> | null
  resolvedRefs: string[]
  conflict?: ConflictDecision
  existingKnowledge: Array<{ knowledgeId: string; kind: 'entity' | 'relation' | 'intelligence' | 'module'; type: string; object: Record<string, unknown>; semanticHash: string }>
  resolutionStatus: 'eligible' | 'rejected' | 'unmapped' | 'user_review' | 'planning_rejected' | 'validation_rejected'
  reason?: string
}

export type { KnowledgeChangeSet, KnowledgeCandidate, KnowledgeMappingResult, KnowledgeScopeContext, NormalizedResearchDocument, SourceAssessment, ContentRelevanceDecision, KnowledgeAdmissionDecision, ConflictDecision, SchemaGapProposal }
