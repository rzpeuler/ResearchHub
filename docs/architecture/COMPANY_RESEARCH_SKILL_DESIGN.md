# ResearchHub Company Research Skill Architecture

**Task:** RH-DESIGN-010  
**Status:** Design Baseline  
**Skill type:** Long-term company research  
**Harness:** DeepSeek Harness `0.1.1-rc.2`

## 1. Purpose and boundaries

Company Research is a long-horizon research methodology for understanding a
listed company as a business. It organizes facts about the business model,
industry position, competitive advantages, growth, financial quality, capital
allocation, and risks into traceable research conclusions.

The Skill answers:

> What kind of business is this, how does it compete and grow, how strong is
> the quality of its reported economics, and which risks or assumptions must be
> reviewed over time?

It does not fetch data directly, execute a Workflow, build an Harness Runtime,
perform valuation, issue investment advice, or execute trades.

```text
Research Manager
    -> Company Research Workflow
        -> Company Research Skill
            -> Market / Information / Financial Plugins
        -> Evidence Artifacts
        -> Company Research Thesis
        -> Reviewable Prediction
```

Workflow owns lifecycle and ordering. Plugin owns structured facts. The
Skill owns the research method and evidence standards. Existing Evidence,
Thesis, Prediction, Memory, and Evaluation contracts remain authoritative.

## 2. Standard Skill Package

When implemented, the Skill follows the Research Skill Architecture standard:

```text
packages/skills/company-research/
├── skill.yaml
├── SKILL.md
├── research-framework.md
├── evidence-schema.yaml
├── output-schema.yaml
└── evaluation-rules.md
```

The package should declare logical Plugin operations, not Plugin names.
The initial design expects Market, Information, and Financial Plugin
interfaces. A future Institution or Governance Plugin may add facts
without changing the Skill's boundary.

## 3. Research Framework

### 3.1 Business Understanding

Establish what the company sells, to whom, through which channels, and how it
creates and captures value.

Required questions:

- What are the main products, services, customers, and revenue streams?
- Which activities are core versus non-core?
- What operational resources and dependencies are essential?
- Which claims are reported facts and which are analyst interpretation?

Expected evidence: company disclosures, business descriptions, segment facts,
revenue mix, customer or product information, and relevant official records.

### 3.2 Industry Position

Describe the industry's structure and the company's position within it without
assuming that market size automatically becomes company growth.

Required questions:

- What is the relevant industry boundary and value chain?
- Who are the main competitors and substitutes?
- What are the industry's regulatory, cyclical, and supply constraints?
- Is the company's position supported by observable market or operating facts?

Expected evidence: industry facts, company disclosures, competitor context,
market structure information, and official policy or regulatory sources when
relevant.

### 3.3 Competitive Advantage

Identify possible advantages and test whether they are durable, observable,
and economically relevant.

Potential advantage categories:

- cost or scale advantage;
- brand, distribution, or customer relationship;
- switching costs or network effects;
- intellectual property, licenses, or operational know-how;
- supply, channel, or ecosystem position.

Required questions:

- What evidence demonstrates the advantage rather than merely naming it?
- Does the advantage improve retention, pricing, cost, access, or returns?
- What competitor action, technology, or regulation could weaken it?

### 3.4 Growth Drivers

Separate historical growth facts from forward-looking drivers. A driver must
have a mechanism and a way to be observed later.

Candidate drivers include volume, price, customer penetration, new products,
capacity, geographic expansion, channel development, and operating leverage.

Required questions:

- What is the driver and through which mechanism could it affect the business?
- What evidence shows that the driver exists and is actionable?
- Which metric and period can validate or invalidate the driver?

### 3.5 Financial Quality

Use reported financial facts to examine the quality and persistence of business
economics. This is financial fact analysis, not a valuation model.

Required areas:

- revenue composition and growth quality;
- profitability and margin behavior;
- cash conversion and operating cash flow;
- balance-sheet strength and leverage;
- working capital, capital intensity, and accounting qualifications;
- consistency across reporting periods.

Financial conclusions must state the reporting period, unit, source, and any
known data-quality limitation.

### 3.6 Capital Allocation

Record how management uses internally generated cash and external capital.

Required areas:

- reinvestment and capital expenditure;
- research and development;
- dividends and repurchases;
- acquisitions and disposals;
- debt issuance, repayment, and liquidity;
- related-party or governance-relevant transactions.

The Skill may evaluate consistency between stated priorities and reported
actions. It must not turn this section into a buy/sell recommendation.

### 3.7 Risk Analysis

Identify risks that could invalidate the Company Research Thesis or its growth
assumptions.

Minimum risk categories:

- industry and macroeconomic cyclicality;
- regulation, policy, or licensing;
- customer, supplier, product, or geographic concentration;
- technology and substitution;
- leverage, liquidity, and financial reporting;
- governance, incentives, and capital allocation;
- execution and competitive response.

Every material risk should include an observable warning signal, an affected
Thesis assumption, and a possible review period where practical.

## 4. Evidence Requirements

Each research module must map claims to Evidence Artifacts. The following is
the minimum evidence model:

