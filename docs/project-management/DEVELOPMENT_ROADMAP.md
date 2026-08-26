# Development Roadmap

## Completed foundation

- Harness integration and Session persistence.
- Artifact Trace and compatibility Memory/Evaluation foundations.
- Event Analysis and Company Research Skills.
- Industry Research Skill design foundation.
- Workflow definitions, registry, and thin executors.
- Market, information, and financial Plugins with deterministic fixtures.
- Single DSH package migration and architecture documentation.
- Architecture Simplification governance update and Architecture v0.3.
- Research Output, Research Object, and Knowledge Layer architecture.

## Current phase: Knowledge Base Instance Architecture Migration

Knowledge Architecture v0.2, Knowledge Base Instance Architecture v0.1,
Storage Layout v0.2, Schema Versioning and Migration, Data Schema v0.2,
Access/Validation/Curation contracts, Ingestion Workflow, Write Interface,
Frontend Projection v0.2, Example KB Layout, and ADR-015 are design-complete
and frozen. Runtime Migration Phase A is implemented and review pending. Phase
B remains Planned / Pending. This phase is an engineering migration, not a new
architecture design exercise.

The repository AI Hardware dataset remains in its current location until the
approved migration work is implemented. It is not reclassified as user Runtime
Data by documentation alone.

## Migration roadmap

### Phase A — Source / Runtime ownership migration foundation — Implemented / Review Pending

- Knowledge Base Manifest
- explicit KnowledgeBaseHandle
- Runtime Data Root configuration
- version-aware Loader
- Schema Adapter
- KB-scoped Registry

Phase A implementation and focused/default validation are complete. Sol review
is pending; no production dataset migration has been performed.

### Phase B — Existing Knowledge implementation migration — Planned / Pending

- migrate the repository AI Hardware dataset to an example KB layout;
- add KB scoping to Access Skill, Validation, and Frontend Projection;
- preserve existing deterministic behavior and fixture coverage.

### Phase C — Knowledge mutation infrastructure

- Raw Archive;
- deterministic Write Interface;
- revision, lock, staging, and idempotency;
- ingestion logs.

### Phase D — Research Report ingestion capability

- Knowledge Curation Skill;
- relevance and quality filtering;
- Knowledge Admission;
- conflict analysis and Schema Gap proposals;
- Research Report Knowledge Ingestion Workflow.

### Phase E — Migration infrastructure

- Migration Registry;
- Migration Runner;
- dry-run, staging, and validation contracts;
- first real migration only when a breaking Schema version requires it.

Each phase remains Planned or Pending Engineering until its implementation,
focused tests, and default full validation are complete. Do not label the v0.2
Runtime capabilities as implemented based on frozen documentation alone.

Every new feature must remain within the existing DSH, Workflow, Skill,
Plugin, Research Output, or Knowledge Infrastructure boundaries. No new Agent,
Planner, Memory, Evaluation, Workflow Engine, Knowledge Agent, Graph DB, Vector
DB, RAG, or automatic Schema evolution layer may be introduced.
