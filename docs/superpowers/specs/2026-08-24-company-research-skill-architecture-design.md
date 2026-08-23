# ResearchHub Company Research Skill Architecture Design

## Context

ResearchHub has standardized Event Analysis as a versioned Skill Package with
research framework, Evidence schema, output contract, and Evaluation rules.
Company Research is the second core methodology and must reuse those contracts
without introducing a new Artifact type, Capability, runtime, or Workflow
Engine.

## Decision

Define Company Research as a long-term company-analysis Skill with seven
modules:

1. Business Understanding
2. Industry Position
3. Competitive Advantage
4. Growth Drivers
5. Financial Quality
6. Capital Allocation
7. Risk Analysis

Each module maps facts to Evidence, bounded claims to existing Thesis Artifacts,
and reviewable expectations to existing Prediction Artifacts. The Skill uses
logical Market, Information, and Financial Capability operations and never
depends on concrete Provider implementations.

## Evidence model

Evidence is organized by module and retains source, timestamp, provider,
quality, confidence, reporting period, and unit metadata where applicable.
Material claims require multiple independent sources or an explicit
single-source limitation. Missing or conflicting facts become risks or
uncertainty, not hidden omissions.

## Thesis and Prediction model

The Company Research Thesis reuses `statement`, `evidenceIds`, `confidence`,
and `risks`. Module-level claims may be represented by multiple Thesis objects;
a summary claim must preserve the underlying relationships.

Prediction reuses `expectation`, `thesisId`, `metrics`, and `evaluationPeriod`.
The semantic fields are `hypothesis`, `validation_metric`, and
`evaluation_period`, mapped to the existing Artifact shape. No Artifact base
type changes are required.

## Evaluation model

Evaluation checks Evidence sufficiency, reasoning completeness, risk coverage,
and Prediction measurability. It remains downstream and objective: Prediction
plus Outcome produces Review. It does not evaluate profitability, rank stocks,
modify a methodology, or create trading instructions.

## Alternatives considered

### New Company-specific Artifact types

Rejected because they duplicate the existing Evidence/Thesis/Prediction
relationship and would fragment Memory and Evaluation compatibility.

### Company Research as a Workflow-only method

Rejected because professional methodology, evidence standards, and quality
rules would be embedded in orchestration instead of reusable as a Skill.

### Standard Skill Package with existing Artifact contracts — selected

This preserves the ResearchHub architecture: Workflow orchestrates, Skill
defines method, Capability provides facts, Artifact stores structured results,
and Evaluation performs objective review.

## Scope

This design adds only `docs/architecture/COMPANY_RESEARCH_SKILL_DESIGN.md`.
Implementation of `packages/skills/company-research/`, a future
`company-research` Workflow, and any additional Capability are separate tasks.
