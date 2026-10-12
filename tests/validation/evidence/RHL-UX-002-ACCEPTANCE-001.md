# RHL-UX-002 Acceptance Evidence

- Status: `IMPLEMENTED; E2E-06 BLOCKED / CTO ARCHITECTURE DECISION REQUIRED`
- Baseline: `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe`
- Branch: `codex/ux-002-realtime-agent-interaction`
- Report: [RHL-UX-002 Implementation Report](../../../docs/engineering/reports/2026-10-12-rhl-ux-002-implementation.md)
- Contract: [Realtime Agent Interaction Contract](../../../docs/engineering/specs/2026-10-12-rhl-ux-002-realtime-agent-interaction.md)

## Browser environment

Actual Edge browser, production Vite build served from `dist/client` by `ResearchHubRuntimeServer`, persistent Pi SessionManager, faux provider with model network disabled, fresh isolated Schema 0.4 Knowledge Base, and controlled Company Research Workflow. The proxy independently dropped one accepted dispatch response and interrupted SSE. No mounted user Knowledge Base or authenticated provider was used.

## Current-turn response-loss recovery

1. Armed `lose-next-dispatch-response` in the isolated fixture and submitted `RHL UX-002 lost dispatch response retry check 002640` from the browser with Company Research selected.
2. Fixture logged `WORKFLOW_STARTED` for `e3c220cd-224c-42fe-a2e5-79f671bb204e` and `DISPATCH_RESPONSE_DROPPED 202`; `snapshot` contained one start only.
3. The browser timeline changed to `工作流 · 运行中 · workflow_started`, showed that run ID, and showed no stale runtime-failure alert.
4. Armed `reject-next-accept` and submitted another message. Runtime rejected it before acceptance; the browser retained the input and displayed a retryable error.
5. Retried without changing the text. The retry row retained operation ID `fef4e25d-3d12-4c31-903d-dfe1b9e89fa9`. The fixture logged one Workflow start for that request: `05521fdd-53f9-414f-972e-9d8b30814c42`.
6. Cancelled the third controlled Workflow run from the browser. The Workflow panel displayed `cancelled`, confirmed by the Runtime view.
7. Fixture Knowledge SHA-256 remained `f7e5732f12e885f6676180d80624985568d3caee882963d00588b3f361c21c3a`; all fixture runs were released, fixture temp root removed, and test browser tab closed.

## Cross-scenario E2E results

E2E-01/02/03/04/05/07 were exercised earlier in this same UX-002 implementation run with the production Client and real Runtime; their methodology and observed results are summarized in the implementation report. E2E-05 recovered a 100-segment response after SSE destruction/503 and displayed ordered text exactly once. E2E-06 remains blocked by Pi session replacement behavior and is not counted as a pass. E2E-08 response loss, pre-acceptance rejection/retry, and Workflow cancellation were re-executed in the browser this turn as documented above.

## Performance sample caveat

Thirty browser submit-to-CUA-accessibility-observation samples are recorded in the implementation report. CUA transport and tree extraction are included in the measured duration, so this is not a browser paint/local-render metric. The 100 ms local feedback P95 target remains unverified.

## Full suite baseline comparison

- UX-002: client 137/137 pass; Node 2,212 pass / 21 fail / 2,233 total.
- Clean baseline `a5d02c8cd87c527db5a39c6e88ed49014ca6dafe`: Node 2,207 pass / 21 fail / 2,228 total.
- Normalized failure blocks match exactly (same test names, assertion values, source locations, and stacks); SHA-256 `6aac6d657258a8d80ff30e70fa9ca541c7cc5bc58f0e1763081be38278666d9c`.
