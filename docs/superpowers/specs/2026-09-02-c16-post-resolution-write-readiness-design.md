# C16 Post-Resolution Write Readiness Design

## Context

C4-R9-R3 proved that Extraction Candidate Validation and Reference Resolution
can complete while the later ChangeSet projection still emits empty relation
endpoints, empty claim subjects, deferred relation semantic violations, and
new-object business-exposure cardinality collisions. The final validator is
correct to reject those objects, but the Workflow must isolate candidate-local
write defects before constructing a ChangeSet.

This change is limited to the existing Research Report Knowledge Ingestion
Workflow. It does not add a Skill, Agent, Layer, Memory, Evaluation module,
provider, planner, retry loop, or semantic repair behavior.

## Boundary

The deterministic stage order becomes:

`Extraction -> Candidate Validation -> Consolidation -> Reference Resolution -> Post-Resolution Write Readiness -> Reconciliation (existing_ref only) -> Schema Gap -> ChangeSet -> Final Validation -> Writer`

Post-Resolution Write Readiness runs after all resolutions are available and
before precise reconciliation groups are built. Candidates rejected by this
stage are carried as ReviewItems and excluded from reconciliation and safe
ChangeSet planning. Existing final `validateChangeSet()` remains the
authoritative gate.

## Authoritative projection

`canonicalFrom()` will receive the candidate's `Resolution` result and will
consume only its resolved refs for relations and claims:

- relation `refs[0]` and `refs[1]` are the resolved source and target refs;
- claim `refs.slice(0, subjectMentions.length)` are the resolved subject refs;
- an existing claim id, when present as an extra resolution ref, is never
  projected into `subjectRefs`;
- existing canonical entity refs, temporary `new-entity-*` refs, and
  candidate-local entity refs are translated through one deterministic map to
  the final canonical entity id.

No projection path will read relation or claim mention text as an identity
lookup or perform fuzzy matching. Missing authoritative refs are treated as a
candidate-local write-readiness review condition rather than emitted as empty
canonical fields.

## Post-resolution checks

The stage builds a resolved entity-type map from the target index and the
resolved new Entity candidates. For every resolved relation, it reads the
frozen `KNOWLEDGE_SCHEMA_V03.relation.definitions[relationType]` definition and
checks source types, target types, and the declared same-type endpoint
constraint. A failure creates an `invalid_semantics` ReviewItem with the
candidate id, deterministic reason, and dependency information. It does not
change entity types, relation types, endpoints, or candidate attributes, and
does not retry a model call.

For new claims, the stage verifies that the authoritative subject-ref count
matches the candidate subject count, every projected ref is non-empty, and
each ref resolves to an Entity or Relation in the known/projected object map.
Failure creates an `invalid_reference` ReviewItem and excludes the claim from
the ChangeSet.

## Cardinality isolation

After authoritative endpoint canonicalization, new `business_exposure`
relations are grouped by `(sourceRef, targetRef)`. If a group contains more
than one distinct consolidated candidate, every member receives a review item
whose reason identifies a `new-object cardinality collision` and lists the
collision candidate ids. No arbitrary winner is selected, no relation is
created from that group, and no C14 reconciliation call is made for it.

Exact duplicates remain governed by the existing `consolidate()` behavior and
are not newly forced into review.

All new review items are passed through the existing dependency closure. A
relation or claim depending on a reviewed Entity is consequently reviewed as
well, preventing dangling canonical refs in the safe subset.

## Verification

Deterministic ingestion tests will cover case-normalized projection, alias
projection, claim subjects, deferred invalid and valid relation semantics,
new-object cardinality collisions, exact duplicate preservation, dependency
closure, and a mixed safe/review ChangeSet whose final validation passes. The
existing curation, ingestion, validation, product-validation,
infrastructure, typecheck, `git diff --check`, and `npm test` suites remain the
regression gate. Real LLM/DeepSeek execution and R9-R4 are explicitly out of
scope.

