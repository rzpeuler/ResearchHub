# Task Registry

ResearchHub 的轻量任务数据库。每个可独立执行、审查和验收的工程任务都使用稳定的 Task ID。

## 状态定义

- **Planned**：已登记，尚未开始。
- **In Progress**：正在执行。
- **Review**：实现完成，等待审查或验收。
- **Completed**：实现和必要验证均完成。
- **Blocked**：存在明确阻塞，无法继续。

## 任务列表

| Task ID | Task Name | Status | Priority | Created | Assignee | Commit Hash | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RH-GOV-001 | Initialize project execution state management system | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-DOC-002 | Synchronize architecture baseline documentation | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-ENG-001 | Validate minimum ResearchHub Harness integration | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — typecheck and integration test passed |
| RH-ENG-002 | Add financial plugin foundation and Market Plugin MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — plugin, plugin and integration tests passed |
| RH-DESIGN-001 | Add Research Artifact Framework foundation | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — type, validation, serialization and relationship tests passed |
| RH-ENG-003A | Add Event Analysis Skill Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Skill, Plugin, Artifact and Session integration tests passed |
| RH-DESIGN-002 | Add Research Memory Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Memory core, Local JSON plugin, adapter and full tests passed |
| RH-DESIGN-003 | Add Research Evaluation Framework MVP | Completed | P0 | 2026-08-23 | Luna | `febd88f88150bba025b6f3c1dd59f7bd73dfd8db` | Accepted — Review, Outcome, Evaluation Engine and Memory tests passed |
| RH-DESIGN-004 | Add financial data plugin framework | Completed | P0 | 2026-08-23 | Luna | `7dbbde94019f648219b3f4c137cc67b1ffaacb7e` | Accepted — Plugin, Registry, Plugin bridge and full tests passed |
| RH-ENG-005 | Add real A-share market data plugins | Completed | P0 | 2026-08-23 | Luna | `336213464b61d03fbed95738eff67bce46665461` | Accepted — Tushare, AkShare, normalization, fallback and full tests passed |
| RH-DESIGN-006 | Design Information Plugin architecture | Completed | P0 | 2026-08-24 | Luna | `7f7fb65db70827d02aaa40e8786ca18b9000faa1` | Accepted — NewsItem, Plugin Interface, Source Hierarchy and compatibility design completed |
| RH-ENG-006 | Implement Announcement Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `e0e8e5b3d3320be2624c5583d2e590f8b63714ad` | Accepted — CNINFO adapter, NewsItem normalization, symbol mapping, Registry, Plugin and Event Analysis tests passed |
| RH-ENG-007 | Implement Professional Media Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `6b162241c4e55492bf3b6a2b53d5aa1316cbcd34` | Accepted — media NewsItem, publisher/tier metadata, Registry, News Plugin and Event Analysis tests passed |
| RH-DESIGN-007 | Design Financial Intelligence Data Layer | Completed | P0 | 2026-08-24 | Luna | `7cf3187961bec7bf0cfadd0dd74a745366fae864` | Accepted — FinancialStatement, FinancialMetric, Plugin, Plugin, Evidence and Memory compatibility design completed |
| RH-ENG-008 | Implement Financial Statement Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `05b216b0022618c55ae2fcddfe081f36f472a742` | Accepted — Tushare/AkShare adapters, normalization, Financial Plugin, Evidence integration and full tests passed |
| RH-DESIGN-008 | Design Research Workflow Architecture | Completed | P0 | 2026-08-24 | Luna | `77f0728ade15a1d38ee4050499da98241bcf7595` | Accepted — Workflow, Research Manager, Harness boundary, Report aggregation and compatibility design completed |
| RH-ENG-009 | Implement Research Workflow Framework MVP | Completed | P0 | 2026-08-24 | Luna | `c809b19bb59ecc901536d840950440bcf810cb4e` | Accepted — Workflow Registry, Research Manager, Event Analysis chain, Report View, Harness integration and E2E tests passed |

