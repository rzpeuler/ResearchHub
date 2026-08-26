# Project Architecture

ResearchHub is financial research knowledge infrastructure running on DeepSeek
Harness. It does not implement an Agent Framework. The runtime remains a
Single DSH architecture, while Knowledge is split between source-owned
infrastructure and independent Runtime Data.

## Source repository

```text
ResearchHub/
├── dsh/                         system control plane
├── packages/                    reusable runtime-neutral research assets
│   ├── workflows/               research SOPs
│   ├── skills/                  professional research methods
│   ├── plugins/                 external data and tools
│   ├── artifacts/               compatibility output/provenance code
│   ├── memory/                  compatibility API
│   ├── evaluation/              compatibility review API
│   ├── schemas/                 public contracts
│   └── shared/                  runtime-neutral utilities
├── research-output/             reports, objects, and provenance
├── examples/
│   └── knowledge-bases/         example Knowledge Base instances
├── tests/
└── docs/
```

The tree above expresses source architecture. It does not create runtime data
directories or imply that a user Knowledge Base belongs in the repository.

## Runtime Data

```text
<ResearchHub Data Root>/
└── knowledge-bases/
    ├── <kb-id>/
    └── ...
```

Each Knowledge Base is independently mutable, versioned, mountable, and
scoped by an explicit `KnowledgeBaseHandle`. The repository-root `knowledge/`
directory is not the current production user Knowledge boundary. Existing
repository Knowledge assets remain historical or example implementation state
until a later migration task reclassifies or moves them.

## Responsibility boundaries

- **Harness** owns Agent Runtime, Tool Runtime, Session Runtime, loading, and
  LLM reasoning. ResearchHub does not modify Harness Core.
- **DSH / ResearchManager** is the only ResearchHub coordination center. It
  understands requests, selects Workflows, invokes Skills and Plugins, and
  integrates results. It is not an Agent Planner.
- **Workflow** defines repeatable research SOP steps, dependencies, inputs,
  outputs, verification, and Knowledge ingestion/update orchestration. It is
  not a Planner or Workflow Engine.
- **Skill** defines professional research methods and Skill-owned output. The
  Knowledge Curation Skill may use explicitly invoked reasoning, but does not
  persist Knowledge directly.
- **Plugin** provides external connections, tools, conversion, and
  validation. It is not a Skill or research method.
- **Research Output** publishes reports, structured Research Objects, and
  provenance.
- **Knowledge Infrastructure** provides Knowledge schemas, loaders/adapters,
  validation, curation, write interfaces, schema migration, and deterministic
  access to independent Knowledge Bases.
- **Knowledge Base Runtime Data** contains user-owned Knowledge, raw reports,
  sources, revisions, and ingestion logs. A Knowledge Base is not an Agent.

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

Existing Skill output formats and Artifact core models remain compatibility
contracts.

## Compatibility modules

`packages/artifacts/`, `packages/memory/`, and `packages/evaluation/` remain to
preserve validated imports and tests. They are not new independent
architecture layers. New durable Knowledge belongs to explicitly scoped
Knowledge Base Runtime Data, not a compatibility Memory store.

## Dependency direction

```text
Harness -> dsh/ -> packages/ -> Research Output contracts
                         -> Knowledge interfaces
                         -> KnowledgeBaseHandle -> Runtime Knowledge Base
```

Packages remain runtime-neutral and must not import `dsh/`. Knowledge
interfaces remain usable by another runtime caller.

## Current Knowledge architecture

The normative architecture is [Knowledge Architecture
v0.2](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.2.md), supported by
the [Knowledge Base Instance Architecture
v0.1](../architecture/RESEARCHHUB_KNOWLEDGE_BASE_INSTANCE_ARCHITECTURE_V0.1.md),
Storage Layout v0.2, Schema Versioning and Migration, Data Schema v0.2,
Access/Validation/Curation contracts, Ingestion Workflow, Write Interface,
Frontend Projection v0.2, and [ADR-015](../architecture/ADR-015-KNOWLEDGE-BASE-INSTANCE-AND-RUNTIME-DATA-SEPARATION.md).

The v0.1 Knowledge documents remain historical semantic and implementation
records. No Research Artifact Layer, Knowledge Database, Graph Database, RAG,
LLM Extraction, autonomous Knowledge update engine, Knowledge Agent, Planner,
Workflow Engine, or automatic semantic migration is current architecture.

See the [Knowledge Architecture Freeze
Index](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_FREEZE_INDEX_2026-08-26.md)
for the complete frozen document set.

## Deprecated architecture

Capability Layer, Provider Layer, Agent Planner, Workflow Composition Layer,
Workflow Engine, Multi-Agent architecture, standalone Memory Layer, and
standalone Evaluation Layer are not current ResearchHub architecture layers.
Historical documents remain in the repository as records and are marked as
historical or superseded where terminology would otherwise be ambiguous.
