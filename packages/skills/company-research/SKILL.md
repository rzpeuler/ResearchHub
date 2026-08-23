---
name: company-research
description: Analyze the long-term business quality, competitive position, growth, financial quality, capital allocation, and risks of a listed company.
---

# Company Research Skill

The ResearchHub metadata and contracts are defined in
[`skill.yaml`](skill.yaml). This file is the Harness-compatible Skill entry
point and the human-readable methodology contract.

## Purpose

Company Research produces a long-term, evidence-based understanding of a
listed company as a business. It separates business facts, industry context,
competitive advantages, growth mechanisms, financial quality, capital use, and
risks from investment decisions.

It does not fetch data directly, call Providers, execute a Workflow, perform
valuation, issue investment advice, or trade.

## Research Objective

Determine how the company creates value, how it competes, whether its growth
drivers are observable, how durable its reported economics appear, how capital
is allocated, and which assumptions require future review.

## Research Process

1. Business Understanding
2. Industry Position
3. Competitive Advantage
4. Growth Drivers
5. Financial Quality
6. Capital Allocation
7. Risk Analysis
8. Thesis formation from linked Evidence
9. Prediction definition with a measurable metric and evaluation period

The Workflow owns the execution order. The Skill owns the research method and
quality rules applied to the collected facts.

## Business Understanding

Analyze products, services, customers, channels, revenue structure, operating
dependencies, and the company's value-creation mechanism. Separate reported
business facts from interpretation.

## Industry Position

Analyze industry boundaries, value-chain position, market structure,
competitors, substitutes, regulation, and cyclicality. Market size alone is
not evidence of company growth.

## Competitive Advantage

Test potential cost, technology, brand, network, distribution, ecosystem,
licensing, intellectual-property, and switching-cost advantages. Each claimed
advantage must have observable support and a weakening condition.

## Growth Drivers

Analyze industry growth, product cycle, market expansion, customer penetration,
capacity, channels, new products, pricing, and operating leverage. Every driver
must have a mechanism, evidence, and a later validation metric.

## Financial Quality

Analyze revenue growth quality, profitability, cash flow, balance-sheet
strength, leverage, working capital, capital intensity, and reporting-period
consistency. This is financial fact analysis, not valuation.

## Capital Allocation

Analyze capital investment, R&D, acquisitions, dividends, repurchases, debt,
liquidity, and the consistency between stated priorities and reported actions.

## Risk Analysis

Analyze industry, competitive, execution, regulatory, governance, financial,
concentration, technology, and capital-allocation risks. Each material risk
should identify an affected assumption and an observable warning signal.

## Evidence Requirements

The complete Evidence contract is defined in
[`evidence-schema.yaml`](evidence-schema.yaml). Evidence must retain source,
timestamp, Provider, quality, confidence, and reporting-period metadata where
applicable. Material claims require multiple independent sources or an explicit
single-source limitation.

## Output Contract

The complete output contract is defined in
[`output-schema.yaml`](output-schema.yaml). The Skill emits existing
`Evidence[]`, `Thesis`, and `Prediction` Artifacts.

Every Thesis must contain `statement`, `evidenceIds`, `confidence`, and
`risks`. Every Prediction must contain an expectation, a named validation
metric in `metrics`, a valid evaluation period, and a `thesisId`.

## Research Rules

- Every Thesis claim must be linked to supporting Evidence IDs.
- Material claims must not rely on one source without qualification.
- Historical facts, interpretation, hypothesis, and realized Outcome remain
  distinct.
- No Prediction may be emitted without a measurable metric and time period.
- Missing, stale, or conflicting Evidence must be recorded as uncertainty or
  risk.
- The Skill must not create valuation outputs, trading instructions, or
  autonomous investment recommendations.

## Quality and Evaluation

[`evaluation-rules.md`](evaluation-rules.md) defines Evidence sufficiency,
reasoning completeness, risk coverage, and Prediction quality. The Evaluation
Framework later compares Prediction with a caller-supplied Outcome and creates
a Review. The Skill does not self-grade or change its methodology.

## Scope Boundary

The Company Research Skill depends on logical Market, Information, and
Financial Capability interfaces only. It does not access Provider
implementations, schedule Workflow steps, own Session persistence, modify
Memory, or replace the Harness Runtime.
