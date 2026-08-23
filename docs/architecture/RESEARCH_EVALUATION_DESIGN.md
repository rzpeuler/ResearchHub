# Research Evaluation Framework

## Purpose

Research Evaluation closes the objective research loop by comparing a Prediction with a caller-supplied Outcome and storing the resulting Review Artifact. It records whether a prediction was met; it does not judge an Agent, change an investment strategy, rank stocks, execute trades, or fetch real market data.

## Architecture Position

```text
Prediction Artifact
        |
        +--> Outcome (observed result)
                    |
                    v
             EvaluationEngine
                    |
                    v
              Review Artifact
                    |
                    v
             ReviewMemoryAdapter
                    |
                    v
              Research Memory
```

The engine is pure with respect to external state. It receives validated objects, performs deterministic comparison, and returns a new Review. Memory remains a storage boundary and does not perform evaluation.

## Outcome Model

`Outcome` is a JSON-safe observed result:

| Field | Meaning |
| --- | --- |
| `description` | Human-readable description of what was observed. |
| `timestamp` | ISO 8601 observation timestamp. |
| `source` | Caller-provided source reference. |
| `metrics` | JSON object containing actual observed values. |

The MVP does not connect to行情 APIs, backtest data, or external data providers. The caller is responsible for supplying the observation.

## Evaluation Algorithm

The engine compares only metric keys present in both `Prediction.metrics` and `Outcome.metrics`:

- Numeric values match when `abs(actual - expected) <= numericTolerance`.
- The default numeric tolerance is `0`.
- Strings, booleans, nulls and nested JSON values use deterministic deep equality.
- Empty or whitespace-only metric names are rejected.
- No shared metric keys produce `inconclusive`.

The result status is derived only from counts:

| Result | Status |
| --- | --- |
| 0 compared metrics | `inconclusive` |
| all compared metrics match | `met` |
| some, but not all, match | `partially_met` |
| none match | `not_met` |

The output includes each compared metric's expected value, actual value, match flag and numeric tolerance when applicable.

## Review Artifact

Review is now a first-class Artifact type alongside Evidence, Thesis and Prediction:

```ts
type Review = ArtifactBase<'review'> & {
  predictionId: string
  outcome: Outcome
  evaluation: EvaluationSummary
}
```

It preserves the source Prediction ID, the observed Outcome, the objective Evaluation Summary, the originating Session ID, and the Review creation timestamp. It is an immutable record of a completed evaluation; it does not contain strategy mutation instructions.

## Memory Relationship

`ReviewMemoryAdapter` stores a validated Review through the existing `MemoryProvider`:

- Memory ID: `memory:review:<review.id>`
- Memory type: `review`
- Source Artifact ID: `review.id`
- Content: validated serialized Review JSON
- Metadata: `sessionId` and `artifactType: review`

Existing Thesis and Prediction Memory mappings remain unchanged. A Review can be retrieved by Memory ID, source Artifact ID, type or Session ID.

## Lifecycle

1. Research creates a Prediction linked to a Thesis.
2. A later caller records an Outcome.
3. `EvaluationEngine` compares the two structures.
4. The engine creates a Review linked to the Prediction and Session.
5. `ReviewMemoryAdapter` optionally persists the Review.
6. Future research can retrieve the Review as structured historical evidence.

The MVP does not implement outcome collection, review scheduling, strategy optimization, automatic self-correction, or semantic Memory retrieval.

## Validation

Tests cover all four evaluation statuses, numeric tolerance, deep equality, invalid inputs, null configuration boundaries, input immutability, Review serialization, Session linkage, deterministic Memory IDs, duplicate handling and Local JSON persistence. Existing Capability, Artifact, Skill, Harness and Memory tests remain part of the repository validation command.

## Future Evolution

Future work may add richer metric operators, explicit review scheduling, external Outcome providers, Review retrieval tools, evaluation analytics and Prediction → Outcome → Evaluation history views. Any change from objective comparison to strategy adaptation requires a separate architecture decision and ADR.
