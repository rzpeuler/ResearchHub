# RHL-EXEC-002 — Unified Workflow Execution & Result Closure

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

This delivery closes the shared execution lifecycle for the nine production
Workflows. It does not claim that every Workflow can complete when its business
data, source, or Knowledge prerequisites are unavailable.

## Baseline and Git delivery

| Item | Value |
| --- | --- |
| Repository | `C:\Users\Administrator\Desktop\ResearchHub` |
| Worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\EXEC_002` |
| Branch | `codex/exec-002-unified-workflow-execution` |
| Baseline after EXEC-001 merge | `55e15c69e5b2d6314939bc0604233d7f5a33000a` |
| EXEC-001 ancestry | Verified as an ancestor of the baseline `origin/main` |
| Implementation commit | `05474fc07930bbbedad4066332a23f64bcbef102` |
| Final delivery commit | This report commit at the branch tip; exact SHA is recorded in the delivery response |
| Main merge | None |

The implementation reuses `ResearchDispatchService`,
`WorkflowDefinitionRegistry`, `WorkflowService`, the existing domain services,
`ResearchBundleStore`, Runtime HTTP routes, and homepage polling. It adds a
small application-level result projection and no second Workflow registry,
state database, planner, agent runtime, provider framework, or Knowledge
schema.

## Execution binding matrix

Production registry IDs and built-in binding IDs are checked for exact set
equality. Every binding receives the validated arguments, one generated
`workflowRunId`, caller cancellation signal, and the existing request policies
where applicable. An absent service or binding returns
`EXECUTOR_UNAVAILABLE` without reporting a started run.

| Workflow ID | Existing execution entry point | Acceptance outcome exercised |
| --- | --- | --- |
| `company_research` | `ResearchService.startResearchCompany` | Blocked with `COMPANY_COVERAGE_NOT_FOUND`; unrelated report ID is rejected |
| `industry_research` | `ResearchService.startIndustryResearch` | Blocked with `NO_CANONICAL_INDUSTRY_METRIC`; industry name and aliases preserved |
| `earnings_review` | `ResearchService.startEarningsReview` | Cancellation reaches terminal state |
| `valuation` | `ResearchService.startValuation` | Blocked with `VALUATION_MARKET_PRICE_UNAVAILABLE` |
| `event_research` | `ResearchService.startEventResearch` | Controlled adapter failure reaches `failed` |
| `thesis_red_team` | `ResearchService.startThesisRedTeam` | Completion and matching ReviewCase reference |
| `thesis_lifecycle` | `runThesisLifecycle` through `WorkflowService` | REFRESH executes and receives registered run identity and timestamp |
| `daily_intelligence` | `DailyIntelligenceService.startBrief` | Matching report link; separate evening mapping test |
| `theme_framework` | `ThemeFrameworkService.start` | `completed_with_review` and `awaiting_review` candidate link |

`tests/app/services/research-dispatch-production-matrix.test.ts` drives the
actual `ResearchDispatchService.startAsync` production path for every
registered ID, asserts exact validated arguments and adapter inputs, checks
run identity and lifecycle status, then checks the public result and Bundle.
The adapters, external data, and reasoning boundary are controlled test
substitutes; they do not claim external-provider or live-model execution.
Separate tests cover missing bindings and missing/invalid/unresolved input
without starting an adapter.

## Status and result contracts

`WorkflowService` retains the existing states: `pending`, `running`,
`completed`, `completed_with_review`, `blocked`, `cancelled`, and `failed`.
The application projection reports `runId`, `workflowId`, current and terminal
status, safe summary, verified report/review references, Bundle reference and
availability, true blocked reason, and allowlisted diagnostic codes. It does
not replace the domain result structures.

| Lifecycle or dispatch outcome | Public behavior |
| --- | --- |
| `NEEDS_INPUT` | Missing fields and previously validated same-Workflow arguments remain available for the bounded follow-up |
| `INVALID_INPUT` | Schema failure is returned before adapter invocation |
| `UNRESOLVED_REFERENCE` | Unverified entity or canonical ref is named as a gap; adapter is not started |
| `EXECUTOR_UNAVAILABLE` | Explicit non-start result; no phantom run |
| `running` | Stable run identity is polled with bounded retries |
| `completed` | Safe summary and only verified artifact links are exposed |
| `completed_with_review` | Human review is explicit; Theme `awaiting_review` is never called accepted |
| `blocked` | The actual domain blocked reason is retained when supplied; no provider error is invented |
| `failed` | Safe failure summary and constrained diagnostic code; stack, credentials, and local paths are excluded |
| `cancelled` | Terminal cancellation remains authoritative over a late completion |

For `thesis_lifecycle`, Dispatch registers and starts the existing
`runThesisLifecycle` under `WorkflowService`; the CREATE/REFRESH logic, quality
gates, and Knowledge decisions remain owned by that domain function. Theme
candidate state (`awaiting_review`, `committed`, `stale`, or `rejected`) remains
in the existing Theme result and review APIs.

## ResearchBundle, reports, and reviews

- Terminal success, business block, execution failure, and cancellation each
  produce a result projection. When the configured store is absent, Bundle
  status is `unavailable`; when a write fails it is `failed` with
  `BUNDLE_PERSIST_FAILED`. These states are not represented as successful
  delivery.
- Bundle IDs are deterministic (`research-bundle-${runId}`). Equivalent
  retries are idempotent; conflicting non-equivalent content for the same run
  fails instead of overwriting it. Unknown domain status remains `unknown`, not
  fabricated success.
- `GET /api/research/bundles/by-run/:runId` and
  `getResearchBundleForRun` provide read-only lookup by the originating run.
- A report or Daily Brief is linked only after its stored `workflowRunId`
  matches the run. A ReviewCase is linked only after `producerRunId` matches.
  Mismatched or missing artifacts do not produce placeholder links.
- Cancellation suppresses late report/review/summary data and retains only the
  verified Bundle reference, if one exists.

## Homepage and HTTP evidence

The homepage renders dispatch feedback, lifecycle state, result summary,
blocked reason, safe diagnostics, and available report, Bundle, or review
navigation. Theme candidates and Daily Briefs route to their existing detail
views. Same-Workflow `NEEDS_INPUT` follow-ups preserve prior validated fields
and validate the merged arguments again. The UI does not turn structured
execution data into an unvalidated chat answer.

`tests/app/runtime/homepage-smoke.test.ts` exercises the real
`ApplicationRuntime` and HTTP server. The client suite includes a RuntimeClient
to rendered App flow using a local HTTP server. Focused tests also cover
terminal feedback, artifact run association, bounded Bundle synchronization,
polling cleanup, and cancellation. This verifies the deterministic local
application chain; it is not a live-model or real-provider E2E.

## Cancellation and exception handling

Cancellation uses the existing abort signal and `WorkflowService` terminal
rules. Already terminal runs do not change status on duplicate cancellation.
Async failures are caught into a terminal `failed` result and a diagnostic
Bundle attempt. A late success cannot replace cancellation. Workflow outcomes
are keyed and validated against their originating `runId`; one run's exception
does not mutate another run. Polling stops on terminal status, unmount, or its
configured poll/error bound.

## Known EXEC-003 business blockers

These are existing domain coverage requirements, not EXEC-002 execution-chain
failures. EXEC-002 does not broaden source coverage, remove gates, or change
business methods.

| Workflow | Remaining business prerequisite |
| --- | --- |
| `company_research` | Exact active Canonical Company and downstream coverage/data |
| `daily_intelligence` | Signal and source coverage |
| `earnings_review` | Covered Company and report-period data |
| `event_research` | Verified Company plus user/source-backed event anchor and event-source availability |
| `industry_research` | Industry evidence and metric source coverage |
| `theme_framework` | Active Schema 0.4 Knowledge and human review; no automatic acceptance |
| `thesis_lifecycle` | Canonical refs, mounted Knowledge, and review gates; multi-turn refresh recovery remains separate |
| `thesis_red_team` | Exact active Company/Thesis Claim and source coverage |
| `valuation` | Current internal Company coverage and valuation data |

## Tests and baseline comparison

| Validation | Result |
| --- | --- |
| Production binding and result matrix | 9/9 registered Workflow IDs; exact argument, adapter, state, result, and Bundle checks |
| Daily Intelligence evening adapter test | Passed; evening parameters and matching brief link preserved |
| Full Client suite (`npm test`) | 110/110 passed |
| Full Node suite (`npm test`) | 2,132 tests; 2,109 passed; 23 failed |
| Exact Node failure-ID baseline comparison | Baseline 23; current 23; 0 new IDs; 0 fixed IDs |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; Vite reports a 636.69 kB minified JavaScript chunk advisory |
| `git diff --check` | Passed before implementation commit; rerun before final delivery |

The full suite exits nonzero; it is not green. The 23 current failure IDs
match the clean baseline exactly:

1. `ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module`
2. `company projection is readable through a canonical business exposure without adding a company graph node`
3. `composition is source-immutable, deterministic and idempotent`
4. `current restricted or expired source rights suppress company exposures and dependent competition data`
5. `different rows may retain different currencies and a changed column schema blocks for review`
6. `evidence-backed cell update commits, and an unavailable update preserves the prior usable value`
7. `FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes`
8. `Gateway blocks numeric Module cells that disagree with their canonical facts`
9. `Gateway creates a competition Module and maps its local proposal ID`
10. `Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units`
11. `Module blocks the whole submit when a cell reference cannot resolve`
12. `Module blocks unusable Source evidence inherited from an existing business_exposure Relation`
13. `Module blocks when the row Source payload is unusable`
14. `new Claim provenance alone cannot justify a contradictory same-reference display value`
15. `same Claim may support a canonical numeric display update after new provenance is admitted`
16. `same Industry table replays idempotently with the same canonical Module ref`
17. `semantic section classification receives only readable facts and cannot block the base projection`
18. `stale expected revision and a corrupt scope ledger fail closed`
19. `Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges`
20. `V39 acquisition calls all three AKShare methods`
21. `V65 source acquisition time is distinct from historical valuation context`
22. `Workflow metadata composes canonical peers without registering composite Skill IDs`
23. `Writer rejection does not report success or overwrite the prior Module`

Baseline and prior final comparison logs are retained under `%TEMP%` as
`rhl-exec-002-baseline-main-npm-test.log` and
`rhl-exec-002-final-npm-test.log`. The fresh full-suite rerun reports the same
23 failure identifiers and the same 2,109/2,132 Node result.

## Readiness classification

| Evidence class | Result |
| --- | --- |
| `CONTRACT_READY` | Yes |
| `ADAPTER_START_VERIFIED` | Yes, 9/9 through the deterministic production Application Service path |
| `STATE_RESULT_VERIFIED` | Yes, including terminal state, Bundle identity, and verified artifact linkage |
| `REAL_MODEL_E2E_VERIFIED` | No — not run; `REAL_MODEL_E2E_NOT_VERIFIED` |
| `REAL_PROVIDER_E2E_VERIFIED` | No — controlled adapters only; `REAL_PROVIDER_E2E_NOT_VERIFIED` |
| `PRODUCT_QUALITY_READY` | No — Sol acceptance is pending and the full Node suite retains baseline failures |

## Scope review

Changes are limited to shared Workflow dispatch/binding, state/result
projection, Bundle association, the existing Bundle read API, homepage result
feedback, and tests for those paths. No domain Workflow behavior, Knowledge
write authority, review gate, Provider architecture, or schema was changed.
The branch is delivered separately and is not merged into `main`.
