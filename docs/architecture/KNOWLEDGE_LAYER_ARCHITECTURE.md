# Knowledge Layer Architecture

**Status:** Current Architecture Summary  
**Date:** 2026-08-26

## Normative References

Current frozen architecture:

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

Knowledge continues to model Taxonomy, Entity, Relation, Fact, Forecast, Viewpoint, Trend, Risk, Module, Source, View, and Registry.

## Lifecycle

KB lifecycle includes create, mount, load, read, ingest, update, supersede, validate, migrate, archive, and inspect.

A KB is not an Agent.

## Ingestion

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

Schema lives under `packages/schemas/knowledge/`. Each KB declares `schemaVersion`.

Breaking changes require Migration design. Mount and ingestion never silently migrate user data.

## Runtime Neutrality

Knowledge interfaces remain reusable outside DSH. `packages/` does not depend on `dsh/`.

## Non-Goals

No Multi-Agent, Knowledge Agent, Planner, Workflow Engine, Graph DB, Vector DB, RAG, background ingestion, autonomous Schema evolution, or automatic semantic migration.
