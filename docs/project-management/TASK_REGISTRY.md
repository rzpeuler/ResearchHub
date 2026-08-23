# Task Registry

This file is the lightweight task database for ResearchHub. Every independently executable, reviewable or acceptable engineering task receives one stable Task ID.

## Status Definitions

- **Planned** — registered but not started
- **In Progress** — actively being executed
- **Review** — implementation complete and awaiting review or acceptance
- **Completed** — implementation and required validation complete
- **Blocked** — a concrete blocker prevents continuation

## Task List

| Task ID | Task Name | Status | Priority | Created | Assignee | Commit Hash | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RH-GOV-001 | Initialize project execution state management system | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-DOC-002 | Synchronize architecture baseline documentation | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-ENG-001 | Validate minimum ResearchHub Harness integration | Completed | P0 | 2026-08-23 | Luna | This task commit | Accepted — typecheck and integration test passed |
| RH-ENG-002 | Add financial capability foundation and Market Capability MVP | Completed | P0 | 2026-08-23 | Luna | This task commit | Accepted — capability, provider and integration tests passed |
| RH-DESIGN-001 | Add Research Artifact Framework foundation | Completed | P0 | 2026-08-23 | Luna | This task commit | Accepted — type, validation, serialization and relationship tests passed |
| RH-ENG-003A | Add Event Analysis Skill Framework MVP | Completed | P0 | 2026-08-23 | Luna | This task commit | Accepted — Skill, Capability, Artifact and Session integration tests passed |

## RH-ENG-001 Acceptance Scope

- DeepSeek Harness `0.1.1-rc.2` dependency versions are pinned.
- `tests/integration/` contains validation-only code, not production implementation.
- The live validation path covers Runtime → Extension → Agent → Skill → Capability → Session persistence.
- No financial business capability, crawler, API, data model or Harness core modification was introduced.

## Registration Rules

- Task IDs are stable, unique and searchable.
- New tasks record name, status, priority, creation date and acceptance criteria.
- Completed tasks record the completing agent, commit hash and acceptance status.
- Blocked tasks record the blocker and the condition required to resume.
