# RHL-EXEC-003-A-001 — Security Identity & First-Research Eligibility

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

## Baseline and Git

| Item | Result |
| --- | --- |
| Repository | `C:\Users\Administrator\Desktop\ResearchHub` |
| Isolated worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\EXEC_003_A_001` |
| Branch | `codex/exec-003-a-001-security-identity` |
| EXEC-002 accepted HEAD | `18cb65175932da5ecf2d74acc03fbc6a5afc48f3` |
| `origin/main` at implementation start | `18cb65175932da5ecf2d74acc03fbc6a5afc48f3` |
| Ancestry check | EXEC-002 HEAD is an ancestor of `origin/main` |
| Implementation commit | `608730cb9789f537d9ccbe791af752bea6e9274b` |
| Final delivery commit | This report commit; exact SHA is verified against the local and remote branch HEAD in the delivery record |

The task branch starts from the current clean `origin/main`; the previous EXEC-002 accepted commit is already integrated. Work remains isolated and does not modify or merge `main`.

## Security identity architecture

`SecurityIdentityResolver` is shared by Company Research, Valuation, and Earnings Review. It first checks exact active Canonical Company identity when Knowledge lookup is allowed. Otherwise it resolves one bounded `security_identity_directory` DataRequirement through the existing `DataResolver` and SourcePolicy path backed by `AkshareDataAdapter.securityDirectory`.

Directory matches require exact normalized ticker, exchange, and supplied name. Ambiguous matches, mismatched name/code, Canonical conflicts, unavailable providers, and unsupported historical identity return explicit unresolved/conflict states. LLM-derived symbols and fuzzy or query-only guesses do not become verified identities. External directory identity is marked `S3_AGGREGATOR`; it is not presented as exchange-official. Current directory results are not used to establish historical identity. Cache size and TTL are bounded.

The resolver returns verified security identity separately from optional Knowledge coverage, data availability, and persistence permission. It does not create a Company.

## DataRequirement and SourcePolicy changes

- Added the typed security-identity query context and `security_identity_directory` requirement to the existing Data contract and validator.
- Registered a bounded `FIRST_VALID` policy for the exact `akshare.securityDirectory` operation.
- Added an adapter operation using AKShare's A-share code/name directory. It validates exact-query size, result size, ticker shape, and ticker-prefix/exchange consistency.
- Provenance records the public AKShare integration documentation, retrieval time, `AKShare A-share directory aggregation` publisher, and `S3_AGGREGATOR` authority.
- No second registry, Agent, Planner, Knowledge schema, or generic data engine was introduced.

## Dispatch and Knowledge coverage

For the three targeted Workflows, Dispatch resolves and enriches a trusted identity before required-field validation. A verified identity with no Canonical Company may start; an unresolved identity or Canonical conflict is blocked with explicit diagnostics. Empty Knowledge context is passed without synthetic refs. `structuredKnowledge=false` prevents Knowledge-context reads but does not prohibit verified read-only acquisition or change `writeKnowledge`.

Other Workflow reference validation remains unchanged. Existing Canonical Company lifecycle and exact-match checks remain in force.

## Company Research, Valuation, and Earnings Review changes

- **Company Research:** accepts a verified external identity with no Company coverage, passes verified name/ticker/exchange into the normal DataResolver and report path, and keeps `writeKnowledge=false` read-only. When writes are requested, existing quality gates and Knowledge Production Gateway/Writer remain the only canonical persistence path.
- **Valuation:** no longer requires `existingCompany()` before data acquisition. Verified identity permits normal market, financial, and publication requirements to resolve. Missing coverage does not create `subjectRefs`; no report or entity is fabricated. Existing period, unit, publication, PIT, source quality, and eligible-method gates remain decisive. DCF and Comps scope is unchanged.
- **Earnings Review:** verified identity permits requested-period filing and actual-data acquisition without a Canonical Company. Exact Q1/H1/Q3/FY, publication date, metric period/unit/PIT, consensus, management-communication, and Thesis lifecycle rules remain in force. Missing Thesis context is not fabricated.

## Existing Canonical Company compatibility

The isolated Canonical control resolves alias `茅台` and exact ticker `600519` to active `entity:company-kweichow` with `verificationSource=canonical_knowledge`; the external directory callback count is zero. Existing Valuation and Earnings tests continue to cover canonical Company reports and Gateway references. Canonical conflicts and inactive/out-of-window identity fail closed.

## First-research and no-coverage tests

Tests cover resolver and Dispatch cases for name-only input, explicit ticker/exchange, name/code mismatch, ambiguity, provider failure, exchange normalization, historical identity, canonical conflict, and prevention of semantic guesses. Dispatch tests cover automatic routing, manual Company selection, read-only mode with structured Knowledge disabled, and preserving unrelated Workflow reference checks.

Application-service and Workflow tests exercise first Company Research, Valuation, and Earnings Review through their actual ResearchService/Workflow acquisition paths with empty Schema 0.4 Knowledge. They verify DataResolver calls and report behavior without creating a Canonical Company when writes are disabled. HTTP route tests start the corresponding authoritative Workflow and observe terminal state through the same injected WorkflowService.

## Read-only policy verification

The first-research integration tests set `writeKnowledge=false` and verify no Company/entity is created. Gateway/Writer tests retain the existing single persistence boundary when writes are allowed. The real provider probe used an isolated temporary Schema 0.4 Knowledge Base and temporary report directory, with `writeKnowledge=false`; the isolated base had zero Company entities after the run. The user's mounted Knowledge Base was not used.

## PIT and quality-gate regression

Existing regression tests retain exact period matching, official filing publication cutoffs, annual basis and unit validation, future-data exclusion, value-version proof requirements, source quality, Thesis lifecycle checks, and Gateway allowlists. The real probe returned normalized annual EPS/BVPS rows, but their aggregator numeric value-version was `UNVERIFIED` and `pointInTimeSafe=false`; those values were not admitted to a usable valuation. Missing market data blocked PE/PB execution.

## DataResolver attempts

For the actual AKShare attempt on 2026-10-09:

| Requirement | SourcePolicy candidate | Resolver result | Quality / diagnostic |
| --- | --- | --- | --- |
| `valuation_eps` | `akshare-valuation-financial-indicators-eps` (`PRIMARY`) | `AVAILABLE` normalized financial row | `valueVersionStatus=UNVERIFIED`; `pointInTimeSafe=false`; `NUMERIC_VALUE_VERSION_UNVERIFIED_OR_PUBLICATION_MISSING` |
| `valuation_bvps` | `akshare-valuation-financial-indicators-bvps` (`PRIMARY`) | `AVAILABLE` normalized financial row | `valueVersionStatus=UNVERIFIED`; `pointInTimeSafe=false`; `NUMERIC_VALUE_VERSION_UNVERIFIED_OR_PUBLICATION_MISSING` |
| `valuation_market_price` | `akshare-historical-market-data` | `UNAVAILABLE`; candidate status `UNSUPPORTED` after the Python bridge command failed | `EXECUTOR_THROWN`; no market observation |

The production Valuation run also invoked `companyBasic`, `valuationFinancialIndicators`, and `historicalMarketData`. `companyBasic` returned zero rows; the financial API returned 70 normalized rows; market returned zero rows. The Workflow reported `VALUATION_MARKET_PRICE_UNAVAILABLE`, `usableForValuation=false`, and did not call semantic reasoning or write a report.

## Real `大金重工 / 002487.SZ` probe

Environment: Python 3.12.10, AKShare 1.18.64. AKShare emitted a Requests dependency compatibility warning (`urllib3` and `chardet`/`charset_normalizer`).

1. At `2026-10-09T14:47:18Z`, the real `stock_info_a_code_name` directory request returned an exact match: `大金重工`, ticker `002487`, exchange `SZ`. Identity was `VERIFIED` from `akshare_security_directory`, with S3 aggregator authority and public AKShare provenance.
2. In the same isolated run, `ResearchService.startValuation` proceeded through real Application/Workflow acquisition and called `basic`, `valuation-financial`, and `market`. It blocked because no market price was returned. `companyBasic` had 0 rows; 70 financial rows were received; PE/PB basis indicators existed, but the valuation source quality/PIT gates and missing market price prevented usable computation. `writeKnowledge=false`; the temporary Knowledge Base remained without Company entities.
3. At `2026-10-09T14:48:01Z`, a second directory request failed with `SOURCE_ERROR` / `AKSHARE_SECURITY_DIRECTORY_FAILED`; a same-run direct DataResolver probe still received financial EPS/BVPS rows, which failed PIT/value-version quality, while the market bridge failed. This shows provider availability is not stable.
4. A separate isolated control resolved `茅台 / 600519` from its active Canonical Company and made zero directory-provider calls.

**Real-provider result:** `REAL_PROVIDER_E2E_BLOCKED` for a complete usable valuation. Identity verification succeeded once, but a retry failed; market evidence was unavailable; aggregator financial rows lacked verifiable numeric revision/PIT proof. No live earnings-quality or real Company Research acceptance is claimed. The failure is reported rather than replaced by fixture data.

## Mock versus real evidence

- **Deterministic fixture evidence:** resolver safety, dispatch contracts, no-coverage first research, Workflow calculations, report rules, persistence gates, and source-quality/PIT rejection.
- **Real provider evidence:** AKShare directory and financial endpoints were attempted from the concrete adapter; one exact identity response and financial rows were received; a directory retry and market retrieval failed. These results are separate from test fixtures and are not evidence of production data coverage.

## Workflow acceptance matrix

| Workflow | `IDENTITY_VERIFIED` | `DISPATCH_START_VERIFIED` | `DATA_ACQUISITION_ATTEMPTED` | `DATA_USABLE` | `DOMAIN_COMPUTATION_VERIFIED` | `REPORT_VERIFIED` | `PRODUCT_QUALITY_READY` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Company Research | Yes (fixture directory + Canonical control) | Yes | Yes through fixture DataResolver; no complete real-source probe | Fixture evidence only | Yes in deterministic workflow tests | Yes, including read-only/no synthetic refs | No; live source coverage not established |
| Valuation | Yes; real 002487 exact match succeeded once, retry failed | Yes | Yes; real market, financial, and basic calls observed | No for a usable live valuation; EPS/BVPS fail PIT and market is unavailable | Yes in deterministic valuation tests; no live calculation | Yes for fixture/canonical reports; real blocked run correctly produced no report | No |
| Earnings Review | Yes (fixture directory + Canonical control) | Yes | Yes through fixture filing/actual-data resolvers | Fixture evidence only | Yes for period and calculation paths in tests | Yes for fixture/canonical reports and no fabricated Thesis | No; no real-source earnings run established |

## Tests and validation

| Validation | Result |
| --- | --- |
| Route, homepage, integrations, legacy ResearchService regression set | 21/21 passed |
| Identity, Dispatch, Plugin, Company, Valuation, and Earnings focused set | 172 passed; 1 failed (`V65`, matching baseline timestamp assertion) |
| `npm test` client | 122/122 passed |
| `npm test` Node (final rerun) | 2,160 total; 2,138 passed; 22 failed |
| Exact Node failure-identifier comparison | Baseline: 2,134 total, 2,111 passed, 23 failed; all 22 current failures are in baseline; 0 new failure identifiers; baseline `V39` now passes |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; Vite reports existing 638.08 kB minified chunk above the 500 kB advisory threshold |
| `git diff --check` | Passed; only expected LF-to-CRLF notices |

The final Node run had 2,160 tests, 2,138 passing, and 22 failures. The 22 current failure identifiers are all present in the 2,134-test baseline; exact comparison found zero new failures and one baseline failure fixed. The remaining failures are existing Knowledge, Theme, Industry, architecture, validation fixture, and `V65` timestamp failures. The full suite exits nonzero because those baseline failures remain; it is not reported as green. Final log: `%TEMP%\rhl-exec003-a-001-final3-npm-test.log`.

Exact unchanged failing identifiers:

- `research-skill-architecture.test.ts`: `Workflow metadata composes canonical peers without registering composite Skill IDs`.
- `theme-workspace-projection.test.ts`: `Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges`; `Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units`; `semantic section classification receives only readable facts and cannot block the base projection`; `current restricted or expired source rights suppress company exposures and dependent competition data`; `company projection is readable through a canonical business exposure without adding a company graph node`; `stale expected revision and a corrupt scope ledger fail closed`.
- `competition-module-gateway.test.ts`: `Gateway creates a competition Module and maps its local proposal ID`; `Gateway blocks numeric Module cells that disagree with their canonical facts`; `same Industry table replays idempotently with the same canonical Module ref`; `evidence-backed cell update commits, and an unavailable update preserves the prior usable value`; `same Claim may support a canonical numeric display update after new provenance is admitted`; `Module blocks the whole submit when a cell reference cannot resolve`; `ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module`; `Module blocks when the row Source payload is unusable`; `Module blocks unusable Source evidence inherited from an existing business_exposure Relation`; `new Claim provenance alone cannot justify a contradictory same-reference display value`; `Writer rejection does not report success or overwrite the prior Module`; `different rows may retain different currencies and a changed column schema blocks for review`.
- `codex-module-remaining-schema-deltas.test.ts`: `composition is source-immutable, deterministic and idempotent`.
- `codex-production-industry-schema-compatibility.test.ts`: `FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes`.
- `valuation.test.ts`: `V65 source acquisition time is distinct from historical valuation context`.

The fixed baseline identifier is `V39 acquisition calls all three AKShare methods` in `valuation.test.ts`.

## Remaining A-002 / A-003 blockers

- Stable real AKShare directory access is not established; the second real lookup failed.
- Current market bridge retrieval for `002487` failed, so no live PE/PB result or complete Valuation report can be accepted.
- EastMoney/AKShare annual EPS/BVPS rows lack numeric value-version proof and are correctly rejected by the PIT quality gate.
- Real-source Earnings Review and Company Research were not independently accepted in this probe. Further provider/PIT source work belongs in the scoped A-002/A-003 follow-ups, not a new generic data framework in this task.

## Git delivery

Implementation and report are ready for commit and push on `codex/exec-003-a-001-security-identity`. Final local/remote SHA and clean worktree will be recorded after delivery. `main` is not merged or modified by this task.
