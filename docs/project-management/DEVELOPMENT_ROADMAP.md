# Development Roadmap

本路线图描述已确认的工程阶段；实际完成情况以 [TASK_REGISTRY.md](TASK_REGISTRY.md) 和 [CURRENT_STATUS.md](CURRENT_STATUS.md) 为准。

## Phase 0 — Governance Bootstrap

目标：建立项目治理、任务、决策、架构和 Agent 执行文档。

状态：Completed。

## Phase 1 — Architecture Design

目标：完成 ResearchHub 定位、DeepSeek Harness 分析、Harness Extension + Financial Intelligence Layer 架构，以及 Agent、Skill、Capability、Workflow、Memory 模型定义。

里程碑：Architecture v0.2、Technical Design v0.1、架构基线冻结。

状态：Completed。

## Phase 2 — Harness Integration Validation

目标：验证 Runtime、Extension、Agent、Skill、Capability 和 Session 的最小闭环，不 fork Harness Core。

状态：Completed。

## Phase 3 — Financial Capability Layer

目标：建立 Capability 与数据来源解耦的金融能力基础。

里程碑：Market Capability MVP、Mock Market/News Capability。

状态：Completed（业务能力仍使用 Mock 数据）。

## Phase 4 — Research Artifact and Event Analysis MVP

目标：完成数据获取、Evidence、Thesis、Prediction、Event Analysis 和 Session 关联。

状态：Completed。

## Phase 5 — Research Memory Foundation

目标：将结构化 Research Artifact 沉淀到本地 Memory，并支持检索和更新。

状态：Completed。

## Phase 6 — Research Evaluation and Review Foundation

目标：建立 Prediction → Outcome → Evaluation → Review → Memory 的客观复盘闭环。

状态：Completed。

## Phase 7 — Financial Data Provider Foundation

目标：建立可替换、可追溯的金融数据 Provider 标准，使 Capability 不直接依赖外部数据源。

关键里程碑：

- `DataProvider` 与 `FinancialDataMetadata` 契约。
- `ProviderRegistry` 与类型化 Provider Handle。
- Mock Market/News Provider 通过 Registry 接入 Capability。
- Capability 输出保留 source、timestamp、quality、confidence。

状态：Completed（本任务完成 Tushare/AkShare Market Provider MVP 和 primary/fallback composition；其他真实金融数据源仍待后续接入）。

## Phase 8 — Personal Investment Research Assistant

目标：在完成真实数据源治理、检索演进和复盘调度后，逐步扩展每日情报、持续监控、研究机会发现和自动化复盘。

状态：Planned。

## 技术演进约束

- 新数据源必须实现统一 Provider 契约并通过 Registry 注册。
- Capability 不得直接访问 HTTP、SDK、数据库或爬虫。
- 真实 Provider 接入必须先完成授权、字段语义、质量、错误处理和测试方案。
- 架构方向变化必须新增 ADR，并同步 CURRENT_STATUS、CHANGELOG 和本路线图。
