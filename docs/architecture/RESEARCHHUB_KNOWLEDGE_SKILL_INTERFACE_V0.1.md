# RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1

## Status

Architecture Freeze

## Purpose

Knowledge Skill 是 Knowledge Asset 的确定性访问接口，为 Workflow 提供稳定查询能力。

Knowledge Skill：

- 不调用 LLM
- 不承担推理
- 不负责知识更新
- 不提供投资建议

## Architecture

```text
Workflow
   ↓
Knowledge Access Skill
   ↓
Knowledge Loader
   ↓
knowledge/
```

## Read API v0.1

### getEntity

```text
getEntity(entityId)
```

### searchEntities

```text
searchEntities(query, type?)
```

### getRelations

```text
getRelations(entityId, relationType?)
```

### getSupplyChain

```text
getSupplyChain(entityId, depth?)
```

### getRelatedCompanies

```text
getRelatedCompanies(entityId, filters?)
```

### getIntelligence

```text
getIntelligence(entityId, type?)
```

Intelligence types：

```text
fact
forecast
viewpoint
trend
risk
```

### getModules

```text
getModules(entityId)
```

### getComparison

```text
getComparison(entityId, comparisonType?)
```

### getSources

```text
getSources(knowledgeItemId)
```

## Explicit Non Goals

不支持：

```text
generateAnalysis
predict
recommend
updateKnowledge
```

v0.1 只提供 Read API。