| Module | Required Evidence | What it supports |
| --- | --- | --- |
| Business Understanding | Business description, segment/product facts, customer or channel facts | Business model and revenue-engine Thesis |
| Industry Position | Industry structure, competitor context, regulation or policy facts | Positioning and industry-exposure Thesis |
| Competitive Advantage | Retention, pricing, cost, distribution, IP, or ecosystem evidence | Advantage durability Thesis |
| Growth Drivers | Historical growth, capacity, orders, penetration, product, or channel evidence | Growth mechanism Thesis and Prediction |
| Financial Quality | Income statement, balance sheet, cash flow, period and unit metadata | Quality, persistence, and financial-risk Thesis |
| Capital Allocation | Capex, R&D, dividends, buybacks, M&A, debt, and liquidity facts | Capital-use and management-alignment Thesis |
| Risk Analysis | Disclosures, concentration, regulatory, leverage, governance, and execution facts | Risk Thesis and invalidation conditions |

Evidence quality rules:

- Every Evidence item must preserve source, timestamp, plugin, quality, and
  confidence metadata where supplied by the Plugin.
- Financial Evidence must retain statement type, reporting period, unit, and
  source context.
- Material claims should use more than one independent source or explicitly
  disclose why only one source is available.
- Facts from different periods must not be combined without stating the period
  relationship.
- Missing, stale, conflicting, or unmapped Evidence must be recorded as an
  uncertainty or risk, not silently omitted.

## 5. Company Research Thesis Contract

Company Research uses the existing Thesis Artifact rather than adding a new
Artifact type:

```ts
type CompanyResearchThesis = Thesis & {
  metadata: {
    skill: 'company-research'
    module: string
    symbol: string
    researchPeriod?: { start: string; end: string }
  }
}
```

The canonical required fields remain:

- `statement`: one bounded company-research claim;
- `evidenceIds`: every Evidence ID supporting the claim;
- `confidence`: calibrated confidence in the claim, not expected return;
- `risks`: alternative explanations, limitations, and invalidation conditions.

A complete Company Research result may contain multiple module-level Thesis
objects, but each must be independently traceable. A summary Thesis must point
to the relevant module Evidence and must not hide unsupported assumptions.

Thesis quality requirements:

- claims are specific enough to review;
- evidence supports the actual claim rather than merely being related;
- historical fact is separated from forward-looking interpretation;
- confidence reflects evidence quality and uncertainty;
- risks state what could disconfirm the Thesis.

## 6. Company Research Prediction Contract

Predictions use the existing Prediction Artifact:

```ts
type CompanyResearchPrediction = Prediction & {
  metadata: {
    skill: 'company-research'
    symbol: string
    module?: string
  }
  metrics: {
    validation_metric: string
    [key: string]: JsonValue
  }
}
```

The semantic contract is:

- `hypothesis` maps to the existing `expectation` field;
- `validation_metric` is a named observable metric in `metrics`;
- `evaluation_period` maps to the existing `evaluationPeriod` field;
- `thesisId` links the Prediction to its supporting Thesis.

Every Prediction must be:

- falsifiable or conditionally verifiable;
- linked to the Thesis and supporting Evidence chain;
- expressed with a measurable metric or set of metrics;
- bounded by a start and end time;
- explicit about what result would weaken or invalidate it.

Company Research must not produce an unbounded statement such as “the company
will continue to succeed” without a metric, period, and observable condition.

## 7. Evaluation Rules

### Evidence sufficiency

- Check that every major Thesis claim has supporting Evidence IDs.
- Check that relevant modules are not represented by a single unsupported
  assertion.
- Check source reliability, freshness, period consistency, and confidence.
- Require qualification when material evidence is missing or contradictory.

### Reasoning completeness

- Check the chain from business fact to industry position, advantage, growth,
  financial quality, and conclusion.
- Reject jumps from a descriptive fact directly to a durable advantage or
  investment conclusion.
- Check that causal mechanisms are stated rather than implied.
- Check that assumptions and alternative explanations are visible.

### Risk coverage

- Check coverage of industry, competitive, execution, financial, regulatory,
  governance, and capital-allocation risks where relevant.
- Check that each material risk identifies an affected assumption or metric.
- Check that the Thesis `risks` field is not empty when uncertainty is present.

### Prediction quality

- Check that a Prediction has a Thesis relationship.
- Check that `validation_metric` is observable and comparable with a future
  Outcome.
- Check that `evaluationPeriod` is valid and bounded.
- Check that the Prediction describes a hypothesis, not a guaranteed return or
  trading instruction.

Evaluation compares Prediction metrics with a caller-supplied Outcome and
creates a Review through the existing Evaluation Framework. It does not rank
companies, optimize strategies, or allow the Skill to rewrite itself.

## 8. Compatibility and future Workflow

The future `company-research` Workflow may call the Skill through the existing
Harness execution boundary and organize its modules as steps. This design does
not implement that Workflow, add Plugins, or create a Harness Workflow Runtime.

The design is compatible with:

- **Skill Architecture:** uses the standard package, evidence, output, and
  evaluation contracts;
- **Workflow:** Workflow selects and sequences the method without embedding
  the method's reasoning rules;
- **Plugin:** the Skill depends on logical Market, Information, and
  Financial operations, never concrete Plugins;
- **Artifact:** existing Evidence, Thesis, and Prediction types remain the
  storage contract;
- **Evaluation:** Prediction and Outcome remain the objective review input;
- **Memory:** supported Thesis and Prediction Artifacts can be persisted by
  existing adapters.

## 9. Explicit exclusions

This architecture does not define:

- valuation models, price targets, or portfolio allocation;
- an investment recommendation field;
- a new Company Artifact type;
- real data acquisition or Plugin selection;
- an autonomous DSH planner or Harness Workflow Runtime;
- automatic strategy changes after Evaluation.
