# RHL-DL-GOAL-004 Industry Data Catalog and Runtime Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route bounded Industry documents and eligible quantitative observations through Data Catalog contracts and DataResolver while preserving the eight-module, two-wave Workflow and Knowledge production path.

**Architecture:** Data owns explicit Industry identity, metric definitions, lifecycle, requirements, policies, provenance, and resolver selection. Plugins own bounded provider operations and deterministic parsing; Workflow owns the two waves and module routing; ResearchService supplies resolver factories without running a provider loop. No metric becomes canonical until its tested semantics, source policy, extraction, and PIT evidence meet the spec.

**Tech Stack:** TypeScript, Node.js >=22.19.0, existing DataResolver/SourcePolicy contracts, Vitest/Node test runner, existing React/Vite client unchanged.

**Spec:** `docs/engineering/specs/2026-10-08-industry-data-catalog-runtime-migration-v1.md`; source matrix: `docs/engineering/reports/2026-10-08-industry-data-source-field-audit.md`; approved taskbook: `RHL-DL-GOAL-004` pasted-text attachment.

## Global Constraints

- Workflow owns deterministic execution control and routing; Skill owns professional semantic methodology; Plugin owns external capability integration; Data owns requirement resolution and source policy.
- Runtime remains local-first with one Node process, direct Pi SDK embedding, React + TypeScript + Vite, HTTP JSON + SSE, and no WebSocket.
- Do not introduce DeepSeek Harness / DSH, a custom Agent Runtime, provider registry, query planner, service locator, DI framework, or a new vendor.
- Canonical Knowledge mutation remains only through the Knowledge Production path, validated ChangeSet, and Writer; do not change Knowledge schema, Gateway, or Writer semantics.
- Do not backfill current source contents into historical `asOf` requests; publication PIT and value-version PIT remain separate.
- No forced canonical metrics; unresolved/unsupported industries remain eligible for generic document research.
- Keep the existing eight Industry modules, two-wave lifecycle, quality gate, report, and module evidence semantics.

## Review Focus

- Unknown and ambiguous Industry aliases must resolve as typed unresolved outcomes while generic evidence research still proceeds; test in Task 1.
- `PERIOD`, `YTD`, and `POINT_IN_TIME`, qualifiers, units, frequency, geography, and grade must not collapse into one slot; test in Task 2.
- Equal metric slots with conflicting values and duplicate document/metric source references must remain explicit conflicts with one shared provenance identity; test in Tasks 2 and 4.
- Unverified value-version evidence must block historical numeric requests while remaining visibly constrained for current-value-only requests; test in Tasks 2 and 3.
- Cancellation, partial provider failure, unknown publication time, future sources, and rights rejection must fail closed without suppressing successful independent evidence; test in Tasks 3 and 4.
- Five optional DOMAIN declarations in `industry_supply_demand_cycle` do not prove production integration: the Application-invoked Industry Workflow must materialize and resolve them through the actual DataResolver path, then pass only matched canonical metrics to the Skill; test in Tasks 4 and 5.
- Historical numeric evidence, source/Raw binding, and fetched-but-unusable numeric payloads must retain explicit PIT/provenance/availability outcomes; test in Tasks 3–5. `production` is not `capacity`, `export` is not `demand`, and `DISCOVERED`/`VALIDATED` definitions never execute.

---

## File and Interface Map