| RH-ENG-010 | Upgrade Event Analysis Skill Architecture | Completed | P0 | 2026-08-24 | Luna | `229f523cb13ce9bf19a46063a4bd45397a81425b` | Accepted — Skill Package, research method, Evidence/output schemas, Evaluation rules and full regression tests passed |

| RH-ENG-011 | Implement Company Research Skill Package MVP | Completed | P0 | 2026-08-24 | Luna | `1d342afd7f14bd8a7edf7633e8968484cc3860a9` | Accepted — Company Skill Package, company-research Workflow, Artifact chain, Evaluation compatibility, and E2E tests passed |
| RH-DESIGN-012 | ResearchHub Architecture Simplification & Governance Update | Completed | P0 | 2026-08-24 | Luna | Current task commit | Accepted — Architecture v0.3, ADR-010, Harness boundary, and project governance synchronized |
| ARCH-REFACTOR-002 | Separate DSH Runtime from Research Assets | Completed | P0 | 2026-08-24 | Luna | Current task commit | Accepted — root dsh Runtime Orchestrator, package boundaries, one-way dependency, imports, tests, and governance synchronized |

## RH-DESIGN-004 Acceptance Scope

- `DataPlugin`、`PluginResult` 和 `FinancialDataMetadata` 已定义并进行运行时校验。
- `PluginRegistry` 支持注册、类型化 Handle 查询、重复/未知 Plugin 错误。
- Mock Market/News Plugin 位于 `packages/plugins/adapters/`，未接入真实 API 或爬虫。
- Market/News Plugin 通过 Registry 获取 Plugin，不直接导入或实例化具体 Plugin。
- Plugin 输出保留 source、timestamp、quality、confidence 元数据。
- TypeScript、Plugin、Plugin、Artifact、Memory、Evaluation、Skill 和 Harness integration 测试通过。

## RH-ENG-005 Acceptance Scope

- `TushareMarketPlugin` and `AkShareMarketPlugin` implement the common `DataPlugin` boundary without SDK dependencies.
- Tushare uses native HTTP with `TUSHARE_TOKEN`; AkShare uses an explicit `AKSHARE_ENDPOINT` bridge and never silently falls back to Mock.
- PluginResult metadata includes `plugin`, `source`, `timestamp`, `quality` and `confidence`.
- Market Plugin method, input and business output contract remain unchanged.
- Registry composition supports configured primary/fallback, combined failure context and deterministic injected-transport tests.
- No real network call is made by the default test suite; no Harness Core, trading logic or frozen architecture change was introduced.

## RH-DESIGN-006 Acceptance Scope

- `NewsItem` 定义了 title、content、publishedAt、source、sourceType、symbols 和 confidence。
- `sourceType` 严格限制为 `official`、`media`、`community`。
- Information Plugin 复用 `DataPlugin`、`PluginResult` 和 `FinancialDataMetadata`。
- Source Metadata、Plugin Metadata 和 item-level confidence 的边界已明确。
- 未接入真实新闻 API、公告源、政策源、爬虫、NLP 或情绪分析。

## RH-ENG-006 Acceptance Scope

- `AnnouncementPlugin` emits canonical official `NewsItem` values with source metadata.
- `CninfoAnnouncementSourceAdapter` isolates official-source protocol and uses injectable transport.
- Security-code and explicit issuer-name mappings reject ambiguous or mismatched announcements.
- Registry exposes `announcement-plugin` through an unchanged News Plugin contract.
- Plugin, Plugin, and Event Analysis integration tests pass without network dependency.
- No Harness Core, News Plugin implementation, Event Analysis Skill, trading logic, NLP, crawler, or frozen architecture document was changed.

## RH-ENG-007 Acceptance Scope

- `MediaPlugin` emits `sourceType: 'media'` NewsItem-compatible records.
- Media metadata includes `publisher`, strict `tier-1|tier-2|tier-3`, and confidence.
- Fixture `ProfessionalMediaSourceAdapter` isolates source integration without network dependency.
- Registry exposes `media-plugin` through an unchanged News Plugin contract.
- Plugin and Event Analysis integration tests pass.
- No named media API, News Plugin implementation, Event Analysis Skill, NLP, sentiment, community-opinion, trading, or frozen architecture document was changed.

