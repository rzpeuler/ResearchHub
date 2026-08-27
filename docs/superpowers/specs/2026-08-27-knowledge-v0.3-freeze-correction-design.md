# Knowledge v0.3 Freeze Correction Design

## Objective

Correct the Knowledge v0.3 Freeze Candidate documentation so the two
independent freeze blockers are closed without changing the v0.3 semantic
model or starting implementation:

1. Define Schema 0.2 Taxonomy/View legacy semantics and their v0.3 migration
   disposition.
2. Define Schema 0.3 durable-ID authority and its boundary with the frozen
   v0.1 ID naming convention.

The result remains a Freeze Candidate pending independent Sol verification.

## Scope

Import and minimally correct the six documents from
`C:/Users/Administrator/Downloads/ResearchHub_Knowledge_v0.3_Freeze_Bundle`
under `docs/architecture/`:

- `RESEARCHHUB_KNOWLEDGE_ARCHITECTURE_V0.3.md`
- `KNOWLEDGE_DATA_SCHEMA_V0.3.md`
- `KNOWLEDGE_CURATION_SKILL_V0.3.md`
- `RESEARCH_REPORT_INGESTION_WORKFLOW_V0.3.md`
- `KNOWLEDGE_SCHEMA_MIGRATION_0.2_TO_0.3.md`
- `KNOWLEDGE_FRONTEND_PROJECTION_V0.3.md`

Update the bundle README and the following governance records:

- `docs/architecture/README_V0.3_FREEZE_BUNDLE.md`
- `docs/project-management/CURRENT_STATUS.md`
- `docs/project-management/TASK_REGISTRY.md`
- `docs/project-management/CHANGELOG.md`

Do not modify implementation, runtime data, tests, v0.2 frozen documents,
`RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1.md`, the current normative
architecture references, the Knowledge Freeze Index, or Decision Log
acceptance state.

## Architecture and Semantics

Schema 0.3 canonical object kinds remain exactly:

- `ThemeGroup`
- `Entity`
- `Relation`
- `Claim`
- `Source`
- `Module`
- `RawRef`

Taxonomy is not added as a canonical kind. Legacy or external taxonomy is an
auxiliary Reference Taxonomy Asset used for classification, including external
classification systems. It is not a ThemeGroup, Entity, graph endpoint, or
curation default. Its document and item IDs are preserved, and its Entity
references are represented only through `taxonomyRefs`.

`taxonomyRefs` is defined as an auxiliary reference from an Entity to a
resolvable Reference Taxonomy item stable ID. It cannot reference ThemeGroup,
replace `theme_exposure` or `business_exposure`, replace canonical Relations,
or appear in Claim `subjectRefs`. Curation may emit it only when explicit
Reference Taxonomy context is supplied.

View is not added as a canonical kind. Legacy `views/*.yaml` are preserved as
auxiliary Projection Configuration Assets. They configure frontend/read-model
behavior, may contain explicit canonical references, and do not mutate or
become canonical Knowledge objects. `Module` remains the only canonical
module object.

The mixed-state prohibition applies only to active canonical semantic state.
Preserved auxiliary taxonomy/projection assets, Raw evidence, and historical
logs do not constitute mixed canonical state after their declared canonical
references are deterministically rewritten and validated.

## Durable Identity and Migration

Schema 0.3 is the sole normative authority for v0.3 canonical durable IDs.
Canonical IDs MUST use these object-kind namespaces:

- `theme-group:`
- `entity:`
- `relation:`
- `claim:`
- `source:`
- `module:`

Raw retains its existing independent identity semantics. The frozen
`RESEARCHHUB_KNOWLEDGE_ID_NAMING_CONVENTION_V0.1.md` remains unchanged and is
normative only for Schema `<= 0.2`. No v0.3 naming-convention duplicate is
created. Auxiliary taxonomy and projection-configuration IDs are outside the
canonical object-kind namespace requirement.

The migration design must inventory legacy taxonomy and view assets, preserve
their identity, allocate the complete `KnowledgeIdMapping` before rewriting
any declared canonical references, and validate auxiliary-reference
integrity. Explicit refs such as taxonomy `graphRefs` and view `targetEntity`
must use the complete map. Unresolved declared canonical refs produce a
blocking `MigrationReviewItem`.

Migration must not heuristically rewrite opaque strings, automatically convert
Taxonomy to ThemeGroup, automatically convert View to Module, or invent new
canonical semantics.

## Governance State

All v0.3 candidate documents and governance records use a clear equivalent of
`Knowledge v0.3 Freeze Candidate / Sol Verification Pending` or
`Review Pending / Sol Verification`.

The records must preserve these facts:

- v0.2 remains the current frozen normative architecture until Sol acceptance
  and governance integration;
- v0.3 implementation remains on HOLD and is not authorized by this bundle;
- v0.4 is not approved;
- Engineering does not self-mark Sol acceptance as Accepted.

## Validation and Git Delivery

Perform documentation and boundary checks for canonical kinds, Taxonomy/View
disposition, `taxonomyRefs`, migration coverage, durable-ID authority, and
MUST namespace wording. Search for prohibited new architecture layers such as
Manager, Engine, Agent, Planner, Graph DB, Vector DB, and RAG.

Run the repository default full validation command:

```text
npm test
```

Before commit, verify that the diff contains only the allowed documentation
files and that no `packages/**`, `dsh/**`, `tests/**`, runtime data, v0.2
frozen document, or v0.1 ID Convention file changed. Commit with:

```text
DOC: correct Knowledge v0.3 freeze candidate
```

Push the resulting `main` commit to `origin/main`. Report branch, commit,
push status, and working-tree status while keeping Sol acceptance as
`Review Pending / Sol Verification`.
