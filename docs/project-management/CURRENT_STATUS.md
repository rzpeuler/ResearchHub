# Current Status

ResearchHub 的高频工程状态入口。每次完成可验收交付后，必须同步本文件、任务登记表和变更记录。

## 当前版本

`v1.1.0` — Announcement Provider MVP

## 当前阶段

**Phase 9 — Announcement Provider MVP**

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

## 当前阻塞问题

- 无已知工程阻塞。
- 真实 Provider 的生产启用仍受账号授权、数据许可、字段语义、限流、bridge 可用性和数据质量评估约束。

## 最近一次更新时间

2026-08-23

## 最近一次 commit

`docs: design information provider architecture`（`7f7fb65db70827d02aaa40e8786ca18b9000faa1`）

## 架构基线

- [ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Financial Data Provider Design](../architecture/FINANCIAL_PROVIDER_DESIGN.md)
- [Market Provider Design](../architecture/MARKET_PROVIDER_DESIGN.md)
- [Information Provider Design](../architecture/INFORMATION_PROVIDER_DESIGN.md)
- [Announcement Provider Design](../architecture/ANNOUNCEMENT_PROVIDER_DESIGN.md)

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

**Latest Commit:** `feat: add announcement provider` (`efa053c036d0d7c13e82ff5d73ea5aac07c4cb4e`)
