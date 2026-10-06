# ResearchHub — Knowledge Graph Projection Architecture v0.1

**Status:** FROZEN / NORMATIVE  
**Version:** v0.1  
**Date:** 2026-09-07  
**Owner:** System Architect / CTO  
**Scope:** Knowledge Graph application projection and page semantics  

---

## 1. Purpose

This document freezes the v0.1 architecture for the ResearchHub Knowledge Graph experience.

The Knowledge Graph is a **read-only application projection of canonical Knowledge**. It exists to help users browse, understand, and navigate the relationships already present in a mounted canonical Knowledge Base. It is not a second Knowledge store, not a graph database, not a Knowledge authoring surface, and not a research workflow.

The design intentionally preserves ResearchHub's existing authority boundaries:

```text
Canonical Knowledge
        │
        ▼
KnowledgeGraphService
        │
        ├── Directory Projection
        └── Contextual Graph Projection
                    │
                    ▼
              Product API
                    │
                    ▼
                 /graph
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
  Directory     Graph Canvas    Inspector
```

The Graph page must never become an alternate mutation path around Workflow, Knowledge Integrity, Validation, or Writer.

---

## 2. Architectural Position

ResearchHub is an Agent-first Research Application. The Knowledge Graph is a complementary browse surface for product state.

The Graph belongs to the **Application read projection** boundary:

```text
Pi Coding Agent / Browser UI
           │
           ▼
    Application Services
           │
           ▼
    Canonical Knowledge
```

The Graph does not introduce a new domain layer.

The Graph does not change the canonical Knowledge schema.

The Graph does not change the Knowledge Writer path.

The Graph does not change Review Governance.

The Graph does not imply a Graph Database, Vector Database, or RAG architecture.

---

## 3. Core Normative Principles

The following principles are frozen for v0.1.

1. **Knowledge Graph is an independent `/graph` Application page.**
2. **Graph is a read-only Projection of canonical Knowledge.**
3. **Graph does not imply or require a Graph Database.**
4. **Graph is contextual/rooted, never an unbounded global Knowledge Base visualization.**
5. **Graph topology contains canonical Entity nodes and canonical Relation edges only in v0.1.**
6. **Claim and Source remain Inspector evidence/detail, not topology nodes.**
7. **ThemeGroup is Directory taxonomy, not a synthetic Graph relation.**
8. **Canonical relation direction is preserved in Graph output.**
9. **Frontend must not reconstruct graph semantics by recursively interpreting canonical storage or schema.**
10. **KnowledgeGraphService owns bounded deterministic Graph and Directory projections.**
11. **Inspector reuses canonical Knowledge object reads rather than defining a competing object model.**
12. **Graph defaults to active canonical Knowledge only.**
13. **ReviewCase, Candidate, and unresolved proposal state never appears as canonical Graph topology.**
14. **Graph projections are deterministic and hard-bounded.**
15. **Navigation is root-based; v0.1 uses re-root/focus instead of complex incremental graph mutation.**
16. **React Flow and Dagre are visualization/layout dependencies only and have no Knowledge authority.**
17. **Node dragging changes only transient UI layout.**
18. **Graph cannot create, delete, edit, or persist canonical nodes or relations.**

Any implementation that violates one of these principles is architecturally non-compliant even if the page renders successfully.

---

## 4. User Experience Boundary

The v0.1 Graph page has three primary regions:

```text
┌──────────────────────────────────────────────────────────────────┐
│ ResearchHub       Research   Knowledge Graph   Reviews           │
├────────────────┬────────────────────────────────┬────────────────┤
│ DIRECTORY      │                                │ INSPECTOR      │
│                │                                │                │
│ Search...      │                                │ Entity         │
│                │                                │ Relation       │
│ Themes         │        KNOWLEDGE GRAPH         │ Claims         │
│ Industries     │                                │ Sources        │
│ Companies      │                                │ Provenance     │
│ Products       │                                │                │
│ Technologies   │                                │                │
└────────────────┴────────────────────────────────┴────────────────┘
```

