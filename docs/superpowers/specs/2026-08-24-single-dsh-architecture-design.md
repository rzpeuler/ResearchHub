# ResearchHub Single DSH Architecture Migration Design

## Objective

ResearchHub will use one architecture model:

```text
DSH (ResearchManager)
  -> Workflow
      -> Skill
          -> Plugin
```

`DSH` is the only planning and coordination center. `Workflow` is a
declarative research process template. `Skill` owns research methodology and
Artifact generation. `Plugin` owns external resource access, API integration,
source-specific conversion, and connection metadata.

The migration removes the former DSH, Plugin, and Plugin concepts as
first-class ResearchHub architecture layers. Artifact core models and verified
Skill business behavior remain unchanged.

## Package migration

- `packages/dsh/research-manager/` moves to `packages/dsh/`.
  `ResearchManager` keeps its public class name and remains the DSH coordinator.
  Harness registration moves with it and is named using DSH terminology.
- `packages/plugins/` moves to `packages/plugins/`. Plugin contracts,
  registries, handles, errors, adapters, and compositions are renamed to the
  equivalent Plugin terminology.
- `packages/plugins/` is removed. Its reusable validation and external
  data delegation code is split into the matching Plugin packages; Harness
  registration helpers that belong to coordination move under `packages/dsh/`.
- `packages/workflows/`, `packages/skills/`, `packages/artifacts/`,
  `packages/memory/`, and `packages/evaluation/` remain as supporting modules,
  with imports updated to the new DSH/Plugin boundaries.

No compatibility directories or re-export shims are retained for the removed
top-level packages. Existing behavior and test intent are preserved through
the new paths.

## Responsibility boundaries

### DSH / ResearchManager

ResearchManager understands the research request, chooses a registered
Workflow, invokes the selected Skill and its injected Plugins, coordinates
execution, and assembles the existing Artifact references into the result.
It does not own external source protocol code or research methodology.

### Workflow

Workflow definitions declare standard research steps, inputs, outputs,
dependencies, and validation nodes. Workflow is not a Planner and does not
implement a general-purpose Workflow Engine or autonomous DSH loop.

### Skill

Skills contain domain research methods, analysis frameworks, quality rules,
and Artifact creation logic. A Skill is not a Workflow and does not own
cross-step orchestration or external source selection.

### Plugin

Plugins connect to external resources, APIs, bridges, or persistence services;
normalize source-specific responses; and expose typed data to DSH/Skills. A
Plugin is not a Skill and does not plan research, select workflows, or make
research conclusions.

## Migration and validation

The implementation will update source files, tests, package scripts, and
documentation in one repository migration. The following checks are required:

1. TypeScript compilation succeeds.
2. Full `npm test` succeeds, including Workflow and integration tests.
3. No source import references the removed `packages/dsh`,
   `packages/plugins`, or `packages/plugins` paths.
4. Architecture documentation consistently describes DSH + Workflow + Skill +
   Plugin and does not present DSH, Plugin, or Plugin as a ResearchHub
   architecture layer.
5. Artifact core files and verified Skill business logic remain behaviorally
   unchanged except for import-path updates.

## ADR

The migration will add `ADR-001 Single DSH Architecture` to record the
decision, rejected alternatives, and the compatibility boundary.
