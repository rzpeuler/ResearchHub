import type { DocumentParseInput, DocumentParser } from './types.ts'

export class DocumentParserRegistry {
  constructor(private readonly providers: readonly DocumentParser[]) {}

  get providerIds(): string[] { return this.providers.map((provider) => provider.id) }

  select(input: Pick<DocumentParseInput, 'filename' | 'mediaType'>, requestedId: string): DocumentParser {
    if (requestedId.trim()) {
      const provider = this.providers.find((candidate) => candidate.id === requestedId)
      if (!provider) throw new Error(`document_parser_unavailable: ${requestedId}`)
      if (!provider.supports(input)) throw new Error(`document_parser_unsupported: ${requestedId}`)
      return provider
    }
    const provider = this.providers.find((candidate) => candidate.supports(input))
    if (!provider) throw new Error(`document_parser_unsupported: ${input.filename}`)
    return provider
  }
}
