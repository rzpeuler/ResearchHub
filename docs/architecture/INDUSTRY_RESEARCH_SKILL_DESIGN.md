# ResearchHub Industry Research Skill Architecture

**Task:** RH-DESIGN-011  
**Status:** Design Baseline  
**Skill type:** Industry-level research methodology  
**Harness:** DeepSeek Harness `0.1.1-rc.2`

## 1. Purpose and boundaries

Industry Research is a reusable methodology for understanding an industry as
a system: its definition, market opportunity, supply and demand, value chain,
competition, technology trajectory, company participants, and risks.

The Skill answers:

> What is the industry, how does it create and distribute value, what forces
> are changing it, which companies are exposed to those forces, and which
> assumptions should be reviewed later?

It does not fetch data directly, execute a Workflow, select Providers, perform
valuation, issue investment advice, or trade.

```text
Research Manager
    -> Industry Research Workflow
        -> Industry Research Skill
            -> Market / Information / Financial Capabilities
        -> Industry Evidence
        -> Industry Thesis
        -> Reviewable Industry Prediction
```

Workflow owns lifecycle and ordering. Capability owns structured facts. The
Skill owns the research method and Evidence standards. Existing Evidence,
Thesis, Prediction, Memory, and Evaluation contracts remain authoritative.

## 2. Standard Skill Package

When implemented, the Skill follows the established Research Skill Package:

```text
packages/skills/industry-research/
├── skill.yaml
├── SKILL.md
├── research-framework.md
├── evidence-schema.yaml
├── output-schema.yaml
└── evaluation-rules.md
```

The Skill should declare logical Market, Information, and Financial Capability
dependencies, never concrete Provider names. This design does not create the
package or implementation code.

## 3. Research Framework

### 3.1 Industry Definition

Define the boundaries of the industry, its products and services, customer
needs, relevant substitutes, geographic scope, and value-chain position.

Core questions:

- What problem or demand does the industry serve?
- Which products, companies, and substitutes belong inside the boundary?
- Which adjacent industries must be separated to avoid double counting?
- What unit of activity is appropriate for later measurement?

Judgment standard: the definition must be operational and measurable rather
than a broad theme or narrative label.

### 3.2 Market Size and Growth

Estimate the market using explicit scope, unit, period, and methodology. Keep
historical size, current size, and forward growth assumptions separate.

Core questions:

- What is the addressable market and what is actually served today?
- Is growth driven by volume, price, mix, penetration, capacity, or regulation?
- Are market-size estimates comparable across sources and periods?
- Which metric can validate the growth path later?

Judgment standard: market growth is not automatically company revenue growth.

### 3.3 Supply and Demand Analysis

Analyze demand drivers, customer behavior, capacity, inventory, pricing,
utilization, input constraints, and the balance between supply and demand.

Core questions:

- What creates, increases, or destroys demand?
- How quickly can supply respond to demand changes?
- Where are bottlenecks, excess capacity, or inventory risks?
- Which indicators lead the cycle and which confirm it retrospectively?

Judgment standard: supply and demand claims must identify an observable
mechanism and avoid treating price movement alone as proof of imbalance.

### 3.4 Industry Chain Analysis

Map upstream inputs, midstream production or platforms, downstream customers,
distribution, and the flow of money, data, or bargaining power.

Core questions:

- Where are the most important costs, bottlenecks, and margins created?
- Which participants have pricing power or switching costs?
- How do shocks propagate through the chain?
- Which links are substitutes, complements, or concentration points?

Judgment standard: chain maps must connect participants to economic mechanisms,
not only list company names.

### 3.5 Competitive Landscape

Describe competitors, substitutes, market shares, business models, barriers to
entry, consolidation, and strategic positioning.

Core questions:

- Who competes for the same customer or economic profit pool?
- What differentiates the competitors in cost, product, channel, technology,
  or access?
- Is the industry becoming more concentrated or more fragmented?
- Which competitive response could change the current Thesis?

Judgment standard: competitive conclusions require comparable evidence and
must separate reported share from inferred advantage.

### 3.6 Technology Evolution

Analyze technologies, standards, production methods, platforms, and adoption
curves that may alter industry economics.

