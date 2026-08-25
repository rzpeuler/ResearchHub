# RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1


## Document Information

| Field | Value |
|---|---|
| Document | ResearchHub Knowledge Storage Layout |
| Version | v0.1 |
| Status | Architecture Freeze |
| Scope | Knowledge Asset Storage |
| Date | 2026-08-25 |


---

# 1. Purpose

本文档定义 ResearchHub Knowledge Asset 的物理存储布局。

目标：

明确：

- Knowledge 数据如何组织
- 不同知识类型如何分离
- Knowledge Skill 如何加载资产
- 后续 Workflow 如何管理知识生命周期


本文档只定义：

Storage Layout。


不定义：

- Knowledge Schema 字段细节
- Knowledge Skill 实现
- Knowledge Update Workflow
- 数据库设计


---

# 2. Position in Repository


Knowledge 是 ResearchHub 的长期资产目录。


Knowledge Storage 属于：

knowledge/

目录。


Knowledge 不属于：

packages/

也不绑定：

- DSH runtime
- Workflow runtime
- Skill implementation


依赖关系：

Workflow
↓
Knowledge Skill
↓
knowledge assets


---

# 3. Design Principles


## 3.1 Modular Storage

禁止：

单一巨大知识文件。


例如：

industry-graph.json

适合作为 prototype。

不适合作为长期资产。


原因：

- 更新困难
- 生命周期管理困难
- Git diff 不清晰
- 多人维护困难


---

## 3.2 Separation of Concerns

不同知识类型独立存储：

taxonomy
entities
relations
intelligence
modules
sources
views

---

## 3.3 Human Maintainable

第一阶段：

Knowledge 使用：

- YAML
- Markdown
- JSON

作为资产格式。


优先考虑：

- 可读性
- Git管理
- Review能力


---

# 4. Directory Structure


冻结：

knowledge/
├── taxonomy/
├── entities/
├── relations/
├── intelligence/
├── modules/
├── sources/
├── views/
└── registry/


---

# 5. taxonomy/


## Purpose

存储分类体系。


用于：

定义不同观察世界的分类方式。


支持：

- A股行业分类
- 产业分类
- 技术分类
- 主题分类


结构：

taxonomy/
├── sw-industry/
├── citic-industry/
├── themes/
├── technologies/
└── industry-chain/


Example:

电子
↓
AI Hardware
↓
PCB


---

# 6. entities/


## Purpose

存储知识实体。


Entity 是 Knowledge Graph 基础节点。


结构：

entities/
├── industries/
├── segments/
├── companies/
├── products/
└── technologies/


实体类型：

industry
segment
company
product
technology


---

# 7. relations/


## Purpose

存储实体之间关系。


关系独立于实体。


原因：

关系会变化。


结构：

relations/
├── supply-chain/
├── ownership/
├── competition/
└── technology/


Example:

GPU
depends_on
HBM


---

# 8. intelligence/


## Purpose

存储结构化产业认知。


包括：

- 稳定事实
- 动态预测
- 行业观点
- 趋势
- 风险


结构：

intelligence/
├── facts/
├── forecasts/
├── viewpoints/
├── trends/
└── risks/


---

## facts/


保存：

长期稳定知识。


Example:

GPU 是AI训练核心计算组件


---

## forecasts/


保存：

带生命周期的预测。


Example:

AI Server Market Forecast
2026-2030


必须包含：

- 时间范围
- 来源
- 置信度
- 生命周期


---

## viewpoints/


保存：

行业认知观点。


Example:

AI服务器产业核心增长逻辑


包括：

- bullish factors
- bearish factors
- key variables


---

## trends/


保存：

产业趋势。


Example:

液冷渗透率提升


---

## risks/


保存：

产业风险。


Example:

AI资本开支下降风险


---

# 9. modules/


## Purpose

支持不同行业的差异化知识模块。


避免：

所有行业固定字段。


结构：

modules/
├── comparison/
├── roadmap/
├── market/
├── company/
├── competition/
├── capacity/
└── supply-chain/


---

Example:


GPU:

technology roadmap
product comparison
market forecast


白酒:

competition
channel
company


---

# 10. sources/


## Purpose

保存知识来源。


用于：

- 来源追踪
- 可信度管理
- 生命周期判断


结构：

sources/
├── reports/
├── announcements/
├── websites/
└── databases/


---

# 11. views/


## Purpose

保存展示层定义。


Views 不保存知识。


负责：

定义：

- 页面展示结构
- 模块组合方式


Example:

Industry Detail View:

Overview
Market
Technology
Companies
Risk


不同产业可以使用不同 View。


---

# 12. registry/


## Purpose

Knowledge Asset 索引。


用于：

快速定位资产。


包括：

entities registry
modules registry
sources registry


Example:

entity:
industry:ai-hardware
path:
entities/industries/ai-hardware.yaml


---

# 13. Relationship With tests/knowledge


当前：

tests/knowledge

定位：

Knowledge Fixture Dataset。


用途：

- 测试
- Demo
- Skill验证


不是正式 Knowledge Storage。


未来迁移：

industry-graph.json
↓
entities/
relations/
intelligence/
modules/
views/


---

# 14. Runtime Loading


第一阶段：

不引入：

- Graph Database
- Vector Database
- RAG


加载方式：

Knowledge Skill
↓
Registry
↓
Asset Files


---

# 15. Non Goals


v0.1 不包含：

- Knowledge 自动生成
- Knowledge 自动更新
- LLM知识抽取
- 图数据库
- 向量数据库
- 自动推理引擎


---

# 16. Freeze Decision


Accepted:


knowledge/
作为 ResearchHub Knowledge Asset Storage。
内部结构：
taxonomy
entities
relations
intelligence
modules
sources
views
registry


Rejected:


knowledge inside packages
single graph json storage
runtime coupled knowledge
fixed industry schema

---

# End