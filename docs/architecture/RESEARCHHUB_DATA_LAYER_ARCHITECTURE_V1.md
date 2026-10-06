# ResearchHub Data Layer Architecture v1

Status: `IMPLEMENTED / SOL ACCEPTANCE PENDING` after the Phase 1 Goal passes its
validation and delivery gates.

## Purpose and boundaries

The Data Layer owns runtime research-data identity, catalog definitions, source
policy selection, fallback, authority and point-in-time checks, provenance,
conflict reporting, and explicit unavailability. Resolved data remains a
runtime input to research execution; it is not durable Knowledge.

```text
Research Workflow
  -> selects and orders provider-neutral Skill methods
  -> materializes Skill data requirement templates with runtime context
  -> DataResolver
       -> Common Data Catalog
       -> Industry Data Catalog
       -> source policy and acquisition executor
       -> Plugin / source adapter
  -> passes attributed data to Skills
  -> composes results and requests governed Knowledge writes
```

The boundary is one Data Layer containing two catalogs. It does not introduce
a Capability layer, provider registry, service locator, auto-discovery, or a
second execution framework.

### Data and Knowledge

Data requirements and resolved observations describe external/runtime research
inputs. Knowledge owns durable semantic state and canonical persistence through
the existing Workflow, Knowledge Production Gateway, validation, and Writer
path. A Data result does not become Knowledge by being cataloged or resolved.

### Data and Intelligence

Data Layer v1 resolves bounded inputs for an explicit research run.
**Intelligence monitoring is not part of Data Layer v1.** News/social/media
monitoring, subscriptions, continuous collection, signal stores, and Daily
Brief source registries remain separate future Intelligence architecture.

## Common Data Catalog

`data/common-catalog.ts` defines stable cross-industry identities. Definitions
carry a canonical metric ID, meaning, data kind, known consumers, and whether a
source policy is configured. IDs are intentionally grounded in current runtime
use; examples are not registered merely because they are plausible. The first
set covers valuation basis, earnings estimates, management communication, and
exchange Q&A already represented in the Data Sources surface.

The Common Catalog is strict and globally identifiable.
`app/services/data-source-catalog.ts` reads meanings from these definitions while continuing to
compose its active source routes from the existing valuation, earnings, and
management policies. `sourcePolicyStatus: CONFIGURED` means a policy exists;
it does not certify that the source is complete, authoritative for every
question, or quality-approved. The current Data Sources API and UI stay intact.

## Industry Data Catalog

`data/industry-catalog.ts` models evolving, domain-specific research metrics.
Industry definitions use `industry:<industryId>:<local-id>` identities and
capture family, semantic role, meaning, data kind, optional unit/periodicity/
geography/applicability, source-policy references, and discovery/validation
provenance. Source mappings can be associated with a metric family or a
specific definition rather than assuming one source for an entire industry.
When resolving a cataloged Industry metric, DataResolver limits policy
selection to the policy IDs attached to that canonical metric definition.

The lifecycle is explicit:

```text
DISCOVERED -> VALIDATED -> CANONICAL
```

New definitions enter only as `DISCOVERED`. A transition needs validation
metadata, sourceability evidence, and a policy association. Transitions are
sequential. Source-policy associations can be added while a definition is
`DISCOVERED` or `VALIDATED`; changing a canonical definition requires a
separate review. Ordinary discovery cannot create a `CANONICAL` definition in
one step. Domain requirements resolve only against canonical definitions. No
Industry metric is pre-registered as canonical in Phase 1 because current
source semantics and quality have not completed domain-by-domain review.

The catalogs differ because Common data is stable and cross-industry, while
Industry metrics are sparse, specialized, and research-driven. Industry rows
must not be flattened into Common data or merged into the generic Data Sources
table. A future UI can browse Industry → metric family → metric → source chain.

## Requirement declarations and materialization

The research Skill catalog retains its human-readable `inputs` and adds typed
`dataRequirements` templates from `data/requirements.ts`:

- `STATIC` names one existing Common Catalog metric ID.
- `DOMAIN` expresses provider-neutral Industry needs such as supply/capacity,
  demand, inventory, pricing, or utilization.

Templates include data kind, determinism class, authority floor when known,
required fields, and required/optional status. They contain no provider names.
The initial Common mappings are deliberately bounded to implemented Skills
with existing source semantics: consensus expectations, estimate revisions,
and reverse DCF market price. The Industry cycle Skill expresses semantic
needs only; it does not enumerate PCB, semiconductor, shipping, or other
industry-specific metrics.

Workflow supplies company/industry identity, `asOf`, period, and consumer
identity at materialization time. These runtime values are not embedded in
Skill catalog metadata. Missing Industry identity or missing canonical metric
matches remain explicit unresolved requirement records.

## DataResolver and resolved data

`data/resolver.ts` wraps the existing generic acquisition semantics and
normalizes them into `ResolvedDataItem<T>` and `ResolvedDataBundle<T>` for
Workflow consumers. It can resolve materialized Common or Industry requirements
without moving I/O into Skills. The low-level `AcquisitionResult` remains
attached to each item and retains detailed observations and attempt telemetry.

