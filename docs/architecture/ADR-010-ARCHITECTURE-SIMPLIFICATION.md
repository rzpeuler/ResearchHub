# ADR-010: Architecture Simplification

> **Historical decision — partially superseded by ARCH-REFACTOR-003.** The
> Single DSH, Workflow, Skill, and Plugin decisions remain valid. Memory and
> Evaluation are now compatibility implementations, while current product
> architecture is Research Output plus Knowledge Infrastructure.

## Status

Accepted — 2026-08-24

## Context

ResearchHub has validated Harness integration, Event Analysis, Company
Research, Industry Research, Workflow, Memory, and Evaluation foundations.
Earlier designs treated Capability and Provider as independent architecture
layers. Those abstractions overlap with Harness Tools, Harness Plugin loading,
and the Plugin runtime boundary, which makes ownership and governance unclear.

ResearchHub is a research asset layer, not a general-purpose Agent
Framework. The Harness already provides the runtime and LLM reasoning
environment required to execute these assets.

## Decision

ResearchHub adopts the architecture and governance defined in
[Architecture v0.3](RESEARCHHUB_ARCHITECTURE_V0.3.md):

- Harness owns Agent, Tool, Session, Plugin-loading, Skill-loading, and model
  runtime responsibilities.
- ResearchManager remains the only ResearchHub DSH and provides lightweight
  coordination and result integration.
- Workflow defines repeatable research SOPs and is not a Planner.
- Skill defines professional research methods and is not a Workflow.
- Plugin connects external resources and is not a Skill.
- Existing Memory and Evaluation APIs remain available for compatibility; they
  are not expanded as independent product layers.
- Research Output publishes reports, Research Objects, and provenance, while
  the Knowledge Layer owns the future durable knowledge boundary.
- The ResearchManager DSH is located at the repository root in `dsh/`; the
  `packages/` directory contains research capability modules only.

Capability Layer, Provider Layer, Research Planner Layer, Workflow
Composition Layer, and Multi-Agent architecture are deprecated as independent
ResearchHub architecture concepts.

## Why Capability and Provider are removed

Harness Tools and Plugin loading already provide the extension mechanisms that
Capability attempted to represent. External data and service connections are
also fully represented by Plugins. Keeping Capability or Provider as separate
top-level layers would duplicate runtime responsibilities and create two
competing classifications for new work.

## Compatibility status of Memory and Evaluation

Memory and Evaluation remain available for existing integrations and tests.
They do not become alternative planning or runtime layers. New durable
knowledge belongs under `knowledge/`; ResearchHub does not expand prediction
validation into an investment evaluation or autonomous learning product.

## Consequences

- ResearchHub remains small and focused on professional research assets.
- New work can be classified by responsibility without adding architecture
  layers.
- ResearchManager stays lightweight and does not replace LLM reasoning.
- Harness Core and verified Skill, Workflow, Memory, Evaluation, and Artifact
  behavior remain unchanged by this documentation decision.
- Historical Architecture v0.2 and v0.3 are preserved; current governance is
  defined by Research Output Architecture and Knowledge Layer Architecture.

## Guardrails

Future proposals must not add Capability, Provider, Agent Planner, Workflow
Composition, Workflow Engine, or autonomous memory layers. A proposal that
changes a boundary must include an ADR and explain why the existing Harness,
ResearchManager, Workflow, Skill, Plugin, Memory, or Evaluation boundary is
insufficient.
