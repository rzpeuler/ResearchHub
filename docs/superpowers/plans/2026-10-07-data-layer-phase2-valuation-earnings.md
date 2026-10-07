# Data Layer Phase 2 Valuation and Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Valuation and Earnings source selection, acquisition, source-specific normalization, fallback, provenance, and generic quality checks under the Phase 1 Data Layer while preserving research behavior and Knowledge boundaries.

**Architecture:** Workflows materialize context-complete DataRequirements and map DataResolver output into existing typed domain inputs. Common catalog policies own source selection; the application composition root explicitly binds provider operations to executors. Provider parsing stays at the Plugin boundary, research semantics stay in Workflow/Skill, and numeric historic value-version uncertainty stays explicit.

**Tech Stack:** TypeScript, Node `node:test`, existing DataResolver/Common Data Catalog/SourcePolicy, Pi/React Runtime composition, existing AKShare/CNINFO/THS/EastMoney/SSE/SZSE adapters.

**Spec:** `docs/superpowers/specs/2026-10-07-valuation-earnings-data-resolver-migration-design.md`

## Global Constraints

- Do not create a second DataResolver, SourcePolicy, Provider framework, Capability, Planner, second Agent, global Provider Registry, or Service Locator.
- Data Layer owns data definitions, requirement resolution, source selection, PIT, fallback, provenance, conflicts, and availability.
- Workflow owns lifecycle, research orchestration, requirement materialization, typed input mapping, result/report composition, and Knowledge write orchestration.
- Skill owns research methods and calculations; Skills perform no acquisition or DataResolver calls.
- Plugin owns external interfaces, fetching, and provider-specific parsing.
- Do not weaken Data quality, PIT, provenance, fallback, conflict, unavailability, or canonical Knowledge mutation constraints.
- Do not migrate Company, Event, Thesis, Industry, Daily Intelligence, or Intelligence Source Registry in this Phase 2 goal.
- Preserve Valuation/Earnings request/result contracts, reports, provider outcomes, diagnostics, source refs, research conclusions, and Knowledge writes; explain and test any intentional correction.
- Do not merge Phase 2 into `main`; push the finished Phase 2 branch and leave its worktree intact.

## Review Focus

- Numeric historical value without value-version proof: keep it unverified/ineligible for historical conclusions; pin with Valuation basis and Earnings `analysisAsOf` regressions.
- Future publication or retrieved-time substitution: reject future publication and preserve actual `retrievedAt`; pin in Data and Workflow tests.
- Wrong metric, issuer, period, fiscal year, unit, institution, or policy: fail closed or remain unavailable; pin in requirement materialization and Earnings expectation tests.
- Fallback, conflicts, zeroes, and missing values: preserve explicit attempts and status without averaging or model fallback; pin in DataResolver tests.
- Automatic comps candidate quality/cap: retain identity, cohort, rejection diagnostics, and expensive validation cap; pin in comps regressions.

---

## File Map

- `data/contracts.ts`, `data/validation.ts`, `data/workflow.ts`, `data/resolver.ts` — represent timestamp/value-version evidence and enforce safe generic acquisition semantics.
- `data/common-catalog.ts`, `data/source-policy.ts`, `data/requirements.ts`, `data/index.ts`, and Common policy definitions — define live Valuation/Earnings inputs and Data-owned source selection.
- `plugins/research-acquisition/**` — expose explicit executor operations and provider-specific row/report parsing without moving research methodology.
- `workflows/valuation/**` — materialize market, FY basis, publication, and peer evidence requirements; map resolved data to existing typed Valuation inputs.
- `workflows/earnings-review/**` and `workflows/management-communication-acquisition/**` — migrate filings, actuals, estimates, and communications while retaining exact-period, institution, guidance, and report logic.
- `app/runtime/application-runtime.ts`, `app/services/research-service.ts`, and related contracts — explicit resolver/executor composition and injection; Data Source Administration reads Data-owned policy IDs.
- `tests/workflows/**`, `tests/app/services/data-layer-boundaries.test.ts`, and focused Data tests — prove behavior, compatibility, real resolver paths, and removal of migrated provider debt.
- `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md` — replace Phase 2 deferred inventory with the implemented boundary while leaving Phase 3/4 deferred.
- `docs/engineering/reports/YYYY-MM-DD-data-layer-phase2-valuation-earnings.md` — final evidence, deltas, real-source status, baseline comparison, and residual gaps.

## Interfaces

Use the existing `DataResolver.resolve(requirements: readonly DataRequirement[]): Promise<ResolvedDataBundle>` and existing DataRequirement/SourcePolicy contracts. Extend only where necessary to preserve a numeric value-version status and diagnostic separately from `publishedAt`, period, `analysisAsOf`, and `retrievedAt`.

The composition root must provide explicit candidate operation bindings; Workflows pass requirements but do not branch on provider, source ID, operation ID, or fallback order. Workflow adapters map resolved items into current typed `ValuationWorkflowResult`, `EarningsReviewWorkflowResult`, Skill, and report inputs.

---

### Task 1: Common Data Contracts, Policies, and Safe PIT Semantics

