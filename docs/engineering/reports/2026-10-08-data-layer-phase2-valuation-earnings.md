# RHL-DL-GOAL-002 — Valuation and Earnings Data Layer Migration

## Status

**IMPLEMENTED / SOL ACCEPTANCE PENDING**

This report records implementation and repository validation. It does not
claim Sol acceptance, and Phase 2 has not been merged to `main`.

## Repository state

| Field | Value |
|---|---|
| Local repository | `C:\Users\Administrator\Desktop\ResearchHub` |
| Baseline branch | `main` |
| Phase 2 baseline / `origin/main` | `96a18ad514af91e71c787835dedcd110903982dc` |
| Phase 1 promotion on `main` | `96a18ad514af91e71c787835dedcd110903982dc` |
| Goal branch | `codex/dl-goal-002-valuation-earnings-migration` |
| Goal worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\DL_GOAL_002` |
| Implementation HEAD before Task 4 report/delivery commit | `dfc7b150a6e09a51a6e1c8b45e63a6e4160fd3a5` |
| Remote branch HEAD | Verify after delivery push; expected to equal the final local branch HEAD |
| Worktree | Clean before Task 4 acceptance edits; final clean state is verified after delivery |
| `main` | Still at `96a18ad514af91e71c787835dedcd110903982dc`; unchanged |

Phase 1 was already promoted and verified before Phase 2 began. Phase 2 is an
isolated branch based on that promoted commit. The Phase 1 branch/worktree
cleanup was completed after its merge verification; the Phase 2 worktree was
kept isolated. No Phase 2 commit is on `main`.

## Migration call chain

Before Phase 2, Valuation/Earnings Workflows held provider/source ladders,
provider parsing, and acquisition fallback alongside generic requirements.
The migrated normal application path is:

```text
Workflow materializes exact requirement
  -> DataResolver selects Data-owned Common SourcePolicy
  -> explicit Plugin operation executes and parses provider response
  -> DataResolver validates PIT, authority, completeness and provenance
  -> Workflow maps accepted typed values into existing Skill/report inputs
  -> existing Knowledge Gateway/Writer path
