# Current Status

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

The first opt-in CNINFO run reached the official endpoint successfully, but the
response contained `announcements: null` and `totalAnnouncement: 0` for
`600519`. It did not produce an Evidence Artifact, so no successful real-data
run is claimed until the upstream query returns announcement records.

## Architecture

The Single DSH migration is implemented and the architecture is now governed
by Architecture v0.3. ResearchHub is a professional research asset layer on
DeepSeek Harness, not an Agent Framework. The root-level `dsh/` directory
contains the lightweight ResearchManager Runtime Orchestrator. `packages/workflows`
contains runtime-neutral research SOP templates, `packages/skills` contains
research methods, and `packages/plugins` contains external-resource contracts
and adapters.

The `packages/` directory contains only composable research modules;
`packages/dsh` does not exist.

The removed top-level directories are not retained. Artifact core models and
verified Skill behavior were preserved through import and contract migration.

The current development phase is **Research Intelligence Layer**. The
validated foundation includes:

- Harness integration and runtime boundary validation;
- Event Analysis, Company Research, and Industry Research Skills;
- Workflow definitions and thin executors;
- Memory persistence for structured research history;
- Evaluation and research review support.

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
- Architecture v0.3, ADR-010, and ADR-011 define the current governance
  boundaries.

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
