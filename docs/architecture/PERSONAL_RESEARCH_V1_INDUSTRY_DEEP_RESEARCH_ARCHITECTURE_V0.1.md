# ResearchHub — Personal Research v1 Industry Deep Research Architecture v0.1

Status: `PASS / FROZEN by CTO decision`

Baseline: `main@d75c161cdcbd279d4b1062233102991e95ea8c0c`

Architecture Task:

`RHL-ARCH-PERSONAL-RESEARCH-V1-INDUSTRY-DEEP-RESEARCH-001`

---

# 1. Purpose

M3B Industry Deep Research extends Personal Research v1 from Company-level research into Industry-level research.

Its purpose is not merely to generate an industry report.

Its primary architectural goal is to transform industry research into reusable canonical Knowledge covering:

Industry structure, market development, supply and demand, industrial chain relationships, products, technologies, competitive structure, company exposure, catalysts, risks and research conclusions.

The resulting Knowledge must be reusable by:

Company Research, Event Research, Thesis Red Team, Daily Intelligence, Knowledge Query and Knowledge Graph.

Industry Deep Research is therefore both:

a user-facing professional research capability;

and a producer of cross-company structured Knowledge.

---

# 2. Architecture Decision

M3B uses the existing ResearchHub architecture:

```text
Pi Coding Agent
      ↓
Application Service
      ↓
Industry Deep Research Workflow
      ↓
Industry Research Skill
      ↓
Research Acquisition Plugins
      ↓
Evidence Qualification
      ↓
Semantic Knowledge Proposals
      ↓
Knowledge Production Gateway
      ↓
Resolution / ChangeSet / Validation
      ↓
Writer
      ↓
Canonical Knowledge

              +
      Industry Research Report
```

M3B does not introduce a new Agent.

M3B does not introduce an Industry Research Manager.

M3B does not introduce a generic Planner.

M3B does not introduce a generic Research Engine.

M3B does not introduce a generic Workflow Engine.

M3B does not introduce a Provider Registry.

M3B does not introduce Graph DB, Vector DB or RAG infrastructure.

Workflow continues to own deterministic execution and lifecycle.

Skill owns professional research methodology and semantic reasoning.

Plugin owns external acquisition.

Knowledge owns canonical identity, resolution, validation and persistence.

---

# 3. Research Target Boundary

The root research target of M3B is one canonical:

`Industry`

An Industry means:

an independently researchable economic activity or industrial-chain activity.

Examples include:

PCB manufacturing, copper-clad laminate manufacturing, semiconductor equipment, optical modules or lithium battery materials.

A broad investment theme is not automatically an Industry.

For example:

AI Infrastructure, Humanoid Robotics or Domestic Substitution may span multiple economically distinct industries.

Such cross-industry concepts belong to the future Theme Framework and must not be silently converted into an Industry.

If the user input is clearly a Theme rather than one Industry, Industry Deep Research must return a bounded scope diagnosis instead of creating incorrect canonical Industry Knowledge.

Products and technologies are also not Industry roots.

A Product or Technology may be mapped to an Industry during scope resolution, but the Workflow must not silently change ontology type without validated semantic justification.

---

# 4. Industry Identity Boundary

Industry has no built-in hard identity equivalent to Company `(exchange, ticker)`.

Therefore Industry identity cannot be established solely because two strings have the same normalized name.

Industry target resolution follows:

```text
Industry Research Request
        ↓
Canonical Industry Ref supplied?
        ↓ yes
Validate ref + type
        ↓
BoundExisting

        ↓ no
Retrieve plausible Industry candidates
        ↓
No plausible candidate
        ↓
PlannedNew

One or more plausible candidates
        ↓
Bounded semantic equivalence resolution
        ↓
Equivalent → BoundExisting
Uncertain → Review / Block
Distinct → PlannedNew
```

LLM output must never directly invent a canonical Industry ref.

A canonical ref supplied by Application input may be accepted only after deterministic existence and type validation.

Ambiguous Industry identity must never be solved by silently choosing the first name match.

Repeated research against the same semantic Industry must not create duplicate root Industry objects.

---

