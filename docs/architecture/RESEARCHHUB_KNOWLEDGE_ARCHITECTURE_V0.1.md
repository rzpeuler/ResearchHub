# RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1

## Document Information

| Field | Value |
|---|---|
| Document | ResearchHub Knowledge Architecture |
| Version | v0.1 |
| Status | Architecture Freeze |
| Scope | Knowledge Layer |
| Date | 2026-08-25 |

## 1. Overview

Knowledge Layer 是 ResearchHub 的长期知识资产层。

它面向投资研究，保存可复用的结构化产业认知，包括：

- 行业结构
- 产业链关系
- 企业位置
- 技术路线
- 产品体系
- 行业事件
- 市场预测
- 行业观点
- 趋势与风险
- 数据来源

Knowledge 不仅保存静态事实，也允许保存带生命周期管理的研究型知识。

## 2. Architecture Position

Knowledge 是现有 ResearchHub 仓库中的顶层长期资产，不属于 `packages/`。

Knowledge 不绑定：

- DSH runtime
- 某个 Workflow
- 某个 Skill

访问关系：

```text
Workflow
   ↓
Knowledge Skill
   ↓
knowledge/
```

## 3. Design Principles

### 3.1 Structured Intelligence

Knowledge 可以保存三类内容：

1. Stable Knowledge
   - 长期稳定事实
2. Dynamic Knowledge
   - 市场规模预测、技术路线等
3. Analytical Knowledge
   - 核心多空观点、趋势、风险

### 3.2 Lifecycle Required for Dynamic Knowledge

Forecast、Viewpoint、Trend 等动态认知必须包含：

- source / provenance
- confidence
- lifecycle
- validFrom / validUntil（适用时）

### 3.3 Knowledge is not Investment Decision

Knowledge 不保存：

- 个股买卖建议
- 目标价
- 短期交易信号
- 某次具体研究任务的最终交易判断

## 4. Core Structure

```text
knowledge/

├── taxonomy/
├── entities/
├── relations/
├── intelligence/
├── modules/
├── sources/
├── views/
└── registry/
```

## 5. Taxonomy

支持多维分类体系，例如：

- 申万行业
- 中信行业
- 主题
- 技术
- 产业链

## 6. Entities

v0.1 Entity Types：

```text
industry
segment
company
product
technology
```

Entity 保存对象身份与稳定属性。

## 7. Relations

关系包括：

产业关系：
- contains
- upstream_of
- downstream_of
- depends_on
- substitute_for

企业关系：
- supplier_of
- customer_of
- partner_of
- competes_with

资本关系：
- owns_stake_in
- invested_in

Relation 支持：

- attributes
- confidence
- sourceRefs
- lifecycle

## 8. Intelligence

```text
intelligence/

├── facts/
├── forecasts/
├── viewpoints/
├── trends/
└── risks/
```

## 9. Modules

Module 解决不同行业知识结构与展示需求差异。

典型模块：

- comparison
- roadmap
- market
- competition
- capacity
- supply-chain

禁止为所有行业设计固定、相同的字段集合。

## 10. Sources

Source 记录 Knowledge 的 provenance。

## 11. Views

View 只定义如何展示知识，不保存核心知识本身。

## 12. Lifecycle

状态：

```text
active
expired
superseded
archived
```

更新采用逻辑覆盖，历史版本保留。

新旧知识冲突由 Knowledge Update Workflow 中的 LLM / 人工治理流程判断 keep / replace / merge。

生命周期到期由系统提示，人工触发后续 Knowledge Update Workflow。

Knowledge Update Workflow 本身不属于本版本设计范围。

## 13. Non Goals

v0.1 不建设：

- Graph Database
- Vector Database
- RAG
- 自动知识抽取
- 自动自更新知识引擎
- Research Artifact Layer
- Investment Scoring System
