# RHL-EXEC-003-A-003 — Earnings Review Live Data & Expectations Closure

**Status:** IMPLEMENTED / SOL ACCEPTANCE PENDING
**Date:** 2026-10-10
**Branch:** `codex/exec-003-a-003-earnings-live-data`
**Baseline:** `origin/main` at `015d41431775953523ffd4d3dd753581fdf5e2fe`
**Implementation commit:** `cb4eec7` (`feat(earnings): close live actual data workflow`), followed by the audited report/runtime contract fixes recorded in the final delivery commit.

## 1. Baseline & Git State

The A-002 commit is an ancestor of `origin/main`. A-003 was built in the isolated `EXEC_003_A_003` worktree from the clean `015d414` baseline. No merge to `main` was performed. Final branch SHA, remote SHA, and worktree cleanliness are recorded after commit and push.

## 2. Current Earnings Runtime

Production execution now resolves official filing and structured actual requirements through the existing Earnings Review Workflow and DataResolver policies, invokes the registered CNINFO and AKShare acquisition plugins, and supplies accepted, period-bounded metrics to the Earnings Review Skill. The application entry point is `ResearchDispatchService.startAsync`; report and ResearchBundle persistence remain owned by the existing runtime. Deterministic fallback now reports supported actuals and derived growth/margin metrics while keeping unsupported cash flow, consensus, valuation, and guidance conclusions explicitly unavailable.

## 3. Official Filing Probe

All four target-period attempts retrieved an issuer-matched CNINFO filing with an exact fiscal period. The first `002487.SZ FY2025` dispatch did not start because identity resolution returned `unresolved_reference`; it is retained in the original live artifact. A retry using the verified exchange-qualified identity completed through the application path.

| Security / period | Filing | Announcement | Published (UTC) | Result |
|---|---|---:|---|---|
| 002487.SZ, FY2025 | 大金重工 2025年年度报告 | 1224997956 | 2026-03-05 16:00 | Available; retry completed |
| 002487.SZ, H1 2026 | 大金重工 2026年半年度报告 | 1225489611 | 2026-08-21 16:00 | Available |
| 600519.SH, FY2025 | 贵州茅台2025年年度报告 | 1225114741 | 2026-04-16 16:00 | Available |
| 600519.SH, H1 2026 | 贵州茅台2026年半年度报告 | 1225475868 | 2026-08-14 16:00 | Available |

The exact official URLs, retrieval timestamps, formal document types, and correction relations are preserved in the per-run evidence. All four final dispatches verified the requested issuer and exact period; no adjacent period or issuer was substituted. Filing selection requires identity, fiscal year, period, publication time, and the formal filing preference; future filings and unlinked corrections fail closed.

## 4. Actual Financial Data Probe

CNINFO supplied official document evidence. AKShare retrieved structured actuals published by EastMoney. The numeric value-version remains **UNVERIFIED** for all aggregator values; CNINFO filing publication does not prove the aggregator's historical numeric revision. Amounts below are CNY; EPS is CNY/share. YoY and margin changes are deterministic calculations against the comparable prior-year period.

| Security / period | Revenue | Net profit | Gross margin | EPS | Revenue YoY | Net profit YoY | Gross-margin change |
|---|---:|---:|---:|---:|---:|---:|---:|
| 002487, FY2025 | 6,173,550,246.46 | 1,103,297,424.75 | 31.1839% | 1.73 | +63.3365% | +132.8246% | +135.5961 bps |
| 002487, H1 2026 | 3,252,515,191.59 | 600,567,001.92 | 37.5255% | 0.94 | +14.4793% | +9.8902% | +935.5819 bps |
| 600519, FY2025 | 172,054,171,890.91 | 82,320,067,101.68 | 91.1796% | 65.66 | -1.2001% | -4.5323% | -75.1665 bps |
| 600519, H1 2026 | 92,278,072,083.21 | 44,516,880,421.86 | 89.5552% | 35.57 | +1.3001% | -1.9516% | -174.4097 bps |

