# ResearchHub Industry Research Skill Architecture Design

## Context

ResearchHub has standardized Event Analysis and Company Research as separate
method Skills using the same Skill Package, Artifact, and Evaluation contracts.
Industry Research is the third core methodology and must provide industry-level
context without becoming a company recommendation or a data-source layer.

## Decision

Define Industry Research around eight modules:

1. Industry Definition
2. Market Size & Growth
3. Supply Demand Analysis
4. Industry Chain Analysis
5. Competitive Landscape
6. Technology Evolution
7. Company Mapping
8. Risk Analysis

Each module must state its Evidence type, source requirements, time period,
quality requirements, reasoning mechanism, and review conditions.

## Evidence model

Industry Evidence preserves source, timestamp, Provider, quality, confidence,
unit, geography, period, and methodology where applicable. Material claims use
multiple independent sources when available. Estimates, conflicts, stale data,
and incomparable periods are disclosed as uncertainty or risk.

## Thesis and Prediction model

The Skill reuses the existing Thesis Artifact with `statement`, `evidenceIds`,
`confidence`, and `risks`. Module-level Thesis objects may be summarized, but
the Evidence relationships remain explicit.

Prediction reuses `expectation`, `metrics`, `evaluationPeriod`, and `thesisId`.
The semantic contract requires a measurable industry metric, a bounded period,
and an invalidation condition.

## Compatibility model

Industry Research is upstream context for Company Research and optional context
for Event Analysis. Company Research remains responsible for company-specific
business quality and exposure analysis. Event Analysis remains responsible for
shorter-horizon event interpretation. Workflow still orchestrates, Capability
still provides facts, Artifact still stores results, and Evaluation still
compares Prediction with Outcome.

## Alternatives considered

### Merge Industry Research into Company Research

Rejected because industry facts, company exposure, and company quality have
different scopes, evidence periods, and review questions.

### Create an Industry-specific Artifact type

Rejected because it would fragment the existing Memory and Evaluation contract.

### Separate Industry Skill using existing Artifacts — selected

This keeps methods reusable and composable while preserving the current
Harness, Workflow, Capability, Artifact, and Evaluation boundaries.

## Scope

This design adds only `docs/architecture/INDUSTRY_RESEARCH_SKILL_DESIGN.md`.
Implementation of `packages/skills/industry-research/`, a future
`industry-research` Workflow, and any additional data Capability are separate
engineering tasks.
