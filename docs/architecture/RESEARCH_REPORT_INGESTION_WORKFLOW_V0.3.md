# RESEARCH_REPORT_INGESTION_WORKFLOW_V0.3

## Status

**Frozen / Sol Accepted**

- Workflow Version: `0.3`
- Knowledge Schema Dependency: `0.3`
- Storage Format Dependency: `1`
- Sol/CTO independently verified commit `47e312f79a221d7dd45b42508e52526fd61b1a74`.
- This frozen workflow target is not itself an implementation authorization; runtime migration to v0.3 remains separate and has not started.

## 1. Purpose

Defines deterministic SOP for converting a research report into canonical ResearchHub Knowledge.

The user submits a report; ResearchHub understands it, extracts durable Knowledge, reconciles it with existing KB state, commits safe canonical Knowledge, and surfaces only unresolved review.

The user does not normally pre-select an Investment Theme.

## 2. Canonical Workflow

```text
[0]  Intake / Execution Identity
[1]  Resolve Research Knowledge Base
[2]  Document Resolution
[3]  Raw Identity / Raw Archive
[4]  Report Understanding
[5]  Theme Handling
[6]  Relevant Knowledge Context Retrieval
[7]  Section Batching
[8]  Schema-aware Batched Knowledge Extraction
[9]  Candidate Consolidation
[10] Deterministic Reference Resolution
[11] Existing Knowledge Retrieval
[12] Batched Knowledge Reconciliation
[13] Conditional Schema Gap Analysis
[14] Review Isolation / ChangeSet Planning
[15] Deterministic Final Validation
[16] Atomic Semantic Write
[17] Final Result / Ingestion Log / Projection Refresh
```

Standalone relevance filtering, per-Candidate admission, standalone mapping, and per-Candidate conflict analysis are retired.

## 3. Status

- completed
- completed_with_review
- blocked

`completed_with_review` is successful product state with unresolved semantic review; it is not a technical failure.

## 4. Ingestion Identity / Reprocess

workflowRunId identifies one execution. ingestionIdentity identifies logical report-ingestion identity for idempotency.

`reprocess=true` permits re-running Curation against current KB; it never means blind duplicate creation.

## 5. Review Continuation

No background waiting. Original execution terminates with `completed_with_review` + optional `continuationRef`.

Continuation is a later explicit execution. If KB revision/relevant state changed, pending items MUST be re-resolved/retrieved/reconciled before mutation.

## 6. Resolve KB

Commit requires writable Schema 0.3 target. v0.2 KB must migrate explicitly first.

## 7. Document Resolution

Use ResearchReportInputResolver → Document Parser Plugin → ResolvedResearchReportInput.

Docling Local remains preferred PDF parser. No silent fallback.

Conceptual units:
- Chunk = provenance unit
- Section = semantic unit
- Batch = model execution unit

## 8. Raw Archive

Commit mode uses Raw-first semantics. Raw may remain archived even if later semantic processing fails. Raw-only persistence does not increment semantic KB revision.

Dry-run MUST NOT durably mutate Raw/Raw registry.

## Legacy Auxiliary Assets

Legacy Taxonomy and View assets are handled by the explicit 0.2 → 0.3
Migration architecture as preserved Reference Taxonomy and Projection
Configuration Assets. They do not create additional report-ingestion stages,
canonical object kinds, or Workflow Managers/Engines. Explicit canonical refs
inside those assets are rewritten through the complete migration ID map and
validated; unresolved refs block migration.

## 9. Report Understanding

Call `understandReport` with trusted structure, supplied metadata, Schema Context, Theme/ThemeGroup catalog.

Produces Source Assessment, research scope, major topics/entities, Theme hypotheses, optional new Theme proposal, uncertainty.

## 10. Source Proposal

After Report Understanding deterministic infrastructure constructs Source Proposal and resolves/allocates Source ID.

Source is normally NOT committed immediately; it enters the final semantic ChangeSet together with accepted Knowledge.

## 11. Theme Handling

