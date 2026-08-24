# ADR-014: Research Output and Knowledge Architecture

**Status:** Accepted
**Date:** 2026-08-25

## Decision

ResearchHub is governed as Research Output plus Knowledge Infrastructure. A
research request is coordinated by the single ResearchManager DSH, executed
through existing Workflows, Skills, and Plugins, and published as Research
Output. Structured output uses the Research Object Envelope defined in
`packages/schemas/`.

Long-term durable knowledge belongs to the repository-level `knowledge/`
boundary. `packages/memory/` and `packages/evaluation/` remain available only
as compatibility implementations for existing callers and tests; they are not
expanded as independent product architecture layers.

Artifact Trace is retained and repositioned as Research Output Provenance.
Artifact remains a technical compatibility term, while Research Object is the
preferred business term.

## Rationale

ResearchHub provides factual, traceable research knowledge infrastructure. It
does not provide an investment-prediction Agent, autonomous learning loop, or
Agent Memory system. Separating reports, machine-readable objects, provenance,
and durable knowledge makes those boundaries explicit without changing the
validated Skill, Workflow, Plugin, or DSH behavior.

## Consequences

- New output contracts live under `packages/schemas/` and
  `research-output/`.
- Future ontology, graph, document, and ingestion work belongs under
  `knowledge/`.
- Existing artifact, memory, and evaluation code is retained for compatibility.
- No graph database, RAG, extraction pipeline, or automatic knowledge
  formation is implied by this decision.
