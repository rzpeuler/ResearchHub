# Development Roadmap

> 本路线图描述 ResearchHub 已确认的阶段性工程路径。未完成阶段是规划，不代表已有实现；具体任务以 TASK_REGISTRY.md 为准。

## Phase 0 — Governance Bootstrap

### 目标

建立项目级文档、任务、决策、架构和 Agent 执行规范。

### 状态

Completed。治理文档体系已在 `chore: initialize project execution state management system` 提交中建立。

## Phase 1 — Architecture Design

### 目标

完成 ResearchHub 产品定位、DeepSeek Harness 运行时分析、Harness Extension + Financial Intelligence Layer 架构设计，以及 Agent、Skill、Capability、Workflow、Memory 核心模型定义。

### 关键里程碑

- DeepSeek Harness architecture analysis
- ResearchHub Architecture v0.2
- ResearchHub Technical Design v0.1
- Architecture baseline freeze

### 状态

当前基线已完成，Architecture v0.2 是所有后续工程任务的约束。

## Phase 2 — Harness Integration Validation

### 目标

验证 ResearchHub 能够通过 DeepSeek Harness 原生扩展机制接入运行时，不 fork Harness Core，并确认工程骨架可承载 Agent、Skill、Capability、Session 和 Memory。

### 关键验证项

- Agent loading
- Skill loading
- Capability calling
- Session persistence
- Memory interface integration

### 下一阶段入口

- Phase 2 validation completed: Harness extension, Agent, Skill, Capability and Session path verified
- Phase 3 — Financial Capability Layer

## Phase 3 — Financial Capability Layer

### 目标

实现首批结构化金融能力，保持数据能力与推理能力分离，并为每个结果保留来源、时间戳和置信度元数据。

### 计划能力

- Market Capability
- News Capability
- Financial Capability
- Institution Capability
- Community Capability
- Knowledge Capability

## Phase 4 — Event Analysis MVP

### 目标

完成第一个完整用户价值闭环：数据采集 → 证据整理 → 异动分析 → 研究产物 → 记忆更新。

## Phase 5 — Company Research and Review System

### 目标

建设公司研究、研究历史、投资决策记录、Prediction → Outcome → Evaluation → Memory Update 复盘闭环。

## Phase 6 — Personal Investment Research Assistant

### 目标

逐步扩展到每日情报、持续监控、研究机会发现和自动化复盘，形成个人 AI 投资研究平台。

## 路线图维护规则

- 新阶段必须有目标、可验证里程碑和对应任务。
- 规划变化记录在 [DECISION_LOG.md](DECISION_LOG.md) 或任务登记表中。
- 架构方向变化必须新增 ADR、更新 Architecture 版本和 Technical Design。
- 已完成事实同步到 [CURRENT_STATUS.md](CURRENT_STATUS.md) 和 [CHANGELOG.md](CHANGELOG.md)。
