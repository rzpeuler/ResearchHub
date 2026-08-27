# KNOWLEDGE_FRONTEND_PROJECTION_V0.3

## Status

**Freeze Candidate / Sol Verification Pending**

- Version: `v0.3`
- Knowledge Schema Dependency: `0.3`
- Canonical Knowledge mutation by Projection: Forbidden
- v0.2 remains the current frozen normative contract until Sol acceptance and governance integration.

## 1. Purpose

Defines how canonical ResearchHub Knowledge becomes user-facing directories, graphs, filters, company views, Claim views, forecast/risk views, and provenance inspection.

> Directory and visualization are projections of Knowledge, not the Knowledge model itself.

## 2. Boundary

```text
Knowledge Base
→ Loader / Schema Adapter
→ Runtime Knowledge Model
→ Knowledge Access
→ Projection
→ Frontend
```

Frontend MUST NOT write canonical Entity/Relation/Claim objects, add canonical fields for display convenience, mutate Theme membership, write `isConceptStock`, or persist duplicate inverse Relations.

`Module` is a supported canonical Knowledge Object. A Projection Configuration
Asset is non-canonical frontend/read-model configuration; legacy `views/*.yaml`
belongs to this auxiliary asset boundary and is not a View Knowledge Object.

## 3. Projection Responsibilities

Projection MAY group, sort, aggregate, filter, derive classifications, create graph nodes/edges, compute summaries, expose inverse views, build timelines/comparisons, and derive Theme relevance.

These are read models, not canonical truth.

## 4. Canonical vs Derived

Canonical:
- ThemeGroup
- InvestmentTheme
- Industry
- Company
- Product
- Technology
- business_exposure
- theme_exposure
- Claim
- Source
- Raw provenance

Derived:
- Concept Stock
- Core Business badge
- Emerging Business badge
- Theme company ranking
- chain lanes
- downstream/customer views
- forecast range/median
- risk counts
- chart display metadata

Derived semantics MUST be reproducible from canonical data + explicit Projection rules.

## 5. Primary Navigation

Recommended navigation:
- Investment Themes
- Companies
- Industries
- Products / Technologies
- Claims / Research Findings
- Sources

Theme directory is two-level:

```text
ThemeGroup
  ↓
InvestmentTheme
```

Each Theme appears once in directory navigation. Graph multi-parent semantics do not create duplicate directory parents.

## 6. Theme Detail

Theme detail SHOULD derive:
- Theme definition/criteria
- related Industries
- importance/chain position
- related Companies through Business Exposure
- Products
- Technologies
- latest Claims
- Forecasts
- Trends
- Risks
- Sources
- freshness/as-of

Core graph:

```text
InvestmentTheme
   ↓ theme_exposure
Industry
   ↑ business_exposure
Company
```

## 7. Theme-specific Industry Grouping

Theme-specific visual groups such as Compute/Memory/Interconnect/Power/Cooling/Materials MAY be expressed through non-canonical Projection Configuration Assets or, where appropriate, canonical Module structures. They are NOT global Relation enums. Legacy View is not a canonical object kind.

## 8. Industry Chain

Uses canonical `upstream_of`.

Frontend may display both upstream/downstream directions; downstream is derived inverse query, not stored canonical edge.

Industry node may show Theme memberships, upstream/downstream Industries, Companies, Products, Technologies, latest Claims/Forecasts/Risks/Sources, freshness.

## 9. Company Exposure Projection

Company-to-Industry UI is derived from canonical business_exposure.

Expose both compact classification and detailed canonical attributes:
- exposureBasis
- realizationStage
- materiality
- financialContribution
- asOf
- supporting Claims

## 10. Derived Business Classes

Recommended defaults:

### Core Business
Typically reported + materiality=core.

### Substantial Business
Typically commercialized/reported + materiality=material.

### Emerging Business
Typically pre_revenue/commercialized with real assets/products/customers but limited/unknown contribution.

### Concept Exposure
Typically announced, transaction_pending, strategic cooperation, announced transaction, or immaterial exposure.

These are Projection defaults, not canonical truth.

## 11. User Filters

Recommended:

```text
☑ Core Business
☑ Substantial Business
☑ Emerging Business
☐ Concept Exposure
```

Optional detailed filters:
- reported
- commercialized
- pre_revenue
- announced
- transaction_pending
- direct operation
- controlled subsidiary
- investment exposure
- strategic cooperation

Changing filters never mutates canonical Knowledge.

## 12. Business Exposure Detail

UI SHOULD support:

```text
Current structured state
→ supporting Claims
→ Sources
→ Raw provenance
```

This makes current state explainable.

## 13. Product Projection

May show offering Companies, Industry memberships, component relationships, Technologies used, Claims, Sources using offers_product / belongs_to_industry / component_of / uses_technology.

## 14. Technology Projection

May show Companies developing Technology, Products using it, Industries where applied, substitutes, dependencies, Claims, Sources using develops_technology / uses_technology / applied_in / depends_on / substitutes_for / belongs_to_industry.

