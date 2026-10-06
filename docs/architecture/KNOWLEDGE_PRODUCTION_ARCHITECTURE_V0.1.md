# ResearchHub Knowledge Production Architecture v0.1

## 1. Status

Status: **FROZEN**

Version: **v0.1**

This document defines the long-term architectural boundary for producing, resolving, validating, and committing Knowledge into the ResearchHub Global KnowledgeBase.

It complements, and does not replace:

- Knowledge Architecture Lite;
- Knowledge Resolution Architecture;
- Raw Document Ingestion Workflow Architecture;
- active Knowledge Schema definitions.

This document freezes architectural responsibilities and interfaces.

It does not freeze concrete class names, directory placement, plugin naming, TypeScript method signatures, or the final implementation shape of the producer-facing facade.

## 2. Purpose

ResearchHub Knowledge must be producible by more than Raw Document Ingestion.

Future Knowledge Production Workflows may actively research:

- an InvestmentTheme;
- an Industry;
- a Company;
- a Product;
- a Technology;
- an earnings event;
- a supply/demand structure;
- a competitive landscape;
- or other future research objectives.

Knowledge Production Architecture must therefore support an open set of research workflows without allowing every workflow to implement its own:

- canonical identity rules;
- Knowledge Schema;
- Knowledge Resolution;
- mutation semantics;
- storage logic;
- Writer.

The architecture must also permit governed Knowledge Schema evolution without requiring unrelated Skills and Workflows to be modified for every additive Schema change.

## 3. Core Principle

Knowledge Production Workflows are an open set.

Knowledge Integrity Authority is singular.

Conceptually:

```text
Knowledge Production Workflows
            ↓
Producer-facing Knowledge Production Gateway
            ↓
Schema Projection
Semantic Knowledge Proposal
Canonical Binding
Knowledge Diff
Semantic Resolution
Resolution Intent
Review
ChangeSet Planning
Validation
            ↓
Single Writer
            ↓
Global KnowledgeBase
```

The producer-facing boundary should appear as one coherent Knowledge system to Workflows.

Internally, Schema interpretation, semantic proposals, resolution, validation, mutation authorization, and writing remain separate responsibilities.

## 4. Open Knowledge Production Model

The architecture **MUST NOT** define a fixed number of Knowledge Producers.

Known and foreseeable examples include:

- Raw Document Ingestion;
- Theme Framework Construction;
- Industry Deep Research;
- Company Deep Research;
- Earnings Research;
- Technology Research;
- Product Research;
- Event Research;
- Supply/Demand Research;
- Competitive Landscape Research.

This list is illustrative, not exhaustive.

Adding a new Knowledge Production Workflow must not require a redesign of the global Knowledge architecture.

## 5. One Global KnowledgeBase

All Knowledge Production Workflows operate against the same Global KnowledgeBase.

ResearchHub **MUST NOT** create independent Theme-specific, Industry-specific, Company-specific, or Workflow-specific Knowledge silos.

Canonical Knowledge is global.

For example:

- a Company is represented once;
- an Industry is represented once;
- a Product is represented once;
- an `upstream_of` relation is global;
- a Company-to-Industry `business_exposure` is global.

Different research workflows may add evidence, enrich state, introduce new relationships, or create supported new Knowledge, but they must resolve against existing canonical Knowledge before mutation.

## 6. Bottom-up and Top-down Knowledge Production

ResearchHub supports complementary production directions.

### 6.1 Bottom-up Evidence Ingestion

Raw Document Ingestion is source-bounded.

Its question is:

> What Knowledge is supported by this supplied source?

It must not infer that one supplied document represents a complete Theme, Industry, or research universe.

Raw Ingestion therefore remains evidence-grounded and boundary-limited.

### 6.2 Top-down Research Construction

Research Workflows may be objective-bounded.

Their question may be:

> What Knowledge structure is required to understand this research objective?

Examples include:

- constructing an AI compute InvestmentTheme framework;
- deeply researching the PCB Industry;
- deeply researching a Company.

Such workflows may actively gather multiple sources and fill structural research gaps.

