# ADR-011: DSH Control Plane Location

## Status

Accepted — 2026-08-24

## Context

ResearchHub uses a Single DSH Architecture. `ResearchManager` is the only
ResearchHub DSH and coordinates Workflows, Skills, Plugins, Artifacts,
Memory, and Evaluation. The previous repository layout placed this control
plane at `packages/dsh`, beside composable research modules.

That location incorrectly suggested that DSH was another capability package.
It obscured the distinction between the system control plane and the research
assets that the control plane coordinates.

## Decision

Move the ResearchHub DSH from `packages/dsh` to the repository root:

```text
ResearchHub/
├── dsh/
│   └── ResearchManager
└── packages/
    ├── workflows/
    ├── skills/
    ├── plugins/
    ├── artifacts/
    ├── memory/
    └── evaluation/
```

The root-level `dsh/` directory is the ResearchHub system control plane. The
`packages/` directory is reserved for composable research capability modules.

The dependency direction is:

```text
dsh
 ├── workflows
 ├── skills
 ├── plugins
 ├── artifacts
 ├── memory
 └── evaluation
```

This is a location and architecture-expression decision. It does not change
ResearchManager business logic, Workflow logic, Skill logic, Plugin logic,
Artifact models, Memory models, or Evaluation behavior.

## Consequences

- The repository structure directly expresses the Single DSH Architecture.
- `packages/` contains only composable research modules.
- ResearchManager remains the only coordination center.
- Imports, TypeScript inclusion, test scripts, and documentation must refer to
  root-level `dsh/`.
- No `packages/dsh` compatibility directory is retained.

## Guardrails

Future changes must not add an agent layer, planner layer, Capability Layer,
Provider Layer, Workflow Engine, or another DSH under `packages/`. New
cross-module coordination belongs in the root `dsh/` control plane and must
preserve the Harness runtime boundary.
