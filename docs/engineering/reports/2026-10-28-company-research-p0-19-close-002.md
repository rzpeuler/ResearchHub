# Company Research P0-19 CLOSE-002 progress

**Task:** `RHL-CQR-P0-19-CLOSE-002`
**Status:** `IN_PROGRESS`; Gate 4 has not passed and P0-19 remains `NOT_ACCEPTED`.
**Scope of this record:** Gate 0 baseline, Gate 1 point binding and eligibility audit, and Gate 2 scenario candidate integration with independent economic review and deterministic report monitoring.

## Gate 0 baseline

- Task branch: `codex/company-research-p0-01-06`; starting HEAD and remote branch HEAD: `0bc37b4d89ba02139e6ae09539b15a087a71a7ec`.
- `origin/main` and merge-base: `51fd2112c0767a664bba4e887e7debb031fcf66e`.
- The existing UI commit `1010df8` remains separate from this slice. No branch reset or force push was used.
- The latest paired live runs are BYD `82bcc425-d48d-4e55-bc45-111aa8c28ba4` and Dongshan `860916a8-4958-4d29-8da1-56ad5dd1c2c6`; both are blocked at 17/19, with `bull-base-bear` and `variant-perception` failing and zero semantic-review attempts.
- The baseline manifest `tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json` records report JSON hashes, source candidate IDs and content hashes, read-only Knowledge hashes, and the inherited Node/client regression identities. It contains no source body text.
- The inherited regression baseline is 21 Node failures and 5 client failures; baseline comparison recorded zero added and zero disappeared failures. Those results are not a passing full-suite result.
- Other pre-existing modified evidence files and ignored local runtime artifacts were left out of this slice.

## Current delivery snapshot

- Code snapshot tested for this update: `f722b745791873bc45ebb63b973a823836d56fa4`; scenario and monitoring changes are `6ef02c9` (verified scenario-to-monitoring linkage) and `f6b7d72` (conditional reference-PE sensitivity). Current task delivery also includes `f722b74` (progress and blocker documentation).
- Task commits since starting SHA include `b70a699` (point-to-row binding), `b8634b8` (verified point-proof eligibility), `fccfa55` (scenario-plan validation), `5a7a0f1` (sealed `asOf` availability check), `f5c59f2` (initial gated FY2026 scenario builder), `8edffe8` (Workflow promotion only after independent review), `69ccc0d` (auditable scenario assumptions), `6ef02c9` (monitoring linkage), `f6b7d72` (conditional PE sensitivity), and `f722b74` (status documentation). The unrelated UI commit `1010df8` remains separate.
- Current `origin/main` and merge-base remain `51fd2112c0767a664bba4e887e7debb031fcf66e`.

## Gate 1 implementation slice

The Plugin now attaches a private `EarningsEstimatePointProof` to each normalized estimate row from native EastMoney, the EastMoney AKShare route, and THS. It binds the estimate ID, source candidate ID, provider row/field, metric, value, unit, period, institution, publication timestamp, and a deterministic hash of the observed row. The sidecar stays outside the public `EstimatePoint` contract. The earnings-review acquisition joins proofs back to estimate points and rejects mismatches or missing proof records.

This establishes current-row binding only. It does **not** establish immutable historical value versions, correction/revision history, or EPS definition basis. Those statuses remain `UNVERIFIED`; no proof is promoted to eligible historical PIT evidence. The Company Research selector is now wired to the proofs. It checks exact point/source/provider/metric/value/unit/FY/institution/publication binding, actual source retrieval no later than the sealed `asOf`, allowed public/AI/retention rights, and verified basis, value-version, and correction statuses. The current adapters always return `UNVERIFIED` for those statuses, so current points remain excluded and no channel median is calculated.

The Gate 1 audit found that the saved sidecars omit projected estimate rows/proofs and exact candidate counts, and that both pairs of forecast acquisitions finished after the run's sealed `asOf`. THS does not provide an immutable original report, exact document locator, correction history, or EPS basis. EastMoney may expose report identifiers/URLs, but current code does not bind each value to a verified immutable document/version or EPS basis. No authorized current route can pass Gate 1 for these saved reports. See `2026-10-28-company-research-p0-19-close-002-gate1-audit.md`. No report PDF was fetched or redistributed.

The private `scenario-assumptions.ts` builder and validator now have a Workflow path. They bind FY2023–FY2025 revenue and parent-attributable net-profit values to matching annual-report rows, cross-check FY2026 H1 separately, and recompute the historical min/mid/max operating candidate plus 3×3 revenue-growth × parent-profit-growth sensitivity. Per-assumption audit fields now include scenario/year/basis, scope, exact base row and normalized-text hash, assumption origin, derivation, dependencies, counterevidence, falsification trigger, confidence limits, and an explicit `OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION` status. A required independent-review field assesses falsifiability. The candidate remains outside the first synthesis evidence ledger until all six Bear/Base/Bull × revenue/parent-profit decisions and scenario checks pass; it is then available to the second synthesis within existing call budgets. The final report promotes it only if the complete-report review also passes; otherwise the scenario and dependent thesis/checklist remain gaps. This closes the candidate's source/assumption audit contract but **does not complete G2-03**: no qualified forward valuation method/multiple or valuation outcome is available. Structural validity and historical calibration alone still do not establish economic reasonableness. FY2026 H1 remains separate counterevidence.