They remain evidence-grounded, but their research boundary is defined by the research objective rather than by one supplied source.

## 7. Theme Architecture

InvestmentTheme is a semantic research overlay over the Global Knowledge Graph.

It is not a Knowledge container.

Theme structure is represented using canonical Knowledge, principally:

```text
InvestmentTheme
    ↓ theme_exposure
Industry
```

and globally reusable Industry relations such as:

```text
Industry
    ↓ upstream_of
Industry
```

and Company exposure:

```text
Company
    ↓ business_exposure
Industry
```

A Theme Framework is therefore a projection over canonical Knowledge.

`ThemeFramework` **MUST NOT** be introduced merely as a duplicate canonical graph or independent Knowledge container.

## 8. Theme Creation Authority

Theme creation authority belongs to Workflow intent, not to the reasoning model itself.

Raw Document Ingestion does not possess authority to automatically create a new InvestmentTheme.

A potential new InvestmentTheme discovered during Raw Ingestion is reviewable Knowledge Production output.

A future Theme Framework Construction Workflow explicitly initiated to build a Theme may possess authority to propose or create that Theme through the normal Knowledge Integrity Path.

Explicit research intent does not bypass:

- canonical binding;
- ambiguity handling;
- validation;
- ChangeSet;
- Writer.

A potential Theme discovered from one document should normally lead to a **Build Theme** research action rather than directly treating one document as the complete Theme framework.

## 9. Producer-facing Knowledge Gateway

Knowledge Production Workflows should interact with Knowledge through one coherent producer-facing architectural boundary.

This boundary is referred to conceptually as the:

> **Knowledge Production Gateway**

The name, directory, plugin/module classification, and concrete API are **NOT** frozen by v0.1.

Its architectural purpose is frozen.

A Workflow should not need to understand or directly coordinate:

- concrete Schema implementation files;
- Schema version-specific TypeScript types;
- storage layout;
- registry layout;
- canonical ID allocation;
- Writer internals;
- ChangeSet validation internals;
- mutation locks.

Conceptually, the Gateway must support the lifecycle of:

```text
prepare production
→ perform semantic research
→ submit semantic production result
→ receive resolution / review / write outcome
```

Explicit user curation may enter the same Knowledge system through a curation operation without pretending to be LLM-generated semantic research.

## 10. One External Boundary, Multiple Internal Boundaries

A single producer-facing Gateway **MUST NOT** collapse internal Knowledge safety boundaries.

Internally, the system must continue to distinguish:

1. Schema Projection;
2. Semantic Knowledge Proposal;
3. Knowledge Resolution / Integrity;
4. ChangeSet Validation;
5. Writer authorization.

In particular:

> Semantic Proposal != canonical mutation.

> Unvalidated ChangeSet != write authority.

Writer **MUST NOT** accept raw reasoning output or arbitrary Workflow payloads.

## 11. Active Knowledge Schema

Every Knowledge Production Workflow operates against an Active Knowledge Schema.

Schema 0.3 is the current active implementation baseline.

Schema 0.3 is **NOT** declared to be the permanent final ResearchHub Knowledge model.

Future governed Schema versions may add:

- fields;
- vocabulary;
- Entity subtypes;
- Relations;
- constraints;
- canonical Knowledge kinds;
- structures required by Industry, Company, Earnings, Financial, or other research workflows.

## 12. Central Schema Authority, Local Projection

Schema is centrally authoritative and locally projected.

Skills and Workflows should not permanently depend on concrete Schema implementation files or specific version-bound type names when that dependency can be replaced by an explicit Schema Projection.

Conceptually:

```text
Active Knowledge Schema
        ↓
Production Schema Profile
        ↓
Scoped Schema Projection
        ↓
Workflow / Skill
```

A Producer receives only the Schema capabilities relevant to that Production Workflow.

## 13. Production Schema Profile

Every Knowledge Production Workflow design must define the subset of the Active Schema it reads and/or produces.

This architectural description is called a **Production Schema Profile**.

It may identify:

- canonical kinds;
- Entity types;
- Relation types;
- Claim types;
- fields;
- constraints;
- other future Schema capabilities.

This is not a generic permission engine.

