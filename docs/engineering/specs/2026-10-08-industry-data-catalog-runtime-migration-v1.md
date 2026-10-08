# Industry Data Catalog and Runtime Migration — Design for Review

**Status:** Proposed; no runtime implementation authorized by this document alone.

**Baseline:** Phase 3 accepted and promoted; Phase 4 branch `codex/dl-goal-004-industry-data-migration` begins at `ef3634e70e193a1f2a37172738253d3c014d9c8a`.

**Companion audit:** `docs/engineering/reports/2026-10-08-industry-data-source-field-audit.md`.

## 1. Design objective

Route both forms of Industry inputs through Data Layer contracts and DataResolver:

1. Bounded research documents used across the eight Industry modules.
2. Typed quantitative metric observations governed by an explicit Industry identity, metric definition, and metric-scoped SourcePolicy.

Workflow continues to choose research questions, Wave 1/Wave 2, module routing, and Knowledge production. Skills continue to interpret only supplied, source-bound inputs. Plugins continue to own network/provider operations and source-specific parsing. Knowledge schema and Gateway/Writer semantics remain unchanged.

## 2. Evidence-driven starting point

The companion audit is authoritative for the current source/field findings. Key constraints for design:

- No current metric key has an Industry Catalog definition or a Data lifecycle state; the existing implementation is an audit input.
- The five current metric keys route only to `market_size_growth` and `supply_demand_analysis` in the Industry Research Skill. The separate supply-demand-cycle Skill is methodology-only, and neither Skill nor Workflow currently declares or materializes Data `DOMAIN` requirements.
- A live probe fetched NBS, two MIIT, and two CHEAA source documents through the D4 path. It found a real MIIT paired-price defect: both H1 prices parse as 16.3 although the official article says 16.3 and 15.3.
- The current D4 path reports publication PIT but leaves value-version PIT unverified. Do not backfill current web/PDF contents into past `asOf` requests.
- Generic provider attempts found one Eastmoney board snapshot, no MIIT/Gov.cn/CPCA document for the two test searches, and no Eastmoney match for lithium. These outcomes do not justify widening source authority or treating a board snapshot as an operating series.

## 3. Explicit Industry identity mapping

Add a small deterministic Industry identity catalog under `data/` with:

- Stable `industryId` values only for explicitly registered domains.
- Exact normalized aliases stored in source, such as approved English and Chinese names for lithium-ion battery and household air conditioner.
- A resolver that returns a registered ID or a typed unresolved result. It must never slugify arbitrary input or let a Skill/model create a permanent ID.
- Ambiguous or unsupported input remains usable for generic Industry document research. Structured DOMAIN resolution reports `INDUSTRY_ID_UNRESOLVED` or `NO_CANONICAL_INDUSTRY_METRIC`.

The initial identity candidates are `lithium_battery` and `household_air_conditioner`; the exact aliases and IDs must be reviewed against source/product scope before registration. No aliases imply that `air_conditioner.export_volume` is domestic demand or that lithium output is capacity.

## 4. Industry metric definition and lifecycle

Extend the existing `IndustryMetricDefinition` only with fields required to make a canonical definition enforceable:

- Stable `metricId = industry:<industryId>:<local-id>`, `industryId`, `metricFamily`, `semanticRole`, `dataKind`, human description, and lifecycle.
- Canonical unit plus accepted source units and explicit deterministic conversion identifiers, if conversion is needed.
- Period/frequency and aggregation semantics, geography, product/grade applicability, and required qualifiers.
- Metric-scoped SourcePolicy references.
- Publication-PIT and value-version-PIT requirements, including whether a requirement permits only current-value research.
- Discovery and validation provenance sufficient to explain transitions.

Transitions remain `DISCOVERED → VALIDATED → CANONICAL`. A canonical transition must require a source policy plus evidence that semantics, unit/period/scope, deterministic extraction, PIT policy, and relevant acceptance coverage all pass. Missing value-version proof may be represented as explicitly unverified and may restrict historical requests; it must never be silently upgraded. A failed or unavailable adapter does not make a definition canonical.

Initial metric dispositions are deliberately not pre-approved here. Current candidate evidence supports review of NBS production, CHEAA household export volume, MIIT lithium output, and MIIT article-period prices. The MIIT H1 hydroxide extraction is rejected until its source mapping and micropowder-grade scope are corrected. Export value is not export volume. Final lifecycle states follow actual tests and real probes; zero canonical metrics is acceptable if the source bar is not met.

