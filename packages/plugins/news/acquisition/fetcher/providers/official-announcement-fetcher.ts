import { NewsAcquisitionError } from '../../errors.ts'
import { type FetchInput, type RawDocument, type WebFetcher } from '../interface.ts'
import { validateUrl } from '../../search/interface.ts'

export interface OfficialAnnouncementFetcherOptions {
  readonly clock?: () => Date
}

/** Materializes content already returned by the official announcement API as a raw document. */
export class OfficialAnnouncementFetcher implements WebFetcher {
  readonly name = 'official-announcement-fetcher'

  private readonly clock: () => Date

  constructor(options: OfficialAnnouncementFetcherOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(input: FetchInput): Promise<RawDocument> {
    const url = validateUrl(input.url)
    const candidate = input.candidate
    const content = candidate?.snippet?.trim()
    if (content === undefined || content.length === 0) {
      throw new NewsAcquisitionError('fetch', 'official announcement candidate does not contain inline content')
    }

    const fetchedAt = this.clock()
    if (!(fetchedAt instanceof Date) || Number.isNaN(fetchedAt.getTime())) {
      throw new NewsAcquisitionError('fetch', 'clock returned an invalid date')
    }

    return {
      url,
      html: `<article><h1>${escapeHtml(candidate?.title ?? 'Official announcement')}</h1><p>${escapeHtml(content)}</p></article>`,
      fetchedAt: fetchedAt.toISOString(),
      status: 200,
      contentType: 'text/html',
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
