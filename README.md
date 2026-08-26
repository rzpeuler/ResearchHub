# ResearchHub

ResearchHub is financial research knowledge infrastructure built on DeepSeek
Harness. It does not build a general-purpose Agent Framework. Its runtime
architecture remains the Single DSH model, while its product-facing boundaries
are Research Output and durable Knowledge:

```text
Execution path:
ResearchManager (DSH)
        -> Workflow
             -> Skill
                  -> Plugin
                       -> Research Output

Durable Knowledge lifecycle:
Workflow-controlled update decision
        -> Knowledge Infrastructure
             -> explicit KnowledgeBaseHandle
                  -> independent Knowledge Base Runtime Data
```

ResearchHub does not execute trades, modify Harness Core, or rebuild the
Harness runtime. Harness owns runtime execution and LLM reasoning. The DSH is
the only ResearchHub coordination center; Workflows describe standard
research SOPs, Skills provide professional research methods, and Plugins
connect external resources. Reports, structured Research Objects, and
provenance are Research Output. ResearchHub Source owns Knowledge schemas,
adapters, validation, migration, and write infrastructure. Actual user
Knowledge Bases are independent, explicitly scoped Runtime Data instances;
they are not the repository-root `knowledge/` directory by default. A
Workflow may explicitly govern a reviewed Knowledge update; Research Output,
including Research Objects, is not automatically converted into Knowledge.

The repository-level DSH Runtime Orchestrator is `dsh/`. The `packages/`
directory contains reusable, runtime-neutral research assets: Workflows,
Skills, Plugins, compatibility Artifact code, public Schemas, and shared
utilities. Packages do not depend on the DSH and can be used by another
Runtime or external caller. `packages/memory/` and `packages/evaluation/` are
retained for compatibility; they are not current product architecture layers.

The public Research Object envelope is defined in
[`packages/schemas/research-object.ts`](packages/schemas/research-object.ts).

The current Knowledge architecture is frozen as Knowledge Architecture v0.2
with an independent Knowledge Base Instance model. Runtime Migration Phase A,
Phase B, Phase C, and Phase D1 are accepted after Sol verification. Phase D2
Research Report Knowledge Ingestion Workflow v0.1 and its R1/R2/R3 contract
rework are implemented and review pending. Schema 0.2 / Storage 1 is
the only writable contract, while Schema 0.1 and readonly/archived bases remain
read-only. Runtime Migration Phase E is implemented and review pending for Sol
verification; migration remains explicit and never occurs during mount, load,
access, or ingestion. The Git-managed AI Hardware Example
Knowledge Base is available at
[`examples/knowledge-bases/ai-hardware/`](examples/knowledge-bases/ai-hardware/);
real user Runtime Data remains configurable and independently scoped.

## Project documents

- [Project overview](docs/project-management/PROJECT_OVERVIEW.md)
- [Current status](docs/project-management/CURRENT_STATUS.md)
- [Architecture](docs/project-management/ARCHITECTURE.md)
- [Decision log](docs/project-management/DECISION_LOG.md)
- [Development roadmap](docs/project-management/DEVELOPMENT_ROADMAP.md)
- [Development rules](docs/project-management/DEVELOPMENT_RULES.md)
- [Change log](docs/project-management/CHANGELOG.md)
- [AKShare Financial Bridge operations](tools/README.md)

## Architecture documents

