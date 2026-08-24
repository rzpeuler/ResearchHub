# ADR-013: Artifact Trace as Governance Layer

> **Superseded in terminology by ARCH-REFACTOR-003.** The protocol is
> retained for compatibility and is now governed as Research Output
> Provenance, not as a new Artifact business layer.

## Status

Accepted — design only

## Context

ResearchHub now produces linked Evidence, Thesis, Prediction, Review, and
ResearchReport assets. The project needs to answer provenance, lineage, and
revision questions without turning DSH or Harness into a research-asset audit
system.

The current Artifact Core must remain backward compatible. ResearchReport is
also produced by the Workflow layer without being part of the current core
`ArtifactType` union.

## Decision

Define Execution Trace under `packages/artifacts/trace/` as a Research Output
Provenance layer. Use an append-only, runtime-neutral event protocol with:

- lifecycle events: Created, Updated, Derived, Linked, Validated;
- explicit `ArtifactReference` values;
- explicit directed lineage relations;
- governance metadata for producer, Skill, Workflow, and logical version;
- an open Trace artifact type string that includes `research_report` without
  modifying Artifact Core.

Define `TraceStore` as an interface only. Storage, persistence, and runtime
integration remain future work.

## Consequences

Positive:

- Provenance and lineage can be queried independently of Runtime choice.
- Existing Artifact payloads and serialization remain unchanged.
- Thesis, Prediction, and ResearchReport relationships become explicit and
  auditable.
- Future Runtimes can emit the same governance events.

Trade-offs:

- Producers must explicitly emit relations; Trace does not infer them.
- Event history requires a later storage implementation.
- Open Artifact types require consumers to preserve unknown values.

## Rejected Alternatives

### Runtime Trace

Rejected because DSH/Harness execution details are not Research Artifact
provenance and would couple governance to a Runtime.

### Embedded Trace in Artifact Core

Rejected because it changes the existing Artifact contract and makes lifecycle
history part of every serialized Artifact.

### Snapshot-only Lineage Graph

Rejected because it cannot explain when a relationship was created or which
version superseded another.

## Scope and Non-Goals

This ADR does not authorize:

- Agent Runtime Trace;
- LLM token or prompt logging;
- model reasoning capture;
- a Workflow Engine;
- database or Memory implementation;
- automatic trace instrumentation.

## References

- [Artifact Trace Architecture](ARTIFACT_TRACE_ARCHITECTURE.md)
- [Artifact Trace Schema](ARTIFACT_TRACE_SCHEMA.md)
