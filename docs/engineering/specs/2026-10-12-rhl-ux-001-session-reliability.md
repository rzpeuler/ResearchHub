# RHL-UX-001 — Session Reliability and History Contract

- Task: `RHL-UX-001`
- Status: Implemented; final delivery evidence is recorded in the companion report.
- Baseline: `origin/main` at `8a7f49d43a01aefd23b72c5103481ad5bdac51aa`.
- Implementation branch: `codex/ux-001-session-reliability`.
- Governing plan: [ResearchHub UX Upgrade Plan](../plans/rhl-ux-upgrade-plan.md).

## Scope and ownership

Pi `AgentSessionRuntime` and its `SessionManager` remain the only transcript and Pi-session authority. UX-001 adds a small Runtime-owned metadata/activity sidecar at `runtime-data/conversation-state`; it does not copy transcript messages into another database and does not add Knowledge Schema fields. The sidecar records title state, archive state, accepted request activity, and Workflow association. Its writes are atomically replaced and serialized per conversation within one Runtime process.

Pi's public session APIs expose session names and session-info records, but do not expose an atomic compare-and-set API for arbitrary product metadata. The sidecar therefore owns versioned title/archive/operation state. Pi session names remain useful safe display metadata, while Runtime conversation APIs resolve the authoritative title from the sidecar.

## Persisted state

Each conversation record is versioned and binds to the exact case-sensitive Pi conversation ID. It stores:

- `title`, `titleSource` (`DEFAULT`, `FIRST_MESSAGE`, `WORKFLOW`, `USER`), title-attempt flags, and a monotonically increasing revision;
- archive flag and timestamp, creation/update times, and accepted request activity;
- request text, operation ID/digest, immutable caller-selected Workflow ID, resolved Workflow ID, reserved/started Workflow run ID, subject/display candidate, lifecycle, and start/finish timestamps;
- `piTranscriptObserved`, which prevents a deleted Pi transcript from being silently recreated under a stale sidecar identity.

The separate `active-conversation.pointer` persists the selected ID across Runtime restart. Startup restores it only when the matching Pi transcript exists or when a valid sidecar-only Workflow conversation is eligible for recovery. Otherwise Runtime keeps the Pi-selected session and rewrites the pointer to that safe current session.

Accepted request text is exposed as typed conversation activity rather than represented as a fabricated Pi transcript message. A request is durably accepted before a dispatch can start. Pi remains the authority for actual chat transcript messages.

## Naming and concurrency rules

Title priority is `USER > WORKFLOW > FIRST_MESSAGE > DEFAULT`.

1. A new empty session displays `新对话`.
2. The first accepted request attempts one immediate first-message title without an LLM call. Whitespace is collapsed; up to 24 grapheme clusters are shown, with an ellipsis on truncation. Credential-like or PII-like text uses the safe fallback `新对话`.
3. A successfully started Workflow consumes the one Workflow naming opportunity. When structured subject and localized registry label are available, Runtime proposes `{subject} · {localized Workflow name}`. Unverified subjects are not inferred from free text. A request intent or a not-started/needs-input dispatch does not consume this opportunity.
4. A manual rename sets source `USER`; this lock is permanent, including when the chosen title is `新对话`.
5. Mutations include an expected revision. Stale title/archive edits fail with conflict rather than overwriting newer state.

Title credential and PII detection is a defensive heuristic, not a general-purpose sensitive-data classifier. The accepted request activity remains user-provided content and is not rewritten by title screening.

## Request idempotency and Workflow recovery

Clients create an operation ID and retain only the operation ID and payload digest in the session-scoped retry ledger. The server stores the accepted request and compares duplicate IDs against the original text and immutable caller-selected Workflow intent. Automatic routing may record a resolved Workflow ID without changing the original accepted intent.

Only one `accepted → submitting` claim can dispatch an operation. A stable reserved Workflow run ID is persisted before dispatch. Retries replay the recorded outcome or reconcile that reserved run; they do not start a second Workflow. A start/association ambiguity is never reported as active after restart: the association and run ID remain available, while the volatile Workflow status is marked interrupted. In-process Workflow status remains owned by the existing Workflow service.

## HTTP contract

The Runtime extends its existing HTTP JSON interface:

| Route | Contract |
|---|---|
| `GET /api/conversations?archived=0|1&search=...` | Server-backed list, archive filter, bounded title search, activity ordering. |
| `GET /api/conversations/current` | Current Pi session state with sidecar-authoritative title. |
| `GET /api/conversations/messages` | Current Pi transcript snapshot plus typed activities for its conversation. |
| `POST /api/conversations/requests/accept` | Idempotently records accepted user request activity and first-message naming. |
| `GET /api/conversations/:id/activities` | Accepted request and Workflow activity for one validated conversation. |
| `PATCH /api/conversations/:id/metadata` | Version-guarded user rename (`name`, `expectedVersion`). |
| `POST /api/conversations/:id/archive` / `restore` | Version-guarded archive state transition. |
| Existing `POST /api/conversations/new` / `switch` | Pi-owned session create/switch with persistent active selection. |
| Existing `POST /api/research/dispatch` | Requires accepted conversation/operation association before Workflow dispatch. |

These routes preserve the Runtime's existing loopback security and JSON conventions. No WebSocket, event bus, Redis, or independent Agent Runtime is introduced.

## UI behavior

The existing React shell renders the server conversation list and current server summary. History supports search, archive/restore, rename, and switch. The current heading remains stable when a search filter hides the active row. Switching retains the current view until the server switch succeeds, and generation guards prevent stale overlapping refreshes from replacing newer state. Workflow request acceptance and association are reflected from server activity rather than a client-only history entry.

## Explicit boundaries

- Runtime restart restores the selected conversation, Pi transcript, durable title/archive/activity, and Workflow association. A process-local Workflow's live execution status is not reconstructed; an ambiguous or previously started run is represented as interrupted after restart.
- The acceptance integration uses the real ResearchHub Runtime HTTP server, persistent Pi session manager, and isolated temporary Knowledge Base. It injects a faux Pi provider and a controlled Workflow service; it is not authenticated external-provider E2E.
- Knowledge mutation behavior, Workflow business algorithms, Pi SDK internals, SSE replay, and UX-002/003/004 are outside this task.