Dispositions:
- resolved_existing
- resolved_multiple
- provisional_unresolved
- proposed_new
- ambiguous

Theme uncertainty does not automatically block extraction. New Theme/ThemeGroup requires explicit review before canonical creation.

Theme-independent safe Knowledge may continue.

## 12. Broad Context Retrieval

Stage 6 retrieves focused Themes, Industries, Companies, Products, Technologies, Theme Exposures, Business Exposures, and aliases for extraction.

This differs from precise overlap retrieval after Reference Resolution.

## 13. Section Batching

Deterministic Workflow groups coherent sections by structure + token budget.

Avoid one-call-per-chunk and avoid one giant whole-report call by default.

Silent omission of failed required batches is forbidden.

## 14. Batched Extraction

Call `extractKnowledge` per batch.

Outputs EntityCandidates, RelationCandidates, ClaimCandidates.

No standalone relevance/admission/mapping LLM stages.

## 15. Candidate Consolidation

Deterministically consolidate obvious duplicates only. Subtle semantic equivalence goes to Reconciliation.

Candidate IDs are workflow-local and deterministic.

## 16. Reference Resolution

Outcomes:
- existing_ref
- new_object_key
- ambiguous
- invalid

LLM cannot create canonical refs. New durable IDs are allocated later during ChangeSet Planning.

## 17. Existing Knowledge Retrieval

After resolution, retrieve precise overlap context for Claims, Relations, Business Exposure, and Entity identity.

## 18. Batched Reconciliation

Group Candidates by coherent semantic neighborhood.

Outcomes:
- create
- duplicate
- merge_source
- update_state
- supersede
- keep_both
- reject
- user_review

Do not default to one Candidate = one model call.

## 19. Conditional Schema Gap

Run only for material unrepresentable Candidates. Schema Gap does not mutate Schema and does not automatically block unrelated safe Knowledge.

## 20. Review Isolation

Partition into:
- safe commit closure
- pending review closure
- rejected/non-admitted items

Typical review categories:
- theme_creation
- theme_group_creation
- theme_ambiguity
- reference_ambiguity
- fact_conflict
- relation_conflict
- semantic_disambiguation

A review item isolates its dependency closure, not the whole report.

## 21. Partial Semantic Acceptance

Independent safe Knowledge may commit even while some items remain under review.

If pending object is required by dependents, dependents are also pending.

## 22. Source Handling

If semantic Knowledge enters ChangeSet, Source Proposal enters as source_create/source_merge and dependent Knowledge may reference it atomically.

If no safe semantic Knowledge is eligible and review remains unresolved, Source need not be committed yet; Raw remains durable evidence.

## 23. ChangeSet Planning

Deterministic planning:
1. Source create/merge
2. allocate durable IDs for accepted new objects
3. build temporary→canonical mapping
4. rewrite accepted refs
5. create Entity operations
6. create Relation operations
7. create Claim operations
8. create update/supersede/source-merge operations
9. check cardinality
10. produce one KnowledgeChangeSet

LLM does not construct Writer instructions.

## 24. One Semantic ChangeSet Per Execution

Zero or one semantic commit per execution.

No per-batch/per-Candidate/per-Theme/per-Claim-type commits.

Raw archival is explicit pre-semantic-commit exception.

## 25. Final Validation

Validate complete safe ChangeSet for Schema 0.3, refs, provenance, endpoints, cardinality, Business Exposure uniqueness, Claim constraints, lifecycle, IDs, registry compatibility, and base revision.

## 26. Bounded Extraction Validation Retry (C9)

The Workflow owns a bounded retry policy for `extractKnowledge` only. Each
logical batch receives at most two model attempts. The first attempt uses the
normal Curation input and behavior. If strict Curation validation rejects the
model output with one of `invalid_model_output`, `invalid_reference`,
`invalid_semantics`, `invalid_confidence`, or `ungrounded_candidate`, the
Workflow records the sanitized validation feedback and invokes the same logical
batch exactly once more with that feedback. The Skill converts the feedback to
a correction instruction while preserving the C8 model-visible projection.