## RH-DESIGN-007 Acceptance Scope

- Historical `FinancialStatement` and `FinancialMetric` models preserve period, unit, currency, source, and confidence.
- Financial Plugin reuses `DataPlugin`, `PluginResult`, `FinancialDataMetadata`, and Plugin Registry.
- Financial Plugin converts structured facts into existing Evidence Artifacts.
- Thesis, Prediction, Evaluation, and Memory compatibility is documented without adding raw financial Memory entries.
- No real API, forecast model, valuation strategy, investment advice, trading logic, or frozen architecture document was changed.

## RH-ENG-008 Acceptance Scope

- `TushareFinancialPlugin` and `AkShareFinancialPlugin` implement the common Financial Plugin boundary without SDK dependencies in the TypeScript runtime.
- Income, balance-sheet, and cash-flow fields are normalized to `FinancialStatement` and `FinancialMetric` with period, unit, plugin, source, timestamp, quality, and confidence metadata.
- Plugin Registry composition supports configurable primary/fallback selection and fixture-only injection for tests.
- Financial Plugin exposes `get_financial_snapshot(symbol)` and does not contain vendor calls, credentials, forecasts, valuation logic, or investment advice.
- Financial Evidence Adapter creates session-linked Evidence artifacts from reported metrics.
- TypeScript, Plugin, Plugin, Artifact, Memory, Evaluation, Skill, and Event Analysis integration tests remain green.
- No Harness Core, frozen architecture document, external production dependency, or real network call was introduced into the default test suite.

## RH-DESIGN-008 Acceptance Scope

- Workflow Definition is independent from Skill and contains lifecycle metadata, steps, inputs, outputs, dependencies, and version.
- Research Manager coordinates research intent, Workflow selection, Skill execution, Artifact collection, and Report assembly.
- Harness Workflow Runtime / Harness Runtime Loop remains the execution boundary; ResearchHub does not build a parallel Harness Workflow Runtime, Harness Runtime, or Plugin Runtime.
- Skill remains reusable research methodology and does not contain cross-skill workflow graphs or direct data-source calls.
- Research Report is an aggregate view over Evidence, Thesis, and Prediction Artifact IDs, not a new base Artifact type.
- Artifact, Memory, Evaluation, Plugin, Plugin, Session, and Cordis Plugin boundaries remain compatible.
- RH-ENG-009 is the next engineering implementation task; no production workflow code is included in this design task.

## RH-ENG-009 Acceptance Scope

- Workflow Definition and Registry validate and register the `event-analysis` workflow.
- Research Manager validates Research Requests, resolves Workflows, creates execution context, invokes an injected executor, and aggregates Artifact IDs into a non-Artifact Report View.
- Harness-facing Research Manager service and `run_research_workflow` tool reuse the existing DSH, Session, Skill, Tool, and JSONL persistence boundaries.
- Event Analysis invokes Market, Announcement, Media, and Financial Plugin ports; Announcement and Media reuse the existing News Plugin contract through different Plugin Handles.
- Evidence, Thesis, and Prediction are created with the active Session ID and validated relationships.
- TypeScript, workflow, Manager, existing plugin/artifact/memory/evaluation/skill tests, and Harness end-to-end workflow test pass.
- No Harness Core, Harness Runtime Loop, Harness Workflow Runtime, Plugin Runtime, trading logic, investment advice, or external network dependency was introduced.

## 历史 RH-ENG-001 约束

- DeepSeek Harness `0.1.1-rc.2` 依赖版本已锁定。
- `tests/integration/` 是验证代码隔离区，不是生产业务实现。
- Runtime → Extension → DSH → Skill → Plugin → Session 路径已验证。
- 未修改 Harness Core、业务 API、生产配置或金融业务逻辑。

## 登记规则

- Task ID 必须稳定、唯一且可搜索。
- 新任务记录名称、状态、优先级、创建时间和验收标准。
- Completed 任务必须记录完成人、commit hash 和验收状态。
- Blocked 任务必须记录阻塞原因和恢复条件。