- Modify `data/industry-catalog.ts`: exact identity aliases, lifecycle-enforced metric definitions, and catalog transitions.
- Create `data/industry-observations.ts`: the sole provider-neutral Industry metric point/result contract and validation.
- Modify `data/contracts.ts`, `data/requirements.ts`, `data/common-catalog.ts`, and `data/resolver.ts`: bounded generic evidence context, exact Industry DOMAIN materialization, Common evidence identity, and normal resolver use.
- Modify `data/workflow.ts` only if existing policy execution needs bounded evidence/metric result qualification; do not create a second executor.
- Modify `app/services/research-skill-catalog.ts` or its owning invocation only as needed to preserve and actually resolve the existing optional generic `industry_supply_demand_cycle` DOMAIN templates; do not move metric selection or I/O into the Skill.
- Modify `plugins/research-acquisition/industry-operating-observations.ts`, `miit-industry.ts`, `govcn-industry.ts`, `eastmoney-industry.ts`, `cpca-industry.ts`, and `industry-composition.ts`: bounded named operations, parser correction, and removal of direct composition from the normal path. Keep provider network/parsing ownership here.
- Modify `workflows/industry-deep-research/contracts.ts` and `workflow.ts`: materialize and resolve requirements in each wave, route only eligible observations to the two relevant modules, preserve all other evidence routes and Knowledge gates.
- Modify `app/services/research-service.ts` and `app/runtime/application-runtime.ts`: supply per-run resolver factories; remove ResearchService-owned provider loops.
- Extend focused tests under `tests/workflows/data-layer-foundation.test.ts`, `tests/plugins/research-acquisition/industry*.test.ts`, `tests/workflows/industry-deep-research/*.test.ts`, and `tests/app/services/industry-research-integration.test.ts`.
- Add `tests/validation/phase4-industry-data-fixture-e2e.test.ts`; extend `tests/app/services/data-layer-boundaries.test.ts` with exact forbidden-workflow/Skill dependency assertions.
- Modify `scripts/acceptance-industry-operating-observations-d4-real.ts`: record actual run/retrieval time independently from explicit analysis cutoff and report each source leg.
- Update `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md` with Phase 1–3 accepted and Phase 4 implemented/Sol acceptance pending status.
- Update `docs/engineering/reports/2026-10-08-industry-data-source-field-audit.md` with final per-metric classification and reasons.
- Create `docs/engineering/reports/2026-10-08-data-layer-phase4-industry.md` with migration matrix, source policies, PIT/unit/period decisions, test/baseline/live evidence, known gaps, and final SHAs.

## Task 1: Explicit Industry identity and exact DOMAIN requirement matching

**Files:**
- Modify: `data/industry-catalog.ts`, `data/requirements.ts`, `app/services/research-skill-catalog.ts`
- Test: `tests/workflows/data-layer-foundation.test.ts`
- Test: `tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts`

**Interfaces:**
- Add `IndustryIdentity = { industryId: string; aliases: readonly string[] }` and `resolveIndustryIdentity(input: string, catalog?: readonly IndustryIdentity[]): { status: 'RESOLVED'; industryId: string } | { status: 'UNRESOLVED' | 'AMBIGUOUS'; input: string; candidateIndustryIds: readonly string[] }` in `data/industry-catalog.ts`.
- Register only reviewed `lithium_battery` and `household_air_conditioner` aliases; normalize exact aliases deterministically, never slug arbitrary text.
- Extend metric definitions with canonical unit, accepted source units/conversion IDs, period/frequency/aggregation, geography, product/grade, required qualifiers, publication-PIT and value-version-PIT policy fields needed for enforceable matching.
- Add `IndustryDataCatalog.resolveExact(industryId, semanticRole, metricFamily, dataKind)` returning a discriminated `MATCHED | NO_CANONICAL_INDUSTRY_METRIC | INDUSTRY_DATA_KIND_MISMATCH | AMBIGUOUS_CANONICAL_INDUSTRY_METRIC` result. DOMAIN templates require both semantic role and family; the five existing Skill templates receive explicit generic family names.
- DOMAIN materialization requires exact `(industryId, semanticRole, metricFamily, dataKind)` and `CANONICAL`; zero, wrong-kind, and multiple exact matches become explicit unresolved outcomes and never materialize an arbitrary metric.

