# Company Research P0-19 — Workflow Implementation Record

**Task:** `RHL-CQR-P0-19-CHANGE-001`
**Date:** 2026-10-27 (Asia/Shanghai)
**Status:** Workflow implementation validated with fixtures; live BYD and Dongshan acceptance remains blocked / not established.

## Scope delivered

- Company Research now requires all 19 stable report sections. Fourteen sections retain their atomic-method owners, three quantitative sections (`valuation`, `bull-base-bear`, `variant-perception`) are explicitly Workflow-owned, and `investment-thesis` plus `monitoring-checklist` remain the two synthesis-owned sections.
- Persisted ResearchReport metadata validation now accepts a passed semantic review only when it contains all 19 checks, matching the Workflow reviewer contract.
- The Workflow acquires read-only valuation and earnings inputs inside the existing shared 10-minute acquisition budget. It records resolver attempts, item status, and diagnostics in the analysis sidecar, and passes the quantitative sections and their exact source candidates into normal report assembly and quality review.
- Company Deep Research collects both existing FY EPS surfaces using the existing Data `COLLECT_DIVERSE` mode. This policy is scoped to Company Research EPS; Earnings Review retains its existing `FIRST_VALID` route. No provider, metric ID, public Data schema, Skill tier, or Knowledge write path was added.
- Institution aliases are canonicalized and overlapping contributors are assigned once to the latest published estimate (same-date ties use the Tonghuashun row). The Variant Perception section compares provider-exclusive same-period/unit medians only when both have at least two eligible institutions. It explicitly labels forecast value-version status `UNVERIFIED` when historical revision proof is absent; otherwise it stays a gap.
- The current deterministic scenario output uses the verified FY annual-report EPS and current unadjusted close for a reference PE, then applies the selected current FY consensus low/median/high EPS at the same PE. It does not assign probabilities. This is a bounded valuation sensitivity; an independent semantic review may still reject it if it does not establish operating-driver cases and counterevidence.
- An exact supplied-citation inventory now reaches the `business_driver_analysis` method so it can repair a citation only to a locator that was actually supplied to that method. Existing source locator validation remains fail-closed.
- The BYD live run exposed an ambiguous filing-EPS extraction: the FY2025 annual report repeats EPS in a later share-capital table. Extraction now requires the EPS row to appear under the numbered `主要会计数据和财务指标` section and after a year header containing the requested fiscal year plus a comparison year. Repeated eligible rows across official filings remain ambiguous and fail closed.

## Validation

Commands run from the repository root:

