# Current Status

ResearchHub 的高频工程状态入口。每次完成可验收交付后，必须同步本文件、任务登记表和变更记录。

## 当前版本

`v1.6.0` — Research Workflow Framework MVP

## 当前阶段

**Phase 14 — Research Workflow Framework MVP**

架构基线仍为 ResearchHub Architecture v0.2、Technical Design v0.1，Runtime 版本锁定为 DeepSeek Harness `0.1.1-rc.2`。

## 已完成模块

- 项目治理文档体系。
- Harness Extension、Agent、Skill、Capability、Session 集成验证。
- Capability Framework 与 Market Capability MVP。
- Research Artifact Framework：Evidence、Thesis、Prediction、Review。
- Event Analysis Skill MVP。
- Research Memory Framework：Local JSON Memory Provider 与 Artifact Adapter。
- Research Evaluation Framework：Prediction → Outcome → Evaluation → Review → Memory。
- Financial Data Provider Core：`DataProvider`、`ProviderResult`、`FinancialDataMetadata`。
- Process-local `ProviderRegistry` 与类型化 `ProviderHandle`。
- `MockMarketProvider`、`MockNewsProvider` 已迁移到 `packages/providers/adapters/`。
- Market/News Capability 已通过 Registry 获取 Provider，并投影来源、时间戳、质量和置信度。
- Provider 单元测试、Capability 测试和 Harness 集成测试已覆盖 Registry 链路。
- `TushareMarketProvider` 与 `AkShareMarketProvider` 已实现，使用原生 `fetch` 和注入式 Fixture 测试。
- Market Provider primary/fallback composition 已实现，双失败会保留两个 Provider 的错误上下文。
- Tushare/AkShare 字段标准化、严格日期校验、endpoint 校验和凭证脱敏已完成。
- Information Data Layer 架构设计已完成：`NewsItem`、Provider Interface 和 official/media/community Source Hierarchy。
- Information Provider 与现有 Provider Framework、News Capability 的兼容边界已明确。
- `FinancialStatement`、`FinancialMetric` 统一财务事实模型与严格运行时校验已实现。
- `TushareFinancialProvider` 已实现收入、营业利润、净利润、资产、负债和经营现金流映射。
- `AkShareFinancialProvider` 已实现同构输出和 HTTP bridge 边界。
- Financial Provider primary/fallback composition、环境配置和凭证脱敏已实现。
- `FinancialCapability.get_financial_snapshot(symbol)` 已通过 Registry 调用 Provider。
- Financial Data → Evidence Artifact 适配器已实现，并保留 session、source、period 与 source statement IDs。
- Provider、Capability、Artifact 和 integration fixture 测试已加入测试脚本。
- Research Workflow Architecture 已完成：Workflow Definition、Research Manager、Harness Runtime 边界和 Research Report 聚合视图。
- 已明确 ResearchHub 不重建 Harness Workflow Engine、Agent Runtime 或 Plugin Runtime。
- 已明确 Workflow 独立于 Skill，Skill 只描述研究方法，Plugin 只负责 Harness 扩展注册。
- Workflow Definition、Workflow Registry 和 `event-analysis` 定义已实现。
- Research Manager Coordinator 与 Harness Research Manager Service 已实现。
- `run_research_workflow` Harness Tool 已注册并绑定 Agent Session。
- Event Analysis 已支持 Market、Announcement、Media、Financial Capability 链路。
- Research Report View 已实现为 Evidence、Thesis、Prediction ID 聚合对象。
- Harness Agent、Skill、Capability、Artifact、Report、Session 持久化端到端测试已通过。

## 开发中模块

- Tushare 账号权限与真实环境连通性验证。
- AkShare-compatible bridge 的部署、运维和数据质量验证。
- Provider 健康检查、限流、凭证和数据新鲜度策略设计。

## 待开发模块

- 经授权的真实 News、Financial、Institution Provider。
- Information Provider 的真实新闻、公告和政策数据源。
- Provider 质量监控、重试和故障切换。
- Memory 检索与索引演进。
- Review 调度与真实 Outcome 来源。
- Financial、Institution 等后续 Capability。
- 真实财务数据账号授权、bridge 部署与生产质量验收。
- Research Workflow 生产调度、重试和多 Workflow 扩展。

## 当前阻塞问题

- 无已知工程阻塞。
- 真实 Provider 的生产启用仍受账号授权、数据许可、字段语义、限流、bridge 可用性和数据质量评估约束。

## 最近一次更新时间

2026-08-24

## 最近一次 commit

`docs: record research workflow governance commit`（`1e9c092`）

## 架构基线

- [ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Financial Data Provider Design](../architecture/FINANCIAL_PROVIDER_DESIGN.md)
- [Market Provider Design](../architecture/MARKET_PROVIDER_DESIGN.md)
- [Information Provider Design](../architecture/INFORMATION_PROVIDER_DESIGN.md)
- [Announcement Provider Design](../architecture/ANNOUNCEMENT_PROVIDER_DESIGN.md)
- [Professional Media Provider Design](../architecture/MEDIA_PROVIDER_DESIGN.md)
- [Financial Intelligence Data Design](../architecture/FINANCIAL_DATA_DESIGN.md)
- [Financial Statement Provider Design](../architecture/FINANCIAL_PROVIDER_DESIGN.md)
- [Research Workflow Design](../architecture/RESEARCH_WORKFLOW_DESIGN.md)
- [Research Workflow Implementation](../architecture/RESEARCH_WORKFLOW_IMPLEMENTATION.md)