## 5. Provider-neutral observation payload

Move the single real definition of the observation/metric payload and validation into `data/industry-observations.ts` (or the shallowest existing Data-layer equivalent). Keep at most a compatibility type re-export from the old Plugin module during migration.

The resolved payload contains a catalog `metricId` and validated points. Each point preserves:

- Numeric value, qualifier, canonical unit, original value/unit.
- Period start/end, frequency, aggregation, geography, product/segment/grade.
- Publication and retrieval timestamps, origin publisher, host platform, retrieval provider, authority.
- Publication PIT and value-version PIT separately.
- Stable source identity/reference and deterministic diagnostics/conflict state.

Validation is data-kind aware, rejects unsupported or ambiguous units, preserves `EXACT`/`LOWER_BOUND`/`UPPER_BOUND`, and does not equate `PERIOD`, `YTD`, and `POINT_IN_TIME`. Unit conversion, if required, is code-owned and tested. Same-slot disagreements remain explicit conflicts; no averaging, latest-retrieval selection, or authority-based silent winner is allowed.

Missingness distinguishes at least `MISSING`, `NOT_REPORTED`, `NOT_APPLICABLE`, `SOURCE_UNAVAILABLE`, `TRANSPORT_UNAVAILABLE`, `PARSER_UNAVAILABLE`, and `NO_CANONICAL_METRIC`. Missing is never converted to zero.

## 6. DataRequirement and resolver shape

Add one bounded provider-neutral query context only for generic evidence requirements. It may include:

- Display target (bounded string), one to eight bounded search terms, bounded purpose, and optional start/end time bounds.
- Serializable primitive values only; reject excess lengths/counts, invalid dates/ranges, and provider-specific keys.

It must not contain a provider name, endpoint, vendor query language, adapter method, or planner instructions. Do not add a query planner, provider registry, search agent, dynamic discovery, or service locator.

Register the generic identity `industry_research_evidence` as a Common Catalog identity, with documentation that it is the shared cross-industry document-evidence input and not an Industry metric. Its requirement uses `dataKind=evidence`, bounded query context, `COLLECT_DIVERSE`, source rights, stable URL/hash dedup, and publication-time/PIT qualification. This is compatible with unregistered industries because it does not manufacture a canonical Industry namespace.

Structured metrics remain Industry Catalog identities. `materializeSkillDataRequirements` must resolve only exact `industryId + semanticRole + metricFamily + dataKind` matches with `CANONICAL` lifecycle; wrong role/family/kind, `DISCOVERED`, `VALIDATED`, or unknown industry remain unresolved. Multiple exact canonical matches must be handled deterministically and surfaced rather than chosen by incidental ordering.

## 7. Metric-scoped source policies and Plugin operations

Data owns policy order and eligibility. Plugins expose bounded named operations that policy candidates can invoke:

- NBS annual/statistical-table retrieval and deterministic extraction for the exact room-air-conditioner production field.
- MIIT article retrieval and deterministic extraction for the exact lithium metric; paired-price extraction must bind first/second values to the corresponding labels and retain the hydroxide grade.
- CHEAA issue/PDF retrieval and deterministic extraction of the explicit monthly `家用空调器` quantity while keeping cumulative quantity and dollar value separate.
- Existing MIIT/Gov.cn/CPCA/Eastmoney/AKShare evidence operations only where their source scope and rights are approved by the generic-evidence policy.

The policy must select `metricId`/metric family operations; a Plugin must not infer all desired metrics from the user’s industry name. `originPublisher`, `hostPlatform`, `retrievalProvider`, and `upstreamDataSource` remain separate fields. The provider operation must return acquisition attempts, normalized data, original source bytes/identity as permitted, rights, parser diagnostics, and publication/version evidence.

Generic evidence and a deterministic metric extracted from the same document share one stable source identity and provenance. The Workflow must not bind duplicate independent source objects to Knowledge merely because document and metric requirements were resolved separately.

## 8. ResearchService and Workflow ownership

The normal composition becomes:

```text
Application Runtime
  → per-run Industry DataResolver factory
  → Industry Workflow
```

ResearchService supplies dependencies/factories; it does not construct or run a provider loop. Workflow keeps the current two-wave lifecycle:

```text
design/gaps → bounded evidence requirement → DataResolver → Skill analysis
            → actionable gaps → second bounded requirement → DataResolver → synthesis
```