**Files:**
- Modify: `data/contracts.ts`, `data/validation.ts`, `data/workflow.ts`, `data/resolver.ts`
- Modify: `data/common-catalog.ts`, `data/requirements.ts`, `data/source-policy.ts`, `data/index.ts`
- Create or modify: Data-owned Valuation/Earnings SourcePolicy definitions under `data/`
- Test: `tests/workflows/data-layer-foundation.test.ts`, `tests/workflows/research-data-acquisition.test.ts`, focused new `tests/workflows/data-layer-valuation-earnings.test.ts`

**Interfaces:**
- Preserve the current `DataResolver.resolve(requirements)` entry and `ResolvedDataBundle` shape for existing consumers.
- Add explicit evidence status for numeric value-version proof. Do not infer it from retrieval success or publication date. Existing policies retain `FIRST_VALID`, `CROSS_CHECK`, or `COLLECT_DIVERSE` behavior.
- Add Common entries only for live metric meanings identified in the migration matrix; distinguish document, estimate, metric, timeseries, and attributable composite evidence.
- Runtime materialization must bind the correct company/ticker, `asOf`, period, fiscal year, metric, and required/optional status to each requirement.

- [ ] **Step 1: Add failing Data contract tests** for separate `analysisAsOf`, fiscal/market period, `publishedAt`, `retrievedAt`, and numeric value-version evidence; assert that missing version proof never becomes PIT-safe and future publication remains rejected.
- [ ] **Step 2: Add requirement materialization tests** for exact company/ticker, `asOf`, period, fiscal year, one selected metric, and required/optional context; verify EPS does not force net profit.
- [ ] **Step 3: Run the focused tests** with `node --import tsx --test tests/workflows/data-layer-valuation-earnings.test.ts tests/workflows/data-layer-foundation.test.ts tests/workflows/research-data-acquisition.test.ts`; confirm the new contract cases fail before implementation.
- [ ] **Step 4: Implement minimal contract and validation changes** in `data/` and define Data-owned policies/requirements for Valuation, Earnings actuals/filings/estimates, and management communication based on live payload semantics.
- [ ] **Step 5: Re-run focused Data tests**; require all new and existing Data tests to pass, including missing, zero, conflict, future publication, and fallback attempt cases.
- [ ] **Step 6: Commit** the Data contracts, policies, catalog, and focused tests as one reviewable unit.

### Task 2: Valuation and Automatic Comparable DataResolver Migration

**Files:**
- Modify: `workflows/valuation/basis-evidence.ts`, `workflows/valuation/workflow.ts`, `workflows/valuation/automatic-comps.ts`, `workflows/valuation/contracts.ts`
- Modify as needed: Valuation acquisition adapters in `plugins/research-acquisition/**`, `app/runtime/application-runtime.ts`, `app/services/research-service.ts`, resolver composition contracts
- Test: `tests/workflows/valuation.test.ts`, `tests/workflows/valuation-basis-evidence.test.ts`, `tests/workflows/automatic-comps.test.ts`, `tests/workflows/real-auto-comps-harness.test.ts`

**Interfaces:**
- Consume Task 1 Data-owned policies and DataResolver value-version/provenance semantics.
- Return the same public Valuation workflow result, provider outcome, diagnostics, basis, source references, and comparable diagnostics.
- Peer discovery may resolve as attributable composite evidence; peer subject market, financial, and publication facts reuse Common identities where their semantics match.

- [ ] **Step 1: Add failing Valuation migration tests** proving market, EPS, BVPS, publication, and peer discovery/financial evidence execute through DataResolver and explicit operations while preserving same-fixture result, peer rejection diagnostics, candidate cap, and unavailable behavior.
- [ ] **Step 2: Add/adjust PIT regressions** for current snapshot, historical `asOf`, future publication, historical market date, and `PUBLICATION_VERIFIED_VALUE_VERSION_UNVERIFIED`; assert it never upgrades to `PIT_VERIFIED` without value-version evidence.
- [ ] **Step 3: Run focused Valuation suites** and confirm the new resolver-path and PIT assertions fail before migration.
- [ ] **Step 4: Move source selection/acquisition and provider-specific parsing** to Data policies and Plugin adapters; leave coverage, eligibility, basis, comps candidate methodology, Skill calls, reports, and Knowledge orchestration in Workflow.
- [ ] **Step 5: Remove Valuation direct provider/fallback decisions** and map resolver attempts/provenance back to existing provider outcomes and diagnostics; retain `companyBasic` only for compatibility telemetry if tests/contracts require it.
- [ ] **Step 6: Re-run the Valuation suites** plus deterministic Valuation E2E; compare same-fixture business outputs and all observable compatibility fields.
- [ ] **Step 7: Commit** the Valuation migration and regression tests.

### Task 3: Earnings, Expectations, and Management Communication Migration

