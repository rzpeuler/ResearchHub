import { normalizeSearchInput, type SearchInput, type SearchProvider, type SearchResult, validateSearchResult } from '../interface.ts'

export class MockSearchProvider implements SearchProvider {
  readonly name = 'mock-search'

  constructor(private readonly results: readonly SearchResult[]) {}

  async search(input: SearchInput): Promise<readonly SearchResult[]> {
    const normalized = normalizeSearchInput(input)
    return this.results.slice(0, normalized.limit).map(validateSearchResult)
  }
}

