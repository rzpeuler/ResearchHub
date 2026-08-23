import {
  deserializePrediction,
  deserializeThesis,
  isPrediction,
  isThesis,
  serializePrediction,
  serializeThesis,
  type Prediction,
  type Thesis,
} from '../../artifacts/index.ts'
import type { MemoryEntry, MemoryProvider } from '../core/index.ts'

  /** Maps supported research artifacts to durable Memory Entries. */
export class ArtifactMemoryAdapter {
  constructor(private readonly provider: MemoryProvider) {}

  async saveThesis(thesis: Thesis): Promise<MemoryEntry> {
    const content = serializeThesis(thesis)
    deserializeThesis(content)

    return this.provider.save({
      id: `memory:thesis:${thesis.id}`,
      type: 'thesis',
      content,
      sourceArtifactId: thesis.id,
      createdAt: thesis.createdAt,
      metadata: {
        sessionId: thesis.sessionId,
        artifactType: thesis.type,
      },
    })
  }

  async savePrediction(prediction: Prediction): Promise<MemoryEntry> {
    const content = serializePrediction(prediction)
    deserializePrediction(content)

    return this.provider.save({
      id: `memory:prediction:${prediction.id}`,
      type: 'prediction',
      content,
      sourceArtifactId: prediction.id,
      createdAt: prediction.createdAt,
      metadata: {
        sessionId: prediction.sessionId,
        artifactType: prediction.type,
      },
    })
  }

  async saveArtifact(artifact: Thesis | Prediction): Promise<MemoryEntry> {
    if (isThesis(artifact)) {
      return this.saveThesis(artifact)
    }

    if (isPrediction(artifact)) {
      return this.savePrediction(artifact)
    }

    throw new TypeError('ArtifactMemoryAdapter supports Thesis and Prediction artifacts only')
  }
}
