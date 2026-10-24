# Task Report

task_id: RHL-M3B-3B-FIX-055-INDUSTRY-EVIDENCE-MODULE-ROUTING
status: READY_FOR_SOL_REVIEW
baseline: 8c0b9ee3557525481d9957f7ac1d0a9adaafca97
branch: codex/m3b-3b-evidence-routing
implementation_commit: 90c034f6ecd6c1c53d74f95bedb1b7410145d551
verified_remote_tip: 90c034f6ecd6c1c53d74f95bedb1b7410145d551
sync_status: SYNCED
summary: Make authoritative MIIT PCB definition anchors route explicitly to industry_definition and correct TEST-054 evidence validation/provenance accounting.
tests: Focused acquisition/workflow/quality tests 61/61 passed; full npm test passed; typecheck passed; Docling preflight READY; latest live TEST-054 run was externally blocked during model execution.
acceptance_criteria: Explicit module routing is covered by production and workflow tests; canonical validation receives KnowledgeAssetV04 values; durable provenance counts only Claim/Relation proposals; no frozen architecture boundary changed.
governance_status: Active governance manifest and applicable governance documents were read. Scope remains within M3B-3B evidence routing and validation observability; no architecture or governance rule was changed.
blockers: Latest live TEST-054 run classified INDUSTRY_PRODUCT_QUALITY_BLOCKED_BY_EXTERNAL_PROVIDER after model transport failures and provider variability; this is not a routing or canonical-validation defect.
task_input_quality: complete
missing_information_resolved_by_luna: none

## Changes

- Added `moduleHints: ['industry_definition']` to the bounded MIIT PCB definition anchors.
- Added an assertion that every PCB definition anchor carries the exact producer-neutral module hint.
- Updated the workflow fixture to exercise `moduleHints`, matching the production metadata contract.
- Corrected the live validator harness to validate loaded asset `.value` objects rather than storage wrappers.
- Corrected live provenance accounting so only durable Claim/Relation proposals require source-candidate provenance; Entity proposals remain allowed by the contract.
- Refreshed the persisted TEST-054 evidence artifact with the latest real-run result.

## Validation Results

- command: `npx tsx --test tests/plugins/research-acquisition/miit-industry.test.ts tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts tests/validation/industry-seven-provider-product-quality-after-docling-ready.test.ts`
  result: 61 tests passed.
- command: `npm test`
  result: Passed: client suite (21 tests) and Node suite.
- command: `npm run typecheck`
  result: Passed.
- command: `git diff --check`
  result: Passed.
- command: `npm run document-parser:check`
  result: `READY` (`pythonReady`, `dependencyReady`, `artifactsReady`, and `bridgeReady` all true).
- command: `node --import tsx tests/validation/industry-seven-provider-product-quality-after-docling-ready.ts`
  result: Latest live run completed its harness and persisted evidence, but was blocked by external model/provider failures before industry-definition synthesis; canonical validation passed and durable proposal provenance was complete for the produced proposals.

## Important Design Decisions

- Use the existing producer-neutral `moduleHints` metadata route rather than adding MIIT-specific routing logic to Workflow.
- Keep the bounded MIIT anchors authoritative and first-class; do not broaden discovery terms or revive a legacy ingestion path.
- Treat the latest live failure as an external-provider classification because the corrected harness passed canonical and provenance checks and the production workflow returned a bounded provider failure.

## Debugging Summary

- The first post-fix live run reached completed workflow execution and produced industry-definition evidence, proving the explicit route fix worked.
- That run exposed a harness issue: `validateKnowledgeV04Objects` was given loaded storage wrappers instead of their `.value` fields, producing false `V04_OBJECT` diagnostics.
- The same run exposed a second harness issue: evidence-free Entity proposals were incorrectly included in the durable provenance requirement. Both issues were corrected and covered by the focused suite.
- A subsequent live run failed at model execution/provider acquisition variability; it did not reproduce either harness diagnostic.

## Remaining Risks

- A successful live TEST-054 run still requires a stable model runtime and successful external provider responses; the latest persisted artifact is intentionally classified as externally blocked.
- The current live telemetry reports normalized MIIT content hashes and counts, but normalized character length is not populated by the existing instrumentation; this is observability debt, not a canonical-data acceptance failure.
- Full module coverage remains dependent on the bounded external evidence set and model/provider availability.

## Scope Deviations

- none

## Sol Review Notes

- Review the explicit MIIT `moduleHints` contract and the corrected TEST-054 harness classifications before accepting the next live rerun as product-quality evidence.
