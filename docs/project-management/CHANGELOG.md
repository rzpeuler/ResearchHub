# Changelog

## 2026-08-24 — End-to-End Research Pipeline Validation

- Added `PIPELINE-VALIDATION-001` integration coverage for the minimum Company
  Equity Research demo.
- Verified the complete DSH → Workflow → Skill → Plugin → Artifact → Evaluation
  path with deterministic Market, News, and Financial Plugin fixtures.
- Verified natural-language request propagation, Workflow dependencies, linked
  Evidence/Thesis/Prediction Artifacts, serialization round trips, and a
  successful Evaluation Review.

## 2026-08-24 — Financial Research Skill Asset Migration

- Added runtime-neutral `equity-research`, `industry-research`,
  `earnings-review`, and `valuation` Skill packages.
- Added typed Plugin ports, YAML definitions, input/output schemas, report
  templates, command tests, and a root-DSH invocation smoke test.
- Preserved financial research methodology while excluding Claude bindings,
  slash commands, MCP runtime dependencies, and provider-specific orchestration.

## 2026-08-24 — Runtime and Research Asset Decoupling

- Moved the shared Workflow execution contract to
  `packages/workflows/execution.ts`.
- Removed the `packages/workflows` → `dsh` dependency.
- Confirmed `dsh/` as the default Runtime Orchestrator and `packages/` as
  reusable, runtime-neutral research assets.
- Documented the one-way dependency rule: `dsh/` → `packages/`.

## 2026-08-24 — DSH Control Plane Relocation

- Moved `ResearchManager` from `packages/dsh` to the repository root `dsh/`.
- Reserved `packages/` for composable Workflow, Skill, Plugin, Artifact,
  Memory, and Evaluation modules.
- Updated TypeScript inclusion, test scripts, imports, integration paths, and
  architecture governance references.
- Added ADR-011 for the DSH Control Plane Location Decision.
- Preserved ResearchManager, Workflow, Skill, Plugin, Artifact, Memory, and
  Evaluation behavior.

## 2026-08-24 — Architecture Simplification & Governance Update

- Adopted Architecture v0.3 as the current governance reference.
- Confirmed ResearchHub is a professional research asset layer on DeepSeek
  Harness, not a general-purpose Agent Framework.
- Confirmed Harness ownership of Agent, Tool, Session, loading, and LLM runtime
  services.
- Clarified the boundaries of ResearchManager, Workflow, Skill, Plugin,
  Memory, and Evaluation.
- Deprecated Capability, Provider, Research Planner, Workflow Composition,
  Workflow Engine, and Multi-Agent architecture as independent layers.
- Added ADR-010 and moved the project phase to Research Intelligence Layer.
- Preserved Architecture v0.2, Artifact core models, verified Skills, and
  existing Workflow, Memory, and Evaluation behavior.

## 2026-08-24 — Single DSH Architecture

- Adopted `ResearchManager` as the only DSH planning and coordination center.
- Established the DSH coordination boundary for ResearchManager.
- Moved external-resource contracts and adapters to `packages/plugins`.
- Split former domain data operations into Market, News, Financial,
  Announcement, and Media Plugins.
- Renamed Memory persistence connectors to the Plugin terminology.
- Removed obsolete top-level package paths and updated all imports and test
  scripts.
- Updated architecture, project-management, README, and ADR documentation.
- Verified TypeScript, Plugin, Workflow, Skill, Artifact, Memory, Evaluation,
  and Harness integration tests.
