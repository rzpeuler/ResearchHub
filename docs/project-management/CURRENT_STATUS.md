# Current Status

> ResearchHub 的高频工程状态入口。阶段、模块、阻塞、任务和交付发生变化时必须同步更新。

## 当前版本

`v0.3.0` — Financial Capability foundation

## 当前阶段

**Phase 3 — Financial Capability Development**

ResearchHub 已完成 Harness 集成验证，并建立可扩展的 Financial Capability/Provider 分层，完成 Market Capability MVP。当前实现只使用确定性 Mock Provider，不接入真实金融数据源。

## 已完成模块

- 项目治理文档体系 `docs/project-management/`
- Architecture 文档目录 `docs/architecture/`
- DeepSeek Harness `0.1.1-rc.2` integration validation
- 通用 `CapabilityDefinition` 与 `CapabilityProvider` 接口
- `MarketCapability` 与 `get_market_snapshot` Harness Tool
- `MockMarketProvider`
- Capability/Provider 边界测试
- Agent → Market Tool → Capability → Mock Provider → Session 集成测试

## 开发中模块

- 暂无真实金融数据 Provider
- 暂无 News、Financial、Institution Capability
- 当前 Market 数据仅为验证用途，不属于生产行情服务

## 下一阶段

- Phase 4 — Event Analysis MVP
- 设计真实 Market Provider 接入边界
- 建立 Evidence、Timestamp 和 Source Metadata 约束

## 当前阻塞问题

- 无已知工程阻塞
- 真实数据源选型、授权、限流和数据质量验证属于后续任务风险

## 架构基线

- 产品定位：AI A 股个人投资研究员
- Runtime：DeepSeek Harness `0.1.1-rc.2`
- 架构模式：Harness Extension + Financial Intelligence Layer
- 核心设计：Agent + Skill + Capability + Workflow + Memory
- 权威架构文档：[ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- 工程设计文档：[ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- Harness 集成文档：[HARNESS_INTEGRATION.md](../architecture/HARNESS_INTEGRATION.md)
- Capability 设计文档：[CAPABILITY_DESIGN.md](../architecture/CAPABILITY_DESIGN.md)

## 最近一次更新时间

2026-08-23

## 最近一次 commit

`feat: add financial capability foundation`（最终 hash 以 Git HEAD 和验收报告为准）
