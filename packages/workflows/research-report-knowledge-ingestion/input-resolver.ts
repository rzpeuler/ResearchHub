import { KnowledgeIngestionWorkflowError } from './errors.ts'
import type { ResearchReportInputRef, ResearchReportInputResolver, ResolvedResearchReportInput } from './types.ts'

export type ExternalResearchDocumentResolver = (reference: string, inputRef: ResearchReportInputRef) => Promise<{ bytes: Uint8Array; originalFilename?: string | null; mediaType?: string }>

export class DefaultResearchReportInputResolver implements ResearchReportInputResolver {
  constructor(private readonly external?: ExternalResearchDocumentResolver) {}

  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> {
    let bytes: Uint8Array
    let originalFilename: string | null = null
    let mediaType = 'text/plain'
    if (inputRef.type === 'text') {
      if (typeof inputRef.text !== 'string' || inputRef.text.trim() === '') throw new KnowledgeIngestionWorkflowError('document_resolution_failed', 'Text input must be non-empty', 'document_resolution')
      bytes = new TextEncoder().encode(inputRef.text)
      originalFilename = inputRef.originalFilename ?? null
      mediaType = inputRef.mediaType ?? 'text/plain'
    } else {
      if (!this.external) throw new KnowledgeIngestionWorkflowError('document_resolution_failed', `No resolver was provided for ${inputRef.type}`, 'document_resolution')
      let resolved
      try { resolved = await this.external(inputRef.reference, inputRef) } catch (error) { throw new KnowledgeIngestionWorkflowError('document_resolution_failed', error instanceof Error ? error.message : String(error), 'document_resolution') }
      if (!(resolved.bytes instanceof Uint8Array) || resolved.bytes.byteLength === 0) throw new KnowledgeIngestionWorkflowError('document_resolution_failed', 'External document resolver returned no bytes', 'document_resolution')
      bytes = resolved.bytes
      originalFilename = resolved.originalFilename ?? null
      mediaType = resolved.mediaType ?? 'application/octet-stream'
    }
    const normalizedText = new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
    if (!normalizedText) throw new KnowledgeIngestionWorkflowError('document_resolution_failed', 'Document contains no decodable text', 'document_resolution')
    const paragraphs = normalizedText.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
    const chunks = (paragraphs.length > 0 ? paragraphs : [normalizedText]).map((text, index) => ({ chunkId: `chunk-${String(index + 1).padStart(4, '0')}`, text, section: null, locator: `paragraph:${index + 1}` }))
    return { bytes, originalFilename, mediaType, normalizedText, chunks }
  }
}
