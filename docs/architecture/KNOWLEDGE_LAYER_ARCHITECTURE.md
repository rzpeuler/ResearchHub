# Knowledge Layer Architecture

**Status:** Current architecture summary; normative freeze is
[Knowledge Architecture v0.1](RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md)

The Knowledge Layer is the top-level durable, reusable knowledge boundary for
ResearchHub. It receives reviewed Research Output through Workflow-controlled
update processes; it is not DSH state, Agent Memory, chat history, prompt
memory, runtime logging, or a package under `packages/`.

## Responsibilities

Knowledge Architecture v0.1 supports:

- company, industry, and supply-chain graphs;
- event timelines;
- associations between Research Documents and entities;
- reusable relations derived from Research Objects.

The layer is intentionally runtime-neutral. Workflow owns update orchestration
and lifecycle management, while the Knowledge Skill provides the access
interface. Knowledge does not choose a Workflow, coordinate execution, or
replace Harness reasoning.

## Boundary

The canonical top-level boundary is `knowledge/`. The conceptual v0.1
subdirectories are defined in
[ResearchHub Knowledge Architecture v0.1](RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md);
this summary does not define a second storage layout.

`research-output/` is the producer-side boundary. `knowledge/` is the
consumer-side durable knowledge boundary:

```text
Research Output -> Workflow lifecycle/update -> Knowledge
```

## Current scope

This architecture documents the boundary and interfaces to be implemented
later. It does not add a graph database, knowledge extraction, RAG, automatic
memory formation, or a knowledge-agent loop.

The existing `packages/memory/` MVP remains intact for compatibility. Its
stored `MemoryItem` records are not reclassified as the current Knowledge
Layer; new durable knowledge belongs under repository-level `knowledge/`.

## Provenance and trace

Research Output Provenance remains attached to the output side. Knowledge
records may reference output object IDs and provenance IDs, but the Knowledge
Layer does not own runtime trace data. Existing Artifact Trace events remain
valid as compatibility provenance records.

## Runtime neutrality

Knowledge interfaces must remain usable by the current DSH and by other
runtime callers. They must not import `dsh/`, Harness runtime packages, Skill
implementations, Workflow executors, or Plugin adapters. No database, graph
engine, RAG, extraction pipeline, or automatic Knowledge formation is implied.
