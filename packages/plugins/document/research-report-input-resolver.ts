import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { KnowledgeIngestionWorkflowError } from '../../../packages/workflows/research-report-knowledge-ingestion/errors.ts'
import type { ResearchReportInputRef, ResearchReportInputResolver, ResolvedResearchReportInput } from '../../../packages/workflows/research-report-knowledge-ingestion/types.ts'
import { DoclingDocumentParser } from './docling-document-parser.ts'
import { DocumentParserError } from './types.ts'
import { DocumentParserRegistry } from './parser-registry.ts'
import { extractPdfPages, PdfJsDocumentParser } from './pdfjs-document-parser.ts'
import type { DocumentParseResult, DocumentParser } from './types.ts'

export interface ResearchReportPdfTextExtractor { extractPages(data: Uint8Array): Promise<string[]> }

export class PdfJsResearchReportTextExtractor implements ResearchReportPdfTextExtractor {
  async extractPages(data: Uint8Array): Promise<string[]> { return extractPdfPages(data) }
}

export interface LocalResearchReportInputResolverOptions {
  readonly pdfTextExtractor?: ResearchReportPdfTextExtractor
  readonly documentParser?: DocumentParser
  readonly parserRegistry?: DocumentParserRegistry
  readonly parserId?: string
}

export class LocalResearchReportInputResolver implements ResearchReportInputResolver {
  private readonly parserRegistry: DocumentParserRegistry
  private readonly parserId: string

  constructor(options: LocalResearchReportInputResolverOptions = {}) {
    const pdfjs = new PdfJsDocumentParser(options.pdfTextExtractor ? { extractPages: options.pdfTextExtractor.extractPages.bind(options.pdfTextExtractor) } : {})
    this.parserRegistry = options.parserRegistry ?? new DocumentParserRegistry(options.documentParser ? [options.documentParser] : [new DoclingDocumentParser(), pdfjs])
    this.parserId = options.parserId ?? (options.documentParser?.id ?? (options.pdfTextExtractor ? pdfjs.id : process.env.RESEARCHHUB_DOCUMENT_PARSER ?? 'docling-local'))
  }

  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> {
    if (inputRef.type === 'text') return resolveText(inputRef.text, inputRef.originalFilename ?? null, inputRef.mediaType ?? 'text/plain')
    const reference = inputRef.reference.trim()
    if (!reference) throw resolutionError('document_reference_missing', 'Document reference must be non-empty')
    let canonicalRawBytes: Uint8Array
    try { canonicalRawBytes = Uint8Array.from(await readFile(reference)) } catch (error) { throw resolutionError('document_read_failed', error instanceof Error ? error.message : 'Unable to read document') }
    if (canonicalRawBytes.byteLength === 0) throw resolutionError('document_read_failed', 'Document is empty')
    const filename = basename(reference)
    const extension = extname(filename).toLowerCase()
    if (extension !== '.pdf') return resolveText(new TextDecoder().decode(canonicalRawBytes), filename, mediaTypeFor(extension), canonicalRawBytes)
    const parser = this.parserRegistry.select({ filename, mediaType: 'application/pdf' }, this.parserId)
    let parsed: DocumentParseResult
    try { parsed = await parser.parse({ bytes: Uint8Array.from(canonicalRawBytes), filename, mediaType: 'application/pdf' }) } catch (error) {
      if (error instanceof DocumentParserError) throw resolutionError(error.code, error.message)
      throw resolutionError('document_parser_failed', error instanceof Error ? error.message : String(error))
    }
    if (!parsed.normalizedText.trim()) throw resolutionError('document_text_extraction_insufficient', 'Document contains no extractable text')
    return { rawBytes: canonicalRawBytes, originalFilename: filename, mediaType: 'application/pdf', normalizedText: parsed.normalizedText.trim(), chunks: parsed.chunks }
  }
}

function resolveText(value: string, originalFilename: string | null, mediaType: string, rawBytes = new TextEncoder().encode(value)): ResolvedResearchReportInput {
  const normalizedText = value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
  if (!normalizedText) throw resolutionError('document_text_extraction_insufficient', 'Document contains no decodable text')
  const paragraphs = normalizedText.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
  const chunks = (paragraphs.length > 0 ? paragraphs : [normalizedText]).map((text, index) => ({ chunkId: `chunk-${String(index + 1).padStart(4, '0')}`, text, section: null, locator: `paragraph:${index + 1}` }))
  return { rawBytes, originalFilename, mediaType, normalizedText, chunks }
}

function mediaTypeFor(extension: string): string { return extension === '.md' ? 'text/markdown' : 'text/plain' }

function resolutionError(code: string, message: string): KnowledgeIngestionWorkflowError { return new KnowledgeIngestionWorkflowError(code, `${code}: ${message}`, 'document_resolution') }