Operating cash flow was unavailable in the retrieved structured actuals; it was not filled with zero. The deterministic Skill output reports available revenue, profit, margin, EPS, and comparable growth, and marks cash conversion unavailable. The gross-margin delta contract now uses `basis_points` consistently with the value and rendered report.

## 5. Fiscal Period & Unit Validation

The four periods are kept distinct (`FY` versus `H1`). Actual and comparator rows must match the requested fiscal period; annual estimates cannot satisfy H1 comparisons. Revenue/profit are normalized to CNY, gross margin and YoY values to percent, EPS to CNY/share, and gross-margin differences to basis points. Missing, invalid, future, incomparable, or conflicting values do not become usable metrics.

## 6. Numeric Version / PIT

Current-view reports may display sourced aggregator actuals with `CURRENT_VALUE_ONLY` / `UNVERIFIED` status. Fixed historical `asOf` requests still require the existing numeric value-version proof and block when the current aggregator response cannot prove that version. Official filing publication metadata is not treated as proof of an aggregator value revision. No PIT requirement was relaxed.

## 7. Expectations Source Ladder

The production SourcePolicy retains THS forecasts as primary, EastMoney individual research reports as fallback 1, and the already-registered legacy EastMoney route as fallback 2. FY2025 runs attempted THS and EastMoney and returned no usable expectations. H1 runs returned 20 THS estimates from 10 institutions; fallback was not selected after the primary returned estimates. Each estimate keeps institution, analyst, metric, fiscal period, unit, value, publication time, source candidate, original publisher, retrieval provider/time, and the issuer page for THS's institution forecast table (`https://basic.10jqka.com.cn/<ticker>/worth.html`) in the Earnings Snapshot. Provider attempts, empty/error reasons, and source counts are in the real E2E JSON. The final current-code H1 run verifies this source URL is rendered; the source candidate does not contain a per-report PDF URL, so the report links to the official company forecast table and preserves its individual source candidate ID.

## 8. Consensus & Revisions

No run produced a qualified consensus snapshot or a linked same-institution estimate revision. The 2026 H1 THS rows concern FY2026 and were published after the official H1 result cutoffs, so they do not constitute H1 consensus. The FY2025 samples had no usable estimate rows. Consensus and revision counts are therefore zero; no estimate was synthesized or averaged.

## 9. Actual vs Consensus Qualification

**ACTUAL_VS_CONSENSUS_REAL_DATA_GAP.** Every run has zero qualified actual-versus-consensus comparisons. Forecast period, metric, unit, publication cutoff, issuer, and institution identity requirements remain in force. FY forecasts were not compared with H1 actuals.

## 10. Financial Quality

Revenue and net-profit YoY, gross-margin movement, and available quality checks are deterministic. Operating cash flow, cash conversion, working-capital cycle, and FCF checks remain unavailable because required cash-flow and balance inputs were not returned. Unavailable components are enumerated in the persisted reports.

## 11. Management Guidance

No usable management-communication record was accepted in these runs. Diagnostics include no accepted CNINFO IR records and unsupported exchange routes for the current D2 path. Model timeouts did not create guidance or operating claims.

## 12. Valuation Impact & Thesis Filter

No verified consensus or expectation finding mapped to valuation inputs, so the report marks valuation implications unavailable. Read-only executions used `writeKnowledge=false`; unsupported evidence did not create thesis-impact claims or durable proposals. This does not alter the existing W4 Thesis Filter boundary.

## 13. ResearchReport & Bundle

Completed Workflow runs persisted and reloaded a 14-section ResearchReport and its ResearchBundle. Reports include verified security identity, period, filing metadata, financial publisher and retrieval provider, exact actuals, value-version status, evidence URLs, derived metrics, expectation source ladder and available forecasts, and explicit data gaps. Earnings Workflow results now retain financial-quality, expectation-analysis, and quality-gate status through the Application service boundary. Only real HTTPS evidence URLs are emitted; no synthetic canonical refs are added.

