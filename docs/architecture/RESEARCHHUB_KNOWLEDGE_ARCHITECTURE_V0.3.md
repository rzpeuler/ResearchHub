# RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3

## Status

**Frozen / Sol Accepted**

- Knowledge Schema Version: `0.3`
- Storage Format Version: `1`
- v0.2 remains frozen legacy architecture and MUST NOT be rewritten.
- v0.3 supersedes v0.2 only for Knowledge semantic model, relation vocabulary, Schema 0.3 durable identity policy, curation architecture, and report-ingestion behavior.
- v0.2 decisions for KB instance isolation, runtime-data separation, Raw ownership, provenance, registry, compatibility, migration, validation/write atomicity, and Git/runtime-data boundary remain valid.
- Runtime migration to v0.3 remains separate from this architecture decision and has not started.
- Sol/CTO independently verified commit `47e312f79a221d7dd45b42508e52526fd61b1a74`.
- This document defines the current normative Knowledge architecture; runtime migration to v0.3 remains a separate, not-yet-started engineering track.

## 1. Purpose

Knowledge Architecture v0.3 evolves ResearchHub from a generic Knowledge container into an investment-research semantic knowledge system.

Primary product behavior:

> A user submits research material. ResearchHub understands the report, extracts durable investment knowledge, reconciles it with the current Knowledge Base, and safely writes canonical Knowledge without requiring the user to manually classify ordinary reports.

The user is not expected to select an Investment Theme before ingestion.

## 2. Responsibility Boundary

### Research Semantics — LLM Curation

Responsible for:
- report understanding
- source semantic assessment
- identifying material information
- semantic classification
- Entity / Relation / Claim extraction
- schema-aware mapping proposals
- reconciliation of new and existing Knowledge
- conflict/update/divergence/supersession interpretation
- report-level Theme understanding

### Knowledge Integrity — deterministic infrastructure

Responsible for:
- KB scope
- canonical IDs and refs
- Raw ownership
- Source/Raw binding
- revision control
- validation
- registry integrity
- atomic write
- migration
- recovery
- idempotency

### Workflow

Provides the deterministic research SOP that orders these operations.

> LLM is the Research Semantics Authority. Deterministic infrastructure is the Knowledge Integrity Authority.

## 3. Knowledge Base Model

A Knowledge Base is a user's independent research knowledge space and is NOT an Investment Theme.

One KB may contain many Investment Themes. One report may contribute Knowledge to one or multiple Themes. No automatic cross-KB federation is introduced.

## 4. Canonical Knowledge Object Model

### Canonical object kinds

The Schema 0.3 canonical object kinds are exactly:

- ThemeGroup
- Entity
- Relation
- Claim
- Source
- Module
- RawRef

Entity semantic subtypes are `investment_theme`, `industry`, `company`,
`product`, and `technology`.

`Taxonomy` and `View` are not canonical object kinds.

### Auxiliary assets

Legacy or external taxonomy is preserved as an auxiliary Reference Taxonomy
Asset. It supports external classification systems and is not a ThemeGroup,
Entity, canonical graph node, Relation endpoint, or default Curation output.
When present, an Entity's `taxonomyRefs` contains only resolvable stable IDs
of these auxiliary taxonomy items; it does not replace canonical graph
semantics.

Legacy `views/` entries are preserved as auxiliary Projection Configuration
Assets. They configure frontend/read-model behavior and are not canonical
Entity, Relation, Claim, or Module objects.

Conceptual graph:

```text
ThemeGroup
    │ navigation 1:N
    ▼
InvestmentTheme
    │ N:M theme_exposure
    ▼
Industry
    ▲
    │ N:M business_exposure
    │
Company

Company ── offers_product ──► Product
Company ── develops_technology ──► Technology
Product ── uses_technology ──► Technology
Technology ── applied_in ──► Industry
```

Claims attach research assertions to Entities and Relations. Sources and Raw preserve provenance.

## 5. ThemeGroup

ThemeGroup is navigation taxonomy, not a core Entity and not an external or
Reference Taxonomy item.

