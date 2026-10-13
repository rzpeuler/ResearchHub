# RHL-UX-003-ACCEPTANCE-FIX-001 Report

- Status: `ACCEPTANCE_COMPLETE / CTO REVIEW PENDING`
- Branch: `codex/ux-003-workflow-observability`
- Reviewed implementation commit: `052aacdcb8e9a72a5b3001e58daa15676e18aa6b`
- Baseline: clean `origin/main` at `2594fe01b4f282bfb4680c21c9135d3b05ffc3a4`
- Browser evidence: [UX-003 browser E2E evidence](../../../tests/validation/evidence/ux003-browser-e2e-evidence.json)
- Node failure comparison: [normalized full failure comparison](../../../tests/validation/evidence/ux003-acceptance-fix-001-node-failure-comparison.json)

## A. Git Baseline and Final HEAD

The reviewed UX-003 branch was clean at `052aacdcb8e9a72a5b3001e58daa15676e18aa6b`. `origin/main` remained at `2594fe01b4f282bfb4680c21c9135d3b05ffc3a4`; the comparison baseline was checked out into a new clean detached worktree, leaving the pre-existing dirty baseline worktree untouched. Both test runs used Node `v24.16.0` and npm `11.13.0` with the same dependency tree. Final commit, push, remote equality, and worktree state are recorded in the closeout report.

## B. Provider UNSUPPORTED Browser Evidence

The production Vite Client was opened in Microsoft Edge against the existing UX-003 browser fixture. The fixture hosted a real `ResearchHubRuntimeServer`, real `ResearchService` / `DataResolver`, `WorkflowService`, and persistent Pi `SessionManager`, with model network access disabled and an isolated temporary Schema 0.4 Knowledge Base.

The visible UI selected Company Research, entered the test request for 跨境通 (`002640`), and clicked Send. The fixture's resolver-boundary trace captured three actual AKShare attempts with status `UNSUPPORTED` for the profile, financial-history, and market-history requirements. The Company Research result recorded AKShare as `providerAttempted=false`, `providerFailed=false`, and `usableSourceCount=0`.

For Run `1b485d21-4bd7-440b-a691-81da77be137d`, `GET /api/workflows/1b485d21-4bd7-440b-a691-81da77be137d` returned HTTP 200, terminal status `completed`, observation revision 21, all seven actual stages, and AKShare `status=skipped` with three `PROVIDER_UNSUPPORTED` diagnostics and no `PROVIDER_ATTEMPT_FAILED`. The Company Research completion result independently recorded AKShare as `providerAttempted=false`, `providerFailed=false`, and `usableSourceCount=0`. The real faux CNINFO error remained `failed`; faux GDELT returned one usable record. The overall Workflow completed, showing unsupported AKShare operations did not determine the Workflow result.

Edge DOM recorded the same Run ID, completed status, subject, and AKShare row before and after refresh. After refresh, the row still displayed “结构化数据 / 已跳过 / 当前数据需求不支持该数据源” three times, and all seven stage IDs were present. No raw Provider error or stack appeared in the DOM.

## C. Full Node Failure Comparison

Both full `npm test` commands exited 1 on the pre-existing Node failures:

| Run | Client | Node tests | Node passed | Node failed |
| --- | ---: | ---: | ---: | ---: |
| Clean `origin/main` | 9 files / 137 passed | 2,233 | 2,212 | 21 |
| UX-003 | 9 files / 139 passed | 2,243 | 2,222 | 21 |

Every failed test was compared by file path and test name, then by error type, message, actual/expected failure body, source location, and normalized call stack. Normalization replaced only each worktree's absolute root, normalized separators in resulting path strings, removed test-duration suffixes, and removed carriage returns. The comparison result is `BASELINE_FAILURES_IDENTICAL`: 21 baseline failures, 21 branch failures, 0 new, 0 disappeared, and 0 same-name content changes.

SHA-256 of the canonical normalized baseline and branch failure records:

`54d84f951967a2b4efe95bc93ca13c0cb37b52adbfb4f61e559c7b4d9f7e2ec1`

The linked comparison artifact contains both complete 21-record sets, including error details and normalized stacks.

## D. Regression Tests

- `npm run typecheck`: PASS.
- `npm run client:typecheck`: PASS.
- `npm run client:build`: PASS; 182 modules; Vite retains its chunk-size advisory (664.38 kB minified, 201.29 kB gzip).
- `npm run client:test`: PASS, 139/139 on UX-003; 137/137 on baseline.
- `node --import tsx --test tests/workflows/company-deep-research.test.ts tests/app/services/workflow-observability.test.ts tests/app/services/workflow-active-runs.test.ts tests/app/runtime/conversation-state-store.test.ts tests/app/runtime/slice-a.test.ts tests/app/runtime/slice-b.test.ts tests/app/runtime/ux001-lifecycle.integration.test.ts`: PASS, 75/75.
- Branch `npm test`: 21 Node failures, all exactly baseline-identical as detailed above.
- Baseline `npm test`: 21 Node failures, recorded independently from clean `origin/main`.
- `git diff --check`: PASS before delivery.

## E. Actual Fixes

No production code change was necessary in this acceptance supplement: the reviewed implementation commit already classified `UNSUPPORTED` as `PROVIDER_UNSUPPORTED`. This supplement added bounded DataResolver and Company Provider outcome instrumentation to the isolated browser fixture so the real resolver statuses and failure counters could be observed. It logs only requirement/source IDs and enumerated statuses/counts, not arbitrary Provider messages.

## F. Knowledge and Security Isolation

The fixture supplied `writeKnowledge:false`, used no production credentials, disabled model network access, and did not mount a user Knowledge Base. Knowledge revision remained 0; the SHA-256 was `4106315fdcc91ec4db66deca9ad17dbcf334494870da3470a33255e5c3df54cf` both before and after the run. The browser displayed only stable safe diagnostics, not raw Provider errors or stacks.

## G. Remaining Risks

- The browser fixture uses deterministic offline Providers; this proves Runtime and UI classification, not live-source availability or data quality.
- The same 21 baseline Node failures remain. The detailed comparison proves their failure content is unchanged for this branch.
- Fine-grained observation scope remains Company Research only, as defined by the accepted UX-003 contract.

## H. Git Delivery

The acceptance evidence and report are delivered on `codex/ux-003-workflow-observability`. The final closeout records the commit SHA, pushed remote SHA equality, clean worktree, and confirmation that `main` was not merged and UX-004 was not started.
