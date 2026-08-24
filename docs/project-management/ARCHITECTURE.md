# Project Architecture

ResearchHub is a professional research asset layer running on DeepSeek
Harness. It does not build an Agent Framework or modify Harness Core.

The current architecture is:

```text
Harness Runtime
└── ResearchHub
    ├── dsh/                  system control plane
    │   └── ResearchManager
    └── packages/             composable research modules
        ├── workflows/
        ├── skills/
        ├── plugins/
        ├── artifacts/
        ├── memory/
        └── evaluation/
```

DSH is the default Runtime Orchestrator and system control plane, not a
package-level capability module. Research packages are runtime-neutral and
must not import `dsh/`.

## Boundaries

- **Harness** owns Agent Runtime, Tool Runtime, Session Runtime, Plugin
  loading, Skill loading, and LLM reasoning execution.
- **ResearchManager** is the only ResearchHub DSH. It coordinates requests,
  Workflows, Skills, Plugins, Artifacts, Memory, and Evaluation. It remains a
  lightweight coordinator, not an Agent Planner.
- **Workflow** defines repeatable research SOP steps, dependencies, inputs,
  outputs, Skill order, and verification nodes. Workflow is not a Planner.
- **Skill** defines professional research objectives, analysis frameworks,
  evidence requirements, output formats, evaluation criteria, and Artifact
  generation. Skill is not a Workflow and does not own runtime or data access.
- **Plugin** provides external connections, tools, data access, conversion,
  and validation. Plugin is not a Skill and does not contain research methods.
- **Memory** preserves Research Session, Evidence, Thesis, Prediction, and
  Review history. It is not an autonomous memory agent.
- **Evaluation** validates predictions and reviews research quality. It does
  not automatically optimize strategies or modify Skills.

The dependency direction is `dsh/` → Workflows, Skills, Plugins, Artifacts,
Memory, and Evaluation. No module under `packages/` is a planning center, and
no package imports the DSH.

Artifact core models remain stable. Existing Event Analysis, Company Research,
and Industry Research Skills and their Workflows remain within these
boundaries.

## Deprecated architecture

Capability Layer, Provider Layer, Research Planner Layer, Workflow Composition
Layer, Workflow Engine, and Multi-Agent architecture are not independent
ResearchHub layers. Harness Tools/Plugins and the existing ResearchManager
plus Workflow definitions provide the required boundaries.

See [Architecture v0.3](../architecture/RESEARCHHUB_ARCHITECTURE_V0.3.md) and
[ADR-010](../architecture/ADR-010-ARCHITECTURE-SIMPLIFICATION.md) and
[ADR-011](../architecture/ADR-011-DSH-CONTROL-PLANE-LOCATION.md).
