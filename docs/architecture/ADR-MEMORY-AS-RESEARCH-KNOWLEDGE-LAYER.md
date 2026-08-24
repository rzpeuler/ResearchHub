# ADR: Memory as Research Knowledge Layer

**Status:** Accepted design
**Date:** 2026-08-24
**Task:** MEMORY-ARCHITECTURE-DESIGN-001

## Context

ResearchHub can create and evaluate Evidence, Thesis, Prediction, and Review
Artifacts, but long-term reuse requires a dedicated Research Knowledge layer.
The existing Memory MVP stores serialized Thesis, Prediction, and Review
records, while the target model must also support Entity, Evidence, multiple
Artifact sources, and Artifact Trace references.

## Decision

Memory is governed as `packages/memory/`, a runtime-neutral Research Knowledge
Layer. It will evolve by compatibility extension:

1. Preserve `MemoryEntry`, `MemoryPlugin`, existing adapters, and local JSON
   behavior.
2. Define `MemoryItem` for durable Entity, Thesis, Prediction, Evidence, and
   Review knowledge.
3. Reference source Artifacts and Artifact Trace; do not duplicate Artifact
   payloads or provenance events as an independent graph.
4. Form long-term Memory through an Artifact -> Evaluation -> Memory Formation
   lifecycle.
5. Expose structured retrieval through `ResearchMemory` without DSH, Agent,
   Harness, Workflow, Skill, or Plugin implementation dependencies.

## Rationale

This preserves current users while establishing a clear boundary between:

- Artifact: source research asset;
- Trace: provenance and lineage governance;
- Evaluation: quality and prediction validation;
- Memory: durable, searchable knowledge projection.

It also allows another Runtime or Agent to consume the same knowledge without
coupling Memory to the current DSH implementation.

## Rejected Alternatives

- Replacing `MemoryEntry` immediately: breaking change with no architectural
  benefit at the design stage.
- Treating Memory as DSH or Agent Memory: couples research knowledge to one
  Runtime and violates the Single DSH architecture boundary.
- Building a Knowledge Graph or Vector Database now: exceeds the current
  Research Asset scope and is not required for structured retrieval.

## Consequences

Positive:

- historical Thesis retrieval by entity, topic, and industry;
- Prediction validation can improve future Memory confidence;
- provenance remains auditable through Artifact Trace;
- multiple Runtimes can share the Memory contract.

Trade-offs:

- two schemas remain during the compatibility period;
- Memory formation policy must prevent low-value Artifact accumulation;
- persistence, indexing, and semantic ranking require later implementation
  decisions.