This layout is a structural product contract, not a frozen visual design system. Exact spacing, styling, typography, colors, breakpoints, and component appearance remain implementation decisions.

The Graph Canvas is the primary visual surface.

The Directory provides bounded browse and search entry points.

The Inspector provides canonical detail and evidence for the selected node or edge.

---

## 5. Contextual Rooted Graph

### 5.1 No global graph

The system must not render the entire Knowledge Base as one graph.

Forbidden behavior:

```text
Entire KnowledgeBase
→ all entities
→ all relations
→ render everything
```

The v0.1 graph is always rooted in one canonical Entity.

Supported root entity types:

```text
investment_theme
industry
company
product
technology
```

The system projects a bounded neighborhood around that root.

### 5.2 Root identity

A graph request uses a canonical entity reference:

```text
rootRef = canonical Entity ref
```

The root must exist in the mounted canonical Knowledge Base and must be a supported Entity type.

ThemeGroup, Relation, Claim, Source, Module, ReviewCase, Candidate, and unresolved proposal identifiers cannot be graph roots in v0.1.

### 5.3 Depth

Supported depth:

```text
default depth = 1
hard depth    = 2
```

Depth is semantic graph distance over eligible canonical Entity/Relation topology.

The frontend must not recursively traverse canonical Knowledge itself to derive deeper graph state.

---

## 6. Topology Model

### 6.1 Nodes

Graph topology contains only canonical Entity objects of these types:

```text
investment_theme
industry
company
product
technology
```

ThemeGroup is excluded from graph topology.

Claim is excluded from graph topology.

Source is excluded from graph topology.

Module is excluded from graph topology.

ReviewCase and proposal/candidate state are excluded from graph topology.

### 6.2 Edges

Graph edges are canonical Knowledge Relation objects.

The v0.1 relation vocabulary is the active schema relation vocabulary, currently including:

```text
theme_exposure
business_exposure
upstream_of
supplier_of
competes_with
owns_stake_in
offers_product
belongs_to_industry
component_of
develops_technology
uses_technology
applied_in
depends_on
substitutes_for
```

The Graph does not invent relation types.

The Graph does not promote UI grouping into canonical relations.

The Graph does not convert inference into persisted topology.

### 6.3 Canonical direction

Every returned edge preserves canonical source and target direction.

Example canonical relation:

```text
CCL --upstream_of--> PCB
```

If the graph root is PCB, the projection may discover the relation through an incoming lookup, but the returned edge remains:

```text
CCL --upstream_of--> PCB
```

The Graph must not synthesize:

```text
PCB --downstream_of--> CCL
```

unless `downstream_of` exists as a separately canonicalized relation type in a future approved schema.

Likewise:

```text
Company --business_exposure--> Industry
```

must remain in that direction even when the Company appears as a neighboring node of an Industry root.

### 6.4 No synthetic containment edge for ThemeGroup

ThemeGroup is a user/frontend taxonomy construct referenced by `InvestmentTheme.themeGroupRef`.

The Graph must not create a pseudo-relation such as:

```text
ThemeGroup --contains--> InvestmentTheme
```

unless a future canonical schema explicitly introduces such a relation through normal architecture governance.

---

## 7. Root Projection Profiles

The backend projection service chooses traversal semantics from the canonical type of `rootRef`.

The frontend does not select a traversal algorithm and does not interpret the schema to construct one.

The projection result reports the chosen profile as metadata.

### 7.1 Investment Theme profile

Profile identifier:

```text
theme_context
```

Primary neighborhood:

```text
InvestmentTheme
  → theme_exposure
  → Industry
```

At depth 2, the projection may additionally expose bounded canonical topology such as:

```text
Industry --upstream_of--> Industry
Company --business_exposure--> Industry
```

The objective is to reveal the industrial structure represented by canonical Knowledge around the Theme without introducing synthetic Theme-to-Company edges.

### 7.2 Industry profile

Profile identifier:

```text
industry_context
```

Primary neighborhood includes bounded canonical relations relevant to the Industry, including:

```text
incoming/outgoing upstream_of
Company --business_exposure--> Industry
InvestmentTheme --theme_exposure--> Industry
```

