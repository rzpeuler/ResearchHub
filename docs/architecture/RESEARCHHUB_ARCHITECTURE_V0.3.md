# ResearchHub Architecture v0.3 — Architecture Simplification & Governance

> **Historical record — superseded by ARCH-REFACTOR-003.** Current
> architecture is documented in [Research Output Architecture](RESEARCH_OUTPUT_ARCHITECTURE.md)
> and [Knowledge Layer Architecture](KNOWLEDGE_LAYER_ARCHITECTURE.md), with the
> frozen normative definition in
> [Knowledge Architecture v0.1](RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.1.md).

## 1. Decision

ResearchHub is a professional research asset layer that runs on top of the
DeepSeek Harness. ResearchHub does not build an Agent Framework, agent
runtime, tool runtime, session runtime, or autonomous orchestration system.

The architecture is:

```text
DeepSeek Harness Runtime
└── ResearchHub
    ├── ResearchManager (DSH coordination)
    ├── Workflow (research SOP)
    ├── Skill (professional research method)
    ├── Plugin (external resource extension)
    ├── Memory (research history)
    └── Evaluation (research quality review)
```

`ResearchManager` remains the only ResearchHub DSH and keeps its existing
name. It is the default ResearchHub Runtime Orchestrator in `dsh/`: it
coordinates the request, Workflow, Skill, Plugin, Artifact, Memory, and
Evaluation boundaries. Reasoning and lower-level runtime execution remain
Harness responsibilities.

Architecture v0.2 remains preserved as a historical baseline. This v0.3
document is retained as a historical governance reference; it is not the
current design authority for new development.

## 2. Runtime boundary: Harness

DeepSeek Harness owns:

- Agent Runtime;
- Tool Runtime;
- Session Runtime;
- Plugin loading;
- Skill loading;
- model interaction and LLM reasoning execution.

ResearchHub integrates with Harness through its supported extension points. It
does not modify Harness Core, replace Harness runtime services, or create a
parallel Agent Framework, Workflow Engine, Plugin Runtime, or autonomous
memory loop.

## 3. ResearchHub responsibilities

### ResearchManager / DSH

`ResearchManager` is the only decision and coordination center owned by
ResearchHub. It:

- understands the research request at the application boundary;
- coordinates Workflow selection and execution;
- invokes approved Skills and their Plugin ports;
- coordinates Artifact, Memory, and Evaluation interactions;
- assembles the research result.

ResearchManager is intentionally lightweight. It does not replace LLM
reasoning, implement an Agent Planner, define research methodology, or own
external data protocols.

### Workflow

A Workflow is a repeatable research SOP. It defines:

- steps and dependencies;
- Skill invocation order;
- input and output contracts;
- verification nodes.

Workflow is not a Planner, does not implement LLM reasoning, and is not a
general-purpose Workflow Engine. It provides process structure for
ResearchManager to coordinate.

### Skill

A Skill is a professional research method. It defines:

- research objectives;
- an analysis framework;
- evidence requirements;
- output formats;
- evaluation criteria;
- Artifact generation logic.

The current examples are Event Analysis, Company Research, and Industry
Research. A Skill does not schedule other Skills, access a source protocol
directly, or own runtime services.

### Plugin

A Plugin is a Harness-compatible external resource extension. It provides:

- external service connections;
- tool registration;
- data access interfaces;
- source-specific conversion and validation.

Plugin is not a research method, does not contain analytical conclusions, and
does not plan a Workflow. External data, API, file, and persistence adapters
belong here.

### Memory

Memory stores structured research history and supports later research and
review. The retained concepts are:

- Research Session;
- Evidence;
- Thesis;
- Prediction;
- Review.

Memory is a persistence and retrieval boundary, not an autonomous memory
agent or a new reasoning layer. Vector databases, knowledge graphs, and
autonomous memory loops are outside the current architecture.

### Evaluation

Evaluation supports research quality review and method improvement. It
includes:

- Prediction validation;
- Research Review;
- evidence and outcome comparison;
- feedback for future method design.

Evaluation does not automatically optimize strategies or modify Skills. Any
such change requires a separate architecture decision.

### Artifact

Artifact remains the existing core model for Evidence, Thesis, Prediction,
Review, and their relationships. This governance update does not change the
Artifact core model.

## 4. Boundary rules

