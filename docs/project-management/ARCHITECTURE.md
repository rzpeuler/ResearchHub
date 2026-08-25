# Project Architecture

ResearchHub is financial research knowledge infrastructure running on DeepSeek
Harness. It does not implement an Agent Framework. The runtime remains a
Single DSH architecture and the product boundary is now Research Output plus
Knowledge Infrastructure.

```text
Harness Runtime
└── ResearchHub
    ├── dsh/                         system control plane
    │   └── ResearchManager
    ├── packages/                   reusable research assets
    │   ├── workflows/               research SOPs
    │   ├── skills/                  professional research methods
    │   ├── plugins/                 external data and tools
    │   ├── artifacts/               compatibility output/provenance code
    │   ├── schemas/                 Research Object contracts
    │   └── shared/                  runtime-neutral utilities
    ├── research-output/
    │   ├── reports/                 user-readable reports
    │   ├── objects/                 machine-readable Research Objects
    │   └── provenance/              output source relationships
    └── knowledge/                   top-level durable Knowledge asset boundary
```

## Responsibility boundaries

- **Harness** owns Agent Runtime, Tool Runtime, Session Runtime, plugin and
  skill loading, and LLM reasoning execution. ResearchHub does not modify
  Harness Core.
- **DSH / ResearchManager** is the only ResearchHub coordination center. It
  understands research requests, selects Workflows, invokes Skills and
  Plugins, and integrates results. It is not an Agent Planner.
- **Workflow** defines repeatable research SOP steps, dependencies, inputs,
  outputs, and verification nodes. Workflow is not a Planner or Workflow
  Engine.
- **Skill** defines professional research methods and Skill-owned output
  payloads. Skill is not a Workflow, runtime, or data-access layer.
- **Plugin** provides external connections, tools, data access, conversion,
  and validation. Plugin is not a Skill and contains no research method.
- **Research Output** publishes reports, structured Research Objects, and
  provenance.
- **Research Object** is the preferred business term for a machine-readable
  research result. Existing Artifact models remain as compatibility code.
- **Knowledge Layer** is the frozen top-level durable boundary for reusable
  industry intelligence. It is not under `packages/`; Workflow owns its update
  lifecycle and the Knowledge Skill provides its access interface.

## Research Object contract

New public structured objects use the runtime-neutral envelope in
`packages/schemas/research-object.ts`:

```ts
interface ResearchObjectEnvelope<TPayload> {
  objectId: string
  objectType: string
  createdAt: string
  sourceWorkflow: string
  sourceSkill: string
  version: number
  payload: TPayload
}
```

Existing Skill output formats and Artifact core models are not modified by
this migration.

## Compatibility modules

`packages/artifacts/`, `packages/memory/`, and `packages/evaluation/` remain
to preserve validated imports and tests. They are not new independent
architecture layers:

- Artifact is a technical compatibility term; its trace is now Research
  Output Provenance.
- Memory is a legacy compatibility API; new durable knowledge belongs under
  `knowledge/`.
- Evaluation is a legacy review compatibility API; ResearchHub does not build
  an investment prediction evaluation or autonomous learning product.

The compatibility modules must not introduce DSH dependencies or runtime
state.

## Dependency direction

```text
dsh/ -> packages/ -> research-output/ / knowledge/ contracts
```

Packages remain runtime-neutral and must not import `dsh/`. Research Output
and Knowledge interfaces must also remain usable by other runtime callers.

Knowledge content may represent facts, forecasts, viewpoints, trends, and
risks; its concrete subdirectory layout is not frozen by v0.1. No Research
Artifact Layer, Knowledge Database, Graph Database, RAG, LLM Extraction, or
autonomous Knowledge update engine is part of v0.1.

## Deprecated architecture

Capability Layer, Provider Layer, Agent Planner, Workflow Composition Layer,
Workflow Engine, Multi-Agent architecture, standalone Memory Layer, and
standalone Evaluation Layer are not current ResearchHub architecture layers.
Historical documents remain in the repository only as records and are marked
as superseded where their terminology would otherwise be ambiguous.

See [Research Output Architecture](../architecture/RESEARCH_OUTPUT_ARCHITECTURE.md),
[Knowledge Layer Architecture](../architecture/KNOWLEDGE_LAYER_ARCHITECTURE.md),
[Knowledge Architecture v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md),
and [ADR-014](../architecture/ADR-014-RESEARCH-OUTPUT-KNOWLEDGE-ARCHITECTURE.md).
