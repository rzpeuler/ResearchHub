# ResearchHub

ResearchHub 是构建在 DeepSeek Harness 之上的 AI A 股个人投资研究员。目前项目处于 **Phase 11 — Financial Intelligence Data Layer Design**：已完成 Harness 集成验证、Capability、研究资产、Memory、Evaluation、Provider Framework、Market Provider、Announcement Provider 和 Professional Media Provider。

ResearchHub 不执行交易，也不 fork Harness Core。本阶段已完成真实 Market Provider 的适配与测试；生产启用仍需完成账号授权、bridge 运维和数据质量验收。

## 项目治理文档

新 Agent 开始工作前，请先阅读 [`docs/project-management/`](docs/project-management/)：

- [项目概览](docs/project-management/PROJECT_OVERVIEW.md)
- [当前状态](docs/project-management/CURRENT_STATUS.md)
- [开发路线图](docs/project-management/DEVELOPMENT_ROADMAP.md)
- [任务登记表](docs/project-management/TASK_REGISTRY.md)
- [技术决策记录](docs/project-management/DECISION_LOG.md)
- [架构说明](docs/project-management/ARCHITECTURE.md)
- [开发规范](docs/project-management/DEVELOPMENT_RULES.md)
- [变更记录](docs/project-management/CHANGELOG.md)
- [Agent 工作流](docs/project-management/AGENT_WORKFLOW.md)

## Architecture Documentation

- [ResearchHub Architecture v0.2](docs/architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](docs/architecture/TECHNICAL_DESIGN_V0.1.md)
- [Harness Integration Validation](docs/architecture/HARNESS_INTEGRATION.md)
- [Capability Design](docs/architecture/CAPABILITY_DESIGN.md)
- [Financial Data Provider Design](docs/architecture/FINANCIAL_PROVIDER_DESIGN.md)
- [Market Provider Design](docs/architecture/MARKET_PROVIDER_DESIGN.md)
- [Information Provider Design](docs/architecture/INFORMATION_PROVIDER_DESIGN.md)
- [Announcement Provider Design](docs/architecture/ANNOUNCEMENT_PROVIDER_DESIGN.md)
- [Professional Media Provider Design](docs/architecture/MEDIA_PROVIDER_DESIGN.md)
- [Financial Intelligence Data Design](docs/architecture/FINANCIAL_DATA_DESIGN.md)
- [Research Artifact Design](docs/architecture/RESEARCH_ARTIFACT_DESIGN.md)
- [Event Analysis Skill Design](docs/architecture/EVENT_ANALYSIS_SKILL_DESIGN.md)
- [Research Memory Design](docs/architecture/RESEARCH_MEMORY_DESIGN.md)
- [Research Evaluation Design](docs/architecture/RESEARCH_EVALUATION_DESIGN.md)

所有后续工程任务必须以 ResearchHub Architecture v0.2、Technical Design v0.1 和当前治理文档为约束。

## 当前阶段

**Phase 8 — Information Data Layer Design**

当前已完成 `Capability → ProviderRegistry → DataProvider` 的标准边界、Tushare/AkShare Market Provider MVP，以及新闻、公告、政策信息层的 Provider 架构设计。Information Layer 只定义数据模型、来源层级和验证边界，尚未接入真实信息源。

## 协作角色

- **Sol**：负责顶层设计、架构决策、任务拆解和最终验收。
- **Luna**：负责工程执行、代码修改、测试、Git 管理和状态同步。
