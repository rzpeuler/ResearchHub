# Project Architecture

ResearchHub is financial research knowledge infrastructure running on DeepSeek
Harness. It does not implement an Agent Framework. The runtime remains a
Single DSH architecture, while Knowledge is split between source-owned
infrastructure and independent Runtime Data.

## Source repository

```text
ResearchHub/
|- dsh/                         system control plane
|- packages/                    reusable runtime-neutral research assets
|  |- workflows/               research SOPs
|  |- skills/                  professional research methods
|  |- plugins/                 external data and tools
|  |- artifacts/               output, review, outcome, and provenance code
|  |- schemas/                 public contracts
|  `- shared/                  runtime-neutral utilities
|- research-output/             reports, objects, and provenance
|- examples/
|  `- knowledge-bases/         example Knowledge Base instances
|- tests/
`- docs/
```

The tree above expresses source architecture. It does not create runtime data
directories or imply that a user Knowledge Base belongs in the repository.

## Runtime Data

```text
<ResearchHub Data Root>/
`- knowledge-bases/
   |- <kb-id>/
   `- ...
```

Each Knowledge Base is independently mutable, versioned, mountable, and
scoped by an explicit `KnowledgeBaseHandle`. The repository-root `knowledge/`
directory is not the current production user Knowledge boundary and no longer
exists as the current dataset. The Git-managed AI Hardware Example Knowledge
Base is under `examples/knowledge-bases/ai-hardware/`.

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

## Compatibility boundaries

`packages/artifacts/` contains the remaining compatibility output, Review,
Outcome, and provenance contracts. The standalone Memory and Evaluation
packages have been retired and no longer exist in the current source tree.
New durable Knowledge belongs to explicitly scoped Knowledge Base Runtime Data,
not a compatibility Memory store.

## Dependency direction

```text
Harness -> dsh/ -> packages/ -> Research Output contracts
                         -> Knowledge interfaces
                         -> KnowledgeBaseHandle -> Runtime Knowledge Base
```

Packages remain runtime-neutral and must not import `dsh/`. Knowledge
interfaces remain usable by another runtime caller.

## Current Knowledge architecture

The current normative Knowledge architecture is [Knowledge Architecture
v0.3](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md), frozen and
accepted by Sol/CTO against commit
`47e312f79a221d7dd45b42508e52526fd61b1a74`. Its target semantic contract is
Schema 0.3 / Storage Format 1, supported by the [Data Schema
v0.3](../architecture/KNOWLEDGE_DATA_SCHEMA_V0.3.md), [Curation Skill
v0.3](../architecture/KNOWLEDGE_CURATION_SKILL_V0.3.md), [Research Report
Ingestion Workflow v0.3](../architecture/RESEARCH_REPORT_INGESTION_WORKFLOW_V0.3.md),
[Schema Migration v0.2 to v0.3](../architecture/KNOWLEDGE_SCHEMA_MIGRATION_0.2_TO_0.3.md),
and [Frontend Projection v0.3](../architecture/KNOWLEDGE_FRONTEND_PROJECTION_V0.3.md).

The v0.2 Knowledge architecture and its supporting documents remain frozen
legacy compatibility and migration sources. Current runtime implementation is
still predominantly v0.2; migration to the v0.3 target has not started. The
next approved engineering direction is Stage A - Executable Schema / Domain
Model, but Stage A is not part of this governance integration task.

See the [Knowledge Architecture Freeze
Index](../architecture/RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_FREEZE_INDEX_2026-08-26.md)
for the complete current and legacy document sets. No Research Artifact Layer,
Knowledge Database, Graph Database, RAG, LLM Extraction, autonomous Knowledge
update engine, Knowledge Agent, Planner, Workflow Engine, or automatic semantic
migration is current architecture.

## Deprecated architecture

Capability Layer, Provider Layer, Agent Planner, Workflow Composition Layer,
Workflow Engine, Multi-Agent architecture, standalone Memory Layer, and
standalone Evaluation Layer are not current ResearchHub architecture layers.
The standalone Memory and Evaluation compatibility modules are retired. Their
active responsibilities belong to Artifact Review/Outcome contracts and
Knowledge Base Runtime Data. Historical documents remain in the repository as
records and are marked as historical or superseded where terminology would
otherwise be ambiguous.
