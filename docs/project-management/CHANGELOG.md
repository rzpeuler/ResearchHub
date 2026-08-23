# Changelog

This file records recognizable project baseline and delivery changes.

## Version: v0.9.0

**Date:** 2026-08-23

**Changes:**

- Added `TushareMarketProvider` using the native Tushare HTTP API transport.
- Added `AkShareMarketProvider` using a configurable AkShare-compatible HTTP bridge.
- Added common Market data normalization for provider-specific fields and strict timestamp validation.
- Added environment configuration, primary/fallback composition, combined provider errors and secret redaction.
- Added deterministic provider fixtures and tests without SDK dependencies or live network calls.
- Added `docs/architecture/MARKET_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. Market Capability, Event Analysis Skill, Harness Core and frozen architecture documents were not changed.

## Version: v0.8.0

**Date:** 2026-08-23

**Changes:**

- Added the Financial Data Provider Framework with `DataProvider`, `ProviderResult` and traceable `FinancialDataMetadata`.
- Added the process-local `ProviderRegistry` and typed `ProviderHandle` lookup boundary.
- Migrated deterministic Mock Market and Mock News adapters to `packages/providers/adapters/`.
- Updated Market and News Capabilities to resolve providers through the Registry and project source metadata.
- Added `docs/architecture/FINANCIAL_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. Existing Harness capability names remain stable; no real data source, crawler, trading logic, external database or Harness Core change was introduced.

## Version: v0.7.0

**Date:** 2026-08-23

**Changes:**

- Added the first-class Review Artifact and Outcome model.
- Added the deterministic Evaluation Engine with metric comparison, numeric tolerance and objective status derivation.
- Added Review Memory support and the Prediction → Outcome → Evaluation → Review → Memory integration test.
- Added `docs/architecture/RESEARCH_EVALUATION_DESIGN.md`.

**Breaking Changes:**

- None. No Harness Core, trading logic, real data source, strategy mutation or external database was introduced.

## Version: v0.6.0

**Date:** 2026-08-23

**Changes:**

- Added the Memory Entry and Memory Provider contracts with runtime validation.
- Added the Local JSON Memory Provider with save, retrieve, update, atomic persistence and same-process path coordination.
- Added the Artifact Memory Adapter for Thesis and Prediction artifacts.
- Added Memory tests for persistence, retrieval, updates, Session metadata, defensive copies and error boundaries.
- Added `docs/architecture/RESEARCH_MEMORY_DESIGN.md`.

**Breaking Changes:**

- None. No Harness Core, frozen architecture document, real data source, trading logic or external database was changed.

## Version: v0.5.0

**Date:** 2026-08-23

**Changes:**

- Added `NewsCapability` with `search_company_news(symbol)`.
- Added deterministic `MockNewsProvider` without external data access.
- Added the Harness-loadable Event Analysis Skill and typed `EventAnalysisWorkflow`.
- Added deterministic Evidence, Thesis and Prediction generation from Market/News Capability results.
- Added `run_event_analysis` Harness Tool with active Agent Session ID binding.
- Added Event Analysis Harness integration validation and Session JSONL persistence assertions.
- Added `docs/architecture/EVENT_ANALYSIS_SKILL_DESIGN.md`.

**Breaking Changes:**

- None. No Harness Core, frozen architecture document, real data source, trading logic or Memory implementation was changed.

## Version: v0.4.0

**Date:** 2026-08-23

**Changes:**

- Added the Research Artifact Core with `ArtifactBase`, JSON-safe types and runtime validation.
- Added `Evidence`, `Thesis` and `Prediction` artifact models.
- Added session and artifact relationship references through `sessionId`, `evidenceIds` and `thesisId`.
- Added validated JSON serialization and deserialization helpers.
- Added Artifact Framework unit and relationship tests.
- Added `docs/architecture/RESEARCH_ARTIFACT_DESIGN.md`.

**Breaking Changes:**

- None. No Harness Core, frozen architecture document, external data source or Memory implementation was changed.

## Version: v0.3.0

**Date:** 2026-08-23

**Changes:**

- Added reusable `CapabilityDefinition` and `CapabilityProvider` contracts.
- Added `MarketCapability` with `get_market_snapshot`.
- Added deterministic `MockMarketProvider` without external data access.
- Registered the Market Capability through the Harness Tool boundary.
- Added Capability/Provider unit tests and Harness Session integration validation.
- Added `docs/architecture/CAPABILITY_DESIGN.md`.

**Breaking Changes:**

- None. No Harness Core, frozen architecture document, production API or real data source was changed.

## Version: v0.2.1

**Date:** 2026-08-23

**Changes:**

- Locked the DeepSeek Harness validation surface to `0.1.1-rc.2`.
- Added the test-only integration validation project under `tests/integration/`.
- Verified Cordis Extension loading, Agent creation, Skill loading, Capability invocation and JSONL Session persistence.
- Added `docs/architecture/HARNESS_INTEGRATION.md` with source-verified interfaces and remaining risks.
- Updated README and project-management status, roadmap and task registry.

**Breaking Changes:**

- None. No production business code, API, data structure or Harness core was changed.

## Version: v0.0.0

**Date:** 2026-08-23

**Changes:**

- Initialized the ResearchHub project governance documentation system.
- Added project overview, current status, roadmap, task registry, decision log, architecture, development rules and Agent workflow documents.
- Added the governance documentation entry point to README.

**Breaking Changes:**

- None. The repository had no production code, API, data structure or production configuration.

## Recording Rules

- Each deliverable version has an independent title and date.
- Changes record user-visible, engineering or governance changes.
- Breaking Changes explicitly state incompatible changes, or state that there are none.
- Every release entry is synchronized with `CURRENT_STATUS.md` and `TASK_REGISTRY.md`.
