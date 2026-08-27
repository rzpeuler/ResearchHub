# KNOWLEDGE_DATA_SCHEMA_V0.3

## Status

**Freeze Candidate / Sol Verification Pending**

- Knowledge Schema Version: `0.3`
- Storage Format Version: `1`
- Parent: `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md`
- This candidate is not an implementation authorization; v0.2 remains the current frozen normative contract until Sol acceptance and governance integration.

## 1. Canonical Object Kinds

- ThemeGroup
- Entity
- Relation
- Claim
- Source
- Module
- RawRef

Namespaces:
- `theme-group:`
- `entity:`
- `relation:`
- `claim:`
- `source:`
- `module:`

Raw retains existing identity semantics.

`Taxonomy` and `View` are not canonical object kinds. Legacy/external
taxonomy is an auxiliary Reference Taxonomy Asset; legacy `views/*.yaml` are
auxiliary Projection Configuration Assets.

## 2. Durable Identity

Durable ID and semantic subtype are separate. This document is the sole
normative authority for Schema 0.3 canonical durable identity.

```yaml
id: entity:<stable-id>
type: industry
name: PCB
```

Durable IDs MUST NOT be recomputed from mutable semantic state.
Canonical IDs MUST use the object-kind namespaces declared above. The frozen
`RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1.md` remains unchanged and is
normative only for Schema `<= 0.2`; no v0.3 duplicate is permitted. Auxiliary
asset IDs are outside the canonical namespace requirement.

## 3. Lifecycle

- active
- expired
- superseded
- archived

```yaml
lifecycle:
  status: active | expired | superseded | archived
  validFrom: datetime | null
  validUntil: datetime | null
```

## 4. ThemeGroup

ThemeGroup is navigation taxonomy, not Entity.

```yaml
id: theme-group:<stable-id>
name: string
aliases: string[]
description: string | null
sortOrder: number | null
lifecycle:
  status: active
```

Every InvestmentTheme MUST have exactly one `themeGroupRef`.

## 5. Entity

Types:
- investment_theme
- industry
- company
- product
- technology

Base shape:

```yaml
id: entity:<stable-id>
type: investment_theme | industry | company | product | technology
name: string
aliases: string[]
description: string | null
externalIds: {}
taxonomyRefs: [<reference-taxonomy-item-stable-id>]
metadata: {}
lifecycle:
  status: active | expired | superseded | archived
createdAt: datetime | null
updatedAt: datetime | null
```

Unknown Entity type strings are invalid. Arbitrary canonical top-level fields are forbidden unless declared by Executable Schema.

`taxonomyRefs` contains only resolvable stable IDs of auxiliary Reference
Taxonomy items. It is an optional classification reference, not a canonical
Knowledge Object ref: it MUST NOT point to ThemeGroup, replace
`theme_exposure` or `business_exposure`, replace any Relation, or appear in
Claim `subjectRefs`. Curation may create it only when explicit Reference
Taxonomy context is supplied.

## 6. InvestmentTheme

Additional fields:

```yaml
themeGroupRef: theme-group:<id>
definition: string | null
inclusionCriteria: string[]
exclusionCriteria: string[]
```

Canonical validity requires id/type/name/themeGroupRef. New Theme creation SHOULD additionally provide definition and criteria.

## 7. Industry

Industry stores no `parentTheme`, `themeRefs[]`, or `companyRefs[]`.

Theme association → `theme_exposure`.
Company association → `business_exposure`.

## 8. Company

Optional:

```yaml
ticker: string | null
exchange: string | null
legalName: string | null
```

Company MUST NOT canonically store industries/themes/conceptTags/businessTags arrays.

## 9. Product

Product represents recognizable commercial products/product families/components/equipment categories.

Product-to-Industry uses `belongs_to_industry`.

## 10. Technology

Technology represents reusable technical routes/processes/architectures/capabilities.

Examples: CPO, NPO, mSAP, GAA, CoWoS, Liquid Cooling.

## 11. Relation Base

```yaml
id: relation:<stable-id>
type: <canonical-relation-type>
sourceRef: <canonical-object-ref>
targetRef: <canonical-object-ref>
attributes: {}
contextRefs: []
supportingClaimRefs: []
sourceRefs: []
confidence: number | null
asOf: datetime | null
lifecycle:
  status: active | expired | superseded | archived
createdAt: datetime | null
updatedAt: datetime | null
```

## 12. Directionality

- directed
- directed_with_inverse
- symmetric

Inverse query vocabulary is not necessarily canonical writable vocabulary.

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

No generic `related_to`, `contains`, or `partner_of`.

## 14. theme_exposure

Endpoints: `InvestmentTheme → Industry`

Attributes:

```yaml
importance: core | material | adjacent
chainPosition: upstream | midstream | downstream | infrastructure | cross_chain | unknown
```

Many-to-many.

## 15. business_exposure

Endpoints: `Company → Industry`

At most one active relation per Company–Industry pair.

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

```yaml
period: string | null
revenueAmount: number | null
revenueShare: number | null
profitAmount: number | null
profitShare: number | null
currency: string | null
separatelyReported: boolean | null
```

Constraints: `0 <= revenueShare <= 1`, `0 <= profitShare <= 1`.
Unknown values remain null.

## 16. UI-only Concept Classification

The following are NOT canonical:
- isConceptStock
- conceptStock
- conceptTag

Frontend derives Core/Substantial/Emerging/Concept classifications.

## 17. Relation Endpoint Rules