**Files:**
- Modify: `workflows/earnings-review/workflow.ts`, `expectations-acquisition.ts`, `expectations-ths.ts`, `expectations-eastmoney-akshare.ts`, `expectation-source-eastmoney.ts`, management communication acquisition policies/workflow, `app/runtime/application-runtime.ts`, `app/services/research-service.ts`
- Modify/create as needed: explicit filing, AKShare, THS, EastMoney, CNINFO, SSE, and SZSE Plugin acquisition/normalization adapters and composition contracts.
- Test: `tests/workflows/earnings-review.test.ts`, `earnings-expectations-acquisition-d1.test.ts`, `earnings-expectation-source-eastmoney.test.ts`, `earnings-expectation-source-001c.test.ts`, `earnings-automatic-expectations.test.ts`, management communication tests, and integration/report/Knowledge tests.

**Interfaces:**
- Consume Task 1 Data-owned per-metric policies and Task 2's explicit Runtime resolver composition without adding parallel acquisition paths.
- Keep EPS and net-profit requirements independent. Preserve THS Primary/EastMoney fallback, institution identity, period/unit matching, prior-estimate matching, and `GuidanceRange` validation.
- Workflow maps resolver output into existing `FinancialQualityInput`, actual-vs-consensus, revision bridge, guidance, report, and Knowledge inputs.

- [ ] **Step 1: Add failing Earnings resolver-path tests** for official filing, structured actuals, THS primary, EastMoney fallback, single EPS/net-profit requests, management docs, and exchange Q&A; assert no Workflow selects a source.
- [ ] **Step 2: Add time/identity regressions** for historic value-version uncertainty, future publication, exact fiscal period, institution deduplication, prior estimate same metric/institution/period, units, source conflicts, and explicit unavailable.
- [ ] **Step 3: Run focused Earnings/expectation/management tests** and confirm the new resolver-path assertions fail before migration.
- [ ] **Step 4: Move source policies, provider execution, fallback, and provider-specific parsing** to Data/Plugin boundaries; preserve filing selection, calculations, financial quality, actual-vs-consensus, revision logic, guidance/QA semantics, report composition, and Knowledge write path in existing domain ownership.
- [ ] **Step 5: Remove Earnings/management Workflow provider and policy decisions**; preserve structured `providerOutcomes`, selection/acquisition diagnostics, exact report sections, and source evidence attribution.
- [ ] **Step 6: Re-run affected Earnings and integration suites** plus deterministic Earnings E2E; compare same-fixture result, summary, report, and Knowledge outputs.
- [ ] **Step 7: Commit** the Earnings migration and regression tests.

### Task 4: Boundary Guard, Documentation, Full Acceptance, and Delivery

**Files:**
- Modify: `tests/app/services/data-layer-boundaries.test.ts`, `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md`
- Create: `docs/engineering/reports/2026-10-07-data-layer-phase2-valuation-earnings.md`
- Modify as required: affected Data Layer/Workflow tests and migration matrix evidence

- [ ] **Step 1: Tighten the architecture dependency baseline** so migrated Valuation, Earnings, expectation, and management acquisition paths no longer retain concrete Workflow provider/policy exceptions; retain explicit exact exceptions only for genuinely unmigrated callers.
- [ ] **Step 2: Run architecture tests** and verify they fail if a migrated Workflow reintroduces a concrete provider call or Workflow-owned source-selection import.
- [ ] **Step 3: Update the architecture and migration inventory** to describe only current Phase 2 implementation; leave Company/Event/Thesis/Industry and Daily Intelligence deferred.
- [ ] **Step 4: Run deterministic fixture E2E** for both Valuation and Earnings through Workflow → DataResolver → policy → explicit executor/Plugin → typed mapping → Skill → report; verify report and Knowledge compatibility.
- [ ] **Step 5: Run repository real-source acceptance scripts** for Valuation and Earnings expectations where locally possible; record `REAL_SOURCE_BLOCKED` with exact failure evidence for any blocked source and never claim fixture tests as live-source proof.
- [ ] **Step 6: Compare the final full Node suite against a detached `origin/main` baseline** in the same environment, dependency setup, and runtime-data isolation. Record exact failed test identifiers and require no new deterministic failures; do not suppress existing failures.
- [ ] **Step 7: Run** `npm test`, `npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check`; record exact results.
- [ ] **Step 8: Complete the engineering report** with promotion SHA, Phase 2 baseline/final/remote HEAD, path-by-path migration matrix, policy/adapter changes, same-fixture deltas, PIT integrity, real-source evidence, test comparison, residual debt, and Phase 3 readiness.
- [ ] **Step 9: Commit documentation/report/acceptance changes**, fetch and verify the pushed remote Phase 2 HEAD, confirm clean worktree, and confirm Phase 2 is not merged to `main`.

## Review Focus Test Mapping

- Historic numeric value version: Task 1 Data quality tests, Task 2 Valuation basis tests, Task 3 Earnings historic actuals tests.
- Future publication and real retrieval time: Task 1 Data validation tests and Task 2/3 workflow source metadata tests.
- Incorrect requirement identity or cross-join: Task 1 materialization tests and Task 3 expectation tests.
- Fallback/conflict/zero/missing: Task 1 resolver tests and Task 3 explicit source outcome tests.
- Comparable candidate quality/cap: Task 2 automatic comps regressions.
