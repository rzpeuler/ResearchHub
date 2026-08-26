# Project Overview

ResearchHub is an AI-assisted A-share research system built on DeepSeek
Harness. It is a professional research asset layer, not a general-purpose
Agent Framework. It organizes research into a Single DSH architecture:

```text
ResearchManager (DSH) + Workflow + Skill + Plugin
```

ResearchHub does not execute trades, promise price forecasts, modify Harness
Core, or replace the Harness runtime. Harness owns runtime execution and LLM
reasoning. Research Output and the Knowledge Layer are the product-facing
boundaries. Existing Artifact, Memory, and Evaluation modules remain only as
compatibility implementations.

## Current product boundary

- Harness: owns Agent, Tool, Session, loading, and model runtime services.
- DSH / ResearchManager: understands the application request and coordinates
  research execution.
- Workflow: defines repeatable research SOPs, dependencies, and verification.
- Skill: supplies professional research methodology and structured output
  generation. Its payload remains Skill-owned.
- Plugin: connects external data and persistence resources.
- Research Output: publishes reports, Research Objects, and provenance.
- Knowledge Infrastructure: ResearchHub source capabilities for Knowledge
  schemas, adapters, validation, migration, curation, write interfaces, and
  deterministic access. It resolves an explicit `KnowledgeBaseHandle` to an
  independent Knowledge Base Runtime Data instance.
- Knowledge Base Runtime Data: user-owned, independently mutable and
  versioned Knowledge Base instances. Multiple KBs are supported; a user KB is
  not the repository-root `knowledge/` directory by default.
- Knowledge lifecycle: Workflow controls ingestion and update orchestration;
  Curation performs explicitly invoked research reasoning; Access and
  Validation remain deterministic; Write accepts only validated changes.
- Memory / Evaluation: legacy compatibility paths; no new product layer or
  autonomous prediction-evaluation loop is planned.

The existing Event Analysis, Company Research, and Equity Research flows
validate the runtime path from request through Workflow, Skill, Plugin, and
Research Output. Existing Artifact, Memory, and Evaluation tests remain as
compatibility coverage.

## Knowledge Source / Runtime boundary

```text
ResearchHub Source
  DSH / Workflow / Skill / Plugin
  Knowledge Schema / Adapter / Validation / Migration / Write infrastructure
  tests / examples / governance
        -> explicit KnowledgeBaseHandle
ResearchHub Runtime Data
  knowledge-bases/<kb-id>/
```

The current architecture is Knowledge Architecture v0.2. Runtime Migration
Phase B is implemented and review pending. The AI Hardware Example Knowledge
Base is stored at `examples/knowledge-bases/ai-hardware/`; it is Git-managed
example data, not user Runtime Data. User KBs remain configurable under the
Runtime Data Root.

## Primary references

- [Research Output architecture](../architecture/RESEARCH_OUTPUT_ARCHITECTURE.md)
- [Knowledge Layer architecture](../architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md)
- [Knowledge Architecture v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2.md)
- [Knowledge Base Instance Architecture v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_BASE_INSTANCE_ARCHITECTURE_V0.1.md)
- [Knowledge Storage Layout v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.2.md)
- [Schema Versioning and Migration v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_SCHEMA_VERSIONING_MIGRATION_V0.1.md)
- [Knowledge Data Schema v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.2.md)
- [Knowledge Access Skill v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.2.md)
- [Knowledge Validation Skill v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_VALIDATION_SKILL_INTERFACE_V0.2.md)
- [Knowledge Curation Skill v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_CURATION_SKILL_INTERFACE_V0.1.md)
- [Research Report Ingestion Workflow v0.1](../architecture/RESEARCHHUB_RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_V0.1.md)
- [Knowledge Write Interface v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_WRITE_INTERFACE_V0.1.md)
- [Knowledge Frontend Projection v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_FRONTEND_PROJECTION_V0.2.md)
- [Knowledge Example Dataset Layout v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_EXAMPLE_DATASET_LAYOUT_V0.2.md)
- [ADR-015 Knowledge Base Instance and Runtime Data Separation](../architecture/ADR-015-KNOWLEDGE-BASE-INSTANCE-AND-RUNTIME-DATA-SEPARATION.md)
- [Knowledge Architecture Freeze Index](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_FREEZE_INDEX_2026-08-26.md)
- Historical [Knowledge Architecture v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md)
- Historical [Knowledge Skill Interface v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.1.md)
- Historical [Knowledge Storage Layout v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.1.md)
- [Architecture v0.3 historical record](../architecture/RESEARCHHUB_ARCHITECTURE_V0.3.md)
- [Architecture v0.2 historical baseline](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [Technical design](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Single DSH ADR](../architecture/ADR-001-SINGLE-DSH-ARCHITECTURE.md)
- [Current status](CURRENT_STATUS.md)
