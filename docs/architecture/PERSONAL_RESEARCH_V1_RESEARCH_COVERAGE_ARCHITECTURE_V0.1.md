# ResearchHub — Personal Research v1 Research Coverage Architecture v0.1

Status: PASS / FROZEN by CTO decision
Date: 2026-09-08
Baseline: `main@0b2d97a04d48b4c078ade8789efbf6fd5cfd2ca5`

## Purpose

Personal Research v1 Research Coverage extends ResearchHub from one-time Company Deep Research and bounded Daily Intelligence toward continuous maintenance of investment research state.

Research coverage is a product capability and an architectural composition of existing artifacts. It is not a new canonical object, persistence framework, or generic research engine.

## Accepted M3 Scope

M3 is frozen as **Personal Research v1 — Research Coverage**.

### M3A — Company Research Coverage

M3A contains four producer-specific capabilities, implemented in this order:

1. Earnings Review
2. Valuation
3. Event Research
4. Thesis Red Team

### M3B — Industry Deep Research

Industry Research is **NOT STARTED / ARCHITECTURE REQUIRED**. It requires a separate architecture freeze before implementation. This document does not freeze an Industry schema, workflow, provider set, or canonical model.

### Theme Framework

Theme Framework remains **DEFERRED**. Theme is a cross-industry/company investment semantic overlay; it is not automatically part of M3 and receives no implementation or semantic freeze from this document.

## Coverage Model

M3 does not create a canonical `CoverageState` object or a parallel Coverage Framework. Coverage emerges from the existing system:

```text
Canonical Knowledge
  + Research Reports
  + Workflow Runs
  + ResearchSignals
  = bounded, observable research coverage
```

Canonical Knowledge remains the durable research state. Reports are user-facing research outputs. Workflow runs provide execution history and lifecycle state. ResearchSignals remain non-canonical operational observations.

The initial Company Deep Research state may contain facts, assumptions, thesis claims, catalysts, and risks. M3A producers maintain that state through new reports and bounded Semantic Proposals rather than mutating it directly.

## Producer Boundary

Every M3A producer follows the existing producer-neutral path:

```text
Research Objective
  -> bounded Existing Knowledge Projection
  -> producer-specific acquisition
  -> producer-specific Skill
  -> deterministic computation where required
  -> Research Report
  -> Semantic Knowledge Proposals
  -> Knowledge Production Gateway
  -> Binding / Diff / bounded Resolution
  -> ResolutionIntent
  -> ChangeSet
  -> Validation
  -> Writer
```

Workflow owns lifecycle, ordering, routing, retries, cancellation, validation gates, and completion. Skill owns professional semantic methodology. Plugin owns external capability integration and acquisition. Knowledge owns canonical domain rules and persistence integrity.

These boundaries remain the same as the accepted M1/M2 architecture. Pi Coding Agent remains the canonical application host, and `ReasoningExecutor` remains the Workflow semantic-operation boundary and deterministic testing seam.

Do not introduce any of the following as shared M3 architecture:

- generic Coverage Framework;
- `ResearchCoverageManager`;
- `BaseResearchProducer`;
- `GenericResearchWorkflow`;
- `CoverageEngine`;
- `ResearchPipeline`;
- `ResearchPlanner`;
- `ResearchModuleRegistry`;
- generic Workflow Engine;
- multi-agent orchestration;
- Graph DB, Vector DB, or RAG layer;
- new Agent Runtime;
- new Provider Registry or source architecture.

Shared utilities may be extracted only after real duplication across implemented producers demonstrates a concrete need. A common name or conceptual similarity is not sufficient authorization for a framework.

## Earnings Review

### Intent

Earnings Review maintains a company research state after a financial reporting period.

### Inputs and flow

```text
Company + Reporting Period
  -> Existing Research Projection
  -> Official Filing / Financial Acquisition
  -> deterministic financial calculations
  -> Earnings Review Skill
  -> Changes vs Existing Research
  -> Earnings Review Report
  -> Semantic Proposals
  -> Gateway
```

### Minimum report structure

1. Earnings Snapshot
2. Revenue / Profit Growth
3. Segment Performance
4. Margin Analysis
5. Cash Flow / Working Capital
6. Earnings Quality
7. Management Guidance
8. One-offs / Accounting Effects
9. Changes vs Prior Research
10. Assumption Impact
11. Thesis Impact
12. Catalyst / Risk Changes
13. Valuation Implications
14. Research Gaps / Monitoring

No reliable public consensus may be implied. The report must state `Consensus unavailable` when attributable point-in-time consensus evidence is absent. Consensus estimates must never be fabricated.

## Valuation

### Intent

Valuation produces a reproducible valuation view from explicit assumptions and deterministic calculations. It is primarily a Research Report, not a new canonical Knowledge kind.

### Responsibility split

The Skill may select methods, interpret assumptions, design scenarios, and explain growth, margin, multiple, or valuation rationale.

Code must own formulas, arithmetic, percentages, scenarios, sensitivity calculations, and target-price calculations. LLM-generated numerical valuation must not be accepted without deterministic recomputation.

Valuation v1 may support PE, PB, EV/EBITDA when data is available, scenario target-price analysis, and sensitivity analysis. DCF is optional/later. Missing required data produces `Unavailable`, never fabricated values.