## 14. Real 002487 E2E

The final acceptance run completed both FY2025 and H1 2026 through `ResearchDispatchService.startAsync`. Both returned verified identity, exact CNINFO filings, usable structured actuals, 14-section report reloads, persisted Bundles, and unchanged isolated Knowledge. FY2025 expectation providers returned no usable forecasts; the H1 run produced 20 FY2026 forecasts from 10 institutions, with no period/cutoff-qualified H1 consensus. An earlier unresolved-identity dispatch remains documented in the original live artifact; it is not counted as a successful acceptance run.

## 15. Real 600519 E2E

The final acceptance run completed both FY2025 and H1 2026 with exact-period CNINFO filings and EastMoney financial values retrieved through AKShare. Both reports and Bundles reloaded. FY2025 expectation providers returned no usable forecasts. H1 returned 20 FY2026 forecasts from 10 institutions, with no qualified H1 consensus because the rows are annual and post-result. Financial reports mark numeric value versions `UNVERIFIED`; gross-margin movement is rendered in basis points.

## 16. Real Pi ModelRuntime

The normal application invoked `zhipu-openapi/glm-5.3-flash` for earnings synthesis in all four production runs. Both FY2025 outputs were validated and applied. Both H1 model calls timed out and were not applied; the deterministic Skill fallback completed the base review. This records both successful model synthesis and actual timeout/fallback behavior without attributing unsupported conclusions to the model.

## 17. Knowledge Read-only Validation

Every final live run used an isolated Schema 0.4 Knowledge Base and `writeKnowledge=false`. The before/after canonical object count remained 0, the digest remained unchanged, and report source/claim refs were empty. The final artifact records four persisted Bundles and zero canonical delta for each run. No user's mounted Knowledge Base was modified.

## 18. Full Test Results

- Focused Earnings/DataResolver/W2, THS acquisition/source URL, and official-disclosure suite after the final runtime/report fixes: **133/133 passed**.
- `npm test`: **2,167 passed, 21 failed of 2,188**. Against the A-002 baseline (**2,159 passed, 21 failed of 2,180**), exact normalized failing test names are identical: **0 new failures, 0 baseline failures cleared**. Full identifiers are committed in `tests/validation/evidence/RHL-EXEC-003-A-003-test-comparison.json`.
- `npm run typecheck`: PASS.
- `npm run client:typecheck`: PASS.
- `npm run client:build`: PASS; existing Vite warning reports a 638 kB minified client chunk.
- `git diff --check`: PASS (Windows line-ending conversion warnings only).

## 19. Remaining Data Gaps

- Actual-versus-consensus is a real data gap for all four periods; no same-period, pre-result consensus was available.
- Aggregator numeric historical versions remain unverified; fixed historical PIT use is blocked.
- Operating cash flow and inputs for working-capital/FCF quality are unavailable.
- Management-communication data was not accepted for these samples.
- H1 Pi synthesis timed out and deterministic fallback supplied the report narrative; both FY synthesis calls were validated and applied.
- H1 actual-versus-consensus remains a genuine source/period/cutoff gap; the annual forecasts are preserved and explicitly not compared with H1 actuals.

## 20. Final Commit & Delivery Status

Status remains **IMPLEMENTED / SOL ACCEPTANCE PENDING**. The final four-run live artifact is `tests/validation/evidence/RHL-EXEC-003-A-003-final-live-e2e.json`; the final current-code H1 source-provenance artifact is `tests/validation/evidence/RHL-EXEC-003-A-003-final-provenance-600519-h1.json`. A-003 is delivered on `codex/exec-003-a-003-earnings-live-data`; it is not merged into `main`. The final branch SHA, pushed remote SHA, and clean worktree are verified after commit and push and included in the delivery handoff. E2E artifacts are under `tests/validation/evidence/`.
