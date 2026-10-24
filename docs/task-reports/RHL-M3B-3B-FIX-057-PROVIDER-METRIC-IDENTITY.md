# Task Report

task_id: RHL-M3B-3B-FIX-057-PROVIDER-METRIC-IDENTITY
status: READY_FOR_SOL_REVIEW
baseline: 291b3523d2d191b1045a248fb0baa1128e93e973
branch: codex/m3b-3b-evidence-routing
implementation_commit: be110d853990e6a924186bdafdd4c838d8a63fb8
verified_remote_tip: be110d853990e6a924186bdafdd4c838d8a63fb8
sync_status: SYNCED
summary: Restore provider contribution attribution in the TEST-054 evidence harness by mapping candidate provider IDs to the stable seven-adapter metric names.
tests: Focused TEST-054 harness tests 8/8 passed; full npm test passed with client 21/21 and Node 972/972; repository typecheck and diff check passed; real TEST-054 completed the full Workflow/Gateway/ChangeSet/Writer path and preserved the fail-closed product-quality classification.
acceptance_criteria: Candidate IDs from existing adapters map to the exact seven-provider metric labels; MIIT evidence is attributed to industry_definition when accepted by the Workflow; unknown provider IDs remain visible instead of being silently coerced; no adapter, acceptance rule, or architecture boundary changes.
governance_status: Active governance manifest and applicable governance documents were read. The change is limited to TEST-054 validation telemetry and its focused test; no governance or architecture file was changed.
blockers: Product-quality acceptance remains blocked by insufficient evidence coverage in the current free-provider run. Provider contribution telemetry is now accurate for accepted evidence; no evidence is fabricated for providers whose material was not accepted by a module.
task_input_quality: complete
missing_information_resolved_by_luna: none

## Changes

- Added a bounded candidate-provider-to-metric-name mapping for `cninfo`, `gdelt`, `miit`, `govcn`, `eastmoney`, `cpca`, and `akshare`.
- Removed the ineffective provider lookup path and attributed module evidence through the canonical candidate provider identity.
- Added focused assertions for MIIT, CPCA, CNINFO, and unknown-provider behavior.
- Refreshed the sanitized TEST-054 evidence artifact from the latest real run.

## Validation Results

- command: `npx tsx --test tests/validation/industry-seven-provider-product-quality-after-docling-ready.test.ts`
  result: 8 tests passed.
- command: `npm run typecheck`
  result: Passed.
- command: `npm test`
  result: Passed after one isolated Windows `EBUSY` cleanup race was reproduced, the reasoning test passed independently at 12/12, and the immediate full rerun passed with client 21/21 and Node 972/972.
- command: `git diff --check`
  result: Passed; only line-ending normalization warnings were emitted.
- command: `node --import tsx tests/validation/industry-seven-provider-product-quality-after-docling-ready.ts`
  result: Real run completed with parser preflight `READY`, Workflow `completed`, two acquisition waves, eight module calls, one Gateway, one ChangeSet, one Writer, MIIT contribution attributed to `industry_definition`, Canonical validation passed, 16-section report generated, and final classification `INDUSTRY_PRODUCT_QUALITY_BLOCKED_BY_EVIDENCE`.

## Important Design Decisions

- Keep identity translation in the TEST-054 evidence boundary, where candidate provider IDs and user-facing adapter names are intentionally different.
- Preserve unknown values as-is so future or malformed provider identities remain diagnosable.
- Count a provider as contributing only when an accepted module evidence ID resolves back to that candidate provider; discovery or normalization alone does not imply module contribution.

## Debugging Summary

- The prior telemetry always emitted empty `contributedModules` because it compared candidate IDs such as `miit` with plugin metric names such as `miit-industry-research-acquisition`.
- The live rerun now reports MIIT `contributedModules: ["industry_definition"]`; CPCA remains empty because its live material was not accepted by a module in that run.
- The product-quality result remains blocked by evidence coverage, confirming that the telemetry fix does not relax the acceptance gate.

## Remaining Risks

- Market, supply-demand, chain, competitive, technology, company, and risk module coverage still depends on variable external provider results.
- GDELT, Eastmoney, and AKShare may fail or return no qualifying results in live runs; this remains an external/provider-coverage issue.

## Scope Deviations

- none

## Sol Review Notes

- Review the latest evidence artifact and continue source-gap work only through the existing seven adapters; do not add providers or weaken the product-quality gate.
