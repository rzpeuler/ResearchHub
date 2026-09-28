# Thesis lifecycle acceptance evidence

Date: 2026-09-24

Task: `RHL-TL-001`
Classification: isolated v0.4 Knowledge Base setup plus real configured-Pi REFRESH and human-decision HTTP acceptance. This is not product-path CREATE E2E.

## Result

The real acceptance script completed with `EXECUTED / PASS GATE` and exit code 0. It used the normal ResearchService/Application HTTP REFRESH and ReviewCase decision paths with the configured `PiReasoningExecutor` (`zhipu-openapi/glm-5.3-flash`). The script fetched and normalized a live original-publisher CNINFO filing, verified an exact model-returned source span against the normalized text, and verified public access, retention, AI-processing, derivative-knowledge rights, and the archived Raw hash. The evidence artifact contains no credentials or source body.

The user’s `ai-hardware-real` Knowledge Base was not mounted or changed. To establish a controlled v0.4 baseline, the script seeded an isolated temporary Knowledge Base through the Gateway with the live CNINFO Source/Raw and proposition records. That setup is explicitly not counted as product CREATE E2E.

`EXECUTED / PASS GATE` here applies to the real REFRESH and human-decision path. The separate product CREATE path also passed its real E2E gate on 2026-09-25; see `docs/engineering/reports/2026-09-24-thesis-lifecycle-create-acceptance.md`. Aggregate `invalidated` remains blocked until a canonical kill-criterion definition can be rebound and re-evaluated at ACCEPT.

## Lifecycle assertions

- Refresh completed through HTTP with real model operations and produced a durable Thesis-scoped ReviewCase for a possible invalidation.
- The refresh retained an unchanged proposition alongside the challenged proposition.
- DEFER was durable and left the canonical revision and canonical object hashes unchanged.
- ACCEPT was submitted through HTTP and committed through Gateway/Writer; a fresh Knowledge Base reload observed revision 2, the expected challenged status and reviewed edge.
- Replaying the identical ACCEPT returned the existing result without advancing the canonical revision. The report reflected `ACCEPTED`, and the case disappeared from the actionable HTTP listing.

## Parser prerequisite

Before setup, `npm run document-parser:check` reported `MANAGED_PYTHON_MISSING`. After checking the repository-managed target was absent and the project setup’s staged install/rollback behavior, `npm run document-parser:setup` completed successfully. The post-setup check reported `READY`, Docling 2.116.0, Torch 2.14.0+cpu, CPU-only, and a ready parser bridge. The setup changed only the ignored project-managed parser environment; no global Python installation was performed.

## Artifacts and repeatable checks

- Machine-readable live run evidence: `tests/validation/evidence/RHL_TL001_THESIS_LIFECYCLE_REAL_E2E.json`.
- Real acceptance entry point: `scripts/acceptance-thesis-lifecycle-real.ts`.
- Deterministic HTTP closure integration test: `tests/app/runtime/thesis-lifecycle-closure.integration.test.ts`. This test uses a controlled reasoning executor and is supporting test evidence, not a substitute for the real run.
- The live run used a disposable temporary v0.4 Knowledge Base; its run identifiers, proposition references, and lifecycle revisions are in the JSON evidence. No user Knowledge Base data was included in that artifact.

## Later closure

The `invalidated` limitation documented above was closed in the separate [2026-09-28 TL-001 final acceptance](2026-09-28-thesis-lifecycle-final-closure.md). This report retains the scope and result of the earlier ordinary REFRESH acceptance.
