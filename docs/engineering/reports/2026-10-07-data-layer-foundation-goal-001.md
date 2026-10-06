# RHL-DL-GOAL-001 — Data Layer Foundation & Dual Catalog Architecture

## Status

**IMPLEMENTED / SOL ACCEPTANCE PENDING**

This report records implementation evidence for Data Layer Phase 1. It does not claim architecture acceptance. Full repository validation is not green: 25 Node tests fail in the same eight files on this branch and were reproduced against untouched `main` at the same baseline. Focused Data Layer tests, type checks, and the client build pass.

## Repository State

| Field | Value |
|---|---|
| Local repository | `C:\Users\Administrator\Desktop\ResearchHub` |
| Baseline branch | `main` |
| Baseline HEAD | `a61be14a3d333327ece438a8b61b5cc5a1e97898` |
| `origin/main` at branch creation | `a61be14a3d333327ece438a8b61b5cc5a1e97898` |
| Goal branch | `codex/dl-goal-001-data-layer-foundation` |
| Goal worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\DL_GOAL_001` |
| Final HEAD | Final report commit on the Goal branch, following implementation commit `a93c7d3d52b54fd9155d51069aab510472e07b87` |
| Remote branch HEAD | Verified equal to local final HEAD after push |
| Worktree cleanliness | Clean after commit and push |
| `main` | Unchanged; implementation was isolated in the Goal worktree |

The Goal branch was created from fetched `origin/main`; it was not merged. The implementation commit precedes the report commit.

## Architecture Delivered

- Established `data/` as the canonical owner for generic Data contracts, source-policy selection, validation, and acquisition execution. `workflows/research-data-acquisition/**` now provides compatibility re-exports, leaving one implementation.
- Added `DataResolver` and normalized `ResolvedDataItem` / `ResolvedDataBundle` outputs composed over existing `AcquisitionResult` semantics. Results retain status, value, metric and period identity, source, authority, quality, attempts, unavailable reason, cross-check state, and the low-level acquisition result.
- Added distinct Common and Industry catalogs. Common identities are stable and predefined. Industry identities are namespaced and evolve through `DISCOVERED → VALIDATED → CANONICAL`; canonical promotion requires validation, sourceability evidence, and an associated source policy. Policy association can be updated before canonical promotion; changing policy references for canonical metrics is review-gated.
- Added static Common and domain Industry Skill requirement templates. Workflow/runtime context materializes workflow, subject, period, `asOf`, and required status. Industry domain resolution returns only canonical catalog definitions. Industry acquisition fails closed without a canonical catalog definition and uses only policies associated with that metric.
- Added deterministic architecture guards against Skill imports of concrete acquisition providers and Data I/O. Existing type-only Skill dependencies on plugin contracts are recorded in a narrow baseline allowlist.
- Documented the Data / Skill / Workflow / Plugin / Knowledge boundaries, catalog distinction, lifecycle, resolver, source quality, PIT, provenance, conflicts, and migration phases in `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md`. Updated `RESEARCH_SKILL_ARCHITECTURE_V1.md` for metadata-only requirement declarations and runtime materialization.
- Intelligence monitoring is explicitly outside Data Layer v1; Daily Intelligence was not migrated.

## Skill Impact

| Area | Result |
|---|---|
| Skill methodology files changed | 0 |
| Skill catalog/contract files changed | `app/services/research-skill-catalog.ts`, `app/services/skill-registry.ts` |
| Provider-specific Skill imports added | 0 |
| Skills with machine-readable requirements added | `consensus_expectations_analysis`, `estimate_revision_analysis`, `reverse_dcf_expectation_decode`, `industry_supply_demand_cycle` |

Existing human-readable `inputs` remain. Industry Skill requirements describe generic semantic needs (supply/capacity, demand, inventory, pricing, utilization) and do not name providers or specific industry metrics. The initial mappings are bounded and are not a claim of complete Skill coverage.

## Common Catalog

These nine identities are grounded in existing valuation, earnings, management communication, and exchange Q&A source-policy composition. “Configured” describes a policy path in the current implementation, not complete provider coverage or universal availability.

| Data ID | Meaning | Data kind | Current consumer(s) | Source-policy status |
|---|---|---|---|---|
| `valuation_market_price` | Market close price time series for valuation | timeseries | Valuation / reverse DCF | Configured |
| `valuation_eps` | Annual EPS used for valuation | metric | Valuation | Configured |
| `valuation_bvps` | Annual BVPS used for valuation | metric | Valuation | Configured |
| `valuation_annual_report_publication` | Annual report publication/disclosure date | event | Valuation | Configured |
| `earnings_expectation_eps` | Analyst EPS expectation | metric | Earnings expectations | Configured |
| `earnings_expectation_net_profit` | Analyst net profit expectation | metric | Earnings expectations | Configured |
| `management_communication_documents` | Management communication documents | document | Management communication research | Configured |
| `exchange_qa_sse` | SSE exchange Q&A disclosures | document | Exchange Q&A research | Configured |
| `exchange_qa_szse` | SZSE exchange Q&A disclosures | document | Exchange Q&A research | Configured |

This catalog is intentionally not a project-wide inventory of every financial field. The Data Sources service now derives these stable meanings from the Common catalog while retaining its honest integration-coverage status.

## Industry Catalog

- Delivered namespaced IDs in the form `industry:<industryId>:<local-id>`, semantic role and family, kind, optional unit/periodicity/geography/applicability, lifecycle, source-policy references, discovered provenance, and validation evidence.
- Supports discovery, validation, policy association before canonical promotion, and explicit canonical promotion. Ordinary registration cannot create a canonical definition directly.
- Domain requirements resolve semantic roles/families against the actual industry and only return canonical definitions.
- **Real Industry metrics registered as canonical by this Goal: none.** Existing industry observations and providers require field-by-field semantic and source-quality review before catalog registration.

## Industry Source Review

The current implementation inventory is an engineering classification, not source approval. Coverage remains subject to future domain-by-domain review.

| Path | Current role | Classification / next step |
|---|---|---|
| `plugins/research-acquisition/industry-composition.ts` | Current multi-source Industry composition and orchestration | Keep as current runtime; Phase 4 migration candidate |
| `plugins/research-acquisition/miit-industry.ts` | MIIT official-source adapter with source anchors | Candidate Industry Catalog source; review source quality and field semantics; Phase 4 migration |
| `plugins/research-acquisition/govcn-industry.ts` | Gov.cn source adapter | Candidate source; review authority, semantics, and source quality; Phase 4 migration |
| `plugins/research-acquisition/cpca-industry.ts` | CPCA source adapter | Candidate source; review source quality and applicability; Phase 4 migration |
| `plugins/research-acquisition/eastmoney-industry.ts` | Eastmoney adapter | Candidate source; review authority and field semantics; Phase 4 migration |
| `plugins/research-acquisition/industry.ts`, `plugins/research-acquisition/akshare.ts` | Industry / AKShare provider paths | Provider boundary; review source quality and field semantics; Phase 4 migration |
| `plugins/research-acquisition/industry-operating-observations.ts` | NBS/MIIT/CHEAA parsers for operating observations | Candidate field evidence; review source/semantic mapping and currently unverified value-version PIT; Phase 4 candidate |

No source above is automatically approved as authoritative by its presence in the current runtime.

## Migration Inventory

### Phase 2 — Valuation + Earnings

| Path | Current responsibility and coupling | Target |
|---|---|---|
| `workflows/valuation/workflow.ts` | Valuation orchestration uses generic acquisition plus direct provider clients | Move acquisition requests/policy ownership to Data; preserve workflow orchestration |
| `workflows/valuation/contracts.ts` | Valuation-specific runtime contracts | Align data-facing contracts with Data identities during migration |
| `workflows/valuation/automatic-comps.ts` | Comparable-company data acquisition/projection | Route data acquisition through Data; keep valuation methodology in Workflow/Skill |
| `workflows/valuation/basis-evidence.ts` | Valuation basis evidence acquisition and normalization | Reuse Data result/provenance contracts |
| `workflows/earnings-review/workflow.ts` | Earnings review orchestration | Request data through resolver while retaining review lifecycle |
| `workflows/earnings-review/expectations-acquisition.ts` | Generic resolver plus concrete AKShare execution | Move source policy/provider execution behind Data/Plugin boundary |
| `workflows/earnings-review/expectations-ths.ts`, `expectations-eastmoney-akshare.ts`, `expectation-source-eastmoney.ts` | THS/EastMoney/AKShare source-specific projection and acquisition | Migrate as reviewed adapters/policies; retain source-specific parsing in Plugin |
| `workflows/management-communication-acquisition/workflow.ts`, `source-policies.ts` | Separate management communication acquisition and policies | Map to Common identity and Data policy during Phase 2 migration |

### Phase 3 — Company + Event + Thesis

| Path | Current responsibility and coupling | Target |
|---|---|---|
| `workflows/company-deep-research/workflow.ts` | Direct AKShare acquisition | Data requirements and policy-mediated Plugin execution |
| `workflows/event-research/workflow.ts` | Plugin `discover` / `fetch` / `normalize` acquisition loop | Data request boundary with event evidence-specific semantics |
| `workflows/thesis-red-team/workflow.ts` | Direct plugin acquisition loops | Data boundary where data requirements are stable; keep thesis reasoning and Knowledge lifecycle outside Data |

### Phase 4 — Industry

| Path | Current responsibility and coupling | Target |
|---|---|---|
| `workflows/industry-deep-research/workflow.ts` | Industry research orchestration and runtime integration | Resolve domain requirements/catalog definitions through Data; preserve workflow lifecycle |
| `app/services/research-service.ts` | Application service composes Industry runtime | Rewire to Data resolver during Phase 4 without moving business semantics into app |
| `plugins/research-acquisition/industry-composition.ts` and Industry provider paths above | Existing acquisition composition and provider adapters | Migrate policy/metric mapping incrementally after source and semantic review |

### Future Intelligence

| Paths | Current responsibility | Boundary |
|---|---|---|
| `workflows/daily-intelligence/`, `plugins/daily-intelligence/`, `skills/daily-intelligence/`, `app/services/daily-intelligence-service.ts`, `app/services/daily-intelligence-composition.ts` | Daily intelligence collection and briefing | Separate future Intelligence architecture; do not migrate into Data Layer |

### Out of scope / legitimate boundaries

- Concrete provider APIs, crawling, fetch, and provider parsing remain legitimate Plugin responsibilities; the migration target is Workflow-to-Data ownership and policy mediation, not moving provider code into `data/`.
- `skills/**` contains existing type-only imports from `plugins/research-acquisition/contracts.ts` and `industry-operating-observations.ts`. These are the explicit baseline allowlist; the latter co-locates implementation and type declarations and remains technical debt. No new Skill provider or Data I/O dependency was added.
- Knowledge schemas, Writer, Production Gateway, canonical persistence, and thesis lifecycle persistence were not changed.
- Daily Intelligence is deferred as described above.

## Compatibility

**NO INTENTIONAL BUSINESS-RESEARCH BEHAVIOR CHANGE.** Generic acquisition contracts and semantics were moved to their canonical `data/` location; old Workflow paths remain re-export compatibility entry points. Industry acquisition composition and business Workflows were not migrated. The Data Sources service keeps its current interface and reports existing coverage limits honestly.

## Test Evidence

| Validation | Result |
|---|---|
| Focused Data Layer + compatibility + Skill guard: `node --import tsx --test tests/workflows/data-layer-foundation.test.ts tests/workflows/research-data-acquisition.test.ts tests/app/services/data-layer-boundaries.test.ts` | 49/49 passed |
| Client tests (`npm run client:test`, via `npm test`) | 9 files, 97/97 passed |
| Full Node tests (`npm run test:node`, via `npm test`) | 233 files; 1,959 passed, 25 failed (1,984 total) |
| `npm run typecheck` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; Vite reports the existing client bundle exceeds 500 kB |
| `git diff --check` | PASS; only Git line-ending conversion warnings |

The 25 Node failures were isolated and reproduced file-by-file on untouched `main` at baseline, with the same failures in these files: `tests/app/services/industry-research-integration.test.ts` (1), `tests/app/services/registries.test.ts` (1), `tests/app/services/research-skill-architecture.test.ts` (1), `tests/app/services/theme-workspace-projection.test.ts` (6), `tests/knowledge/production/competition-module-gateway.test.ts` (12), `tests/validation/codex-module-remaining-schema-deltas.test.ts` (1), `tests/validation/codex-production-industry-schema-compatibility.test.ts` (1), and `tests/workflows/valuation.test.ts` (2). The repeated competition-module failures share a canonical Company fixture rejection; remaining failures are existing assertion/fixture expectation mismatches. No failures were suppressed or rewritten.

## Known Gaps

- Direct provider dependencies remain in the Phase 2, Phase 3, and Phase 4 paths listed above.
- Skill requirement mappings are intentionally incomplete and limited to four well-understood Skills.
- Industry source quality, applicability, and field semantics have not received full domain-by-domain review.
- Industry runtime remains on its pre-Phase-4 acquisition composition.
- Public Web search/extraction capability remains unconfigured where the Data Sources service already reports that gap; this Goal does not fake a provider.
- Intelligence source registry, subscriptions, monitoring, collection, signals, and Daily Brief architecture are intentionally deferred.
- The full Node suite has 25 baseline failures reproduced on `main`; all newly added focused tests pass.

## Phase 2 Readiness

The Phase 1 contracts, dual catalogs, resolver, compatibility surface, Skill metadata integration, and guardrails are in place for **Valuation + Earnings Data Layer Migration**. Phase 2 is not implemented. Begin it after Sol acceptance and account for the documented baseline Node failures.
