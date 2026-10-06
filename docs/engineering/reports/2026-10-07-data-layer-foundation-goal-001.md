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
| FIX-001 implementation commit | `c6b433ff664210b670a25e7884bee6ee47e61857` |
| Final HEAD | Report-only commit immediately follows FIX-001 implementation commit; exact final branch HEAD is in delivery response |
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
| `valuation_annual_report_publication` | Annual report publication/disclosure date | document | Valuation | Configured |
| `earnings_expectation_eps` | Analyst EPS expectation | estimate | Earnings expectations | Configured |
| `earnings_expectation_net_profit` | Analyst net profit expectation | estimate | Earnings expectations | Configured |
| `management_communication_documents` | Management communication documents | document | Management communication research | Configured |
| `exchange_qa_sse` | SSE exchange Q&A disclosures | evidence | Exchange Q&A research | Configured |
| `exchange_qa_szse` | SZSE exchange Q&A disclosures | evidence | Exchange Q&A research | Configured |

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
| Focused Data Layer + compatibility + Skill/Workflow guards: `node --import tsx --test tests/workflows/data-layer-foundation.test.ts tests/workflows/research-data-acquisition.test.ts tests/app/services/data-layer-boundaries.test.ts` | 59/59 passed |
| Client tests (`npm run client:test`, via `npm test`) | 9 files, 97/97 passed |
| Full Node tests (`npm run test:node`, via `npm test`) | Goal branch: 233 files, 1,971 passed and 25 baseline failures (1,996 total); detached current-main baseline: 231 files, 1,946 passed and the same 25 failing test identifiers (1,971 total) |
| `npm run typecheck` | PASS |
| `npm run client:typecheck` | PASS |
| `npm run client:build` | PASS; main JavaScript bundle 628.73 kB with the >500 kB chunk-size advisory |
| `git diff --check` | PASS; only Git line-ending conversion warnings |

`npm test` exits 1 because of those 25 Node failures; client tests pass. The FIX branch adds 25 passing Node cases relative to current `main`, including 12 FIX-001 test cases, and introduces no new full-suite failure.

The 25 Node failures are also compared against the same `origin/main` commit in a detached baseline worktree without ignored runtime data. Both branches have exactly the same 25 failing test identifiers. They occur in: `tests/app/services/industry-research-integration.test.ts` (1), `tests/app/services/registries.test.ts` (1), `tests/app/services/research-skill-architecture.test.ts` (1), `tests/app/services/theme-workspace-projection.test.ts` (6), `tests/knowledge/production/competition-module-gateway.test.ts` (12), `tests/validation/codex-module-remaining-schema-deltas.test.ts` (1), `tests/validation/codex-production-industry-schema-compatibility.test.ts` (1), and `tests/workflows/valuation.test.ts` (2). The repeated competition-module failures share a canonical Company fixture rejection; remaining failures are existing assertion/fixture expectation mismatches. No failures were suppressed or rewritten.

## Known Gaps

- Direct provider dependencies remain in the Phase 2, Phase 3, and Phase 4 paths listed above.
- Skill requirement mappings are intentionally incomplete: Phase 1 keeps reverse-DCF market price and generic Industry domain needs, while consensus expectations and estimate revisions are deferred because their input cardinality is runtime-selected.
- Industry source quality, applicability, and field semantics have not received full domain-by-domain review.
- Industry runtime remains on its pre-Phase-4 acquisition composition.
- Public Web search/extraction capability remains unconfigured where the Data Sources service already reports that gap; this Goal does not fake a provider.
- Intelligence source registry, subscriptions, monitoring, collection, signals, and Daily Brief architecture are intentionally deferred.
- The full Node suite has 25 baseline failures reproduced on `main`; all newly added focused tests pass.

## Phase 2 Readiness

The Phase 1 contracts, dual catalogs, resolver, compatibility surface, Skill metadata integration, and guardrails are in place for **Valuation + Earnings Data Layer Migration**. Phase 2 is not implemented. Begin it after Sol acceptance and account for the documented baseline Node failures.

## FIX-001 Sol Acceptance Addendum

FIX-001 was implemented on the same Goal branch after the Phase 1 review. The starting Goal commit was `7d9d5487b99e5611bdace814c76a806326545f33`. The FIX-001 implementation commit SHA is recorded below; the final branch HEAD is the following report-only commit. No Phase 2 runtime migration or `main` merge was performed.

### Sol Findings and Resolutions

