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
- The valuation section may show a current-earnings reference PE when filing EPS and market close are verified. Bull/Base/Bear remains an explicit gap unless sourced target-year operating assumptions and aligned sensitivity inputs exist; consensus EPS extrema multiplied by a fixed PE are rejected as a substitute. Variant Perception shows reproducible contributor rows for inspection, but remains a gap when historical estimate value versions are unverified.
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

### Saved-run reviewer period recheck (2026-10-27)

The second persisted BYD reviewer response for run `053565c3-b7d4-42b0-b005-fc1f907bbb89` incorrectly described the 2024-12-31 to 2025-12-31 revenue comparison as `2025—2025`. A deterministic recheck of the cited `akshare-financial-002594` source (`contentHash=0ebda24acb6f218e8a52956db1e941a549f65b0932cd6f3ec362a9792cea0a80`) and the two report sections confirms 2024 revenue of CNY 777,102,455,000 and 2025 revenue of CNY 803,964,958,000. The new reconciliation clears only that period false positive when the cited structured source and both values match. It retains the independent semantic failures in Bull/Base/Bear and Variant Perception. This was a deterministic replay of saved run data; no new model call was made and the persisted report remains blocked. The sanitized replay record is `tests/validation/evidence/company-research-p0-19-review-period-reconciliation.json`. `node --import tsx --test tests/workflows/company-semantic-quality.test.ts` passed 63/63.

### Variant contributor reproducibility (2026-10-27)

The deterministic Variant Perception section now lists each retained institution's FY2026 EPS value and unit, publication timestamp, and exact source citation. Alias normalization and cross-provider overlap retention remain Workflow-owned and unchanged; `UNVERIFIED` value-version status remains visible. This makes the two displayed provider medians independently recomputable from the report while preserving the PIT blocker. `node --import tsx --test tests/workflows/company-valuation-sections.test.ts` passed 3/3 synthetic-input tests. The saved live BYD report predates this rendering change, so a root-Runtime rerun is still required.

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

## Follow-up repairs and latest Dongshan read-only attempt (2026-10-27)

- `business_driver_analysis` false-positive investigation: the original failing run’s saved source excerpt has a complete H1 product table context (section marker `official-296fff2b2889c26f@paragraph:773`, table header at paragraphs 764–768, and matching product row at paragraph 775). A replay using persisted `sourceSummary` and evidence excerpts did not reproduce the validator rejection. The validation-time in-memory source text/index snapshot is absent, so the original cause remains unproven and the fail-closed validator was not relaxed.
- A separate regression test now strips only a leading numbered-list ordinal before counting numeric table cells; a narrative percent figure such as `32.92%` no longer becomes an apparent two-cell table row. `tests/skills/company-methods.test.ts` passed 128/128.
- Numeric grounding now ends the scope of a preceding operand direction at an explicit positive divergence result cue (`背离为/达/约为`). The saved Dongshan prepared-growth spread `68.5972` replays as grounded; wrong magnitudes and negative results remain rejected. The omitted goodwill aggregate row remains a valid rejection: the method needs to cite `official-39e591fa149e4543@paragraph:7672` (`268,811,941.95元`). `tests/skills/company-numeric-grounding.test.ts` passed 116/116.
- Citation repair now supports a consecutive cluster of unavailable paragraph locators only when one unique supplied source contains every exact locator and the combined excerpt passes semantic and numeric grounding. Exact saved `business_model_map` replay repaired paragraphs 1321–1324 to `official-296fff2b2889c26f` and validated complete. This is a deterministic saved-output replay, not a new live run.
- Latest live Dongshan run `59fca1a2-127b-4d24-aed0-24171d2b5441` remains `blocked` at 15/19 before the scenario/vintage fail-closed changes. `business-model`, `business-segments`, `supply-chain`, and `valuation` passed structural checks; `business_driver_analysis` failed twice on numeric grounding at paragraph 775, and `company_risk_analysis` failed twice (including the missing goodwill aggregate locator). The run’s disposable Knowledge Base remained unchanged. No independent review was reached because content quality was incomplete.
- New Workflow quality checks reject consensus-extrema/fixed-PE scenarios and unverified Variant Perception vintages. The scenario builder now emits a sourced-operating-driver gap rather than target prices or implied returns; the Variant section prefixes its unverified-vintage gap while retaining the inspectable contributor table.
- Validation for this follow-up: `node --import tsx --test tests/skills/company-methods.test.ts tests/skills/company-numeric-grounding.test.ts` passed 244/244; `node --import tsx --test tests/workflows/company-valuation-sections.test.ts tests/workflows/company-content-quality.test.ts` passed 149/149; the focused adjacent-cluster citation repair passed 1/1; `npm run typecheck` and `git diff --check` passed. The full citation-repair file has four assertion-count failures in `repairCompanyTrailingSourceIdTypo` cases (expected 1/2 repairs, observed 2/3); that helper is not changed by this diff. This turn did not establish whether those four failures also occur at the branch baseline.

P0-19 remains blocked. The unknown runtime table-context rejection, the missing goodwill citation in a live model attempt, and BYD acceptance/independent review remain unresolved.
