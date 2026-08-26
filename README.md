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
        -> Knowledge Layer
```

ResearchHub does not execute trades, modify Harness Core, or rebuild the
Harness runtime. Harness owns runtime execution and LLM reasoning. The DSH is
the only ResearchHub coordination center; Workflows describe standard
research SOPs, Skills provide professional research methods, and Plugins
connect external resources. Reports, structured Research Objects, and
provenance are Research Output. The `knowledge/` boundary is a separate,
top-level store for durable, reusable research knowledge. A Workflow may
explicitly govern a reviewed Knowledge update; Research Output, including
Research Objects, is not automatically converted into Knowledge.

The repository-level DSH Runtime Orchestrator is `dsh/`. The `packages/`
directory contains reusable, runtime-neutral research assets: Workflows,
Skills, Plugins, compatibility Artifact code, public Schemas, and shared
utilities. Packages do not depend on the DSH and can be used by another
Runtime or external caller. `packages/memory/` and `packages/evaluation/` are
retained for compatibility; they are not current product architecture layers.

The public Research Object envelope is defined in
[`packages/schemas/research-object.ts`](packages/schemas/research-object.ts).

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
- [Knowledge Layer architecture](docs/architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md)
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
