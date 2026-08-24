import { type SearchResult } from '../search/interface.ts'

export interface RawDocument {
  readonly url: string
  readonly html: string
  readonly fetchedAt: string
  readonly status: number
  readonly contentType?: string
}

export interface FetchInput {
  readonly url: string
  readonly candidate?: SearchResult
}

export interface WebFetcher {
  readonly name: string
  fetch(input: FetchInput): Promise<RawDocument>
}

