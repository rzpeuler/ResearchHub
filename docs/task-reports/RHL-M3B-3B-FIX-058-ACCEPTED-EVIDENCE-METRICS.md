# Task Report

task_id: RHL-M3B-3B-FIX-058-ACCEPTED-EVIDENCE-METRICS
status: READY_FOR_SOL_REVIEW
baseline: 914e19f3ee0c5de4451a8dc2c10af03194e7466a
branch: codex/m3b-3b-evidence-routing
implementation_commit: d389cc315dc44e3ed85600018f3471918ce78577
verified_remote_tip: d389cc315dc44e3ed85600018f3471918ce78577
sync_status: SYNCED
summary: Separate usable normalized-source counts from Workflow-accepted evidence counts in the TEST-054 provider telemetry.
tests: Focused TEST-054 harness tests 9/9 passed; full npm test passed with client 21/21 and Node 973/973; repository typecheck and diff check passed; latest real TEST-054 completed the full Workflow/Gateway/ChangeSet/Writer path and preserved the fail-closed product-quality classification.
acceptance_criteria: `usableSourceCount` reflects provider normalization output; `qualifiedEvidenceCount` reflects evidence accepted by the Workflow; accepted evidence resolves through candidate provider identity; no provider result is fabricated and no quality gate is relaxed.
governance_status: Active governance manifest and applicable governance documents were read. The change is limited to TEST-054 validation telemetry and focused tests; no governance or architecture file was changed.
blockers: Product-quality acceptance remains blocked by insufficient evidence coverage. The metric correction improves diagnosis only and does not change provider behavior or module acceptance.
task_input_quality: complete
missing_information_resolved_by_luna: none

## Changes

- Added accepted-evidence counting by stable metric provider name.
- Preserved normalized/usable source totals in a separate `usableSourceCount` field.
- Changed `qualifiedEvidenceCount` to count only Workflow evidence returned as accepted evidence.
- Added focused coverage for mapped and unknown provider identities.
- Refreshed the sanitized TEST-054 evidence artifact.

## Validation Results

- command: `npx tsx --test tests/validation/industry-seven-provider-product-quality-after-docling-ready.test.ts`
  result: 9 tests passed.
- command: `npm run typecheck`
  result: Passed.
- command: `npm test`
  result: Passed with client 21/21 and Node 973/973. An earlier isolated Windows `EBUSY` cleanup race was cleared by the independent reasoning test and immediate rerun.
- command: `node --import tsx tests/validation/industry-seven-provider-product-quality-after-docling-ready.ts`
  result: Real run completed with parser preflight `READY`, Workflow `completed`, two acquisition waves, eight module calls, one Gateway, one ChangeSet, one Writer, MIIT `usableSourceCount=6`/`qualifiedEvidenceCount=3`, CPCA `usableSourceCount=2`/`qualifiedEvidenceCount=1`, Canonical validation passed, 16-section report generated, and final classification `INDUSTRY_PRODUCT_QUALITY_BLOCKED_BY_EVIDENCE`.

## Important Design Decisions

- Keep the distinction at the validation/evidence boundary: provider normalization is not equivalent to module acceptance.
- Resolve accepted evidence through its canonical candidate provider identity, preserving the existing seven-provider metric labels.
- Preserve the fail-closed product-quality classification and existing provider limits.

## Debugging Summary

- Before this change, `qualifiedEvidenceCount` reused provider `usableSourceCount`, overstating module-ready evidence.
- The latest real run demonstrates the corrected semantics: MIIT normalized six and had three accepted evidence items, while CPCA normalized two and had one accepted evidence item.
- CPCA has no `contributedModules` in this run because no CPCA evidence ID was assigned to a module; that remains an evidence-routing/product-coverage question, not a telemetry omission.

## Remaining Risks

- Most frozen modules remain unavailable because the current free-provider portfolio does not yield sufficient qualifying material for their gaps.
- External GDELT, Eastmoney, and AKShare failures remain variable and are recorded as bounded provider outcomes.

## Scope Deviations

- none

## Sol Review Notes

- Review CPCA’s accepted-but-unassigned evidence and module binding only if a deterministic, source-backed routing rule can be established; do not infer module contribution from provider usability alone.
