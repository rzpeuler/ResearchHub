# Changelog

## 2026-08-25 - KNOWLEDGE-PHASE-2C-FINAL-CLOSEOUT-001

- Switched company-scale visualization from relation `segmentRevenue` to
  company `total-revenue` Financial Facts.
- Kept visual normalization in the frontend and downgraded mixed period/unit
  inputs to equal-size cards without creating a market-share metric.
- Localized remaining human-readable AI Hardware Entity and View names to
  Chinese-first display names while preserving stable IDs and professional
  terms.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-SEMANTICS-AND-LOCALIZATION-001

- Replaced frontend Market Share projection semantics with raw company-scale
  revenue inputs and comparable-period/unit/scope visual sizing.
- Removed market-share percentage presentation from the Knowledge page and
  migrated the View section to `company-scale`.
- Localized production Entity, Intelligence, Module, View, and frontend
  research content to Chinese-first while preserving stable machine contracts
  and source provenance.

## 2026-08-25 - KNOWLEDGE-PHASE-2C-FRONTEND-MIGRATION-001

- Added a deterministic server-side Knowledge Frontend Projection Adapter.
- Added read-only directory, graph, and Entity detail HTTP endpoints to the
  existing Knowledge server.
- Migrated the AI Hardware page from legacy JSON runtime inputs to Production
  Knowledge projections, including dynamic Modules, Intelligence, event Facts,
  and Source links.
- Preserved legacy JSON files as benchmark assets while removing their page
  runtime dependency.

## 2026-08-25 - KNOWLEDGE-PRODUCTION-DATASET-V0.1-REWORK-001

- Corrected NVIDIA and AMD Data Center revenue facts so financial reporting
  segments are not treated as Knowledge GPU or Server revenue.
- Added module-level source provenance validation and primary source references
  to all production comparison Modules.
- Replaced the single-node Electronics taxonomy placeholder with the complete
  31-item SW Level-1 catalog using stable `sw:*` IDs.
- Removed legacy `documents`, `graph`, `ingestion`, and `ontology` placeholders.

## 2026-08-25 - KNOWLEDGE-IMPLEMENTATION-PHASE-001-REWORK-001

- Added `test:knowledge` to the main `npm test` chain.
- Made Registry paths authoritative when a Registry is present, with discovery
  fallback only when no Registry exists.
- Added typed YAML relation, Intelligence, and Lifecycle rule configuration.
- Corrected scoped Validation reference indexing and Intelligence required-field
  checks.
- Added canonical relation vocabulary, complete AI Hardware Registry entries,
  and Entity-to-Module Registry bindings.
- Added Registry, Module Registry, canonical relation, and Workflow-level
  integration coverage.

## 2026-08-25 - KNOWLEDGE-PRODUCTION-DATASET-V0.1

- Added the source-traceable AI Hardware production dataset under `knowledge/`.
- Migrated market, financial, event, forecast, viewpoint, trend, and risk data
  into Intelligence objects instead of embedding dynamic claims in Entities.
- Added production Taxonomy, View, comparison Modules, Module Registry, and a
  complete runtime Registry.
- Added production-loader, access-query, and non-placeholder-source tests.

## 2026-08-25 - KNOWLEDGE-IMPLEMENTATION-PHASE-001

- Added the top-level Knowledge asset directories under `knowledge/`.
- Implemented the deterministic Knowledge Loader with YAML/JSON parsing,
  registry discovery, explicit reload, and in-memory indexes.
- Added the read-only Knowledge Access Skill APIs for entities, relations,
  supply chains, companies, intelligence, modules, comparisons, and sources.
- Added the deterministic Knowledge Validation Skill and structured validation
  reports for schema, IDs, references, relations, lifecycle, modules, and
  source requirements.
- Added AI Hardware valid/invalid fixtures and closed the loader → validation
  → index → access Skill → consumer integration test path.
- Kept the implementation network-free and did not add a database, RAG, LLM
  extraction, Research Artifact, or Multi-Agent layer.

## 2026-08-25 - ARCH-REFACTOR-003

- Migrated current architecture terminology to Research Output, Research
  Object, and Knowledge Infrastructure.
- Added `research-output/` and `knowledge/` boundaries, plus shared schema and
  utility package placeholders.
