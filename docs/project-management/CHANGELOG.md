# Changelog

This file records recognizable project baseline and delivery changes.

## Version: v1.6.0

**Date:** 2026-08-24

**Changes:**

- Added the Workflow Definition model and validated Workflow Registry.
- Added Research Manager request validation, execution context, Artifact checks, and Report View aggregation.
- Added Harness-facing Research Manager service and `run_research_workflow` tool.
- Extended Event Analysis to run Market, Announcement, Media, and Financial Capability ports.
- Added deterministic Harness Agent/Session end-to-end workflow integration test.
- Added `docs/architecture/RESEARCH_WORKFLOW_IMPLEMENTATION.md`.

**Breaking Changes:**

- None. Existing Capability contracts, Artifact types, Memory/Evaluation boundaries, Harness Core, and Agent Loop remain unchanged.

## Version: v1.5.0

**Date:** 2026-08-24

**Changes:**

- Added the Research Workflow Architecture design.
- Defined declarative Workflow Definitions with steps, inputs, outputs, dependencies, and versioning.
- Defined Research Manager Agent coordination boundaries.
- Explicitly reused Harness Workflow Runtime / Agent Loop and prohibited a parallel ResearchHub Workflow Engine.
- Defined Research Report as an aggregate view over Evidence, Thesis, and Prediction Artifacts.
- Documented compatibility with Artifact, Memory, Evaluation, Capability, Skill, Session, and Cordis Plugin boundaries.
- Added `docs/architecture/RESEARCH_WORKFLOW_DESIGN.md`.

**Breaking Changes:**

- None. No production code, Harness Core, frozen architecture document, or new dependency was changed.

## Version: v1.4.0

**Date:** 2026-08-24

**Changes:**

- Added the Financial Statement Provider MVP with Tushare and AkShare adapters.
- Added common FinancialStatement/FinancialMetric normalization for income, balance-sheet, and cash-flow facts.
- Added configurable Provider Registry primary/fallback composition and fixture mode.
- Added `get_financial_snapshot(symbol)` Financial Capability.
- Added Financial Data → Evidence Artifact integration with source and session metadata.
- Added network-free Provider, Capability, Artifact, and integration tests.
- Added `docs/architecture/FINANCIAL_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. Existing Market, News, Event Analysis, Artifact, Memory, Evaluation, Harness Core, and frozen architecture contracts remain unchanged.

## Version: v1.3.0

**Date:** 2026-08-24

**Changes:**

- Added the Financial Intelligence Data Layer architecture.
- Defined `FinancialStatement` and `FinancialMetric` historical fact models.
- Defined Financial Provider and Financial Capability → Evidence boundaries.
- Documented compatibility with existing Artifact, Evaluation, and Memory flows.
- Added `docs/architecture/FINANCIAL_DATA_DESIGN.md`.

**Breaking Changes:**

- None. No real API, business code, Harness Core, frozen architecture document, or Memory schema was changed.

## Version: v1.2.0

**Date:** 2026-08-24

**Changes:**

- Added the Professional Media Provider MVP and `media-provider` Registry entry.
- Added shared Information Layer NewsItem types with media publisher, tier, and confidence metadata.
- Added deterministic fixture Source Adapter, Provider tests, News Capability integration, and Event Analysis integration.
- Added `docs/architecture/MEDIA_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. News Capability, Event Analysis Skill, Harness Core, frozen architecture documents, and external dependencies were unchanged.

## Version: v1.1.0

**Date:** 2026-08-24

**Changes:**

- Added the `AnnouncementProvider` canonical Information Provider.
- Added the CNINFO official-source adapter with injectable transport and deterministic fixtures.
- Added explicit stock-code and issuer-to-symbol mapping.
- Registered `announcement-provider` through the existing Provider Registry and preserved the News Capability contract through a boundary projection.
- Added Provider, News Capability, and Event Analysis integration tests.
- Added `docs/architecture/ANNOUNCEMENT_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. News Capability, Event Analysis Skill, Harness Core, frozen architecture documents, and production external dependencies were unchanged.

## Version: v1.0.0

**Date:** 2026-08-24

**Changes:**

- Added the Information Data Layer architecture for news, announcements and policy information.
- Defined the `NewsItem` model and strict `official` / `media` / `community` source hierarchy.
- Reused the existing Provider Framework and documented ProviderResult/source metadata boundaries.
- Added `docs/architecture/INFORMATION_PROVIDER_DESIGN.md`.

**Breaking Changes:**

- None. No News Capability, Harness Core, production code, external information API or crawler was changed.

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
