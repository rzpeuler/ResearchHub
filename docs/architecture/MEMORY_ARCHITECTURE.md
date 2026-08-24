# ResearchHub Memory Architecture

**Task:** MEMORY-ARCHITECTURE-DESIGN-001
**Status:** Design only
**Scope:** Research Knowledge Memory Layer

## 1. Positioning

Memory is the long-term Research Knowledge Layer under `packages/memory/`.
It stores research assets that have durable value after Artifact creation and,
where applicable, Evaluation.

Memory is not:

- DSH Memory;
- Agent Memory;
- Chat History Memory;
- Prompt or model-reasoning storage;
- Runtime logging;
- a large-scale Knowledge Graph.

The dependency boundary is:

```text
Artifact + Trace ──> Evaluation ──> Memory Formation ──> Retrieval
```

Memory consumes neutral Artifact and Trace references. It does not import DSH,
Harness, Agent Runtime, Workflow Engine, Skill implementation, or Plugin
implementation types.

## 2. Compatibility Strategy

The existing `MemoryEntry`, `MemoryPlugin`, local JSON plugin, and Artifact
Memory Adapters remain supported. They are the compatibility foundation for
the current Thesis, Prediction, and Review storage path.

The future Research Knowledge model extends this foundation with `MemoryItem`,
multiple source Artifact references, Trace references, lifecycle state, and
structured retrieval metadata. It does not replace `MemoryEntry` in one step.

## 3. Target Structure

```text
packages/memory/
├── core/          existing MemoryEntry and MemoryPlugin contracts
├── models/        MemoryItem and reference models
├── schemas/       item, lifecycle, and query schemas
├── lifecycle/     Artifact -> Evaluation -> Memory Formation
├── retrieval/     runtime-neutral ResearchMemory interface
├── adapters/      Artifact, Evaluation, and compatibility adapters
└── plugins/       storage implementations
```

`plugins/` provide storage only. Research meaning, eligibility, and retrieval
semantics belong to Memory contracts and lifecycle components.

## 4. Knowledge Categories

| Type | Purpose | Example |
| --- | --- | --- |
| `entity` | durable identity and research context | 600519 / 贵州茅台 |
| `thesis` | historical research claim | margin durability thesis |
| `prediction` | testable expectation and its outcome | next-period revenue expectation |
| `evidence` | reusable, high-value supporting fact | official filing fact |
| `review` | evaluation and learning record | prediction met or missed |

Memory stores knowledge records, not an unbounded copy of every Artifact.
Formation policy decides which evaluated or explicitly retained assets become
long-term Memory.

## 5. Lifecycle

```text
Artifact Created
      |
      v
Artifact Trace complete
      |
      v
Evaluation completed
      |
      v
Memory Formation eligibility
      |
      v
MemoryItem created or revised
      |
      v
Entity / topic / industry retrieval
```

Rules:

1. An Artifact remains the source of truth; Memory is a reusable projection.
2. Evaluation may make a Prediction eligible and may add validation outcome
   fields without rewriting the original Prediction.
3. Revisions create a new Memory version or item and retain the old history.
4. Memory formation must preserve the source Artifact IDs and Trace reference.
5. Retrieval returns provenance references so a consumer can inspect the
   originating Artifact and lineage.

## 6. Runtime Neutrality

Any Runtime or Agent can consume the Memory interface. A caller supplies
structured entity, topic, industry, or thesis queries; Memory does not plan
research, invoke Skills, call Plugins, or perform LLM reasoning.

## 7. Non-Goals

This design does not introduce:

- Vector Database requirements;
- Knowledge Graph infrastructure;
- autonomous Memory Agents;
- automatic strategy optimization;
- automatic Skill modification;
- DSH or Harness changes;
- Chat or Prompt retention.
