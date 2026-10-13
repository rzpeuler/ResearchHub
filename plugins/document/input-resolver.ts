import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DoclingDocumentParser } from './parsers/docling/parser.ts'
import { DocumentPluginError } from './errors.ts'
import { DocumentParserRegistry } from './parser-registry.ts'
import { PlainTextDocumentParser } from './parsers/text/parser.ts'
import type { AcquiredDocumentInput, DocumentInputRef, DocumentParser, ResolvedDocumentInput } from './contracts.ts'

export interface DocumentInputResolverOptions {
  readonly parserRegistry?: DocumentParserRegistry
  readonly parserId?: string
  readonly documentParser?: DocumentParser
}

export class DocumentInputResolver {
  private readonly parserRegistry: DocumentParserRegistry
  private readonly parserId: string | undefined

  constructor(options: DocumentInputResolverOptions = {}) {
    this.parserRegistry = options.parserRegistry ?? new DocumentParserRegistry(options.documentParser ? [options.documentParser] : [new DoclingDocumentParser(), new PlainTextDocumentParser()])
    this.parserId = options.parserId ?? process.env.RESEARCHHUB_DOCUMENT_PARSER
  }

  async resolve(input: DocumentInputRef, options?: { readonly signal?: AbortSignal }): Promise<ResolvedDocumentInput> {
    const source = await this.acquire(input)
    const document = await this.parse(source, options)
    return { rawBytes: source.bytes, originalFilename: source.filename || null, mediaType: source.mediaType, document }
  }

  async acquire(input: DocumentInputRef): Promise<AcquiredDocumentInput> {
    if (!input || typeof input !== 'object') throw new DocumentPluginError('document_input_invalid', 'document_input_invalid: document input must be an object')
    if (input.type === 'text') return { bytes: new TextEncoder().encode(input.text), filename: input.originalFilename ?? 'document.txt', mediaType: input.mediaType ?? 'text/plain', documentId: input.documentId }
    if (input.type === 'bytes') {
      if (!(input.bytes instanceof Uint8Array)) throw new DocumentPluginError('document_input_invalid', 'document_input_invalid: bytes must be a Uint8Array')
      const filename = input.originalFilename ?? 'document.bin'
      return { bytes: Uint8Array.from(input.bytes), filename, mediaType: input.mediaType ?? mediaTypeFor(filename), documentId: input.documentId }
    }
    if (input.type !== 'file') throw new DocumentPluginError('document_input_invalid', 'document_input_invalid: unsupported document input type')
    const reference = input.reference.trim()
    if (!reference) throw new DocumentPluginError('document_reference_missing', 'document_reference_missing: document reference is empty')
    try {
      const bytes = Uint8Array.from(await readFile(reference))
      const filename = basename(reference)
      return { bytes, filename, mediaType: mediaTypeFor(filename), documentId: input.documentId }
    } catch (error) { throw new DocumentPluginError('document_read_failed', `document_read_failed: ${error instanceof Error ? error.message : String(error)}`) }
  }

  async parse(source: AcquiredDocumentInput, options?: { readonly signal?: AbortSignal }): Promise<ResolvedDocumentInput['document']> {
    const signal = options?.signal
    if (signal?.aborted) throw new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: document parsing was cancelled')
    if (source.bytes.byteLength === 0) throw new DocumentPluginError('document_read_failed', 'document_read_failed: document is empty')
    const documentId = source.documentId ?? `document-${createHash('sha256').update(source.bytes).digest('hex').slice(0, 16)}`
    const parser = this.parserRegistry.select({ filename: source.filename, mediaType: source.mediaType }, this.parserId)
    try {
      const document = await parser.parse({ bytes: Uint8Array.from(source.bytes), filename: source.filename, mediaType: source.mediaType, documentId, ...(signal === undefined ? {} : { signal }) })
      if (!document.normalizedText.trim() && document.blocks.length > 0) throw new DocumentPluginError('document_text_extraction_insufficient', 'document_text_extraction_insufficient: parser returned no normalized text', parser.id)
      return document
    } catch (error) {
      if (error instanceof DocumentPluginError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new DocumentPluginError(message.startsWith('document_text_extraction_insufficient') ? 'document_text_extraction_insufficient' : 'document_parser_failed', message, parser.id)
    }
  }
}

function mediaTypeFor(filename: string): string {
  const extension = extname(filename).toLowerCase()
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.md') return 'text/markdown'
  if (extension === '.txt' || extension === '.text') return 'text/plain'
  return 'application/octet-stream'
}