Workflow materializes metric needs and calls DataResolver for canonical definitions. Only relevant resolved observations go to `market_size_growth` and `supply_demand_analysis`; other modules receive only relevant document evidence. The Workflow may request data again after Wave 1 but must not decide provider order.

The migration must inspect existing `industry_supply_demand_cycle` contracts before adding any Data bridge. Keep its methodology generic and unchanged. Add declarative semantic requirements only at the layer that owns the actual invocation; do not claim this Skill currently declares DOMAIN requirements. Missing capacity, effective capacity, utilization, inventory history, orders/backlog, shipment, demand, and spot price remain gaps unless a separately audited canonical metric matches them.

## 9. Compatibility and Knowledge boundary

- Replace the normal `ResearchService → IndustryAcquisitionComposition → plugin loop → Workflow acquisitionWave` path with Workflow requirements resolved through DataResolver.
- Replace `Workflow → IndustryOperatingObservationAcquisition.acquire()` with an Industry Catalog metric requirement, SourcePolicy, Plugin operation, and resolved payload.
- Preserve the existing 8 modules, two waves, evidence routing, cross-module synthesis, competition module, quality gate, report, and Gateway/Writer behavior.
- Compatibility adapters may remain only while call sites migrate and must not control source-policy order. Remove migrated direct-acquisition debt and allowlist only individually justified compatibility calls.
- Data resolution never writes Knowledge. Existing Workflow evidence qualification and proposals continue through the canonical Knowledge Production Gateway and Writer. No Knowledge schema change is in scope.

## 10. Failure, PIT, and quality behavior

Each operation reports distinct transport, parse, scope, rights, PIT, and no-canonical-metric outcomes. Unknown publication time may remain report/background-only where existing behavior permits; it cannot support historical verified facts or canonical metric points. Future publications, out-of-period observations, rejected rights, invalid units, parser schema drift, and source conflicts are not usable numeric observations.

`publishedAt <= analysisAsOf` proves publication availability only. Historical numeric requests requiring value-version proof must fail closed when the source cannot identify the revision available at that cutoff. For current-value-only requests, the unverified revision status remains visible and explicitly constrains interpretation.

## 11. Required architecture guard and acceptance

Add deterministic guards proving:

- Industry Workflow has no direct Plugin `discover/fetch/normalize`, `IndustryAcquisitionComposition.acquire`, or operating-acquisition `.acquire` path.
- Industry Skills perform no I/O, provider calls, or DataResolver calls and import no concrete acquisition implementation.
- No wildcard compatibility allowlist hides migrated debt; each exception names exact file/call and reason.
- Knowledge, Daily Intelligence, thesis lifecycle, and unrelated modules remain outside the diff except narrow references required for compilation.

Focused tests and deterministic E2E must cover identity alias mapping; lifecycle transitions; exact and failed semantic matching; unsupported industry; units/conversion; `PERIOD`/`YTD`/frequency; bounds; conflict; missingness; publication/version PIT; provider failure and partial success; duplicate URL/hash; future and unknown-date sources; rights rejection; cancellation; two waves; module routing; shared source provenance; and unchanged Gateway behavior.

The real-source run must separately report transport, document parsing, metric parsing, publication PIT, unit normalization, DataResolver status, and consumer Workflow status for MIIT/NBS/CHEAA and generic evidence routes. The acceptance harness must record actual run/retrieval time separately from its explicit analysis cutoff. No LLM numeric fallback is allowed for canonical metrics.

Run the taskbook's full Node/client/typecheck/build commands and the focused Data foundation, valuation, earnings, Company, Event, Thesis, Industry, and architecture-guard suites. Compare exact failing test identifiers on Phase 4 and its Phase 4 baseline. Do not claim full-suite regression success from a failure-count-only comparison.

## 12. Scope exclusions

No Industry Catalog UI, Knowledge schema redesign, source auto-discovery/canonicalization, new generic search framework, Intelligence monitoring, unsupported metric synthesis, new market-data vendor, or scope expansion into unrelated research workflows.

## 13. Design questions for approval

This proposal recommends: (a) an explicit alias registry for the two evidenced domains; (b) a Common identity for bounded Industry document evidence; (c) DataResolver as the only normal acquisition path; (d) current-value-only use when value-version PIT is not provable; and (e) no forced canonical metrics before the repaired real-source acceptance passes. Please review the proposal and call out any change before implementation begins.
