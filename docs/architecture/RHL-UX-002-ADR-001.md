# RHL-UX-002-ADR-001 — Runtime Concurrency Boundary

- Status: `APPROVED`
- Approved: 2026-10-12
- Scope: RHL-UX-002 realtime Agent interaction

## Decision

Keep the existing single-active Pi `AgentSessionRuntime` model. Conversation switching continues to use the supported Pi session replacement lifecycle: abort the outgoing `AgentSession`, persist its terminal transcript state, dispose it, and then bind the selected session.

Do not add concurrent Pi runtimes, a background Agent manager, an Agent Orchestrator, a message queue/event center, or a new Pi SDK session-switch lifecycle in UX-002. Concurrent Pi sessions remain a separate future architecture upgrade.

An outgoing Pi Agent is not guaranteed to continue after its conversation is switched away. Workflow execution is an independent `WorkflowService` lifecycle and must not be cancelled by Pi session replacement.

## Revised acceptance contract

The former E2E-06 is replaced by **E2E-06-R — Single-Active-Session Isolation**. On the real Runtime and persistent Pi `SessionManager` path, it verifies a running Pi Agent in Conversation A, an A-to-B switch during execution, Pi abort/dispose, absence of A content/tool/error state in B including the event race during switching, restoration of A's authoritative Transcript and terminal Activity, no false running state, independent Workflow continuation, no duplicate request, and no unauthorized Knowledge mutation.

Browser performance acceptance uses at least 100 production-build browser-internal samples from the Send click handler to the Pending row paint boundary. It records P50/P95/P99, excludes CUA transport and accessibility-tree extraction, and measures test instrumentation overhead. The target is P95 ≤100 ms.

## Consequences

- Session replacement is intentionally a terminal boundary for the outgoing Pi Agent; the authoritative transcript/Activity reports its real abort outcome.
- Client state and events remain conversation-scoped. Late events from a non-active conversation cannot update the selected conversation view.
- Workflow status remains owned and queried through `WorkflowService`, independently of Pi session replacement.
- E2E-06-R, rather than concurrent Agent continuation, is the UX-002 acceptance requirement.

## Evidence

Implementation and runtime evidence are recorded in [the UX-002 implementation report](../engineering/reports/2026-10-12-rhl-ux-002-implementation.md) and [the UX-002 acceptance evidence](../../tests/validation/evidence/RHL-UX-002-ACCEPTANCE-001.md).
