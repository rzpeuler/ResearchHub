# RHL-UX-003 — Workflow Progress & Observability Implementation Report

- Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Branch: `codex/ux-003-workflow-observability`
- Baseline: `origin/main` at `2594fe01b4f282bfb4680c21c9135d3b05ffc3a4`, which contains the accepted UX-002 line.
- Contract: [Workflow Observation Contract](../specs/2026-10-12-rhl-ux-003-workflow-observation-contract.md).
- Browser evidence: [UX-003 browser E2E evidence](../../../tests/validation/evidence/ux003-browser-e2e-evidence.json).
- Acceptance supplement: [RHL-UX-003-ACCEPTANCE-FIX-001](2026-10-12-rhl-ux-003-acceptance-fix-001.md).

## A. Git baseline

The UX-003 worktree was based on the latest fetched `origin/main`; its baseline SHA is above. The accepted UX-002 commit `c6c96785a18598ac5f00a9e1b8b344f37f2acaa6` is an ancestor of this baseline. All implementation changes are isolated to the UX-003 branch. This report does not merge `main` or start UX-004.

## B. Workflow observation architecture

`WorkflowService` remains the only live run-state authority. Stage, Provider, Skill, safe diagnostics, result projection, and `observationRevision` are fields on the existing `WorkflowRunView`; the implementation adds no scheduler, event bus, secondary progress store, or new transport. The existing `GET /api/workflows/:runId` and polling path serve snapshots. The Client ignores older revisions and preserves the last trusted snapshot during a transient read failure.

The Company Research stages are emitted at actual execution boundaries. Other Workflow registrations receive only their existing overall state and timestamps. Stage count is never converted to a percentage. Detailed in-memory history does not survive Runtime restart; the durable Conversation association and accepted Activity are recovered as interrupted, without claiming the old run resumed.

## C. Workflow capability matrix

| Workflow ID | Trusted display name | Fine-grained observations in this change | Shared status, timing, result references |
| --- | --- | --- | --- |
| `company_research` | 公司深度研究 | Real stages, acquisition Provider results, Company Research synthesis Skill | Yes |
| `industry_research` | 行业深度研究 | No synthetic stage or Provider/Skill detail added | Yes |
| `theme_framework` | 主题框架 | No synthetic stages; existing candidate and acceptance semantics retained | Yes |
| `earnings_review` | 财报复盘 | No fine-grained observations added | Yes |
| `valuation` | 估值分析 | No fine-grained observations added | Yes |
| `event_research` | 事件研究 | No fine-grained observations added | Yes |
| `thesis_red_team` | 投资命题压力测试 | No fine-grained observations added | Yes |
| `thesis_lifecycle` | 投资命题生命周期 | No fine-grained observations added | Yes |
| `daily_intelligence` | 每日投研简报 | No fine-grained observations added | Yes |

All labels are registry metadata and do not change internal IDs. A missing localized label falls back to the existing safe registry label.

## D. Implemented Runtime changes

- `WorkflowRunView` carries producer-emitted stages, Provider observations, Skill observations, and a monotonic per-run observation revision.
- Company Research emits identity validation, data acquisition, research synthesis, quality gate, Knowledge Gateway, report generation, and report persistence boundaries. The Knowledge Gateway stage reflects the actual authorized submission or explicit no-write decision.
- Repeated, out-of-order, late, and post-terminal observations cannot reopen terminal state. Active stages and Skills close at the Workflow terminal timestamp. Invalid or reversed durations are omitted rather than represented as zero.
- A durable accepted-request Activity is reconciled after its dispatch completion settles by reading terminal status from `WorkflowService`. The ledger retains the verified Run/registry association, maps completed-with-review to a completed request outcome, distinguishes blocked/failed/cancelled, records `finishedAt`, and stops the Activity timer.
- A reserved Run ID is shown as interrupted only after Runtime recovery marks the request interrupted. A live submission reservation is not promoted to a confirmed run. If a Workflow already reached a terminal state before restart, the accepted-request ledger retains that state; the Client shows the terminal outcome and states that detailed stages are unavailable.

