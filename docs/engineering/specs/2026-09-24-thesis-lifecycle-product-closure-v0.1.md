# RHL-TL-001 Thesis Lifecycle Product Closure — Design & Contract Freeze

**Status:** DESIGN ACCEPTED / IMPLEMENTATION ACCEPTANCE PASSED; MAIN INTEGRATION PENDING
**Date:** 2026-09-24
**Mode:** design and source-code audit only; no runtime implementation in this task

Implementation and real-source acceptance are recorded separately in the [2026-09-28 TL-001 final acceptance](../reports/2026-09-28-thesis-lifecycle-final-closure.md). The mode above describes this original design task.

This document freezes the smallest product contract for maintaining an existing
canonical Thesis when new accepted, point-in-time-safe evidence arrives. It is
intentionally a product and architecture contract, not a second workflow engine.

## Executive Decision

Implement the maintenance loop as a bounded `REFRESH` product path first, with a
small `CREATE` path sufficient to establish the same canonical shape:

```text
accepted PIT-safe evidence
  -> existing Thesis and proposition Claims
  -> deterministic PriorThesisSnapshot reconstruction
  -> refreshThesis()
  -> proposition deltas and candidate transition
  -> safe additive proposals or Thesis-scoped ReviewCase
  -> current-Knowledge rebind on human decision
  -> Knowledge Production Gateway
  -> validated ChangeSet / Writer
  -> canonical reload and visible report
```

The canonical model remains Knowledge schema v0.4:

* `KnowledgeThesisV04` is the aggregate identity, subject, statement, aggregate
  lifecycle status, and dates.
* Each formalized proposition is a `KnowledgeClaimV04` with a deterministic
  bounded `ClaimTypeV04` mapping.
* A `ReasoningEdgeV04` of type `qualifies`, from proposition Claim to Thesis,
  is the exclusive membership convention. It means “this Claim is a
  constitutive qualification/proposition of this Thesis”; it does not mean the
  Claim supports the Thesis.
* Evidence impact is represented by source/Observation/Claim provenance and
  impact edges to the proposition Claim. `supports`, `challenges`,
  `contradicts`, and conditionally `invalidates` retain their truthful meanings.

No `KnowledgeThesisProposition`, `ThesisPropositionStore`, `ThesisGraphStore`,
new Knowledge database, Agent, Planner, Provider layer, scheduler, event bus, or
generic review platform is designed here.

The source evidence for this decision is the current formalization contract
(`skills/thesis_formalize/contracts.ts:1-105`), refresh contract
(`skills/thesis_refresh/contracts.ts:1-123`), v0.4 domain model
(`knowledge/schema/domain-v04.ts:3-14,66-78,207-232`), production proposal
contract (`knowledge/production/contracts.ts:7-60`), and Gateway behavior
(`knowledge/production/gateway.ts:42-45,62,148-179`).

## Current Runtime Gap

The repository already has the deterministic semantic pieces but not the
product closure:

* `runThesisLifecycle` composes `CREATE`/`REFRESH` skills and currently returns
  `completed|blocked` (`workflows/thesis-lifecycle/contracts.ts:7-32`). It does
  not itself provide a durable application-level lifecycle run, report, or
  Gateway/Writer closure.
* `formalizeThesis()` already accepts the nine proposition types and three
  evidence bases, and returns normalized propositions, dependencies, load-bearing
  refs, diagnostics, and `asOf` (`skills/thesis_formalize/contracts.ts:1-5,18-43,85-105`).
* `refreshThesis()` already provides the required evidence relations, proposition
  statuses, kill assessments, unchanged refs, deltas, and candidate transition
  (`skills/thesis_refresh/contracts.ts:1-8,93-123`).
* The Gateway already writes Thesis, Claim, and ReasoningEdge proposals through
  the governed production path. It rejects a Claim with `claimType: 'thesis'`
  as legacy semantics and requires the Thesis object instead
  (`knowledge/production/gateway.ts:62,148-179`).
* The application currently exposes read-only ReviewCase list/get and bounded
  research starts, including Earnings Review and thesis red-team, but no
  thesis-lifecycle start/report/decision path
  (`app/runtime/server.ts:390-409,492-515`; `app/pi/tools.ts:55,84,103-113`).

The gap is therefore orchestration, durable review decision handling, current
revision rebinding, reporting, and UI/API/Pi exposure—not new thesis semantics.

## Canonical Thesis Model

`KnowledgeThesisV04` owns:

* canonical `thesis:<id>` identity;
* subject entity references;
* title and aggregate statement;
* aggregate status (`active`, `strengthening`, `weakening`, `challenged`,
  `invalidated`, or `archived`);
* creation, review, update, and lifecycle dates.

It does not duplicate a proposition list or proposition text. The current schema
is exactly this shape (`knowledge/schema/domain-v04.ts:207-218`).

An individual proposition is a `KnowledgeClaimV04`. Its statement, mapped claim
type, source references, provenance, temporal fields, confidence/probability
where valid, claim-to-claim relationships, and supersession state live on the
Claim (`knowledge/schema/domain-v04.ts:66-78`).

Proposition refresh status is a derived lifecycle interpretation, not a new
Claim field. The current status is reproducible from the active proposition
Claim, its `qualifies` membership edge, accepted evidence impact edges, and the
latest lifecycle report/decision. This prevents duplicate status truth in both
Claim and a new proposition object. A status-changing accepted decision must
leave enough graph evidence or Claim supersession state for the next refresh to
recompute the same result.

## Canonical Proposition Mapping

The mapping is deterministic and bounded. It is applied before proposal
construction; a model may supply a proposition, but may not choose an arbitrary
canonical type.

| Formal proposition type | `verified_evidence` | `inference` | `hypothesis` |
| --- | --- | --- | --- |
| `business_driver` | `fact` | `viewpoint` | `assumption` |
| `industry_condition` | `fact` | `viewpoint` | `assumption` |
| `competitive_position` | `fact` | `viewpoint` | `assumption` |
| `financial_outcome` | `fact` | `viewpoint` | `assumption` |
| `earnings_expectation` | `forecast` | `forecast` | `forecast` |
| `valuation_expectation` | `forecast` | `forecast` | `forecast` |
| `catalyst` | `catalyst` | `catalyst` | `catalyst` |
| `risk` | `risk` | `risk` | `risk` |
| `other` | `fact` | `viewpoint` | `assumption` |

`trend` is reserved for a proposition whose statement is explicitly a temporal
trend observation; it is not selected solely by the input type. `thesis` is not
selected for propositions because the Gateway rejects legacy Claim-as-Thesis
semantics. A Thesis is always proposed as `kind: 'thesis'`; its propositions are
Claims.

An invalid or missing basis is a blocked formalization, not a model-selected
fallback. A proposition that cannot be mapped without semantic invention is
`DESIGN_DRIFT` for implementation review.

## Proposition Identity

