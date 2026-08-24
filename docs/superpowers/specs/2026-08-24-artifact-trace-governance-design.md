# Artifact Trace Governance Design

## Decision

ResearchHub will define an append-only Execution Trace Protocol under
`packages/artifacts/trace/` as a future Artifact Governance capability. The
protocol records Research Artifact provenance, lineage, lifecycle events, and
validation results. It is not a runtime log.

Trace references use an independent open `artifactType` string. The known
types are `evidence`, `thesis`, `prediction`, `review`, and
`research_report`; this allows ResearchReport to be traced without changing
the current Artifact Core union.

## Invariants

- Trace events are immutable and append-only.
- Artifact Core models remain unchanged and backward compatible.
- Trace has no dependency on DSH, Harness, Agent Runtime, Workflow, Skill, or
  Plugin implementation.
- Runtime metadata is optional and never a core trace identity field.
- Prompt text, model reasoning, token usage, and internal execution logs are
  outside the protocol.

## Protocol Shape

Each event contains a protocol version, event identity, occurrence time,
primary artifact reference, optional source references, optional lineage
relations, governance metadata, and an optional runtime metadata object.

The minimum event set is:

`artifact_created`, `artifact_updated`, `artifact_derived`,
`artifact_linked`, and `artifact_validated`.

The minimum relation set is:

`derived_from`, `supports`, `contains`, and `supersedes`.

## Storage Boundary

`TraceStore` is an interface only. It supports append, lineage query, and
artifact history query. Database choice, serialization format, retention, and
transport are implementation decisions for a later task.

## Integration Boundary

Future Workflow Executors, Skill Adapters, and Artifact Builders may create
trace events through a Trace Event Factory and append them to a caller-supplied
TraceStore. They do not own storage or add runtime logging. Existing callers
continue to create and serialize Artifacts exactly as before.
