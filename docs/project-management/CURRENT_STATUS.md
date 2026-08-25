# Current Status

## ARCH-REFACTOR-003

ResearchHub has migrated its current product architecture to **Research Output
and Knowledge Infrastructure**. The DSH, Workflow, Skill, and Plugin runtime
boundaries are unchanged. New output is organized as reports, machine-readable
Research Objects, and Research Output Provenance; durable reusable knowledge
has a repository-level `knowledge/` boundary.

The public Research Object Envelope is available from
`packages/schemas/research-object.ts`. New `research-output/`, `knowledge/`,
`packages/schemas/`, and `packages/shared/` boundaries are intentionally
minimal. They do not add a graph database, RAG, extraction pipeline, or
automatic knowledge formation.

`packages/artifacts/`, `packages/memory/`, and `packages/evaluation/` remain
for compatibility and test coverage. Artifact Trace is now documented as
Research Output Provenance. Memory and Evaluation are deprecated as
independent product layers, and no DSH, Skill, Workflow, or Plugin logic was
changed.

## KNOWLEDGE-ARCHITECTURE-001

Knowledge Layer v0.1 is frozen as the current Knowledge architecture. Knowledge
is a top-level durable asset under `knowledge/`, not a package and not a
runtime coordination layer. The frozen model supports dynamic industry
knowledge in five categories: facts, forecasts, viewpoints, trends, and
risks.

Workflow owns Knowledge update orchestration and lifecycle management. The
Knowledge Skill provides the access interface. No Research Artifact Layer,
Knowledge Database, Graph Database, RAG, LLM Extraction, or autonomous update
engine is introduced. `packages/memory/` and `packages/evaluation/` remain
compatibility implementations only.

The frozen v0.1 detail documents are [Knowledge Skill Interface
v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md) and
[Knowledge Storage Layout v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md).
The Skill interface is deterministic and read-only; the storage document
defines asset organization without defining a database or runtime.

## KNOWLEDGE-IMPLEMENTATION-PHASE-001

The first Knowledge engineering foundation is implemented. The repository now
has the top-level Knowledge asset directories, a deterministic YAML/JSON
Knowledge Loader with registry parsing and in-memory indexes, a read-only
Knowledge Access Skill, and a deterministic Knowledge Validation Skill with
structured reports.

The AI Hardware fixture dataset under `tests/knowledge/fixtures/` covers valid
entities, relations, intelligence, modules, sources, registry entries, and
deliberately invalid assets. Loader, Access Skill, Validation Skill, and
fixture-to-consumer integration tests pass without network, database, RAG, or
LLM dependencies.

Current limitation: the YAML reader intentionally supports the deterministic
subset required by the fixture assets; advanced YAML features such as anchors,
tags, and custom types are rejected. Production Knowledge assets are not yet
populated under `knowledge/`.

## MEMORY-IMPLEMENTATION-001

Compatibility note: the Research Knowledge Memory MVP is implemented under
`packages/memory/`; it is not the current Knowledge Layer v0.1.
`MemoryItem`, `ResearchMemory`, and `InMemoryResearchMemoryStore` support
runtime-neutral storage and retrieval of Entity, Thesis, Prediction, Evidence,
and Review knowledge with Artifact and Trace references.

The existing `MemoryEntry`, `MemoryPlugin`, and local JSON compatibility path
remain unchanged. Automatic Memory Formation, database persistence, DSH Memory,
Agent Memory, Chat History, Prompt storage, and Knowledge Graph infrastructure
remain out of scope.

## PIPELINE-TRACE-INTEGRATION-001

Artifact Trace is now enabled by default for each `EquityResearchWorkflow`
instance. The Workflow owns an isolated `InMemoryTraceStore` and routes final
Evidence, Thesis, Prediction, and ResearchReport assembly through the
runtime-neutral `TraceArtifactBuilder`.

The canonical report trace ID is
`report:equity-research:<sessionId>`. A lineage query returns ResearchReport
containment, Thesis support from Evidence, and Prediction derivation from
Thesis. Existing Artifact Core payloads, Skill logic, Plugin interfaces, DSH,
and Workflow definitions remain unchanged.

## ARTIFACT-TRACE-IMPLEMENTATION-001

Artifact Trace Governance MVP is implemented under `packages/artifacts/trace/`.
It provides an append-only `InMemoryTraceStore`, Trace Event factories for
creation, update, derivation, linking, and validation, and bidirectional
lineage queries for Evidence, Thesis, Prediction, Review, and
`research_report` references without changing the current Artifact Core union.

`TraceArtifactBuilder` is an opt-in integration boundary around the existing
Evidence, Thesis, and Prediction builders, with a report-linking helper. The
design explicitly excludes DSH/Harness tracing, Agent Runtime logs, LLM tokens,
prompts, model reasoning, database storage, and automatic instrumentation. The
existing pipeline remains unchanged unless it opts into the builder.

## PIPELINE-REAL-DATA-003