Transport, provider, timeout, credential, unsupported-schema, infrastructure,
Writer, and other Workflow failures are not retry-eligible. A second
validation failure blocks the Workflow with the final error; no third attempt,
normalization, candidate deletion, evidence substitution, or repair is
allowed.

`ModelCallRecord.retryCount` is `0 | 1` and records logical-batch retry state.
`ingestionContext.modelCalls` records actual underlying model invocations,
defined as the sum of `1 + retryCount` across logical model-call records.
Extraction batch counters remain logical-batch counters, so a retry does not
create a second batch. Retry metadata is execution trace only and cannot enter
ingestion identity, Raw identity, Candidate identity, canonical IDs, or
ChangeSet identity.

Final validation is all-or-nothing. Do not silently drop failing operations and commit the rest.

## 26. Atomic Write / Revision

Successful semantic ChangeSet increments revision exactly once:

```text
finalRevision = baseRevision + 1
```

No revision increase for dry-run, no semantic changes, review-only, validation failure, Writer failure, or Raw-only archival.

## 27. Commit With Pending Review

A valid commit may return `completed_with_review` while safe independent Knowledge is committed. Later continuation is a new execution and may increment revision again if it commits semantic Knowledge.

## 28. Dry-Run

Executes semantic pipeline through final validation but performs no durable Raw/Source/Knowledge/Registry mutation and no revision increment.

## 29. Result Model

Result SHOULD include workflowRunId, ingestionIdentity, knowledgeBaseId, mode/status, revisions, Raw outcome, Source proposal/canonical Source, Report Understanding, Theme Handling, extraction counts, resolution summary, reconciliation summary, Schema Gaps, review items, planned/committed changes, validation, continuationRef, failureStage, errors.

Old admitted/mapped/unmapped counters are retired.

## 30. Ingestion Log / Call Accounting

Log model-call summaries, batches, Candidate counts, reconciliation, reviews, Schema Gaps, changes, revisions, failure stage, continuation metadata.

Retries and call counts MUST be observable.

## 31. Failure Classes

### Semantic Review
Isolate dependency closure → continue safe Knowledge → completed_with_review.

### Schema Gap
Isolate unrepresentable Knowledge → continue representable Knowledge → governance output.

### Integrity/Execution Failure
Block semantic commit → blocked.

## 32. Boundaries

- no cross-KB resolution
- Curation Skill does not orchestrate Access/Writer
- parsing remains Plugin boundary
- Workflow remains runtime-neutral
- packages/workflows MUST NOT depend on dsh
- no hidden background processing
- no Workflow Engine
- no Planner
- no Multi-Agent system

## 33. Frozen Decisions

The 18-stage Workflow, Raw-first semantics, non-blocking Theme uncertainty, deterministic batching/consolidation/resolution, batch reconciliation, conditional Schema Gap, dependency-closure review isolation, one semantic atomic commit, all-or-nothing final validation, explicit continuation, observable LLM calls, runtime-neutral boundary, and the absence of Taxonomy/View Workflow stages are frozen. Migration handles those auxiliary assets separately. v0.4 is NOT approved. This document is Frozen / Sol Accepted; implementation status is governed separately.

## C13 Candidate-Isolated Validation Addendum

C13 preserves the Workflow's Extraction Batch as the transport/orchestration
unit while making each candidate the semantic validation atomic unit. The
Curation Skill returns accepted candidates plus deterministic sanitized local
rejection metadata. Only accepted candidates enter consolidation, reference
resolution, existing-Knowledge retrieval, reconciliation, Schema Gap handling,
ChangeSet construction, and Writer.

Candidate-local rejection alone is not C9-retry eligible. If all non-empty raw
candidates are rejected, the operation reports `candidate_set_exhausted` and
may use the existing one complete retry. Global/trusted/output-envelope
failures retain the existing at-most-one complete retry and then fail with no
third attempt. Accepted/rejected counts and validation-code counts are recorded
in Workflow model-call metadata without sensitive model text. No Schema v0.4,
canonical semantic change, coercion, repair, or provider/runtime change is
introduced.
