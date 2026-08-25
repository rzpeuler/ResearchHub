# RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1


## Document Information

| Field | Value |
|---|---|
| Document | Knowledge Skill Interface |
| Version | v0.1 |
| Status | Architecture Freeze |
| Scope | Knowledge Access Layer |
| Date | 2026-08-25 |


---

# 1. Overview

Knowledge Skill 是 ResearchHub Knowledge Layer 的访问接口层。

目标：

为 Workflow、DSH 和其他 Skill 提供稳定、确定性的 Knowledge 查询能力。


Knowledge Skill 不负责：

- 推理
- 分析
- 投资判断
- 知识更新


---

# 2. Architecture Position


User
↓
DSH
↓
Workflow
↓
Knowledge Skill
↓
knowledge/


Knowledge Skill 位于：

Workflow 与 Knowledge Asset 之间。


---

# 3. Design Principles


## 3.1 Deterministic Access

Knowledge Skill 返回结构化知识。

同样输入：

应该返回一致结果。


---

## 3.2 No LLM Dependency

Knowledge Skill 本身不调用 LLM。


原因：

- 保证确定性
- 可测试
- 可复用


LLM 执行仍由 Harness Runtime 提供，Workflow 只负责编排相关研究或
Knowledge 更新步骤。Knowledge Skill 本身不调用 LLM。


---

## 3.3 No Business Decision


Knowledge Skill 不输出：

- 股票推荐
- 买卖建议
- 投资评级
- 价格预测


---

# 4. Relationship With Other Components


## DSH

负责：

- 调度


---

## Workflow

负责：

- 理解研究任务
- 组织调用
- 生成研究结果


---

## Skill

负责：

- 提供业务能力


---

## Plugin

负责：

- 外部系统连接
- 数据获取


---

## Knowledge Skill

负责：

- 查询 Knowledge Asset


---

# 5. Read API v0.1


## 5.1 getEntity


Purpose:

获取实体详情。


Interface:

```typescript
getEntity(
 entityId:string
):EntityDetail

Example:
{
"entityId":
"industry:ai-hardware"
}

Return:
{
"id":
"industry:ai-hardware",

"type":
"industry",

"name":
"AI Hardware"
}
```

5.2 searchEntities
Purpose:
实体搜索。
Interface:
searchEntities(

query:string,

type?:EntityType

)

Return:
[
{
id,
name,
type,
relevance
}
]

5.3 getRelations
Purpose:
查询实体关系。
Interface:
getRelations(

entityId,

relationType?

)

Return:
[
{
targetEntity,

relationType,

confidence

}
]

5.4 getSupplyChain
Purpose:
产业链展开。
Interface:
getSupplyChain(

entityId,

depth

)

Example:
AI Server

↓

GPU

HBM

PCB

Cooling

5.5 getRelatedCompanies
Purpose:
获取产业相关公司。
Interface:
getRelatedCompanies(

entityId,

filters?

)

Return:
Company

+

industry position

+

business exposure

5.6 getIntelligence
Purpose:
获取结构化产业认知。
Interface:
getIntelligence(

entityId,

type?

)

Type:
fact

forecast

viewpoint

trend

risk

5.7 getModules
Purpose:
查询实体支持的知识模块。
Interface:
getModules(

entityId

)

Example:
GPU:
technology-roadmap

product-comparison

market-forecast

5.8 getComparison
Purpose:
获取动态比较表。
Interface:
getComparison(

entityId,

comparisonType

)

支持：
产品比较
公司比较
Schema:
动态 Column。
5.9 getSources
Purpose:
获取知识来源。
Interface:
getSources(

knowledgeItemId

)

Return:
source

publisher

date

quality

6. Explicit Non-Goals
v0.1 不支持：
generateAnalysis()

predict()

recommend()

updateKnowledge()

validateKnowledge()

7. Write Operation Policy
Knowledge Skill v0.1:
只提供 Read（read-only）。
原因：
Knowledge 写入涉及：
生命周期
冲突判断
LLM评估
人工确认
由独立 Workflow 负责。
8. Future Extension
未来可能增加：
Knowledge Management Skill
负责：
create

update

merge

expire

archive

但不属于 v0.1。
9. Implementation Strategy
第一阶段参考实现方向：
Knowledge Skill

↓

JSON Adapter

↓

knowledge/

本方向不引入：
Graph Database
Vector Database
RAG
10. Migration From Prototype
Current:
tests/knowledge
Migration:
industry-graph.ts / industry-graph.json

↓

Knowledge Skill Adapter


prototype assets

↓

knowledge assets

Architecture Freeze Decision
Accepted:
Knowledge Skill

=
Deterministic Knowledge Access Interface

Rejected:
Knowledge Skill as LLM Agent

Knowledge Skill as Data Plugin

Knowledge Skill responsible for reasoning

Knowledge Skill responsible for updating knowledge
