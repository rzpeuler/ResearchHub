# Research Workflow Design

## Purpose

A Workflow is a reusable research process template. It makes the process
explicit and verifiable without becoming a Planner or a general workflow
engine.

## Definition

A Workflow declares its stable ID and version, input and output schemas, steps,
dependencies, required Skills, and verification nodes. Definitions are
registered in `WorkflowRegistry`, which rejects duplicate IDs, missing
dependencies, and malformed schemas.

## Execution boundary

ResearchManager selects a Workflow from the registry and invokes an approved
thin executor. The executor calls the relevant Skill method and returns an
Artifact bundle. The Harness supplies the runtime lifecycle and session
persistence; ResearchHub does not add another scheduler or autonomous loop.

## Relationship to other layers

```text
ResearchManager (DSH) -> Workflow -> Skill -> Plugin
```

Workflow is not Skill: Workflow owns process structure, while Skill owns
research methodology. Workflow is not DSH: DSH owns request understanding and
selection. Plugin is not Skill: Plugin owns external data access, while Skill
owns analysis and Artifact generation.
