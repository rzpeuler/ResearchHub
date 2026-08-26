# RESEARCHHUB_KNOWLEDGE_VALIDATION_SKILL_INTERFACE_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Formal contract for the existing deterministic Knowledge Validation Skill.

## 1. Purpose

Knowledge Validation Skill deterministically verifies a scoped Knowledge Base or proposed ChangeSet against the Schema and integrity rules applicable to the target KB.

It does not call an LLM, judge factual truth, or mutate Knowledge.

## 2. Architecture

```text
Workflow / Write preparation
→ explicit KnowledgeBaseHandle
→ Knowledge Validation Skill
→ Schema-aware validation rules
→ Registry / Raw / Knowledge refs
```

## 3. Public Interface

```text
validateKnowledgeBase(context, scope?)
validateChangeSet(context, changeSet)
```

## 4. Scope

Logical scopes may include:

- manifest
- raw
- entity
- relation
- intelligence
- module
- source
- registry
- all

## 5. Schema Awareness

Validation selects rules for the KB's declared `schemaVersion`.

It must never validate an old KB blindly as the latest Schema.

## 6. Object Validation

At minimum:

- ID format / uniqueness in KB
- required fields
- enum constraints
- lifecycle validity
- type-specific required fields
- Source schema
- Module schema
- Relation endpoint types

## 7. Reference Validation

At minimum:

- Entity refs resolve
- Relation endpoints resolve
- Module targets resolve
- Source refs resolve
- Registry entries match actual assets
- Registry paths cannot escape KB root / backend locator boundary

## 8. Raw Provenance Validation

For Schemas supporting Raw provenance:

- `Source.rawRefs[]` resolve in target KB Raw Registry
- durable ingested Knowledge can preserve `Knowledge → Source → Raw`
- Raw refs cannot resolve into another KB

## 9. Manifest and Compatibility

Validate KB identity, Schema Version, Storage Format Version, revision, and status.

Compatibility is distinct from object validity.

## 10. ChangeSet Validation

Validate target Schema, allowed operations, proposed IDs, refs including Sources created in the same ChangeSet, supersede consistency, merge-source invariants, Raw provenance, and Registry expectations.

Do not rewrite invalid input.

## 11. Diagnostics

Return structured `passed | failed` reports with errors, warnings, info, scope, and timestamp.

## 12. Non-Goals

No LLM, factual truth judgment, conflict resolution, asset mutation, final ID allocation, Registry write, Migration, or automatic repair.

## 13. Frozen Decision

Validation is explicitly KB-scoped, Schema-aware, Raw-provenance-aware, and capable of validating proposed ChangeSets before atomic write.