`ThesisPropositionInput.propositionId` is a producer-run-local reference. The
formalization contract explicitly carries `existingKnowledgeRefs`, but the
production contract states that proposal IDs are local proposal keys only
(`skills/thesis_formalize/contracts.ts:18-33,85-93`;
`knowledge/production/contracts.ts:7-10,48-60`).

For `REFRESH`, canonical identity is resolved in this order:

1. Resolve exactly one canonical Thesis by explicit `thesisRef`, subject, and
   title/identity constraints. Zero or multiple matches block.
2. Read active `qualifies` edges targeting that Thesis.
3. Resolve each edge source to an active Claim. The canonical Claim ref becomes
   the refresh-local proposition ref.
4. Match incoming formalized proposition refs to those canonical Claim refs using
   the persisted producer binding plus the deterministic identity tuple:
   mapped claim type, normalized statement, subject refs, temporal fields, and
   valid structured value. The Gateway currently uses this tuple for exact Claim
   identity (`knowledge/production/gateway.ts:42-44`).
5. If exactly one existing Claim is bound, preserve it even when the run ID,
   report ID, retrieval time, or `asOf` changes. If no unique binding exists,
   create a review-required resolution; never allocate a new Claim merely due to
   a new run.

The current Gateway has a separate endpoint-binding limitation. Its local
`boundRef()` resolves only a local proposal key to a canonical ref produced by
the current Gateway submission (`knowledge/production/gateway.ts:98,177`). It
does not resolve an arbitrary existing `claim:`, `observation:`, or `thesis:`
ref supplied as a ReasoningEdge endpoint. Consequently, the current Gateway
cannot truthfully express either of these REFRESH operations without creating a
fake local proposal first:

```text
existing Observation --challenges--> existing proposition Claim
existing proposition Claim --qualifies--> existing Thesis
```

The implementation phase adds the following minimal producer-only fields to
`SemanticProductionProposal` for `kind: 'reasoning_edge'`:

```text
existingSourceRef?: CanonicalKnowledgeRefV04
existingTargetRef?: CanonicalKnowledgeRefV04
```

For an edge, exactly one logical source selector is required: the existing local
selector (`sourceProposalId`/`subjectKey`) or `existingSourceRef`. Exactly one
logical target selector is required: `targetKey` or `existingTargetRef`.
Supplying both, or neither, is blocked; the Gateway must not silently prefer one.
The fields are server/producer-owned and are never client-supplied mutation
commands.

When an existing ref is selected, the Gateway resolves it from the current
canonical Knowledge revision, verifies existence, lifecycle validity, endpoint
kind (`Observation|Claim` for source and `Claim|Thesis` for target), and edge
type before constructing the ChangeSet. The Writer remains downstream of the
Gateway. CREATE continues to use local proposal bindings; the extension exists
primarily for REFRESH and current-Knowledge ACCEPT rebinding.

The producer-side convention, when a stable key is needed for a proposal, is:

```text
thesis:<canonical-thesis-ref>:proposition:<bounded-stable-key>
```

It is a local binding hint, not a new canonical namespace. The current top-level
`SemanticProductionProposal.semanticKey` is not sufficient: the Gateway’s Claim
identity and persisted ID allocation do not use it as a universal identity
(`knowledge/production/contracts.ts:57`; `knowledge/production/gateway.ts:42-44,153-159`).
Therefore every refresh proposal must also carry the exact canonical Claim in
`existingKnowledgeRefs` when updating, superseding, or contradicting. An
ambiguous key or a key that disagrees with the current `qualifies` binding is a
ReviewCase, not an automatic rebind. For a reviewed Thesis update, the selected
canonical Thesis is resolved before proposal construction; the computed
`subjectRefs + title` Thesis identity must equal the selected `thesisRef`, with
unchanged subjects and title. Title drift is outside TL-001.

For a reviewed proposition update/supersession/contradiction, exactly one
currently valid canonical Claim is required in `existingKnowledgeRefs`. A
semantic resolver cannot override that explicit reviewed binding. The generic
Gateway's in-place `update` behavior is not an automatic Thesis-proposition
semantic update; it is usable only inside the reviewed, revalidated bundle.

## Claim Graph

Claim-to-Claim proposition relationships use the native v0.4 arrays:

* `dependsOnClaimRefs` for prerequisite propositions;
* `supportsClaimRefs` for a proposition that supports another Claim;
* `contradictsClaimRefs` for a proposition that logically contradicts another;
* `supersedes`/`supersededBy` for an accepted replacement.

The formalization dependencies map directly from
`dependsOnPropositionRefs`/`supportingPropositionRefs` to these arrays after
canonical refs are bound. No dependency graph is stored as opaque JSON.

Evidence impact is separate from proposition membership. A new Observation or
evidence Claim may create a ReasoningEdge to the proposition Claim:

| Refresh relation | Canonical impact representation |
| --- | --- |
| `supports` | report classification; `supports` edge only when AUTO_SAFE |
| `weakens` | report classification; `challenges` edge only when ACCEPTed |
| `contradicts` | report classification; `contradicts` edge only when ACCEPTed |
| `context` | source/provenance only unless a truthful qualifying edge exists |
| `irrelevant` | no proposition impact edge |

`weakens` remains the refresh vocabulary; v0.4 has no `weakens` edge, so
`challenges` is the truthful canonical approximation when the reviewed action is
accepted. `challenges`, `contradicts`, and `invalidates` are not automatically
written merely because the refresh classifier produced those labels.

## Thesis Linkage

The chosen membership convention is:

```text
Claim(proposition) --qualifies--> Thesis
```

`qualifies` means the Claim is a constitutive qualification of the Thesis. It
does not assert that the proposition supports the Thesis. A risk Claim can
therefore qualify a Thesis without being incorrectly marked as supportive.

The schema and Gateway endpoint validator permit a Claim or Observation as a
ReasoningEdge source and a Claim or Thesis as target
(`knowledge/schema/domain-v04.ts:220-232`; `knowledge/production/gateway.ts:177`).
The current Gateway can only reach those endpoints through current-submission
local bindings; the minimal `existingSourceRef`/`existingTargetRef` producer
extension makes the canonical endpoint explicit for REFRESH. The edge ID is
deterministic from edge type, source, and target in the Gateway, so membership is
reconstructable and idempotent once the endpoint is resolved.

CREATE emits one Thesis, one Claim per proposition, Claim relationship links,
and one `qualifies` edge per proposition in the same production proposal set.
REFRESH reconstructs membership solely from active `qualifies` edges targeting
the Thesis. A missing edge is a canonical binding gap and blocks; it is not
silently inferred from report text.

No `propositionRefs` field is added to `KnowledgeThesisV04`. v0.4 is sufficient
under this explicit convention. If implementation discovers that the existing
validator/storage cannot persist or reconstruct `qualifies` membership without
repurposing an edge inaccurately, the implementation must stop with
`DESIGN_SCHEMA_GAP` rather than add a hidden parallel store.

