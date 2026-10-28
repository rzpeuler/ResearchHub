# Company Research P0-19 CLOSE-002 progress

**Task:** `RHL-CQR-P0-19-CLOSE-002`
**Status:** `IN_PROGRESS`; Gate 4 has not passed and P0-19 remains `NOT_ACCEPTED`.
**Scope of this record:** Gate 0 baseline capture and the first private Gate 1 point-binding slice.

## Gate 0 baseline

- Task branch: `codex/company-research-p0-01-06`; starting HEAD and remote branch HEAD: `0bc37b4d89ba02139e6ae09539b15a087a71a7ec`.
- `origin/main` and merge-base: `51fd2112c0767a664bba4e887e7debb031fcf66e`.
- The existing UI commit `1010df8` remains separate from this slice. No branch reset or force push was used.
- The latest paired live runs are BYD `82bcc425-d48d-4e55-bc45-111aa8c28ba4` and Dongshan `860916a8-4958-4d29-8da1-56ad5dd1c2c6`; both are blocked at 17/19, with `bull-base-bear` and `variant-perception` failing and zero semantic-review attempts.
- The baseline manifest `tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json` records report JSON hashes, source candidate IDs and content hashes, read-only Knowledge hashes, and the inherited Node/client regression identities. It contains no source body text.
- The inherited regression baseline is 21 Node failures and 5 client failures; baseline comparison recorded zero added and zero disappeared failures. Those results are not a passing full-suite result.
- Other pre-existing modified evidence files and ignored local runtime artifacts were left out of this slice.

## Gate 1 implementation slice

The Plugin now attaches a private `EarningsEstimatePointProof` to each normalized estimate row from native EastMoney, the EastMoney AKShare route, and THS. It binds the estimate ID, source candidate ID, provider row/field, metric, value, unit, period, institution, publication timestamp, and a deterministic hash of the observed row. The sidecar stays outside the public `EstimatePoint` contract. The earnings-review acquisition joins proofs back to estimate points and rejects mismatches or missing proof records.

This establishes current-row binding only. It does **not** establish immutable historical value versions, correction/revision history, or EPS definition basis. Those statuses remain `UNVERIFIED`; no proof is promoted to eligible historical PIT evidence. This slice has not yet wired the proof qualification into the Company Research variant-perception selector, so it does not close the blocked section or satisfy G1 acceptance.

The source-field audit has not established document-level proof for either provider. The current THS route provides an aggregate row without original report identity, exact document locator, immutable version, correction ID, or EPS basis. The current EastMoney routes expose a report-like identifier and forecast row but do not yet prove immutable value-version history, correction status, EPS definition basis, or exact accessible source document for every estimate. No report PDF was fetched or redistributed in this slice.

## Validation for this slice

- `node --import tsx --test tests/workflows/earnings-expectation-source-eastmoney.test.ts tests/workflows/earnings-expectations-acquisition-d1.test.ts` — 24 passed, 0 failed. These are deterministic fixture tests, not live-provider or Company Research acceptance.
- `npm run typecheck` — passed.
- `git diff --check` — passed; Git emitted only existing LF-to-CRLF notices for unrelated modified evidence files.
- Full Node/client regressions and the paired live Company Research acceptance were not rerun for this slice.

## Remaining gates

Gate 1 still needs provider-by-provider point coverage against authorized original documents/version evidence and integration with Company Research eligibility. Gate 2 needs a validated, source-bound research assumption plan and deterministic three-scenario calculations. Gate 3 needs two genuinely distinct economic expectation surfaces. Gate 4 requires fresh BYD and Dongshan 19/19 runs, actual semantic review, report/sidecar evidence, regression checks, and unchanged Knowledge hashes. Until all of Gate 4 passes, the task remains `NOT_ACCEPTED`.