- [x] **Step 1: Add failing tests** named `Industry identity resolves only registered exact aliases`, `Industry identity reports ambiguous aliases without selecting an ID`, `Industry DOMAIN materialization requires exact canonical industry role family and kind`, `Industry DOMAIN materialization rejects unknown or noncanonical metrics`, `Industry DOMAIN materialization reports multiple exact canonical matches as ambiguous`, `Industry metric cannot become canonical without policy semantic unit scope extraction and PIT evidence`, and `Industry canonical definition preserves unverified value-version limitation`.
- [x] **Step 2: Run** `node --import tsx --test tests/workflows/data-layer-foundation.test.ts`; expect the new tests to fail because identity resolution and exact DOMAIN matching are absent.
- [x] **Step 3: Implement** the alias registry and typed results in `data/industry-catalog.ts`; add explicit families to the five `industry_supply_demand_cycle` templates in `app/services/research-skill-catalog.ts`; update `materializeSkillDataRequirements` in `data/requirements.ts` to surface zero/wrong-kind/multiple matches without incidental ordering.
- [x] **Step 4: Run** the focused foundation test; expect all new Industry identity/matching/lifecycle tests and existing Common materialization tests to pass.
- [x] **Step 5: Commit** as `feat(data): add explicit Industry identities and metric matching`.

## Task 2: Provider-neutral Industry observations and metric slot validation

**Files:**
- Create: `data/industry-observations.ts`
- Modify: `data/index.ts`, `skills/industry-research/contracts.ts`, `skills/industry-research/skill.ts`, `plugins/research-acquisition/industry-operating-observations.ts`
- Test: `tests/workflows/industry-deep-research/industry-observation-contract.test.ts`
- Test: `tests/plugins/research-acquisition/industry-operating-observations.test.ts`
- Test: `tests/skills/industry-research/industry-research-skill.test.ts`

**Interfaces:**
- Define `IndustryObservationPoint` in Data with `metricId`, `value`, `qualifier`, `canonicalUnit`, `originalValue`, `originalUnit`, `periodStart`, `periodEnd`, `frequency`, `periodBasis`, `aggregation`, `geography`, `product`, `segment`, `grade`, `publishedAt`, `retrievedAt`, `originPublisher`, `hostPlatform`, `retrievalProvider`, `authority`, `publicationPit`, `valueVersion`, `sourceIdentity`, and diagnostics/conflict state.
- Define provider-neutral `IndustryObservationCandidate` separately from canonical-unit `IndustryObservationPoint`. `validateIndustryObservation(candidate, definition, requirement)` checks exact metric/industry/kind, scope, unit conversion ID, period semantics, authority, publication PIT, and value-version PIT; conversions are explicit code-owned conversion IDs from the definition.
- Define `mergeIndustryObservationPoints(points)` to retain all same-slot points and return explicit conflict records; no winner is selected.
- Define missing reasons `MISSING`, `NOT_REPORTED`, `NOT_APPLICABLE`, `SOURCE_UNAVAILABLE`, `TRANSPORT_UNAVAILABLE`, `PARSER_UNAVAILABLE`, and `NO_CANONICAL_METRIC`.
- Move the Skill's `operatingObservations` input and claim-boundary checks to the Data-owned `IndustryObservationPoint`/`metricId`; keep provider-parser candidate types inside Plugin. No Skill type or implementation imports the concrete Plugin acquisition contract.

- [x] **Step 1: Add failing tests** named `Industry observation validation preserves qualifiers and original units`, `Industry observation rejects ambiguous unit and period semantics`, `Industry observation distinguishes PERIOD YTD and POINT_IN_TIME slots`, `Industry observation preserves same-slot conflicts`, `Industry missingness never becomes numeric zero`, `MIIT H1 paired prices bind each value to its labeled grade`, and `Industry Skill receives catalog metric identity without Plugin-owned type`.
- [x] **Step 2: Run** `node --import tsx --test tests/workflows/industry-observation-contract.test.ts tests/plugins/research-acquisition/industry-operating-observations.test.ts tests/skills/industry-research/industry-research-skill.test.ts`; expected contract and parser failures were observed.
- [x] **Step 3: Implement** the Data-owned interfaces and deterministic validator; apply only declared conversions and retain original values, units, labels, and source identity. Change the Skill contract/consumer to metricId and the neutral Data payload.
- [x] **Step 4: Correct** the MIIT paired-price parser so H1 lithium carbonate `16.3` and lithium hydroxide micropowder `15.3` bind to their own labels; retain both values as separate qualified points.
- [x] **Step 5: Run** the listed focused tests; `49/49` passed with no failures.
- [x] **Step 6: Commit** as `feat(data): define validated Industry observation contract` (`2f0428b`).

