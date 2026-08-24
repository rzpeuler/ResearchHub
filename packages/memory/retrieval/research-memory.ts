import type { MemoryItem, MemoryItemType } from '../models/index.ts'

export interface ResearchMemoryQuery {
  entity?: string
  topic?: string
  industry?: string
  type?: MemoryItemType
  artifactId?: string
  confidence?: number
  minConfidence?: number
  limit?: number
}

export interface ResearchMemory {
  add(memoryItem: MemoryItem): MemoryItem
  get(id: string): MemoryItem | undefined
  search(query?: ResearchMemoryQuery): MemoryItem[]
  remove(id: string): boolean
}

export interface ResearchMemoryStore extends ResearchMemory {}