The first real Equity Research Pipeline using CNINFO Official Announcements,
AKShare Financial, and the DeepSeek Runtime completed successfully for
`600519`.

Observed run:

- CNINFO Acquisition: 3 SearchResults, 3 fetched documents, 3 normalized
  articles, and 3 traceable Evidence records;
- AKShare Financial: real financial facts reached the Workflow context;
- DeepSeek Runtime: 5 Skill calls completed;
- Equity Research Workflow: all 6 steps completed;
- Artifacts: 9 Evidence records, linked Thesis and Prediction, and a
  22-section ResearchReport;
- Evaluation: `met`.

The real test is opt-in through `RUN_REAL_EQUITY_PIPELINE=1`,
`AKSHARE_FINANCIAL_ENDPOINT`, and `DEEPSEEK_API_KEY`. The default test suite
remains network-free.

## CNINFO-PROVIDER-FIX-001

CNINFO Official Announcement Provider has been fixed for real-data use. The
adapter now resolves `600519` through CNINFO's official stock directory to
`600519,gssh0600519`, sends browser-compatible request headers, supports
`seDate` ranges, accepts epoch-millisecond publication times, and treats a
zero-count null announcement list as an empty result.

CNINFO PDF announcements are fetched and text-extracted through `pdfjs-dist`
when inline announcement content is unavailable. The opt-in real test now
completes the full `CNINFO -> News Acquisition -> Evidence` path for `600519`.
The default suite remains network-free.

## NEWS-PROVIDER-002

The News Acquisition Layer now includes an alternative real-data path for
official company announcements. `OfficialAnnouncementSearchProvider` reuses
the existing CNINFO source adapter, maps official records to `SearchResult`,
and preserves source URL, publication time, issuer, security code, confidence,
and official-source metadata. `OfficialAnnouncementFetcher` carries the
official API's returned announcement content through the existing
Search -> Fetch -> Normalize -> Evidence path, including disclosures whose
source URL points to a PDF.

GDELT remains supported and unchanged. The default test suite does not access
the network. Real CNINFO validation is explicitly opt-in with
`RUN_REAL_OFFICIAL_NEWS=1 npm run test:official-news-real` and can use
`CNINFO_ANNOUNCEMENT_ENDPOINT` plus `OFFICIAL_NEWS_SYMBOL` for endpoint and
symbol overrides.


## Architecture

The Single DSH migration remains implemented, but current governance is now
defined by Research Output and Knowledge architecture. ResearchHub is
financial research knowledge infrastructure on DeepSeek Harness, not an Agent
Framework. The root-level `dsh/` directory contains the lightweight
ResearchManager Runtime Orchestrator. `packages/workflows` contains
runtime-neutral research SOP templates, `packages/skills` contains research
methods, and `packages/plugins` contains external-resource contracts and
adapters.

The `packages/` directory contains only composable research modules;
`packages/dsh` does not exist.

The removed top-level directories are not retained. Artifact core models and
verified Skill behavior were preserved through import and contract migration.

The current development phase is **Research Output & Knowledge
Infrastructure**. The
validated foundation includes:

- Harness integration and runtime boundary validation;
- Event Analysis, Company Research, and Industry Research Skills;
- Workflow definitions and thin executors;
- Artifact Trace as Research Output Provenance;
- compatibility Memory and Evaluation APIs, retained without new product-layer
  expansion;
- Research Output and Knowledge Layer boundaries.

Harness owns runtime execution and LLM reasoning. ResearchManager coordinates
these assets without becoming an Agent Planner.

The dependency direction is `dsh/` → `packages/`. Packages do not import DSH
types or implementation details, so the research assets can be reused by
another Runtime or external caller.

## Completed validation

- TypeScript compilation passes.
- Plugin registry and adapter tests pass.
- Workflow and ResearchManager tests pass.
- Artifact, Memory, Evaluation, Skill, and Harness integration tests pass.
- No source imports the removed package paths.
- Research Output Architecture, Knowledge Layer Architecture, and ADR-014
  define the current governance boundaries. Architecture v0.3 and ADR-013
  remain historical compatibility records.

## Known constraints

Real external data activation still depends on credentials, source licensing,
bridge availability, rate limits, and data-quality review. Fixture tests remain
network-free and deterministic.

The financial Skill Asset Layer now includes runtime-neutral Equity Research,
Industry Research, Earnings Review, and Valuation packages. Each package has
its own definition, command implementation, schemas, report template, and
deterministic tests. The commands consume only injected Plugin ports, so they
can be called by DSH or another Runtime.

The root DSH financial-skill invocation smoke test also passes.

Pipeline validation is complete for the minimum Company Equity Research demo.
The validated path is:

`Research request → ResearchManager → Company Research Workflow → Company Research Skill → Market/News/Financial Plugins → Evidence/Thesis/Prediction Artifacts → Evaluation Review`

The integration fixture uses a public-company A-share example (`600519`) and
verifies Plugin call order, Workflow step dependencies, natural-language
question propagation, Artifact serialization round trips, and a successful
Evaluation result.

