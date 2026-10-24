# RHL-EXEC-004-001 — Live Provider Reliability & Product E2E Closure

**Status:** IMPLEMENTED / SOL ACCEPTANCE PENDING
**Baseline main:** `46c53a1a15845a44b28ccbbfc87e9c776c8a6842`
**Branch:** `codex/exec-004-001-live-provider-reliability`
**Worktree:** `ResearchHub_worktrees/EXEC_004_001`

## 1. Baseline & Git State
A-004 SHA `46c53a1a15845a44b28ccbbfc87e9c776c8a6842` is an ancestor of `origin/main`; this task worktree was based on that clean SHA. Root checkout remained on its existing DL Phase 4 branch. Baseline on Node v24.16.0: Client 124/124; Node 2,185/2,206 with 21 known failing identifiers. See [baseline evidence](../../../tests/validation/evidence/RHL-EXEC-004-001-baseline.json).

## 2. Root Cause Investigation
Before edits, real probes found EastMoney Requests ProxyError for both symbols before any origin HTTP response; Windows Internet Settings had a configured local proxy and no proxy environment variables were set. Tencent succeeded in the same environment. Four exact-period CNINFO PDFs downloaded and passed PDF integrity checks. Docling initialized but conversion exceeded 150 seconds. All four PDFs had a usable text layer and exact-period/financial-statement markers. See the linked [market](../../../tests/validation/evidence/RHL-EXEC-004-001-P0-A-market-diagnostics.json), [CNINFO](../../../tests/validation/evidence/RHL-EXEC-004-001-P0-A-cninfo-document-diagnostics.json), [Docling timing](../../../tests/validation/evidence/RHL-EXEC-004-001-P0-A-docling-stage-profile.json), and [initial probe](../../../tests/validation/evidence/RHL-EXEC-004-001-P0-A-docling-initial-probe.json).

| Problem | Stage/result | Minimum response |
|---|---|---|
| EastMoney | ProxyError, no origin status | Keep proxy; classify error; use configured fallback |
| Tencent | Real history returned for both symbols | Verify resolver selection in production HTTP path |
| Sina calendar | 8,797 sessions, full range | Retain PIT and coverage checks |
| CNINFO | Four exact FY/H1 records and PDFs | Preserve announcement, URL, period, publication and hash |
| Docling | Conversion exceeded 150s after init | Bounded text-first parsing for qualified PDFs, Docling fallback |

## 3. EastMoney Transport
EastMoney remains unavailable through this machine's configured proxy. Errors are categorized separately (proxy, DNS/network, access denial, API/schema, Bridge, timeout, parse and other). No proxy bypass, TLS weakening, credential or relay was introduced.

## 4. Tencent Fallback
Production DataResolver attempted EastMoney PRIMARY, then selected Tencent FALLBACK_1 for both targets. The live HTTP evidence records the attempts, selection and publisher attribution.

## 5. Market Data Normalization
Tencent/AKShare supplied unadjusted CNY closes on 2026-10-09: 002487.SZ = 43.75; 600519.SH = 1,263. Reports retain security, date, currency, adjustment, publisher, retrieval provider, source, retrieval time, availability and freshness. Values are not averaged.

## 6. Trading Calendar & PIT
AKShare/Sina returned 8,797 dates, 1990-12-19 through 2026-12-31, covering the requested period. Both closes were FRESH at the tested 2026-10-11 Shanghai cutoff, with zero completed sessions missed. Future/unclosed bars, insufficient calendar coverage, stale observations and unproven historical numeric versions remain rejected.

## 7. CNINFO Official Discovery
Exact records: 002487 FY2025 announcement 1224997956 (published 2026-03-05), H1 2026 1225489611 (2026-08-21); 600519 FY2025 1225114741 (2026-04-16), H1 2026 1225475868 (2026-08-14). Discovery and publication evidence is in the CNINFO artifact. Publication metadata is not body or value-version proof.

## 8. PDF Download & Integrity
All four official PDFs returned HTTP 200 and passed PDF magic/EOF checks. Sizes (0.8–1.8 MB) and SHA-256 hashes are in the parser probe; raw PDFs/text were not committed.

## 9. Docling Performance
Managed Docling 2.116.0 and CPU Torch 2.14.0+cpu were available. A real 002487 FY2025 profile measured 5,071 ms import and 52 ms converter initialization; conversion exceeded 150,000 ms. Production timeout is capped at 120,000 ms; concurrency is capped at two, waiters are cancellable, and failures are bounded/diagnosable.

## 10. Alternative Parsing Path
Pinned pypdf 6.12.1 now extracts page-located text into StructuredDocument after PDF, size, page and text-coverage validation. It uses full SHA-256 identity, bounded process execution, cancellation and temp cleanup. Insufficient text falls back to Docling. Complex tables are not reconstructed by this path.

