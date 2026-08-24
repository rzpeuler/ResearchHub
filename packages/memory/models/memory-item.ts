import type { ArtifactReference } from '../../artifacts/trace/index.ts'
import type { JsonObject } from '../core/types.ts'

export const MEMORY_ITEM_TYPES = ['entity', 'thesis', 'prediction', 'evidence', 'review'] as const

export type MemoryItemType = (typeof MEMORY_ITEM_TYPES)[number]

export type MemoryTraceReference = string | {
  eventId: string
  rootArtifactId: string
}

/** A durable, runtime-neutral projection of reusable Research Knowledge. */
export interface MemoryItem {
  id: string
  type: MemoryItemType
  content: JsonObject
  sourceArtifacts: ArtifactReference[]
  traceReferences: MemoryTraceReference[]
  entity?: string
  topic?: string
  industry?: string
  confidence: number
  createdAt: string
  metadata: JsonObject
}
