# RH-ENG-003A Event Analysis Skill Framework Design

## Status

Approved for implementation.

## Objective

建立 ResearchHub 第一个 Research Intelligence Layer Skill，通过已存在的 Market Capability、Mock News Capability 和 Research Artifact Framework，验证最小投资研究闭环：

```text
Skill
  ↓
Capability
  ↓
Research Artifact
  ↓
Harness Session
```

本任务只实现事件分析流程骨架和确定性验证数据，不接入真实新闻、真实行情、交易或投资决策系统。

## Scope and Boundaries

In scope:

- `packages/skills/event-analysis/SKILL.md`。
- 类型化 `EventAnalysisWorkflow`。
- `search_company_news(symbol)` News Capability。
- 确定性的 Mock News Provider。
- Market/News Capability 结果到 Evidence、Thesis、Prediction 的转换。
- Harness-facing Workflow Tool 和 Skill loading integration test。
- Event Analysis 架构文档和治理状态同步。

Out of scope:

- 真实新闻源、HTTP 请求、爬虫或商业数据服务。
- 真实行情 Provider。
- 自动交易或交易指令。
- 投资建议、买卖判断或收益预测逻辑。
- Event Analysis 的 Review、Evaluation 或 Memory 持久化实现。
- DeepSeek Harness Core 或 Architecture v0.2 修改。

## Selected Architecture

采用“Skill 指令 + 类型化 Workflow 编排”方案：

```text
Agent
  ↓ Harness skill tool
Event Analysis SKILL.md
  ↓ run_event_analysis Harness Tool
EventAnalysisWorkflow
  ├── MarketCapability
  ├── NewsCapability
  └── Artifact factories
        ↓
Evidence[] → Thesis → Prediction
        ↓
Harness Session
```

Skill 负责声明研究流程和输出要求。Workflow 负责以显式依赖调用 Capability，并将结构化结果转换为 Artifact。Workflow 不访问 HTTP、数据库或 Provider；数据访问仍由 Capability/Provider 边界负责。

模型驱动的 Harness Tool loop 不是 Artifact 生成的唯一可靠性来源：Workflow 会在 Capability 返回后确定性创建 Artifact，因此测试不依赖模型自由生成 JSON。

## Skill Definition

`SKILL.md` 必须包含：

- Purpose：对指定股票组织市场事件研究流程。
- Required capabilities：`get_market_snapshot`、`search_company_news`。
- Execution steps：收集市场证据、收集新闻证据、组织原因分析、生成 Thesis、生成 Prediction。
- Output format：返回结构化 Evidence、Thesis、Prediction 摘要，不输出交易指令。

Skill 文件是 Harness 可加载的模型指令，不包含 HTTP、行情计算、新闻抓取或投资判断代码。

## News Capability

News Capability 定义：

```text
search_company_news(symbol)
```

输入为股票代码，输出为结构化新闻记录集合：

```ts
type NewsEvidence = {
  symbol: string
  headline: string
  content: string
  source: string
  timestamp: string
  confidence: number
}

type NewsSearchResult = {
  symbol: string
  items: NewsEvidence[]
}
```

Capability 负责输入规范化和 Provider 委托。Mock Provider 只返回固定内存 fixture，不连接外部数据源。News Capability 返回领域 DTO，Artifact 创建仍由 EventAnalysisWorkflow 负责。

## EventAnalysisWorkflow Contract

Workflow 接收：

```ts
type EventAnalysisInput = {
  symbol: string
  sessionId: string
  createdAt: string
  evaluationPeriod: {
    start: string
    end: string
  }
}
```

Workflow 构造时注入：

- `MarketCapability`
- `NewsCapability`
- Artifact ID factory

ID factory 由调用方提供，以保持测试确定性并遵循 Artifact Framework 的调用方身份策略。

Workflow 执行步骤：

1. 调用 Market Capability 获取 Market Snapshot。
2. 调用 News Capability 获取 News Evidence DTO。
3. 将 Market Snapshot 转换为一个 Evidence Artifact。
4. 将每条 News Evidence DTO 转换为 Evidence Artifact。
5. 创建 Thesis，`evidenceIds` 指向本次所有 Evidence。
6. 创建 Prediction，`thesisId` 指向本次 Thesis。
7. 返回结构化 Artifact Bundle。

当前 Thesis 和 Prediction 使用中性验证语句，只证明研究资产链路已形成，不表达买卖意见、价格目标或投资结论。

## Artifact Output

Workflow 返回：

```ts
type EventAnalysisResult = {
  status: 'success'
  symbol: string
  artifacts: {
    evidence: Evidence[]
    thesis: Thesis
    prediction: Prediction
  }
}
```

所有 Artifact 共享输入中的 `sessionId`。Evidence 的 `source` 分别标识 `market-capability` 或 Mock News Provider，Thesis 引用 Evidence IDs，Prediction 引用 Thesis ID。

## Harness Integration

Integration extension 将：

1. 通过 Harness Skill Filesystem 加载 `event-analysis`。
2. 注册 Mock Market Capability 和 Mock News Capability 的 Workflow 依赖。
3. 注册 `run_event_analysis` Harness Tool。
4. 使用确定性 Mock LLM 触发 `skill`，随后触发 `run_event_analysis`。
5. 将 Workflow 返回的 Artifact Bundle 写入 Tool Result，从而进入 Harness Session event log。

Workflow 的 Capability 调用和 Artifact 创建通过 Workflow 单元测试验证；Agent、Skill loading、Tool Result 和 Session 持久化通过 Harness integration test 验证。

## Validation Plan

必须验证：

- TypeScript strict typecheck。
- Mock News Capability 输入规范化和 Provider 解耦。
- Workflow 调用 Market/News Capability。
- Evidence、Thesis、Prediction 创建和 ID 关系。
- Skill 可被 Harness 加载。
- Agent 可触发 Workflow Tool。
- Tool Result 包含 Artifact Bundle。
- Session JSONL 持久化包含 Skill、Workflow 和 Artifact 内容。
- 无网络、真实数据、交易或 Harness Core 变更。

## Acceptance Criteria

- `packages/skills/event-analysis/SKILL.md` 存在且不是空模板。
- `packages/capabilities/news/` 提供 `search_company_news(symbol)`。
- EventAnalysisWorkflow 不直接访问 Provider、HTTP 或数据库。
- 每次成功执行都产生 Evidence、Thesis、Prediction 对象。
- 测试覆盖 Skill loading、Capability calling、Artifact creation 和 Session persistence。
- `docs/architecture/EVENT_ANALYSIS_SKILL_DESIGN.md` 与实现一致。