- [Research Output architecture](docs/architecture/RESEARCH_OUTPUT_ARCHITECTURE.md)
- [Knowledge Layer current summary](docs/architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md)
- [Knowledge Architecture v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2.md)
- [Knowledge Base Instance Architecture v0.1](docs/architecture/RESEARCHHUB_KNOWLEDGE_BASE_INSTANCE_ARCHITECTURE_V0.1.md)
- [Knowledge Storage Layout v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_STORAGE_LAYOUT_V0.2.md)
- [Schema Versioning and Migration v0.1](docs/architecture/RESEARCHHUB_KNOWLEDGE_SCHEMA_VERSIONING_MIGRATION_V0.1.md)
- [Knowledge Data Schema v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_DATA_SCHEMA_V0.2.md)
- [Knowledge Access Skill v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_SKILL_INTERFACE_V0.2.md)
- [Knowledge Validation Skill v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_VALIDATION_SKILL_INTERFACE_V0.2.md)
- [Knowledge Curation Skill v0.1](docs/architecture/RESEARCHHUB_KNOWLEDGE_CURATION_SKILL_INTERFACE_V0.1.md)
- [Research Report Ingestion Workflow v0.1](docs/architecture/RESEARCHHUB_RESEARCH_REPORT_KNOWLEDGE_INGESTION_WORKFLOW_V0.1.md)
- [Knowledge Write Interface v0.1](docs/architecture/RESEARCHHUB_KNOWLEDGE_WRITE_INTERFACE_V0.1.md)
- [Knowledge Frontend Projection v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_FRONTEND_PROJECTION_V0.2.md)
- [Knowledge Example Dataset Layout v0.2](docs/architecture/RESEARCHHUB_KNOWLEDGE_EXAMPLE_DATASET_LAYOUT_V0.2.md)
- [ADR-015 Knowledge Base Instance and Runtime Data Separation](docs/architecture/ADR-015-KNOWLEDGE-BASE-INSTANCE-AND-RUNTIME-DATA-SEPARATION.md)
- [Knowledge Architecture Freeze Index](docs/architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_FREEZE_INDEX_2026-08-26.md)
- [Architecture v0.3 historical record](docs/architecture/RESEARCHHUB_ARCHITECTURE_V0.3.md)
- [Architecture v0.2 historical baseline](docs/architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [Technical design v0.1](docs/architecture/TECHNICAL_DESIGN_V0.1.md)
- [Plugin operation design](docs/architecture/PLUGIN_OPERATION_DESIGN.md)
- [Research Skill design](docs/architecture/RESEARCH_SKILL_DESIGN.md)
- [Research Workflow design](docs/architecture/RESEARCH_WORKFLOW_DESIGN.md)
- [Financial Plugin design](docs/architecture/FINANCIAL_PLUGIN_DESIGN.md)
- [Market Plugin design](docs/architecture/MARKET_PLUGIN_DESIGN.md)
- [Information Plugin design](docs/architecture/INFORMATION_PLUGIN_DESIGN.md)
- [Announcement Plugin design](docs/architecture/ANNOUNCEMENT_PLUGIN_DESIGN.md)
- [Media Plugin design](docs/architecture/MEDIA_PLUGIN_DESIGN.md)
- [Single DSH ADR](docs/architecture/ADR-001-SINGLE-DSH-ARCHITECTURE.md)
- [ADR-010 Architecture Simplification](docs/architecture/ADR-010-ARCHITECTURE-SIMPLIFICATION.md)
- [ADR-011 DSH Control Plane Location](docs/architecture/ADR-011-DSH-CONTROL-PLANE-LOCATION.md)
- [ADR-012 Financial Research Skill Asset Migration](docs/architecture/ADR-012-FINANCIAL-RESEARCH-SKILL-ASSET-MIGRATION.md)
- [ADR-014 Research Output and Knowledge Architecture](docs/architecture/ADR-014-RESEARCH-OUTPUT-KNOWLEDGE-ARCHITECTURE.md)
- Historical v0.1 Knowledge documents remain available in `docs/architecture/`
  but are not the current normative ownership or runtime-data architecture.

## Financial research Skill assets

The runtime-neutral financial Skill packages are:

- `packages/skills/equity-research/` — coverage initiation and business analysis;
- `packages/skills/industry-research/` — market, value-chain, competition, and sector context;
- `packages/skills/earnings-review/` — actual-versus-consensus and guidance review;
- `packages/skills/valuation/` — comparable-company statistics, DCF, and sensitivity analysis.

Each package exposes a typed command and Plugin ports. It contains no DSH,
ResearchManager, Claude, MCP, or slash-command runtime dependency.

## Validation

```text
npm test
```

The command runs TypeScript compilation, Plugin tests, Workflow tests, Skill
tests, compatibility Artifact/Memory/Evaluation tests, and Harness integration
tests. The legacy test suites remain to protect existing callers while the
current product direction moves to Research Output and Knowledge.