## Task 3: Common bounded Industry evidence and metric-scoped Data policies

**Files:**
- Modify: `data/contracts.ts`, `data/common-catalog.ts`, `data/requirements.ts`, `data/resolver.ts`, `data/workflow.ts`
- Modify: `plugins/research-acquisition/industry.ts`, `industry-composition.ts`, `miit-industry.ts`, `govcn-industry.ts`, `eastmoney-industry.ts`, `cpca-industry.ts`, `industry-operating-observations.ts`
- Test: `tests/workflows/data-layer-foundation.test.ts`
- Test: `tests/plugins/research-acquisition/industry.test.ts`, `miit-industry.test.ts`, `govcn-industry.test.ts`, `eastmoney-industry.test.ts`, `cpca-industry.test.ts`

**Interfaces:**
- Add serializable `IndustryEvidenceQueryContext = { displayTarget: string; searchTerms: readonly string[]; purpose: string; start?: string; end?: string }`, bounded to 1–8 terms and documented maximum string lengths; reject invalid ranges and provider-specific fields.
- Register Common `industry_research_evidence` as `dataKind='evidence'`, `COLLECT_DIVERSE`, with source rights and stable URL/hash dedup requirements.
- Metric policies select named operation IDs per `metricId`/metric family. Plugin operations accept `DataRequirement` plus the named operation candidate and return attempts, normalized points/documents, permitted source identity, rights, parser diagnostics, publication PIT, and value-version evidence.
- No metric policy is canonical unless a passing source acceptance is recorded; MIIT H1 hydroxide remains rejected pending corrected scope/evidence.

- [x] **Step 1: Add failing tests** named `Industry evidence query context enforces bounds and rejects provider-specific keys`, `industry_research_evidence is a Common evidence identity with COLLECT_DIVERSE`, `Industry metric policies match exact metric IDs and preserve operation ordering`, `Industry acquisition exposes separate publisher host and retrieval provider`, `Industry source rights rejection yields no usable point`, `Industry DataResolver blocks historical numeric result without verified value version`, `Industry DataResolver marks current value only as version unverified`, `Industry DataResolver rejects future and out of period points`, `Industry DataResolver exposes provider partial success and cancellation`, and `Industry document and metric resolution retain one source identity`.
- [x] **Step 2: Run** the listed foundation and plugin suites; initial RED was observed for missing named operation contracts. Final focused run passed `119/119` tests; subsequent PIT and source-identity additions passed `48/48` tests plus typecheck.
- [x] **Step 3: Implement** context validation, Common identity, explicit source policies, and bounded named Plugin operations; no provider registry or route selection was added to Plugin.
- [x] **Step 4: Run** focused tests; publication PIT and value-version PIT remain independent, rights-rejected documents are unusable, and DataResolver blocks historical unversioned time-series values.
- [x] **Step 5: Commit** as `feat(data): add Industry evidence and metric policies`.

## Task 4: Migrate Industry Workflow and ResearchService to resolver factories

**Files:**
- Modify: `workflows/industry-deep-research/contracts.ts`, `workflows/industry-deep-research/workflow.ts`
- Modify: `app/services/research-service.ts`, `app/runtime/application-runtime.ts`
- Modify: `app/services/research-skill-catalog.ts` only if the existing generic templates need the minimum semantic completion required by actual Industry research needs.
- Test: `tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts`
- Test: `tests/app/services/industry-research-integration.test.ts`, `tests/app/runtime/industry-research-route.test.ts`
- Test: `tests/validation/phase4-industry-data-fixture-e2e.test.ts`
- Test: `tests/workflows/data-layer-foundation.test.ts`, `tests/skills/industry-supply-demand-cycle.test.ts`

