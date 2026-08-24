# Research Knowledge Memory Retrieval Interface

> **Legacy compatibility interface — superseded by ARCH-REFACTOR-003.** This
> interface remains available to existing callers while durable knowledge
> retrieval is designed under `knowledge/`.

**Protocol:** Research Knowledge Memory v0.1
**Status:** MVP implemented

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
  add(memoryItem: MemoryItem): MemoryItem
  get(id: string): MemoryItem | undefined
  search(query?: ResearchMemoryQuery): MemoryItem[]
  remove(id: string): boolean
}
```

The MVP interface is runtime-neutral and is implemented by
`InMemoryResearchMemoryStore`. A future local plugin or database adapter can
implement the same contract without importing DSH types.

## 4. Retrieval Semantics

- `search` supports entity, topic, industry, type, source Artifact ID,
  confidence, minimum confidence, and limit filters.
- Results preserve source Artifact and Trace references.
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

The current `MemoryPlugin.retrieve(query?: MemoryQuery)` remains available for
exact `MemoryEntry` queries. A future compatibility adapter may project those
results into the richer Research Knowledge contract without changing the
existing plugin contract.
