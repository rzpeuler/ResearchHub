# ResearchHub

ResearchHub 是一个刚启动的项目。目前仓库处于工程治理初始化阶段，尚未建立业务代码、运行时架构、数据结构或 API。

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

## 当前阶段

**Phase 1 — Architecture Design**

本阶段已完成 ResearchHub Architecture v0.2 和 Technical Design v0.1 的基线冻结。下一阶段进入 DeepSeek Harness 集成验证。

## Architecture Documentation

- [ResearchHub Architecture v0.2](docs/architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](docs/architecture/TECHNICAL_DESIGN_V0.1.md)

所有后续工程任务必须以 ResearchHub Architecture v0.2 和对应 Technical Design 为约束。

## 协作角色

- **Sol**：负责顶层设计、架构决策、任务拆解和最终验收。
- **Luna**：负责工程执行、代码修改、测试、Git 管理和状态同步。

具体执行规则以 [`DEVELOPMENT_RULES.md`](docs/project-management/DEVELOPMENT_RULES.md) 和 [`AGENT_WORKFLOW.md`](docs/project-management/AGENT_WORKFLOW.md) 为准。