It is a lightweight statement of which parts of the Active Schema are relevant to a Workflow.

## 14. Schema-driven Semantic Contracts

Where practical, the following should be derived from the Active Schema Projection rather than manually duplicated in individual Skills:

- allowed Entity types;
- Relation vocabulary;
- Relation endpoint constraints;
- Relation attributes;
- Claim vocabulary;
- field definitions;
- enums;
- numeric constraints;
- structured-output constraints.

The current Knowledge Curation schema-context mechanism is considered an implementation precursor to this architecture, not the final universal interface.

## 15. Additive Isolation

An additive Schema capability should not force unrelated existing Workflows or Skills to change.

For example:

if a future Schema introduces `FinancialMetric` and Raw Document Ingestion or Theme Framework Construction does not consume `FinancialMetric`, those Workflows should not require modification solely because `FinancialMetric` exists.

Only:

- shared Knowledge Domain support required by the new capability;
- Kind-specific integrity semantics;
- and Producers consuming that capability

should normally require implementation changes.

## 16. Semantic Knowledge Proposal Boundary

Reasoning-driven Knowledge Production Workflows must not directly construct canonical mutations.

They produce semantic Knowledge proposals.

Current Schema 0.3 examples include:

- EntityCandidate;
- RelationCandidate;
- ClaimCandidate.

These current Candidate types are concrete implementations of the broader architectural concept:

> **Semantic Knowledge Proposal**

The architecture **MUST NOT** permanently assume that all future Knowledge proposals are limited to Entity, Relation, and Claim.

Future Schema evolution may introduce additional proposal kinds.

A common proposal envelope may be shared, but Schema-defined semantic payloads should remain typed and validated rather than being reduced to an unrestricted arbitrary JSON mutation format.

## 17. Evidence Binding

Semantic Knowledge Proposals must remain evidence-grounded according to the Evidence Policy of their Workflow.

Current Raw Ingestion uses StructuredDocument Block provenance.

Future research workflows may use multiple evidence forms.

The architecture therefore does not permanently require every future Producer to use document block IDs.

Future producer-neutral proposal/evidence interfaces may support evidence bindings appropriate to:

- Raw Document blocks;
- web source fragments;
- official sources;
- other research sources;
- existing Knowledge references;
- other governed evidence forms.

The exact generalized `EvidenceBinding` implementation is **NOT** frozen in v0.1.

## 18. Shared Knowledge Integrity Path

All reasoning-driven Knowledge proposals must eventually pass through the shared Knowledge Integrity Path.

Conceptually:

```text
Semantic Knowledge Proposal
        ↓
Proposal Validation
        ↓
Canonical Binding
        ↓
Knowledge State Diff
        ↓
bounded Semantic Resolution where needed
        ↓
deterministic Resolution Policy
        ↓
Resolution Intent
        ↓
ChangeSet Planning
        ↓
ChangeSet Validation
        ↓
Writer
```

Producer-specific semantic methodology must not replace the shared integrity authority.

## 19. Resolution Semantics

Knowledge Resolution is a long-lived architectural concept.

Specific resolution implementations may evolve with Schema kinds.

Core questions remain:

- does this Knowledge already exist?
- is it new?
- is it enrichment?
- is it a state change?
- does it coexist?
- does it contradict existing Knowledge?
- does it supersede existing Knowledge?
- is it invalid?
- must it be reviewed?

Schema expansion may require Kind-specific identity and diff semantics.

The architecture does not require all future kinds to share identical binding or diff algorithms.

## 20. Schema Evolution Governance

Schema evolution is allowed.

Autonomous Schema evolution by a Producer is forbidden.

If a Workflow discovers that required research Knowledge cannot be represented by the Active Schema, it must not invent an ungoverned canonical structure.

The condition should be surfaced as a Schema gap or design requirement.

A governed Schema change may then introduce the required structure.

All Producers subsequently consume the new Active Schema through the common Schema access/projection boundary.

## 21. Schema Change Locality

The architecture should minimize the project-wide engineering impact of Schema evolution.

Schema changes are conceptually classified as:

### S1 — Vocabulary Extension