The normalized contract preserves:

- `AVAILABLE`, `PARTIAL`, or `UNAVAILABLE` status and the required/optional
  distinction;
- the requirement and metric identity, period, and value (including numeric
  zero);
- source, publisher authority, retrieval metadata, and provenance;
- point-in-time/completeness/cross-check quality;
- fallback attempts, unavailable reason, and source conflicts.

The Data Layer does not synthesize missing authoritative numbers, replace
missing values with zero, or silently average conflicting sources. Cancellation
continues to be enforced by the acquisition executor seam.

## Source policy and acquisition

The canonical generic acquisition implementation now lives under `data/` and
reuses `DataRequirement`, `SourceCandidate`, `SourcePolicy`, `FallbackLevel`,
`AcquisitionAttempt`, and `AcquisitionResult`. It retains exact policy
matching, deterministic specificity, `FIRST_VALID`, `CROSS_CHECK`,
`COLLECT_DIVERSE`, source authority, required-field presence, PIT validation,
provenance, conflicts, and explicit unavailable states.

Source authority describes the original publisher. Fallback level describes
the route. Retrieval provider remains separately attributable. Existing
Workflow matching and consumer identity remain compatible in Phase 1; data
identity is represented independently by metric IDs and catalog definitions.
Workflow and Skill identity can continue to support diagnostics, telemetry, and
existing method-specific overrides.

`workflows/research-data-acquisition/` is now a compatibility re-export of the
single implementation under `data/`. Business Workflows are not wholesale
migrated in this Goal. Concrete APIs and parsing stay in Plugins; Skills do not
perform network acquisition or call `DataResolver`.

## Responsibility model

| Layer | Owns |
| --- | --- |
| Data | Requirements, catalog identities, source policy, authority, fallback, PIT, provenance, conflicts, resolved runtime data |
| Skill | Research methodology, calculations, bounded semantic reasoning, domain conclusions |
| Workflow | Lifecycle, Skill selection/order, runtime context, requirement materialization, Data requests, Skill inputs, report and Knowledge orchestration |
| Plugin | Provider APIs, crawling/fetching, provider-specific parsing and external integration |
| Knowledge | Durable semantic state and validated canonical persistence |

## Migration inventory

Phase 1 establishes contracts and compatibility only. Remaining direct or
partially composed acquisition paths are scheduled as follows:

### Phase 2 — Valuation and Earnings

- `workflows/valuation/workflow.ts`, `workflows/valuation/contracts.ts`,
  `workflows/valuation/automatic-comps.ts`, and
  `workflows/valuation/basis-evidence.ts`: direct/injected market, financial,
  peer, and annual-publication acquisition remains alongside the generic
  requirement/policy path.
- `workflows/earnings-review/workflow.ts`,
  `workflows/earnings-review/expectations-acquisition.ts`,
  `workflows/earnings-review/expectations-ths.ts`,
  `workflows/earnings-review/expectations-eastmoney-akshare.ts`, and
  `workflows/earnings-review/expectation-source-eastmoney.ts`: filing and
  financial acquisition remains direct or provider-specific; estimates already
  use the generic policy engine but retain concrete executors and projections.
- `workflows/management-communication-acquisition/`: its distinct runtime
  policy/acquisition path remains to be composed through DataResolver where
  appropriate.

### Phase 3 — Company, Event, and Thesis

- `workflows/company-deep-research/workflow.ts`: direct AKShare reads and source
  record construction remain.
- `workflows/event-research/workflow.ts`: Workflow-owned plugin discovery,
  fetch/normalize selection, and event evidence filtering remain.
- `workflows/thesis-red-team/workflow.ts`: Workflow-owned source plugin loop
  and source materialization remain.

### Phase 4 — Industry

- `workflows/industry-deep-research/workflow.ts` owns acquisition-wave evidence
  filtering and materialization; `app/services/research-service.ts` composes
  `IndustryAcquisitionComposition` and current plugins.
- `plugins/research-acquisition/industry-composition.ts` and the industry
  provider plugins remain current runtime paths until field-by-field catalog,
  source-policy, and resolver migration is governed.
- `plugins/research-acquisition/industry-operating-observations.ts` contains
  dedicated NBS, MIIT, and CHEAA observation paths and is a candidate for
  field-level mapping after semantics and source quality are reviewed.

### Future Intelligence

`workflows/daily-intelligence/`, `plugins/daily-intelligence/`,
`skills/daily-intelligence/`, and `app/services/daily-intelligence-*` remain
outside Data Layer. Monitoring, source registry, subscriptions, and signal
storage require a separate Intelligence design.

Existing type-only Skill references into plugin acquisition contracts, and the
Industry operating-observation contract co-located with its implementation,
are recorded as migration debt. No new concrete provider import is introduced
into a Skill by this Goal.

## Compatibility and quality boundary

Phase 1 does not intentionally change business research behavior. Existing
Data Sources routes remain assembled from the same policy definitions, current
Industry composition remains operational, and Daily Intelligence stays
separate. Existing Industry providers and authority labels are not promoted to
approved Common or Industry source policy; source quality and field semantics
remain for future domain-specific review.