Only durable assumptions or evidence-backed valuation viewpoints may become Semantic Proposals.

## Event Research

### Intent

Event Research deeply investigates a material event identified by Daily Intelligence, an announcement, a bounded URL/article, a user-provided event, or another explicitly bounded source input.

### Inputs and flow

```text
Event
  -> Source Verification
  -> Existing Knowledge Projection
  -> Targeted Evidence Acquisition
  -> Event Research Skill
  -> First/Second-order Impact
  -> Event Research Report
  -> Semantic Proposals
  -> Gateway
```

The report distinguishes verified event facts, interpretation, direct impact, second-order impact, affected assumptions, affected thesis, catalysts, risks, and open research questions.

Daily Intelligence discovers and ranks change. Event Research performs the deeper investigation of a selected change and must not duplicate Daily Intelligence acquisition or synthesis responsibilities.

## Thesis Red Team

### Intent

Thesis Red Team actively challenges an existing investment thesis. It is adversarial research methodology, not a direct mutation authority.

### Inputs and flow

```text
Existing Thesis
  -> Dependency Projection
  -> Critical Assumptions
  -> Disconfirming Evidence Search
  -> Alternative Explanations
  -> Bear / Failure Cases
  -> Invalidation Conditions
  -> Red Team Report
  -> Semantic Proposals
  -> Gateway
```

The input projection should prioritize the thesis, dependent assumptions, supporting and contradicting claims, catalysts, risks, and relevant recent ResearchSignals.

Red Team may propose contradicting Claims, Risks, Assumption challenges, and alternative viewpoints. It must not directly mutate or delete a Thesis. Existing Knowledge Resolution determines coexistence, contradiction, supersession, or ReviewCase creation.

## Knowledge and Schema Boundary

M3A uses the existing Schema 0.4 / Storage Format 1 baseline whenever possible. This architecture task authorizes no Schema 0.4 change and no automatic migration from Schema 0.3.

Expected existing Claim semantics are sufficient for facts, assumptions, thesis, catalysts, risks, viewpoints/trends, and dependencies. M3A must not create canonical kinds named `EarningsReview`, `Valuation`, `ResearchEvent`, `RedTeamResult`, or `CoverageState`.

Those are Report or Workflow concepts. Canonical persistence remains governed exclusively by the existing Semantic Proposal -> Gateway -> validated ChangeSet -> Writer path.

Research Reports use the following persisted report types at the implementation-contract level:

- `company_research`;
- `daily_brief`;
- `earnings_review`;
- `valuation`;
- `event_research`;
- `thesis_red_team`.

The existing distinction is intentional: `company_deep_research` is the Workflow type and research capability name, while `company_research` is the persisted `ResearchReport.reportType`. M3A adds only the four future report types listed above.

An implementation task must extend the existing narrow ResearchReport contract deliberately; it must not persist an entire Report into canonical Knowledge. A Report may contain many observations while only a bounded, evidence-backed subset becomes durable.

## ResearchSignal Boundary

ResearchSignal remains non-canonical runtime operational information. It may be consumed by Daily Intelligence, Event Research, and future bounded workflows, but it never gains Writer authority and never becomes a canonical Knowledge kind by itself.

## Application Product Actions

The following are architecture-level future product actions only:

- `research_company`;
- `review_earnings`;
- `analyze_valuation`;
- `research_event`;
- `red_team_thesis`.

This task does not implement tools, routes, UI, Application Services, or Workflow entrypoints. When implemented, these actions must remain product-level Application Services and must not expose low-level Knowledge mutation primitives.

## Acquisition and Provider Boundary

M3A may use bounded producer-specific acquisition through existing Plugin seams. This architecture does not authorize new Providers, a source catalog expansion, a Provider Registry, login automation, CAPTCHA bypass, anti-bot circumvention, or a new source architecture.

Each producer implementation must state its acquisition boundary and evidence/provenance requirements. Missing or unavailable evidence is represented as `Unavailable`, a Research Gap, or an explicit blocked/failed workflow outcome; it must not be filled with invented facts or consensus.

## M3 Implementation Sequence

The frozen sequence is:

```text
M3A-0  Research Coverage Architecture        FROZEN / this task
M3A-1  Earnings Review                        NOT STARTED
M3A-2  Valuation                              NOT STARTED
M3A-3  Event Research                         NOT STARTED
M3A-4  Thesis Red Team                        NOT STARTED
M3B    Industry Deep Research Architecture   NOT STARTED / separate approval required
M3B    Industry Deep Research Implementation  NOT STARTED
Theme Framework                               DEFERRED
```

No M3A-1 implementation is authorized by this document. Each implementation stage requires its own engineering task, validation evidence, and independent review against this architecture.

## Governance and Acceptance Boundary

M1 Personal Research Foundation remains PASS / CLOSED. M2 Daily Intelligence remains PASS / CLOSED. M3 Research Coverage Architecture is PASS / FROZEN; M3A-1 Earnings Review implementation is governed by the separate implementation contract and remains subject to CTO acceptance.

This document freezes scope and boundaries only. It does not constitute implementation acceptance, does not change the Knowledge schema, does not authorize new providers, and does not authorize any M3 product code.
