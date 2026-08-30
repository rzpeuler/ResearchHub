export type KnowledgeIngestionFailureStage = 'input_validation' | 'intake_target_resolution' | 'document_resolution' | 'raw_archive' | 'report_understanding' | 'theme_handling' | 'broad_context' | 'section_batching' | 'extraction' | 'consolidation' | 'reference_resolution' | 'precise_retrieval' | 'reconciliation' | 'schema_gap' | 'review_isolation' | 'change_set_planning' | 'validation' | 'writer' | 'final_result' | 'curation' | 'workflow' | 'ingestion_log'

export class KnowledgeIngestionWorkflowError extends Error {
  readonly code: string
  readonly stage?: KnowledgeIngestionFailureStage
  constructor(code: string, message: string, stage?: KnowledgeIngestionFailureStage) {
    super(message)
    this.name = 'KnowledgeIngestionWorkflowError'
    this.code = code
    this.stage = stage
  }
}
