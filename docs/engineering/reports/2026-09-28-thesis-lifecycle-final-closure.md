# RHL-TL-001 Thesis Lifecycle final acceptance

Date: 2026-09-28  
Status: **ACCEPTED; main integration pending**  
Scope: CREATE, ordinary REFRESH, human decisions, and canonical `invalidated` transition.

## Product result

Thesis has an optional versioned `killCriteria` collection with a stable `type` and bounded `definition` envelope. This release authors and evaluates `numeric_threshold` only. Existing Thesis records without a confirmed criterion continue ordinary REFRESH but cannot become `invalidated`. A person must enter, preview, and confirm a new criterion; the application does not promote historical narrative text into canonical conditions.

Workflow triggers a deterministic evaluation after accepted evidence is bound. The evaluator returns `met`, `not_met`, or `insufficient_evidence` from exact metric, unit, period, Source/Raw rights and archived numeric value proof. The research Skill retains evidence semantics and does not own lifecycle state. A `met` result creates a ReviewCase; human ACCEPT reloads current Knowledge, reruns the evaluator, and uses the existing Gateway → validation → Writer path to commit `invalidated`. DEFER and REJECT do not write canonical Knowledge. The decision view and report expose the current canonical rule, evaluated value, definition revision/hash, and Source/Raw binding without copying the source quote into the report.

## Acceptance gates

| Gate | Evidence | Result |
| --- | --- | --- |
| Product CREATE | [CREATE acceptance](2026-09-24-thesis-lifecycle-create-acceptance.md) and `RHL_TL001_THESIS_LIFECYCLE_CREATE_REAL_E2E.json` | PASS: normal HTTP CREATE, configured Pi, Writer/reload, replay and changed-input conflict. |
| Ordinary REFRESH and decisions | [REFRESH acceptance](2026-09-24-thesis-lifecycle-acceptance-evidence.md) and `RHL_TL001_THESIS_LIFECYCLE_REAL_E2E.json` | PASS: original-publisher evidence, configured Pi, challenged ReviewCase, DEFER no-write, ACCEPT and replay. |
| Canonical invalidation | [Real invalidation acceptance](../../../tests/validation/evidence/RHL_TL001_THESIS_KILL_CRITERION_REAL_E2E.md) and [machine evidence](../../../tests/validation/evidence/RHL_TL001_THESIS_KILL_CRITERION_REAL_E2E.json) | PASS: confirmed criterion, real-source numeric proof, real Pi REFRESH, `met` ReviewCase, DEFER, ACCEPT, Writer/reload and replay. |
| Offline validation | `npm test`, `npm run typecheck`, `npm run client:typecheck`, `npm run client:build` | PASS: 34/34 client and 1576/1576 Node tests; both typechecks and production build passed. |

The invalidation acceptance used a disposable Schema 0.4 Knowledge Base and a live original-publisher CNINFO PDF. The 94,853 archived original bytes and their hash were verified. A deterministic scan selected the exact 2025 annual per-share cash-dividend value (`28.02423 元`) from the parsed original; the evaluator reparsed the archived PDF to prove the value version. The numeric Claim and Thesis were explicitly synthetic acceptance-harness records, not investor-approved judgments. The human-rule confirmation service used a labeled simulated historical clock so the already-published evidence was later than the test criterion; the Source publication time was unchanged. The mounted user Knowledge Base was not used.

The isolated canonical revision advanced from 1 to 2 on condition confirmation, stayed 2 during REFRESH and DEFER, and advanced to 3 only after human ACCEPT. A fresh reload showed `Thesis.status = invalidated`. Identical confirm and ACCEPT replays did not advance revision. The final report recorded `ACCEPTED` and the Writer run; the case was no longer actionable. The machine artifact omits quote text, source body, original bytes, and credentials.

An exploratory invalidation run initially observed a post-confirm revision assertion mismatch (`1` read versus Writer result `2`). The final harness was then run twice against fresh disposable Knowledge Bases and passed both times without a product-code change to the Writer or criterion confirmation path. This observation is retained here because it was not reproduced or given a confirmed root cause.

## Closure boundary

Unknown future criterion types and `deadline` remain readable only and cannot cause `met` in this release. Source-derived and human-rule authoring, stale revisions, rights/Raw failure, conflicting values, crash recovery, and old-Thesis blocking have deterministic test coverage; the live gate used a human-rule criterion. No independent research Skill, new orchestration layer, new canonical store, or automatic legacy-condition migration was added. Further Thesis Lifecycle features are outside TL-001.

Mainline integration and remote verification complete formal closure; record that delivery in the final status update.