## Validation for this slice

- `node --import tsx --test tests/workflows/earnings-expectation-source-eastmoney.test.ts tests/workflows/earnings-expectations-acquisition-d1.test.ts` — 24 passed, 0 failed in the earlier Gate 1 slice. These are deterministic fixture tests, not live-provider or Company Research acceptance.
- Earlier Gate 1 validation: `node --import tsx --test tests/workflows/company-valuation-sections.test.ts tests/workflows/company-scenario-assumptions.test.ts` — 17 passed, 0 failed; and `npm run typecheck` passed.
- Current Gate 2 integration validation is recorded after execution below; tests use deterministic synthetic fixtures, not live-provider or Company Research acceptance.
- Full Node/client regressions and paired live Company Research acceptance have not passed for this delivery.

## Gate 2 Workflow integration update (2026-10-28)

- Added a source-exact scenario candidate renderer to the existing valuation section path. It exposes six FY2026 operating formulas, all nine sensitivity cells, annual source locators, and separate H1 counterevidence; it does not create probabilities or a target price.
- The first synthesis cannot consume the candidate as verified evidence. The existing independent semantic reviewer now has a bounded six-item scenario contract requiring rationale, completed-method support references, counterevidence references, and per-decision reasons for Bear/Base/Bull × revenue/parent-attributable net profit.
- Only after all six decisions and scenario section checks pass does the workflow promote the candidate into a second synthesis, within the existing two synthesis and two review budgets. Final report eligibility requires another complete-report review; otherwise the scenario and dependent thesis/checklist remain gaps.
- `node --import tsx --test tests/workflows/company-deep-research.test.ts tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-semantic-quality.test.ts tests/workflows/company-valuation-sections.test.ts` — 110 passed, 0 failed. Includes synthetic fixture coverage for first-ledger exclusion, six-decision approval, second-synthesis promotion, missing decisions, and final-risk failure; it is not live Company Research acceptance.
- `npm run typecheck` — passed.
- `git diff --check` — passed; Git reported line-ending normalization notices only.

## Gate 2 deterministic valuation and monitoring update (2026-10-28)

- The valuation section now adds a fail-closed conditional FY2026 per-share sensitivity only when the as-of close, FY2025 basic EPS, FY2025 parent-profit source row/hash/rights, and all scenario grid calculations bind and reconcile. It keeps the unchanged-reference-PE and unchanged-share-count assumptions explicit and labels results as derived sensitivities, not forecasts or target prices. Unsupported inputs retain a visible gap and diagnostic.
- After synthesis, the Workflow adds one deterministic falsifiable Base assumption checklist row only when the scenario ledger is verified, the bounded independent scenario review passed, and both the exact annual-base and same-metric H1 cross-check locators are present in verified evidence. Model-authored rows with the same marker are removed; the annual trigger is kept separate from interim monitoring, and the final locator set is checked before return for complete-report review.
- Added tests for recalculation/monotonicity, tampering, missing or restricted source evidence, invalid grids, approved checklist insertion, exact citations, and fail-closed missing/unapproved scenario evidence.
- `node --import tsx --test tests/workflows/company-research-assembly.test.ts tests/workflows/company-valuation-sections.test.ts tests/workflows/company-deep-research.test.ts tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-semantic-quality.test.ts` — 224 passed, 0 failed.
- `npm run typecheck` — passed; `npm run client:typecheck` — passed; `npm run client:build` — passed with the existing large-chunk warning; `git diff --check` — passed with line-ending notices.
- Final-source full regressions against baseline commit `dcfb144b0a81f0f3995bf1f64c9371e98c487ad5`: `npm run test:node` — 3216 tests, 3195 passed, 21 failed; comparator result `BASELINE_FAILURES_IDENTICAL`, zero new, disappeared, or changed failures. `npm run client:test` — 223 tests, 218 passed, 5 failed; `(filePath, testTitle)` identities match the five inherited baseline failures exactly. These are baseline-compatible results, not full-suite passes. The recorded result is `tests/validation/evidence/company-research-p0-19-regression-post-f722b74.json`.

## Remaining gates

Gate 1 remains blocked on an authorized, cutoff-compatible original-report/value-version proof. Existing saved EastMoney report URLs and forecast rows do not include captured PDF hashes, exact value locators, or correction/version evidence; THS remains unqualified. Gate 2 now includes a conditional reference-PE sensitivity path and deterministic scenario-to-checklist linkage, but these do not establish a qualified forward valuation basis or multiple; the candidate rates are historically calibrated and remain subject to concrete company-specific economic review. Gate 3 still lacks two genuinely distinct, comparable economic expectation surfaces. Gate 4 still requires fresh BYD and Dongshan 19/19 runs on one code SHA, actual 19-section semantic review, full independently readable reports/sidecars via an authorized channel, unchanged Knowledge hashes, and the already-recorded baseline-compatible type/build/regression evidence. Until all Gate 4 criteria pass, the task remains `NOT_ACCEPTED`.
