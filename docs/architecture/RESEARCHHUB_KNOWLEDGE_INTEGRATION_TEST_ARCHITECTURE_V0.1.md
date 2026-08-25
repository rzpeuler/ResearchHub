# RESEARCHHUB_KNOWLEDGE_INTEGRATION_TEST_ARCHITECTURE_V0.1

## Status

Engineering Acceptance Design

## Purpose

定义 Knowledge 第一阶段工程实现的最小完整集成测试闭环。

## Target Chain

```text
Knowledge Fixture
      ↓
Loader
      ↓
Validation
      ↓
Runtime Index
      ↓
Knowledge Access Skill
      ↓
Workflow Consumption
```

## Test Structure

```text
tests/knowledge/

├── fixtures/
├── validation/
├── loader/
├── skill/
└── integration/
```

## Test Layers

### Asset Test

验证 Fixture 文件布局和基础结构。

### Loader Test

验证：

- Entity Load
- Relation Load
- Intelligence Load
- Source Load
- Registry Load

### Validation Test

正例必须通过。

负例至少覆盖：

- missing entity reference
- invalid relation
- invalid lifecycle
- unknown module
- invalid ID

### Knowledge Access Skill Test

至少验证：

```text
getEntity
getRelations
getSupplyChain
getRelatedCompanies
getIntelligence
getModules
getComparison
getSources
```

### Workflow Integration Test

至少一个现有或最小测试 Workflow 能消费 Knowledge Skill 输出。

测试重点是调用闭环，不测试 LLM 投资观点质量。

## No External Dependency

默认 Knowledge 测试不得依赖：

- 网络
- Tushare
- AkShare
- 外部数据库

## Acceptance Criteria

第一阶段完成至少满足：

- Fixture 可以加载
- Runtime Index 正确建立
- Validation 正例通过
- Validation 负例可识别
- Read API 可用
- 至少一条 Workflow 消费链路通过
- 现有测试不回归

## Non Goals

不测试：

- 市场预测准确性
- 投资观点正确性
- LLM 输出质量
- 全量 A 股数据规模
