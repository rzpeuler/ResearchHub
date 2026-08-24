import { NewsAcquisitionError, type NewsAcquisitionStage } from './errors.ts'
import { NewsEvidenceBuilder, type EvidenceBuildContext, type EvidenceBuilder, type EvidenceReliability } from './evidence/evidence-builder.ts'
import { type RawDocument, type WebFetcher } from './fetcher/interface.ts'
import { HtmlArticleNormalizer, type ArticleNormalizer, type NormalizedArticle } from './normalization/article-normalizer.ts'
import { normalizeSearchInput, type SearchInput, type SearchProvider, type SearchResult, validateSearchResult } from './search/interface.ts'
import { type Evidence } from '../../../artifacts/index.ts'

export interface NewsAcquisitionContext {
  readonly createdAt: string
  readonly sessionId: string
  readonly entity?: string
  readonly provider?: string
  readonly reliability?: EvidenceReliability
  readonly confidence?: number
}

export interface NewsAcquisitionErrorRecord {
  readonly url: string
  readonly stage: NewsAcquisitionStage
  readonly message: string
}

export interface NewsAcquisitionResult {
  readonly searchResults: readonly SearchResult[]
  readonly documents: readonly RawDocument[]
  readonly articles: readonly NormalizedArticle[]
  readonly evidence: readonly Evidence[]
  readonly errors: readonly NewsAcquisitionErrorRecord[]
}

export interface NewsAcquisitionLayerOptions {
  readonly searchProvider: SearchProvider
  readonly fetcher: WebFetcher
  readonly normalizer?: ArticleNormalizer
  readonly evidenceBuilder?: EvidenceBuilder
  readonly evidenceIdFactory?: (index: number, article: NormalizedArticle) => string
}

export class NewsAcquisitionLayer {
  private readonly normalizer: ArticleNormalizer
  private readonly evidenceBuilder: EvidenceBuilder
  private readonly evidenceIdFactory: (index: number, article: NormalizedArticle) => string

  constructor(private readonly options: NewsAcquisitionLayerOptions) {
    this.normalizer = options.normalizer ?? new HtmlArticleNormalizer()
    this.evidenceBuilder = options.evidenceBuilder ?? new NewsEvidenceBuilder()
    this.evidenceIdFactory = options.evidenceIdFactory ?? ((index) => `news-acquisition-evidence-${index + 1}`)
  }

  async acquire(input: SearchInput, context: NewsAcquisitionContext): Promise<NewsAcquisitionResult> {
    const normalizedInput = normalizeSearchInput(input)
    const searchResults = [...await this.options.searchProvider.search(normalizedInput)]
      .slice(0, normalizedInput.limit)
      .map(validateSearchResult)
    const documents: RawDocument[] = []
    const articles: NormalizedArticle[] = []
    const evidence: Evidence[] = []
    const errors: NewsAcquisitionErrorRecord[] = []
    const entity = context.entity?.trim() || normalizedInput.entity?.trim() || normalizedInput.query
    const provider = context.provider?.trim() || this.options.searchProvider.name

    for (const [index, candidate] of searchResults.entries()) {
      try {
        const document = await this.options.fetcher.fetch({ url: candidate.url, candidate })
        const article = this.normalizer.normalize(document, candidate)
        const buildContext: EvidenceBuildContext = {
          id: this.evidenceIdFactory(index, article),
          createdAt: context.createdAt,
          sessionId: context.sessionId,
          entity,
          provider,
          ...(context.reliability === undefined ? {} : { reliability: context.reliability }),
          ...(context.confidence === undefined ? {} : { confidence: context.confidence }),
        }
        const item = this.evidenceBuilder.build(article, buildContext)
        documents.push(document)
        articles.push(article)
        evidence.push(item)
      } catch (cause) {
        const stage = cause instanceof NewsAcquisitionError ? cause.stage : 'fetch'
        errors.push({ url: candidate.url, stage, message: safeMessage(cause) })
      }
    }

    return { searchResults, documents, articles, evidence, errors }
  }
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/gi, '[redacted-url]') : 'acquisition failed'
}
