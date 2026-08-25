# RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1

## Status

Architecture Freeze

## Core Rule

```text
{namespace}:{slug}
```

ID 是稳定机器标识，不是展示名。

## Slug Rules

- lowercase
- ASCII
- kebab-case
- 不使用中文
- 不使用空格或下划线
- ID 创建后不因 name 变化而修改

## Namespaces

```text
industry
segment
company
product
technology
relation
fact
forecast
viewpoint
trend
risk
source
module
view
```

## Examples

```text
industry:ai-hardware
segment:liquid-cooling
company:nvidia
company:hudian
product:h100
technology:cpo
fact:gpu-ai-compute-role
forecast:ai-server-market-size-2026
viewpoint:ai-hardware-2026h2
trend:liquid-cooling-adoption
risk:ai-capex-slowdown
source:nvidia-rubin-roadmap-2026
module:product-comparison
view:industry-technology-driven
```

## Relation ID

推荐：

```text
relation:{source-slug}-{relation-type}-{target-slug}
```

例如：

```text
relation:gpu-depends-on-hbm
```

## Reference

所有引用必须使用完整 ID。