**Interfaces:**
- `IndustryDeepResearchInput` receives a per-run `industryDataResolverFactory`/resolver port; it no longer receives normal-path `acquisitionWave` or `operatingObservationAcquisition` acquisition ports.
- At the actual product invocation, `Application Runtime → ResearchService → Industry Workflow` constructs or receives the per-run resolver. Each wave materializes bounded `industry_research_evidence` requirements from Workflow research intent and resolves them through DataResolver. The Workflow also materializes the canonical Skill catalog's Industry DOMAIN templates (plus only minimal reviewed templates needed by the eight modules) and calls `DataResolver.resolveSkillRequirements`; fixture-only direct resolver calls do not satisfy this task.
- DataResolver resolves exact registered `industryId + semanticRole + metricFamily + dataKind` matches, and only `CANONICAL` definitions with their attached SourcePolicy reach a Plugin operation. No catalog match, wrong type/role/family, or `DISCOVERED`/`VALIDATED` definition remains an explicit gap and does not block generic document research.
- Workflow converts resolved `IndustryObservationPoint` values into the provider-neutral Skill input while retaining metric identity, qualifier, unit, period, grade/product, PIT, and source provenance. The production Skill call receives those inputs; the Skill still performs no I/O and selects no metric.
- Only `market_size_growth` and `supply_demand_analysis` receive relevant resolved metrics; other modules receive relevant documents only. Skills remain I/O-free.
- The five existing optional supply-demand-cycle DOMAIN templates remain generic and are materialized at the Industry Workflow boundary; never add DataResolver calls to the Skill. Their current semantics do not permit production to satisfy capacity. Add only the minimum semantic requirement(s) missing for actual production research and prove `production ≠ capacity`, `export ≠ demand`. `requirementCoverage` stays `PARTIAL` while genuine needs remain unresolved.
- Workflow owns two-wave timing, design/gap formation, module routing, evidence qualification, report and Gateway/Writer submission. ResearchService only provides dependencies/factories.
- Industry Application requests carry explicit `HISTORICAL` vs `CURRENT_VALUE_ONLY` mode into materialized metric requirements. Historical numeric requirements require value-version proof; publication date alone is insufficient. Resolved metric observations may reach a Skill only when the exact metric source is durably bound to qualified evidence; otherwise return an explicit provenance gap. Unknown-date sources remain context/report-only and cannot support durable proposals.
- DataResolver must not describe a fetched document as an available numeric metric when parsing yields no valid points or every point fails unit, period, rights, or PIT validation. Preserve documents for generic-evidence qualification and report a typed numeric unavailability; valid zero remains a valid observation and conflicts remain `PARTIAL`.

