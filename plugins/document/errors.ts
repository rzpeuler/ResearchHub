export type DocumentPluginErrorCode =
  | 'document_input_invalid'
  | 'document_reference_missing'
  | 'document_read_failed'
  | 'document_parser_unavailable'
  | 'document_parser_unsupported'
  | 'document_parser_environment_not_ready'
  | 'document_parser_cancelled'
  | 'document_parser_timeout'
  | 'document_parser_failed'
  | 'document_structure_invalid'
  | 'document_text_extraction_insufficient'

export class DocumentPluginError extends Error {
  constructor(public readonly code: DocumentPluginErrorCode, message: string, public readonly parserId?: string) {
    super(message)
    this.name = 'DocumentPluginError'
  }
}
