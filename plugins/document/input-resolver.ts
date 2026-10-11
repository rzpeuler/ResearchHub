import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DoclingDocumentParser } from './parsers/docling/parser.ts'
import { DocumentPluginError } from './errors.ts'
import { DocumentParserRegistry } from './parser-registry.ts'
import { PlainTextDocumentParser } from './parsers/text/parser.ts'
import { PypdfTextDocumentParser } from './parsers/pypdf-text-parser.ts'
import type { AcquiredDocumentInput, DocumentInputRef, DocumentParser, ResolvedDocumentInput } from './contracts.ts'

export interface DocumentInputResolverOptions {
  readonly parserRegistry?: DocumentParserRegistry
  readonly parserId?: string
  readonly documentParser?: DocumentParser
  /** Enables bounded PDF text extraction before Docling for official disclosure PDFs. */
  readonly pdfTextFirst?: boolean
  /** Parser injection keeps the bounded PDF fallback path directly testable. */
  readonly pdfTextParser?: DocumentParser
  readonly pdfFallbackParsers?: readonly DocumentParser[]
}

const PDF_PARSE_CONCURRENCY = 2
let activePdfParses = 0
const pdfParseWaiters: { readonly signal?: AbortSignal; readonly resolve: (release: () => void) => void; readonly reject: (error: unknown) => void; onAbort?: () => void }[] = []

async function acquirePdfParseSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: document parsing was cancelled')
  if (activePdfParses < PDF_PARSE_CONCURRENCY) { activePdfParses += 1; return releasePdfParseSlot }
  return new Promise((resolveSlot, reject) => {
    const waiter = { signal, resolve: resolveSlot, reject, onAbort: undefined as (() => void) | undefined }
    waiter.onAbort = () => { const index = pdfParseWaiters.indexOf(waiter); if (index >= 0) pdfParseWaiters.splice(index, 1); reject(new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: document parsing was cancelled while waiting for a parser slot')) }
    signal?.addEventListener('abort', waiter.onAbort, { once: true })
    pdfParseWaiters.push(waiter)
  })
}

function releasePdfParseSlot(): void {
  const waiter = pdfParseWaiters.shift()
  if (!waiter) { activePdfParses = Math.max(0, activePdfParses - 1); return }
  if (waiter.signal?.aborted) { waiter.signal.removeEventListener('abort', waiter.onAbort!); waiter.reject(new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: document parsing was cancelled while waiting for a parser slot')); releasePdfParseSlot(); return }
  waiter.signal?.removeEventListener('abort', waiter.onAbort!)
  waiter.resolve(releasePdfParseSlot)
}

export class DocumentInputResolver {
  private readonly parserRegistry: DocumentParserRegistry
  private readonly parserId: string | undefined
  private readonly parserCandidates: readonly DocumentParser[] | undefined

  constructor(options: DocumentInputResolverOptions = {}) {
    const defaultParsers = options.pdfTextFirst && !options.documentParser && !options.parserRegistry
      ? [options.pdfTextParser ?? new PypdfTextDocumentParser(), ...(options.pdfFallbackParsers ?? [new DoclingDocumentParser()]), new PlainTextDocumentParser()]
      : options.documentParser ? [options.documentParser] : [new DoclingDocumentParser(), new PlainTextDocumentParser()]
    this.parserRegistry = options.parserRegistry ?? new DocumentParserRegistry(defaultParsers)
    this.parserCandidates = options.pdfTextFirst && !options.documentParser && !options.parserRegistry ? defaultParsers : undefined
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
    const isPdf = source.mediaType === 'application/pdf' || source.filename.toLowerCase().endsWith('.pdf')
    const release = this.parserCandidates && isPdf ? await acquirePdfParseSlot(options?.signal) : undefined
    try { return await this.parseWithCandidates(source, options) } finally { release?.() }
  }

  private async parseWithCandidates(source: AcquiredDocumentInput, options?: { readonly signal?: AbortSignal }): Promise<ResolvedDocumentInput['document']> {
    const signal = options?.signal
    if (signal?.aborted) throw new DocumentPluginError('document_parser_cancelled', 'document_parser_cancelled: document parsing was cancelled')
    if (source.bytes.byteLength === 0) throw new DocumentPluginError('document_read_failed', 'document_read_failed: document is empty')
    const documentId = source.documentId ?? `document-${createHash('sha256').update(source.bytes).digest('hex').slice(0, 16)}`
    const input = { filename: source.filename, mediaType: source.mediaType }
    const parsers = this.parserCandidates && !this.parserId
      ? this.parserCandidates.filter((candidate) => candidate.supports(input))
      : [this.parserRegistry.select(input, this.parserId)]
    let lastError: unknown
    const fallbackErrors: string[] = []
    for (const parser of parsers) {
    try {
      const document = await parser.parse({ bytes: Uint8Array.from(source.bytes), filename: source.filename, mediaType: source.mediaType, documentId, ...(signal === undefined ? {} : { signal }) })
      if (!document.normalizedText.trim() && document.blocks.length > 0) throw new DocumentPluginError('document_text_extraction_insufficient', 'document_text_extraction_insufficient: parser returned no normalized text', parser.id)
      return document
    } catch (error) {
      if (signal?.aborted || (error instanceof DocumentPluginError && error.code === 'document_parser_cancelled')) throw error
      lastError = error
      if (error instanceof Error) fallbackErrors.push(`${parser.id}:${error.message.slice(0, 220)}`)
      if (parser === parsers.at(-1)) break
    }
    }
    if (lastError instanceof DocumentPluginError) {
      if (fallbackErrors.length > 1) throw new DocumentPluginError(lastError.code, `${lastError.message}; parserFallbacks=${fallbackErrors.join(' | ')}`.slice(0, 900), lastError.parserId)
      throw lastError
    }
    if (lastError !== undefined) {
      const message = lastError instanceof Error ? lastError.message : String(lastError)
      throw new DocumentPluginError(message.startsWith('document_text_extraction_insufficient') ? 'document_text_extraction_insufficient' : 'document_parser_failed', `${message}; parserFallbacks=${fallbackErrors.join(' | ')}`.slice(0, 900), parsers.at(-1)?.id)
    }
    throw new DocumentPluginError('document_parser_unsupported', `document_parser_unsupported: ${source.filename}`)
  }
}

function mediaTypeFor(filename: string): string {
  const extension = extname(filename).toLowerCase()
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.md') return 'text/markdown'
  if (extension === '.txt' || extension === '.text') return 'text/plain'
  return 'application/octet-stream'
}
