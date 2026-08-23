# Changelog

This file records recognizable project baseline and delivery changes.

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