Examples:

- new Claim type;
- new enum value;
- new Relation vocabulary where existing generic semantics are sufficient.

Expected blast radius:

> minimal.

### S2 — Existing Kind Field Extension

Examples:

- new Company field;
- new Industry field.

Expected blast radius:

> Schema + affected Kind semantics + Producers using the field.

### S3 — Semantic Type Extension

Example:

- new Entity subtype requiring distinct identity or diff rules.

Expected blast radius:

> Schema + new subtype integrity semantics + Producers using the subtype.

### S4 — Canonical Kind Extension

Examples:

- future FinancialMetric;
- Forecast;
- Observation;
- other future canonical kinds.

Expected blast radius:

> shared Knowledge Domain support for the new kind + relevant storage/validation/resolution/mutation support + Producers consuming the kind.

Unrelated Producers should remain unchanged.

### S5 — Storage Format Change

A storage format migration is distinct from semantic Schema evolution and requires explicit migration governance.

## 22. Stable Mutation Boundary

All Knowledge mutation ultimately passes through:

```text
Validated ChangeSet
        ↓
Writer
```

This remains the common final write boundary for:

- Raw Ingestion;
- Theme Research;
- Industry Research;
- Company Research;
- future research workflows;
- explicit user curation.

Writer remains infrastructure-owned.

The Writer must not become Producer-specific.

## 23. User Curation

Explicit user decisions are not required to masquerade as LLM-generated proposals.

Examples include:

- resolving a Review;
- choosing between ambiguous existing Knowledge;
- moving an InvestmentTheme between ThemeGroups;
- taxonomy management;
- explicit approved corrections.

Such decisions may produce explicit curation/mutation intent.

They still must pass through:

```text
ChangeSet
→ Validation
→ Writer
```

## 24. Durable Review

Review is shared Knowledge Production governance.

It is not a Raw Ingestion-only telemetry feature.

Any Knowledge Production Workflow may produce unresolved or ambiguous output requiring durable Review.

Review must remain separate from canonical Knowledge until a valid Knowledge decision is made.

Future Review architecture must therefore support multiple Knowledge Production Workflows.

## 25. Knowledge Production Workflow Design Contract

Every future Knowledge Production Workflow must explicitly define:

### Production Objective

What Knowledge-producing objective does the Workflow serve?

### Research Boundary

What limits the research scope?

Examples:

- one supplied source;
- a Theme;
- an Industry;
- a Company;
- an event;
- another research objective.

### Evidence Policy

What evidence is required to produce Knowledge?

### Production Schema Profile

Which Active Schema capabilities may the Workflow consume or produce?

### Mutation Authority

Which classes of proposed changes may proceed automatically and which require Review?

### Completion Criteria

What constitutes adequate completion of the research objective?

## 26. Research Outputs

A future deep-research Workflow may produce both:

1. structured canonical Knowledge;
2. a human-readable Research Report or other research output.

Knowledge Production Architecture does not require the human-readable report to be identical to canonical Knowledge.

The future canonical/non-canonical status and storage model of research reports is outside the scope of v0.1.

This architecture must not prevent such future outputs.

## 27. Implementation Timing

Knowledge Production Architecture v0.1 freezes the target boundaries.

It does **NOT** require immediate refactoring of the currently validated Raw Document Ingestion implementation.

Current Raw Ingestion may continue using its existing:

- Knowledge Curation contracts;
- Schema 0.3 types;
- Candidate structures;
- Raw-specific evidence model;
- current Knowledge Resolution;
- current ChangeSet Planner.

The first implementation of a second materially different Knowledge Producer should be used to discover actual reusable seams.

Only then should common implementation be extracted.

## 28. No Premature General Framework

v0.1 explicitly rejects speculative implementation of:

- generic KnowledgeProducer framework;
- Producer registry;
- Capability framework;
- policy engine;
- universal Kind handler registry without demonstrated need;
- generic Workflow engine;
- untyped generic mutation payload;
- autonomous Schema extension.

The architecture prefers narrow interfaces extracted from demonstrated duplication.

## 29. Producer-facing Interface Direction

