import type { CurationSchemaContext } from "./schema-context-types.ts";
import type {
  ClaimTypeV03,
  EntityTypeV03,
  KnowledgeClaimV03,
  KnowledgeEntityV03,
  KnowledgeRelationV03,
  KnowledgeSourceV03,
  RelationTypeV03,
  SourceReliabilityV03,
  SourceTypeV03,
} from "../../schemas/knowledge/v03/domain.ts";

export type ActiveCurationOperation =
  | "understandReport"
  | "extractKnowledge"
  | "reconcileKnowledge"
  | "analyzeSchemaGaps";
export type CurationOperation = ActiveCurationOperation;
export type JsonRecord = Record<string, unknown>;

export interface ResearchDocumentMetadata {
  title: string | null;
  publisher: string | null;
  institution: string | null;
  author: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
}

export interface ResearchDocumentChunk {
  chunkId: string;
  text: string;
  page?: string | number | null;
  section?: string | null;
  locator?: string | null;
}

export interface ResearchDocumentSection {
  sectionId: string;
  title: string | null;
  chunkIds: string[];
}

export interface NormalizedResearchDocument {
  rawRef: string;
  suppliedMetadata: ResearchDocumentMetadata;
  normalizedText: string;
  chunks: ResearchDocumentChunk[];
  sections?: ResearchDocumentSection[];
}

export interface KnowledgeContext {
  knowledgeBaseId: string;
  schemaVersion: "0.3";
  existingRefs: string[];
  themeGroups: Array<Pick<JsonRecord, "id" | "name" | "aliases">>;
  themes: Array<Pick<JsonRecord, "id" | "name" | "aliases" | "themeGroupRef">>;
  entities: KnowledgeEntityV03[];
  relations: KnowledgeRelationV03[];
  claims?: KnowledgeClaimV03[];
  sources?: KnowledgeSourceV03[];
}

export interface CurationScope {
  workflowRunId: string;
  knowledgeBaseId: string;
  document: NormalizedResearchDocument;
}

export interface SourceAssessment {
  sourceType: SourceTypeV03;
  publisher: string | null;
  institution: string | null;
  author: string | null;
  publishedAt: string | null;
  primaryOrSecondary: "primary" | "secondary" | "unknown";
  sourceReliability: SourceReliabilityV03;
  sourceIdentityConfidence: number;
  reasoning: string[];
}

export interface ThemeHypothesis {
  mention: string;
  disposition:
    | "resolved_existing"
    | "resolved_multiple"
    | "provisional_unresolved"
    | "proposed_new"
    | "ambiguous";
  existingThemeRefs: string[];
  reason: string;
  evidenceChunkRefs: string[];
}

export interface MajorEntityMention {
  mention: string;
  entityType: EntityTypeV03 | null;
  suggestedExistingRef: string | null;
  evidenceChunkRefs: string[];
  reason: string;
}

export interface ReportUnderstanding {
  sourceAssessment: SourceAssessment;
  researchScope: string[];
  majorTopics: string[];
  majorEntityMentions: MajorEntityMention[];
  themeHypotheses: ThemeHypothesis[];
  newThemeProposal?: { name: string; definition: string; reason: string };
  uncertainty: string[];
}

export interface UnderstandReportInput extends CurationScope {
  themeContext: KnowledgeContext;
}

export interface SemanticMention {
  text: string;
  entityType?: EntityTypeV03 | null;
  existingRef?: string | null;
}

export interface EntityCandidate {
  candidateId: string;
  entityType: EntityTypeV03;
  name: string;
  aliases: string[];
  description: string | null;
  suggestedExistingRef: string | null;
  semanticFields: JsonRecord;
  evidenceChunkRefs: string[];
  reason: string;
}

export interface RelationCandidate {
  candidateId: string;
  relationType: RelationTypeV03;
  sourceMention: SemanticMention;
  targetMention: SemanticMention;
  attributes: JsonRecord;
  contextMentions: SemanticMention[];
  evidenceChunkRefs: string[];
  reason: string;
}

export interface ClaimCandidate {
  candidateId: string;
  claimType: ClaimTypeV03;
  statement: string;
  subjectMentions: SemanticMention[];
  temporal?: JsonRecord;
  structuredValue?: JsonRecord;
  semanticConfidence: number;
  evidenceChunkRefs: string[];
  reason: string;
}

