# Current Status

> ResearchHub 高频工程状态入口。阶段、模块、阻塞、任务和交付发生变化时必须同步更新。

## 当前版本

`v0.6.0` — Research Memory Framework MVP

## 当前阶段

**Phase 5 — Research Memory Foundation**

ResearchHub 已完成 Harness Integration Validation、Financial Capability Foundation、Market Capability、Research Artifact Framework、Event Analysis Skill MVP，以及 Artifact → Memory 的本地持久化验证。当前闭环为 Skill → Capability → Artifact → Memory → Session。

## 已完成模块

- 项目治理文档体系 `docs/project-management/`
- Architecture 文档体系 `docs/architecture/`
- DeepSeek Harness `0.1.1-rc.2` integration validation
- 通用 `CapabilityDefinition` 与 `CapabilityProvider` 接口
- `MarketCapability` 与 `get_market_snapshot` Harness Tool
- `NewsCapability` 与 `search_company_news` Harness Tool
- `MockMarketProvider`、`MockNewsProvider`
- Capability/Provider 边界测试和 Harness Session 集成测试
- Artifact Core：`ArtifactBase`、JSON-safe 类型、运行时校验、序列化
- `Evidence`、`Thesis`、`Prediction` Artifact 类型
- Event Analysis `SKILL.md`
- `EventAnalysisWorkflow` 与 `run_event_analysis` Harness Tool
- Event Analysis Harness 端到端测试：Skill loading、Capability calling、Artifact creation、Session persistence
- Memory Core：`MemoryEntry`、`MemoryProvider`、运行时校验和 JSON 序列化
- `LocalJsonMemoryProvider`：本地 JSON 持久化、精确检索、更新、原子替换和同进程并发队列
- `ArtifactMemoryAdapter`：Thesis/Prediction 到 Memory Entry 的确定性映射
- Research Memory Framework 测试：保存、检索、更新、重载、Session 元数据和错误边界

## 开发中模块

- Research Artifact Review 生命周期尚未实现
- Research Memory Review/Evaluation 集成尚未实现
- Prediction Evaluation 尚未实现
- 真实 Market/News Provider 尚未接入

## 待开发模块

- Review Artifact
- Memory 检索与索引演进
- Prediction → Outcome → Evaluation → Memory Update 复盘闭环
- News、Financial、Institution 等后续真实 Capability

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
- Event Analysis 设计文档：[EVENT_ANALYSIS_SKILL_DESIGN.md](../architecture/EVENT_ANALYSIS_SKILL_DESIGN.md)
- Research Memory 设计文档：[RESEARCH_MEMORY_DESIGN.md](../architecture/RESEARCH_MEMORY_DESIGN.md)

## 最近一次更新时间

2026-08-23

## 最近一次 commit

`feat: add research memory foundation`（最终 hash 以 Git 提交结果为准）