The formal `Equity Research Workflow` is now implemented under
`packages/workflows/equity-research/`. It composes Company Research, Industry
Research, Equity Research, Earnings Review, and Valuation through injected
Skill Adapters, exposes six step states, and returns a linked Evidence,
Thesis, Prediction, and ResearchReport bundle. The Workflow has no DSH or
Plugin implementation dependency.

Real LLM Runtime validation is complete for the Equity Research Workflow. The
runtime-specific adapter under `dsh/llm-runtime/` loads Skill prompts, calls
the Harness `LlmRuntime`, validates structured JSON responses, and maps them
to the existing Skill output contracts without changing Skill definitions,
Workflow structure, Plugin interfaces, or Artifact models. An opt-in test
using the DeepSeek-compatible provider path completed five Skill calls and
verified the final Artifact bundle, serialization round trips, and Evaluation
Review. The default test suite remains network-free; run
`RESEARCHHUB_RUN_REAL_LLM=1 npm run test:runtime` only when credentials and a
billable provider call are intended.

Real News Plugin validation is complete for the GDELT DOC provider. The
runtime-neutral `GdeltNewsPlugin` adapter retrieves bounded ArticleList JSON,
normalizes publication timestamps and source domains, and registers behind
the unchanged News Plugin interface. The explicit integration test maps the
external records into Company Research Evidence, verifies Artifact
serialization, and produces a successful Evaluation Review. The real test is
opt-in with `RUN_REAL_NEWS_PLUGIN=1`; default tests remain network-free.

Real Financial Plugin validation is implemented for the Tushare provider. The
existing `TushareFinancialPlugin` now combines documented statement endpoints
with `fina_indicator` and normalizes revenue, net profit, margins, EPS, and
basic financial ratios into the unchanged FinancialData boundary. The
Financial Plugin converts these reported facts into Evidence without making
investment judgments. Integration coverage passes the snapshot through the
Equity Research and Valuation Skill ports, serializes the resulting Artifacts,
and evaluates a traceable Prediction. The real test is opt-in with
`RUN_REAL_FINANCIAL_PLUGIN=1` and `TUSHARE_TOKEN`; the default suite remains
network-free.

AKShare is now the default real Financial Provider. The runtime-neutral
`AkShareFinancialPlugin` lives under `packages/plugins/adapters/financial/akshare/`
and connects through the configured HTTP Bridge, while the previous import path
remains a compatibility re-export. It normalizes the same revenue, profit,
margin, EPS, and ratio metrics as Tushare, feeds the unchanged Financial
Plugin and Evidence mapping, and is covered by an opt-in Equity Research
Workflow integration test. Tushare remains available as an explicit optional
Provider. The AKShare test requires `RUN_REAL_AKSHARE_FINANCIAL=1` and
`AKSHARE_FINANCIAL_ENDPOINT`; default tests remain network-free.

The first real Equity Research Pipeline validation is now implemented as an
opt-in integration test. It composes GDELT News, the default AKShare Financial
Provider, the DeepSeek Harness LLM Runtime, ResearchManager, and the existing
six-step Equity Research Workflow. The test verifies real provider payloads
reach all five LLM Skill calls, the Workflow completes, the ResearchReport and
Artifact relationships serialize correctly, and Evaluation returns a met
Review. The test requires `RUN_REAL_EQUITY_PIPELINE=1`,
`DEEPSEEK_API_KEY`, and `AKSHARE_FINANCIAL_ENDPOINT`; the earlier version
remained skipped until the AKShare Bridge endpoint was supplied.

`PIPELINE-REAL-DATA-002` now routes real news through the News Acquisition
Layer (`gdelt-search -> native-web-fetcher -> HtmlArticleNormalizer ->
NewsEvidenceBuilder`) instead of directly depending on `GdeltNewsPlugin`. The
test records acquisition counts, Provider metadata, Skill output summaries,
Workflow step states, Artifact relationships, and Evaluation status. The
offline path passes and remains network-free by default.

The first opt-in execution reached the Acquisition test boundary but was
blocked before Search returned by the current environment's GDELT connectivity:
Node initially reported `UND_ERR_CONNECT_TIMEOUT` on the GDELT host; enabling
Node's environment proxy mode still timed out, and the subsequent PowerShell
probe also timed out. No real Workflow, LLM, Artifact, or Evaluation result is
claimed from that attempt. The remaining blocker is external GDELT/proxy
availability, not the AKShare Bridge or the Acquisition Layer contract.

The News Acquisition Layer is now implemented as a runtime-neutral,
provider-independent path:

`SearchProvider -> WebFetcher -> ArticleNormalizer -> EvidenceBuilder`

It includes GDELT and Mock Search Providers, Native and Mock Web Fetchers,
HTML normalization, and serializable Evidence mapping. The existing GDELT News
Plugin and `search_company_news` contract remain compatible. Deterministic
acquisition tests are part of the default suite; real GDELT and web-fetch
coverage requires `RUN_REAL_NEWS_ACQUISITION=1`.