Rules:
- every InvestmentTheme MUST belong to exactly one ThemeGroup
- ThemeGroup → InvestmentTheme is strictly 1:N
- ThemeGroup is navigation, not economic ontology
- cross-domain semantics belong in the Knowledge Graph
- ThemeGroup values are runtime KB data, not Schema enums
- a fallback `Unclassified / 未分类` MAY exist

## 6. InvestmentTheme

InvestmentTheme represents an investment-research theme driven by common investment logic, technology cycles, demand cycles, capex cycles, or structural change.

Examples: AI Hardware, Humanoid Robotics, Solid-state Battery, Data Center Infrastructure.

It replaces the semantic role of v0.2 `industry`.

Recommended fields:
- id
- type = investment_theme
- name
- aliases
- definition
- themeGroupRef
- inclusionCriteria
- exclusionCriteria
- lifecycle

## 7. Industry

Industry represents an independently researchable economic/industrial-chain activity.

Examples: GPU, HBM, PCB, CCL, Copper Foil, Optical Module, AI Server, Data Center Cooling.

It replaces the semantic role of v0.2 `segment`.

InvestmentTheme ↔ Industry is many-to-many. Industry is distinct from external securities taxonomies such as Shenwan.

## 8. Company Business Exposure

Company ↔ Industry is many-to-many through:

```text
Company ── business_exposure ──► Industry
```

At most one active canonical business_exposure per Company–Industry pair.

### exposureBasis
- direct_operation
- controlled_subsidiary
- non_controlling_investment
- joint_venture
- project_investment
- strategic_cooperation
- announced_transaction
- other
- unknown

### realizationStage
- announced
- transaction_pending
- pre_revenue
- commercialized
- reported
- unknown

### materiality
- core
- material
- minor
- immaterial
- unknown

### financialContribution
May include period, revenueAmount, revenueShare, profitAmount, profitShare, currency, separatelyReported. Unknown values remain null.

A business_exposure MAY reference supporting Claims.

## 9. Concept Exposure

“Concept stock” is NOT canonical Knowledge.

Frontend may derive Core / Substantial / Emerging / Concept Exposure from Business Exposure attributes. Changing these projection rules must not require Schema migration.

## 10. Claim

Claim replaces v0.2 Intelligence.

Claim types:
- fact
- forecast
- viewpoint
- trend
- risk

A Claim is an atomic research proposition with explicit subjects, temporal meaning, and evidence.

Core fields:
- id
- claimType
- statement
- subjectRefs
- optional primarySubjectRef
- temporal
- optional structuredValue
- sourceRefs
- optional precise provenance
- confidence
- lifecycle
- supersedes / supersededBy

`statement` is first-class.

## 11. Claim Reconciliation

Facts seek consistency. Forecasts and Viewpoints may legitimately diverge. Material semantic changes SHOULD create a new Claim with supersession rather than silently rewriting history.

## 12. Relation Philosophy

```text
Event / assertion / forecast / interpretation → Claim
Durable structural state → Relation
```

## 13. Canonical Relation Vocabulary

- theme_exposure
- business_exposure
- upstream_of
- supplier_of
- competes_with
- owns_stake_in
- offers_product
- belongs_to_industry
- component_of
- develops_technology
- uses_technology
- applied_in
- depends_on
- substitutes_for

Retired writable v0.2 Relations:
- contains
- downstream_of
- customer_of
- substitute_for
- operates_in
- partner_of
- invested_in

Inverse query vocabulary MAY remain available without duplicate canonical edges.

## 14. Durable Identity

v0.3 separates durable object identity from semantic subtype.

Schema 0.3 canonical durable IDs MUST use object-kind namespaces. The sole
normative authority for this policy is `KNOWLEDGE_DATA_SCHEMA_V0.3.md`:

- `entity:`
- `relation:`
- `claim:`
- `source:`
- `module:`
- `theme-group:`

The frozen `RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1.md` is unchanged
and remains normative only for Schema `<= 0.2`. Auxiliary Reference Taxonomy
and Projection Configuration Asset IDs are outside this canonical namespace
requirement. No v0.3 duplicate naming-convention document is created.

Durable IDs MUST NOT change solely because of rename, subtype reclassification, description change, taxonomy reassignment, metadata update, Claim confidence change, or Relation attribute change.

