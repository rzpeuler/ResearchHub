# Research Knowledge Memory Architecture Design

**Task:** MEMORY-ARCHITECTURE-DESIGN-001
**Status:** Approved design

## Decision Summary

ResearchHub Memory is a runtime-neutral Research Knowledge Layer under
`packages/memory/`. The existing `MemoryEntry` and `MemoryPlugin` contracts
remain compatible while a future `MemoryItem` model adds multi-Artifact source
references, Artifact Trace references, lifecycle metadata, and structured
retrieval.

## Boundaries

```text
Artifact + Trace -> Evaluation -> Memory Formation -> Retrieval
```

Memory stores durable research knowledge, not DSH state, Agent sessions,
Prompts, LLM reasoning, Runtime logs, or Chat History. Trace remains the source
of provenance and Memory stores only references to it.

## Models and Interfaces

- `MemoryItem`: Entity, Thesis, Prediction, Evidence, or Review knowledge.
- `MemoryReference`: one or more Artifact References plus a Trace reference.
- `ResearchMemory`: bounded retrieval by entity, topic, industry, and
  historical thesis.
- Compatibility adapter: projects existing `MemoryEntry` values into the new
  model without rewriting existing stored data.

## Validation

- 600519 research produces a Thesis Memory item retrievable by entity.
- A validated Prediction adds an evaluation projection while preserving the
  original Prediction Artifact.
- Another Runtime can consume the same Retrieval interface without DSH types.
