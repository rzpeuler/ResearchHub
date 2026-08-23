import {
  deserializeReview,
  serializeReview,
  type Review,
} from '../../artifacts/review/index.ts'
import type { MemoryEntry, MemoryProvider } from '../core/index.ts'

/** Maps validated Review artifacts to durable Memory Entries. */
export class ReviewMemoryAdapter {
  constructor(private readonly provider: MemoryProvider) {}

  async saveReview(review: Review): Promise<MemoryEntry> {
    const content = serializeReview(review)
    deserializeReview(content)

    return this.provider.save({
      id: `memory:review:${review.id}`,
      type: 'review',
      content,
      sourceArtifactId: review.id,
      createdAt: review.createdAt,
      metadata: {
        sessionId: review.sessionId,
        artifactType: review.type,
      },
    })
  }
}
