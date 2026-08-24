import { createEvidence, type Evidence, type JsonObject } from '../../../../artifacts/index.ts'
import { NewsAcquisitionError } from '../errors.ts'
import { type NormalizedArticle } from '../normalization/article-normalizer.ts'

export type EvidenceReliability = 'high' | 'medium' | 'low'

export interface EvidenceBuildContext {
  readonly id: string
  readonly createdAt: string
  readonly sessionId: string
  readonly entity: string
  readonly provider: string
  readonly reliability?: EvidenceReliability
  readonly confidence?: number
}

export interface EvidenceBuilder {
  build(article: NormalizedArticle, context: EvidenceBuildContext): Evidence
}

export class NewsEvidenceBuilder implements EvidenceBuilder {
  build(article: NormalizedArticle, context: EvidenceBuildContext): Evidence {
    if (context.entity.trim().length === 0) throw new NewsAcquisitionError('evidence', 'entity must not be empty')
    if (context.provider.trim().length === 0) throw new NewsAcquisitionError('evidence', 'provider must not be empty')
    const reliability = context.reliability ?? 'medium'
    const confidence = context.confidence ?? confidenceFor(reliability)
    const acquisition: JsonObject = {
      reliability,
      entity: context.entity.trim(),
      url: article.url,
      provider: context.provider.trim(),
    }
    return createEvidence({
      id: context.id,
      createdAt: context.createdAt,
      sessionId: context.sessionId,
      source: article.source,
      content: article.content,
      timestamp: article.publishedAt,
      confidence,
      metadata: {
        ...article.metadata,
        acquisition,
        title: article.title,
      },
    })
  }
}

function confidenceFor(reliability: EvidenceReliability): number {
  return reliability === 'high' ? 0.9 : reliability === 'low' ? 0.5 : 0.75
}
