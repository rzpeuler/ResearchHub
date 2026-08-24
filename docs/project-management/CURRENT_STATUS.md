# Current Status

## Architecture

The Single DSH migration is implemented and the architecture is now governed
by Architecture v0.3. ResearchHub is a professional research asset layer on
DeepSeek Harness, not an Agent Framework. `packages/dsh` contains the
lightweight ResearchManager coordinator, `packages/workflows` contains
research SOP templates, `packages/skills` contains research methods, and
`packages/plugins` contains external-resource contracts and adapters.

The removed top-level directories are not retained. Artifact core models and
verified Skill behavior were preserved through import and contract migration.

The current development phase is **Research Intelligence Layer**. The
validated foundation includes:

- Harness integration and runtime boundary validation;
- Event Analysis, Company Research, and Industry Research Skills;
- Workflow definitions and thin executors;
- Memory persistence for structured research history;
- Evaluation and research review support.

Harness owns runtime execution and LLM reasoning. ResearchManager coordinates
these assets without becoming an Agent Planner.

## Completed validation

- TypeScript compilation passes.
- Plugin registry and adapter tests pass.
- Workflow and ResearchManager tests pass.
- Artifact, Memory, Evaluation, Skill, and Harness integration tests pass.
- No source imports the removed package paths.
- Architecture v0.3 and ADR-010 define the current governance boundaries.

## Known constraints

Real external data activation still depends on credentials, source licensing,
bridge availability, rate limits, and data-quality review. Fixture tests remain
network-free and deterministic.
