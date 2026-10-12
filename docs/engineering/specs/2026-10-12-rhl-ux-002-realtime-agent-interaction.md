# RHL-UX-002 — Realtime Agent Interaction Contract

- Task: `RHL-UX-002`
- Status: `DECISION IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Base: `origin/main` at `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe` (UX-001 accepted merge)
- Branch: `codex/ux-002-realtime-agent-interaction`
- Governing architecture: [Application Runtime v0.1](../../architecture/application-runtime-v0.1.md) and [UX upgrade plan](../plans/rhl-ux-upgrade-plan.md)

## Ownership and boundaries

- The Client owns optimistic presentation and transient per-conversation stream state. It does not declare a request accepted until the Runtime response or authoritative snapshot confirms it.
- Runtime HTTP owns request acceptance, the `conversationId`/`operationId` association, safe SSE projection, and current-session snapshots.
- Pi `SessionManager` remains the transcript authority. Its public `SessionEntry.id` is the stable identity for a persisted message; no ID is synthesized from text, time, array position, or SSE arrival order.
- The UX-001 conversation sidecar remains authoritative for accepted request Activity and its operation identity. When Runtime can prove a Pi SessionEntry is the user message for an operation, the sidecar records that entry ID to permit exact Activity/Transcript reconciliation.
- Pi owns Agent execution events and tool lifecycle events. `WorkflowService` remains authoritative for Workflow status; Workflow requests are not represented as Pi Agent output.
- SSE remains transient. The Runtime does not persist or replay an event journal. Native EventSource reconnect is followed by snapshot reconciliation.

## Runtime concurrency boundary (RHL-UX-002-ADR-001)

- The current product constraint is one active Pi `AgentSessionRuntime`.
- Switching away from a conversation invokes Pi's supported abort and dispose lifecycle for its outgoing Agent session. That Agent is not guaranteed to continue after the switch.
- The outgoing conversation's Transcript and Activity remain authoritative and restore its actual terminal state when selected again. B must not show A's stream, tools, errors, or running state; conversation identity guards late A events.
- Workflow execution is independent of the active Pi Session and must continue when the Pi session changes. Pi abort and Workflow cancel remain distinct operations.
- Concurrent Pi sessions, a background Agent manager, an Agent Orchestrator, a message queue/event center, and changes to Pi's session-switch lifecycle are outside UX-002 and require a future architecture upgrade.
- **E2E-06-R — Single-Active-Session Isolation** replaces the former E2E-06 requirement. It is an acceptance scenario for the real `ResearchHubRuntimeServer` and persistent Pi `SessionManager` path.

## Request state and retry contract

| UI state | Evidence |
|---|---|
| `local_pending` | Local submit action created a stable operation ID and optimistic row. |
| `accepting` | The Client sent the accepted-request operation; no server acceptance has yet been confirmed. |
| `accepted` | Runtime accepted the request and returned the same conversation and operation IDs, or the matching sidecar Activity appeared in a snapshot. |
| `dispatching` | Accepted request is being routed by the Runtime; this is a Client phase label, not a Workflow run state. |
| `running` | A matching Pi Agent-start event or authoritative Workflow status reports an active run. |
| `completed`, `failed`, `interrupted`, `cancelled` | Pi, WorkflowService, or the persisted sidecar reports the matching terminal outcome. A lost connection alone never creates a terminal state. |

Retry reuses the same `operationId` while acceptance is ambiguous and the payload digest is unchanged. The Runtime's idempotent accept/dispatch/command path is the duplicate-execution shield. Once an operation is authoritatively terminal, a fresh user submission receives a new operation ID even if the text is identical.

## Message and event identity

The reconciliation keys are:

```text
Conversation ID + Operation ID + Activity ID + verified Pi SessionEntry ID
```

Optimistic content becomes a persisted Activity by exact `operationId`. A Pi user message is considered the same request only when its `messageId` equals the `piMessageId` recorded for that Activity. Same-text requests with different operation IDs remain distinct. If Runtime cannot prove the SessionEntry association, both records remain independently visible and the UI does not guess.

Normalized SSE event IDs are deduplication cursors for the current Runtime process, not durable replay guarantees. Per-conversation event sequence and operation identity guard stale, duplicate, or inactive-session callbacks. No raw Pi event object crosses the adapter boundary.

## SSE reconnect and snapshot reconciliation

On EventSource error the Client retains current visible text, tool summaries, and local request rows, then shows a reconnecting state. EventSource performs its native retry. On every successful `open`, Client fetches the authoritative current session, messages, Activities, conversation list, and—when an Activity has a run ID—the current WorkflowService view. A response applies only if its conversation and refresh generation still match the selected view.

Snapshots replace persisted messages and Activities by their stable identities, reconcile optimistic rows by `operationId`, and restore live state only from authoritative `SessionState.isStreaming` or WorkflowService. Missed text is recovered from the current Pi snapshot where available. Missed tool lifecycle events are not fabricated; when their completed lifecycle cannot be reconstructed, the UI leaves it absent/unknown.

## Safe streaming and tools

- Visible text is derived only from Pi `text_delta` events and safe final transcript messages. Thinking events map to a constant status label; hidden reasoning content is never emitted.
- Tool summaries use the existing allowlist and sanitized tool identifier. Raw arguments, results, credentials, paths, environment values, and stack traces are never sent to Client events.
- Each delta is bounded without truncating legitimate chunks to the default short-summary limit. Redaction is preserved across delta boundaries so a split credential cannot leak as multiple individually harmless fragments.
- Tool start/completion time is based on Runtime receipt of the corresponding Pi lifecycle event. Missing starts or finishes remain unknown; no duration is inferred from page load or UI order.
- Agent elapsed time begins on the actual normalized Pi `agent.started` event. If a reconnect snapshot says an Agent is active but has no authoritative start time, elapsed time is shown as unknown.

## Cancellation and failure

Client network errors, Runtime rejection, Agent error/abort, Tool failure, Workflow dispatch failure, SSE interruption, and user cancellation remain distinct. Client disconnect does not abort server execution. A cancellation request is not rendered as `cancelled` until Pi or WorkflowService confirms termination. Retry is exposed only through the original operation identity while acceptance is unresolved; an authoritative started Workflow is never relaunched as a retry.

## Verification contract

Unit and Runtime tests cover operation/message identity, same-text independent requests, event allowlisting and delta projection, status transitions, delayed acceptance, preflight failure, Pi/Tool outcomes, lost responses, abort/cancel, SSE reconnect snapshot recovery, duplicate/out-of-order events, and cross-conversation isolation. Browser acceptance uses the production Client build and real Runtime HTTP/SSE with isolated Knowledge and faux provider/tool services. Faux-provider evidence is explicitly not authenticated-provider E2E.

Browser performance evidence must contain at least 100 valid browser-internal Send-to-Pending-paint samples against the production Client build, with P50/P95/P99, a stated percentile method, and instrumentation overhead. CUA transport and accessibility-tree extraction are excluded. Acceptance target: P95 ≤100 ms.
