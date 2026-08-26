# ADR-015: Knowledge Base Instance and Runtime Data Separation

**Status:** Accepted / Architecture Freeze  
**Date:** 2026-08-26

## Decision

ResearchHub separates Knowledge capabilities/contracts from actual user Knowledge Base data.

ResearchHub Source manages DSH, Workflows, Skills, Plugins, Knowledge Schemas, adapters, validation, migration code, write infrastructure, tests, examples, and governance.

Actual user Knowledge Bases are independent Runtime Data instances and are not repository-root source assets by default.

## Rationale

A real Knowledge product must support different users and research spaces with independent data, Sources, Raw Reports, update histories, and Schema lifecycles.

Treating `knowledge/` as one repository-level durable asset incorrectly couples user data to ResearchHub source version control and prevents clean multi-KB ownership and migration.

## Runtime Boundary

```text
ResearchHub Source
├── dsh/
├── packages/
├── tests/
├── examples/
└── docs/

Runtime Data
└── knowledge-bases/
    ├── <kb-id>/
    └── ...
```

## Runtime Access

Knowledge operations resolve one explicit `KnowledgeBaseHandle`.

No implicit global production Knowledge directory remains.

## Provenance

User Research Report ingestion preserves:

```text
Knowledge → Source → Raw
```

## Schema and Migration

Each KB declares its Schema Version. New Schemas do not automatically invalidate old KBs.

Breaking changes require explicit staged, validated Migration. Semantic reinterpretation requiring LLM/human judgment cannot be silently committed.

## Git Boundary

Git versions the system that understands Knowledge, not real user Knowledge itself.

Example KBs may be Git-managed because they are product examples.

## Superseded Decisions

This ADR supersedes repository-level production `knowledge/` ownership in ADR-014, Knowledge Architecture v0.1, Storage Layout v0.1, and older current-summary wording.

It does not supersede the established semantic model.

## Preserved Architecture

Single DSH, Workflow/Skill/Plugin boundaries, Harness responsibility, and runtime-neutral `packages/` remain unchanged.

## Non-Goals

No Knowledge Agent, Multi-Agent architecture, Agent Planner, Workflow Engine, Graph DB, Vector DB, RAG, autonomous Schema evolution, or automatic semantic migration.
