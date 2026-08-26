# RESEARCHHUB_KNOWLEDGE_SCHEMA_VERSIONING_MIGRATION_V0.1

## Status

**Architecture Freeze**

- Version: v0.1
- Date: 2026-08-26

## 1. Principle

A new Knowledge Schema release must not automatically invalidate old Knowledge Bases.

Runtime reads `manifest.schemaVersion` before selecting readers, writers, adapters, or migration paths.

## 2. Version Separation

`schemaVersion` is the Knowledge business/data contract. `storageFormatVersion` is the physical persistence contract.

## 3. Schema Change Classes

1. Additive compatible
2. Compatible semantic extension
3. Structural breaking
4. Semantic breaking

Prefer compatible additions over breaking redesign.

## 4. Compatibility States

- compatible
- read_only_compatible
- migration_available
- unsupported

Read and write compatibility are distinct.

## 5. Schema Release Metadata

A release must state the Schema version, readable versions, writable versions, and migration sources.

## 6. Migration Definition

Migration is versioned deterministic infrastructure that transforms one KB Schema Version into another while preserving declared invariants.

Migration is not a Workflow, Skill, Plugin, or Agent.

## 7. Migration Code

Recommended location:

```text
packages/schemas/knowledge/
├── v0.1/
├── v0.2/
└── migrations/
    ├── v0.1-to-v0.2/
    └── ...
```

## 8. Migration Runner

```text
Read Manifest
→ Resolve migration path
→ Dry-run
→ Create staging
→ Transform
→ Validate target Schema
→ Validate references
→ Validate Registry
→ Validate provenance
→ Validate invariants
→ Atomic switch
→ Update Manifest
→ Write migration log
```

Mount and ingestion never silently run Migration.

## 9. Canonical Migration Path

Prefer adjacent version migrations such as `0.1 → 0.2 → 0.3`.

## 10. Dry-Run

Dry-run is required and must not modify durable KB state.

## 11. Staging and Atomicity

Target Schema becomes active only after all required validation passes. Failure leaves current active KB unchanged.

## 12. Deterministic Migration

Automatic commit requires same-input → same-output and must not depend on mutable external data or LLM interpretation.

## 13. Semantic Migration

If old data is insufficient for lossless conversion, emit a MigrationReviewItem. LLM-assisted proposals cannot be silently committed.

## 14. IDs and References

Preserve Knowledge IDs whenever possible. If identity changes, emit an explicit ID mapping and update all references.

`Knowledge → Source → Raw` traceability is a hard invariant.

## 15. Raw and Logs

Raw is normally not migrated. Historical ingestion logs remain historical.

## 16. Support Window

Runtime may support multiple Schema Versions simultaneously. Deprecated does not mean broken.

## 17. Schema Gap Governance

```text
SchemaGapProposal
→ Architecture Review
→ Schema Design
→ Compatibility Analysis
→ Migration Design if required
→ Freeze
→ Engineering
```

## 18. Frozen Decision

Knowledge Schema evolution is explicit, versioned, compatibility-aware, and safe for independent user Knowledge Bases.
