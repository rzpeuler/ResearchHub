# Company Research P0-19 CLOSE-002 progress

**Task:** `RHL-CQR-P0-19-CLOSE-002`
**Status:** `IN_PROGRESS`; Gate 4 has not passed and P0-19 remains `NOT_ACCEPTED`.
**Scope of this record:** Gate 0 baseline, private Gate 1 point binding and eligibility, and the initial Gate 2 scenario-plan validator.

## Gate 0 baseline

- Task branch: `codex/company-research-p0-01-06`; starting HEAD and remote branch HEAD: `0bc37b4d89ba02139e6ae09539b15a087a71a7ec`.
- `origin/main` and merge-base: `51fd2112c0767a664bba4e887e7debb031fcf66e`.
- The existing UI commit `1010df8` remains separate from this slice. No branch reset or force push was used.
- The latest paired live runs are BYD `82bcc425-d48d-4e55-bc45-111aa8c28ba4` and Dongshan `860916a8-4958-4d29-8da1-56ad5dd1c2c6`; both are blocked at 17/19, with `bull-base-bear` and `variant-perception` failing and zero semantic-review attempts.
- The baseline manifest `tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json` records report JSON hashes, source candidate IDs and content hashes, read-only Knowledge hashes, and the inherited Node/client regression identities. It contains no source body text.
- The inherited regression baseline is 21 Node failures and 5 client failures; baseline comparison recorded zero added and zero disappeared failures. Those results are not a passing full-suite result.
- Other pre-existing modified evidence files and ignored local runtime artifacts were left out of this slice.

## Current delivery snapshot

- Current task-branch HEAD and remote HEAD: `5a7a0f1` (`fix(research): enforce forecast snapshot cutoff`).
- Task commits since starting SHA: `b70a699` (point-to-row binding), `b8634b8` (verified point-proof eligibility), `fccfa55` (scenario-plan validation), and `5a7a0f1` (sealed `asOf` availability check). The unrelated UI commit `1010df8` remains outside the new task commits.
- Current `origin/main` and merge-base remain `51fd2112c0767a664bba4e887e7debb031fcf66e`.

## Gate 1 implementation slice

The Plugin now attaches a private `EarningsEstimatePointProof` to each normalized estimate row from native EastMoney, the EastMoney AKShare route, and THS. It binds the estimate ID, source candidate ID, provider row/field, metric, value, unit, period, institution, publication timestamp, and a deterministic hash of the observed row. The sidecar stays outside the public `EstimatePoint` contract. The earnings-review acquisition joins proofs back to estimate points and rejects mismatches or missing proof records.

This establishes current-row binding only. It does **not** establish immutable historical value versions, correction/revision history, or EPS definition basis. Those statuses remain `UNVERIFIED`; no proof is promoted to eligible historical PIT evidence. The Company Research selector is now wired to the proofs. It checks exact point/source/provider/metric/value/unit/FY/institution/publication binding, actual source retrieval no later than the sealed `asOf`, allowed public/AI/retention rights, and verified basis, value-version, and correction statuses. The current adapters always return `UNVERIFIED` for those statuses, so current points remain excluded and no channel median is calculated.

The Gate 1 audit found that the saved sidecars omit projected estimate rows/proofs and exact candidate counts, and that both pairs of forecast acquisitions finished after the run's sealed `asOf`. THS does not provide an immutable original report, exact document locator, correction history, or EPS basis. EastMoney may expose report identifiers/URLs, but current code does not bind each value to a verified immutable document/version or EPS basis. No authorized current route can pass Gate 1 for these saved reports. See `2026-10-28-company-research-p0-19-close-002-gate1-audit.md`. No report PDF was fetched or redistributed.

The private `scenario-assumptions.ts` now has a source-exact FY2026 candidate builder and validator. It binds FY2023–FY2025 revenue and parent-attributable net-profit values to the matching year columns in annual report rows, cross-checks FY2026 H1 current/prior values separately, and recomputes the historical min/mid/max operating assumptions and independent 3×3 revenue-growth × parent-profit-growth sensitivity grid. The plan is deliberately returned as `candidate_requires_semantic_review`: the validator may report structural integrity, but `valid` and `reportEligible` remain false because historical calibration alone does not prove economic reasonableness. This remains **unintegrated**: no Workflow call path, renderer, section evidence wiring, or report use is present. FY2026 H1 is counterevidence, not blended into the annual calibration.

## Validation for this slice

- `node --import tsx --test tests/workflows/earnings-expectation-source-eastmoney.test.ts tests/workflows/earnings-expectations-acquisition-d1.test.ts` — 24 passed, 0 failed. These are deterministic fixture tests, not live-provider or Company Research acceptance.
- `node --import tsx --test tests/workflows/company-valuation-sections.test.ts tests/workflows/company-scenario-assumptions.test.ts` — 17 passed, 0 failed on the current working tree (7 selector/eligibility tests and 10 scenario-builder/validator tests; fixture-only, not live acceptance).
- `npm run typecheck` — passed.
- `git diff --check` — passed; Git emitted line-ending notices for modified files.
- Full Node/client regressions and the paired live Company Research acceptance were not rerun for this slice.

## Remaining gates

Gate 1 remains blocked on authorized immutable point/version and EPS-basis evidence; the saved sidecars also lack per-point audit detail. Gate 2 needs a source-exact plan builder, deterministic operating projections and 3×3 sensitivity, report/evidence integration, and semantic review of actual assumptions. Gate 3 still lacks two genuinely distinct, comparable economic expectation surfaces. Gate 4 requires fresh BYD and Dongshan 19/19 runs on one code SHA, actual 19-section semantic review, full independently readable reports/sidecars via an authorized channel, regressions/type/build checks, and unchanged Knowledge hashes. Until all Gate 4 criteria pass, the task remains `NOT_ACCEPTED`.
