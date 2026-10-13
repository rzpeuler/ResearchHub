# RHL-WF-PERSIST-001 — Workflow Snapshot Recovery Contract

Status: Accepted for implementation review; additive recovery projection

## Decision

`WorkflowService` remains the only owner of live Workflow execution state. A
versioned file snapshot is a durable observation of its existing safe view; it
does not schedule, resume, or mutate a Workflow. `GET /api/workflows/:runId`
continues to serve both live and persisted observations.

The `interrupted` status is added as a recovery-only API projection. It is not a
status that a producer may set on a live run, and it is not equivalent to
`failed` or `cancelled`. The stored snapshot retains its last actual status of
`pending` or `running`; Runtime recovery projects that view as `interrupted`,
adds `recoveryState.lastObservedStatus`, and maps only still-running stages and
skills to `interrupted`. It does not invent a completion timestamp, duration,
result, or stage outcome. Completed runs retain their observed terminal status.

The additive view metadata is:

- `observationSource`: `live` or `historical`.
- `recoveryState`: present only for recovered pending/running snapshots.
- `historyPersistence`: `pending`, `saved`, `failed`, or `unavailable`, with
  an optional persisted revision and stable error code.

These fields describe the read/persistence path; they do not participate in
the Workflow execution state machine. Snapshot writes strip them from the
durable payload. A persistence failure is observable independently and never
changes the real Workflow result or authorizes repeating research or Knowledge
writes.

## Crash semantics

Only observations whose snapshot write completed are recoverable. An operating
system or process failure can occur after an external/provider/Knowledge action
but before its next observation is durable. In particular, if execution
finished but the terminal snapshot did not reach disk, recovery can only report
the last persisted pending/running view as interrupted; it cannot assert
completion or safely replay the operation.

Runtime startup reads snapshots without placing historical records into the
live `WorkflowService` map. This preserves one live authority and prevents
recovery from invoking Providers, Skills, dispatch, or Knowledge production.

## Compatibility

The status and metadata are additive fields on the existing Workflow view and
existing status endpoint. Clients must treat `interrupted` as terminal for
polling, render it distinctly, and must not present it as a live run. Existing
terminal statuses, result IDs, Bundle IDs, Report IDs, and Conversation–Run
associations are unchanged.

## Scope exclusions

No background scheduler, event bus, second Workflow state machine, automatic
resume, Knowledge schema change, or Pi lifecycle change is introduced.