- Added the runtime-neutral Research Object Envelope with stable provenance
  fields and Skill-owned payloads.
- Repositioned Artifact Trace as Research Output Provenance.
- Deprecated Memory and Evaluation as independent product layers while
  retaining their implementations and tests for compatibility.
- Added the Research Output and Knowledge architecture documents and ADR-014.

## 2026-08-24 - MEMORY-IMPLEMENTATION-001

- Implemented `MemoryItem`, `ResearchMemory`, and
  `InMemoryResearchMemoryStore` under `packages/memory/`.
- Added filtering by entity, topic, industry, type, Artifact ID, confidence,
  minimum confidence, and result limit.
- Added validation that rejects Prompt, Token, Model Reasoning, and Runtime
  payload fields.
- Added Artifact -> Trace -> Memory Reference integration coverage.
- Preserved the existing `MemoryEntry` and `MemoryPlugin` compatibility path.

## 2026-08-24 - PIPELINE-TRACE-INTEGRATION-001

- Enabled Artifact Trace by default for each Equity Research Workflow
  instance using an isolated `InMemoryTraceStore`.
- Routed Workflow Evidence, Thesis, Prediction, and ResearchReport assembly
  through `TraceArtifactBuilder`.
- Added complete report lineage coverage for `contains`, `supports`, and
  `derived_from` relations, including a deterministic `600519` Mock Pipeline
  integration test.
- Preserved existing Artifact Core, Skill, Plugin, DSH, and Workflow behavior.

## 2026-08-24 - ARTIFACT-TRACE-IMPLEMENTATION-001

- Implemented the Artifact Trace Governance MVP under
  `packages/artifacts/trace/`.
- Added immutable Trace Event factories for created, updated, derived, linked,
  and validated lifecycle events, with explicit Artifact References and
  Lineage Relations.
- Added `InMemoryTraceStore` with `append`, `queryByArtifact`, `queryLineage`,
  and `getHistory` support.
- Added the opt-in `TraceArtifactBuilder` integration boundary without
  changing Artifact Core models or existing Workflow, Skill, Plugin, or DSH
  behavior.
- Added tests covering Evidence creation, Thesis/Prediction derivation,
  ResearchReport containment, complete lineage queries, duplicate events, and
  prohibited runtime payloads.

## 2026-08-24 - ARTIFACT-TRACE-DESIGN-001

- Added the Artifact Trace Governance architecture design.
- Defined Trace Event, Artifact Reference, Lineage Relation, Trace Metadata,
  and TraceStore interface contracts.
- Added ADR-013 confirming Trace belongs to Artifact Governance and is not a
  DSH, Harness, Agent Runtime, LLM, or Memory tracing system.
- No production code or Artifact Core model was changed.

## 2026-08-24 - PIPELINE-REAL-DATA-003

- Updated the real Equity Research Pipeline to use CNINFO Official Announcement
  Provider instead of GDELT for the `600519` validation scenario.
- Validated 3 CNINFO Evidence records, real AKShare financial context, five
  DeepSeek Skill calls, all six Workflow steps, linked Thesis/Prediction,
  ResearchReport generation, and Evaluation status `met`.
- Kept the real execution opt-in and the default test suite network-free.

## 2026-08-24 - CNINFO-PROVIDER-FIX-001

- Fixed CNINFO entity resolution by loading the official stock directory and
  querying with the required `code,orgId` format, including `600519` ->
  `600519,gssh0600519`.
- Added CNINFO request headers and optional `seDate` support; normalized epoch
  millisecond announcement timestamps and empty zero-result responses.
- Added PDF text extraction for announcements whose API record has no inline
  content, preserving the existing News Acquisition and Evidence contracts.
- Real validation for `600519` completed with 3 announcement records and 3
  Evidence Artifacts; default tests remain network-free.

## 2026-08-24 - NEWS-PROVIDER-002

- Added `OfficialAnnouncementSearchProvider` as a non-GDELT real-data Provider
  backed by the existing CNINFO official announcement adapter.
- Added `OfficialAnnouncementFetcher` so official announcement content follows
  the existing Search -> Fetch -> Normalize -> Evidence path, including
  PDF-linked CNINFO disclosures whose content is returned by the official API.
