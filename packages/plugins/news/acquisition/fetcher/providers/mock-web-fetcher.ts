import { NewsAcquisitionError } from '../../errors.ts'
import { type FetchInput, type RawDocument, type WebFetcher } from '../interface.ts'
import { validateUrl } from '../../search/interface.ts'

export class MockWebFetcher implements WebFetcher {
  readonly name = 'mock-web-fetcher'

  constructor(private readonly documents: Readonly<Record<string, RawDocument>>) {}

  async fetch(input: FetchInput): Promise<RawDocument> {
    const url = validateUrl(input.url)
    const document = this.documents[url]
    if (document === undefined) throw new NewsAcquisitionError('fetch', `mock document not found for ${url}`)
    return { ...document, url }
  }
}