- `upstream_of`: Industry → Industry
- `supplier_of`: Company → Company
- `competes_with`: Company ↔ Company, symmetric
- `owns_stake_in`: Company → Company
- `offers_product`: Company → Product
- `belongs_to_industry`: Product/Technology → Industry
- `component_of`: Product → Product
- `develops_technology`: Company → Technology
- `uses_technology`: Company/Product → Technology
- `applied_in`: Technology → Industry
- `depends_on`: Industry/Product/Technology → Industry/Product/Technology
- `substitutes_for`: Product ↔ Product OR Technology ↔ Technology, symmetric

Retired writable Relations:
- contains
- downstream_of
- customer_of
- substitute_for
- operates_in
- partner_of
- invested_in

## 18. owns_stake_in Attributes

```yaml
ownershipPct: number | null
controlType: controlling | significant_influence | minority | unknown
```

`0 <= ownershipPct <= 1`.

Investment events are Claims; current ownership state is Relation.

## 19. Claim

Claim replaces v0.2 Intelligence.

Types:
- fact
- forecast
- viewpoint
- trend
- risk

```yaml
id: claim:<stable-id>
claimType: fact | forecast | viewpoint | trend | risk
statement: string
subjectRefs: [<canonical-object-ref>]
primarySubjectRef: <canonical-object-ref> | null

temporal:
  asOf: datetime | null
  scope:
    type: point | period | ongoing | unknown
    start: datetime | null
    end: datetime | null
    label: string | null

structuredValue:
  metric: string
  value: string | number | boolean | null
  unit: string | null
  comparator: eq | gt | gte | lt | lte | approx | null

sourceRefs: [source:<id>]
provenance:
  - sourceRef: source:<id>
    rawRef: raw:<id>
    locator: string | null
    chunkRef: string | null

confidence: number | null
lifecycle:
  status: active | expired | superseded | archived
supersedes: [claim:<id>]
supersededBy: [claim:<id>]
createdAt: datetime | null
updatedAt: datetime | null
```

New Claims require id, claimType, statement, subjectRefs, sourceRefs, lifecycle.status.

## 20. Claim Atomicity

One Claim SHOULD express one independently evaluable semantic proposition.

## 21. Claim Type Semantics

- fact: objectively verifiable, consistency-seeking
- forecast: future prediction, divergence allowed
- viewpoint: analytical interpretation, divergence allowed
- trend: directional/structural development over time
- risk: uncertain adverse condition, may expire historically

## 22. Claim Subjects

`subjectRefs` may reference Entities and Relations.

Separate themeRefs/companyRefs/industryRefs MUST NOT be added.

## 23. Temporal Semantics

Source.publishedAt, Claim.temporal.asOf, and Claim.temporal.scope are distinct.

## 24. StructuredValue

Optional lightweight metric/value/unit/comparator only. No global Metric Ontology in v0.3.

## 25. Claim Source Merge / Supersession

Equivalent Claim + new Source → normally `merge_source`.

Material semantic change → new Claim + supersession.

## 26. Confidence

Claim confidence = confidence that extraction/support is correct.

It is NOT Source reliability and NOT forecast probability.

Constraint: `0 <= confidence <= 1`.

## 27. Source

Source types:
- official_disclosure
- company_official
- sell_side_research
- industry_database
- professional_media
- general_media
- community
- unknown

Source reliability:
- high
- medium
- low
- unknown

`sourceType` MUST conform to canonical enum.

## 28. Raw / Provenance

Raw remains immutable evidence. Validator ensures Source exists, Raw exists, and Raw belongs to Source.rawRefs. LLM MUST NOT manufacture canonical Source/Raw IDs. Auxiliary Reference Taxonomy and Projection Configuration Assets do not enter the canonical semantic registry.

## 29. Module

Module remains supported for comparison/roadmap/market/competition/capacity/supply-chain. It is secondary to the canonical semantic graph and not an alternative identity authority.

## 30. Canonical Executable Schema

One runtime-readable structural definition MUST directly or derivably provide:
- Entity/Claim/Source/Relation types
- endpoint rules
- directionality
- cardinality
- attributes
- Business Exposure enums
- lifecycle
- temporal enums
- required fields
- numeric constraints
- semantic descriptions

## 31. Strict Validation

Reject unknown types, illegal endpoints, illegal enum values, invalid cardinality, invalid required fields, invalid refs, and out-of-range numeric fields.

Top-level arbitrary fields are not accepted merely through TypeScript index signatures.

## 32. Schema Context Serialization

The same Executable Schema authority MUST serialize operation-specific LLM Schema Context. Prompt authors MUST NOT duplicate canonical enum lists.

## 33. Validity vs Creation Policy

Legacy migrated objects may be schema-valid with incomplete semantic richness; new creation policy may be stricter.

## 34. Runtime Vocabulary

AI Hardware, PCB, GPU, company names, and ThemeGroup names are runtime KB data, not compile-time Schema enums.

## 35. Compatibility

v0.3 writer writes only v0.3 semantics. v0.2 remains readable through compatibility but mixed active v0.2/v0.3 canonical semantic state is forbidden. Preserved auxiliary assets, Raw, and historical logs are outside that prohibition when declared canonical refs are mapped and validated.

## 36. Frozen Decisions

Schema v0.3 freezes the model above. Storage Format remains 1. Taxonomy and
View remain auxiliary assets and are not added to the canonical model. Schema
v0.4 is NOT approved. This document remains a Freeze Candidate pending Sol
verification.
