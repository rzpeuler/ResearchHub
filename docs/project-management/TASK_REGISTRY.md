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
| RH-ENG-002 | Add financial capability foundation and Market Capability MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — capability, provider and integration tests passed |
| RH-DESIGN-001 | Add Research Artifact Framework foundation | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — type, validation, serialization and relationship tests passed |
| RH-ENG-003A | Add Event Analysis Skill Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Skill, Capability, Artifact and Session integration tests passed |
| RH-DESIGN-002 | Add Research Memory Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Memory core, Local JSON provider, adapter and full tests passed |
| RH-DESIGN-003 | Add Research Evaluation Framework MVP | Completed | P0 | 2026-08-23 | Luna | `febd88f88150bba025b6f3c1dd59f7bd73dfd8db` | Accepted — Review, Outcome, Evaluation Engine and Memory tests passed |
| RH-DESIGN-004 | Add financial data provider framework | Completed | P0 | 2026-08-23 | Luna | `7dbbde94019f648219b3f4c137cc67b1ffaacb7e` | Accepted — Provider, Registry, Capability bridge and full tests passed |
| RH-ENG-005 | Add real A-share market data providers | Completed | P0 | 2026-08-23 | Luna | `336213464b61d03fbed95738eff67bce46665461` | Accepted — Tushare, AkShare, normalization, fallback and full tests passed |
| RH-DESIGN-006 | Design Information Provider architecture | Completed | P0 | 2026-08-24 | Luna | `7f7fb65db70827d02aaa40e8786ca18b9000faa1` | Accepted — NewsItem, Provider Interface, Source Hierarchy and compatibility design completed |
| RH-ENG-006 | Implement Announcement Provider MVP | Completed | P0 | 2026-08-24 | Luna | `e0e8e5b3d3320be2624c5583d2e590f8b63714ad` | Accepted — CNINFO adapter, NewsItem normalization, symbol mapping, Registry, Capability and Event Analysis tests passed |
| RH-ENG-007 | Implement Professional Media Provider MVP | Completed | P0 | 2026-08-24 | Luna | `6b162241c4e55492bf3b6a2b53d5aa1316cbcd34` | Accepted — media NewsItem, publisher/tier metadata, Registry, News Capability and Event Analysis tests passed |
| RH-DESIGN-007 | Design Financial Intelligence Data Layer | Completed | P0 | 2026-08-24 | Luna | Updated after commit | Accepted — FinancialStatement, FinancialMetric, Provider, Capability, Evidence and Memory compatibility design completed |

## RH-DESIGN-004 Acceptance Scope

- `DataProvider`、`ProviderResult` 和 `FinancialDataMetadata` 已定义并进行运行时校验。
- `ProviderRegistry` 支持注册、类型化 Handle 查询、重复/未知 Provider 错误。
- Mock Market/News Provider 位于 `packages/providers/adapters/`，未接入真实 API 或爬虫。
- Market/News Capability 通过 Registry 获取 Provider，不直接导入或实例化具体 Provider。
- Capability 输出保留 source、timestamp、quality、confidence 元数据。
- TypeScript、Provider、Capability、Artifact、Memory、Evaluation、Skill 和 Harness integration 测试通过。

## RH-ENG-005 Acceptance Scope

- `TushareMarketProvider` and `AkShareMarketProvider` implement the common `DataProvider` boundary without SDK dependencies.
- Tushare uses native HTTP with `TUSHARE_TOKEN`; AkShare uses an explicit `AKSHARE_ENDPOINT` bridge and never silently falls back to Mock.
- ProviderResult metadata includes `provider`, `source`, `timestamp`, `quality` and `confidence`.
- Market Capability method, input and business output contract remain unchanged.
- Registry composition supports configured primary/fallback, combined failure context and deterministic injected-transport tests.
- No real network call is made by the default test suite; no Harness Core, trading logic or frozen architecture change was introduced.

## RH-DESIGN-006 Acceptance Scope

- `NewsItem` 定义了 title、content、publishedAt、source、sourceType、symbols 和 confidence。
- `sourceType` 严格限制为 `official`、`media`、`community`。
- Information Provider 复用 `DataProvider`、`ProviderResult` 和 `FinancialDataMetadata`。
- Source Metadata、Provider Metadata 和 item-level confidence 的边界已明确。
- 未接入真实新闻 API、公告源、政策源、爬虫、NLP 或情绪分析。

## RH-ENG-006 Acceptance Scope

- `AnnouncementProvider` emits canonical official `NewsItem` values with source metadata.
- `CninfoAnnouncementSourceAdapter` isolates official-source protocol and uses injectable transport.
- Security-code and explicit issuer-name mappings reject ambiguous or mismatched announcements.
- Registry exposes `announcement-provider` through an unchanged News Capability contract.
- Provider, Capability, and Event Analysis integration tests pass without network dependency.
- No Harness Core, News Capability implementation, Event Analysis Skill, trading logic, NLP, crawler, or frozen architecture document was changed.

## RH-ENG-007 Acceptance Scope

- `MediaProvider` emits `sourceType: 'media'` NewsItem-compatible records.
- Media metadata includes `publisher`, strict `tier-1|tier-2|tier-3`, and confidence.
- Fixture `ProfessionalMediaSourceAdapter` isolates source integration without network dependency.
- Registry exposes `media-provider` through an unchanged News Capability contract.
- Provider and Event Analysis integration tests pass.
- No named media API, News Capability implementation, Event Analysis Skill, NLP, sentiment, community-opinion, trading, or frozen architecture document was changed.

## RH-DESIGN-007 Acceptance Scope

- Historical `FinancialStatement` and `FinancialMetric` models preserve period, unit, currency, source, and confidence.
- Financial Provider reuses `DataProvider`, `ProviderResult`, `FinancialDataMetadata`, and Provider Registry.
- Financial Capability converts structured facts into existing Evidence Artifacts.
- Thesis, Prediction, Evaluation, and Memory compatibility is documented without adding raw financial Memory entries.
- No real API, forecast model, valuation strategy, investment advice, trading logic, or frozen architecture document was changed.

## 历史 RH-ENG-001 约束

- DeepSeek Harness `0.1.1-rc.2` 依赖版本已锁定。
- `tests/integration/` 是验证代码隔离区，不是生产业务实现。
- Runtime → Extension → Agent → Skill → Capability → Session 路径已验证。
- 未修改 Harness Core、业务 API、生产配置或金融业务逻辑。

## 登记规则

- Task ID 必须稳定、唯一且可搜索。
- 新任务记录名称、状态、优先级、创建时间和验收标准。
- Completed 任务必须记录完成人、commit hash 和验收状态。
- Blocked 任务必须记录阻塞原因和恢复条件。
