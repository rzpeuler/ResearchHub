import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { KnowledgeIngestionWorkflowError } from '../../../packages/workflows/research-report-knowledge-ingestion/errors.ts'
import type { ResearchReportInputRef, ResearchReportInputResolver, ResolvedResearchReportInput } from '../../../packages/workflows/research-report-knowledge-ingestion/types.ts'

export interface ResearchReportPdfTextExtractor {
  extractPages(data: Uint8Array): Promise<string[]>
}

export class PdfJsResearchReportTextExtractor implements ResearchReportPdfTextExtractor {
  async extractPages(data: Uint8Array): Promise<string[]> {
    const document = await getDocument({ data, useWorkerFetch: false, verbosity: 0 }).promise
    const pages: string[] = []
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push(content.items.map((item) => 'str' in item ? item.str : '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
      }
    } finally {
      await document.cleanup()
    }
    return pages
  }
}

export interface LocalResearchReportInputResolverOptions {
  readonly pdfTextExtractor?: ResearchReportPdfTextExtractor
}

export class LocalResearchReportInputResolver implements ResearchReportInputResolver {
  private readonly pdfTextExtractor: ResearchReportPdfTextExtractor

  constructor(options: LocalResearchReportInputResolverOptions = {}) {
    this.pdfTextExtractor = options.pdfTextExtractor ?? new PdfJsResearchReportTextExtractor()
  }

  async resolve(inputRef: ResearchReportInputRef): Promise<ResolvedResearchReportInput> {
    if (inputRef.type === 'text') return resolveText(inputRef.text, inputRef.originalFilename ?? null, inputRef.mediaType ?? 'text/plain')
    const reference = inputRef.reference.trim()
    if (!reference) throw resolutionError('document_reference_missing', 'Document reference must be non-empty')
    let rawBytes: Uint8Array
    try { rawBytes = new Uint8Array(await readFile(reference)) } catch (error) { throw resolutionError('document_read_failed', error instanceof Error ? error.message : 'Unable to read document') }
    if (rawBytes.byteLength === 0) throw resolutionError('document_read_failed', 'Document is empty')
    const filename = basename(reference)
    const extension = extname(filename).toLowerCase()
    if (extension === '.pdf') return this.resolvePdf(rawBytes, filename)
    return resolveText(new TextDecoder().decode(rawBytes), filename, mediaTypeFor(extension))
  }

  private async resolvePdf(rawBytes: Uint8Array, filename: string): Promise<ResolvedResearchReportInput> {
    let pages: string[]
    try { pages = await this.pdfTextExtractor.extractPages(rawBytes) } catch (error) { throw resolutionError('document_text_extraction_insufficient', error instanceof Error ? `PDF text extraction failed: ${error.message}` : 'PDF text extraction failed') }
    const chunks = pages.map((text, index) => ({ chunkId: `page-${String(index + 1).padStart(4, '0')}`, text: text.trim(), page: index + 1, section: null, locator: `page:${index + 1}` })).filter((chunk) => chunk.text.length > 0)
    const normalizedText = chunks.map((chunk) => chunk.text).join('\n\n').trim()
    if (!normalizedText) throw resolutionError('document_text_extraction_insufficient', 'PDF contains no extractable text')
    return { rawBytes, originalFilename: filename, mediaType: 'application/pdf', normalizedText, chunks }
  }
}

function resolveText(value: string, originalFilename: string | null, mediaType: string): ResolvedResearchReportInput {
  const normalizedText = value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
  if (!normalizedText) throw resolutionError('document_text_extraction_insufficient', 'Document contains no decodable text')
  const paragraphs = normalizedText.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
  const chunks = (paragraphs.length > 0 ? paragraphs : [normalizedText]).map((text, index) => ({ chunkId: `chunk-${String(index + 1).padStart(4, '0')}`, text, section: null, locator: `paragraph:${index + 1}` }))
  return { rawBytes: new TextEncoder().encode(value), originalFilename, mediaType, normalizedText, chunks }
}

function mediaTypeFor(extension: string): string {
  if (extension === '.md') return 'text/markdown'
  return 'text/plain'
}

function resolutionError(code: string, message: string): KnowledgeIngestionWorkflowError {
  return new KnowledgeIngestionWorkflowError(code, `${code}: ${message}`, 'document_resolution')
}
