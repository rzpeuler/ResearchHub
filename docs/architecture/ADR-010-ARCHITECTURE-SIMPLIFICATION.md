# ADR-010: Architecture Simplification

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
- Memory stores Research Session, Evidence, Thesis, Prediction, and Review
  history.
- Evaluation validates predictions and reviews research quality without
  automatically modifying strategies or Skills.
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

## Why Memory and Evaluation remain

Memory and Evaluation are not alternative planning or runtime layers. Memory
preserves structured research history, while Evaluation provides review and
prediction validation. They support the research lifecycle without competing
with Harness runtime, Workflow process structure, Skill methodology, or Plugin
external access.

## Consequences

- ResearchHub remains small and focused on professional research assets.
- New work can be classified by responsibility without adding architecture
  layers.
- ResearchManager stays lightweight and does not replace LLM reasoning.
- Harness Core and verified Skill, Workflow, Memory, Evaluation, and Artifact
  behavior remain unchanged by this documentation decision.
- Historical Architecture v0.2 is preserved; v0.3 is the current governance
  reference.

## Guardrails

Future proposals must not add Capability, Provider, Agent Planner, Workflow
Composition, Workflow Engine, or autonomous memory layers. A proposal that
changes a boundary must include an ADR and explain why the existing Harness,
ResearchManager, Workflow, Skill, Plugin, Memory, or Evaluation boundary is
insufficient.
