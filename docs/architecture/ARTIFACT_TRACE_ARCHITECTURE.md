# Artifact Trace Architecture

**Task:** ARTIFACT-TRACE-DESIGN-001  
**Status:** MVP implemented; persistence and automatic instrumentation remain out of scope
**Scope:** Artifact Governance, Provenance, Lineage, and Lifecycle

## 1. Purpose

ResearchHub produces linked research assets such as Evidence, Thesis,
Prediction, and ResearchReport. Artifact Trace defines the governance protocol
that explains how those assets were created, related, revised, and validated.

Trace belongs to the Artifact layer:

```text
packages/artifacts/
├── models/       existing Artifact Core models
├── builders/     existing and future Artifact creation boundaries
├── lineage/      relationship views derived from Trace
└── trace/        Trace Event Schema, Trace Model, Trace Protocol
```

The MVP implements the protocol with an in-memory `TraceStore` and an opt-in
`TraceArtifactBuilder`. It does not implement database persistence, a runtime
logger, or automatic instrumentation.

## 2. Architectural Boundary

Execution Trace is Research Artifact Provenance. It is not:

- DSH Runtime tracing;
- Harness Runtime tracing;
- Agent Runtime tracing;
- LLM token, prompt, model, or reasoning tracing;
- a Workflow Engine or general execution log;
- a Memory replacement.

The dependency boundary is:

```text
Workflow Executor ─┐
Skill Adapter     ─┼─> Artifact Builder ─> Trace Event Factory ─> TraceStore
Evaluation        ─┘
```

The Trace layer accepts neutral artifact references and governance metadata.
It does not import DSH, Harness, Agent Runtime, Workflow, Skill, or Plugin
implementation types.

## 3. Artifact References

Trace uses an independent open `artifactType` string so it can trace the
current Artifact Core types and the existing Workflow ResearchReport without
changing the Artifact Core union.

Known values are:

```text
evidence | thesis | prediction | review | research_report
```

An `ArtifactReference` identifies an artifact by stable ID, type, and logical
version. The reference does not embed the artifact payload.

## 4. Event Protocol

The protocol is append-only. Each event is immutable once accepted by a
TraceStore. Corrections are represented by a later event rather than mutation.

Required event types:

- `artifact_created`: an Artifact version was created;
- `artifact_updated`: a new version superseded an earlier version;
- `artifact_derived`: an Artifact was produced from source Artifacts;
- `artifact_linked`: an explicit relationship was added;
- `artifact_validated`: a governance or quality validation result was recorded.

Every event contains:

- `protocolVersion`;
- `eventId`;
- `eventType`;
- `timestamp`;
- `artifactReference`;
- `sourceArtifacts`;
- `relations`;
- `metadata`;
- no runtime log payload.

The MVP has no runtime metadata field. A consumer must be able to reconstruct
Artifact provenance without any Runtime information.

## 5. Lineage Relations

The minimum relation vocabulary is:

| Relation | Meaning |
| --- | --- |
| `derived_from` | target Artifact was produced from the source Artifact |
| `supports` | source Evidence supports a claim or derived Artifact |
| `contains` | a container Artifact includes the referenced Artifact |
| `supersedes` | a newer Artifact version replaces an earlier version |

Canonical flow:

```text
Evidence
   │ supports / derived_from
   ▼
Thesis
   │ derived_from
   ▼
Prediction
   │ contains / derived_from
   ▼
ResearchReport
```

The protocol does not infer relationships from text. Builders or future
adapters must emit explicit relations using stable IDs.

## 6. Governance Metadata

Required governance metadata is intentionally small:

```text
createdAt   : ISO timestamp
createdBy   : neutral producer identifier
skillId     : optional Skill asset identifier
workflowId  : optional Workflow identifier
version     : logical Artifact version
```

The MVP intentionally omits runtime context from the event shape. Runtime
details are never required for lineage queries and must not contain prompts,
token counts, hidden reasoning, or model transcripts.

## 7. Lifecycle and Revision

Artifacts are immutable records from the Trace perspective. A revision creates
a new logical version:

```text
Thesis v1
  └─ artifact_updated / artifact_derived
       └─ Thesis v2
            └─ supersedes Thesis v1
```

An update must preserve the old version's history. A `supersedes` relation is
explicit so consumers can distinguish revision from ordinary support or
containment.

## 8. TraceStore Abstraction

The protocol is implemented with the following synchronous interface for the
MVP:

```text
TraceStore
├── append(event): void
├── queryByArtifact(artifactId): TraceEvent[]
├── queryLineage(artifactId): TraceLineage
└── getHistory(artifactId): TraceEvent[]
```

The MVP uses memory only. Future implementations may use a local file,
database, or remote service while preserving event order, event identity, and
immutable event payloads.

## 9. Integration Design

### Workflow Executor

After a Workflow step receives a validated Artifact Bundle, it may ask an
Artifact Builder to create `artifact_created` and `artifact_derived` events.
The Workflow remains responsible for SOP order and context passing; it does
not become a trace engine.

### Skill Adapter

When a Skill returns structured Evidence, Thesis, or Prediction output, the
adapter may provide neutral producer metadata such as `skillId`. It does not
record prompts, model messages, or token usage.

### Artifact Builder

The builder is the preferred event boundary because it knows the Artifact ID,
type, version, and explicit upstream references. It can emit lifecycle events
without changing the existing Artifact payload or serialization contract.

## 10. Validation Scenarios

### Company Research

The Company Research Skill creates an Artifact. Trace records
`artifact_created`, `createdBy`, optional `skillId`, and the source Evidence
relations.

### Equity Research Thesis

The Thesis creation event references Evidence IDs through `supports` or
`derived_from` relations. A lineage query can show every Evidence item that
supports the Thesis without reading prompt or runtime logs.

### ResearchReport

The ResearchReport creation event uses `contains` relations for Thesis,
Prediction, Valuation, and other included assets. `research_report` is a Trace
type even though the current Artifact Core union remains unchanged.

### Runtime Migration

Another Runtime can create the same neutral events using the same Artifact
Builder and TraceStore interfaces. No DSH or Harness type is required.

## 11. Non-Goals

This design does not implement:

- TraceStore persistence;
- database schema or retention;
- runtime logs;
- LLM monitoring;
- token tracking;
- prompt logging;
- autonomous provenance inference;
- Memory integration.