- [x] **Step 1: Add failing tests** named `Industry Workflow resolves bounded evidence requirements through DataResolver in both waves`, `Industry Workflow materializes Industry DOMAIN templates in the product invocation`, `Industry Workflow resolves only canonical exact semantic metrics`, `Industry Workflow maps resolved points into provider-neutral Skill input`, `Industry Workflow leaves production unmatched to capacity and export unmatched to demand`, `Industry Workflow shares document and metric source provenance`, `Industry Workflow continues generic evidence for unresolved industry identity`, `Industry Workflow preserves eight modules and skips Wave 2 when no gaps remain`, `Industry Workflow rejects future unknown-date and rights-rejected numeric facts`, `Industry Workflow cancellation stops both resolver waves`, `Industry Workflow preserves unchanged Gateway and report behavior`, and `ResearchService does not construct an Industry provider loop`. Evidence is split across the Application integration suite, Workflow adversarial tests, plugin/Data PIT tests, and boundary guard; no standalone hand-built requirement fixture is claimed as product-path acceptance.
- [x] **Continuation regression coverage:** Application explicit historical `asOf` reaches Industry numeric DataRequirements; current-value-only requests retain visible unverified-version status; unknown-date evidence is context-only; metric Source and Raw refs are canonical and shared with generic evidence; metric observations without qualified Source/Raw binding stay out of Skill input and produce a typed provenance gap; fetched documents with no valid numeric points return typed unavailability while remaining eligible for generic evidence.
- [x] **Continuation verification:** Phase 4 focused matrix 167/167; full Node baseline comparison 25 baseline failures, 24 current failures, no new failing identifier; full client 97/97; Phase 1–3 related focused matrix 619/621 with only baseline V39/V65; root/client typechecks and client build pass; live-source Application acceptance completed 64 network calls with explicit noncanonical metric gaps and no promotion.
- [x] **Step 2: Run** `node --import tsx --test tests/workflows/industry-deep-research/industry-deep-research-workflow.test.ts tests/workflows/industry-deep-research/industry-operating-observations.test.ts tests/app/services/industry-research-integration.test.ts tests/app/runtime/industry-research-route.test.ts`; the focused suite passed 60/60 after migration.
- [x] **Step 3: Migrate** Workflow wave calls and ResearchService/runtime composition to the resolver factory; remove the normal path through `IndustryAcquisitionComposition.acquire()` and `.acquire()` on operating observations. Materialize the existing cycle Skill templates in the real Industry Workflow, add only the minimum module requirements missing for production research, resolve them via DataResolver, and pass typed resolver output into the appropriate Skill module inputs. Keep Skills pure; do not add a false production-to-capacity or export-to-demand mapping.
- [x] **Step 4: Run** focused Workflow/Application/Data boundary tests; the combined focused set passed 118/118, preserving two-wave, module, Knowledge Gateway, PIT, and cancellation behavior.
- [x] **Step 5: Commit** as `refactor(industry): resolve research inputs through Data Layer` (`649a3faaa8431ae94ecbea571253a355a7e0166a`).

## Task 5: Architecture guards, fixture E2E, real-source acceptance, and full delivery

**Files:**
- Modify: `tests/app/services/data-layer-boundaries.test.ts`, `tests/validation/phase3-data-layer-fixture-e2e.test.ts`
- Create: `tests/validation/phase4-industry-data-fixture-e2e.test.ts`
- Modify: `tests/app/services/industry-research-integration.test.ts` to exercise the real Application service entrypoint with a temporary Knowledge Base and traced resolver/Plugin/Skill seams.
- Modify: existing MIIT/NBS/CHEAA real acceptance script under `tests/validation/` or `scripts/` to record run time and explicit analysis cutoff separately.
- Update: `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md` and the field audit; create `docs/engineering/reports/2026-10-08-data-layer-phase4-industry.md` with implementation results and exact failure comparison.

**Interfaces:**
- Guard forbids Industry Workflow direct Plugin `discover/fetch/normalize`, `IndustryAcquisitionComposition.acquire`, and operating-acquisition `.acquire`; guard forbids Skill I/O/provider/DataResolver access and concrete acquisition imports.
- Application fixture E2E invokes the production application research dispatch/service entrypoint and the actual Industry Workflow (not a hand-built DataRequirement fixture) and observes the complete `Application → ResearchService → Industry Workflow → DataResolver → Industry Catalog/SourcePolicy → Plugin operation → resolved payload → Skill input` chain. It verifies identity, lifecycle, aliases, exact matching, generic evidence, partials, PIT, conflict, duplicate source identity, both waves, module routing, and unchanged Gateway behavior.
- At least one actual canonical metric must traverse the complete chain if the audit and acceptance evidence meet the canonical bar. If none meet it, the production fixture must prove typed gaps and the final result is `PARTIAL / BLOCKED`; never fake canonical data to satisfy the test.
- Live-source report records transport, document parse, metric parse, publication PIT, unit normalization, DataResolver result, and Workflow consumer result independently for MIIT/NBS/CHEAA and generic evidence; it never treats a current fetch as historical value-version proof.
- Final comparison uses exact failing test identifiers from the committed Phase 4 baseline, not counts alone.
- Before declaring Phase 4 complete, verify the Phase 3 safety-promotion boundary from Git evidence: the Phase 3 delivered commit is an ancestor of the Phase 4 base/current `main`, `main` equals `origin/main`, and this Phase 4 branch has not been merged. Record the exact SHAs. Re-run Phase 4 deterministic E2E and live-source attempt after the continuation fixes; do not treat the fixture-canonical metric as a production catalog promotion.