and directly related Product/Technology relations where present in canonical Knowledge.

Incoming lookup is allowed, but returned edge direction remains canonical.

### 7.3 Company profile

Profile identifier:

```text
company_context
```

Primary neighborhood includes bounded canonical relations such as:

```text
Company --business_exposure--> Industry
Company --offers_product--> Product
Company --develops_technology--> Technology
Company --uses_technology--> Technology
supplier_of
competes_with
owns_stake_in
```

At depth 2, the graph may expose Theme adjacency through actual canonical topology:

```text
Company
  → business_exposure
  → Industry
  ← theme_exposure
  ← InvestmentTheme
```

The Graph must not synthesize a direct Company-to-InvestmentTheme edge solely for visual convenience.

### 7.4 Product profile

Profile identifier:

```text
product_context
```

The projection uses bounded canonical relations involving Product, including applicable relations such as:

```text
offers_product
component_of
applied_in
depends_on
substitutes_for
```

### 7.5 Technology profile

Profile identifier:

```text
technology_context
```

The projection uses bounded canonical relations involving Technology, including applicable relations such as:

```text
develops_technology
uses_technology
applied_in
depends_on
```

The active schema remains authoritative. Projection profiles do not extend schema semantics.

---

## 8. Knowledge Graph Service

### 8.1 Service boundary

A dedicated read-only application service is introduced:

```text
app/services/knowledge-graph-service.ts
```

Its conceptual responsibility is limited to:

```text
getDirectoryProjection()
getGraphProjection()
```

It may use canonical Knowledge query/index infrastructure internally.

It must not have Knowledge mutation authority.

It must not call Writer for graph browsing.

It must not resolve ReviewCases.

It must not perform semantic research.

It must not create schema types or canonical objects.

### 8.2 Why this is separate from generic KnowledgeService

`KnowledgeService` remains the generic application service for canonical object/search reads.

`KnowledgeGraphService` is a product-specific projection service.

This separation avoids turning generic KnowledgeService into a large mixed service containing unrelated projections such as graph, timeline, theme framework, financial view, and future product-specific browse modes.

This is a narrow application boundary, not a generic framework or new architectural layer.

---

## 9. Graph Projection Contract

The v0.1 conceptual input is:

```ts
interface KnowledgeGraphProjectionInput {
  rootRef: string;
  depth?: 1 | 2;
  maxNodes?: number;
  maxEdges?: number;
}
```

The v0.1 conceptual result is:

```ts
interface KnowledgeGraphProjection {
  rootRef: string;
  profile:
    | 'theme_context'
    | 'industry_context'
    | 'company_context'
    | 'product_context'
    | 'technology_context';
  depth: 1 | 2;
  nodes: readonly KnowledgeGraphNode[];
  edges: readonly KnowledgeGraphEdge[];
  nodeTotal: number;
  edgeTotal: number;
  nodeLimit: number;
  edgeLimit: number;
  truncated: boolean;
}
```

Exact TypeScript naming may vary only if the resulting contract preserves the same architectural semantics.

### 9.1 Node DTO

Conceptual contract:

```ts
interface KnowledgeGraphNode {
  ref: string;
  entityType:
    | 'investment_theme'
    | 'industry'
    | 'company'
    | 'product'
    | 'technology';
  label: string;
  secondaryLabel?: string;
  lifecycleStatus: string;
  isRoot: boolean;
}
```

The node DTO must remain small.

It must not embed full arrays of:

```text
claims
sources
relations
financials
modules
raw payloads
```

Those belong to canonical object/detail reads.

### 9.2 Edge DTO

Conceptual contract:

```ts
interface KnowledgeGraphEdge {
  ref: string;
  relationType: string;
  sourceRef: string;
  targetRef: string;
  label: string;
}
```

`sourceRef` and `targetRef` must preserve canonical relation direction.

The edge DTO must not become a parallel copy of the full canonical Relation object.

---

## 10. Bounds and Determinism

### 10.1 Limits

Frozen defaults:

