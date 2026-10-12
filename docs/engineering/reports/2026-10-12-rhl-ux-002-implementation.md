# RHL-UX-002 — Realtime Agent Interaction Implementation Report

- Status: `DECISION IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Baseline: `origin/main` at `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe` (accepted UX-001).
- Branch: `codex/ux-002-realtime-agent-interaction`.
- Contract: [Realtime Agent Interaction Contract](../specs/2026-10-12-rhl-ux-002-realtime-agent-interaction.md).
- Browser and test evidence: [RHL-UX-002 Acceptance Evidence](../../../tests/validation/evidence/RHL-UX-002-ACCEPTANCE-001.md).
- Architecture decision: [RHL-UX-002-ADR-001 — Runtime Concurrency Boundary](../../architecture/RHL-UX-002-ADR-001.md).

## A. Architecture and event contract

- Pi `SessionManager` remains the only transcript authority. Runtime correlates a persisted Pi `SessionEntry.id` with the exact accepted request Activity when the relationship is observable; it does not infer identity from text, time, order, or an SSE cursor.
- Runtime owns request acceptance, `conversationId`/`operationId` associations, safe event projection, and recovery snapshots. Workflow request status comes from `WorkflowService`; Agent and tool lifecycle status comes from Pi-normalized events. Optimistic submit state and per-conversation partial stream text are transient Client state.
- The Client preserves optimistic rows until a matching server Activity or transcript identity reconciles them. Ambiguous retries retain the same operation ID. When dispatch response delivery fails, the Client queries the exact operation Activity and its Workflow run; it changes state only if Runtime confirms `workflow_started` and the Workflow lookup confirms the same run ID.
- SSE remains transient. Native EventSource reconnect is followed by a fresh current-session, transcript, Activity, conversation-list, and current-Workflow snapshot. The implementation does not add a durable event journal. A tool lifecycle event missed while disconnected is not reconstructed from guesses.

## B. Implemented behavior

- Pending user request appears before asynchronous acceptance/dispatch and shows submission/acceptance/dispatch/running/terminal state with error recovery.
- Agent status, elapsed time, safe streamed text, and allowlisted tool summaries are maintained per conversation. Tool duration is shown only when a real start and completion event exist.
- SSE event IDs and conversation/operation identity suppress repeated and stale updates. Snapshot reconciliation restores authoritative transcript, Activity, session, and Workflow state after reconnect.
- Workflow-only user requests stay typed Activities rather than fabricated Pi messages. Pi transcript messages remain separate unless a verified Pi message ID binds them to the Activity.
- Pi abort and Workflow cancel remain separate actions; UI cancellation is terminal only after the corresponding Runtime source confirms it.
- Runtime event projection bounds/redacts streaming output and omits thinking text, raw tool arguments/results, secrets, environment values, paths, and stack traces.

## C. Browser E2E evidence

Production React build, actual `ResearchHubRuntimeServer` HTTP/SSE, persistent Pi SessionManager, isolated Schema 0.4 Knowledge Base, faux Pi provider with model network disabled, and controlled Workflow adapter were used. This is isolated/faux-provider browser evidence, not authenticated provider E2E.

| Scenario | Result and evidence |
|---|---|
| E2E-01 immediate submit | PASS. The real browser rendered the optimistic request while the Runtime acceptance was held. Original text remained visible. |
| E2E-02 delayed acceptance | PASS. With the acceptance gate held, the UI retained a pending/submitting row; after release it reconciled to the server Activity and actual run state. |
| E2E-03 streaming | PASS. Multi-segment Pi output appeared in order and reconciled with final transcript without duplicate user rows. |
| E2E-04 tool | PASS. `researchhub_status` rendered as a safe completed tool summary with measured lifecycle duration; raw tool result was not rendered. |
| E2E-05 SSE interruption | PASS. Destroyed active SSE connections and returned 503 during a 100-segment faux response. The browser reconnected, restored the authoritative completed Activity, and displayed each segment once in order. No missed tool lifecycle was fabricated. |
| E2E-06-R single-active-session isolation | **PASS.** Headless Microsoft Edge browser, production Client, `ResearchHubRuntimeServer`, persistent Pi `SessionManager`, and faux Pi provider. Conversation A started a real Pi Agent run and showed `生成中`; while it was active, switching to B invoked A's `session.abort()` begin/end and `session.dispose()` before the new Pi session completed. B remained empty/idle with no A text, tool state, or error. Returning to A restored its Transcript and Activity as `已取消 · chat_cancelled`; its user request appeared once, no optimistic duplicate remained, and the session was not falsely shown as running. A's abort completion arrived during the switch while B was selected; the active B view remained isolated. See acceptance evidence for conversation IDs and lifecycle timestamps. |
| E2E-07 Workflow route | PASS. Company Research resolved fixture symbol `002640` to `跨境通`; Activity/run linkage and the title were visible. The controlled Workflow set `writeKnowledge:false`. |
| E2E-08 lost response, rejection, retry, cancellation | PASS for these cases. After a successful Workflow dispatch whose HTTP response was dropped, the Activity timeline returned to `运行中` with run `e3c220cd-224c-42fe-a2e5-79f671bb204e`; the fixture recorded exactly one start. Pre-acceptance rejection kept the message and retryable error; retry reused operation `fef4e25d-3d12-4c31-903d-dfe1b9e89fa9` and started exactly one run (`05521fdd-53f9-414f-972e-9d8b30814c42`). Browser cancellation of run `19c4eb1f-20f0-4944-bfa7-658c25518028` was confirmed as `cancelled` by the Runtime. |

The isolated Knowledge Base snapshot was `f7e5732f12e885f6676180d80624985568d3caee882963d00588b3f361c21c3a` both before and after these Workflow/cancellation operations. All fixture runs were released; the fixture shut down with its temporary root removed and the test browser tab closed.

## D. Browser-internal performance measurement

The final run used 100 sequential Send actions in Microsoft Edge 155.0.4283.45 against the production Vite build served by the real Runtime. A test-only script injected by the isolated browser fixture timestamped the capturing Send click handler with `performance.now()`, identified the matching `.optimistic-request` row through a `MutationObserver`, and stopped after two `requestAnimationFrame` callbacks. This records the browser paint boundary without CUA transport or accessibility-tree extraction. Raw samples are in [RHL-UX-002 Performance Evidence](../../../tests/validation/evidence/RHL-UX-002-PERFORMANCE-001.json).

Nearest-rank statistics (`sorted[ceil(p*n)-1]`):

| Samples | P50 | P95 | P99 | Min / Max | Target |
|---:|---:|---:|---:|---:|---|
| 100 | 13.8 ms | 17.2 ms | 18.2 ms | 9.8 / 21.1 ms | PASS, P95 ≤100 ms |

Instrumentation cost was measured inside its own event-handler and observer callbacks: P50 0.3 ms, P95 0.5 ms, P99/max 0.6 ms. The P95 overhead is about 3.6% of the measured P50 and remains below one millisecond, so it did not materially change the result at the reported resolution. CUA transport timings are excluded from this result.

## E. Runtime boundary and remaining limits

CTO decision [RHL-UX-002-ADR-001](../../architecture/RHL-UX-002-ADR-001.md) approves the current single-active Pi `AgentSessionRuntime` model. Session switching invokes Pi's supported abort/dispose lifecycle; the outgoing Agent is not guaranteed to continue. Workflow remains independent and must not be cancelled by a Pi session switch. Multiple concurrent Pi sessions and background Agent orchestration are future, separate architecture work and are outside UX-002.

In the same real Runtime fixture, Company Research run `4501d7c1-61c9-4edf-bceb-71912c71ee79` remained `running` after switching from its conversation to A, then completed when the fixture released it. The fixture explicitly recorded `writeKnowledge:false`; the isolated Knowledge Base SHA-256 remained `4c71625ce231857ba4e48bd995c11025d51ff92c2833106e4256bd28e2c70bf9` before and after. No duplicate Pi request or unauthorized Knowledge write was observed.

SSE remains transient and has no durable replay journal. A tool start/finish fully missed during an outage cannot be reconstructed unless it remains in current authoritative state. Workflow runs are queried from `WorkflowService`; no historical tool trace or hidden reasoning is invented. This is an existing protocol limit, not a UX-002 architecture blocker.

## F. Blockers and remaining limits

No architecture decision remains open for UX-002. Faux-provider browser acceptance is isolated local evidence, not authenticated-provider E2E. The measured performance result is specific to the tested headless Edge/browser and local fixture environment. In E2E-06-R the session pill showed `disconnected` after Pi session replacement; the views and transcript stayed correctly isolated, but the connection-state transition was not traced to a root cause in this task. E2E-05 separately verified reconnect and snapshot recovery.

## G. Validation and regression

| Command | Result |
|---|---|
| `npm run typecheck -- --pretty false` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS, 182 modules. Vite reports the existing >500 kB chunk-size advisory (built JS 656.85 kB). |
| `npm run client:test` (through `npm test`) | PASS, 9 files / 137 tests. |
| Earlier focused Runtime + UX-001 regression suite (`conversation-state-store`, slices A/B/C, lifecycle integration) | PASS, 74/74. The final full Node suite below includes these tests. |
| `npm run test:node` (final ADR-001 regression) | 2,212 passed, 21 failed (2,233 total). |
| Clean baseline Node suite at `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe` | 2,207 passed, the same 21 failed (2,228 total). After normalizing checkout paths and elapsed durations, baseline, prior UX-002, and final failure blocks have identical SHA-256 `659ee4940ba47f8faed46683a9a35812d0771b43173bba87c0509ebadec68766`. UX-002 adds five passing Node tests and no new Node failures. |
| `git diff --check` | PASS. |

Full Node outputs used in comparison: `%TEMP%\ux002-node-adr001-final.txt`, `%TEMP%\ux002-node-final.txt`, and `%TEMP%\ux002-node-baseline.txt`. The 21 baseline failures include Research Skill architecture (1), Theme Workspace projection (6), Competition Module Gateway (12), remaining Schema delta (1), and FIX-015 generated Schema size (1; observed 6,881 vs expected 6,359 on both). The UX-002 changes do not touch those test paths or their production dependencies.

## H. Git delivery

The ADR-001 implementation, performance evidence, and regression result are committed on this branch. The delivery commit was pushed to `origin/codex/ux-002-realtime-agent-interaction`; local HEAD and the fetched remote branch were verified equal, and the worktree was clean at closeout. No PR merge or UX-003 work was performed; `origin/main` remains the UX-001 baseline.
