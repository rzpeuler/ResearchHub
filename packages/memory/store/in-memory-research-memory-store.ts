import { MemoryDuplicateError } from '../core/errors.ts'
import { cloneMemoryItem, validateMemoryItem, type MemoryItem } from '../models/index.ts'
import { validateResearchMemoryQuery, type ResearchMemoryQuery, type ResearchMemoryStore } from '../retrieval/index.ts'

export class InMemoryResearchMemoryStore implements ResearchMemoryStore {
  private readonly items = new Map<string, MemoryItem>()

  add(memoryItem: MemoryItem): MemoryItem {
    validateMemoryItem(memoryItem)
    if (this.items.has(memoryItem.id)) throw new MemoryDuplicateError(memoryItem.id)
    const snapshot = cloneMemoryItem(memoryItem)
    this.items.set(snapshot.id, snapshot)
    return cloneMemoryItem(snapshot)
  }

  get(id: string): MemoryItem | undefined {
    assertId(id)
    const item = this.items.get(id)
    return item === undefined ? undefined : cloneMemoryItem(item)
  }

  search(query: ResearchMemoryQuery = {}): MemoryItem[] {
    validateResearchMemoryQuery(query)
    const results = [...this.items.values()].filter((item) => matches(item, query))
    const limited = query.limit === undefined ? results : results.slice(0, query.limit)
    return limited.map(cloneMemoryItem)
  }

  remove(id: string): boolean {
    assertId(id)
    return this.items.delete(id)
  }
}

function matches(item: MemoryItem, query: ResearchMemoryQuery): boolean {
  return (query.entity === undefined || item.entity === query.entity)
    && (query.topic === undefined || item.topic === query.topic)
    && (query.industry === undefined || item.industry === query.industry)
    && (query.type === undefined || item.type === query.type)
    && (query.artifactId === undefined || item.sourceArtifacts.some((reference) => reference.artifactId === query.artifactId))
    && (query.confidence === undefined || item.confidence === query.confidence)
    && (query.minConfidence === undefined || item.confidence >= query.minConfidence)
}

function assertId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('memory id must be non-empty')
}
