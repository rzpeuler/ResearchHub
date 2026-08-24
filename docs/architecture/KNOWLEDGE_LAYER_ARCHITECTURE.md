# Knowledge Layer Architecture

**Status:** Current architecture direction (ARCH-REFACTOR-003)

The Knowledge Layer is the durable, reusable knowledge boundary for
ResearchHub. It receives validated Research Output over time; it is not DSH
state, Agent Memory, chat history, prompt memory, or runtime logging.

## Responsibilities

Knowledge will eventually support:

- company, industry, and supply-chain graphs;
- event timelines;
- associations between Research Documents and entities;
- reusable relations derived from Research Objects.

The layer is intentionally infrastructure-oriented. It does not choose a
Workflow, invoke a Skill, access a Plugin, or replace Harness reasoning.

## Structure

```text
knowledge/
├── ontology/      # entity, relation, and event type definitions
├── graph/         # entities, relations, and event timelines
├── documents/     # Research Document associations
└── ingestion/     # future Research Output ingestion boundary
```

`research-output/` is the producer-side boundary. `knowledge/` is the
consumer-side durable knowledge boundary:

```text
Research Output -> Knowledge ingestion -> Ontology / Graph / Documents
```

## Current scope

This migration creates stable directories and documents the interfaces to be
implemented later. It does not add a graph database, knowledge extraction,
RAG, automatic memory formation, or a knowledge-agent loop.

The existing `packages/memory/` MVP remains intact for compatibility. Its
stored `MemoryItem` records are not reclassified as a new runtime layer; future
durable knowledge implementations should target this Knowledge Layer.

## Provenance and trace

Research Output Provenance remains attached to the output side. Knowledge
records may reference output object IDs and provenance IDs, but the Knowledge
Layer does not own runtime trace data. Existing Artifact Trace events remain
valid as compatibility provenance records.

## Runtime neutrality

Knowledge interfaces must remain usable by the current DSH and by other
runtime callers. They must not import `dsh/`, Harness runtime packages, Skill
implementations, Workflow executors, or Plugin adapters.