- Preserved the GDELT Provider, the existing Announcement Plugin contract, and
  the runtime-neutral Plugin boundary.
- Added deterministic coverage and an opt-in real integration test controlled
  by `RUN_REAL_OFFICIAL_NEWS=1`; default tests remain network-free.
- The first opt-in run reached CNINFO but returned an empty announcement set
  for `600519`; the implementation does not claim a completed real-data run.

## 2026-08-24 - PIPELINE-REAL-DATA-002

- Updated the opt-in real Equity Research Pipeline test to use
  `GdeltSearchProvider -> NativeWebFetcher -> NewsAcquisitionLayer` instead of
  directly instantiating `GdeltNewsPlugin`.
- Added assertions and runtime summaries for Search, Fetch, Normalize,
  Evidence, Provider metadata, five Skill outputs, six Workflow steps, final
  Artifacts, and Evaluation.
- Confirmed the default test remains network-free.
- Attempted real execution, but GDELT/proxy connectivity timed out before
  Search returned; no real Pipeline completion is claimed until that external
  dependency is available.

## 2026-08-24 - NEWS-ACQUISITION-001

- Added the runtime-neutral News Acquisition Layer:
  `SearchProvider -> WebFetcher -> ArticleNormalizer -> EvidenceBuilder`.
- Added GDELT and Mock Search Providers, Native and Mock Web Fetchers, HTML
  normalization, and Evidence Artifact mapping with acquisition metadata.
- Preserved the existing GDELT News Plugin and `search_company_news` contract.
- Added deterministic acquisition integration coverage and an opt-in real
  network test controlled by `RUN_REAL_NEWS_ACQUISITION=1`.

## 2026-08-24 - Real Equity Research Pipeline Validation

- Added the strict opt-in
  `tests/integration/real-equity-research-pipeline.test.ts`.
- Composed real GDELT News, AKShare Financial, DeepSeek Harness Runtime,
  ResearchManager, and the existing six-step Equity Research Workflow.
- Added assertions for real provider context propagation, five LLM Skill
  calls, Workflow completion, ResearchReport and Artifact serialization, and
  Evaluation.
- Added `npm run test:real-equity-pipeline`; default tests remain network-free
  and the real test does not fall back to Fixtures.

## 2026-08-24 - AKShare Financial Provider

- Added the AKShare Financial Provider under
  `packages/plugins/adapters/financial/akshare/`.
- Made `akshare-financial` the default real Financial Provider while retaining
  Tushare as an explicit optional Provider.
- Preserved the existing Financial Plugin interface, normalized schema,
  Evidence mapping, and old AKShare import path through a compatibility shim.
- Added deterministic Provider coverage and an opt-in AKShare integration test
  through Financial Plugin, Evidence, and Equity Research Workflow.
- Added `RUN_REAL_AKSHARE_FINANCIAL=1` and
  `AKSHARE_FINANCIAL_ENDPOINT` support for explicit real-data validation.

## 2026-08-24 - Real Financial Plugin Validation

- Extended the existing Tushare Financial Provider Adapter with the
  documented `fina_indicator` endpoint.
- Normalized revenue, net profit, gross and net profit margins, EPS, current
  and quick ratios, and debt-to-assets into the existing FinancialData schema.
- Preserved the Plugin boundary and converted normalized facts into Evidence
  without adding investment or valuation logic to the Plugin.
- Added an opt-in integration test through Equity Research, Valuation,
  Artifact serialization, and Evaluation.
- Added `RUN_REAL_FINANCIAL_PLUGIN=1 TUSHARE_TOKEN=... npm run
  test:financial-real`; default tests remain network-free.

## 2026-08-24 - Real News Plugin Validation

- Added the GDELT DOC ArticleList News Provider Adapter.
- Preserved the existing News Plugin interface and PluginRegistry boundary.
- Added deterministic normalization/error tests and an opt-in real GDELT
  integration test through Company Research, Evidence, Artifact serialization,
  and Evaluation.
- Added `RUN_REAL_NEWS_PLUGIN=1 npm run test:news-real` for explicit network
  validation; default tests remain network-free.

## 2026-08-24 - Real LLM Runtime Validation

