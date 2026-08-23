# Current Status

## Architecture

The Single DSH migration is implemented. `packages/dsh` contains the
ResearchManager coordinator, `packages/workflows` contains process templates,
`packages/skills` contains research methods, and `packages/plugins` contains
external-resource contracts and adapters.

The removed top-level directories are not retained. Artifact core models and
verified Skill behavior were preserved through import and contract migration.

## Completed validation

- TypeScript compilation passes.
- Plugin registry and adapter tests pass.
- Workflow and ResearchManager tests pass.
- Artifact, Memory, Evaluation, Skill, and Harness integration tests pass.
- No source imports the removed package paths.

## Known constraints

Real external data activation still depends on credentials, source licensing,
bridge availability, rate limits, and data-quality review. Fixture tests remain
network-free and deterministic.
