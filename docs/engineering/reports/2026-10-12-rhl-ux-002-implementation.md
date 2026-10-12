# RHL-UX-002 — Realtime Agent Interaction Implementation Report

- Status: `IMPLEMENTED; E2E-06 BLOCKED / CTO ARCHITECTURE DECISION REQUIRED`
- Baseline: `origin/main` at `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe` (accepted UX-001).
- Branch: `codex/ux-002-realtime-agent-interaction`.
- Contract: [Realtime Agent Interaction Contract](../specs/2026-10-12-rhl-ux-002-realtime-agent-interaction.md).
- Browser and test evidence: [RHL-UX-002 Acceptance Evidence](../../../tests/validation/evidence/RHL-UX-002-ACCEPTANCE-001.md).

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
| E2E-06 concurrent session switching | **BLOCKED.** See section E. Current Pi session replacement aborts and disposes the outgoing Agent session, so A cannot continue emitting Agent events while B is selected. |
| E2E-07 Workflow route | PASS. Company Research resolved fixture symbol `002640` to `跨境通`; Activity/run linkage and the title were visible. The controlled Workflow set `writeKnowledge:false`. |
| E2E-08 lost response, rejection, retry, cancellation | PASS for these cases. After a successful Workflow dispatch whose HTTP response was dropped, the Activity timeline returned to `运行中` with run `e3c220cd-224c-42fe-a2e5-79f671bb204e`; the fixture recorded exactly one start. Pre-acceptance rejection kept the message and retryable error; retry reused operation `fef4e25d-3d12-4c31-903d-dfe1b9e89fa9` and started exactly one run (`05521fdd-53f9-414f-972e-9d8b30814c42`). Browser cancellation of run `19c4eb1f-20f0-4944-bfa7-658c25518028` was confirmed as `cancelled` by the Runtime. |

The isolated Knowledge Base snapshot was `f7e5732f12e885f6676180d80624985568d3caee882963d00588b3f361c21c3a` both before and after these Workflow/cancellation operations. All fixture runs were released; the fixture shut down with its temporary root removed and the test browser tab closed.

## D. Performance measurement

Thirty real browser submit-to-accessibility-tree observation samples were collected in a prior E2E run. Observations in milliseconds:

```text
925, 3188, 3336, 3321, 3307, 3336, 3312, 3313, 3358, 3320,
3316, 3298, 3358, 3327, 3272, 3323, 3369, 3283, 3340, 3264,
3322, 3325, 3309, 3317, 3357, 3334, 3301, 3283, 3312, 3332
```

The sample includes CUA action transport and accessibility-tree extraction; it is not a direct browser paint or local React render timer. It does not establish the `P95 ≤ 100 ms` target. That target remains **unverified**; the observed automation measurement is retained as a coarse upper bound only.

## E. Blocker and remaining limits

`E2E-06` conflicts with the current single-active-Pi-session lifecycle. `ResearchHubSessionRuntime.switchConversation()` delegates to the one `PiAgentSessionRuntime.switchSession()`. The installed Pi `AgentSessionRuntime.switchSession()` tears down the current runtime before creating the selected session; its session teardown aborts and disposes the outgoing `AgentSession`. Therefore a running Agent in conversation A cannot continue streaming while B is selected. Fixing this would require an explicit architecture decision about multiple concurrent Pi `AgentSessionRuntime` instances and their resource/model/service lifecycle. The current task forbids adding a separate Agent runtime or changing the host architecture; no such change was made and E2E-06 is not claimed as passed.

SSE has no durable replay log. A tool start/finish fully missed during an outage cannot be reconstructed unless available in current authoritative state. Workflow runs are queried from `WorkflowService`; no historical tool trace or hidden reasoning is invented.

## F. Validation and regression

| Command | Result |
|---|---|
| `npm run typecheck -- --pretty false` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS, 182 modules. Vite reports the existing >500 kB chunk-size advisory (built JS 656.85 kB). |
| `npm run client:test` | PASS, 9 files / 137 tests. |
| Focused Runtime + UX-001 regression suite (`conversation-state-store`, slices A/B/C, lifecycle integration) | PASS, 74/74. |
| `npm test` | Client PASS, 137/137. Node suite: 2,212 passed, 21 failed (2,233 total). |
| Clean baseline Node suite at `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe` | 2,207 passed, the same 21 failed (2,228 total). Failure blocks were normalized for checkout paths and elapsed durations; both had SHA-256 `6aac6d657258a8d80ff30e70fa9ca541c7cc5bc58f0e1763081be38278666d9c`. UX-002 adds five passing Node tests and no new Node failures. |
| `git diff --check` | PASS. |

Full Node outputs used in comparison: `%TEMP%\ux002-node-final.txt` and `%TEMP%\ux002-node-baseline.txt`. The 21 baseline failures include Research Skill architecture (1), Theme Workspace projection (6), Competition Module Gateway (12), remaining Schema delta (1), and FIX-015 generated Schema size (1; observed 6,881 vs expected 6,359 on both). The UX-002 changes do not touch those test paths or their production dependencies.

## G. Git delivery

The implementation/evidence commit `15a86836b62c493bc6fca6df049edd548106b4d5` was pushed to `origin/codex/ux-002-realtime-agent-interaction`; fetch, local ref, and `git ls-remote` matched that SHA. A final documentation-only closure commit records the delivery result; its SHA and the post-push clean worktree check are included in the completion message. No PR merge or UX-003 work was performed; `origin/main` remains the UX-001 baseline.