## 11. Document Content Quality
PDFs require at least 1,500 normalized characters, matching year and fiscal period, and at least two of three statement groups. Issuer, official status, exact-period, correction/summary, publication-time and PIT gates remain intact. The four tested filings passed; insufficient text and period mismatch remain explicit gaps.

## 12. Cache/Deduplication
The E2E requested each period once and each distinct PDF was parsed once in the production probe. No duplicate conversion was observed; no persistent cache was added.

## 13. Financial Data & Exact Period
Structured actuals were parsed for exact FY2025 and H1 2026. Revenue / net profit / gross margin / EPS: 002487 FY = CNY 6,173,550,246.46 / 1,103,297,424.75 / 31.1839% / 1.73; H1 = 3,252,515,191.59 / 600,567,001.92 / 37.5255% / 0.94. 600519 FY = 172,054,171,890.91 / 82,320,067,101.68 / 91.1796% / 65.66; H1 = 92,278,072,083.21 / 44,516,880,421.86 / 89.5552% / 35.57. Eligible consensus snapshots were unavailable; FY expectations were not compared to H1 actuals.

## 14. Live 002487 Valuation
HTTP Application run completed with report/bundle persistence and reload. FY2025 EPS 1.73 and BVPS 12.9836121393 (EastMoney); CNINFO 1224997956 verified annual-report publication. Current PE/PB = 25.2890/3.3696. Historical value-version is UNVERIFIED; basis is CURRENT_VALUE_ONLY.

## 15. Live 600519 Valuation
HTTP Application run completed with report/bundle persistence and reload. FY2025 EPS 65.66 and BVPS 195.3554497279 (EastMoney); CNINFO 1225114741 verified publication. Current PE/PB = 19.2355/6.4651. Historical value-version is UNVERIFIED.

## 16. Live 002487 Earnings
FY2025 and H1 2026 runs completed using exact-period official body evidence, structured actuals, persisted/reloaded reports and bundles, with expectation gaps explicit and Knowledge writes disabled.

## 17. Live 600519 Earnings
FY2025 and H1 2026 runs completed using exact-period official body evidence, structured actuals, persisted/reloaded reports and bundles, with expectation gaps explicit and Knowledge writes disabled.

## 18. Unified Application HTTP E2E
Eight real HTTP runs covered Company Research, Valuation, Earnings FY2025 and H1 2026 for both targets. Every run completed through ResearchDispatchService, verified identity, ResearchService, Workflow, real providers, DataResolver/SourcePolicy, Skill, Report and Bundle. Run IDs, attempts, selections, diagnostics and reload evidence are in [live HTTP E2E](../../../tests/validation/evidence/RHL-EXEC-004-001-live-http-e2e.json). A separate Pi ModelRuntime valuation completed acquisition/calculation but synthesis timed out and used deterministic fallback.

## 19. Read-only Knowledge Integrity
All runs used writeKnowledge=false and an isolated KB. Every full tree retained the same 17 paths and identical before/after digest; canonical objects, raw archive/manifests/registry, ReviewCase and revision were unchanged. Reports contain zero canonical refs and retain real HTTPS evidence links. Final digest: `22968b97087cc3b34780483280cdfd7e14908316e0a299c00a9b975955d7ff83`.

## 20. ResearchReport & ResearchBundle
All eight reports and bundles were persisted and reloaded. Report, bundle and workflow run IDs and terminal states reconciled. No unpersisted canonical references were claimed.

## 21. Full Regression Comparison
Focused parser/Earnings tests: 115/115 passed. Final full run: Client 124/124; Node 2,192/2,213 passed, 21 failed. Baseline was 2,185/2,206 with 21 failures. Exact identifier comparison is recorded in final-regression evidence; no new failures. Typecheck, client typecheck and client build pass. Vite retains its >500 kB chunk warning.

## 22. Product Readiness Verdict
**PERSONAL_RESEARCH_V1_CANDIDATE.** Both targets completed the four core operations through the real application path with traceable sources and synchronized read-only artifacts. This does not claim consensus or model-synthesis gaps are solved.

## 23. Remaining Product Gaps
EastMoney remains blocked by this configured proxy; Tencent fallback succeeds. Eligible consensus is unavailable. Company profile/business evidence and GDELT have gaps. Docling complex-table conversion remains slow; pypdf does not reconstruct tables. One real model synthesis timed out and fell back. EPS/BVPS historical numerical versions remain unproven. Some management communication output/schema diagnostics remain unsupported.

## 24. Final Git State
Branch: `codex/exec-004-001-live-provider-reliability`, based on `46c53a1a15845a44b28ccbbfc87e9c776c8a6842`. This branch has not been merged to main. Final local/remote SHA and clean worktree are verified after push.

**Engineering report:** `docs/engineering/reports/2026-10-11-exec-004-001-live-provider-reliability.md`
**Evidence:** `tests/validation/evidence/` (RHL-EXEC-004-001)