## E. Provider and Skill observability

Only allowlisted Company Research acquisition Providers (`akshare`, `cninfo`, `gdelt`) are projected. Status is derived from actual attempts and usable returned data. Counts are emitted only for countable external records. Since acquisition requirements run concurrently, timing spans the earliest Provider attempt start through the latest completion, not summed CPU time. Provider outcome snapshots currently publish after acquisition completes; per-attempt live progress is not implemented.

`company_research_synthesis` brackets the actual CompanyResearchSkill call and identifies the reasoning-executor result or its existing deterministic evidence-bounded fallback. Pi Agent tool lifecycle remains a separate Activity channel. Raw Provider bodies, tool arguments/results, credentials, hidden reasoning, local paths, and stacks are excluded from the browser snapshot. Diagnostics are stable codes; arbitrary error text is reduced to a safe generic summary.

## F. Frontend progress center

The Client presents registry-backed Workflow names, verified subject identity/code, status, actual elapsed time, emitted stages and durations, Provider/Skill summaries, bounded diagnostics, cancellation state, and verified report/Bundle/review links. No stage percentage is displayed. Refresh and conversation return query the live Runtime's authoritative run. An interrupted run after restart is explicit and offers no false running state. Existing ownership checks remain the source for result links.

## G. Browser E2E evidence

The evidence uses the production Vite Client in Microsoft Edge against an actual `ResearchHubRuntimeServer`, `WorkflowService`, persistent Pi `SessionManager`, an isolated Schema 0.4 Knowledge Base, and offline faux providers. It verifies wiring and state presentation, not live-source quality. The JSON artifact records exact run/conversation/operation IDs, API state, DOM evidence, Runtime restart process ownership, and Knowledge Base digest/revision. Only scenarios listed as passing there count as passed; earlier selector-reset attempts are explicitly marked invalid.

The evidence covers E2E-01 through E2E-09 across selected Company Research runs: startup and subject identity; all seven real stages and durations; mixed Provider outcomes; refresh recovery; conversation isolation while A continued running; cancellation and blocked terminal outcomes; verified report and Bundle navigation; and Runtime restart interruption without false running. Separate valid attempts are explicitly identified in the evidence JSON; earlier selector-reset attempts remain labeled invalid. The UX-002 Pi session-switch check also observed abort/dispose/replacement and a successful new-session event stream. The valid restart path retained Knowledge Base revision 0 and SHA-256 `ccb04b78e3712d0988c1b23453a5b81fac40eb5a98b1594a526c8c7c5c3a5865`.

| Taskbook E2E | Evidence observation | Result |
| --- | --- | --- |
| E2E-01, E2E-02, E2E-03, E2E-04, E2E-08 | `UX003-SELECTED-COMPANY-REFRESH-MIXED-PROVIDER-REPORT-BUNDLE-a748b2cc` | Selected Company Research, subject, actual stage timestamps/durations, provider outcomes, and matching report/Bundle links observed. Provider diagnostic payload predates the fix noted below. |
| E2E-05 | `UX003-SELECTED-COMPANY-REFRESH-MIXED-PROVIDER-REPORT-BUNDLE-a748b2cc` | Same run and active stage restored after browser reload. |
| E2E-06 | `UX003-E2E06-SELECTED-WORKFLOW-CONVERSATION-ISOLATION-d5d94881` | A remained running while B was active and isolated; returning to A restored its run. |
| E2E-07 | `UX003-E2E07-SELECTED-WORKFLOW-CANCEL-d5d94881`, `UX003-E2E07-SELECTED-WORKFLOW-BLOCKED-3e59026e` | Selected cancellation and selected blocked terminal state observed with accepted Activity reconciliation. |
| E2E-09 | `UX003-EXPLICIT-WORKFLOW-RESTART-e7fb9d5a` | Runtime restart recovered the accepted association as interrupted, with no false running state. |
| Acceptance FIX-A | `UX003-ACCEPTANCE-FIX-001-FIX-A-UNSUPPORTED-BROWSER-1b485d21` | Real DataResolver attempts returned `UNSUPPORTED`; API and refreshed Edge DOM showed AKShare `skipped` with only `PROVIDER_UNSUPPORTED`; Workflow completed from available faux GDELT evidence. |