## Evidence Contract

Every refresh evidence item has:

* stable run-local `evidenceId`;
* canonical or candidate source refs;
* required publication timestamp;
* refresh relation and target canonical proposition refs;
* statement and, when applicable, metric, period, unit, value, and basis.

This mirrors `RefreshEvidence` (`skills/thesis_refresh/contracts.ts:25-37`).
Evidence is admitted only after source governance and source binding. An
unbound source, missing required provenance, or a source whose rights/policy do
not permit derived Knowledge blocks that item.

Lineage is:

```text
Thesis -> qualifies edge -> proposition Claim
proposition Claim <- impact edge <- Observation or evidence Claim
Observation/evidence Claim <- source/provenance <- Source and raw evidence
```

A report alone never mutates a Thesis. The canonical write contains the Source,
Observation/evidence Claim, impact edge, and any explicitly accepted Claim or
Thesis update through the Gateway.

## PIT Contract

For refresh `currentAsOf = T`, only evidence with `publishedAt <= T` is
eligible. The source’s retrieval time is not publication time. Future evidence
is rejected from the refresh; unknown publication time is not eligible to drive
kill-criterion satisfaction, canonical contradiction, or automatic
supersession.

An unknown publication date may be retained as an inspectable acquisition
diagnostic or a non-decisive source artifact, but it cannot affect
`propositionDeltas`, `candidateTransition`, or a canonical status decision.
Source contracts that prove availability at `T` may provide a separately
validated timestamp; absent that proof, the item remains unavailable.

The PIT filter runs before `refreshThesis()`, is recorded in the report, and is
replayed during ACCEPT. A later Writer call cannot widen the evidence set.

## Refresh State Machine

The application state machine is:

```text
START
  -> RESOLVE_THESIS
  -> RECONSTRUCT_SNAPSHOT
  -> ADMIT_AND_PIT_FILTER_EVIDENCE
  -> RUN_REFRESH
   -> SPLIT_PROPOSALS
       |-- AUTO_SAFE -------------------------------> GATEWAY -> WRITER -> RELOAD -> COMPLETE
       |-- REVIEW_REQUIRED -------------------------> REVIEW_OPEN
       |                                                |-- ACCEPT -> REBIND_CURRENT -> GATEWAY
       |                                                |             -> WRITER -> RELOAD -> COMPLETE
       |                                                |-- REJECT -> REPORT -> COMPLETE
       |                                                |-- DEFER  -> REPORT -> COMPLETED_WITH_REVIEW
       |-- NO_WRITE / blocked ----------------------> REPORT -> BLOCKED or COMPLETE
```

`refreshThesis()` remains the only source of refresh semantics. Its outputs
`propositionDeltas`, `unchangedPropositionRefs`, `killCriterionAssessments`, and
`candidateTransition` are preserved verbatim in the lifecycle report
(`skills/thesis_refresh/contracts.ts:93-123`).

The application-level run status is one of `completed`,
`completed_with_review`, `blocked`, `failed`, or `cancelled`. Semantic decision
state is separate: `NO_CHANGE`, `AUTO_APPLIED`, `REVIEW_REQUIRED`, `ACCEPTED`,
`REJECTED`, `DEFERRED`, `STALE`, or `BLOCKED`. An open ReviewCase makes the run
`completed_with_review`; it must not be disguised as ordinary completion.

Every REFRESH proposal is placed in exactly one bucket:

* `AUTO_SAFE`: accepted new Source and raw provenance, evidence merge on an
  unchanged Claim, a semantically non-disputed `supports` edge, or a new
  non-Thesis evidence Claim. These actions must not change proposition
  membership, proposition semantics, or Thesis status.
* `REVIEW_REQUIRED`: a new Thesis proposition, any proposition semantic change,
  load-bearing weakening, a reviewed `challenges`/`contradicts`/`invalidates`
  edge, supersession, membership change, Thesis status change, kill/invalidation,
  or archive.
* `NO_WRITE`: future or unknown-publication decisive evidence, irrelevant
  evidence, REJECT, DEFER, or stale decision. The report may retain the proposed
  classification, but canonical Knowledge is not mutated.

The system never auto-supersedes a load-bearing Claim or writes a reviewed
impact edge merely because a semantic resolver says it is weakened.

## Kill Criterion Semantics

The frozen rule is:

```text
kill criterion status = met
  -> proposition status = invalidation_condition_met
  -> candidate transition = invalidation_condition_met
  -> affected refs, evidence refs, rationale, recommendation, ReviewCase
```

It does not write `KnowledgeThesisV04.status = invalidated`. `inconclusive`,
`not_yet_observable`, and `threshold_pending_evidence` remain non-invalidation
outcomes. The existing `KillCriterionAssessment` fields provide condition,
status, target propositions, evidence refs, and rationale
(`skills/thesis_refresh/contracts.ts:39-50,105-111`).

Only an explicit human ACCEPT of the scoped ReviewCase may commit aggregate
`invalidated`, and that ACCEPT must still pass current-Knowledge validation.

## Automatic vs Human-Owned Actions

| Action | Owner | Rule |
| --- | --- | --- |
| source admission and PIT filtering | system | deterministic, fail closed |
| evidence-to-proposition binding | system | exact or unique bounded match only |
| unchanged preservation | system | preserve every active bound Claim not affected by eligible evidence |
| support/weakening/contradiction classification | system + existing deterministic skill | output only; preserve refresh vocabulary |
| kill calculation | system | condition assessment only |
| new additive source/Observation/evidence Claim | system | only if non-disputed and no status change |
| evidence classification in the refresh report | system + existing deterministic skill | preserves the existing refresh vocabulary; report-only until accepted |
| `supports` impact edge | system | AUTO_SAFE only when semantically non-disputed and no proposition/Thesis state changes |
| `challenges`, `contradicts`, or `invalidates` impact edge | human approval required | part of the reviewed action bundle; written only on ACCEPT |
| `qualifies` membership edge | human approval required on REFRESH | CREATE may establish initial membership; REFRESH membership changes are semantic |
| proposition text update | human approval required | ACCEPT must identify current Claim and intended update |
| proposition supersession | human approval required | never automatic for load-bearing Claims |
| Thesis `active`/`strengthening`/`weakening`/`challenged` | human approval required on refresh | system emits recommendation only |
| Thesis `invalidated` | human only | requires met kill condition and ACCEPT |
| Thesis `archived` | human only | explicit archive decision; not a refresh side effect |
| report and diagnostic persistence | system | durable and replay-safe |

CREATE is an explicit user launch and may create the initial active Thesis and
its proposition graph. That is user authorization to create, not automatic
semantic status mutation during REFRESH.

## ReviewCase Trigger Matrix