# 5. Canonical Industry Knowledge Model

M3B reuses existing Schema 0.4 / Storage Format 1.

No new canonical top-level object kind is introduced.

The principal mapping is:

| Research concept | Canonical representation |
|---|---|
| Primary research industry | `Industry` Entity |
| Independent upstream/downstream activity | `Industry` Entity |
| Commercial product/category/component | `Product` Entity |
| Technical route/process/architecture | `Technology` Entity |
| Listed/unlisted operating company | `Company` Entity |
| Industry chain order | `upstream_of` |
| Company industry exposure | `business_exposure` |
| Product industry association | `belongs_to_industry` |
| Technology industry association | `belongs_to_industry` / `applied_in` |
| Company commercial product | `offers_product` |
| Product hierarchy/component | `component_of` |
| Company technology development | `develops_technology` |
| Product/company technology usage | `uses_technology` |
| Structural dependency | `depends_on` |
| Product/technology substitution | `substitutes_for` |
| Company competition | `competes_with` |
| Verified company supply relationship | `supplier_of` |
| Market size / growth | Claim |
| Capacity / utilization | Claim |
| Supply / demand condition | Claim |
| Price / margin / economics | Claim |
| Market share | Claim |
| Technology penetration | Claim |
| Industry forecast | `forecast` Claim |
| Structural change | `trend` Claim |
| Analytical conclusion | `viewpoint` Claim |
| Industry risk | `risk` Claim |
| Industry catalyst | `catalyst` Claim |

No canonical `IndustrySegment`, `IndustryReport`, `IndustryResearchResult`, `IndustryMap` or `CompetitiveLandscape` kind is introduced in v0.1.

---

# 6. Industry Segmentation Policy

Not every research segmentation becomes an Entity.

An independently researchable economic activity may become an Industry.

A recognizable commercial category becomes Product.

A reusable technical route becomes Technology.

Application/geographical/price-band/customer-type segmentation normally remains report structure or Claim context unless it has sufficient independent economic meaning to justify a canonical Entity.

This prevents uncontrolled ontology growth.

Industry hierarchy itself is not invented using deprecated containment Relations.

Industry-chain structure is primarily represented through economically meaningful Relations such as `upstream_of`, `depends_on`, Product membership and Technology application.

---

# 7. Knowledge Production Boundary Prerequisite

Before implementing the Industry Research Workflow, M3B requires one narrow producer-neutral Knowledge Production boundary closure.

This is not a Schema migration.

It contains four requirements.

## 7.1 Generic root Entity binding

Knowledge Production Gateway must stop assuming that the primary `KnowledgeProductionInput.entity` is necessarily a Company.

Root Entity binding must be type-aware.

Company continues using its existing hard `(exchange,ticker)` identity.

Industry, Product and Technology must follow their conservative Knowledge Resolution policy.

## 7.2 Conservative non-Company Entity resolution

Industry/Product/Technology exact name matching must not become an implicit hard identity rule.

When an existing plausible Entity cannot be deterministically proven equivalent, the result must be semantic resolution or Review rather than silent merge.

## 7.3 Claim subjects may resolve to Entity or Relation

Schema already permits Claim subjects to represent an Entity or Relation.

The producer-facing Gateway path must therefore support a Claim whose local subject resolves to a newly or previously resolved Relation.

This enables semantics such as:

company market share within an Industry;

company economics within one business exposure;

supplier/customer relationship metrics;

industry-chain relation-specific quantitative observations.

No new Claim model is needed.

## 7.4 Relation resolution mapping

Gateway outcome should expose deterministic Relation proposal → canonical Relation ref mapping equivalent to its existing Entity and Claim mapping.

This is required for Research Report provenance and downstream Claim subjects.

These changes must remain producer-neutral.

No `industry_research` special branches are permitted inside Knowledge Domain infrastructure.

---

# 8. Industry Research Methodology

Industry Deep Research v0.1 uses eight frozen professional research modules.

