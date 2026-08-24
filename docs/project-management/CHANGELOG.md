# Changelog

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
