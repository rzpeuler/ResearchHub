# RHL-WF-PERSIST-001 IMPLEMENTATION REPORT

Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`

## A. Git Baseline

- Repository: `https://github.com/rzpeuler/ResearchHub`
- Branch: `codex/wf-persist-001-workflow-observation-snapshots`
- Baseline: fetched `origin/main` at `5beaa675ef829e2a4dcae91a594e7604be97f3e6` (UX-004 included).
- Governance: Task A is an isolated delivery. CTO review is required before Task B; no merge to `main` is included.
- Clean baseline full suite: Client 150/150; Node 2,222 passed and 21 failed out of 2,243. Baseline evidence is [RHL-WF-PERSIST-001-BASELINE-001.json](../../../tests/validation/evidence/RHL-WF-PERSIST-001-BASELINE-001.json).

## B. Persistence Architecture

`WorkflowService` remains the sole live execution authority. Its existing safe Workflow projection is written to a versioned file store under `runtime-data/workflow-observations/`; the store is observational and never resumes execution. Runtime initializes the store before serving requests and gracefully waits for the scheduler tick, Session runtime disposal, and pending snapshot writes during shutdown. Writes are acknowledged by revision for accepted transitions and the existing Workflow GET API serves the live view first, then history.

The persistence failure state is reported separately from the research result. A completed research result is not retroactively turned into failure when its snapshot cannot be saved; the live view exposes `historyPersistence.status` and a stable error code.

## C. Snapshot Schema

Schema version 1 stores a safe `WorkflowRunView`, `runId`, monotonic `observationRevision`, and `persistedAt`. It uses a 512 KiB cap, strict allowlists, run/observation ID and path validation, symlink/non-file rejection, atomic temporary-file replacement, file permissions, same-run serialized writes, and stale/equal revision protection. User/provider bodies, arbitrary diagnostics, persistence metadata, and sensitive values are not persisted. Corrupt, unsupported, oversized, capacity, conflict, and I/O cases have bounded diagnostics.

## D. Run Lifecycle

Registration, start, stage transitions, Provider observations, Skill transitions, terminal state, cancellation, and execution-result projection schedule ordered snapshots. Reporter methods await the revision they observed; asynchronous Company Research Provider, Skill, stage, and identity-validation observation updates are awaited by their producer. Start and cancel HTTP acknowledgements wait for their snapshot attempt to settle. Graceful Runtime close drains active scheduled ticks and outstanding persistence.

## E. Crash & Restart Semantics

Completed snapshots retain their real status and full observed stages. A recovered `pending` or `running` snapshot is projected as `interrupted`, with `recoveryState.lastObservedStatus`; only stages/Skills actually marked running are projected as interrupted. Recovery does not invent completion time, duration, result, or stage outcome, and never re-executes a Workflow, Provider, Skill, or Knowledge write. Conversation–Run association remains in the existing conversation state store.

Only successfully persisted observations are recoverable. If work completed but its terminal observation did not reach disk, the last saved pending/running state is reported as interrupted; the system cannot claim whether the external work completed. This uncertainty is intentionally not resolved by replay.

## F. Runtime API Compatibility

`GET /api/workflows/:runId` returns the active authoritative view or a safe historical projection; missing snapshots remain `not_found`. Additive `observationSource`, `recoveryState`, and `historyPersistence` fields distinguish live, historical, interrupted, and persistence conditions. `interrupted` is not a producer terminal status, failed, or cancelled. Existing Result, Bundle, Report, and Run IDs are unchanged. The client renders historical/interrupted states distinctly and stops polling interrupted runs.

## G. Tests & Browser E2E