The long-term producer-facing interface should behave as one coherent Knowledge system.

Conceptually it may support operations equivalent to:

- prepare;
- submit;
- curate.

These names are illustrative only.

Concrete API shape is deferred until a second real Producer is implemented.

The architectural invariant is:

> Workflows interact with one coherent Knowledge boundary; internal Knowledge safety responsibilities remain separate.

## 30. Frozen Principles

### KPA-1 — Open Production Model

Knowledge Production Workflows are an open set.

### KPA-2 — Global KnowledgeBase

All Producers resolve into one Global KnowledgeBase.

### KPA-3 — Workflow-specific Research Semantics

Different Workflows may use different research methods, evidence policies, research depth, and completion criteria.

### KPA-4 — Single Producer-facing Knowledge Boundary

Knowledge Production Workflows should interact with one coherent Knowledge Production Gateway / facade rather than coordinating Knowledge internals themselves.

### KPA-5 — Internal Authority Separation

A single producer-facing boundary must not collapse Schema, Proposal, Resolution, Validation, and Writer responsibilities.

### KPA-6 — Theme as Overlay

InvestmentTheme is a semantic research overlay on the Global Knowledge Graph, not a Knowledge container.

### KPA-7 — Bottom-up and Top-down Complementarity

Source-bounded ingestion and objective-bounded research construction are complementary Knowledge production mechanisms.

### KPA-8 — Central Schema Authority

There is one governed Active Knowledge Schema authority.

### KPA-9 — Scoped Schema Projection

Skills and Workflows consume the Schema capabilities relevant to their Production Schema Profile.

### KPA-10 — Additive Isolation

Additive Schema capabilities should not require unrelated Producers to change.

### KPA-11 — Schema-driven Contracts

Schema vocabulary and structural constraints should be projected into Skill/Workflow contracts wherever practical rather than duplicated manually.

### KPA-12 — Semantic Proposal Boundary

Reasoning output is a semantic proposal, not canonical mutation authority.

### KPA-13 — Shared Integrity Authority

Canonical binding, diff, resolution, mutation planning, validation, and Writer authority remain shared Knowledge responsibilities.

### KPA-14 — Stable Writer Boundary

All final mutations require validated ChangeSet authorization before Writer commit.

### KPA-15 — Governed Schema Evolution

Schema may evolve, but Producers may not autonomously extend canonical Schema.

### KPA-16 — Future Schema Extensibility

Knowledge Production Architecture does not permanently limit canonical Knowledge to the kinds present in Schema 0.3.

### KPA-17 — Shared Durable Review

Review is common Knowledge Production governance rather than Workflow-local telemetry.

### KPA-18 — Explicit User Curation

Explicit user decisions may create validated curation intent without being converted back into LLM-generated Candidates.

### KPA-19 — No Premature Producer Framework

Common implementation is extracted from demonstrated reuse, not created speculatively.

### KPA-20 — Knowledge Producer Portability

Future Producers should depend on the producer-facing Knowledge contract and relevant Schema capabilities rather than storage, Writer, or concrete Schema implementation details.

## 31. Non-Goals

Knowledge Production Architecture v0.1 does not define:

- Theme Framework Workflow implementation;
- Industry Deep Research implementation;
- Company Deep Research implementation;
- universal KnowledgeGateway TypeScript interface;
- generalized EvidenceBinding implementation;
- universal Proposal TypeScript hierarchy;
- new canonical Schema kinds;
- Review persistence implementation;
- frontend behavior;
- report storage architecture;
- Schema migration implementation.

These require separate future designs.

## 32. Compatibility with Current ResearchHub

Current ResearchHub remains valid.

The existing architecture already preserves several required boundaries:

- Workflow owns deterministic control;
- Skill owns semantic methodology;
- Reasoning host has no mutation authority;
- Knowledge Domain owns deterministic integrity;
- canonical IDs are infrastructure-owned;
- ChangeSet is validated before writing;
- Writer is atomic;
- replay/idempotency protects duplicate commits.

Knowledge Production Architecture v0.1 extends these principles to future Knowledge-producing Workflows without invalidating the accepted Raw Document Ingestion implementation.