| Module | Core question |
|---|---|
| Industry Definition | What exactly is being researched and what is outside scope? |
| Market Size & Growth | How large is the market, how fast is it changing, and what methodology supports the figures? |
| Supply Demand Analysis | What determines demand, capacity, utilization, inventory, pricing and cycle balance? |
| Industry Chain Analysis | What are the upstream/downstream activities, products, technologies and value-transfer relationships? |
| Competitive Landscape | Who participates, how concentrated is competition, and where are barriers and differentiation? |
| Technology Evolution | Which technical routes are changing cost, performance, penetration or competitive advantage? |
| Company Mapping | Which companies have real exposure, where do they sit in the chain, and how material is it? |
| Risk Analysis | What can invalidate the industry view, change supply/demand, or alter company beneficiaries? |

These are methodology modules.

They are not eight Skills.

---

# 9. Skill Architecture

M3B introduces one:

`skills/industry-research/`

The Skill contains the complete professional Industry Research methodology.

It exposes bounded semantic operations rather than eight independent Skills.

The minimum semantic operations are:

`industry_research_design`

`industry_module_analysis`

`industry_cross_module_synthesis`

## 9.1 Research Design

Research Design runs before broad evidence synthesis.

It produces a bounded plan containing:

industry definition hypothesis;

scope boundaries;

eight module research questions;

key metrics;

evidence requirements;

bounded search terms;

known research gaps;

candidate products/technologies/chain activities requiring verification.

Research Design does not create durable Knowledge.

## 9.2 Module Analysis

The same `industry_module_analysis` operation is executed against each frozen module.

Each invocation receives only the bounded evidence and Existing Knowledge relevant to that module.

This avoids one giant prompt containing the entire industry corpus.

Module analysis may generate local semantic candidates for:

Entities;

Relations;

Claims;

interpretations;

research gaps.

All identifiers remain Workflow-local.

## 9.3 Cross-module synthesis

Cross-module synthesis receives validated module results, not unrestricted raw Internet material.

It integrates:

industry structure;

supply-demand state;

industry cycle;

technology trajectory;

competitive implications;

company exposure;

key catalysts;

key risks;

monitoring variables.

It cannot silently introduce unsupported external facts.

Any durable proposal originating from cross-module synthesis must reference previously qualified evidence.

---

# 10. Workflow Architecture

M3B introduces:

`workflows/industry-deep-research/`

The deterministic execution model is:

```text
1. Resolve Industry target
2. Project bounded Existing Knowledge
3. Industry Research Design
4. Acquisition Wave 1
5. Normalize + qualify evidence
6. Run eight bounded module analyses
7. Detect evidence gaps
8. Optional Acquisition Wave 2
9. Re-run only affected modules
10. Cross-module synthesis
11. Consolidate semantic candidates
12. Durable proposal admissibility gate
13. One Knowledge Production Gateway submission
14. Reload persisted Knowledge
15. Assemble Industry Research Report
16. Persist Report
```

The gap-fill loop is fixed.

It may execute at most once.

Industry Research must never become an open-ended autonomous research loop.

The Workflow owns all concurrency limits, source limits, retries, cancellation and terminal status.

---

# 11. Existing Knowledge Projection

Industry Research must not dump the full Knowledge Base into the model.

The Existing Knowledge projection is rooted on the target Industry and should include bounded relevant:

adjacent Industries;

Products;

Technologies;

Companies;

Relations;

active Claims;

recent durable evidence context.

Projection should normally remain within a shallow graph radius and explicit object-count bounds.

The purpose is to allow Industry Research to update existing research state rather than repeatedly recreate it.

---

# 12. Acquisition Architecture

M3B continues using:

`ResearchAcquisitionPlugin`

No new source architecture is introduced.

Industry Research may compose existing public/free acquisition capabilities and add producer-relevant implementations behind the same Plugin contract.

The preferred source order is:

authoritative public/government/statistical information;

regulatory filings and company official information;

structured public datasets;

industry associations and specialist public sources;

professional financial/technology media;

general media;

community information.

Community information may be useful for discovery and research leads but should normally remain report-only unless independently corroborated.

M3B v0.1 does not authorize:

login automation;

paywall bypass;

CAPTCHA bypass;

anti-bot circumvention;

credential scraping;