- Added a Harness `LlmRuntime`-backed Skill Adapter under `dsh/llm-runtime/`.
- Added strict structured-response validation and mapping for the five Skills
  used by the Equity Research Workflow.
- Added an opt-in DeepSeek-compatible provider adapter and runtime test that
  completed five real Skill calls through ResearchManager.
- Verified Artifact serialization and Evaluation on the LLM-generated bundle;
  default `npm test` remains network-free.

## 2026-08-24 — End-to-End Research Pipeline Validation

- Added `PIPELINE-VALIDATION-001` integration coverage for the minimum Company
  Equity Research demo.
- Verified the complete DSH → Workflow → Skill → Plugin → Artifact → Evaluation
  path with deterministic Market, News, and Financial Plugin fixtures.
- Verified natural-language request propagation, Workflow dependencies, linked
  Evidence/Thesis/Prediction Artifacts, serialization round trips, and a
  successful Evaluation Review.

## 2026-08-24 — Equity Research Workflow Composition

- Added the formal `equity-research` Workflow definition and execution asset.
- Composed Company Research, Industry Research, Equity Research, Earnings
  Review, and Valuation through injected Skill Adapters.
- Added ordered step states, fail-fast errors, linked Evidence/Thesis/Prediction
  output, runtime-neutral ResearchReport output, Registry discovery coverage,
  and DSH integration coverage.

## 2026-08-24 — Financial Research Skill Asset Migration

- Added runtime-neutral `equity-research`, `industry-research`,
  `earnings-review`, and `valuation` Skill packages.
- Added typed Plugin ports, YAML definitions, input/output schemas, report
  templates, command tests, and a root-DSH invocation smoke test.
- Preserved financial research methodology while excluding Claude bindings,
  slash commands, MCP runtime dependencies, and provider-specific orchestration.

## 2026-08-24 — Runtime and Research Asset Decoupling

- Moved the shared Workflow execution contract to
  `packages/workflows/execution.ts`.
- Removed the `packages/workflows` → `dsh` dependency.
- Confirmed `dsh/` as the default Runtime Orchestrator and `packages/` as
  reusable, runtime-neutral research assets.
- Documented the one-way dependency rule: `dsh/` → `packages/`.

## 2026-08-24 — DSH Control Plane Relocation

- Moved `ResearchManager` from `packages/dsh` to the repository root `dsh/`.
- Reserved `packages/` for composable Workflow, Skill, Plugin, Artifact,
  Memory, and Evaluation modules.
- Updated TypeScript inclusion, test scripts, imports, integration paths, and
  architecture governance references.
- Added ADR-011 for the DSH Control Plane Location Decision.
- Preserved ResearchManager, Workflow, Skill, Plugin, Artifact, Memory, and
  Evaluation behavior.

## 2026-08-24 — Architecture Simplification & Governance Update

- Adopted Architecture v0.3 as the current governance reference.
- Confirmed ResearchHub is a professional research asset layer on DeepSeek
  Harness, not a general-purpose Agent Framework.
- Confirmed Harness ownership of Agent, Tool, Session, loading, and LLM runtime
  services.
- Clarified the boundaries of ResearchManager, Workflow, Skill, Plugin,
  Memory, and Evaluation.
- Deprecated Capability, Provider, Research Planner, Workflow Composition,
  Workflow Engine, and Multi-Agent architecture as independent layers.
- Added ADR-010 and moved the project phase to Research Intelligence Layer.
- Preserved Architecture v0.2, Artifact core models, verified Skills, and
  existing Workflow, Memory, and Evaluation behavior.

## 2026-08-24 — Single DSH Architecture

- Adopted `ResearchManager` as the only DSH planning and coordination center.
- Established the DSH coordination boundary for ResearchManager.
- Moved external-resource contracts and adapters to `packages/plugins`.
- Split former domain data operations into Market, News, Financial,
  Announcement, and Media Plugins.
- Renamed Memory persistence connectors to the Plugin terminology.
- Removed obsolete top-level package paths and updated all imports and test
  scripts.
- Updated architecture, project-management, README, and ADR documentation.
- Verified TypeScript, Plugin, Workflow, Skill, Artifact, Memory, Evaluation,
  and Harness integration tests.