```text
Harness runtime
    -> ResearchManager coordination
        -> Workflow SOP
            -> Skill research method
                -> Plugin external access
            -> Artifact outputs
        -> Memory persistence
        -> Evaluation review
```

The following distinctions are mandatory:

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Harness | runtime, sessions, loading, LLM execution | ResearchHub methodology |
| ResearchManager | coordination and result integration | Agent infrastructure or LLM reasoning |
| Workflow | SOP steps, dependencies, I/O, verification | research methodology or planning intelligence |
| Skill | professional method, analysis, Artifact generation | scheduling, data protocols, runtime |
| Plugin | external connection, tools, data conversion | research conclusions or methodology |
| Memory | research history persistence and retrieval | autonomous memory reasoning |
| Evaluation | review, validation, method feedback | automatic strategy or Skill mutation |

## 5. Package and documentation layout

```text
ResearchHub/
├── dsh/
│   └── ResearchManager control plane
├── packages/
│   ├── workflows/
│   ├── skills/
│   ├── plugins/
│   ├── artifacts/
│   ├── memory/
│   └── evaluation/
└── docs/
```

DeepSeek Harness is the external runtime below this repository boundary. The
root-level `dsh/` directory contains the ResearchHub DSH Runtime Orchestrator.
The `packages/` directory contains reusable, runtime-neutral research assets:

```text
packages/
  plugins/
  skills/
  workflows/
  memory/
  evaluation/
  artifacts/
```

`dsh/` contains the ResearchManager Harness adapter and coordination service.
It is not a package-level capability module. The package layout is an
implementation detail, but the dependency boundary is intentional:
`dsh/` coordinates the modules under `packages/`, while packages do not
import `dsh/` and do not become planning centers.

## 6. Deprecated architecture

The following are not independent ResearchHub architecture layers and must
not be developed as new modules:

- Capability Layer — Harness Tools and Plugins cover the required extension
  boundary.
- Provider Layer — external data and service connections belong to Plugins.
- Research Planner Layer — research planning is LLM reasoning executed by the
  Harness, coordinated at the application boundary by ResearchManager.
- Workflow Composition Layer — the ResearchManager plus Workflow definitions
  provide the required coordination without a new composition system.
- Multi-Agent architecture — ResearchHub does not build an Agent Framework.

Existing historical documents may describe earlier design stages. New
architecture and governance documents must use the v0.3 boundaries above.

## 7. Governance constraints

New capabilities must be classified as a Workflow, Skill, Plugin, Memory, or
Evaluation change. Cross-cutting coordination changes are reviewed as
ResearchManager changes. No new architecture layer may be introduced without
an ADR that explicitly revises this decision.

The dependency rule is one-way:

```text
dsh/ Runtime Orchestrator
        ↓
packages/ Reusable Research Assets
```

Research packages must remain usable by another Runtime or an external caller
without importing the ResearchHub DSH.

The following remain out of scope:

- modifying Harness Core;
- adding a Capability or Provider layer;
- adding an Agent Planner or multi-Agent system;
- adding a Workflow Engine or Composition Layer;
- changing verified Skill business logic;
- changing the Artifact core model.

## 8. Financial Skill Asset Layer

Financial research methods are packaged as independent, runtime-neutral Skill
assets under `packages/skills/`. The first migrated assets are:

| Skill | Research responsibility | Plugin boundary |
| --- | --- | --- |
| Equity Research | coverage initiation, business quality, competitive advantage, growth, and risk | market, financial, and information ports |
| Industry Research | market sizing, value chain, industry structure, competition, and sector implications | research and peer-metrics ports |
| Earnings Review | actual-versus-consensus, beat/miss, guidance, estimate changes, and thesis impact | earnings snapshot port |
| Valuation | peer statistics, DCF, sensitivity, and valuation cross-checks | peer valuation and optional market-price ports |

These Skills preserve research methodology and structured output without
copying a provider-specific agent runtime. They do not own scheduling, source
protocols, sessions, or LLM reasoning. External data is requested through
typed Plugin ports supplied by the caller. DSH may invoke these commands, but
no Skill imports DSH or ResearchManager.

The migration absorbs method patterns from the public Anthropic financial
research assets while intentionally excluding Claude bindings, slash commands,
MCP runtime assumptions, spreadsheet/document automation, and provider-specific
orchestration.