| Trigger | Review? | Reason |
| --- | --- | --- |
| no eligible new evidence | no | report `NO_CHANGE` |
| exact unchanged proposition with additive evidence | normally no | source/provenance merge; safe `supports` only when non-disputed |
| new non-Thesis factual evidence Claim | normally no | additive evidence object with no Thesis membership |
| new Claim plus `qualifies` edge to existing Thesis | yes | creates a new Thesis proposition |
| proposition statement/type/temporal/structured-basis change | yes | semantic proposition change |
| proposition membership add/remove/replace | yes | Thesis structure changes |
| existing proposition contradiction | yes | semantic meaning changes |
| existing proposition supersession | yes | identity and historical continuity change |
| load-bearing proposition weakened/challenged | yes | material thesis meaning risk |
| `possible_invalidation` or `invalidation_condition_met` | yes | never automatic invalidation |
| any Thesis status change | yes | aggregate investment-thesis decision |
| ambiguous Thesis/proposition binding | yes, or block if unsafe | no deterministic target |
| proposition no longer active/superseded | yes or block | stale semantic target |
| missing/future/unknown PIT source | no write; diagnostic | evidence is not decision-eligible |
| duplicate equivalent proposal | no new case | idempotent replay |

The current ReviewCase model has only `entity`, `relation`, and `claim` root
proposal kinds (`knowledge/review/contracts.ts:4-10`). The lifecycle uses a
Claim-backed case: the affected proposition Claim is the root, and the existing
scalar context fields are used exactly as follows:

```text
resolutionContext.context.thesisRef = canonical Thesis ref
resolutionContext.context.candidateTransition = bounded scalar state
resolutionContext.knowledgeBaseRevisionAtCreation = base revision
impact.affectedProposalRefs = canonical proposition Claim refs
```

`ReviewCaseResolutionContext.context` currently permits only scalar string,
number, boolean, or null values (`knowledge/review/contracts.ts:72-76`). The
design does not claim that arbitrary Thesis scope fits there, does not encode
arrays as JSON strings, and does not add a generic Thesis root. Any additional
scalar must fit the current contract; affected Claim refs belong in
`impact.affectedProposalRefs`.

A Thesis-scoped ReviewCase also requires at least one truthful accepted evidence
binding. Current ReviewCase evidence is a `raw_document_block` with a real
`rawRef` (`knowledge/review/contracts.ts:11-17`), so canonical Observation/Claim
evidence must resolve through `Observation/Claim -> provenance -> Source ->
rawRef`. No synthetic rawRef or fabricated raw-document block is allowed. If no
real archived rawRef is available, construction fails closed with
`REVIEW_EVIDENCE_BINDING_UNAVAILABLE` unless a separately reviewed operational
evidence-binding extension is approved.

## Thesis-Scoped ReviewDecision

The decision vocabulary is exactly `ACCEPT`, `REJECT`, or `DEFER`. The client
may submit only `reviewCaseId`, the decision, and an optional bounded note. It
cannot submit Knowledge operations, Claim IDs to write, proposals, patches, or
source refs.

The ReviewCase remains the durable immutable proposal context. A minimal
`ReviewDecision` record is persisted beside it in the existing review storage
boundary:

```text
<knowledge-base>/reviews/runs/<producerRunId>/manifest.yaml
<knowledge-base>/reviews/runs/<producerRunId>/cases/<reviewCaseId>.yaml
<knowledge-base>/reviews/runs/<producerRunId>/decisions/<reviewCaseId>.yaml
```

The new record is not a Knowledge asset and does not create a new store. It is a
decision-state record with append-only events:

```text
ReviewDecisionRecord {
  version
  reviewCaseId
  producerRunId
  knowledgeBaseId
  currentState: OPEN | DEFERRED | ACCEPTED | REJECTED | STALE
  revision
  events[]
}
```

Each event contains only bounded fields: `decision` (`ACCEPT|REJECT|DEFER`),
`actor: local_user`, optional note, `decisionAt`, observed Knowledge revision,
ReviewCase hash, outcome, optional canonical result refs, and diagnostics. The
valid transitions are `OPEN -> ACCEPTED|REJECTED|DEFERRED`,
`DEFERRED -> ACCEPTED|REJECTED|DEFERRED`, subject to revalidation. ACCEPTED,
REJECTED, and STALE are terminal; a stale case requires a new ReviewCase from a
new refresh.

DEFERRED is unresolved and still actionable, not terminal. Decision events are
append-only within the record. Updating a deferred record uses expected-current
hash/revision compare-and-write protection, the existing path safety, mutation
lock, atomic temp-write/rename, and deterministic replay conventions
(`knowledge/review/store.ts:29-70,90-95`).

`ReviewCaseStatus` is currently only `open` and the historical case file remains
unchanged. The application projection must overlay the decision record:

```text
ReviewService/application list-get projection = ReviewCase + ReviewDecisionRecord
```

Actionable cases are `OPEN` and `DEFERRED`; resolved/non-actionable cases are
`ACCEPTED`, `REJECTED`, and `STALE`. Existing `listOpenReviewCases()` and
`countOpenReviewCases()` cannot expose raw `state.status` as user-facing truth
after this feature. They must become decision-aware projections, or clearly
named decision-aware methods must be added and all product consumers migrated.
Accepted/rejected/stale cases must not remain in the actionable UI listing.

## ACCEPT Semantics

ACCEPT is a server-side command, not approval of a stale ChangeSet:

1. Load the immutable ReviewCase and decision history.
2. Reject a conflicting replay against ACCEPTED or return the durable result for
   an identical event replay.
3. Reload current Knowledge and compare revision, selected Thesis identity,
   Thesis status, proposition Claim lifecycle, `qualifies` edge, supersession,
   evidence provenance/PIT, and source eligibility.
4. Resolve the selected Thesis and current proposition Claims again. Require
   the reviewed Claim binding to remain exactly one valid canonical Claim and
   require the selected Thesis `subjectRefs + title` identity to remain equal to
   `thesisRef`.
5. Re-run the applicable deterministic proposal builder. Do not trust client,
   stored stale Gateway proposals, or semantic resolver overrides.
6. Build current Gateway proposals. Reviewed impact and membership edges use
   `existingSourceRef`/`existingTargetRef`; existing Observations/Claims are not
   re-proposed solely to obtain local IDs.
7. If the case is no longer applicable, append a STALE outcome with no semantic
   write and require a new refresh.
8. Otherwise submit through Gateway, validated ChangeSet, and Writer.
9. Reload canonical Knowledge, verify expected Thesis/Claim/edge refs and
   revision, then append ACCEPTED with canonical result refs and report.

ACCEPT may update a proposition Claim, create an accepted replacement with
`supersedes`/`supersededBy`, add the reviewed impact/membership edge, or update
the Thesis aggregate status only for the exact reviewed scope. It cannot perform
arbitrary graph mutation.

## REJECT Semantics

REJECT appends an event and sets current state `REJECTED`, after current-case
applicability/revision checks. It writes no proposed Claim, Thesis status,
supersession, `qualifies`, `challenges`, `contradicts`, or `invalidates` edge.
The original evidence and report remain inspectable. A later evidence change
requires a new REFRESH/new ReviewCase.

