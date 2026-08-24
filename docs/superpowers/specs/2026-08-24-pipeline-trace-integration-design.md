# Pipeline Trace Integration Design

**Task:** PIPELINE-TRACE-INTEGRATION-001
**Status:** Approved design
**Date:** 2026-08-24

## Goal

Make the Equity Research Workflow emit Artifact Trace events by default while
keeping the Artifact Core model, Skills, Plugins, DSH, and Harness unchanged.
Each Workflow instance owns an isolated in-memory TraceStore.

## Chosen Approach

`EquityResearchWorkflow` will create a `TraceArtifactBuilder` with a new
`InMemoryTraceStore` unless a caller supplies a custom `TraceStore` through the
existing Workflow options object. The Workflow exposes its store for read-only
inspection by integration tests and callers that need provenance queries.

This preserves compatibility: existing constructors continue to work, no
caller needs to manually emit events, and separate Workflow instances cannot
pollute one another's trace history.

## Data Flow

```text
Skill output
    |
    v
EquityResearchWorkflow assembly
    |
    v
TraceArtifactBuilder
    |
    +--> Artifact Core constructor
    |
    +--> InMemoryTraceStore
```

The final graph is:

```text
ResearchReport
  contains Thesis
    supports Evidence
  contains Prediction
    derived_from Thesis
```

## Integration Points

1. Skill-created Company Evidence is recorded as `artifact_created` when the
   Workflow assembles the final bundle. The Skill implementation is not
   changed.
2. Workflow-created Evidence uses `TraceArtifactBuilder.createEvidence` and
   records `artifact_created` with provider/Skill metadata.
3. The final Thesis uses `createThesis` and records `artifact_derived` with
   explicit Evidence references and `supports` relations.
4. The final Prediction uses `createPrediction` and records
   `artifact_derived` with a `derived_from` Thesis relation.
5. The plain Workflow ResearchReport is registered with
   `linkResearchReport`, using the canonical ID
   `report:equity-research:<sessionId>` so it matches the default
   ResearchManager report view ID.

## Isolation and Compatibility

- The default Store is per Workflow instance, not process-global.
- A supplied Store remains supported for callers that need custom inspection
  or future persistence adapters.
- Artifact Core payloads and serialization remain unchanged.
- Workflow definitions, Skill prompts, Plugin interfaces, DSH, Harness,
  Memory, and Evaluation are not modified.
- Trace is provenance metadata only; it does not become a scheduler or runtime
  logger.

## Failure Handling

Trace events are appended only after the corresponding Artifact Core constructor
validates successfully. If assembly fails, no later Artifact or report-link
event is emitted. The existing Workflow error and step-state behavior remains
unchanged.

## Validation

Add a deterministic Mock Pipeline integration test that:

- runs the Equity Research Workflow for `600519`;
- verifies Evidence, Thesis, Prediction, and ResearchReport outputs;
- queries the Workflow's TraceStore by the canonical report ID;
- verifies `contains`, `supports`, and `derived_from` relations;
- confirms a second Workflow instance has an empty independent Store;
- runs with the existing Workflow, Skill, Plugin, Artifact, and integration
  test suites.

## Alternatives Rejected

- Global Trace Hook in core Artifact constructors: too implicit and risks
  changing unrelated Artifact producers.
- DSH/ResearchManager instrumentation: violates the Artifact Governance
  boundary and the task's no-DSH-change constraint.
