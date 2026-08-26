# RESEARCHHUB_KNOWLEDGE_FRONTEND_PROJECTION_V0.2

## Status

**Architecture Freeze**

- Version: v0.2
- Date: 2026-08-26
- Supersedes: v0.1 storage-path and production-KB assumptions.

## 1. Boundary

Frontend Projection is a deterministic server-side read model. It is not a new architecture layer and does not write canonical Knowledge.

## 2. Runtime Path

```text
Explicit KnowledgeBaseHandle
→ Version-aware Loader / Schema Adapter
→ Runtime Knowledge Model / Index
→ Knowledge Access Skill
→ Frontend Projection Adapter
→ read-only HTTP API
→ Browser
```

## 3. No Hardcoded Knowledge Root

Projection must not depend on repository-root `knowledge/` paths.

## 4. Explicit KB Scope

Prototype APIs should make KB scope explicit, e.g.:

```text
GET /api/knowledge-bases/:knowledgeBaseId/directory
GET /api/knowledge-bases/:knowledgeBaseId/graph/:entityId
GET /api/knowledge-bases/:knowledgeBaseId/entity/:entityId
```

Equivalent server-scoped routing is acceptable if one explicit handle is still resolved.

## 5. Existing Projection Semantics

Preserve deterministic rules for directory, graph, financial Facts, Forecasts, Viewpoints, event Facts, Source resolution, comparison Modules, company scale, and segment scale.

No market-share inference or hidden denominator is introduced.

## 6. Version Compatibility

Projection consumes the stable Runtime Knowledge Model rather than persistent Schema-specific YAML.

## 7. Example KB

AI Hardware validation should target:

```text
examples/knowledge-bases/ai-hardware/
```

## 8. Non-Goals

No persistent projection database, frontend-owned Knowledge truth, Graph DB, RAG, write path, automatic cross-KB aggregation, or Schema Migration.

## 9. Frozen Decision

Frontend Projection v0.2 is a deterministic consumer of one explicit Knowledge Base, decoupled from repository-root storage.