An identical replay returns `already_resolved` and the stored rejection; a
different decision payload for the same resolved case is a conflict.

## DEFER Semantics

DEFER appends an event and sets current state `DEFERRED`, without canonical
semantic mutation. The lifecycle run may finish `completed_with_review`, while
the case remains actionable. Later ACCEPT or REJECT is valid only after current
Knowledge reload, Thesis/Claim rebind, evidence/PIT revalidation, and
compare-and-write protection. It may not reuse a stored Gateway proposal set.

Repeated identical DEFER is idempotent and appends no duplicate event. A
materially stale attempted decision appends STALE instead of silently rebasing.

## Stale Revision / Replay

Every lifecycle report, ReviewCase, decision event, ChangeSet, and Writer
attempt records the Knowledge revision it observed. Any mismatch that changes
the reviewed Thesis, Claim, membership edge, source eligibility, or case
condition appends STALE, makes the case non-actionable, and writes no semantic
edge or Claim. There is no automatic semantic rebase.

Replay keys are producer run plus deterministic proposal/case identity, decision
event payload, prior decision revision, and canonical endpoint identity.
Identical replay returns the durable result and creates no duplicate event or
canonical mutation. A conflicting replay against ACCEPTED or REJECTED is
`CONFLICT`; ACCEPTED and REJECTED cannot transition further. The Gateway’s
existing deterministic identity and `bound_existing` behavior are reused
(`knowledge/production/gateway.ts:42-45,148-179`).

## CREATE Product Path

CREATE is a bounded setup path:

1. User selects company/entity and supplies a thesis summary and propositions.
2. `formalizeThesis()` validates and normalizes proposition types, bases,
   dependencies, load-bearing refs, evidence gaps, and `asOf`.
3. The deterministic mapping above produces Claim proposals; the proposal set
   includes one Thesis, Claims, Claim links, sources/evidence, and `qualifies`
   edges.
4. Gateway resolves or creates the entity, validates the proposal graph, creates
   a ChangeSet, Writer commits, and the application reloads canonical refs.
5. The report records the created Thesis and proposition Claim refs, binding
   convention, sources, gaps, and initial status.

Expectation gap, catalyst map, and thesis red-team remain bounded peer skills of
the existing Workflow composition, not new lifecycle engines
(`workflows/thesis-lifecycle/contracts.ts:1-17`).

## REFRESH Product Path

REFRESH is the first implementation priority:

1. User selects an existing canonical Thesis; server resolves the company and
   exact Thesis, never accepts a caller-created `PriorThesisSnapshot`.
2. Server reconstructs the snapshot from active `qualifies` edges and Claims,
   ordered deterministically by canonical ref. Superseded/inactive Claims are
   retained as history but excluded from active proposition matching.
3. Server collects accepted evidence from existing Daily Change Assessment,
   Earnings Review, Event Research, Company Research, or an explicitly accepted
   source lane; no new acquisition layer is introduced.
4. Server admits sources, applies the PIT contract, and binds evidence to
   canonical proposition refs.
5. Server calls `refreshThesis()` with the reconstructed snapshot and eligible
   evidence. Its unchanged refs, deltas, kill assessments, candidate transition,
   and diagnostics are retained.
6. Server splits actions into `AUTO_SAFE`, `REVIEW_REQUIRED`, and `NO_WRITE`.
   Before creating a Thesis-scoped ReviewCase it verifies that accepted evidence
   has a real archived rawRef; otherwise it blocks with
   `REVIEW_EVIDENCE_BINDING_UNAVAILABLE`. It persists valid ReviewCases before
   returning `completed_with_review`.
7. AUTO_SAFE actions go through Gateway/ChangeSet/Writer/reload. Reviewed
   impact/membership edges wait for ACCEPT, REJECT, or DEFER as defined above.
   Existing evidence Observations/Claims are bound with
   `existingSourceRef`/`existingTargetRef`, not re-proposed solely to obtain
   local IDs.

`PriorThesisSnapshot` is therefore an internal adapter output, not a caller
contract. Its `propositionId` values are canonical Claim refs in REFRESH, even
though the skill contract leaves them structurally run-local
(`skills/thesis_refresh/contracts.ts:12-23,52-57`).

## Daily Handoff

Daily Change Assessment remains an evidence producer. It hands off only accepted
source/observation evidence, publication timestamps, canonical subject refs,
and its existing run provenance. The lifecycle performs the Thesis binding and
refresh; Daily does not write Thesis state directly and does not rerun every
research workflow.

Daily items with no exact publication time are diagnostics/non-decisive inputs.
Daily evidence that supports or challenges a proposition follows the evidence
relation mapping and trigger matrix.

## Earnings Handoff

Earnings Review remains the exact-period producer and uses its existing
valuation-impact/thesis filtering semantics. The current filter distinguishes
load-bearing `depends_on` and `invalidates` edges
(`workflows/earnings-review/valuation-impact-thesis-filter.ts:35,148`).

The handoff provides the accepted earnings source, observation/claim refs,
period, publication time, and affected Thesis/Claim candidates. The lifecycle
revalidates PIT and canonical binding, maps ordinary weakening to `challenges`,
and escalates load-bearing or contradictory effects to ReviewCase.

## Report Contract

Every lifecycle run produces a durable report containing:

* run ID, mode, application status, semantic decision state, and timestamps;
* requested Thesis/entity and current Knowledge revisions;
* reconstructed before snapshot and canonical proposition Claim refs;
* all evidence candidates, admission results, publication timestamps, PIT
  exclusions, source rights/provenance, and accepted source refs;
* full `refreshThesis()` result: proposition deltas, unchanged refs, kill
  assessments, candidate transition, and diagnostics;
* automatic proposal actions and their Gateway/ChangeSet/Writer outcomes;
* ReviewCase IDs, trigger reasons, decision status, actor/time/note, and stale or
  replay outcome;
* Thesis/proposition state before and after, including canonical refs and
  resulting Knowledge revisions;
* final reload verification and unresolved diagnostics.

The report is operational evidence, not canonical Knowledge. It must be readable
before and after a human decision and survive process restart.

## Application / HTTP / Pi Surface

The future normal ApplicationService path adds bounded contracts analogous to
existing research services (`app/services/contracts.ts:107-150`):

* `startThesisLifecycle({ mode: 'CREATE'|'REFRESH', ... })`;
* `getThesisLifecycleReport(runId)`;
* `listThesisReviewCases(...)` and `getReviewCase(...)`;
* `decideThesisReview({ reviewCaseId, decision, note? })`.

Suggested HTTP surface:

```text
POST /api/thesis-lifecycle/create
POST /api/thesis-lifecycle/refresh
GET  /api/thesis-lifecycle/:runId/report
GET  /api/reviews/:reviewCaseId
POST /api/reviews/:reviewCaseId/decision
```