Core questions:

- What is technically changing and what economic constraint does it address?
- Is adoption limited by cost, reliability, regulation, infrastructure, or
  customer workflow?
- Which incumbents, suppliers, or substitutes benefit or lose from the change?
- What observable milestones distinguish adoption from promotion?

Judgment standard: technology potential is not industry impact until adoption
and economic transmission are evidenced.

### 3.7 Company Mapping

Map listed and relevant private companies to industry-chain positions,
products, customer exposure, geographic exposure, and economic sensitivity.

Core questions:

- Which companies participate in each industry-chain link?
- What percentage or type of exposure is supported by evidence?
- Which companies have different sensitivity, quality, or strategic position?
- How should industry-level findings feed Company Research without becoming a
  company recommendation?

Judgment standard: company mapping is exposure analysis. It does not rank
stocks or replace Company Research.

### 3.8 Risk Analysis

Identify risks that could invalidate the industry definition, market-growth
assumption, supply-demand view, technology path, or company mapping.

Minimum risk categories:

- policy, regulation, and licensing;
- macroeconomic and cyclical demand;
- supply, capacity, inventory, and input costs;
- technology substitution and standards;
- competition, concentration, and bargaining power;
- data quality, methodology, and period comparability;
- geopolitical, geographic, and infrastructure exposure.

Every material risk should include an affected assumption and an observable
warning signal or review condition.

## 4. Evidence Model

Every module maps its claims to Evidence Artifacts. The minimum model is:

| Module | Evidence type | Source requirements | Time requirements | Quality requirements |
| --- | --- | --- | --- | --- |
| Industry Definition | Industry taxonomy, product, customer, value-chain facts | Prefer official classification, company disclosures, and primary industry sources | State the definition date and scope period | Boundary must be explicit and internally consistent |
| Market Size & Growth | Market volume/value, penetration, historical growth, forecasts | Compare methodology and source provenance; separate primary data from estimates | Include base period, forecast period, and revision date | Unit, currency, geography, and estimation method required |
| Supply Demand | Capacity, utilization, inventory, pricing, orders, consumption | Prefer operating statistics, official data, and independent industry sources | Preserve observation period and frequency | Mechanism and leading/lagging indicator quality must be stated |
| Industry Chain | Input, production, distribution, customer, margin, and bottleneck facts | Prefer primary company, regulatory, trade, and operating sources | Align periods across chain links | Link facts to economic flow and avoid unsupported participant claims |
| Competitive Landscape | Share, competitors, substitutes, barriers, pricing, and capacity | Require comparable definitions and multiple sources for material share claims | Use the same comparison period where possible | Comparability and market-definition limitations must be disclosed |
| Technology Evolution | Technical milestones, adoption, cost, standards, capacity, and deployment | Prefer technical, regulatory, customer, and operating evidence over promotional claims | Distinguish announcement, pilot, deployment, and mature adoption dates | Adoption mechanism and economic impact must be evidenced |
| Company Mapping | Company products, exposure, chain position, sensitivity, and segment facts | Prefer official disclosures and source-verified industry mapping | Use the latest relevant reporting period and mapping date | Exposure basis, confidence, and unmapped activities must be explicit |
| Risk Analysis | Policy, cyclical, supply, technology, competition, data, and geopolitical facts | Prefer primary risk disclosures and independent corroboration | Record risk observation date and review horizon | Each risk must identify an affected assumption or signal |

Universal Evidence requirements:

- Preserve `source`, `timestamp`, `provider`, `quality`, and `confidence`.
- Preserve unit, currency, geography, period, and methodology for quantitative
  evidence.
- Use multiple independent sources for material claims when available.
- Keep facts from different periods separate and explain any alignment.
- Treat missing, stale, conflicting, or estimated data as uncertainty or risk.
- Distinguish observed industry facts from analyst interpretation and forecast.

## 5. Industry Thesis Contract

Industry Research reuses the existing Thesis Artifact:

```ts
type IndustryResearchThesis = Thesis & {
  metadata: {
    skill: 'industry-research'
    module: string
    industry: string
    researchPeriod?: { start: string; end: string }
  }
}
```