- Store and service tests cover schema/identity/path validation, corruption, size and write failure, symlinks, version ordering, duplicate recovery, A/B isolation, recovery semantics, persistence acknowledgement, and non-replay behavior.
- Existing UX-001 lifecycle test now runs a real Runtime restart and verifies persisted conversation/run association.
- Browser evidence [RHL-WF-PERSIST-001-BROWSER-E2E-001.json](../../../tests/validation/evidence/RHL-WF-PERSIST-001-BROWSER-E2E-001.json) uses the production React build, Edge CDP, the existing HTTP API, and three independent Runtime process lifetimes. A real isolated Company Research run completed with seven observed stages at revision 21; graceful restart restored the historical terminal view in API and browser with zero Provider/execution replays and unchanged Knowledge Base SHA. A second real Company Research run was killed by SIGKILL while `data_acquisition` was running; a third Runtime restored it as interrupted with the real last stage, no fabricated completion time, and zero replays.
- The E2E uses isolated Provider fixtures and a temporary Knowledge Base with model network disabled. It verifies lifecycle behavior, not real market-data quality.
- Validation: root `npx tsc --noEmit` passed; `npm run client:typecheck` passed; `npm run client:build` passed (674.27 kB JS, gzip 204.09 kB; Vite >500 kB advisory); focused persistence/runtime tests passed. `git diff --check` passed.
- Full `npm test`: Client 152/152; Node 2,234 passed / 21 failed of 2,255. Exact `(filePath, testTitle)` comparison against clean baseline found zero new and zero resolved Node failures; all 21 are inherited baseline failures. The 12-test increase is the added coverage.

## H. Security and Knowledge Isolation

Snapshot projection applies field allowlists and bounded safe-text/diagnostic projection before writing. Run IDs cannot escape the dedicated store path; symlink snapshots are rejected. Recovery is read-only and does not invoke workflow execution or the Knowledge Production path. Browser evidence verifies the fixture Knowledge Base digest is unchanged across terminal recovery and records zero Provider calls/replays after both restarts. No Knowledge Schema or Pi lifecycle changes were made.

## I. Remaining Risks

- Abrupt process/OS failure can lose observations after the last successful snapshot, including a terminal transition; recovery reports only the last durable state.
- The full Node suite retains the same 21 pre-existing failures as the clean baseline.
- Browser Company Research used isolated Provider fixtures, so external source availability and research quality were not evaluated.
- The built Client retains Vite's existing large-chunk advisory.

## J. Commit SHA and Git Delivery

Delivery is limited to `codex/wf-persist-001-workflow-observation-snapshots`. The final commit SHA, matching remote branch HEAD, clean worktree result, and push confirmation are reported with the delivery handoff. This branch is not merged to `main` pending CTO acceptance. Stop after Task A; do not begin UX-IA-001.

## Acceptance Fix Supplement

Supplement status: `ACCEPTANCE_COMPLETE / CTO REVIEW PENDING`

The final Node failure comparison was rerun against a fresh detached worktree at
`origin/main` `5beaa675ef829e2a4dcae91a594e7604be97f3e6` and reviewed branch
commit `3f005ab478c821c19db74b1b457f22599d86fc12`, with Node 24.16.0, npm
11.13.0, identical lockfile SHA-256, and `npm ci` in both worktrees. The
machine-readable comparison includes every normalized failure's error type,
message, actual/expected values, source position, and call stack, plus
classified differences and SHA-256 digests. It reports
`BASELINE_FAILURES_IDENTICAL`: baseline 21 failures, branch 21 failures, zero
new, zero disappeared, and zero same-named content changes. See
[RHL-WF-PERSIST-001-ACCEPTANCE-FIX-001.json](../../../tests/validation/evidence/RHL-WF-PERSIST-001-ACCEPTANCE-FIX-001.json)
and its reproducible parser/comparator
[compare-node-test-failures.mjs](../../../tests/validation/compare-node-test-failures.mjs).

Acceptance-fix focused regression also passed root and Client typechecks, the
production Client build, Client tests (152/152), Workflow Observation Store
and Persistence tests, the UX-001 Runtime restart integration test, and
`git diff --check`. The production bundle retains the existing Vite >500 kB
advisory. The first Client test invocation ran concurrently with Runtime tests
and emitted one `ECONNRESET` unhandled rejection despite 152 passing tests; the
standalone rerun passed all 152 tests with no errors.
