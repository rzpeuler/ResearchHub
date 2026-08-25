# RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.1

## Status

Architecture Freeze

## Core Model

```text
Entity       = Object
Relation     = Relationship
Intelligence = Structured Understanding
Module       = Domain-specific Extension
Registry     = Organization / Index
```

## Global Metadata

Knowledge Object 可包含：

```yaml
id:
type:
createdAt:
updatedAt:
sourceRefs:
confidence:
lifecycle:
```

## Entity Schema

Entity 保存对象身份与稳定属性。

Base：

```yaml
id:
type:
name:
description:
tags:
taxonomyRefs:
metadata:
```

Entity Types：

```text
industry
segment
company
product
technology
```

动态经营判断、预测和观点不进入 Entity。

## Relation Schema

```yaml
id:
type:
source:
target:
attributes:
confidence:
sourceRefs:
lifecycle:
```

Relation 支持动态属性。

## Intelligence Schema

### Fact

```yaml
id:
type: fact
entityRefs:
statement:
category:
sourceRefs:
confidence:
lifecycle:
```

### Forecast

```yaml
id:
type: forecast
entityRefs:
metric:
period:
values:
assumptions:
sourceRefs:
confidence:
lifecycle:
```

### Viewpoint

```yaml
id:
type: viewpoint
entityRefs:
bullishPoints:
bearishPoints:
keyVariables:
sourceRefs:
confidence:
lifecycle:
```

### Trend

```yaml
id:
type: trend
entityRefs:
direction:
description:
drivers:
timeHorizon:
sourceRefs:
confidence:
lifecycle:
```

### Risk

```yaml
id:
type: risk
entityRefs:
description:
trigger:
impact:
probability:
sourceRefs:
confidence:
lifecycle:
```

## Module Schema

Module 用于表达不同行业的灵活结构。

Comparison 使用动态 Columns：

```yaml
id:
type: comparison
schemaId:
targetEntity:
columns:
rows:
```

禁止固定所有行业相同的比较字段。

## Source Schema

```yaml
id:
type:
title:
publisher:
publishedAt:
url:
quality:
```

## Lifecycle

```yaml
lifecycle:
  status:
  validFrom:
  validUntil:
```

Status：

```text
active
expired
superseded
archived
```

## Version Strategy

采用逻辑覆盖，历史版本保留；默认读取 active/current。
