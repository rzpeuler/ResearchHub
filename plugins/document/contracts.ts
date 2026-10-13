export type DocumentBlockType = 'heading' | 'paragraph' | 'table' | 'list' | 'caption' | 'other'

export interface ParserIdentity {
  readonly id: string
  readonly version?: string
}

export interface DocumentLocator {
  readonly page: number | null
  readonly parserItemRef?: string | null
  readonly sectionPath?: readonly string[]
  readonly sourceOrder?: number | null
  readonly boundingBox?: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null
}

export interface DocumentMetadata {
  readonly originalFilename: string | null
  readonly mediaType: string
  readonly title?: string | null
  readonly pageCount?: number | null
  readonly language?: string | null
  readonly parserMetadata?: Record<string, unknown>
}

export interface DocumentTableContent {
  readonly kind: 'table'
  readonly markdown: string
  readonly rows?: readonly (readonly string[])[]
}

export interface DocumentSection {
  readonly sectionId: string
  readonly title: string | null
  readonly level: number | null
  readonly parentSectionRef: string | null
  readonly blockRefs: readonly string[]
  readonly pageStart: number | null
  readonly pageEnd: number | null
}

export interface DocumentBlock {
  readonly blockId: string
  readonly type: DocumentBlockType
  readonly text: string
  readonly sectionRef: string | null
  readonly page: number | null
  readonly locator: DocumentLocator
  readonly order: number
  readonly metadata?: Record<string, unknown>
  readonly structuredContent?: DocumentTableContent
}

export interface DocumentStats {
  readonly pageCount: number | null
  readonly sectionCount: number
  readonly blockCount: number
  readonly normalizedCharacters: number
  readonly tableCount: number
  readonly headingCount: number
  readonly listCount: number
  readonly captionCount: number
}

export interface StructuredDocument {
  readonly documentId: string
  readonly parser: ParserIdentity
  readonly metadata: DocumentMetadata
  readonly normalizedText: string
  readonly sections: readonly DocumentSection[]
  readonly blocks: readonly DocumentBlock[]
  readonly stats: DocumentStats
  readonly warnings: readonly string[]
}

export interface DocumentParserInput {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mediaType: string
  readonly documentId?: string
  readonly signal?: AbortSignal
}

export interface DocumentParser {
  readonly id: string
  supports(input: Pick<DocumentParserInput, 'filename' | 'mediaType'>): boolean
  parse(input: DocumentParserInput): Promise<StructuredDocument>
}

export type DocumentInputRef =
  | { readonly type: 'bytes'; readonly bytes: Uint8Array; readonly originalFilename?: string | null; readonly mediaType?: string; readonly documentId?: string }
  | { readonly type: 'file'; readonly reference: string; readonly documentId?: string }
  | { readonly type: 'text'; readonly text: string; readonly originalFilename?: string | null; readonly mediaType?: string; readonly documentId?: string }

export interface ResolvedDocumentInput {
  readonly rawBytes: Uint8Array
  readonly originalFilename: string | null
  readonly mediaType: string
  readonly document: StructuredDocument
}

export interface AcquiredDocumentInput {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mediaType: string
  readonly documentId?: string
}
