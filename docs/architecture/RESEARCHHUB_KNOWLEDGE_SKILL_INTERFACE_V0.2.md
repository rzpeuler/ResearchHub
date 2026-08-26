# RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: `RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md` for KB scoping and Schema compatibility.

## 1. Purpose

Knowledge Access Skill is the deterministic, read-only Knowledge query interface used by Workflows.

It does not call an LLM, write Knowledge, migrate Schemas, mount KBs, or make investment recommendations.

## 2. Architecture

```text
Workflow
→ explicit KnowledgeBaseHandle / Access Context
→ Knowledge Access Skill
→ Runtime Knowledge Model / Index
→ Schema Adapter
→ Version-aware Loader
→ Knowledge Base Instance
```

## 3. Explicit Scope

Every call has one explicit KB scope. No implicit global `knowledge/` is allowed.

## 4. Read API

Core read semantics:

```text
getEntity(context, entityId)
searchEntities(context, query, type?)
getRelations(context, entityId, relationType?, filters?)
getSupplyChain(context, entityId, depth?)
getRelatedCompanies(context, entityId, filters?)
getIntelligence(context, entityId, type?, filters?)
getModules(context, entityId)
getComparison(context, entityId, comparisonType?)
getSources(context, knowledgeItemId)
```

## 5. Runtime Knowledge Model

Schema-specific adapters normalize supported persistent Schemas into a stable runtime model.

Skill Interface Version and Knowledge Schema Version evolve independently.

## 6. Lifecycle Filters

Dynamic Knowledge defaults to active lifecycle state. Explicit filters may include active, expired, superseded, archived.

## 7. Provenance

`getSources` exposes Source records and their `rawRefs` where present. Raw bytes are not part of the primary Access API.

## 8. Multi-KB Isolation

No automatic cross-KB search, merge, comparison, ranking, or best-KB selection.

## 9. Compatibility

- compatible → normal read
- read_only_compatible → normal read
- migration_required → do not enter normal Access Skill
- unsupported_schema_version → fail explicitly

## 10. Errors

Distinguish `not_found` from infrastructure errors such as registry, validation, and adapter failures.

## 11. Determinism

For the same coherent KB revision and query inputs, results are deterministic.

## 12. Non-Goals

No write, update, delete, mount, create-KB, migration, Curation, conflict resolution, investment ranking, or autonomous cross-KB federation.

## 13. Frozen Decision

Knowledge Access remains a narrow read-only Skill; multi-KB and Schema complexity is absorbed below it by explicit runtime context and adapters.
