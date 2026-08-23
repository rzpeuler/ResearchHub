# Research Memory Framework

## Purpose

Research Memory stores structured research assets that must survive the lifetime of a Harness Session. It stores research outputs, not chat transcripts, and provides the persistence boundary for future retrieval and evaluation workflows.

This MVP implements the Memory layer described by ResearchHub Architecture v0.2. It does not introduce a new Agent loop, runtime, database, vector index, graph database, or RAG system.

## Architecture

```text
Session
  |
  +--> Thesis / Prediction Artifact
          |
          v
    ArtifactMemoryAdapter
          |
          v
    MemoryProvider
          |
          v
    LocalJsonMemoryProvider --> local JSON file
```

The Agent and Skill layers produce artifacts. The adapter translates supported artifacts into the common `MemoryEntry` contract. Providers own storage and retrieval; callers do not access the storage file directly.

## Memory Entry

The MVP supports two memory types: `thesis` and `prediction`.

| Field | Meaning |
| --- | --- |
| `id` | Stable memory identifier. Adapter IDs are `memory:<type>:<artifact-id>`. |
| `type` | `thesis` or `prediction`. |
| `content` | Validated serialized artifact JSON. |
| `sourceArtifactId` | ID of the originating artifact. |
| `createdAt` | Artifact creation timestamp. |
| `metadata` | JSON-safe metadata, including `sessionId` and `artifactType`. |

The contract is exposed through `MemoryProvider.save()`, `retrieve()`, and `update()`. Identity fields are immutable during update; only `content` and `metadata` can change.

## Artifact Memory Adapter

`ArtifactMemoryAdapter` supports `Thesis` and `Prediction` only:

1. Validate and serialize the artifact using the existing Artifact Framework.
2. Round-trip the serialized content through the corresponding deserializer.
3. Create a deterministic `MemoryEntry`.
4. Persist through the injected `MemoryProvider`.

`Evidence` is intentionally not persisted by this MVP adapter. The framework can add additional artifact mappings without changing the provider contract.

## Storage Strategy

`LocalJsonMemoryProvider` is the MVP provider. It receives a caller-provided JSON file path and:

- creates the parent directory and file on first access;
- persists a JSON array of validated entries;
- supports exact filtering by ID, type, source artifact ID, and `metadata.sessionId`;
- rejects duplicate IDs and unknown update IDs;
- returns defensive copies;
- serializes updates through an atomic temporary-file replacement;
- coordinates same-path provider instances with an in-process queue.

No external database or new dependency is introduced. Cross-process locking is intentionally deferred.

## Lifecycle

```text
Create Session
  -> produce Evidence / Thesis / Prediction
  -> save Thesis / Prediction to Memory
  -> retrieve by ID, artifact ID, type, or session ID
  -> update mutable content or metadata
```

The MVP does not implement Memory ranking, semantic search, expiration, evaluation, or outcome reconciliation.

## Future Evolution

Future work may add Review artifact persistence, Prediction → Outcome → Evaluation updates, richer query/index abstractions, a SQLite or vector-backed provider after a separate architecture decision, Memory retrieval tools through Harness capabilities, and cross-process locking.

Any change to the provider contract or storage direction must be recorded in the project Decision Log before implementation.

## Validation

Focused tests cover schema validation, serialization, save/retrieve/update, persistence across provider instances, same-process concurrent providers, Artifact mapping, Session metadata, duplicate handling, and adversarial serialization input. The complete repository test command includes these Memory tests.
