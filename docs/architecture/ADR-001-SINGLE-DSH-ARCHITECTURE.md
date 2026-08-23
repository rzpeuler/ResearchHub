# ADR-001: Single DSH Architecture

## Status

Accepted — 2026-08-24

## Context

ResearchHub had several overlapping coordination and data-access abstractions.
That made it unclear whether planning belonged to the request coordinator,
the process definition, the research method, or the data connector.

## Decision

ResearchHub uses one DSH, implemented by `ResearchManager`, plus three
supporting categories:

- Workflow: standard research process template.
- Skill: professional research method and Artifact generation.
- Plugin: external resource connection and data conversion.

The DSH understands the research objective, selects a Workflow, calls Skills
and Plugins, and integrates the result. Workflow, Skill, and Plugin do not
replace one another.

## Consequences

- New functionality has one clear classification.
- Source adapters no longer look like research planners.
- Skills remain reusable and testable without network access.
- Removed package paths are not retained as compatibility shells.
- Existing Artifact models and verified business behavior remain stable.

## Guardrails

ResearchHub will not add multiple planning centers, a parallel workflow engine,
or autonomous cross-process coordination. Harness runtime services remain the
execution boundary.