The decision body is bounded to `reviewCaseId` from the route, `decision`, and
bounded `note`; the server reconstructs all Knowledge operations. The Gateway,
ChangeSet, Writer, and canonical storage are never exposed to the client.

Pi receives normal tools for launch/report/decision under the existing scoped
production/research service boundary. Pi interprets the report and may request
the bounded command; it never mutates Knowledge directly. Existing read-only
ReviewCase tools remain read-only until this decision path exists.

The minimum UI is a Thesis selector, Refresh action, run status, before/after
report, evidence/PIT view, proposition delta view, ReviewCase detail, and
ACCEPT/REJECT/DEFER controls with final canonical result/revision.

## Knowledge Boundary

The Knowledge Production Gateway remains the only canonical write boundary.
The flow is:

```text
Application/Workflow proposal
  -> Gateway resolution and validation
  -> validated ChangeSet
  -> Writer
  -> canonical reload
```

The client, Pi, skills, reports, and semantic model cannot write canonical
objects directly. Review governance state is durable operational state, not
Knowledge. The implementation adds only the minimal producer-contract endpoint
extension described above; it does not bypass the Gateway or inject direct
ChangeSet operations. The Gateway still validates endpoint types, lifecycle,
revision, and edge type before Writer (`knowledge/production/gateway.ts:98,148-179`).

## Real E2E Design

The eventual configured-Pi E2E uses an existing company Thesis already present
in the mounted Knowledge Base:

1. Select the Thesis and record its current revision and active `qualifies`
   proposition Claims.
2. Run a live accepted Earnings, Event, or Daily source lane with a real
   publication timestamp at or before the refresh `asOf`.
3. Verify one proposition is unchanged and one is weakened/challenged by the
   deterministic refresh output.
4. Verify a durable Thesis-scoped ReviewCase and `completed_with_review`.
5. ACCEPT through normal HTTP or Pi command using only case ID, decision, and
   note.
6. Verify current-Knowledge rebind, Gateway, validated ChangeSet, Writer,
   reload, expected Claim/edge/Thesis result refs, and lifecycle report.
7. Repeat the same ACCEPT and verify no duplicate mutation.

The negative run DEFERs or REJECTs the same type of case and proves the
canonical Thesis, proposition Claims, edges, and revision are unchanged while
the decision/report is durable.

This is an implementation acceptance design. This docs-only task performs no
live source probe and creates no fixture evidence.

## Failure Matrix

| Failure | Required behavior |
| --- | --- |
| Thesis not found | `blocked`, `THESIS_NOT_FOUND`, no proposals/writes |
| ambiguous Thesis | `blocked`, `THESIS_AMBIGUOUS`, require explicit selection |
| no canonical propositions | `blocked`, `NO_CANONICAL_PROPOSITIONS`; do not invent membership |
| missing source | exclude item, report diagnostic; block if no eligible evidence remains |
| future source | exclude from PIT set, report diagnostic, no semantic write |
| unknown publication time | retain inspectable diagnostic only; no kill/contradiction/supersession |
| stale revision before ACCEPT | `STALE_REVIEW_DECISION`, no semantic write |
| proposition inactive/superseded | rebind fails closed; require new refresh/review |
| proposal already superseded | current rebind detects conflict; no stale write |
| ReviewCase already resolved | identical replay returns stored result; conflicting payload is conflict |
| ReviewCase deferred | no canonical write; later decision must rebind current state |
| duplicate replay | idempotent existing refs/result; no duplicate assets |
| kill criterion inconclusive | no invalidation; report assessment and recommendation only |
| provider unavailable | no fabricated evidence; run blocked or completed with unavailable diagnostics |
| Pi unavailable | HTTP/Application path remains authoritative; no direct fallback mutation |
| Gateway blocked | no Writer call; preserve report and diagnostics |
| Writer rejected | no claimed completion; report ChangeSet/Writer failure and current revision |

## Implementation Scope

The future implementation is limited to:

1. A normal ApplicationService lifecycle start/report path around existing
   Workflow skills and accepted evidence lanes.
2. Canonical Thesis selection and deterministic proposition reconstruction from
   `qualifies` edges.
3. PIT-safe evidence adapter and deterministic `refreshThesis()` invocation.
4. Canonical proposal builder for Claims, impact edges, Thesis updates, and
   bounded supersession.
5. Minimal Gateway producer-contract extension for existing canonical source and
   target endpoint binding, with type/lifecycle/revision validation.
6. Thesis-scoped ReviewCase construction using scalar context, canonical Claim
   refs in impact, and real raw provenance enforcement.
7. Adjacent durable `ReviewDecision` history/state persistence in existing
   review storage, with decision-aware ReviewService projections.
8. ACCEPT/REJECT/DEFER service commands with revision/replay/compare-write
   protection and valid DEFER transitions.
9. Gateway → ChangeSet → Writer → reload verification and report persistence.
10. HTTP/UI/Pi surface using existing ApplicationService and scoped Pi patterns.
11. Real configured-Pi E2E and the mandatory endpoint, decision-state, rawRef,
    listing, membership, and no-mutation tests in the acceptance gate.

The implementation must first prove v0.4 `qualifies` persistence and
reconstruction. If that proof fails, stop with `DESIGN_SCHEMA_GAP`; do not
quietly add `propositionRefs` or a parallel store.

## Explicit Non-Goals

This design does not include:

* a generic continuous-research engine, scheduler, or event bus;
* a generic ReviewDecision platform;
* a new Agent runtime, Planner, Provider, or DSH integration;
* a new Knowledge database, proposition store, or Thesis graph store;
* a replacement for `formalizeThesis()` or `refreshThesis()`;
* Prediction objects, outcome acquisition, forecast scoring, Brier score,
  prediction review, or investment performance evaluation;
* portfolio, trading, buy/sell, sizing, rebalance, or order execution;
* direct client/Pi Knowledge mutation or LLM-owned canonical writes;
* report-only canonical mutation or source averaging;
* rerunning all research workflows for every Thesis refresh.

If implementation requires any architecture listed in this section, the result
is `DESIGN_DRIFT` and the implementation stops for architecture review.

## Implementation Acceptance Gate

The design is accepted for implementation only when all of the following are
demonstrated on the real configured-Pi path:

* normal ResearchService/Application lifecycle path;
* canonical Thesis selection and unique proposition reconstruction;
* PIT-safe accepted evidence and source lineage;
* deterministic `refreshThesis()` result with unchanged preservation;
* explicit proposition mapping and Claim/Thesis/edge bindings;
* durable Claim-backed ReviewCase with Thesis scope;
* durable ACCEPT, REJECT, and DEFER decisions;
* ACCEPT current-Knowledge reload/rebind before proposal construction;
* Gateway → validated ChangeSet → Writer → canonical reload;
* no automatic invalidation, archive, load-bearing supersession, or status
  change;
