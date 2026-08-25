# RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1

## Status

Architecture Freeze

## Purpose

定义 `knowledge/` 内部物理存储布局。

本文件只定义 Knowledge Asset Storage，不重新定义 ResearchHub 根目录结构。

## Directory Structure

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

## taxonomy

保存分类体系。

## entities

建议：

```text
entities/
├── industries/
├── segments/
├── companies/
├── products/
└── technologies/
```

## relations

按关系类别组织。

## intelligence

```text
intelligence/
├── facts/
├── forecasts/
├── viewpoints/
├── trends/
└── risks/
```

## modules

典型：

```text
modules/
├── comparison/
├── roadmap/
├── market/
├── competition/
├── capacity/
└── supply-chain/
```

## sources

保存来源资产。

## views

保存展示配置，不保存核心知识。

## registry

保存资产索引，例如 Entity ID 到 Asset Path 的映射。

## File Formats

v0.1 推荐：

- YAML：结构化 Knowledge 主格式
- Markdown：必要的长文本内容
- JSON：runtime export / frontend fixture

## Relationship with tests/knowledge

`tests/knowledge` 定位为 Knowledge Fixture / Architecture Validation Dataset，不是正式 Knowledge Storage。

## Non Goals

不引入：

- Graph DB
- Vector DB
- RAG
- 自动知识抽取