- [x] **Step 1: Add failing guards and fixture E2E** named `Industry Workflow and Skills contain no direct acquisition path`, `Industry Data Layer fixture E2E preserves source provenance and PIT`, and `Industry live acceptance records actual retrieval time separately from analysis cutoff`.
- [x] **Step 2: Run** `node --import tsx --test tests/app/services/data-layer-boundaries.test.ts tests/validation/phase4-industry-data-fixture-e2e.test.ts`; the initial guard exposed the remaining Industry Plugin allowlist entries; after the migration, the guard and E2E passed.
- [x] **Step 3: Implement** exact boundary guards and an Application-level fixture E2E that traces the full production call chain through a real Industry Workflow invocation. Cover provider failure, partial success, duplicate URL/hash, future/unknown/out-of-period sources, rights rejection, cancellation, exact canonical metric resolution and Skill input mapping; correct acceptance timestamps; update architecture/audit docs and create the Phase 4 report. Do not broaden the compatibility allowlist.
- [x] **Step 4: Verify metric dispositions** for all five audited legacy metric keys as `CANONICAL`, `VALIDATED_NOT_CANONICAL`, `DISCOVERED_ONLY`, or `REJECTED`, with per-field reasons. No candidate met the canonical bar; the production Catalog retains zero canonical definitions and the real product-path coverage is `PARTIAL` with explicit metric gaps.
- [x] **Step 5: Run focused suites** for Data foundation, valuation, earnings, Company, Event, Thesis, Industry, architecture guards, and fixture E2E. Record command and results.
- [x] **Step 6: Run full validation:** `npm test`, `npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check`; compare exact failed Node test identifiers against `_archive/DL_GOAL_004-baseline-node-2026-10-08.log` and require no newly failing deterministic identifier.
- [x] **Step 7: Run and document** `scripts/acceptance-industry-operating-observations-d4-real.ts` plus the generic evidence source routes with temporary Knowledge; report transport, document parsing, metric parse availability, publication PIT, unit validation coverage, DataResolver result, and consumer Workflow independently. Identify network/runtime gaps distinctly and do not mark unsupported metrics canonical.
- [x] **Step 8: Review and commit** the final evidence/report changes as `docs(data): record Phase 4 Industry migration acceptance` (`0ef9111d7a02b9aabd89641e33e2e16fa7a512dd`); pushed the branch and verified the remote ref. The plan-closure commit records final clean-worktree and exact local/remote SHA verification. At the original 2026-10-08 delivery snapshot, `main` was at the verified post-Phase-3 baseline until the user's Phase 4 promotion decision. Final status is `IMPLEMENTED / SOL ACCEPTANCE PENDING`; no Sol acceptance is claimed.

## Self-review record

- **Spec coverage:** identity and aliases (Task 1); lifecycle and exact semantic matching (Task 1); provider-neutral payload, units, periods, conflicts, and missingness (Task 2); bounded context, Common identity, metric policies, source rights, and PIT (Task 3); two-wave resolver migration, module routing, cycle Skill's already-declared generic DOMAIN needs, source dedup, and Knowledge boundary (Task 4); architecture guards, E2E, live-source evidence, exact baseline comparison, docs, migration matrix, final status, and Git delivery (Task 5).
- **Step scan:** Each task has named failing tests, a focused command, implementation boundary, passing command, and commit. The plan leaves implementation bodies to the engineer while fixing contract names, consumer routing, and acceptance conditions.
- **Type consistency:** `IndustryObservationPoint.metricId` references the stable catalog ID; existing Skill metadata carries generic semantic dimensions and materializes to exact metric IDs; Plugin operation output conforms to the Data observation validator; Workflow consumes resolver results only.
- **Review Focus:** All five input/failure classes have corresponding named tests in their owning task.
- **Proportion:** The plan sequences five reviewable deliverables and references existing paths instead of duplicating the spec or prescribing algorithms already fixed by tests.

