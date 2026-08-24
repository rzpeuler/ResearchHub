# ADR-012: Financial Research Skill Asset Migration

**Status:** Accepted
**Date:** 2026-08-24

## Context

ResearchHub needs reusable financial research methods without becoming a
provider-specific Agent Framework. The source patterns include useful equity,
industry, earnings, comparable-company, and DCF research methods, but their
runtime bindings are outside the ResearchHub Skill Asset Layer.

## Decision

Create four runtime-neutral Skill packages:

- `packages/skills/equity-research/`
- `packages/skills/industry-research/`
- `packages/skills/earnings-review/`
- `packages/skills/valuation/`

Each package owns its research definition, method guidance, typed command,
input/output schemas, report template, and tests. External data is accessed
only through injected Plugin ports.

## Boundaries

- Skill owns methodology, analysis framework, evidence requirements, and structured report generation.
- Plugin owns external data access and source-specific conversion.
- Workflow owns process order and dependencies.
- DSH / ResearchManager owns request coordination and Skill invocation.

Skills must not import DSH, ResearchManager, Claude runtime packages, MCP
runtime packages, slash-command handlers, or provider-specific orchestration.

## Consequences

The migrated assets can be called by the root DSH or another Runtime. The
methodology is preserved as typed, testable research assets, while runtime
coupling and provider-specific automation are deliberately omitted.
