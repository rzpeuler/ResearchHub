# RESEARCHHUB_KNOWLEDGE_VALIDATION_SKILL_V0.1

## Status

Architecture Freeze

## Purpose

Knowledge Validation Skill 是 Knowledge Governance Skill。

位置：

```text
skills/knowledge-validation/
```

Validation Skill：

- 确定性
- 不调用 LLM
- 不修改 Knowledge
- 不判断事实真假
- 不承担投资分析

## Validation Categories

- Schema Validation
- Reference Validation
- Relation Validation
- Lifecycle Validation
- Module Validation
- ID Validation
- Source Validation

## Interface

核心：

```text
validateKnowledge(scope?)
```

Scope：

```text
all
entity
relation
intelligence
module
source
```

## Validation Report

```text
ValidationReport

status: passed | failed
errors
warnings
info
timestamp
scope
```

Severity：

```text
error
warning
info
```

## Responsibility Boundary

Knowledge Access Skill = Read Knowledge

Knowledge Validation Skill = Check Knowledge

Knowledge Update Workflow = Create / Update / Merge / Expire
