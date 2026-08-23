# RH-DESIGN-001 Research Artifact Framework Design

## Status

Approved for implementation.

## Objective

Establish the structural foundation for ResearchHub research artifacts so that future Event Analysis and Research Memory work can exchange typed, serializable, session-linked research results.

This design implements only the artifact model, runtime validation, serialization helpers and relationship references. It does not implement Event Analysis, Memory storage or investment evaluation.

## Scope and Boundaries

In scope:

- A reusable `ArtifactBase` contract.
- `Evidence`, `Thesis` and `Prediction` artifact types.
- Type-specific factory functions and runtime validators.
- JSON serialization and validated deserialization.
- Session and inter-artifact relationships represented by IDs.
- Unit tests for creation, validation, serialization and association.
- Architecture documentation and governance synchronization.

Out of scope:

- The `Review` artifact implementation; it remains a reserved Architecture v0.2 type for a later task.
- Event Analysis Skill implementation.
- Memory persistence or retrieval.
- Evaluation or investment decision logic.
- Real data sources, network access or external dependencies.
- Changes to DeepSeek Harness Core or frozen architecture documents.

## Architecture

The production package structure is:

```text
packages/artifacts/
├── core/
├── evidence/
├── thesis/
└── prediction/
```

The dependency direction is one-way:

```text
Session
  ↓ sessionId
Evidence
  ↓ evidenceIds
Thesis
  ↓ thesisId
Prediction
```

Artifacts are plain JSON-safe data objects. They do not own storage, runtime orchestration or domain reasoning.

## Core Contract

`ArtifactBase` contains:

- `id: string`
- `type: 'evidence' | 'thesis' | 'prediction'`
- `createdAt: string` in ISO 8601 format
- `sessionId: string`
- `metadata: JsonObject`

IDs and timestamps are supplied by the caller. This keeps creation deterministic, avoids a new UUID dependency and allows a future Session or persistence layer to own identity policy.

The core package provides:

- JSON-safe value types.
- Base and type-specific validation helpers.
- `ArtifactValidationError` with field-level context.
- `serializeArtifact()` and `deserializeArtifact()` with an explicit validator.

Factories return new plain objects and do not mutate their inputs. Serialization uses standard JSON and deserialization invokes the caller-supplied validator before returning the parsed value.

## Artifact Types

### Evidence

```ts
type Evidence = ArtifactBase<'evidence'> & {
  source: string
  content: string
  timestamp: string
  confidence: number
}
```

`confidence` is constrained to the inclusive range `[0, 1]`. `source`, `content`, IDs and timestamps must be non-empty and valid for their respective fields.

### Thesis

```ts
type Thesis = ArtifactBase<'thesis'> & {
  statement: string
  evidenceIds: string[]
  confidence: number
  risks: string[]
}
```

`evidenceIds` references Evidence artifacts by ID. The framework validates the reference format as non-empty strings but does not access storage to resolve them.

### Prediction

```ts
type Prediction = ArtifactBase<'prediction'> & {
  thesisId: string
  expectation: string
  evaluationPeriod: {
    start: string
    end: string
  }
  metrics: JsonObject
}
```

`thesisId` explicitly links a Prediction to its source Thesis. `evaluationPeriod` is structured so it can be validated and later evaluated without changing the artifact envelope. `metrics` stores JSON-safe target or measurement values and contains no evaluation behavior.

## Lifecycle

1. A session or caller assigns an artifact ID and ISO timestamp.
2. A type-specific factory creates a validated artifact.
3. The artifact is associated with the session through `sessionId`.
4. Thesis and Prediction store upstream references through `evidenceIds` and `thesisId`.
5. A future persistence or Memory adapter serializes the plain object.
6. A future evaluation process may read Prediction fields without changing this framework.

The framework does not enforce that referenced IDs already exist. Referential integrity belongs to the future repository or Memory layer, not to individual artifact constructors.

## Validation and Serialization

Runtime validators reject malformed or unsafe values, including:

- Missing or empty identity fields.
- Unsupported artifact types.
- Invalid ISO timestamps.
- Confidence values outside `[0, 1]`.
- Non-string relationship IDs.
- Non-JSON-safe metadata or metrics.
- Invalid evaluation period boundaries.

No external schema library is introduced. TypeScript contracts provide compile-time guidance, while explicit validators protect deserialized or external input at runtime.

## Test Design

Tests will prove:

1. Evidence, Thesis and Prediction can be created with the required fields.
2. Invalid artifact payloads fail schema validation.
3. Artifacts survive JSON serialization and validated deserialization.
4. All artifacts carry the same `sessionId`.
5. Thesis references Evidence IDs and Prediction references Thesis ID.
6. Existing Harness integration and Market Capability tests remain unaffected.

Tests use deterministic in-memory fixtures and do not call external services.

## Future Memory Integration

Future Memory work may persist serialized artifacts, index them by `sessionId`, `type` and relationship IDs, and append review or evaluation metadata. That integration must consume the public artifact contracts and must not move storage concerns into artifact types.

## Acceptance Criteria

- `packages/artifacts/core`, `evidence`, `thesis` and `prediction` exist.
- ArtifactBase and all three requested artifact types are typed and runtime-validatable.
- Serialization/deserialization is JSON-safe and tested.
- Session and artifact relationships are represented by IDs.
- No Event Analysis, Memory storage, evaluation logic or external data dependency is added.
- TypeScript and the complete existing test suite pass.
- Frozen Architecture v0.2 and Technical Design v0.1 files remain unchanged.