## 15. Canonical Executable Schema

One runtime-readable canonical structural definition is the Knowledge structural authority.

It defines object kinds, types, fields, enums, relation endpoints, cardinality, semantic descriptions, and constraints.

TypeScript types, deterministic validation, LLM Schema Context, migration tooling, and schema-context serialization SHOULD derive from this authority wherever practical.

## 16. Schema Context for LLM

Any LLM operation that depends on Schema MUST receive explicit current Schema Context.

Operation slices:
- report understanding → Source + Theme semantics
- extraction → Entity + Relation + Claim + Business Exposure
- reconciliation → lifecycle/state/conflict semantics
- schema gap → broader current schema

Prompts MUST NOT independently own canonical enum definitions.

## 17. Knowledge Curation Skill

One Curation Skill remains the professional reasoning boundary.

v0.3 operations:
- understandReport
- extractKnowledge
- reconcileKnowledge
- analyzeSchemaGaps

No Schema Agent, Schema Manager, Curation Manager, or Knowledge Manager is introduced.

## 18. Research Report Ingestion Workflow v0.3

```text
[0] Intake
[1] Resolve Research KB
[2] Document Resolution
[3] Raw Archive
[4] Report Understanding
[5] Theme Handling
[6] Relevant KB Context Retrieval
[7] Section Batching
[8] Schema-aware Batched Extraction
[9] Candidate Consolidation
[10] Deterministic Reference Resolution
[11] Existing Knowledge Retrieval
[12] Batched Reconciliation
[13] Conditional Schema Gap Analysis
[14] Review Isolation / ChangeSet Planning
[15] Deterministic Validation
[16] Atomic Write
[17] Result / Projection
```

Standalone relevance filtering, per-candidate admission, standalone mapping, and per-candidate conflict analysis are retired.

## 19. Compatibility

Schema 0.3 / Storage 1:
- readable
- writable when KB status permits

Schema 0.2 / Storage 1:
- readable through compatibility
- not writable by v0.3 semantic writer
- explicit migration available

Mixed active v0.2/v0.3 canonical semantic state is forbidden. Preserved
Reference Taxonomy Assets, Projection Configuration Assets, Raw evidence, and
historical logs do not constitute mixed semantic state after their declared
canonical references have been deterministically rewritten and validated.

## 20. Migration

Migration 0.2 → 0.3 is explicit and supports dry-run, staging, complete ID
mapping before reference rewriting, legacy Taxonomy/View asset preservation,
auxiliary-reference validation, warnings, MigrationReviewItems, target
validation, atomic commit, and revision increment only after successful
semantic migration. Taxonomy is never automatically converted to ThemeGroup;
View is never automatically converted to Module; opaque strings are never
rewritten heuristically.

LLM MUST NOT silently resolve migration ambiguity.

## 21. Storage Format

```text
schemaVersion: 0.2 → 0.3
storageFormatVersion: 1 → 1
```

Raw storage architecture remains unchanged.

## 22. Frontend Projection

Frontend consumes:

```text
Knowledge Base
→ Loader / Adapter
→ Runtime Knowledge Model
→ Knowledge Access
→ Projection
→ Frontend
```

Frontend MUST NOT mutate canonical Knowledge merely to support display.

## 23. Architecture Boundaries

v0.3 does NOT introduce:
- Multi-Agent architecture
- Planner
- Workflow Engine
- Workflow Composition Engine
- Knowledge Agent
- Schema Agent
- Schema Manager
- Curation Manager
- Knowledge Manager
- Graph DB requirement
- Vector DB requirement
- RAG requirement
- autonomous Schema modification
- automatic semantic migration
- hidden background ingestion

ResearchHub continues to use single DSH + Workflow + Skill + Plugin + deterministic Knowledge infrastructure.

## 24. Governance

```text
Schema Gap
→ Architecture Review
→ Schema Design
→ Compatibility Analysis
→ Migration Design
→ Schema Freeze
→ Engineering
```

Schema v0.4 is NOT approved. This document is Frozen / Sol Accepted; runtime
implementation status is governed separately.
