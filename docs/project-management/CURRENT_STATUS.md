# Current Status

## Architecture

The Single DSH migration is implemented and the architecture is now governed
by Architecture v0.3. ResearchHub is a professional research asset layer on
DeepSeek Harness, not an Agent Framework. The root-level `dsh/` directory
contains the lightweight ResearchManager Runtime Orchestrator. `packages/workflows`
contains runtime-neutral research SOP templates, `packages/skills` contains
research methods, and `packages/plugins` contains external-resource contracts
and adapters.

The `packages/` directory contains only composable research modules;
`packages/dsh` does not exist.

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

The dependency direction is `dsh/` → `packages/`. Packages do not import DSH
types or implementation details, so the research assets can be reused by
another Runtime or external caller.

## Completed validation

- TypeScript compilation passes.
- Plugin registry and adapter tests pass.
- Workflow and ResearchManager tests pass.
- Artifact, Memory, Evaluation, Skill, and Harness integration tests pass.
- No source imports the removed package paths.
- Architecture v0.3, ADR-010, and ADR-011 define the current governance
  boundaries.

## Known constraints

Real external data activation still depends on credentials, source licensing,
bridge availability, rate limits, and data-quality review. Fixture tests remain
network-free and deterministic.

The financial Skill Asset Layer now includes runtime-neutral Equity Research,
Industry Research, Earnings Review, and Valuation packages. Each package has
its own definition, command implementation, schemas, report template, and
deterministic tests. The commands consume only injected Plugin ports, so they
can be called by DSH or another Runtime.

The root DSH financial-skill invocation smoke test also passes.

Pipeline validation is complete for the minimum Company Equity Research demo.
The validated path is:

`Research request → ResearchManager → Company Research Workflow → Company Research Skill → Market/News/Financial Plugins → Evidence/Thesis/Prediction Artifacts → Evaluation Review`

The integration fixture uses a public-company A-share example (`600519`) and
verifies Plugin call order, Workflow step dependencies, natural-language
question propagation, Artifact serialization round trips, and a successful
Evaluation result.

The formal `Equity Research Workflow` is now implemented under
`packages/workflows/equity-research/`. It composes Company Research, Industry
Research, Equity Research, Earnings Review, and Valuation through injected
Skill Adapters, exposes six step states, and returns a linked Evidence,
Thesis, Prediction, and ResearchReport bundle. The Workflow has no DSH or
Plugin implementation dependency.
