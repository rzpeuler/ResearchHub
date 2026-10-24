# Task Report

task_id: RHL-M3B-3B-FIX-056-INDUSTRY-GAP-TERM-FORWARDING
status: READY_FOR_SOL_REVIEW
baseline: 7153c606da5510a80c0c11706d1656775ca0c58f
branch: codex/m3b-3b-evidence-routing
implementation_commit: af88586543d6f363eac2af3181c47646c9a10f68
verified_remote_tip: af88586543d6f363eac2af3181c47646c9a10f68
sync_status: SYNCED
summary: Preserve explicit user search terms in Wave 1 and merge bounded Workflow gap search terms into Wave 2 acquisition requests; align TEST-054 with the production keyword path and correct MIIT PDF/HTML telemetry.
tests: Focused application/Workflow/TEST-054 tests 62/62 and follow-up 9/9 passed; full npm test passed with client 21/21 and Node 971/971; repository typecheck, client typecheck, client build, and diff check passed; live TEST-054 completed the production chain but remains blocked by evidence coverage.
acceptance_criteria: Wave 1 uses explicit application search terms; Wave 2 prioritizes Workflow gap terms and retains explicit base terms within the eight-term bound; MIIT PDF telemetry isolates expected PDF anchors from the official HTML anchor; no retry loop, provider expansion, or frozen architecture change is introduced.
governance_status: Active governance manifest and applicable governance documents were read. The change stays within M3B-3B acquisition control, validation telemetry, and test evidence; no governance or architecture file was changed.
blockers: Product-quality acceptance remains blocked by insufficient evidence coverage in the current free-provider run; the implementation task itself is complete and the Workflow/Gateway/Writer path executed successfully.
task_input_quality: complete
missing_information_resolved_by_luna: none

## Changes

- Updated `ResearchService.startIndustryResearch` so explicit user terms control Wave 1 while Wave 2 merges gap terms first with the explicit base terms and clamps the result to eight terms.
- Added an application integration assertion proving the exact Wave 1/Wave 2 keyword requests.
- Updated TEST-054 to use its frozen target search terms on Wave 1 and the same bounded merge on Wave 2.
- Added MIIT parser telemetry aggregation that distinguishes authoritative PCB anchors, expected PDF anchors, normalized character counts, and ordinary MIIT pages.
- Added a focused telemetry test for mixed authoritative PDF/HTML anchors and ordinary pages.
- Refreshed the sanitized TEST-054 evidence artifact from the latest real run.

## Validation Results

- command: `npx tsx --test tests/app/services/industry-research-integration.test.ts tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts tests/validation/industry-seven-provider-product-quality-after-docling-ready.test.ts`
  result: 62 tests passed after telemetry changes.
- command: `npx tsx --test tests/app/services/industry-research-integration.test.ts tests/validation/industry-seven-provider-product-quality-after-docling-ready.test.ts`
  result: 9 tests passed after acquisition keyword changes.
- command: `npm test`
  result: Passed: client 21/21 and Node 971/971. One preceding full run had a known Windows `EBUSY` temporary-directory cleanup race; the isolated reasoning test and immediate full rerun both passed, with no source change to that test.
- command: `npm run typecheck`
  result: Passed.
- command: `npm run client:typecheck`
  result: Passed.
- command: `npm run client:build`
  result: Passed; Vite production bundle generated successfully.
- command: `npm run document-parser:check`
  result: `READY` with Python, dependency, artifact, and bridge readiness true.
- command: `node --import tsx tests/validation/industry-seven-provider-product-quality-after-docling-ready.ts`
  result: Latest real run completed with `workflow.status=completed`, two industry-definition evidence items, eight module calls, one Gateway, one ChangeSet, one Writer, four total qualified evidence items, Canonical validation passed, 16-section report generated, and final classification `INDUSTRY_PRODUCT_QUALITY_BLOCKED_BY_EVIDENCE` because the remaining modules lacked sufficient qualifying evidence.

## Important Design Decisions

- Keep search-term composition in the existing Application-to-Workflow acquisition seam; do not create a Planner, Provider Layer, or new routing abstraction.
- Prioritize Wave 2 gap terms because the second wave exists specifically to address actionable gaps; retain explicit user terms as bounded context.
- Treat the authoritative HTML MIIT announcement as valid managed evidence while evaluating PDF media type only against the two expected PDF anchors.
- Preserve the existing fail-closed product-quality classification; do not convert gap-only material into a pass.

## Debugging Summary

- The live run demonstrated that the earlier MIIT route fix now works consistently: the `industry_definition` module received two authoritative MIIT evidence items.
- The first telemetry implementation incorrectly classified the legitimate HTML MIIT anchor as a PDF failure; the expected-PDF anchor set corrected this without changing acquisition behavior.
- The real run generated Canonical objects and a report, but the available providers supplied only definition/risk or limited evidence for the other modules. The failure is evidence coverage, not Gateway, Writer, or parser integrity.
- A Windows-only `EBUSY` cleanup race appeared once in the full test suite and disappeared on focused and immediate full reruns; it remains an environmental timing risk.

## Remaining Risks

- The PCB product-quality gate is not yet ready: market size/growth, supply-demand depth, industry chain, competitive landscape, technology, and company mapping still require qualifying evidence.
- GDELT, Eastmoney, and AKShare availability remains variable in the real run; no new provider or fallback source was added.
- `contributedModules` provider telemetry still uses provider-name labels that differ between plugin names and candidate provider IDs; this is observability debt for a later bounded task.

## Scope Deviations

- none

## Sol Review Notes

- Review the Wave 2 keyword merge semantics and the latest TEST-054 evidence before authorizing the next evidence-coverage task. The next implementation should improve source-gap coverage through the existing seven adapters, not relax the acceptance gate.
