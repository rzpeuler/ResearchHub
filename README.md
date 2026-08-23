# ResearchHub

ResearchHub is a research system built on DeepSeek Harness. Its application
architecture is the Single DSH model:

```text
ResearchManager (DSH)
        -> Workflow
             -> Skill
                  -> Plugin
```

ResearchHub does not execute trades and does not rebuild the Harness runtime.
The DSH is the only planning and coordination center; Workflows describe
standard processes, Skills provide research methods, and Plugins connect
external resources.

## Project documents

- [Project overview](docs/project-management/PROJECT_OVERVIEW.md)
- [Current status](docs/project-management/CURRENT_STATUS.md)
- [Architecture](docs/project-management/ARCHITECTURE.md)
- [Decision log](docs/project-management/DECISION_LOG.md)
- [Development roadmap](docs/project-management/DEVELOPMENT_ROADMAP.md)
- [Development rules](docs/project-management/DEVELOPMENT_RULES.md)
- [Change log](docs/project-management/CHANGELOG.md)

## Architecture documents

- [Architecture v0.2](docs/architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
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

## Validation

```text
npm test
```

The command runs TypeScript compilation, Plugin tests, Workflow tests, Skill
tests, Artifact tests, Memory/Evaluation tests, and Harness integration tests.