Required fields remain:

- `statement`: one bounded industry claim;
- `evidenceIds`: every Evidence ID supporting the claim;
- `confidence`: calibrated confidence in evidence and reasoning, not expected
  return;
- `risks`: alternative explanations, limitations, and invalidation conditions.

Thesis rules:

- A market-size Thesis must state unit, geography, period, and methodology.
- A supply-demand Thesis must state the mechanism and indicator.
- A competitive Thesis must state comparable market definitions.
- A technology Thesis must distinguish technical progress from adoption.
- A company-mapping Thesis must state exposure basis and confidence.
- A summary Thesis must preserve the module-level Evidence relationships.

Industry Thesis must not contain a recommendation field, price target, or
portfolio allocation instruction.

## 6. Industry Prediction Contract

Industry Predictions reuse the existing Prediction Artifact:

```ts
type IndustryResearchPrediction = Prediction & {
  metadata: {
    skill: 'industry-research'
    industry: string
    module?: string
  }
  metrics: {
    validation_metric: string
    [key: string]: JsonValue
  }
}
```

Semantic requirements:

- `hypothesis` maps to the existing `expectation` field;
- `validation_metric` is an observable key in `metrics`;
- `evaluation_period` maps to the existing `evaluationPeriod` field;
- `thesisId` links the Prediction to its supporting industry Thesis.

Every Prediction must be falsifiable or conditionally verifiable, include a
metric and time period, identify the industry mechanism being tested, and state
what observation would weaken or invalidate it.

Examples of acceptable metric forms include industry volume, utilization,
inventory, price, capacity, penetration, adoption, share, or company-exposure
measurements, provided the metric's definition and source are explicit.

## 7. Evaluation Rules

### Evidence coverage

- Check that all eight research modules are addressed or explicitly marked
  unavailable.
- Check that major claims have supporting Evidence IDs.
- Check source reliability, time alignment, methodology, unit, and quality.
- Check multiple-source coverage for material market, supply-demand,
  competitive, technology, and risk claims.

### Reasoning completeness

- Check the chain from industry definition to market, supply-demand, chain,
  competition, technology, company mapping, and conclusion.
- Reject jumps from market size directly to company growth or stock performance.
- Require an economic mechanism for supply-demand, technology, and competitive
  claims.
- Separate fact, interpretation, assumption, and forecast.

### Risk identification

- Check policy, cyclical, supply, competition, technology, data-quality, and
  geographic risks where relevant.
- Require each material risk to identify an affected Thesis assumption or
  Prediction metric.
- Require warning signals or review conditions where practical.

### Prediction quality

- Check a valid `thesisId` relationship.
- Check that `metrics.validation_metric` is observable and comparable with a
  future Outcome.
- Check a bounded, valid `evaluationPeriod`.
- Check that the Prediction is an industry hypothesis, not a guaranteed return,
  price target, or trading instruction.

Evaluation later compares Prediction with a caller-supplied Outcome and creates
a Review through the existing Evaluation Framework. It does not rank companies,
modify strategy, or allow the Skill to rewrite itself.

## 8. Compatibility with existing Skills

### Company Research

Industry Research provides upstream industry Evidence and context for Company
Research's Industry Position, Competitive Advantage, Growth Drivers, and Risk
Analysis modules. Company Research still performs company-specific mapping and
business-quality analysis; the Skills remain separate.

### Event Analysis

Event Analysis may reference Industry Research Evidence when interpreting an
event's industry catalyst or competitive context. Event Analysis remains a
shorter-horizon event methodology and does not become an industry survey.

### Workflow and Capability

A future `industry-research` Workflow may sequence the eight modules using the
existing Harness execution boundary. It may call existing Market, Information,
and Financial Capabilities, but this design does not implement that Workflow or
add a Capability.

## 9. Explicit exclusions

This architecture does not define:

- valuation, price targets, stock ranking, or portfolio allocation;
- a new Industry Artifact or Company Artifact type;
- real data acquisition or Provider selection;
- a custom Agent planner, Workflow Engine, or Plugin Runtime;
- automatic strategy changes after Evaluation.