| Command | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-semantic-quality.test.ts tests/workflows/company-content-quality.test.ts tests/workflows/company-deep-research.test.ts tests/workflows/company-valuation-sections.test.ts tests/workflows/company-research-assembly.test.ts tests/workflows/data-layer-valuation-earnings.test.ts tests/workflows/earnings-data-resolver.test.ts tests/skills/company-methods.test.ts` | 486/486 passed |
| `node --import tsx --test tests/app/services/research-report.test.ts` | 13/13 passed |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; Vite reports the existing 743 kB main JS chunk size warning |
| `git diff --check` | Passed |

### Numeric unit-label regression (2026-10-27)

The cited official-row parser now binds bare values to `%` when the same row's metric label explicitly declares `(%)`, while keeping `percentage_points` distinct. A focused synthetic filing-row test covers both the accepted percentage claim and a rejected percentage-point substitution. `node --import tsx --test tests/skills/company-numeric-grounding.test.ts` passed 115/115 tests. This fixture verifies numeric grounding behavior; it is not additional live-provider or report-acceptance evidence.

The tests use labeled synthetic fixtures for resolver/provider and filing rows. They do not constitute live-provider or report acceptance evidence. Integration coverage confirms a run without quantitative resolver inputs remains `blocked`, leaves the three Workflow-owned sections as explicit gaps, performs only the existing single synthesis call, skips independent review, and leaves the Knowledge tree unchanged.

## Live read-only acceptance attempt (2026-10-27)

The root Runtime was run with the saved `openai-codex / gpt-6-luna` configuration, a disposable temporary Knowledge Base, and `writeKnowledge=false`. Both before/after Knowledge Base hashes matched. The reports and sidecars remain in local `runtime-data/company-quality-acceptance/2026-10-27-p0-19-post-integration/`; raw live source/report bodies are not committed.

| Company | Run ID | Result | Research quality | Material findings |
|---|---|---|---:|---|
| BYD (`002594`) | `a5e8f1e8-b964-4f1f-8461-931b3a61eb04` | `blocked` | 12/19 | `product_technology_analysis` failed both attempts on unverified customer/performance inferences; `business_driver_analysis` failed both attempts because the industry classification marker and numeric row context conflicted. Filing EPS was present in the source but the pre-fix extractor found conflicting rows, leaving valuation and scenario sections blocked. |
| Dongshan Precision (`002384`) | `fcfc76b7-ef7a-459a-9461-59f357c8fc8f` | `blocked` | 11/19 | `business_model_map` failed both attempts on unrecognized official-report locators; `business_driver_analysis` failed both attempts because the product classification marker and numeric row context conflicted. Valuation and scenario sections remained structurally incomplete. |

The BYD run's annual report has a FY2025 summary EPS row under the main financial-data heading and a repeated EPS row in a later share-capital section. The two runs in the table above predate the committed extractor repair; the post-fix verification below confirms the repaired EPS input is usable, while the overall report remains blocked. The market-data provider recorded an EastMoney proxy error and a successful Tencent fallback. EPS, BVPS, annual-report publication-date, peer-candidate, and both EPS-source probes succeeded; historical consensus value versions remain unverified. `variant-perception` passed its structural check in the first two runs, but that does not satisfy the report-level or independent semantic acceptance gate.

### BYD post-fix verification

After the EPS extractor repair, BYD was rerun read-only with the same saved model and settings. Run ID: `053565c3-b7d4-42b0-b005-fc1f907bbb89`; report ID: `company-research-002594-053565c3-b7d4-42b0-b005-fc1f907bbb89`; terminal status: `blocked`. The repaired filing input was usable: the valuation check returned all review dimensions as true in both reviewer outputs. This confirms the duplicate-row extraction issue is addressed for this report. The complete report still failed the quality gate: the first reviewer response was rejected as `FORMAT_ERROR` because it marked supply-chain numeric reproducibility false while its reason said the computed value was correct; the retry consumed the shared two-call content-review budget without a usable result, producing `SEMANTIC_REVIEW_BUDGET_EXHAUSTED`. Final persisted quality is incomplete (0/19 accepted checks), so the successful valuation check does not establish report acceptance. The report is saved locally as `runtime-data/company-quality-acceptance/2026-10-27-p0-19-eps-fix/002594-company-research-002594-053565c3-b7d4-42b0-b005-fc1f907bbb89.md` with its analysis sidecar; neither is committed.

All 10 atomic research methods completed in this run. The reviewer output also identified substantive unresolved issues: the 2024–2025 revenue comparison was labeled `2025—2025`; Bull/Base/Bear reused consensus EPS extrema and a fixed historical PE without operating-driver calibration; and provider consensus medians could not be independently reproduced from institution-level inputs or verified historical vintages. The temporary Knowledge Base was unchanged (`unchanged=true`; all three before/after hashes matched). This run remains blocked and must not be represented as successful real acceptance.

## Remaining acceptance work

- The read-only runs above exercised the new Workflow integration but were blocked. The post-fix BYD run confirms the filing-EPS repair but remains blocked by content-review format/budget failure and substantive report issues. Resolve these findings and the Dongshan method-level locator/numeric-context failures before acceptance.
- The provider probes found matching FY EPS units and dates before the cutoff, but do not prove historical forecast value versions. Keep the visible `UNVERIFIED` qualification and fail closed for historical requests without version evidence.
- The generated Bear/Base/Bull cases are a consensus-EPS and fixed-multiple sensitivity. The independent review must determine whether the supplied operating drivers, counterevidence, and link to monitoring are adequate; passing structural checks alone is not completion.
- P0-19 remains incomplete until both real read-only reports pass all 19 required-section checks and the independent semantic gate. No completion claim is made by this implementation record.

## Test data and persistence boundary

Synthetic resolver/provider and filing examples are maintained in the targeted test files. No live provider body, credential, or production Knowledge data was added to the repository. Runtime logs and generated parser cache files are local artifacts and are excluded from this change.
