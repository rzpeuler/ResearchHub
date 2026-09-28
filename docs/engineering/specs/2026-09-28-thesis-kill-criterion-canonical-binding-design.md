# RHL-TL-001 Kill Criterion Canonical Binding — Design

**Status:** approved design direction; implementation acceptance pending

**Date:** 2026-09-28
**Scope:** close the `DESIGN_SCHEMA_GAP` for aggregate Thesis `invalidated`, then close TL-001. This is not a new research capability or a new orchestration layer.

## Decision and boundary

Extend the existing Schema 0.4 `Thesis` object with an optional, versioned `killCriteria` collection. A missing collection is valid historical data but conveys **no authority to invalidate**. An old Thesis can gain that authority only after a human supplies and confirms a criterion through a governed application command. Neither a historical Thesis statement nor a model suggestion is silently promoted into a canonical criterion.

The stable envelope admits future criterion types without changing the enclosing Thesis shape. This release writes and evaluates only `numeric_threshold`. A future `duration`, `event`, `claim_state`, or `compound` type requires a separately approved definition validator and deterministic evaluator. An unknown type may be retained by a reader, but cannot be newly written, evaluated as `met`, or used for invalidation by this release.

Workflow triggers the check; Research Skills produce or classify research Evidence/Claim. A deterministic evaluator under Thesis Lifecycle / Knowledge owns criterion assessment and returns `met`, `not_met`, or `insufficient_evidence`. ReviewCase and the existing Knowledge Production Gateway → validation → ChangeSet → Writer path own the reviewed lifecycle transition. No independent Kill Criterion Skill, Agent Runtime, provider layer, or direct Knowledge write is introduced.

## Canonical shape

`KnowledgeThesisV04.killCriteria` is an optional, bounded array of immutable definition revisions. Each entry has:

| Field | Contract |
| --- | --- |
| `conditionId`, `revision` | Stable Thesis-local ID and positive monotonically increasing revision. The pair is unique. At most one revision per ID is active. |
| `state` | `active` or `superseded`. A revision is never silently deleted; a changed definition appends a new revision and supersedes the former one in the same validated write. |
| `type`, `definitionVersion`, `definition` | Stable discriminator, positive payload version, and bounded structured definition. Type-specific validators reject unknown types for new writes; readers preserve them without treating them as satisfied. |
| `targetClaimRefs` | Nonempty exact canonical proposition Claim refs that currently have active `qualifies` membership in this Thesis. |
| `effectiveAt`, `definitionHash` | Explicit activation time and deterministic hash of the immutable typed definition, targets, and definition origin. Confirmation time is recorded separately so the prepare hash remains stable. |
| `authority` | The confirmed authoring workflow run ID, confirmation time, and definition origin. The origin is either an explicitly human-set investment rule or a source-derived threshold with exact Source/Raw binding. Both require human confirmation. |

The first registered `numeric_threshold` definition contains `metricRef`, `operator` (`eq`, `gt`, `gte`, `lt`, `lte`), finite `threshold`, exact `unit`, exact `period`, and optional `deadline`. Metric identity, unit, and period are required for a `met` or `not_met` result; implicit unit conversion and fuzzy period matching are excluded. A source-derived threshold additionally carries its admitted Source/Raw and exact value locator. A human-set threshold records its human-rule origin rather than inventing a Source.

The collection and each definition have explicit size/count limits in the validator. The Schema 0.4 executable contract and validator must recognize the optional field; an absent field remains valid. This is an additive v0.4 extension, not an automatic Knowledge Base migration. Normal Thesis CREATE and reviewed status updates must preserve the collection unless a criterion-specific confirmed command intentionally changes it. Thesis identity (`subjectRefs` plus title), Claim identity, and `qualifies` membership stay unchanged.

## Authoring and revision

The local application exposes a bounded prepare/confirm flow for both new and old Thesis records. Prepare resolves the current Thesis and target proposition Claims, validates the typed definition, shows a canonical preview plus hash, and performs no Knowledge mutation. Confirm requires that hash, a stable run ID, and the observed Knowledge revision. The UI must require an explicit human action; this command is not exposed as an autonomous Pi research tool. Confirm submits only through Gateway/Validator/Writer, reloads the Thesis, and records a durable result. Identical replay returns the same result; a changed definition or stale revision conflicts. The application does not infer a definition from narrative text.