* stale revision rejection and duplicate replay idempotency;
* lifecycle report with before/after, PIT, deltas, decisions, refs, and
  revisions;
* HTTP and normal Pi interaction;
* live accepted evidence E2E with one unchanged and one weakened/challenged
  proposition;
* negative DEFER or REJECT E2E proving no canonical semantic mutation;
* Gateway existing Observation→Claim and Claim→Thesis `qualifies` endpoint
  binding, including invalid type, missing endpoint, and deleted/superseded
  endpoint rejection;
* DEFER→ACCEPT and DEFER→REJECT after current revalidation;
* ACCEPT second-decision conflict and REJECT later-ACCEPT conflict;
* accepted/rejected/stale cases absent from actionable listings while deferred
  cases remain actionable;
* ReviewCase without a real rawRef fails closed;
* new evidence Claim without membership may auto-write, while Claim plus new
  `qualifies` membership requires review;
* REJECT/DEFER do not persist reviewed challenge/contradiction edges, while
  ACCEPT persists exactly the current-revalidated reviewed edge;
* `git diff --check` and `npm run typecheck` passing with no runtime/test/schema
  changes in this design task.

# RHL-TL-001-FIX-001 REPORT

Status:
DESIGN_RECONCILED / SOL REVIEW PENDING

Baseline:
- required HEAD: `723a6ed73edfd007e07335ec86366121bcdcdb88`
- starting HEAD: `723a6ed73edfd007e07335ec86366121bcdcdb88`
- origin/main: `0a0d2b1b50b293b2a8e666a8344e8d073af7fab5`
- branch: `codex/tl-001-thesis-lifecycle-product-design`
- worktree: `C:\Users\Administrator\Desktop\ResearchHub_Lite_worktrees\TL_001`

Canonical model:
- Knowledge schema changed: no; v0.4 is sufficient with explicit `qualifies` membership edges.
- Thesis role: canonical identity, subject, title, aggregate statement/status, and lifecycle dates.
- proposition canonical type: `KnowledgeClaimV04`.
- proposition identity: active Claim refs reconstructed from deterministic Claim→Thesis `qualifies` edges; local `propositionId` is not identity.
- proposition → thesis linkage: `ReasoningEdgeV04(type: 'qualifies')` from Claim to Thesis.
- dependency linkage: Claim `dependsOnClaimRefs`, `supportsClaimRefs`, `contradictsClaimRefs`; accepted replacements use `supersedes`/`supersededBy`.

Gateway:
- current limitation: `boundRef()` resolves only local proposal keys from the current submission; it does not resolve arbitrary existing canonical endpoint refs.
- minimal producer-contract extension: `existingSourceRef?: CanonicalKnowledgeRefV04` and `existingTargetRef?: CanonicalKnowledgeRefV04` for reasoning edges.
- existing source endpoint: exactly one of local `sourceProposalId`/`subjectKey` or `existingSourceRef`; must be current, lifecycle-valid Observation or Claim.
- existing target endpoint: exactly one of local `targetKey` or `existingTargetRef`; must be current, lifecycle-valid Claim or Thesis.
- direct Writer bypass: prohibited.
- CREATE behavior: local proposal bindings remain preferred.
- REFRESH behavior: current canonical Observation/Claim/Thesis refs bind directly through the Gateway extension; existing assets are not re-proposed solely for endpoint IDs.

Thesis identity:
- selected Thesis guard: resolve the selected canonical Thesis first; computed `subjectRefs + title` identity must equal `thesisRef` before Gateway submission.
- title drift: unchanged/required; title change is out of scope.
- subject drift: unchanged/required; drift blocks rather than creating a second Thesis.

Review scope:
- thesisRef location: scalar `resolutionContext.context.thesisRef`.
- affected proposition refs location: canonical Claim refs in `impact.affectedProposalRefs`.
- base revision: `resolutionContext.knowledgeBaseRevisionAtCreation`.
- candidate transition: scalar `resolutionContext.context.candidateTransition`.

Review evidence:
- rawRef required: yes; a real archived rawRef must be reachable through Source/provenance.
- synthetic rawRef allowed: no.
- missing raw provenance behavior: `BLOCK / REVIEW_EVIDENCE_BINDING_UNAVAILABLE`.

Decision model:
- OPEN: actionable initial state.
- DEFERRED: unresolved and actionable; no canonical semantic mutation.
- ACCEPTED: terminal after current rebind and Writer verification.
- REJECTED: terminal with no canonical semantic mutation.
- STALE: terminal, non-actionable; requires a new refresh.
- terminal states: ACCEPTED, REJECTED, STALE.
- actionable states: OPEN, DEFERRED.
- decision history: append-only events in `decisions/<reviewCaseId>.yaml`.
- compare/write protection: expected current hash/revision with atomic locked write.

Decision transitions:
- OPEN→DEFER: allowed; current state DEFERRED.
- DEFER→ACCEPT: allowed only after current Knowledge revalidation.
- DEFER→REJECT: allowed only after current Knowledge revalidation.
- ACCEPT→other: prohibited; conflicting replay.
- REJECT→other: prohibited; conflicting replay.

Review projections:
- immutable ReviewCase: historical case file remains `state.status = open`.
- decision overlay: ReviewService/application joins ReviewCase with ReviewDecisionRecord.
- actionable listing: OPEN and DEFERRED only.
- resolved listing: ACCEPTED, REJECTED, and STALE.
- count semantics: `countOpenReviewCases()` must be decision-aware or be replaced/migrated to a clearly named actionable projection.

Claim mapping:
- business_driver: fact / viewpoint / assumption for verified evidence / inference / hypothesis.
- industry_condition: fact / viewpoint / assumption.
- competitive_position: fact / viewpoint / assumption.
- financial_outcome: fact / viewpoint / assumption.
- earnings_expectation: forecast.
- valuation_expectation: forecast.
- catalyst: catalyst.
- risk: risk.
- other: fact / viewpoint / assumption.

System-owned:
- source admission, PIT filtering, evidence binding, proposition matching, unchanged preservation, refresh classification, kill calculation, candidate transition, canonical proposal binding, stale detection, replay/idempotency, and report persistence.

Human-owned:
- semantic proposition changes, load-bearing weakening/contradiction, supersession, all refresh-driven Thesis status changes, invalidation, and archive.

Automatic writes:
- safe support: AUTO_SAFE only when non-disputed, additive, and no proposition or Thesis state changes.
- evidence Claim: a new non-Thesis evidence Claim may auto-write with source/raw provenance.
- new Thesis proposition: REVIEW_REQUIRED; new Claim plus `qualifies` membership is not AUTO_SAFE.
- challenges: report classification only until ACCEPT; reviewed edge is ACCEPT-only.
- contradicts: report classification only until ACCEPT; reviewed edge is ACCEPT-only.
- invalidates: ACCEPT-only after objective kill condition and current revalidation.
- qualifies membership changes: REVIEW_REQUIRED during REFRESH; CREATE may establish initial membership.

