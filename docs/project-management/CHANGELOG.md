# Changelog

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
