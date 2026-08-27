# Knowledge Layer Architecture

**Status:** Current Normative Knowledge Architecture Summary
**Date:** 2026-08-27

## Normative References

Current normative architecture:

- `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md`
- `KNOWLEDGE_DATA_SCHEMA_V0.3.md`
- `KNOWLEDGE_CURATION_SKILL_V0.3.md`
- `RESEARCH_REPORT_INGESTION_WORKFLOW_V0.3.md`
- `KNOWLEDGE_SCHEMA_MIGRATION_0.2_TO_0.3.md`
- `KNOWLEDGE_FRONTEND_PROJECTION_V0.3.md`

Supporting frozen legacy/runtime-boundary references:

- `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2.md`
- `RESEARCHHUB_KNOWLEDGE_BASE_INSTANCE_ARCHITECTURE_V0.1.md`
- `RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.2.md`
- `RESEARCHHUB_KNOWLEDGE_SCHEMA_VERSIONING_MIGRATION_V0.1.md`
- `RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.2.md`
- `RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.2.md`
- `RESEARCHHUB_KNOWLEDGE_VALIDATION_SKILL_INTERFACE_V0.2.md`
- `RESEARCHHUB_KNOWLEDGE_CURATION_SKILL_INTERFACE_V0.1.md`
- `RESEARCHHUB_RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_V0.1.md`
- `RESEARCHHUB_KNOWLEDGE_WRITE_INTERFACE_V0.1.md`
- `ADR-015-KNOWLEDGE-BASE-INSTANCE-AND-RUNTIME-DATA-SEPARATION.md`

## Architecture Definition

Knowledge Infrastructure is the set of ResearchHub capabilities for loading, accessing, curating, validating, writing, migrating, and governing independent Knowledge Base instances.

A Knowledge Base is Runtime Data—not DSH state, Agent Memory, chat history, a Skill package, or repository-root production Knowledge.

## Architecture

```text
Harness Runtime
      ↓
ResearchManager / DSH
      ↓
Workflow
      ↓
Knowledge Infrastructure
├── Access Skill
├── Curation Skill
├── Validation Skill
├── Write Interface
├── Schema Adapter
└── Migration Runner
      ↓
KnowledgeBaseHandle
      ↓
Knowledge Base Instance
```

## Source Boundary

ResearchHub Source contains DSH, packages, tests, examples, and docs.

## Runtime Data Boundary

```text
<ResearchHub Data Root>/
└── knowledge-bases/
    ├── <kb-id>/
    └── ...
```

## Knowledge Semantics

The v0.3 canonical object kinds are ThemeGroup, Entity, Relation, Claim,
Source, Module, and RawRef. Entity subtypes include InvestmentTheme, Industry,
Company, Product, and Technology. Reference Taxonomy and Projection
Configuration are auxiliary assets, not canonical object kinds. v0.2 remains
the frozen legacy compatibility/migration source.

## Lifecycle

KB lifecycle includes create, mount, load, read, ingest, update, supersede, validate, migrate, archive, and inspect.

A KB is not an Agent.

## Ingestion

The normative ingestion SOP is the 18-stage [Research Report Ingestion
Workflow v0.3](RESEARCH_REPORT_INGESTION_WORKFLOW_V0.3.md). It is the frozen
target contract; the current runtime implementation has not migrated to v0.3.
The compact path below records the existing legacy runtime shape and is not a
second normative workflow definition.

```text
Research Report
→ Resolve target KB
→ Archive Raw
→ Source Assessment
→ Relevance Filter
→ Candidate Extraction
→ Knowledge Admission
→ Schema Mapping
→ Existing Knowledge Retrieval
→ Conflict Resolution
→ Validation
→ Atomic Write
→ Updated KB + Ingestion Log
```

## Quality Objective

Knowledge ingestion optimizes durable research signal-to-noise ratio, not maximum extraction count.

## Provenance

```text
Knowledge
→ Source
→ Raw
```

## Schema Evolution

The current target is Schema 0.3 / Storage Format 1. Schema 0.2 is the frozen
legacy compatibility and migration source. The explicit [Schema Migration v0.2
to v0.3](KNOWLEDGE_SCHEMA_MIGRATION_0.2_TO_0.3.md) is required; mount and
ingestion never silently migrate user data.

## Runtime Neutrality

Knowledge interfaces remain reusable outside DSH. `packages/` does not depend on `dsh/`.

## Non-Goals

No Multi-Agent, Knowledge Agent, Planner, Workflow Engine, Graph DB, Vector DB, RAG, background ingestion, autonomous Schema evolution, or automatic semantic migration.
