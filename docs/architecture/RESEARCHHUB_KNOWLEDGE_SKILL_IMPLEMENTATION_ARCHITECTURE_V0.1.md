# RESEARCHHUB_KNOWLEDGE_SKILL_IMPLEMENTATION_ARCHITECTURE_V0.1

## Status

Engineering Architecture Design

## Purpose

定义 Knowledge Access Skill 第一阶段工程实现边界。

## Position

Knowledge Access Skill 属于现有 `skills/` 层，不新增系统架构层。

## Internal Model

```text
Loader
  ↓
Index
  ↓
Query
  ↓
Skill API
```

## Suggested Internal Structure

具体路径需要遵循仓库现有 Skill 组织规范；逻辑结构建议：

```text
knowledge-access/

├── skill entry
├── loader/
├── index/
├── queries/
└── types/
```

## Loader

负责 Asset → Runtime Object。

## Index

负责内存索引。

## Query

负责确定性知识查询。

## Skill API

v0.1：

```text
getEntity
searchEntities
getRelations
getSupplyChain
getRelatedCompanies
getIntelligence
getModules
getComparison
getSources
```

## Error Categories

建议统一 Knowledge Error：

```text
NotFound
InvalidReference
SchemaError
```

## Testing

- Loader unit tests
- Index tests
- API tests
- Fixture-based tests

## Boundary

不实现：

- LLM query agent
- 自动知识生成
- Knowledge update
- 投资推荐
- RAG
