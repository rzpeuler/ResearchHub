import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DocumentParserError } from './types.ts'
import type { DocumentParseInput, DocumentParseResult, DocumentParser } from './types.ts'

export interface PdfJsDocumentParserOptions {
  readonly extractPages?: (data: Uint8Array) => Promise<string[]>
}

export class PdfJsDocumentParser implements DocumentParser {
  readonly id = 'pdfjs-text'
  private readonly extractPages: (data: Uint8Array) => Promise<string[]>

  constructor(options: PdfJsDocumentParserOptions = {}) {
    this.extractPages = options.extractPages ?? extractPdfPages
  }

  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean {
    return input.mediaType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')
  }

  async parse(input: DocumentParseInput): Promise<DocumentParseResult> {
    const parserBytes = Uint8Array.from(input.bytes)
    let pages: string[]
    try { pages = await this.extractPages(parserBytes) } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF text extraction failed'
      throw new DocumentParserError('document_text_extraction_insufficient', `document_text_extraction_insufficient: ${message}`, this.id)
    }
    const chunks = pages.map((text, index) => ({ chunkId: `page-${String(index + 1).padStart(4, '0')}`, text: text.trim(), page: index + 1, section: null, locator: `page:${index + 1}` })).filter((chunk) => chunk.text.length > 0)
    const normalizedText = chunks.map((chunk) => chunk.text).join('\n\n').trim()
    if (!normalizedText) throw new DocumentParserError('document_text_extraction_insufficient', 'document_text_extraction_insufficient: PDF contains no extractable text', this.id)
    return {
      parser: { id: this.id, version: 'pdfjs-dist' },
      pageCount: pages.length,
      normalizedText,
      chunks,
      quality: { parserId: this.id, pageCount: pages.length, chunkCount: chunks.length, normalizedCharacters: normalizedText.length, emptyPageCount: pages.filter((page) => page.trim().length === 0).length, warnings: ['Text-native extraction only; layout, tables, OCR, images and charts are not interpreted.'] }
    }
  }
}

export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const document = await getDocument({ data: Uint8Array.from(data), useWorkerFetch: false, verbosity: 0 }).promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
    }
  } finally { await document.cleanup() }
  return pages
}