```text
default maxNodes = 60
hard maxNodes    = 150

default maxEdges = 120
hard maxEdges    = 300

default depth    = 1
hard depth       = 2
```

Requests above hard limits must be rejected or clamped according to the established Application Service contract style. They must never produce unbounded traversal.

### 10.2 Deterministic projection

For the same:

```text
Knowledge Base revision
rootRef
depth
limits
```

the service must return the same semantic node/edge set and stable deterministic ordering.

The v0.1 priority order is:

```text
1. root
2. direct neighbors of root
3. canonical relations connecting direct neighbors
4. second-hop nodes
5. second-hop relations
6. canonical-ref stable ordering inside equivalent priority
```

No LLM ranking is permitted inside Graph projection v0.1.

The service must not ask a reasoning model to decide which nodes are "important".

### 10.3 Truncation metadata

When bounds remove otherwise eligible graph state, the result must make truncation observable.

The frontend must not silently imply that a truncated graph is a complete Knowledge neighborhood.

---

## 11. Lifecycle Filtering

The default Graph projection includes only active canonical Knowledge.

Historical/deprecated/superseded objects are excluded from the normal topology view by default.

If the canonical lifecycle model uses more specific values, the implementation must map them according to the active schema without weakening the principle above.

A future "show historical" mode may be designed separately.

It is not part of v0.1.

---

## 12. Directory Projection

### 12.1 Purpose

The Directory is a bounded browse projection, not a mirror of raw canonical storage.

It helps users enter the Graph from known Knowledge objects.

### 12.2 Conceptual contract

The service may return a shape conceptually equivalent to:

```ts
interface KnowledgeDirectoryProjection {
  themeGroups: readonly {
    ref: string;
    name: string;
    themes: readonly {
      ref: string;
      name: string;
    }[];
  }[];

  industries: DirectorySection;
  companies: DirectorySection;
  products: DirectorySection;
  technologies: DirectorySection;
}

interface DirectorySection {
  items: readonly {
    ref: string;
    name: string;
  }[];
  total: number;
  limit: number;
  truncated: boolean;
}
```

### 12.3 ThemeGroup behavior

ThemeGroup appears only as Directory taxonomy/grouping.

InvestmentThemes are grouped beneath ThemeGroup based on canonical `themeGroupRef`.

Selecting a ThemeGroup expands/collapses its themes.

Selecting an InvestmentTheme may focus that Theme as graph root.

ThemeGroup itself does not become a graph topology node in v0.1.

### 12.4 Directory bounds

Frozen section defaults:

```text
default items per non-theme section = 30
hard items per non-theme section    = 100
```

The Directory must not return thousands of Companies or other entities in one payload.

### 12.5 Search

Directory search should reuse the existing Knowledge search application capability where suitable.

The Graph feature must not create a competing semantic search subsystem solely for the page.

Search results that resolve to a supported Entity type may be focused as graph roots.

---

## 13. Inspector Boundary

### 13.1 Inspector purpose

The Graph Canvas shows topology.

The Inspector shows canonical detail and evidence.

This distinction is frozen:

```text
Graph      = topology
Inspector  = detail / evidence / provenance
```

### 13.2 Node selection

Selecting an Entity node should use the existing canonical object read path, conceptually:

```text
getKnowledgeObject(entityRef)
```

The Inspector may show bounded canonical data such as:

```text
name
type
lifecycle
aliases
relations
claims
sources
provenance-oriented detail
```

### 13.3 Edge selection

Selecting a Relation edge should use the same canonical object read path with the relation reference.

The Inspector may show:

```text
relation type
source endpoint
target endpoint
attributes
claims
supporting sources
```

### 13.4 No duplicate detail model

The Graph page must not create a second independently maintained canonical object-detail contract where the existing Knowledge object view is sufficient.

If later product needs require a new bounded Inspector projection, it must remain derived from canonical Knowledge and must not become mutation authority.

---

## 14. Review Separation

Review is downstream governance for valuable but unresolved Knowledge Production output.

Review is not canonical Knowledge.

Therefore:

```text
Canonical Knowledge Graph
!=
Review Candidate Graph
```

