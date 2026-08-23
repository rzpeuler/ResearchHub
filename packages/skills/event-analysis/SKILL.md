---
name: event-analysis
description: Analyze a stock event with traceable market, information, and financial evidence.
---

# Event Analysis Skill v2

The ResearchHub-specific metadata and contract are defined in
[`skill.yaml`](skill.yaml). This file remains the Harness-compatible Skill
entry point and contains the human-readable methodology contract.

## Purpose

Event Analysis answers: “What verifiable evidence may explain a material
change or event involving this company, and what measurable expectation should
be reviewed later?”

It produces a neutral research record. It does not issue buy, sell, or trading
instructions and does not claim that an observed event has a single cause.

## Research Objective

For one A-share symbol, establish a traceable chain from observed market
movement to possible catalysts, source-verified information, fundamental
context, explicit risks, and a measurable non-directional or directional
hypothesis. The final Thesis must be supported by Evidence artifacts and the
Prediction must be reviewable during its evaluation period.

## Inputs

- `symbol`: six-digit A-share symbol.
- `research question`: the event or change to investigate.
- `sessionId`: active Harness Session identifier.
- `createdAt`: research creation timestamp.
- `evaluationPeriod`: start and end timestamps for later review.

## Research Process

1. **Event confirmation** — establish the observed price, volume, or company
   event and record its timestamp and source.
2. **Catalyst identification** — collect official announcements and
   professional media evidence that may explain the event.
3. **Information verification** — compare claims across sources, separate
   reported facts from interpretation, and record source quality.
4. **Fundamental validation** — use financial facts to test whether the event
   is consistent with the company's reported operating condition.
5. **Logic-chain formation** — connect Evidence to a bounded Thesis; mark
   unsupported links as uncertainty rather than filling them with assumptions.
6. **Risk identification** — record alternative explanations, missing data,
   stale data, source conflicts, and invalidation conditions.
7. **Prediction metric definition** — state a hypothesis, one or more
   measurable validation metrics, and an evaluation period.

The Workflow owns the cross-capability execution order. This Skill owns the
research method applied to the collected facts.

## Research Framework

The detailed framework is defined in [`research-framework.md`](research-framework.md)
and covers:

- Price Action Analysis
- Catalyst Analysis
- Expectation Analysis
- Fundamental Validation
- Risk Analysis

## Required Capabilities

The Skill references logical Capability operations only:

- `market.get_market_snapshot(symbol)`
- `information.search_company_news(symbol)` through official announcement
  and professional media Plugin Handles
- `financial.get_financial_snapshot(symbol)`

The Skill never names or imports Tushare, AkShare, HTTP clients, crawlers, or
Plugin implementations.

## Evidence Requirements

The complete contract is defined in
[`evidence-schema.yaml`](evidence-schema.yaml). A valid Event Analysis must
retain Market Evidence, Information Evidence, and Financial Evidence when the
corresponding Capability is available. Evidence must carry source metadata,
timestamp, quality/confidence, and the active Session relationship.

Every Thesis must reference the Evidence IDs that support it. A Thesis based on
one source category only is incomplete and must be qualified or rejected.

## Output Contract

The complete contract is defined in [`output-schema.yaml`](output-schema.yaml).
The canonical output is:

- `Evidence[]`
- one `Thesis` with `evidenceIds[]`
- one `Prediction` with `thesisId`, a hypothesis represented by the existing
  Artifact `expectation`, at least one `validation_metric` in `metrics`, and
  `evaluationPeriod`

Artifacts must share the active `sessionId`. A presentation layer may render a
Research Report View, but Markdown is not the canonical Skill output.

## Research Rules

- Every Thesis must reference supporting Evidence IDs.
- No causal claim may rely on a single source category.
- No Prediction may be emitted without a validation metric and evaluation
  period.
- Facts, interpretation, hypothesis, and realized Outcome must remain distinct.
- Conflicting or missing Evidence must be disclosed in `risks` or equivalent
  metadata.
- Evaluation is performed later by the Evaluation Framework; this Skill does
  not self-grade or modify its own methodology.

## Quality and Evaluation

Quality criteria are defined in [`evaluation-rules.md`](evaluation-rules.md).
They assess Evidence quality, reasoning quality, and Prediction quality. The
Evaluation Framework compares the Prediction with a caller-supplied Outcome
and creates a Review without turning the Skill into a trading strategy.

## Scope Boundary

This Skill does not:

- access data sources directly;
- execute or schedule Workflow steps;
- implement an Agent Loop, Plugin Runtime, or Workflow Engine;
- persist raw conversations or Memory entries;
- make autonomous investment decisions or place trades.
