# Direct Codex Ownership and Legacy Orchestration Cleanup

## Status

Proposed design for user review. This document authorizes neither deletion nor implementation until the written design is reviewed and accepted.

## Goal

Make ResearchHub a directly managed project: Codex owns task interpretation, planning, implementation, testing, review, commit, and repository synchronization. Remove repository assets whose purpose was to support the former Sol/Web-Chat2Codex/W2C/Luna task-handoff workflow while preserving the ResearchHub product and its original architecture.

## Ownership model

- Codex is the sole repository engineering owner.
- Pi Coding Agent remains the product application host where the product architecture requires it.
- Workflow, Skill, Plugin, Knowledge, and Application Runtime remain product architecture boundaries.
- Sol, Web-Chat2Codex/W2C, Luna task books, Writing Blocks, protocol templates, and external task-handoff governance are not repository control-plane concepts.
- Product references to a model, provider, Pi capability, or Codex CLI remain valid when they are part of the application itself rather than task transport or external orchestration.

## Scope classification

Files are classified by purpose and dependency role, not by filename or by isolated words such as `Codex`, `Pi`, or `Luna`.

### Remove

1. The tracked `.web-chat2codex/**` backup and reconciliation material.
2. The old `docs/governance/**` registry, role documents, workflow rules, Git protocol rules, and Writing Block templates.
3. Tests, fixtures, evidence, and scripts whose primary purpose is to validate Sol/W2C/Luna task transport, Writing Block parsing, protocol lifecycle, external handoff state, or old orchestration-specific acceptance.
4. Task reports and evidence files that document only that legacy orchestration protocol rather than ResearchHub product behavior or architecture.

### Rewrite

- `README.md` will describe the product, its original architecture, supported runtime, and direct Codex ownership without referring to an active governance registry, Sol/Luna role separation, W2C transport, Writing Blocks, or task-book handoff.
- `AGENTS.md` will become concise repository guidance for direct Codex ownership. It will retain technical architecture constraints and protected product boundaries, but will not require an external governance manifest or role handoff.

### Preserve

- `docs/architecture/**` and architecture documents that define ResearchHub's original product goals.
- Product implementation under `app/`, `knowledge/`, `workflows/`, `skills/`, `plugins/`, and the client.
- Product tests and regression fixtures for Knowledge integrity, Workflow behavior, Application Runtime, Pi integration, research capabilities, and supported provider integrations.
- Build, run, document-parser, scheduler, and other scripts that are used by the product itself.
- Runtime data, package manifests, lockfiles, and repository history.

`plugins/reasoning/codex-cli` and related tests will be preserved unless dependency and call-site analysis proves that a file exists only for the removed task-handoff protocol. A provider/model integration is not legacy merely because its name contains Codex or Luna.

## Deletion decision procedure

For every candidate outside the explicitly removable legacy directories:

1. Identify its imports, package-script references, runtime call sites, and test discovery role.
2. Determine whether its observable purpose is product behavior or external task orchestration.
3. Remove only protocol-only assets.
4. If a file has mixed responsibilities, split or rewrite it only when the product behavior can be retained without the legacy protocol; otherwise preserve it and report the ambiguity.
5. Re-scan both paths and content after cleanup. No deletion will be based only on a broad extension match or a single keyword.

## Safety boundaries

- Do not delete all `tests/` or all `scripts/`.
- Do not delete product architecture because its acceptance was historically performed by Luna.
- Do not change Knowledge schema, canonical mutation rules, Workflow semantics, Pi product behavior, or Application Runtime contracts as part of this cleanup.
- Do not add a replacement task protocol or recreate the old governance under a different name.
- Do not rewrite Git history or force-push. The cleanup is a normal commit on `main`.

## Validation and acceptance

The implementation is complete only when:

- `.web-chat2codex/**` and the old governance registry/templates are absent from the working tree.
- `README.md` and `AGENTS.md` contain no legacy task-handoff instructions.
- Remaining legacy references are either absent or demonstrably part of retained product behavior and are recorded in the implementation report.
- Product package scripts resolve to existing files.
- TypeScript, client type checking/build, and the retained product test suite pass, with any removed protocol-only test count explicitly reported.
- `git diff --check` passes for newly edited files.
- The final commit contains only the approved cleanup scope and is reviewed before synchronization.

## Non-goals

This design does not redesign ResearchHub, replace Pi, remove the Knowledge architecture, simplify the product into architecture documents only, or change the meaning of Free Research, Knowledge Query, Knowledge Production, Review, or canonical persistence.