export interface ExtractionBatch {
  batchId: string;
  sections: ResearchDocumentSection[];
  chunks: ResearchDocumentChunk[];
}

export interface ExtractKnowledgeInput extends CurationScope {
  batch: ExtractionBatch;
  reportUnderstanding: ReportUnderstanding;
  knowledgeContext: KnowledgeContext;
}

export type CandidateValidationCode =
  | "invalid_model_output"
  | "invalid_reference"
  | "invalid_semantics"
  | "invalid_confidence"
  | "ungrounded_candidate";
export type CurationValidationFeedbackCode =
  CandidateValidationCode | "candidate_set_exhausted";

export type CandidateKind = "entity" | "relation" | "claim";

export interface CandidateValidationRejection {
  candidateKind: CandidateKind;
  originalOrdinal: number;
  code: CandidateValidationCode;
  message: string;
  relationType?: RelationTypeV03;
}

export interface CandidateValidationCounts {
  entity: number;
  relation: number;
  claim: number;
}

export interface CandidateValidationSummary {
  accepted: CandidateValidationCounts;
  rejected: CandidateValidationCounts;
  rejectionCountsByCode: Partial<Record<CandidateValidationCode, number>>;
  rejections: CandidateValidationRejection[];
}

export interface ValidatedExtractKnowledgeResult extends ExtractKnowledgeOutput {
  validationRejections: CandidateValidationRejection[];
  validationSummary: CandidateValidationSummary;
}

export interface CurationValidationFeedback {
  attempt: 2;
  code: CurationValidationFeedbackCode;
  message: string;
}

export interface ExtractKnowledgeInvocationOptions {
  validationFeedback?: CurationValidationFeedback;
}

export interface ExtractKnowledgeOutput {
  entities: EntityCandidate[];
  relations: RelationCandidate[];
  claims: ClaimCandidate[];
}

export type ReconciliationAction =
  | "create"
  | "duplicate"
  | "merge_source"
  | "update_state"
  | "supersede"
  | "keep_both"
  | "reject"
  | "user_review";
export type ReconciliationClassification =
  | "duplicate"
  | "temporal_update"
  | "correction"
  | "fact_conflict"
  | "forecast_divergence"
  | "viewpoint_divergence"
  | "relation_state_change"
  | "relation_conflict"
  | "complementary";

export interface ReconciliationCandidate {
  candidateId: string;
  kind: "entity" | "relation" | "claim";
  semantic: JsonRecord;
  existingRefs: string[];
}

export interface ReconciliationGroup {
  groupId: string;
  candidateIds: string[];
  candidates: ReconciliationCandidate[];
  existingKnowledge: JsonRecord[];
}

export interface ReconciliationDecision {
  candidateId: string;
  decision: ReconciliationAction;
  classification: ReconciliationClassification;
  existingRefs: string[];
  reason: string;
  requiresUserReview: boolean;
}

export interface ReconcileKnowledgeInput extends CurationScope {
  groups: ReconciliationGroup[];
  sourceAssessment: SourceAssessment;
}

export interface ReconcileKnowledgeOutput {
  decisions: ReconciliationDecision[];
}

export type SchemaGapType =
  "vocabulary" | "schema" | "validation" | "access" | "projection";
export interface SchemaGapProposal {
  candidateRefs: string[];
  gapType: SchemaGapType;
  observedInformation: { description: string; examples: string[] };
  currentLimitation: { description: string };
  suggestedDirection: { description: string };
  affectedKnowledgeTypes: string[];
  affectedIndustries: string[];
  generality: "local" | "cross_industry" | "universal";
  frequency: "first_seen" | "repeated";
  recommendedAction: string;
}

export interface SchemaGapInput extends CurationScope {
  candidates: Array<JsonRecord & { candidateId: string }>;
  knowledgeContext: KnowledgeContext;
}

export interface AnalyzeSchemaGapsOutput {
  gaps: SchemaGapProposal[];
}

export type CurationResult =
  | ReportUnderstanding
  | ExtractKnowledgeOutput
  | ReconcileKnowledgeOutput
  | AnalyzeSchemaGapsOutput;

export type { CurationSchemaContext };