| Finding | Resolution |
|---|---|
| Skill-local requirement IDs were materialized as `consumer.capability` and could not match existing policies | Removed that coupling. Common Data definitions now own per-workflow compatibility capabilities; `earnings_expectation_eps` / `earnings_expectation_net_profit` supply `earnings_expectations` for `earnings-review`. New requirements may omit this legacy-only field. Regression materializes an EPS requirement and proves it matches `earningsExpectationSourcePolicy()` instead of returning `NO_REGISTERED_POLICY`. |
| Industry DOMAIN templates could be silently rewritten to a catalog metric's different data kind | Resolution now filters to exact `template.dataKind` matches. A mixed match materializes only compatible metrics and records `INDUSTRY_DATA_KIND_MISMATCH`; an all-incompatible match materializes none and reports the same reason. |
| Consensus and estimate-revision declarations incorrectly required EPS and net profit together | Removed both fixed paired mappings. The method contracts select one metric per consensus invocation and a compatible old/new pair for one metric/institution/period per revision invocation. These mappings remain deferred to Phase 2. |
| Skill data requirement coverage was not explicit | Every canonical catalog entry now exposes `requirementCoverage`: `NONE` means no requirements are declared/mapped; `PARTIAL` means known inputs remain deferred/unmapped or only a subset is represented; `COMPLETE` means all external data inputs for the method are represented. Current mapped or known-but-deferred Skills are marked `PARTIAL`; no Skill is incorrectly marked complete. |
| Catalog/materialization gaps did not consistently affect completeness | Optional unresolved gaps produce `PARTIAL`, including an empty bundle for the real optional `industry_supply_demand_cycle` requirements. Required gaps produce `PARTIAL` when present resolved data or observation content (including numeric zero) remains usable, and `UNAVAILABLE` when there is no usable content. `unresolvedRequirements` remains separate. |
| Workflow/application provider debt had no deterministic boundary test | The architecture test now scans `workflows/**` and `app/services/**` against an explicit importer-to-module allowlist of current deferred dependencies. New concrete provider imports, including nested provider contracts and co-located-I/O type imports, fail without an exact entry. The detector exempts only known neutral contracts and generic helper module paths. Data→Plugin and Plugin implementation are outside this guard. |
| Cloned Skill descriptors shared mutable requirement metadata | Canonical catalog requirements are frozen; registry normalization/cloning deep-copies and freezes requirement objects and `requiredFields`. `get()`/`list()` results no longer expose mutable shared requirement metadata. |

### FIX-001 Files Changed

- `app/services/data-source-catalog.ts`
- `app/services/research-skill-catalog.ts`
- `app/services/skill-registry.ts`
- `data/common-catalog.ts`
- `data/contracts.ts`
- `data/requirements.ts`
- `data/resolver.ts`
- `data/validation.ts`
- `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md`
- `tests/app/services/data-layer-boundaries.test.ts`
- `tests/workflows/data-layer-foundation.test.ts`
- This engineering report

### Workflow/Application Debt Baseline

`tests/app/services/data-layer-boundaries.test.ts` records exact relative importer paths and exact module specifiers, not a wildcard exception. Current recorded dependencies span:

- Phase 2: Earnings Review and Valuation provider/executor files; management-communication acquisition.
- Phase 3: Company Deep Research.
- Phase 4: Industry Deep Research and `app/services/research-service.ts` composition.
- Future Intelligence / explicitly out of Data scope: `app/services/daily-intelligence-composition.ts` and `app/services/daily-intelligence-service.ts`.
- Existing application assembly: `app/services/data-source-integrations.ts` and neutral type declarations in `app/services/contracts.ts`.

The test also proves that a synthetic new concrete Workflow provider dependency, a new type-only dependency on a module that co-locates provider I/O, a nested provider `contracts.ts` import, and a Skill DataResolver import through TypeScript, JavaScript, or extensionless module paths fail without a specific allowance. Neutral Data/Plugin contracts and generic helper modules use exact detector exclusions.

### FIX-001 Validation and Main Comparison

| Validation | FIX branch | Current `main` baseline |
|---|---:|---:|
| Focused Data, acquisition, Skill guard, Workflow debt guard: `node --import tsx --test tests/workflows/data-layer-foundation.test.ts tests/workflows/research-data-acquisition.test.ts tests/app/services/data-layer-boundaries.test.ts` | 59/59 passed | Not applicable; new tests/files are absent |
| Client tests (part of `npm test`) | 9 files, 97/97 passed | 9 files, 97/97 passed |
| Node tests (part of `npm test`) | 1,996 total; 1,971 passed, 25 failed | 1,971 total; 1,946 passed, 25 failed |
| Failed Node test identifiers | 25 | Same 25; exact identifier sets compared and identical |
| New test failures from FIX-001 | 0 | — |
| `npm run typecheck` | PASS | — |
| `npm run client:typecheck` | PASS | — |
| `npm run client:build` | PASS; main JavaScript bundle 628.73 kB with the >500 kB chunk-size advisory | — |
| `git diff --check` | PASS; line-ending conversion notices only | — |

The primary `main` checkout contains ignored `runtime-data/application-settings.json` selecting a Knowledge Base. Tests run directly there fail additional injected-Runtime fixtures because the persisted selection cannot be applied. That user runtime state was preserved. The code comparison above uses a detached clean worktree at current `origin/main` (`a61be14a3d333327ece438a8b61b5cc5a1e97898`) with the same dependency installation and no ignored runtime data, matching the Goal worktree setup.

FIX-001 preserved the existing zero, missing-value, PIT, provenance, fallback, and conflict tests; all passed within the 59-test focused suite. Current Phase 2–4 migration gaps and source-quality reviews listed earlier remain unchanged. Daily Intelligence remains deferred.
