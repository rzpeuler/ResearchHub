# RESEARCHHUB_KNOWLEDGE_LOADER_ARCHITECTURE_V0.1

## Status

Architecture Design

## Purpose

Knowledge Loader 将磁盘 Knowledge Asset 转换为 Runtime Knowledge Model。

Loader 不是新的系统架构层，而是 Knowledge Skill 内部可复用基础组件。

## Responsibilities

负责：

- Asset 文件读取
- YAML / JSON 解析
- Registry 解析
- Asset Discovery
- Runtime Object 转换
- Runtime Index 构建

不负责：

- 业务推理
- 投资分析
- Knowledge Update
- Workflow Planning

## Runtime Flow

```text
Registry Load
    ↓
Asset Discovery
    ↓
Parse
    ↓
Validation
    ↓
Build Runtime Index
    ↓
Ready
```

非法正式 Knowledge 不进入正常 Runtime Index。

## Runtime Index

v0.1 使用内存 Index，例如概念上：

```text
entities: Map<ID, Entity>
relations: Map<ID, Relation>
intelligence: Map<ID, Intelligence>
sources: Map<ID, Source>
modules: Map<ID, Module>
```

## Registry

Registry 提供 ID → Asset Path 索引。

## Cache

v0.1：

- Load once
- Memory cache
- 支持显式 reload
- 不做自动文件监听
- 不使用 Redis

## Storage Independence

未来迁移数据库时，优先替换 Loader / Storage Adapter，上层 Knowledge Skill API 保持稳定。

## Non Goals

- Graph DB
- Vector Search
- RAG
- 分布式缓存
- 实时同步