```

Provider-client injection remains available for direct callers and tests, but
uses the same explicit resolver/adapters. Workflow keeps exact filing and
correction preference, per-metric period checks, peer eligibility, and
report/Knowledge orchestration; those are domain decisions, not provider
fallback routing.

## Architecture delivered

- `data/` owns Phase 2 Common policies, requirements, DataResolver execution,
  market-close PIT availability, and normalized acquisition contracts.
- `plugins/research-acquisition/valuation-data.ts` and
  `earnings-data.ts` bind explicit source operations to DataResolver and keep
  provider response parsing at the Plugin boundary.
- `app/runtime/application-runtime.ts` explicitly composes the normal Valuation,
  Earnings, and management-communication resolver factories.
- Workflows materialize exact subject, metric, fiscal-period, and `asOf`
  requirements; map accepted resolver values to existing domain inputs; and
  retain report and Knowledge Gateway orchestration.
- DataResolver results preserve status, source/publisher authority, retrieval
  metadata, attempts, fallback, policy ID, conflicts, and explicit unavailable
  reasons. Historic numeric data without numeric value-version evidence is not
  upgraded to verified PIT data.
- Existing `workflows/research-data-acquisition/` compatibility exports still
  point to the canonical implementation under `data/`.

## Migration matrix

| Paths | Delivered responsibility | Remaining boundary |
|---|---|---|
| `data/contracts.ts`, `data/requirements.ts`, `data/valuation-earnings-policies.ts`, `data/resolver.ts`, `data/validation.ts`, `data/point-in-time.ts` | Typed Phase 2 requirements, independent Common metric policies, resolution, provenance/quality, strict market close availability | No policy ownership moved back into business Workflows |
| `plugins/research-acquisition/valuation-data.ts`, `valuation-normalization.ts` | Explicit market, annual EPS/BVPS, CNINFO publication, peer-family/scale operations and provider parsing | AKShare/CNINFO remain configured adapters, not universal source approval |
| `workflows/valuation/workflow.ts`, `contracts.ts`, `basis-evidence.ts` | Issuer requests, exact FY binding, separate EPS/BVPS mapping, PIT evidence, report/source mapping | Business eligibility, calculation, and report/Knowledge lifecycle remain Workflow/Skill-owned |
| `workflows/valuation/automatic-comps.ts` | Resolver-backed cohort, scale, targeted peer facts, market/financial/publication checks | Candidate identity, peer quality, deterministic ordering, caps, and rejection reasons remain domain logic |
| `plugins/research-acquisition/earnings-data.ts`, `earnings-financial-normalization.ts`, `earnings-financial-quality-normalization.ts` | Filing/financial executor composition, provider parsing, publication-bound selected rows, estimate projections | Provider-independent metric assembly and exact filing selection remain Workflow-owned |
| `workflows/earnings-review/workflow.ts`, `expectations-acquisition.ts`, `automatic-expectations.ts` | Filing and per-metric actual/expectation requirements; consumes resolver results | Workflow maps only accepted exact-period metrics, assembles consensus/revisions, calculates, and composes report |
| `plugins/research-acquisition/earnings-expectation-source-eastmoney.ts`, `earnings-expectations-eastmoney-akshare.ts`, `earnings-expectations-ths.ts` | EastMoney/THS source adapters and wire parsing | EPS and net-profit are resolved independently; wrong-year projections cannot satisfy target-year requirements |
| `plugins/research-acquisition/management-communication-data.ts`, `management-communication-contracts.ts`, `management-normalization.ts`, `management-dedupe.ts`; `workflows/management-communication-acquisition/workflow.ts` | Data-owned document/Q&A policies and resolver execution; Plugin normalization/deduplication | Workflow maps resolved documents/Q&A to the existing extraction and report lifecycle |
| `app/runtime/application-runtime.ts`, `app/services/research-service.ts`, `app/services/data-source-catalog.ts` | Explicit normal-path composition and Data-owned policy catalog visibility | Direct caller-injected clients remain as compatibility seams through the same resolver composition |
| `tests/app/services/data-layer-boundaries.test.ts` | Skills cannot import concrete provider parsing or DataResolver runtime; exact Workflow/Plugin dependency list rejects new coupling | Explicit exact entries remain for compatibility seams and truly deferred migrations |

## Common Data and PIT results

Phase 2 uses the existing Common identities for market close, EPS, BVPS,
annual-report publication, EPS/net-profit expectations, management documents,
and exchange Q&A. Valuation peer evidence reuses the Common market/financial/
publication identities with peer subject identity and exact fiscal period; peer
cohort evidence is bound to explicit operation requirements. No new Industry
metric is registered.

The 16 active Phase 2 policies are now Data-owned: `valuation-market-price-eastmoney`,
`valuation-eps-eastmoney`, `valuation-bvps-eastmoney`,
`valuation-annual-publication-cninfo`, `valuation-peer-candidate-eastmoney`,
`earnings-official-filing-cninfo`, five `earnings-actual-*` metric policies,
`earnings-expectations-eps-source-ladder-v0.1`,
`earnings-expectations-net-profit-source-ladder-v0.1`,
`d2-001-management-communication-documents`, `d2-001-sse-exchange-qa`, and
`d2-001-szse-exchange-qa`. Source order and fallback IDs are expressed on those
policies; a configured route is not a claim of universal source authority.

PIT evidence keeps analysis cutoff, fiscal/market period, publication time,
retrieval time, and numeric `valueVersion` separate. Shanghai daily close is not
available before 15:00 Asia/Shanghai on its observation date. Historical EPS,
BVPS, and actual financial values without verifiable numeric-version evidence
remain unavailable or explicitly version-unverified for historical conclusions.
EPS and BVPS can resolve independently without losing their source lineage.

## Skill impact

| Measure | Result |
|---|---|
| Skill methodology rewritten | No |
| Provider-specific Skill imports added | 0 |
| Concrete provider parser/resolver imports remaining in Skills | 0 |
| Provider parsing removed from Skill compatibility modules | Yes; moved to Plugin adapters and test/acceptance callers updated |
| Report/Knowledge boundary changed intentionally | No |

The architecture guard passes **9/9**. It also verifies that a new concrete
Workflow adapter import and a new Skill resolver/provider dependency fail
without an explicit exact baseline entry.

## Deterministic fixture acceptance

The final scoped command covered boundary, Data policy/resolver, Valuation,
automatic comps, Earnings, expectations, management, Data Source administration,
and route tests: **255 total; 253 passed; 2 failed**. The two failures are the
same brittle Valuation assertions present on untouched `origin/main`:

- `V39 acquisition calls all three AKShare methods` — the expected adapter call
  order differs from the resolver order.
- `V65 source acquisition time is distinct from historical valuation context`
  — the assertion depends on a fixed clock-call index.

The fixture E2E coverage includes Valuation issuer/peer requests through
DataResolver, Plugin execution, typed basis mapping, Skill calculations, report,
and Knowledge Gateway behavior; Earnings test `ER43` covers the same normal
Workflow-to-Gateway path. Regression coverage includes future publication,
correction-row binding, exact-period fallback, rejected metric filtering,
separate EPS/BVPS lineage, resolver-only expectation injection, and transport
failure classification. These fixture tests are not live-source evidence.

## Live-source evidence

| Command | Result |
|---|---|
| `RESEARCHHUB_RUN_REAL_EXPECTATIONS=1 npm run acceptance:earnings-expectations-d1-real` | `EXPECTATIONS_PRODUCT_PATH_VERIFIED`; normal DataResolver path, THS succeeded, 20 estimates across 10 institutions, one consensus snapshot, zero diagnostics; EastMoney fallback was not needed. Generated `2026-10-07T18:52:53Z`. |
| `RESEARCHHUB_RUN_REAL_VALUATION_BASIS=1 npm run acceptance:valuation-basis-d3-real` | Real financial rows were usable for all four targets and CNINFO publication records were found. Historical 2024 CNINFO publication checks for `600519` returned `CNINFO_KNOWN_RECORD_VERIFIED` after publication and `DATA_NOT_PUBLISHED` before publication. Market data was empty for `600519`; AKShare/EastMoney K-line transport failed for the other targets with Python `requests` `ProxyError` / `RemoteDisconnected`. Basis remained unavailable for all targets because market close was not obtained. Evidence: `runtime-data/validation/rhl-d3-001-real-acceptance.json` (local ignored runtime evidence). |
| `RESEARCHHUB_RUN_REAL_AUTO_COMPS=1 npm run acceptance:auto-comps-d3-real` | `REAL_TARGET_MARKET_TRANSPORT_UNAVAILABLE` for all four targets; accepted targets: none. Resolver-backed product path ran, but target market rows were empty/unavailable through the configured proxy, so peer selection and product success criteria could not be established. No fixture result is represented as live success. |

**REAL_SOURCE_BLOCKED (Valuation market/comps only):** live market transport
returned empty data for one target and a proxy disconnect for the others. The
financial and CNINFO publication legs did return live evidence. Earnings
expectations live acceptance succeeded as recorded above.

## Full validation and baseline comparison

| Command | Result |
|---|---|
| `npm test` | Client: **97/97 passed**. Node: **2,036 total, 2,011 passed, 25 failed**. |
| `npm run test:node` on detached `origin/main` baseline | **1,996 total, 1,971 passed, 25 failed**. |
| Exact Node failure comparison | Same 25 failing test identifiers on branch and baseline; no new deterministic failure. Phase 2 adds 40 passing Node tests. |
| `node --import tsx --test tests/app/services/data-layer-boundaries.test.ts` | **9/9 passed** |
| `npm run typecheck` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; Vite emitted the existing large-chunk advisory (628.73 kB JS asset) |
| `git diff --check` | PASS; Git reported only Windows LF/CRLF conversion notices |

The shared 25 baseline failures are:

- `tests/app/services/industry-research-integration.test.ts`: `Application
  Industry research projects canonical graph and replays semantic objects
  without duplication`.
- `tests/app/services/registries.test.ts`: `Workflow Definition Registry
  exposes the current executable research set`.
- `tests/app/services/research-skill-architecture.test.ts`: `Workflow metadata
  composes canonical peers without registering composite Skill IDs`.
- `tests/app/services/theme-workspace-projection.test.ts`: `Theme graph
  includes only human-confirmed scope refs, preserves direction, and never
  expands global edges`; `Industry projection returns bounded facts,
  deterministic core views, publication-labeled dates, future catalysts and
  competition units`; `semantic section classification receives only readable
  facts and cannot block the base projection`; `current restricted or expired
  source rights suppress company exposures and dependent competition data`;
  `company projection is readable through a canonical business exposure without
  adding a company graph node`; `stale expected revision and a corrupt scope
  ledger fail closed`.
- `tests/knowledge/production/competition-module-gateway.test.ts`: `Gateway
  creates a competition Module and maps its local proposal ID`; `Gateway blocks
  numeric Module cells that disagree with their canonical facts`; `same Industry
  table replays idempotently with the same canonical Module ref`;
  `evidence-backed cell update commits, and an unavailable update preserves the
  prior usable value`; `same Claim may support a canonical numeric display
  update after new provenance is admitted`; `Module blocks the whole submit
  when a cell reference cannot resolve`; `ChangeSet validation rejects denied
  or missing Raw evidence listed by a competition Module`; `Module blocks when
  the row Source payload is unusable`; `Module blocks unusable Source evidence
  inherited from an existing business_exposure Relation`; `new Claim provenance
  alone cannot justify a contradictory same-reference display value`; `Writer
  rejection does not report success or overwrite the prior Module`; `different
  rows may retain different currencies and a changed column schema blocks for
  review`.
- `tests/validation/codex-module-remaining-schema-deltas.test.ts`: `composition
  is source-immutable, deterministic and idempotent`.
- `tests/validation/codex-production-industry-schema-compatibility.test.ts`:
  `FIX-015 offline evidence inputs preserve authoritative contracts and expected
  source sizes`.
- `tests/workflows/valuation.test.ts`: `V39 acquisition calls all three AKShare
  methods`; `V65 source acquisition time is distinct from historical valuation
  context`.

## Residual gaps and Phase 3 readiness

- Valuation live market transport is blocked by the current proxy path; live
  financial and CNINFO legs succeeded. Re-run the same acceptance after market
  transport is available before claiming a live Valuation product success.
- Aggregator numeric value-version proof remains unavailable for historical
  numeric values; the implementation intentionally fails closed.
- Existing client-injection compatibility fields and exact Skill type-only
  Plugin contract entries remain documented seams. New parser/runtime Skill
  imports are rejected by the guard.
- The 25 unrelated baseline Node failures remain; their identifiers and count
  did not change from detached `origin/main`.
- Company, Event, Thesis, Industry, Daily Intelligence, and Knowledge
  architecture remain outside Phase 2. Industry source quality remains subject
  to the Phase 4 field-by-field review.

Phase 2 provides a DataResolver base for Phase 3 Company/Event/Thesis migration
after Sol acceptance and integration. This branch is not merged; Phase 3 must
start from the subsequently approved repository state.

## Delivery verification

The implementation and report are committed on the Goal branch, then pushed.
Final local and remote branch heads must match, the Goal worktree must be
clean, and `main` must remain at the Phase 1 promotion SHA. The final delivery
response records the exact pushed commit SHA after those checks.