The following must not be rendered as ordinary canonical graph topology:

```text
ReviewCase
Potential InvestmentTheme
Potential Company Binding
Suspended Proposal Bundle
unresolved Candidate
schema-gap proposal
research-followup proposal
```

Review remains observable through the Review application surface.

The Graph may later link to a related Review count or navigation affordance only if the UI clearly preserves canonical-vs-unresolved distinction. Such integration is not required for v0.1.

---

## 15. Navigation Model

### 15.1 Root-based navigation

The Graph page uses URL-addressable root state.

Conceptually:

```text
/graph
```

with no root shows an empty/select state.

A focused graph uses:

```text
/graph?root=<canonical-ref>
```

Depth may optionally be represented as:

```text
/graph?root=<canonical-ref>&depth=2
```

Canonical references must be URL-encoded normally.

### 15.2 Focus/re-root interaction

v0.1 uses re-rooting instead of maintaining a complex mutable expansion graph.

Node interaction:

```text
single select
→ Inspector
```

Focus interaction:

```text
double-click or explicit Focus action
→ selected Entity becomes new root
→ request a new bounded projection
→ update URL
```

### 15.3 Browser history

Root-based URL state should support normal refresh, back, forward, and direct linking behavior.

Selected Inspector state does not need to be persisted in the URL in v0.1.

---

## 16. Frontend Visualization Dependencies

### 16.1 Graph canvas

Frozen v0.1 visualization dependency:

```text
@xyflow/react
```

React Flow is used as the graph canvas interaction/rendering library.

It provides visualization mechanics only.

It has no canonical Knowledge authority.

### 16.2 Layout

Frozen v0.1 layout dependency:

```text
@dagrejs/dagre
```

The default layout is a directed graph layout, normally left-to-right for industrial-chain readability.

Dagre positions are application view state only.

They are not canonical Knowledge.

### 16.3 Allowed interactions

The Graph Canvas may allow:

```text
pan
zoom
fit view
node selection
edge selection
node dragging for transient layout
focus/re-root
```

### 16.4 Forbidden editing interactions

The Graph Canvas must not allow product-level canonical mutations such as:

```text
connect nodes to create Relation
delete Entity
delete Relation
edit canonical relation endpoint
edit canonical relation type
write canonical fields by dragging
persist graph layout as Knowledge
```

React Flow connection/edit capabilities must therefore be disabled or left unimplemented.

The Graph is a browser, not a Graph Editor.

---

## 17. Filters

v0.1 should support view filtering for:

### Entity types

```text
investment_theme
industry
company
product
technology
```

### Relation types

The filter vocabulary is derived from relation types present in the returned bounded projection and/or active schema.

Because the server projection is already hard-bounded, v0.1 filters may be client-side visibility filters.

Filters do not alter canonical Knowledge.

Filters must not permanently hide the current root in a way that makes navigation incoherent.

Server-side semantic query planning for UI filters is explicitly not required for v0.1.

---

## 18. Application API Boundary

The Graph page must consume product-level application APIs.

It must not directly read canonical storage files from the browser.

It must not know Writer internals.

It must not know registry filesystem layout.

It must not reconstruct the Knowledge Base by reading YAML/JSON files independently.

Conceptual product read operations:

```text
getKnowledgeDirectory
getKnowledgeGraph
getKnowledgeObject
searchKnowledge
```

Exact transport naming and HTTP/RPC route naming remain implementation details unless already standardized by the Application API.

---

## 19. Separation from Knowledge Production

The Knowledge Graph page is not a Knowledge Producer.

It does not perform:

```text
Theme research
Industry discovery
Company research
Evidence acquisition
Candidate synthesis
Knowledge Resolution
ChangeSet planning
Writer commit
Review resolution
```

For example:

```text
Knowledge Graph Page
= visualization of current canonical Knowledge
```

while:

```text
Theme Framework Workflow
= Knowledge Producer
```

These responsibilities must remain separate.

A future product interaction may allow a user to launch Knowledge Production from a selected graph object, but the resulting mutation must still enter the normal ResearchHub production path.