The earlier mixed-provider browser run preceded the diagnostic classification fix and recorded false `PROVIDER_ATTEMPT_FAILED` codes for unsupported AKShare operations. Its original data is preserved as historical evidence; the later Acceptance FIX-A browser observation verifies the corrected behavior.

These E2E paths use the isolated offline faux-provider fixture and establish Runtime/UI wiring, not authenticated Provider availability or live market-data quality. The historical invalid attempts remain explicitly excluded.

## H. Test and regression results

| Validation | Result |
| --- | --- |
| `npm run typecheck` | PASS. |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS; 182 modules. Minified JS chunk is 664.38 kB (gzip 201.29 kB), above Vite's 500 kB advisory threshold. |
| `npm run client:test` | PASS, 9 files / 139 tests on UX-003; clean `origin/main` baseline: 9 files / 137 tests. |
| Focused Company Research, Workflow Observability, active-run, ConversationStateStore, Runtime Slice A/B, UX-001 tests | PASS, 75/75. |
| UX-003 `npm test` | Exit 1; Node 2,243 total, 2,222 passed, 21 failed. Client 139/139 passed. |
| Clean `origin/main` `npm test` | Exit 1; Node 2,233 total, 2,212 passed, 21 failed. Client 137/137 passed. |
| Full failure content comparison | `BASELINE_FAILURES_IDENTICAL`: 21 baseline, 21 UX-003; 0 new, 0 disappeared, 0 same-name content changes. Normalized record SHA-256 and per-failure details are in [acceptance comparison evidence](../../../tests/validation/evidence/ux003-acceptance-fix-001-node-failure-comparison.json). |
| `git diff --check` | PASS. |

## I. UX-002 SSE session-switch check

In the real Runtime/Pi SessionManager fixture, switching sessions produced `session.abort.begin`, `session.abort.end`, `session.dispose`, then `session.new.complete`. The production browser reconnected to `Connected` and received a subsequent real faux Pi response and `chat_completed`; no cross-conversation stream was observed. This is a short reconnect recovery, not a durable SSE replay guarantee.

## J. Safety and Knowledge non-mutation

Observation projection accepts allowlisted Provider identities and stable diagnostic codes; summaries are bounded and filtered. User-supplied or provider-controlled free-form errors, credentials, absolute paths, stack traces, raw bodies, and reasoning are not exposed. The browser fixture used `writeKnowledge:false`; before/after the full Runtime restart, isolated Knowledge revision remained 0 and the root SHA-256 remained `ccb04b78e3712d0988c1b23453a5b81fac40eb5a98b1594a526c8c7c5c3a5865`.

## K. Remaining risks and limits

- Fine-grained stage/Provider/Skill observations currently exist only for Company Research. The other eight Workflows have overall status, total timing, and their existing result references.
- Individual concurrent Provider attempts do not publish live updates; outcome/timing is available when acquisition completes.
- A Runtime restart cannot restore detailed stage history or resume an in-memory run. The UI recovers the durable association as interrupted.
- Browser E2E uses an offline faux model and Providers. It proves local Runtime/UI wiring, not external source availability or research quality.
- Production Client build still reports a 663.50 kB minified JavaScript chunk advisory.
- Full-suite inherited failures are acceptable only if the final `(filePath, testTitle)` failure set exactly matches the clean baseline; any new failure blocks acceptance.

## L. Git delivery

The implementation is committed and pushed only after final validation. Final branch SHA, fetched remote SHA equality, clean working-tree state, and file manifest are supplied in the closeout message and must match the verified repository state. No `main` merge or UX-004 work is included.