Theme relevance is normally graph-derived.

## 15. Claim Projection

Frontend may label Claim as:
- Research Findings
- Facts
- Forecasts
- Viewpoints
- Trends
- Risks

Claim detail SHOULD show statement, type, subjects, temporal scope, structured value, confidence, lifecycle, Sources, provenance, supersession, and related divergences.

## 16. Claim Timeline

May order by Source.publishedAt, Claim.temporal.asOf, and Claim.temporal.scope, while keeping these concepts distinguishable.

## 17. Forecast Comparison

Comparable Forecasts may be grouped by subject/metric/target period/unit/methodology context.

Projection MAY derive range, median, source-by-source comparison, revision history.

Derived statistics are not canonical Claims.

## 18. Fact Conflict / Viewpoint Divergence

Unresolved Fact conflict SHOULD show competing values/statements, Source identity/reliability, temporal scope, review status.

Different Viewpoints may coexist and be shown separately.

Frontend MUST NOT silently collapse unresolved canonical divergence.

## 19. Risk Projection

May group active Risks by Company, Industry, Theme, Technology, Relation. Expired Risks remain inspectable historically.

## 20. Source / Raw Provenance

Source view SHOULD expose title, institution/publisher, author, publishedAt, sourceType, sourceReliability, related Claims/Relations, Raw reference, provenance coverage.

Where runtime/file policy permits, users SHOULD be able to trace:

```text
Claim / Relation
→ Source
→ Raw
→ page / locator / chunk
```

Projection MUST NOT modify Raw.

## 21. Inverse / Symmetric Relation Projection

- supplier_of → customer view by inverse query
- upstream_of → downstream view by inverse query
- competes_with/substitutes_for may be displayed naturally from either endpoint

Canonical storage remains normalized.

## 22. Freshness / Lifecycle

Projection SHOULD expose as-of/freshness where investment meaning depends on time.

Default retrieval generally prioritizes active, but users SHOULD be able to inspect expired/superseded/archived historical Knowledge.

## 23. Projection Materialization / Cache

Projection may be computed on demand, cached, or materialized for performance, but remains derived and rebuildable.

Cache keys SHOULD include knowledgeBaseId, schemaVersion, revision, projection type, and relevant config.

No distributed cache is required by v0.3.

## 24. Projection Configuration

User/Theme-specific presentation MAY configure visible groups, sorting, default exposure filters, display labels, comparison columns.

Configuration MUST NOT alter canonical semantic meaning.

Projection Configuration Assets may contain explicit canonical refs. Those refs
must resolve against the Runtime Knowledge Model or migrated target IDs and
must not mutate canonical semantic state. Configuration assets remain portable
with the Knowledge Base but are not created by Curation or written by the
semantic Writer as canonical objects.

## 25. Multi-Theme / Multi-Industry Behavior

The same Industry may appear in multiple Theme views. A Company may appear in multiple Theme views through different Business Exposures. No duplicated direct Company→Theme tags are required.

## 26. Concept Exposure Requirement

Companies with announced/investment/cooperation/minor exposure may appear in graph when canonical Business Exposure exists, but UI MUST allow exclusion of such exposure.

## 27. Review / Dry-run Boundary

Uncommitted review Candidates are not canonical graph nodes.

Dry-run planned Knowledge MUST NOT appear in normal canonical views. A dedicated preview MAY render it explicitly as preview.

## 28. Compatibility / Access Boundary

Frontend consumes Runtime Knowledge Model after Loader/Adapter and SHOULD use Knowledge Access rather than direct storage-path scanning.

Legacy v0.2 KB may be readable through adapter, but v0.3-specific views may be limited until migration.

## 29. No Graph DB / RAG Requirement

Graph-shaped UI does not imply Graph DB. Projection may derive graph structures from canonical YAML/runtime model.

Claim/source retrieval does not imply RAG. Future semantic retrieval requires separate architecture review.

## 30. Recommended Core Views

1. Theme Directory
2. Theme Industry Chain Graph
3. Company Exposure List
4. Company Detail / Business Exposure
5. Claim / Research Findings Feed
6. Source / Provenance Inspector
7. Forecast Comparison
8. Risk View

## 31. Projection Integrity

Projection MUST NOT:
- invent missing financial contribution
- infer unsupported current business state
- collapse Forecast divergence into one canonical value
- erase superseded history
- convert review Candidates into canonical nodes
- treat UI labels as canonical enums

## 32. Frozen Decisions

Frontend is read/projection only; Theme directory is ThemeGroup→InvestmentTheme; graph and directory are separate; Theme/Company relevance derives through canonical graph; Concept Exposure is derived and filterable; inverse edges are derived; Claim divergence/history/provenance remain visible; projection caches are non-canonical and rebuildable; legacy View files are Projection Configuration Assets; frontend consumes Runtime Model/Access, not storage paths; Graph UI does not require Graph DB or RAG. v0.4 is NOT approved. This document remains a Freeze Candidate pending Sol verification.
