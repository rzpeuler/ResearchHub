# Research Output and Knowledge Architecture Migration

**Task:** ARCH-REFACTOR-003
**Status:** Approved design
**Date:** 2026-08-25

## Decision

ResearchHub is repositioned as financial research knowledge infrastructure.
The primary business flow is:

```text
Research Request
    -> Workflow
    -> Research Output
    -> Research Object
    -> Knowledge Layer
```

`Research Output` is the user-facing and machine-consumable result layer.
`Research Object` is the public business object envelope. `Knowledge` is the
long-term entity, relation, event, and document infrastructure.

## Compatibility Strategy

- Keep `packages/artifacts/` as a compatibility implementation boundary while
  treating Artifact as a technical production term rather than the primary
  business concept.
- Keep `packages/memory/` as a legacy-compatible storage path; future durable
  knowledge belongs under `knowledge/`.
- Keep `packages/evaluation/` for existing test and review compatibility; no
  new Prediction Evaluation or automatic learning capability is added.
- Reposition Artifact Trace as Research Output Provenance without changing its
  event protocol or adding Runtime Trace.

## New Foundations

- `research-output/` reserves reports, structured objects, and provenance.
- `knowledge/` reserves ontology, graph, documents, and ingestion boundaries.
- `packages/schemas/` defines the runtime-neutral Research Object Envelope.
- `packages/shared/` is reserved for future cross-package contracts and does
  not become a new orchestration layer.

## Research Object Envelope

The public envelope contains:

```text
objectId
objectType
createdAt
sourceWorkflow
sourceSkill
version
payload
```

`payload` remains Skill-owned and is not changed in this migration.

## Explicit Non-Goals

- no DSH, Harness, Skill, Workflow, or Plugin logic changes;
- no Knowledge Graph database;
- no knowledge extraction or RAG;
- no Memory Formation implementation;
- no deletion of old modules;
- no Runtime Trace, Agent Memory, or Prediction Evaluation system.