## Plan review decision

- Reviewed against all taskbook acceptance sections and the repository's current branch, catalog, resolver, Workflow, and application composition.
- Corrected the earlier audit/spec factual error: the canonical Skill catalog has five optional generic DOMAIN templates, but production resolver wiring was not found.
- Strengthened Task 1 to require exact dimensions and explicit ambiguity handling, and Task 4/5 to require real Application-entrypoint coverage of `Application → ResearchService → Industry Workflow → DataResolver → Industry Catalog/SourcePolicy → Plugin → Skill input`; a manually-created DataRequirement fixture is insufficient.
- Added exact lifecycle/semantic failure expectations, no-false-mapping checks, Skill-input conversion assertions, and the permissible zero-canonical outcome.
- Rechecked the user's continuation decision against every acceptance condition: added explicit production DOMAIN materialization/resolution evidence, historical-vs-current PIT propagation, durable metric Source/Raw binding, unknown-date context-only handling, numeric availability semantics, and an exact Phase 3 promotion-safety ancestry check. The eight-module/two-wave Workflow and Knowledge Gateway/Writer boundary remain acceptance constraints.
- Execution mode is `native` as explicitly selected. The plan's DOMAIN runtime claim is accepted only from the Application → Industry Workflow → DataResolver → Industry Catalog/SourcePolicy → Plugin → Skill invocation; a standalone hand-built DataRequirement fixture is insufficient.
- Continuation completion was checked against the Phase 4 report's FIX-001 supplement and fresh test/source-run output. The Phase 3 safety ancestry and no-merge boundary were verified from Git refs; no unresolved taskbook acceptance item remains.
- The independent final reviewer found one Important qualifier-slot conflict issue. Added the same-slot EXACT/LOWER_BOUND regression, observed RED (`0 !== 1`), removed qualifier from slot identity while preserving it on each point, and observed GREEN; the post-fix Phase 4 matrix and full Node baseline comparison were rerun.
- **Review conclusion:** plan covers the taskbook acceptance criteria and is approved for native execution under the user's explicit execution decision. No user follow-up is required before implementation.

### 2026-10-09 native continuation re-review

- Rechecked the approved plan against the current user decision, repository `AGENTS.md`, Phase 4 spec, existing reports, and source/tests for DOMAIN materialization. The plan still covers the required actual Application → ResearchService → Industry Workflow → DataResolver → Catalog/SourcePolicy → Plugin → Skill-input path; both typed no-canonical gaps and test-only exact-canonical traversal are asserted through the Application service entrypoint.
- Verified Phase 3 delivered SHA `7cc569667327dba0afe02bf503ba885b0803b1a7` is an ancestor of current `main`, and `main` equals `origin/main`. On entry, current `main`, `origin/main`, and the existing Phase 4 branch all pointed to `9424d3b01185d8df8310c224cffa8e81622e69b6`, so Phase 4 history was already present in those refs. No merge or ref rewrite was performed during this continuation; the earlier unmerged-state statement is a historical snapshot, not current state.
- Re-ran production-path integration/HTTP/E2E tests, the scoped Data/Phase 1–4 regression matrix, the full regression suite, typechecks, build, and the real-source Application attempt. Exact baseline comparison found 0 newly failing test identifiers.
- The named `writing-plans` / `executing-plans` skill files were not available in the installed skill directories; the plan was reviewed manually against its existing review record and the authoritative repository/taskbook contracts.
- **Continuation review conclusion:** no plan omission remains for the stated runtime architecture or acceptance tests. Proceeded natively on the existing Phase 4 branch without creating a task, branch, or worktree.
