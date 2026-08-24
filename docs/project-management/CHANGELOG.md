# Changelog

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
- Moved coordination code to `packages/dsh`.
- Moved external-resource contracts and adapters to `packages/plugins`.
- Split former domain data operations into Market, News, Financial,
  Announcement, and Media Plugins.
- Renamed Memory persistence connectors to the Plugin terminology.
- Removed obsolete top-level package paths and updated all imports and test
  scripts.
- Updated architecture, project-management, README, and ADR documentation.
- Verified TypeScript, Plugin, Workflow, Skill, Artifact, Memory, Evaluation,
  and Harness integration tests.
