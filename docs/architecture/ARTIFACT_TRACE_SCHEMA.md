# Artifact Trace Schema Design

**Status:** MVP implemented
**Protocol:** Artifact Trace Protocol v0.1

## 1. Primitive Types

```text
ArtifactType = string

KnownArtifactType =
  | "evidence"
  | "thesis"
  | "prediction"
  | "review"
  | "research_report"

TraceEventType =
  | "artifact_created"
  | "artifact_updated"
  | "artifact_derived"
  | "artifact_linked"
  | "artifact_validated"

LineageRelationType =
  | "derived_from"
  | "supports"
  | "contains"
  | "supersedes"
```

`ArtifactType` remains open for future research asset types. Consumers should
recognize the known values and preserve unknown values for forward
compatibility.

## 2. Artifact Reference

```json
{
  "artifactId": "thesis-001",
  "artifactType": "thesis",
  "version": 1
}
```

Rules:

- `artifactId` is a stable non-empty identifier;
- `artifactType` is a non-empty type string;
- `version` is a positive logical version number;
- the reference contains no Artifact payload.

## 3. Lineage Relation

```json
{
  "relationType": "supports",
  "from": {
    "artifactId": "evidence-001",
    "artifactType": "evidence",
    "version": 1
  },
  "to": {
    "artifactId": "thesis-001",
    "artifactType": "thesis",
    "version": 1
  }
}
```

`from` is the source and `to` is the primary event Artifact or target. The
direction is explicit so a consumer does not need to infer meaning from an
unordered ID list.

## 4. Trace Metadata

```json
{
  "createdAt": "2026-08-24T00:00:00.000Z",
  "createdBy": "skill:equity-research",
  "skillId": "equity-research",
  "workflowId": "equity-research",
  "version": 1
}
```

`createdBy` is a neutral producer identifier, not a Runtime identity.
`skillId` and `workflowId` are optional because Evidence can be created by a
Plugin or another caller. `version` must match the primary Artifact reference.

## 5. Trace Event

```json
{
  "protocolVersion": "0.1",
  "eventId": "trace-event-001",
  "eventType": "artifact_derived",
  "timestamp": "2026-08-24T00:00:00.000Z",
  "artifactReference": {
    "artifactId": "thesis-001",
    "artifactType": "thesis",
    "version": 1
  },
  "sourceArtifacts": [
    {
      "artifactId": "evidence-001",
      "artifactType": "evidence",
      "version": 1
    },
    {
      "artifactId": "evidence-002",
      "artifactType": "evidence",
      "version": 1
    }
  ],
  "relations": [
    {
      "relationType": "supports",
      "from": {
        "artifactId": "evidence-001",
        "artifactType": "evidence",
        "version": 1
      },
      "to": {
        "artifactId": "thesis-001",
        "artifactType": "thesis",
        "version": 1
      }
    }
  ],
  "metadata": {
    "createdAt": "2026-08-24T00:00:00.000Z",
    "createdBy": "skill:equity-research",
    "skillId": "equity-research",
    "workflowId": "equity-research",
    "version": 1
  },
}
```

The MVP intentionally has no runtime field. Prompts, messages, tokens,
chain-of-thought, and model execution logs are outside this protocol.

## 6. TraceStore Interface

```text
interface TraceStore {
  append(event: TraceEvent): void
  queryByArtifact(artifactId: string): TraceEvent[]
  queryLineage(artifactId: string): TraceLineage
  getHistory(artifactId: string): TraceEvent[]
}
```

This is a contract only. It does not prescribe a database, file format,
transport, retention policy, or consistency model beyond append-only event
identity and immutable event contents.

## 7. Example Event Sequence

```text
artifact_created Evidence E1
artifact_created Evidence E2
artifact_derived Thesis T1 from E1, E2
artifact_linked E1 supports T1
artifact_derived Prediction P1 from T1
artifact_derived ResearchReport R1 containing T1, P1
artifact_validated R1
artifact_updated T2
artifact_linked T2 supersedes T1
```
