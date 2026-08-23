# Current Status

> ResearchHub 高频工程状态入口。阶段、模块、阻塞、任务和交付发生变化时必须同步更新。

## 当前版本

`v0.4.0` — Research Artifact Framework foundation

## 当前阶段

**Phase 4 — Research Artifact Foundation**

ResearchHub 已完成 Harness Integration Validation、Financial Capability Foundation 和 Market Capability MVP。当前建立可序列化、可验证、可关联 Session 的 Evidence、Thesis、Prediction 结构化研究资产模型，为后续 Event Analysis 和 Research Memory 提供基础合同。

## 已完成模块

- 项目治理文档体系 `docs/project-management/`
- Architecture 文档体系 `docs/architecture/`
- DeepSeek Harness `0.1.1-rc.2` integration validation
- 通用 `CapabilityDefinition` 与 `CapabilityProvider` 接口
- `MarketCapability` 与 `get_market_snapshot` Harness Tool
- `MockMarketProvider`
- Capability/Provider 边界测试和 Harness Session 集成测试
- Artifact Core：`ArtifactBase`、JSON-safe 类型、运行时校验、序列化
- `Evidence`、`Thesis`、`Prediction` Artifact 类型
- Session、Evidence、Thesis、Prediction ID 关系验证

## 开发中模块

- Event Analysis Skill 尚未实现
- Research Memory Adapter 尚未实现
- Review Artifact 尚未实现
- 真实 Market Provider 尚未接入

## 待开发模块

- Event Analysis MVP
- Research Artifact Review 生命周期
- Memory 持久化与检索适配器
- Prediction 结果 Evaluation
- News、Financial、Institution 等后续 Capability

## 当前阻塞问题

- 无已知工程阻塞。
- 真实数据源选择、授权、限流、数据质量和引用完整性属于后续任务风险。

## 架构基线

- 产品定位：AI A股个人投资研究员
- Runtime：DeepSeek Harness `0.1.1-rc.2`
- 架构模式：Harness Extension + Financial Intelligence Layer
- 核心设计：Agent + Skill + Capability + Workflow + Memory
- 研究资产：Evidence + Thesis + Prediction + Review（Review 预留）
- 权威架构文档：[ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- 工程设计文档：[ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- Harness 集成文档：[HARNESS_INTEGRATION.md](../architecture/HARNESS_INTEGRATION.md)
- Capability 设计文档：[CAPABILITY_DESIGN.md](../architecture/CAPABILITY_DESIGN.md)
- Artifact 设计文档：[RESEARCH_ARTIFACT_DESIGN.md](../architecture/RESEARCH_ARTIFACT_DESIGN.md)

## 最近一次更新时间

2026-08-23

## 最近一次 commit

`feat: add research artifact framework`（最终 hash 以 Git 提交结果为准）
