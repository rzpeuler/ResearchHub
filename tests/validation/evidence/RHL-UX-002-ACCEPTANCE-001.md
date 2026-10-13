# RHL-UX-002 Acceptance Evidence

- Status: `DECISION_IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Baseline: `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe`
- Branch: `codex/ux-002-realtime-agent-interaction`
- Report: [RHL-UX-002 Implementation Report](../../../docs/engineering/reports/2026-10-12-rhl-ux-002-implementation.md)
- Contract: [Realtime Agent Interaction Contract](../../../docs/engineering/specs/2026-10-12-rhl-ux-002-realtime-agent-interaction.md)
- Architecture decision: [RHL-UX-002-ADR-001](../../../docs/architecture/RHL-UX-002-ADR-001.md)

## Browser environment

Microsoft Edge browser (headless via DevTools Protocol for E2E-06-R and performance capture), production Vite build served from `dist/client` by `ResearchHubRuntimeServer`, persistent Pi SessionManager, faux provider with model network disabled, fresh isolated Schema 0.4 Knowledge Base, and controlled Company Research Workflow. The proxy independently dropped one accepted dispatch response and interrupted SSE. No mounted user Knowledge Base or authenticated provider was used.

## Current-turn response-loss recovery

1. Armed `lose-next-dispatch-response` in the isolated fixture and submitted `RHL UX-002 lost dispatch response retry check 002640` from the browser with Company Research selected.
2. Fixture logged `WORKFLOW_STARTED` for `e3c220cd-224c-42fe-a2e5-79f671bb204e` and `DISPATCH_RESPONSE_DROPPED 202`; `snapshot` contained one start only.
3. The browser timeline changed to `工作流 · 运行中 · workflow_started`, showed that run ID, and showed no stale runtime-failure alert.
4. Armed `reject-next-accept` and submitted another message. Runtime rejected it before acceptance; the browser retained the input and displayed a retryable error.
5. Retried without changing the text. The retry row retained operation ID `fef4e25d-3d12-4c31-903d-dfe1b9e89fa9`. The fixture logged one Workflow start for that request: `05521fdd-53f9-414f-972e-9d8b30814c42`.
6. Cancelled the third controlled Workflow run from the browser. The Workflow panel displayed `cancelled`, confirmed by the Runtime view.
7. Fixture Knowledge SHA-256 remained `f7e5732f12e885f6676180d80624985568d3caee882963d00588b3f361c21c3a`; all fixture runs were released, fixture temp root removed, and test browser tab closed.

## Cross-scenario E2E results

E2E-01/02/03/04/05/07 were exercised earlier in this same UX-002 implementation run with the production Client and real Runtime; their methodology and observed results are summarized in the implementation report. E2E-05 recovered a 100-segment response after SSE destruction/503 and displayed ordered text exactly once. E2E-08 response loss, pre-acceptance rejection/retry, and Workflow cancellation were re-executed in the browser this turn as documented above.

## E2E-06-R — Single-Active-Session Isolation

Environment: headless Microsoft Edge 155 via DevTools Protocol, production Client build, `ResearchHubRuntimeServer` HTTP/SSE, persistent Pi SessionManager, isolated Knowledge Base, faux provider and no model network.

1. Sent `UX002 E2E-06-R A running session isolation` into Conversation A. The browser showed `生成中` and the accepted Activity `运行中`, backed by the actual Pi `agent_start` lifecycle.
2. Switched to a new Conversation B while A was executing. The fixture observed A's Pi `session.abort()` begin at `2026-10-12T12:50:18.391Z`, return at `.431Z`, and `session.dispose()` at `.431Z`; B's new Pi session completed setup at `.439Z`. A's Pi conversation ID was `01a13028-57e3-71b6-b464-310791c3e7f2`; the new session ID was `01a13029-f496-71b6-b464-3108274fae88`.
3. B's timeline remained the empty-conversation view with `Idle`, no A text, tools, or alert. A's abort terminal event occurred during the switch; the selected B view remained unchanged. The session pill reported the EventSource as `disconnected` after replacement, with no stale A state or false running label. The connection-state transition was not traced to a root cause in this task; E2E-05 separately covers reconnect and snapshot recovery.
4. Returned to A. Its authoritative Transcript showed the original prompt once; the Activity restored the terminal state `已取消 · chat_cancelled`. One matching user row remained, zero optimistic duplicates remained, no alert was shown, and A was not presented as running.
5. No second Pi request was issued. No Knowledge mutation occurred.

## Workflow independence after Pi switch

In a separate Conversation B, submitted Company Research for `002640` / `跨境通`. Fixture evidence recorded `writeKnowledge:false` and run `4501d7c1-61c9-4edf-bceb-71912c71ee79`. The Runtime returned `running` after switching the Pi session from B back to A. Releasing the controlled Workflow completed the same run with status `completed`. The isolated Knowledge Base SHA-256 remained `4c71625ce231857ba4e48bd995c11025d51ff92c2833106e4256bd28e2c70bf9` throughout the E2E-06-R and Workflow checks.

## Browser-internal performance evidence

100 samples were recorded in Microsoft Edge 155.0.4283.45 against the production React build. Timing starts at the capturing Send click handler and ends after two `requestAnimationFrame` callbacks following the matching Pending row. CUA transport and accessibility-tree extraction are excluded. See the raw series and full method in [RHL-UX-002-PERFORMANCE-001.json](RHL-UX-002-PERFORMANCE-001.json).

| Samples | P50 | P95 | P99 | Instrumentation overhead P95 / max | Result |
|---:|---:|---:|---:|---:|---|
| 100 | 13.8 ms | 17.2 ms | 18.2 ms | 0.5 / 0.6 ms | PASS, P95 ≤100 ms |

Percentiles use nearest rank (`sorted[ceil(p*n)-1]`). Handler plus observer instrumentation cost is under 1 ms per sample and below 10% of P50, so instrumentation did not materially affect the measured result at this precision.

## Full suite baseline comparison

- Final ADR-001: client 137/137 pass; Node 2,212 pass / 21 fail / 2,233 total.
- Clean baseline `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe`: Node 2,207 pass / 21 fail / 2,228 total.
- Normalized failure blocks match exactly (same test names, assertion values, source locations, and stacks); baseline, prior UX-002, and final ADR-001 SHA-256 `659ee4940ba47f8faed46683a9a35812d0771b43173bba87c0509ebadec68766`. The change adds five passing Node tests and no new Node failures.
- Final root TypeScript check, Client TypeScript check, production Client build, and `git diff --check`: PASS. Client build contains 182 modules and the existing >500 kB advisory (JS 656.85 kB).
