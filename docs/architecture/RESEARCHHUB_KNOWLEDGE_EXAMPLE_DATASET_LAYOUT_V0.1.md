# RESEARCHHUB_KNOWLEDGE_EXAMPLE_DATASET_LAYOUT_V0.1

## Status

Architecture Validation Design

## Purpose

定义第一次工程实现使用的 AI Hardware Example Dataset 文件布局。

Example Dataset 是 Architecture Validation Dataset，不是生产 Knowledge。

## Location

```text
tests/knowledge/fixtures/
```

## Layout

```text
tests/knowledge/fixtures/

├── taxonomy/
├── entities/
│   ├── industries/
│   ├── segments/
│   ├── companies/
│   ├── products/
│   └── technologies/
├── relations/
│   ├── supply-chain/
│   ├── ownership/
│   ├── competition/
│   └── technology/
├── intelligence/
│   ├── facts/
│   ├── forecasts/
│   ├── viewpoints/
│   ├── trends/
│   └── risks/
├── modules/
│   ├── comparison/
│   │   ├── schemas/
│   │   └── datasets/
│   ├── roadmap/
│   │   ├── schemas/
│   │   └── datasets/
│   └── supply-chain/
├── sources/
├── views/
├── registry/
└── validation/
    ├── valid/
    └── invalid/
```

## File Policy

- 一个 Entity 一个文件
- 原则上一个 Relation 一个文件
- 文件名使用 lowercase-kebab-case
- 文件名对应对象 ID 的 slug

## Example Files

```text
entities/industries/ai-hardware.yaml
entities/segments/gpu.yaml
entities/segments/hbm.yaml
entities/segments/high-speed-pcb.yaml
entities/segments/liquid-cooling.yaml
entities/companies/nvidia.yaml
entities/companies/hudian.yaml

intelligence/forecasts/ai-server-market-size.yaml
intelligence/viewpoints/ai-hardware-growth.yaml
intelligence/trends/liquid-cooling-adoption.yaml
intelligence/risks/ai-capex-slowdown.yaml
```

## Validation Fixtures

`validation/invalid` 应包含故意错误数据：

```text
missing-reference.yaml
invalid-relation.yaml
expired-lifecycle.yaml
unknown-module.yaml
```

## Recommended Loading Order

```text
1. taxonomy
2. entities
3. relations
4. sources
5. intelligence
6. modules
7. views
```
