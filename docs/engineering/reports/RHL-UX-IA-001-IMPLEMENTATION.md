# RHL-UX-IA-001 Implementation Report

Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`

## A. Git baseline and predecessor merge

Repository: https://github.com/rzpeuler/ResearchHub. Branch: `codex/ux-ia-001-report-centric-artifacts`. Clean baseline `9ca20a86467767a12feec4e79fb18874a70f99d6` is the merge of PR #7, containing the accepted WF-PERSIST commit `3958f2e01e8b264ddb1b7078a07b2a6928705399`. Implementation and baseline validation used separate worktrees. Existing dirty root and historical main worktree were preserved.

The user's subsequent instruction explicitly authorizes committing, merging and synchronizing this delivery. This overrides the taskbook's automatic-merge prohibition for this delivery; it does not imply CTO product acceptance or permission to start UX-FINAL.

## B. Artifact relationships

See `RHL-UX-IA-001-ARTIFACT-RELATIONSHIP-MATRIX.md`. Reports resolve appendices only from their exact `workflowRunId`. The returned Bundle must have that run and `research-bundle-${runId}` identity. Optional nested execution/report references must agree. Workflow history must match the same run and optional report reference. Title, date and ordering are never association keys. Directly produced reports can legitimately lack a Bundle.

## C. Report appendix UI

`ReportAppendix.tsx` and its CSS provide three native, initially collapsed sections: source candidate excerpts and provenance, structured results/proposals, and Workflow execution history. Each independently fetches on expansion and has loading, empty, error and retry states. Errors leave the report body visible. Structured results default to fields/lists; optional sanitized JSON starts collapsed. Source references already in the report are not repeated. Excerpts are explicitly labeled as candidates rather than complete documents. Chinese and English labels are supported.

## D. Association integrity

Report selection clears the previous body immediately and discards late responses using selection generations. Appendix instances are keyed by Report and Run; unmount/close invalidates pending reads. Manual report/Bundle selection cancels pending artifact opening. Returned identities are checked before rendering. Server by-run Bundle reads also reject a valid other-run file transplanted under the requested filename. Session prompt context uses this same identity guard.

## E. No-report Bundle access

Original Conversation Activity rows expose a Bundle action for their actual Workflow run or new durable `researchBundleRunId`. Free Research/Skill Plan dispatch stores its generated ID in the Conversation sidecar, retains it through completion/replay/restart, and exposes it as an additive optional Activity field. Prompt attachment uses the server association and rejects cross-operation/cross-conversation hints before claiming a request. Unrelated reserved Workflow IDs are not used. Legacy Free/Skill records without an association remain readable but cannot be safely backfilled.

## F. Historical Workflow integration

The appendix reuses the existing Workflow endpoint and WF-PERSIST snapshots. Historical/interrupted markers are explicit; absent snapshots show unavailable history. It renders observed stages, Provider and Skill statuses/counts, timings and safe diagnostics; it does not invent stages, completion or progress. No scheduler, Pi lifecycle or persistence schema change was made.

## G. Navigation compatibility

Removed Research Bundles from the main sidebar. `/bundles`, list/detail retrieval, Workflow result actions and original Conversation Activity actions remain available. Bundle catalog completion no longer clears an independently opened detail.

## H. Browser E2E

E2E-01–09 passed against the production React build and real application Runtime/Pi SessionManager using isolated deterministic providers. Missing, corrupt and transplanted Bundle files, narrow keyboard retry, two real Runtime processes and a delayed actual response are exercised. See `RHL-UX-IA-001-BROWSER-E2E.md` and its JSON evidence.

## I. Tests and regression

Root and Client typechecks, production build and final Client tests (178/178) passed. Targeted Report/Bundle/persistence/UX-001/association integration tests passed (22/22); the Conversation-store/Bundle/session focused group passed 24/24. Full Node suite: 2258 tests, 2237 pass, 21 inherited failures. Full failure records match clean main exactly: zero new, disappeared or changed failures. See regression report.

## J. Security and Knowledge isolation

Display projections bound depth/node/field/item counts and remove sensitive keys, credential/path text, hidden reasoning and arbitrary stacks. Workflow diagnostics are limited to stable uppercase codes. Existing loopback Host/Origin and Runtime-token rules remain. GET endpoints retain their existing local-first boundary and do not claim multi-user ACLs. Only isolated test Knowledge Bases were used; browser restart checks confirm unchanged Knowledge content. No Report/Bundle schema, Knowledge mutation, source rights/PIT or report generation behavior was changed.

## K. Remaining risks

Inherited 21 Node failures remain. The production bundle retains Vite's size advisory. Historical sources may be empty and direct reports may lack Bundles. Legacy unassociated Free/Skill runs cannot be recovered by guessing. Validation proves Runtime integration with deterministic providers, not live external provider quality. CTO acceptance remains pending.

## L. Git delivery

The reviewed task files, tests, evidence and four reports are committed on the task branch and pushed; the requested merge and root synchronization follow validation. Final exact commit/merge SHAs and remote/root status are reported in the delivery response, avoiding a self-referential commit SHA inside its own contents. Existing unrelated root modifications are retained separately and are not part of this task's remote commit. UX-FINAL is not started.
