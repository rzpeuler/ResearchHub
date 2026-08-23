# Current Status

ResearchHub 的高频工程状态入口。每次完成可验收交付后，必须同步本文件、任务登记表和变更记录。

## 当前版本

`v0.8.0` — Financial Data Provider Framework MVP

## 当前阶段

**Phase 7 — Financial Data Provider Foundation**

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

## 开发中模块

- 真实金融数据 Provider 的接入前评估（尚未连接外部 API）。
- Provider 健康检查、限流、凭证和数据新鲜度策略设计。

## 待开发模块

- 经授权的真实 Market/News Provider。
- Provider 质量监控、重试和故障切换。
- Memory 检索与索引演进。
- Review 调度与真实 Outcome 来源。
- Financial、Institution 等后续 Capability。

## 当前阻塞问题

- 无已知工程阻塞。
- 真实数据源接入受授权、许可、字段语义、限流和数据质量评估约束，不能在本 MVP 中直接假设完成。

## 最近一次更新时间

2026-08-23

## 最近一次 commit

`feat: add financial provider framework`（当前处于提交前 Review）

## 架构基线

- [ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Financial Data Provider Design](../architecture/FINANCIAL_PROVIDER_DESIGN.md)
