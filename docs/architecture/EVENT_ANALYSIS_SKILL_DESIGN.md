# ResearchHub Event Analysis Skill Design

## Skill Positioning

Event Analysis Skill 是 ResearchHub Research Intelligence Layer 的第一个流程型 Skill。它负责组织一次针对股票代码的中性事件研究流程，并把 Capability 返回的数据转换为结构化 Research Artifact。

Skill 不负责：

- 访问 HTTP、新闻网站或数据库。
- 直接访问 Provider 或数据源。
- 计算交易信号或发出买卖建议。
- 执行交易。
- 持久化 Memory 或评价 Prediction。

Harness Skill 通过 `SKILL.md` 提供模型可加载的流程指令；确定性的 Workflow 负责执行 Capability 调用和 Artifact 生成。

## Architecture

```text
Agent
  ↓ Harness skill tool
event-analysis/SKILL.md
  ↓ run_event_analysis Tool
EventAnalysisWorkflow
  ├── MarketCapability
  ├── NewsCapability
  └── Artifact factories
        ↓
Evidence[] → Thesis → Prediction
        ↓
Harness Session / JSONL persistence
```

生产代码位于 `packages/skills/event-analysis/`。Harness integration composition 位于 `tests/integration/`，仅用于验证真实 Skill loading、Tool 调用和 Session persistence。

## Research Workflow

```text
Input Stock
    ↓
Market Evidence Collection
    ↓
News Evidence Collection
    ↓
Neutral Cause Analysis Organization
    ↓
Thesis Generation
    ↓
Prediction Generation
```

Workflow 的输入包含：

- `symbol`
- `sessionId`
- `createdAt`
- `evaluationPeriod.start/end`

Workflow 执行时：

1. 调用 `MarketCapability.get_market_snapshot()`。
2. 调用 `NewsCapability.search_company_news()`。
3. 将 Market Snapshot 转换为 Market Evidence。
4. 将 News DTO 转换为 News Evidence。
5. 创建 Thesis，并将所有 Evidence ID 写入 `evidenceIds`。
6. 创建 Prediction，并将 Thesis ID 写入 `thesisId`。

当前 Thesis 和 Prediction 使用中性验证语句，只确认研究资产链路形成，不表达方向性投资判断。

## Capability Dependencies

### Market Capability

已有 `get_market_snapshot(symbol)`，通过 Capability/Provider 边界返回结构化市场快照。Event Analysis Skill 只依赖 Capability 接口，不知道 Mock 或未来真实 Provider 的实现。

### News Capability

新增 `search_company_news(symbol)`：

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

当前由 `MockNewsProvider` 提供确定性内存 fixture，不访问网络，不代表生产新闻数据服务。

## Artifact Output

一次成功执行返回：

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

所有 Artifact 共享当前 Harness Session ID：

```text
Session
  ↓ sessionId
Evidence[]
  ↓ evidenceIds
Thesis
  ↓ thesisId
Prediction
```

Artifact ID 由调用方提供的确定性 ID Factory 生成。Workflow 不引入新的身份或持久化机制。

## Harness Validation

Integration test 使用 DeepSeek Harness `0.1.1-rc.2` 和确定性 Mock LLM：

1. Skill Filesystem 加载 `packages/skills/event-analysis/SKILL.md`。
2. Agent 调用 Harness `skill` Tool。
3. Agent 调用 `run_event_analysis` Workflow Tool。
4. Workflow 调用 Market/News Capability 并返回 Artifact Bundle。
5. Tool Result 写入 Session event log。
6. `ctx.sessions.flush()` 将事件持久化为 JSONL。

Workflow 单元测试验证 Capability calling、Artifact creation、Session ID 和关系字段；Harness integration test 验证 Skill loading、Tool execution、Artifact Result 和 Session persistence。

## Scope Boundary

本阶段明确不包含：

- 真实新闻或行情数据源。
- HTTP、爬虫或商业数据依赖。
- 投资建议、交易逻辑或方向性预测。
- Review Artifact、Memory Adapter 和 Prediction Evaluation。

后续任务必须保持 Skill → Capability → Provider → Data Source 的边界，并以 Architecture v0.2 为约束。