restricted data redistribution.

Unavailable professional data must be represented as unavailable rather than fabricated.

---

# 13. Evidence Quality Rules

Every durable Claim and Relation must be backed by canonical Source/Raw provenance.

Quantitative Industry Claims must preserve, when applicable:

time period;

unit;

geography;

measurement definition;

source methodology.

Market-size values from different definitions or geographical scopes must not be merged merely because their metric labels are similar.

Critical company mapping such as `supplier_of` must require direct or sufficiently authoritative evidence.

Rumored supply-chain relationships must not become canonical supplier Relations.

Forecasts remain Forecast Claims.

Analytical conclusions remain Viewpoint Claims.

Observed structural change remains Trend Claims.

The model must not convert interpretation into Fact merely to increase Knowledge density.

---

# 14. Durable Proposal Gate

The LLM does not decide what is persisted.

Before Gateway submission, code validates:

proposal kind;

allowed Entity type;

allowed Relation type;

endpoint type compatibility;

local-reference validity;

evidence binding;

source admissibility;

Claim atomicity;

temporal semantics;

structured numeric completeness;

duplicate local proposals;

unsupported cross-module contradictions.

Invalid proposal candidates are dropped or sent to governed Review according to existing Knowledge policy.

They must not invalidate otherwise valid research synthesis unless they affect required semantic completeness.

---

# 15. One-Commit Knowledge Invariant

One Industry Deep Research run produces at most:

one semantic proposal bundle;

one Gateway submission;

one validated ChangeSet;

one Writer commit.

Individual module analyses may not write canonical Knowledge independently.

The eight research modules therefore cannot create eight independent KB revisions.

This preserves atomic cross-module consistency.

---

# 16. Research Report

The persisted Workflow type is:

`industry_deep_research`

The persisted ResearchReport type is:

`industry_research`

The report contains exactly sixteen code-owned sections.

| # | Section |
|---|---|
| 1 | Executive Industry View |
| 2 | Industry Scope & Definition |
| 3 | Market Size & Growth |
| 4 | Demand Structure & Drivers |
| 5 | Supply, Capacity & Utilization |
| 6 | Supply-Demand Balance & Pricing |
| 7 | Industry Chain Map |
| 8 | Value Capture & Industry Economics |
| 9 | Competitive Landscape |
| 10 | Technology & Product Roadmap |
| 11 | Company Mapping & Exposure |
| 12 | Catalysts |
| 13 | Risks & Invalidation Conditions |
| 14 | Key Metrics & Monitoring |
| 15 | Research Gaps & Alternative Views |
| 16 | Methodology & Provenance |

Report sections are assembled by code from validated semantic output.

LLM output does not own the final report structure.

A Report may contain substantially more information than is persisted into canonical Knowledge.

---

# 17. Company Research Boundary

Industry Deep Research may read existing Company Knowledge.

It may identify and map companies.

It must not automatically execute:

Company Deep Research;

Earnings Review;

Valuation;

Event Research;

Thesis Red Team

for every mapped company.

Doing so would create uncontrolled nested workflows and dramatically increase research cost and mutation scope.

Industry Research instead creates bounded company mappings and Research Gaps.

The user or Pi host may subsequently launch Company Research for selected companies.

This preserves clear vertical boundaries.

---

# 18. Daily Intelligence Boundary

Industry Research is not a scheduled intelligence system.

It may consume relevant existing ResearchSignals as contextual leads but Signals do not become evidence automatically.

Daily Intelligence remains responsible for change discovery and scheduled monitoring.

Industry Research is responsible for deep structural research.

Future Daily Intelligence may use the resulting Industry graph to improve company/industry relevance, but that integration is outside M3B v0.1.

---

# 19. Knowledge Graph Integration

M3B does not introduce a new graph database or Industry Graph frontend.

Canonical Industry, Product, Technology, Company and Relation objects automatically become part of the existing Knowledge graph.

The existing graph projection/read layer remains the presentation authority.

M3B implementation acceptance must prove that newly produced Industry Knowledge can be queried and projected through the existing Graph path without a dedicated parallel graph store.

---

# 20. Module Persistence Decision

