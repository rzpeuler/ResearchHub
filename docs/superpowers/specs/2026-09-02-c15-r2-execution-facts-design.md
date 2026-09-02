# C15-R2 Execution Facts Design

## Problem

The ingestion Workflow already records whether Reference Resolution was
reached, but a post-resolution exception prevents `curate()` from returning
its trace. The top-level `blocked()` path then rebuilds empty resolution and
reconciliation summaries. This can produce `referenceResolutionReached=true`
with fabricated zero counts.

## Decision

Maintain a small runtime-neutral execution-facts object for the lifetime of
`execute()`:

```ts
interface IngestionExecutionFacts {
  referenceResolutionReached: boolean;
  referenceResolution: ResolutionSummary | null;
  reconciliationPlanningReached: boolean;
  reconciliationGroups: number | null;
}
```

The Workflow snapshots the deterministic resolution summary immediately after
all resolution decisions have been formed, then sets
`referenceResolutionReached`. It snapshots the precise reconciliation group
count immediately after the group collection has been formed, then sets
`reconciliationPlanningReached`. Later failures cannot overwrite these facts.

`blocked()` receives the same facts. It preserves an observed resolution
summary and an observed group count; before a stage is reached it retains the
existing public zero-value compatibility shape while exposing the explicit
reachability fact for downstream evidence.

The public ingestion result adds `reconciliationPlanningReached`. R9 boundary
evidence uses this flag: an unreached Reference Resolution emits `not_reached`
with nullable resolution and group facts; a reached Reference Resolution with
unobserved reconciliation planning emits `reached_and_failed` with
`reconciliationGroups=null`; an observed zero group count remains numeric zero.
C14 PASS requires both planning reachability and the four existing zero-call /
zero-existing-reference invariants.

## Boundaries and invariants

- Extraction-stage failures keep `referenceResolutionReached=false`.
- Reconciliation and schema-gap failures after the relevant snapshots preserve
  the actual resolution counts and, when formed, the actual group count.
- Validation and Writer failures continue to use the existing trace-derived
  result path and preserve real summaries.
- No C15 adapter, C9 retry policy, C13/C14 semantics, Schema/Storage, Writer,
  batching, token, reasoning, provider, or real-run behavior changes.
- Historical R9-R2 evidence files remain byte-for-byte unchanged.

## Verification

Deterministic Workflow-level tests cover extraction failure, reconciliation
failure after an existing-reference resolution, schema-gap failure, and the
existing validation/Writer behavior. R9 helper tests cover not-reached,
reached-but-unobserved planning, observed zero planning, and reached failure.
No real LLM, DeepSeek, or R9-R3 execution is part of this change.