Only a complete, active definition can enter REFRESH evaluation. Superseding or replacing a definition changes its revision/hash and makes every ReviewCase bound to the old revision stale. A historical Thesis with no active criterion still supports ordinary REFRESH and challenged/weakening review, but `invalidated` remains blocked with a specific criterion-missing diagnostic.

## Deterministic evaluation and evidence

The REFRESH adapter loads active definitions from the same canonical Thesis revision as the proposition snapshot. It validates target membership, definition hash/version, authority, and any threshold Source/Raw rights and publication timing. The Workflow passes eligible, explicitly bound current evidence to the deterministic evaluator; it does not ask a model whether the threshold is met.

For `numeric_threshold`, eligible evidence must have one finite numeric value with exact metric, unit, period, canonical Source/Raw provenance, admitted rights, a publication time no later than `asOf`, and proof that the **numeric value version** was present in that original-publisher Raw at that time. Publication PIT alone is insufficient. If an exact value/period/locator cannot be verified from the retained original material, evaluation returns `insufficient_evidence`. Multiple eligible observations for the same metric and period are resolved only when their revision order and value authority are explicit; an unresolved conflict returns `insufficient_evidence`. The evaluator never picks the first candidate or averages sources.

`not_met` requires one unambiguous eligible value that fails the comparator. `met` requires the same proof and a true comparator. Missing, future, restricted, stale, ambiguous, unsupported-type, mismatched-unit/period, and unverifiable numeric evidence return `insufficient_evidence` with bounded diagnostic codes. The existing Skill's kill-condition calculation is removed from the product authority path; proposition research semantics remain Skill-owned. Only an evaluator `met` may produce `invalidation_condition_met` and a scoped ReviewCase. Evaluator output alone never writes `KnowledgeThesisV04.status = invalidated`.

## Review and human decision

The invalidation ReviewCase stores the Thesis/Claim/evidence scope, canonical condition ID, revision, definition hash, evaluated value identity, Source/Raw bindings, `asOf`, and the `met` assessment. Its target Claim refs must match active Thesis membership. The case remains an advisory proposal until human ACCEPT.

On ACCEPT, the decision service reloads current Knowledge, rebinds the active condition and all scoped Claims/evidence, verifies rights/PIT/Raw and numeric value version again, and reruns the deterministic evaluator. It checks that the condition revision/hash and reviewed evidence scope still match. A changed or absent definition, changed target membership, a new competing value with unresolved authority, or an assessment other than `met` marks the case STALE or blocks with no canonical transition. It does not trust the stored `met` value. If the current result remains `met`, ACCEPT uses the existing compare-and-write `APPLYING` intent, Gateway/Writer, canonical reload, and durable report/decision reconciliation to commit `invalidated`. REJECT and DEFER perform no canonical write. Identical ACCEPT replay does not advance the Knowledge revision.

The existing `invalidated` guards remain in place until this end-to-end path passes acceptance. No direct HTTP/UI canonical write is added. No criterion from a legacy Thesis is automatically generated or migrated.

## Alternatives considered

| Approach | Result |
| --- | --- |
| Optional typed, versioned definitions on v0.4 Thesis | **Chosen.** Keeps criterion authority with the Thesis and reuses existing canonical write/reload path. Old data remains readable; absent criteria remain blocked. |
| Dedicated criterion object in a new Schema version | Clear independent lifecycle, but requires new registry kind, storage/Writer path, migration and query contracts. Defer unless the bounded Thesis collection proves insufficient. |
| Encode conditions as Claim/ReasoningEdge text | Rejected. A Claim does not encode an authoritative comparator, unit, definition revision, or human confirmation, and `qualifies` already has proposition membership semantics. |

## Acceptance and closure

Offline tests cover Schema compatibility; prepare/confirm and revision replay; unknown/future type fail-closed behavior; old Thesis without a criterion; target membership; source-derived and human-set threshold authority; rights/Raw/PIT/value-version checks; exact unit/period matching; conflicting numeric values; changed condition after ReviewCase; DEFER/REJECT no-write; ACCEPT writer/reload/report; crash recovery and replay. A real configured-Pi/source acceptance run must exercise the ordinary product route using an isolated v0.4 Knowledge Base and prove one human-accepted `invalidated` transition with canonical revision advance and reload. Fixture success is reported separately from real acceptance.

TL-001 closes only when CREATE, ordinary REFRESH, human decision, and this invalidation path pass their respective gates, reports match machine evidence, the user Knowledge Base remains untouched during isolated acceptance, and the accepted branch is merged to `main` with remote verification. After closure, new Thesis Lifecycle feature expansion is out of scope for this task.
