# ResearchHub Architecture v0.3 — Architecture Simplification & Governance

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
name. It coordinates the request, Workflow, Skill, Plugin, Artifact, Memory,
and Evaluation boundaries. Reasoning and runtime execution remain Harness
responsibilities.

Architecture v0.2 remains preserved as a historical baseline. This v0.3
document is the current governance reference for new design and development.

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
harness/
  DeepSeek Harness Runtime

researchhub/
  plugins/
  skills/
  workflows/
  memory/
  evaluation/

docs/
```

In the current repository, the ResearchHub packages are under `packages/`:

```text
packages/
  dsh/
  plugins/
  skills/
  workflows/
  memory/
  evaluation/
  artifacts/
```

`dsh/` contains the ResearchManager Harness adapter and coordination service.
The package layout is an implementation detail; the architecture boundary is
defined by responsibility, not by adding more top-level layers.

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

The following remain out of scope:

- modifying Harness Core;
- adding a Capability or Provider layer;
- adding an Agent Planner or multi-Agent system;
- adding a Workflow Engine or Composition Layer;
- changing verified Skill business logic;
- changing the Artifact core model.
