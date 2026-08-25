# RESEARCHHUB_KNOWLEDGE_VALIDATION_RULES_SCHEMA_V0.1

## Status

Architecture Design

## Purpose

定义 Knowledge Validation Skill 的确定性治理规则结构。

规则属于 Skill 配置：

```text
skills/knowledge-validation/rules/
```

不属于 `knowledge/`。

## Rule Types

```text
Schema Rule
Reference Rule
Relation Rule
Lifecycle Rule
Module Rule
ID Rule
Source Rule
```

## Generic Rule

```yaml
id:
type:
target:
severity:
conditions:
message:
```

Severity：

```text
error
warning
info
```

## Relation Rule Example

```yaml
id: relation-supplier-of-constraint
type: relation
target: supplier_of
severity: error
conditions:
  allowedSourceTypes:
    - company
  allowedTargetTypes:
    - company
    - product
  requiredFields:
    - confidence
    - sourceRefs
```

## Lifecycle Rules

允许：

```text
active
expired
superseded
archived
```

并检查 validFrom / validUntil 合法性。

## Source Rules

Forecast / Viewpoint 等动态研究型 Knowledge 必须具有 sourceRefs。

## Module Rules

被引用 Module 必须已注册。

## ID Rules

检查：

- 格式
- 唯一性
- namespace 与 object type 一致
- 引用使用完整 ID

## Non Goals

- 不由 LLM 自动生成规则
- 不自动修复 Knowledge
- 不验证事实真实性
