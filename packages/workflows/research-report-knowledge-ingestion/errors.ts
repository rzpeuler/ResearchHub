export type KnowledgeIngestionFailureStage = 'input_validation' | 'intake_target_resolution' | 'document_resolution' | 'raw_archive' | 'curation' | 'reference_resolution' | 'existing_knowledge_retrieval' | 'conflict_resolution' | 'change_set_planning' | 'validation' | 'writer' | 'ingestion_log'

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