---

## 20. Separation from Free Research

The Graph does not convert ordinary Agent analysis into canonical topology.

Free Research remains non-persistent by default.

If a user performs free research and then navigates to Graph, the Graph continues to display canonical Knowledge only.

Any newly researched information must pass through an explicit Knowledge Production path before it becomes visible as canonical graph topology.

---

## 21. v0.1 Scope

### 21.1 Required

The v0.1 implementation includes:

```text
independent /graph page
Directory
Knowledge search entry
contextual rooted graph
1-hop projection
2-hop projection
InvestmentTheme roots
Industry roots
Company roots
Product roots
Technology roots
canonical Relation edges
bounded deterministic projection
React Flow canvas
Dagre layout
pan / zoom
node selection
edge selection
Focus / re-root
Inspector
entity-type filters
relation-type filters
URL root state
read-only authority
```

### 21.2 Explicitly excluded

The v0.1 implementation excludes:

```text
global entire-KB graph
Graph Database
Vector Database
RAG
graph editing
create/delete relation from graph
Writer invocation from graph
Claims as topology nodes
Sources as topology nodes
Modules as topology nodes
Review candidates as topology nodes
Theme Framework research
Agent semantic graph ranking
persistent node positions
complex incremental expand/collapse state machine
frontend-owned recursive schema traversal
Research ↔ Graph contextual Agent protocol
multi-user graph permissions
collaborative graph editing
```

---

## 22. Deterministic Acceptance Requirements

The implementation is acceptable only if tests demonstrate at minimum:

1. Same KB revision + same root + same depth + same bounds produces the same deterministic projection ordering.
2. Hard node/edge limits are enforced.
3. Depth > 2 cannot trigger unbounded traversal.
4. Unsupported root kinds are rejected.
5. ThemeGroup does not become a graph node.
6. Claim/Source/Module do not become graph topology nodes.
7. ReviewCase/Candidate state does not leak into canonical graph topology.
8. Returned edge direction matches canonical Relation source/target direction.
9. Incoming-relation traversal does not generate inverse pseudo-relations.
10. Graph service performs no canonical mutation.
11. Graph page cannot create edges using React Flow interaction.
12. Selecting a node/edge can load bounded canonical Inspector detail.
13. Root focus updates graph projection and URL state.
14. Directory output is bounded.
15. Graph defaults to active canonical Knowledge.
16. Existing Knowledge Production, Writer, Review, and Pi Host tests remain green.

---

## 23. Governance and Evolution

This document freezes v0.1 product and authority semantics, not every UI implementation detail.

Changes to the following require architecture review and a new approved revision or patch:

```text
canonical-vs-projection authority boundary
Graph node kinds
synthetic relation policy
canonical edge direction policy
ThemeGroup topology policy
Review visibility semantics
Graph mutation authority
hard-bounded contextual graph principle
Graph-as-read-only principle
```

The following may evolve without changing this architecture if the frozen principles remain intact:

```text
visual styling
React component decomposition
iconography
responsive layout
minor Inspector presentation
loading skeletons
keyboard shortcuts
animation
Dagre spacing parameters
browser-side filter presentation
API transport details
```

A future decision to support Graph editing would require a separate architecture design. It must not be introduced incrementally through UI convenience code.

A future decision to use another visualization/layout library may be considered through a deliberate dependency decision, provided no Knowledge authority boundary changes. For v0.1, React Flow + Dagre is the frozen implementation route.

---

## 24. Architectural Summary

The Knowledge Graph v0.1 is intentionally simple:

```text
Canonical Knowledge
      │
      ▼
Read-only bounded deterministic projection
      │
      ▼
Directory + Contextual Rooted Graph + Inspector
```

Its purpose is to make ResearchHub Knowledge understandable without changing what Knowledge is.

The Graph does not own research semantics.

The Graph does not own canonical identity.

The Graph does not own mutation.

The Graph does not own Review.

The Graph does not own workflow lifecycle.

The Graph is a product projection over the authoritative Knowledge model.

That boundary is the central architectural rule of this document.