REJECT:
- canonical semantic mutation: none; append REJECTED decision event.
- impact edge: no reviewed `qualifies`, `challenges`, `contradicts`, or `invalidates` edge.

DEFER:
- canonical semantic mutation: none; append DEFERRED decision event.
- impact edge: none.
- later decision: ACCEPT or REJECT remains valid only after current reload/rebind, evidence/PIT checks, and compare-and-write protection.

ACCEPT:
- current Knowledge reload: mandatory before proposal construction.
- current rebind: selected Thesis, proposition Claims, membership, endpoint refs, evidence provenance, and PIT are revalidated.
- proposal rebuild: deterministic builder reruns; stored stale Gateway proposals are not reused.
- Gateway: uses existing canonical endpoint fields for reviewed edges, validates types/lifecycle/revision, and produces the ChangeSet.
- Writer: only downstream of Gateway; reload and verify canonical refs/revision before recording ACCEPTED.

Thesis statuses:
- active: human approval required for REFRESH status changes; allowed as explicit CREATE result.
- strengthening: human approval required.
- weakening: human approval required.
- challenged: human approval required.
- invalidated: human-only; requires met kill condition and ACCEPT.
- archived: human-only; never a refresh side effect.

Kill criterion:
- met behavior: emit `invalidation_condition_met`, evidence/affected refs/rationale/recommendation, and ReviewCase.
- automatic invalidation: none.
- review required: yes, before Thesis `invalidated` or any proposition supersession.

Review:
- ReviewProposalKind change required: no; use Claim-backed root with minimal Thesis scope metadata.
- decision persistence: adjacent durable `decisions/<reviewCaseId>.yaml` under existing ReviewCase run storage.
- ACCEPT: reload/rebind current Knowledge, rebuild applicable proposals, Gateway → ChangeSet → Writer → reload.
- REJECT: durable rejection, no canonical semantic mutation.
- DEFER: durable deferral, no canonical semantic mutation; later reconsideration rebinds.
- stale revision: `STALE_REVIEW_DECISION`, no stale write.
- replay: identical replay returns durable result; no duplicate canonical assets or decisions.

Prior snapshot:
- reconstruction source: active canonical Claims reached by active Claim→Thesis `qualifies` edges, deterministically ordered.
- caller manual snapshot required: no.

Evidence:
- accepted lanes: Daily Change Assessment, Earnings Review, Event Research, Company Research, and explicitly accepted evidence already admitted by existing source governance.
- PIT: `publishedAt <= currentAsOf`; retrieval time does not substitute.
- unknown publication: diagnostic/non-decisive; cannot drive kill, contradiction, or supersession.
- source lineage: Source/raw evidence → Observation/evidence Claim → impact edge → proposition Claim → `qualifies` edge → Thesis.

Product path:
- CREATE: formalize, map, propose Thesis/Claims/links/qualifies edges, Gateway, Writer, reload.
- REFRESH: reconstruct, admit/PIT-filter, run refresh, split safe/review actions, decide, Gateway, Writer, reload.
- Daily handoff: accepted source/observation evidence and provenance; lifecycle owns Thesis binding.
- Earnings handoff: accepted exact-period evidence and existing load-bearing impact semantics; lifecycle owns final refresh/review.

Interaction:
- launch: Thesis selector plus bounded CREATE/REFRESH ApplicationService, HTTP, and Pi commands.
- report: run status, PIT, before/after snapshot, proposition deltas, unchanged refs, kill assessments, proposals, decisions, and revisions.
- review: inspect Claim-backed Thesis-scoped ReviewCase.
- decision: ACCEPT/REJECT/DEFER with case ID and bounded note only.

Real E2E design:
- existing company Thesis → live accepted Earnings/Event/Daily evidence → unchanged plus weakened/challenged proposition → ReviewCase → ACCEPT → current rebind → Gateway → Writer → reload → report; negative DEFER/REJECT proves no canonical mutation.

Schema sufficiency:
- v0.4 sufficient: yes, if `qualifies` is persisted and reconstructable as defined.
- DESIGN_SCHEMA_GAP: none identified; implementation must stop if the convention cannot be truthfully persisted.

Schema conclusion:
- Knowledge schema: SUFFICIENT; unchanged v0.4 Thesis/Claim/ReasoningEdge primitives.
- Production contract: MINIMAL EXTENSION REQUIRED for existing canonical ReasoningEdge endpoint binding.
- Review operational contract: MINIMAL EXTENSION REQUIRED for decision history/state projection and raw provenance enforcement.
- DESIGN_SCHEMA_GAP: none.

Future acceptance additions:
- existing Observation→Claim and Claim→Thesis `qualifies` edges through Gateway;
- invalid/missing/deleted/superseded canonical endpoint rejection;
- DEFER→ACCEPT and DEFER→REJECT after revalidation;
- ACCEPT second decision conflict and REJECT later ACCEPT conflict;
- accepted/rejected/stale absent from actionable listing and deferred remaining actionable;
- ReviewCase without real rawRef fails closed;
- evidence Claim without membership may auto-write, while new membership requires review;
- REJECT/DEFER do not write reviewed impact edges and ACCEPT writes exactly the current-revalidated edge.

Implementation scope:
- bounded REFRESH-first ApplicationService, deterministic snapshot/PIT/refresh adapter, minimal Gateway endpoint binding, Thesis-scoped ReviewCase/rawRef enforcement, decision history/projections, canonical proposal/review path, HTTP/Pi/UI surface, reports, replay/stale protections, and real E2E.

Explicit non-goals:
- generic engines/platforms/stores/schedulers, Prediction, portfolio/trading, new Agent/Planner/Provider, direct mutation, and LLM-owned canonical writes.

Acceptance gate:
- all gates in the Implementation Acceptance Gate section, including real accepted-evidence E2E and negative no-mutation decision path.

Files changed:
- `docs/engineering/specs/2026-09-24-thesis-lifecycle-product-closure-v0.1.md` only.

Validation:
- diff check: passed.
- typecheck: passed.

Git:
- commit: `baa7b8e` reconciliation content commit.
- final HEAD: verified post-report commit on the requested branch.
- remote branch: `origin/codex/tl-001-thesis-lifecycle-product-design`.
- local == remote: verified post-report push.
- worktree clean: verified post-report commit.
- main unchanged: yes, `main == origin/main == 0a0d2b1b50b293b2a8e666a8344e8d073af7fab5`.
- D0 unchanged: yes, `1ca5060a2197ae5da4748411b085a1d232178308`.

Notes for Sol:
- v0.4 is sufficient only under the explicitly frozen Claim→Thesis `qualifies` membership convention. The current Gateway top-level `semanticKey` is not universal Claim identity. The implementation must fail closed on ambiguous binding and must never auto-invalidate, archive, or supersede a load-bearing proposition.