## RH-ENG-009 Status Synchronization

**Current Stage:** Phase 14 — Research Workflow Framework MVP

**Completed:**

- Validated Workflow Definition and Workflow Registry.
- Research Manager request validation, Workflow selection, execution context, and Artifact relationship checks.
- Harness-facing Research Manager service and `run_research_workflow` tool.
- Event Analysis workflow using Market, Announcement, Media, and Financial Capability ports.
- Research Report View aggregation over Evidence, Thesis, and Prediction IDs.
- Harness Agent/Session persistence end-to-end fixture without network dependency.

**In Progress / Next:**

- Add more approved Workflow Definitions.
- Define production scheduling, cancellation, retry, and observability policy.
- Evaluate Report indexing through existing Memory boundaries.

**Blockers:**

- No engineering blocker. Production scheduling and real data source readiness remain future work.

**Last Updated:** 2026-08-24

**Feature Commit:** `c809b19bb59ecc901536d840950440bcf810cb4e`

## RH-DESIGN-008 Status Synchronization

**Current Stage:** Phase 13 — Research Workflow Architecture Design

**Completed:**

- Declarative Research Workflow model with steps, inputs, outputs, dependencies, and version.
- Research Manager Agent responsibilities and non-responsibilities.
- Harness Workflow Runtime / Agent Loop reuse boundary.
- Research Report aggregate view over Evidence, Thesis, and Prediction IDs.
- Artifact, Memory, Evaluation, Skill, Capability, and Plugin compatibility constraints.

**In Progress / Next:**

- RH-ENG-009 Research Workflow Framework MVP.
- Approved workflow definition registry and Harness-facing coordinator.

**Blockers:**

- No architecture blocker. Engineering implementation is intentionally deferred to RH-ENG-009.

**Last Updated:** 2026-08-24

**Design Commit:** `77f0728ade15a1d38ee4050499da98241bcf7595`

## RH-ENG-008 Status Synchronization

**Current Stage:** Phase 12 — Financial Statement Provider MVP

**Completed:**

- Tushare and AkShare Financial Provider adapters with common normalized output.
- Financial Provider Registry composition with configurable primary/fallback selection.
- Financial Capability `get_financial_snapshot(symbol)`.
- Financial Data to Evidence Artifact adapter with source metadata and session linkage.
- Network-free provider, capability, artifact, and integration tests.

**In Progress / Next:**

- Tushare account authorization and live endpoint verification.
- AkShare-compatible bridge deployment and production data-quality verification.
- Additional financial metrics and period-selection policy after source validation.

**Blockers:**

- No engineering blocker. Real source activation remains environment- and authorization-dependent.

**Last Updated:** 2026-08-24

**Feature Commit:** `05b216b0022618c55ae2fcddfe081f36f472a742`

## RH-DESIGN-007 Status Synchronization

**Current Stage:** Phase 11 — Financial Intelligence Data Layer Design

**Completed:**

- `FinancialStatement` and `FinancialMetric` historical fact models.
- Financial Provider interface compatible with the existing Provider Framework.
- Financial Capability → Evidence Artifact boundary.
- Compatibility with existing Thesis, Prediction, Evaluation, and Memory flows.
- Explicit exclusion of real APIs, forecasts, valuation strategies, and direct Memory schema changes.

**In Progress / Next:**

- Financial Capability implementation with fixture data.
- Financial Evidence Adapter implementation.
- Later selection and authorization of real financial data sources.

**Blockers:**

- No code blocker. Real financial source selection is intentionally deferred.

**Last Updated:** 2026-08-24

**Latest Commit:** `docs: design financial intelligence architecture` (`7cf3187961bec7bf0cfadd0dd74a745366fae864`)

## RH-ENG-007 Status Synchronization

**Current Stage:** Phase 10 — Professional Media Provider MVP

**Completed:**

- Shared Information Layer `NewsItem` and media source metadata types.
- `MediaProvider` with `sourceType: media` output.
- `publisher`, `tier`, and confidence validation.
- Fixture-based `ProfessionalMediaSourceAdapter`.
- Registry registration as `media-provider` and unchanged News Capability compatibility projection.
- Provider and Event Analysis integration tests.

**In Progress / Next:**

- Select and authorize a production professional-media source.
- Add freshness, licensing, and source-quality monitoring.
- Continue Information Layer source expansion.

**Blockers:**

- No code blocker. No named media API is bound in this MVP.

**Last Updated:** 2026-08-24

**Latest Commit:** `feat: add professional media provider` (`6b162241c4e55492bf3b6a2b53d5aa1316cbcd34`)

## RH-ENG-006 Status Synchronization

**Current Stage:** Phase 9 — Announcement Provider MVP

**Completed:**

- `AnnouncementProvider` with canonical `NewsItem` output.
- CNINFO official-source adapter with injectable native transport.
- Explicit security-code and issuer-to-symbol mapping.
- Registry registration as `announcement-provider` and compatibility projection for the unchanged News Capability.
- Provider, source adapter, News Capability, and Event Analysis integration tests.

**In Progress / Next:**

- Live official-source availability, rate-limit, and document-content validation.
- Additional official exchange adapters and licensed information sources.
- Information deduplication and freshness policy.

**Blockers:**

- No code blocker. Direct external-source availability is intentionally excluded from the default test suite.

**Last Updated:** 2026-08-24

**Latest Commit:** `feat: add announcement provider` (`e0e8e5b3d3320be2624c5583d2e590f8b63714ad`)