Existing canonical `Module` objects are not used as the primary Industry Research persistence model in v0.1.

Market, competition, capacity and supply-chain tables may exist in the Research Report.

Canonical semantic truth remains in:

Entity;

Relation;

Claim;

Source.

A future product requirement may justify richer Module persistence, but M3B does not introduce a separate Module production path solely because the type exists.

---

# 21. Failure and Partial Evidence Semantics

Missing evidence must not cause fabricated completeness.

Industry Definition is mandatory because the research target must be semantically bounded.

Other modules may be:

supported;

partial;

unavailable.

The report must explicitly show Research Gaps.

An unavailable market-size estimate is preferable to an unsupported numeric value.

A module reasoning failure may receive at most one bounded semantic repair.

Repeated invalid output fails closed for that module.

No deterministic code may synthesize missing model analysis merely to satisfy a completion count.

---

# 22. Idempotency Requirements

Industry Research introduces a stronger graph-level idempotency requirement.

Repeated equivalent research must not create duplicate:

Industry Entities;

Product Entities;

Technology Entities;

Company Entities;

Relations;

same-slot Claims.

Exact Relations should bind to existing canonical Relations and merge valid evidence.

Changed temporal observations should follow existing Claim supersession/conflict semantics.

Industry root identity must remain stable across workflow runs.

---

# 23. Real Pi Acceptance

M3B requires actual PiReasoningExecutor validation.

A recommended first real acceptance target is an A-share-relevant industrial chain with enough observable structure to exercise Industry, Product, Technology and Company mapping, such as the PCB industry with AI-server/HDI context.

The real gate must prove:

actual Pi execution;

valid Industry target resolution;

all eight methodology modules represented;

no fabricated required numeric data;

qualified source provenance;

at least one durable cross-industry or chain Relation where the selected case supports it;

at least one evidence-backed Company exposure where the selected case supports it;

durable Claims;

one Gateway submission;

one Writer commit;

canonical Source/Raw provenance;

target Industry identity stability;

successful existing Knowledge Graph projection;

16-section persisted report;

no secret/raw-body leakage into reasoning telemetry.

A separate deterministic replay gate must prove that replaying the accepted semantic bundle cannot duplicate canonical entities, Relations or same-slot Claims.

Stochastic second-model-run equality is not the idempotency authority.

---

# 24. M3B Implementation Sequence

Architecture implementation proceeds in four controlled stages.

| Stage | Objective |
|---|---|
| M3B-0 | Freeze Industry Deep Research Architecture v0.1 |
| M3B-1 | Close producer-neutral Knowledge Gateway gaps required by Industry research |
| M3B-2 | Implement Industry Research Skill + Industry Deep Research Workflow + deterministic tests |
| M3B-3 | Add/compose bounded free acquisition coverage, Application action, Real Pi E2E and Graph acceptance |

Each stage requires separate engineering acceptance.

M3B-2 must not start until M3B-1 passes independent CTO review.

M3B-3 must not weaken semantic or provenance gates merely because public-source acquisition is incomplete.

---

# 25. Explicit Non-Goals

Theme Framework remains deferred.

Industry portfolio construction is not part of M3B.

Automatic stock recommendation/ranking is not part of M3B.

Automatic execution of Company Research for every Industry constituent is not part of M3B.

Consensus datasets are not fabricated.

A generic Research Planner is not introduced.

A generic ontology engine is not introduced.

A graph database is not introduced.

A vector database is not introduced.

Knowledge Schema 0.5 is not introduced.

Storage Format 2 is not introduced.

Writer authority is unchanged.

---

# 26. Frozen Architectural Invariant

The central M3B invariant is:

```text
Industry Research
does not produce a report and separately maintain a private industry graph.

Industry Research produces one evidence-backed semantic research state.

That state has two projections:

Canonical Knowledge
    → reusable machine-readable Industry Knowledge Network

Research Report
    → user-readable Industry Deep Research
```

The Report and Knowledge graph therefore derive from the same validated research semantics.

This is the foundation for later Industry Graph, Theme Research, cross-company reasoning and continuous research maintenance.
