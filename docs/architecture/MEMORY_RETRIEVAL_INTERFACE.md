# Research Knowledge Memory Retrieval Interface

**Protocol:** Research Knowledge Memory v0.1
**Status:** Design only

## 1. Query Model

```ts
interface MemoryQuery {
  entityId?: string
  topic?: string
  industry?: string
  type?: MemoryItemType
  thesisText?: string
  sourceArtifactId?: string
  minConfidence?: number
  limit?: number
}
```

Queries are structured and bounded. `thesisText` describes a historical thesis
lookup, not an instruction to generate a new thesis.

## 2. Result Model

```ts
interface MemorySearchResult {
  item: MemoryItem
  score?: number
  matchedFields: string[]
}
```

`score` is optional so exact-match, indexed, or future semantic implementations
can share the contract. The result always includes the Memory item and its
Artifact/Trace references.

## 3. ResearchMemory Contract

```ts
interface ResearchMemory {
  getById(id: string): Promise<MemoryItem | undefined>
  search(query: MemoryQuery): Promise<MemorySearchResult[]>
  findByEntity(entityId: string): Promise<MemoryItem[]>
  findByTopic(topic: string): Promise<MemoryItem[]>
  findByIndustry(industry: string): Promise<MemoryItem[]>
  findHistoricalTheses(query: {
    entityId?: string
    industry?: string
    topic?: string
    limit?: number
  }): Promise<MemorySearchResult[]>
}
```

The interface is runtime-neutral and can be implemented by a local plugin,
database adapter, or another Agent Runtime without importing DSH types.

## 4. Retrieval Semantics

- `findByEntity` returns historical knowledge associated with one entity.
- `findByTopic` returns items tagged with a normalized topic.
- `findByIndustry` returns items associated with an industry scope.
- `findHistoricalTheses` returns Thesis Memory items and preserves source
  Artifact and Trace references.
- `search` combines supported structured filters and applies `limit`.
- Empty filters are rejected or bounded by the implementation; an unbounded
  full-database scan is not part of this contract.

## 5. Trace-Aware Retrieval

Retrieval does not reconstruct provenance independently. A consumer may use the
returned `traceReference.rootArtifactId` with the Artifact Trace query API to
retrieve full lineage:

```text
MemoryItem
  -> sourceArtifacts
  -> traceReference.rootArtifactId
  -> Artifact Trace Lineage
```

This keeps Memory focused on durable knowledge and Artifact Trace focused on
provenance governance.

## 6. Compatibility Adapter

The current `MemoryPlugin.retrieve(query?: MemoryQuery)` can remain available for exact
`MemoryEntry` queries. A future compatibility adapter may project those
results into `MemorySearchResult` without changing the existing plugin
contract.
