export interface DocumentParseInput {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mediaType: string
}

export interface DocumentParseChunk {
  readonly chunkId: string
  readonly text: string
  readonly page?: string | number | null
  readonly section?: string | null
  readonly locator?: string | null
}

export interface DocumentParseQuality {
  readonly parserId: string
  readonly pageCount: number | null
  readonly chunkCount: number
  readonly normalizedCharacters: number
  readonly emptyPageCount: number | null
  readonly tableCount?: number
  readonly headingCount?: number
  readonly imageCount?: number
  readonly warnings: string[]
}

export interface DocumentParseResult {
  readonly parser: { id: string; version?: string }
  readonly pageCount?: number
  readonly normalizedText: string
  readonly chunks: DocumentParseChunk[]
  readonly structure?: { headingCount?: number; tableCount?: number; imageCount?: number }
  readonly quality?: DocumentParseQuality
}

export interface DocumentParser {
  readonly id: string
  supports(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>): boolean
  parse(input: DocumentParseInput): Promise<DocumentParseResult>
}

export class DocumentParserError extends Error {
  constructor(readonly code: string, message: string, readonly parserId: string) {
    super(message)
    this.name = 'DocumentParserError'
  }
}
