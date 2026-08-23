# ResearchHub Research Evaluation Framework MVP

## Status

Approved design for RH-DESIGN-003. This specification defines the minimum deterministic review loop without real data access, trading, strategy optimization, or Harness Core changes.

## Goal

Add the missing `Prediction → Outcome → Evaluation → Review → Memory` loop. The Evaluation layer compares a previously created Prediction with caller-supplied actual observations and produces a structured Review Artifact.

Evaluation is an objective comparison boundary. It does not rank stocks, execute trades, alter strategies, or evaluate whether an DSH is intelligent.

## Chosen Approach

Use a deterministic same-key metric comparison:

- `Prediction.metrics` contains expected metric values.
- `Outcome.metrics` contains actual observed metric values.
- Only keys present in both objects are compared.
- Numeric values use a configured absolute tolerance, defaulting to `0`.
- Strings, booleans, nulls and nested JSON values use deterministic deep equality.
- Missing or non-overlapping metrics are not silently treated as failures.

Evaluation status is derived from compared metrics:

| Condition | Status |
| --- | --- |
| No comparable metrics | `inconclusive` |
| All comparable metrics match | `met` |
| Some but not all comparable metrics match | `partially_met` |
| No comparable metrics match | `not_met` |

This keeps the MVP objective and extensible without embedding investment logic in Review or Memory.

## Data Model

### Outcome

`Outcome` is a plain JSON-safe value representing an observed result:

```ts
type Outcome = {
  description: string
  timestamp: string
  source: string
  metrics: JsonObject
}
```

The caller supplies the observation. The MVP does not fetch or verify external data.

### Evaluation Summary

```ts
type EvaluationStatus = 'met' | 'partially_met' | 'not_met' | 'inconclusive'

type MetricEvaluation = {
  name: string
  expected: JsonValue
  actual: JsonValue
  matched: boolean
  tolerance?: number
}

type EvaluationSummary = {
  status: EvaluationStatus
  comparedMetricCount: number
  matchedMetricCount: number
  metrics: MetricEvaluation[]
}
```

### Review Artifact

Review extends the existing ArtifactBase contract:

```ts
type Review = ArtifactBase<'review'> & {
  predictionId: string
  outcome: Outcome
  evaluation: EvaluationSummary
}
```

The Review preserves the source Prediction reference, actual Outcome, evaluation result, Session ID and creation timestamp. It is a record of what happened, not a strategy update.

## Package Boundaries

```text
packages/artifacts/review/
  review.ts             # Review type, factory, validation, serialization

packages/evaluation/
  core/                 # EvaluationEngine and evaluation types
  outcome/              # Outcome type, factory and validation
  review/               # Review creation boundary

packages/memory/adapters/
  review-memory-adapter.ts
```

- Artifact Review owns the persisted research object and JSON contract.
- Outcome owns observed-result validation.
- Evaluation Engine owns comparison and status derivation.
- Review assembly combines Prediction, Outcome and Evaluation into a Review Artifact.
- Review Memory Adapter persists Review through the existing `MemoryPlugin` interface.

No component accesses Harness Core or external data sources.

## Evaluation Flow

1. Receive a validated Prediction and caller-supplied Outcome.
2. Confirm the Outcome timestamp is valid; do not require it to be inside the Prediction period because late review is a valid future workflow.
3. Compare same-key metrics using the configured numeric tolerance.
4. Derive the objective status from match counts.
5. Create and validate a Review Artifact linked by `predictionId` and `sessionId`.
6. Optionally persist the Review through `ReviewMemoryAdapter`.

The engine is pure with respect to external state. It returns a new Review and does not mutate the Prediction, Outcome, Memory, or strategy configuration.

## Memory Integration

Extend the existing Memory Entry type union with `review`. `ReviewMemoryAdapter` serializes a validated Review into:

- `id`: `memory:review:<review.id>`
- `type`: `review`
- `sourceArtifactId`: `review.id`
- `createdAt`: `review.createdAt`
- `metadata.sessionId`: `review.sessionId`
- `metadata.artifactType`: `review`
- `content`: validated serialized Review JSON

Existing Thesis and Prediction mappings remain unchanged. Memory stores the Review result; it does not run evaluation or modify the source Prediction.

## Validation and Tests

Tests must prove:

- Review creation, validation, serialization and Session linkage.
- Outcome validation and JSON-safe metrics.
- `met`, `partially_met`, `not_met` and `inconclusive` status derivation.
- Numeric tolerance and deterministic deep equality.
- Prediction → Outcome → Evaluation → Review object flow.
- Review persistence and retrieval through a Local JSON Memory Plugin.
- Existing Artifact, Memory and Harness integration suites remain green.

## Explicit Non-Goals

- Real market or financial data access.
- Backtesting or trading execution.
- Stock ranking or investment recommendation.
- DSH self-modification or strategy optimization.
- Vector search, graph storage, RAG or external databases.
- Harness Core changes.
