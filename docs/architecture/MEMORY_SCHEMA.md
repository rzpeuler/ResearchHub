# Research Knowledge Memory Schema

> **Legacy compatibility schema — superseded by ARCH-REFACTOR-003.** Existing
> MemoryItem records remain supported; future durable knowledge contracts
> belong to the Knowledge Layer.

**Protocol:** Research Knowledge Memory v0.1
**Status:** MVP implemented

## 1. Type Vocabulary

```text
MemoryItemType =
  | "entity"
  | "thesis"
  | "prediction"
  | "evidence"
  | "review"
```

The vocabulary is extensible, but new types must represent reusable Research
Knowledge rather than Runtime state.

## 2. Artifact Reference

Memory reuses the neutral Artifact Trace reference shape:

```json
{
  "artifactId": "thesis-001",
  "artifactType": "thesis",
  "version": 1
}
```

The reference contains identity and version only. It does not embed the
Artifact payload or duplicate Trace Events.

## 3. MemoryItem

```json
{
  "id": "memory:thesis:600519:2026-08-24:001",
  "type": "thesis",
  "content": {
    "statement": "Operating margin remains resilient under the base case.",
    "claims": ["margin resilience"]
  },
  "sourceArtifacts": [
    {
      "artifactId": "thesis-001",
      "artifactType": "thesis",
      "version": 1
    }
  ],
  "traceReferences": [
    {
      "eventId": "trace-event-001",
      "rootArtifactId": "thesis-001"
    }
  ],
  "entity": "600519",
  "topic": "profitability",
  "industry": "beverages",
  "confidence": 0.82,
  "createdAt": "2026-08-24T00:00:00.000Z",
  "metadata": {
    "sessionId": "session-001"
  }
}
```

Normative fields:

```text
id               stable Memory identity
type             MemoryItemType
content          JSON-safe structured knowledge payload
sourceArtifacts  one or more Artifact References
traceReferences  Trace event IDs or enriched references, not copied Trace data
entity           optional normalized entity key
topic            optional normalized topic key
industry         optional industry key
confidence       normalized 0..1 knowledge confidence
createdAt        creation timestamp
metadata         bounded retrieval and session metadata
```

`updatedAt`, `version`, and lifecycle status may be added by a future schema
revision. They are not required to replace the immutable source Artifact.

## 4. Prediction Validation Extension

A Prediction Memory item may include a review projection in `content` or
bounded metadata:

```json
{
  "predictionArtifactId": "prediction-001",
  "evaluationStatus": "met",
  "accuracy": 1,
  "evaluatedAt": "2027-02-25T00:00:00.000Z",
  "reviewArtifactId": "review-001"
}
```

The original Prediction Artifact remains unchanged. A later evaluation creates
an updated Memory projection or a linked Review Memory item.

## 5. Compatibility with MemoryEntry

The existing `MemoryEntry` remains valid for the current MVP:

```text
MemoryEntry
  id
  type: thesis | prediction | review
  content: serialized Artifact
  sourceArtifactId
  createdAt
  metadata
```

An adapter can map a `MemoryEntry` to a `MemoryItem` with one
`sourceArtifacts` reference. No existing serialized Memory file needs to be
rewritten by this architecture design.

## 6. Governance Constraints

Memory content must not contain:

- prompts;
- hidden reasoning or chain-of-thought;
- model token usage;
- Runtime logs;
- Agent session transcripts.
