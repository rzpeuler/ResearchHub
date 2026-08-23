# ResearchHub Architecture v0.2 — Single DSH

## 1. Decision

ResearchHub uses one planning and coordination center: `ResearchManager`,
which is the ResearchHub DSH. The only application architecture model is:

```text
DSH + Workflow + Skill + Plugin
```

Supporting modules such as Artifact, Memory, and Evaluation are implementation
services. They are not additional planning layers.

## 2. Responsibilities

### DSH / ResearchManager

The DSH understands the research objective, validates the request, selects a
Workflow, invokes Skills and their injected Plugins, coordinates execution, and
assembles the existing Artifact references into a report view.

The DSH does not contain source-specific HTTP code, vendor parsing, or the
internal methodology of a Skill.

### Workflow

A Workflow is a standard research process template. It declares inputs,
outputs, ordered or dependent steps, required Skills, and verification nodes.
Workflow is not a Planner and is not a general-purpose workflow engine.

### Skill

A Skill owns a professional research method, analytical framework, quality
rules, and Artifact generation logic. A Skill is not a Workflow and does not
own cross-Skill scheduling or source selection.

### Plugin

A Plugin connects to an external API, bridge, file, or persistence service. It
normalizes source-specific data, validates the external boundary, and returns
typed data with traceability metadata. A Plugin is not a Skill and does not
plan research or produce conclusions.

## 3. Runtime flow

```text
Research request
  -> ResearchManager (DSH)
      -> Workflow definition and executor
          -> Skill method
              -> Plugin data access
          -> Artifact validation and generation
      -> Report View over Artifact IDs
```

The Harness supplies the execution and session lifecycle. ResearchHub does not
create a parallel runtime, scheduler, or autonomous coordination subsystem.

## 4. Package layout

```text
packages/
  dsh/          ResearchManager coordination and Harness adapter
  workflows/    Workflow definitions, registry, and thin executors
  skills/       Research methods and Artifact generation
  plugins/      External-resource contracts, registry, and adapters
  artifacts/    Existing Evidence, Thesis, Prediction, and Review models
  memory/       Persistence support
  evaluation/   Prediction evaluation support
```

New functionality must be classified as exactly one of Workflow, Skill, or
Plugin, with DSH coordination changes reviewed as ResearchManager changes.

## 5. Explicit non-goals

- No multiple planning centers.
- No standalone operation layer above Plugin.
- No separate external-source layer outside Plugin.
- No ResearchHub-owned workflow engine or autonomous runtime.
- No changes to the Artifact core model.
